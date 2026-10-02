/**
 * Allocation-free-in-the-hot-path 3D Barnes-Hut octree. Cell topology and
 * center-of-mass data live in flat typed arrays; leaves retain a linked list
 * for exactly coincident bodies so subdivision cannot recurse forever.
 */
export interface BarnesHutOptions {
  theta?: number;
  softening?: number;
  gravitationalConstant?: number;
  maxDepth?: number;
}

const EMPTY = -1;

export class BarnesHutOctree {
  private readonly maxBodies: number;
  private readonly maxCells: number;
  private readonly maxDepth: number;
  private readonly theta: number;
  private readonly softening: number;
  private readonly gravitationalConstant: number;
  private readonly child: Int32Array;
  private readonly internal: Uint8Array;
  private readonly head: Int32Array;
  private readonly nextBody: Int32Array;
  private readonly centerX: Float64Array;
  private readonly centerY: Float64Array;
  private readonly centerZ: Float64Array;
  private readonly halfSize: Float64Array;
  private readonly totalMass: Float64Array;
  private readonly comX: Float64Array;
  private readonly comY: Float64Array;
  private readonly comZ: Float64Array;
  private readonly stack: Int32Array;
  private positions!: Float32Array | Float64Array;
  private masses!: Float32Array | Float64Array;
  private bodyCount = 0;
  private cellCount = 0;

  constructor(maxBodies: number, options: BarnesHutOptions = {}) {
    this.maxBodies = Math.max(1, maxBodies);
    this.maxDepth = options.maxDepth ?? 32;
    // A new branch can be made at most once per body per level. This trades a
    // little cold allocation for robust treatment of coincident coordinates.
    this.maxCells = 1 + this.maxBodies * (this.maxDepth + 1);
    this.theta = options.theta ?? 0.5;
    this.softening = options.softening ?? 0.1;
    this.gravitationalConstant = options.gravitationalConstant ?? 1;
    this.child = new Int32Array(this.maxCells * 8);
    this.internal = new Uint8Array(this.maxCells);
    this.head = new Int32Array(this.maxCells);
    this.nextBody = new Int32Array(this.maxBodies);
    this.centerX = new Float64Array(this.maxCells);
    this.centerY = new Float64Array(this.maxCells);
    this.centerZ = new Float64Array(this.maxCells);
    this.halfSize = new Float64Array(this.maxCells);
    this.totalMass = new Float64Array(this.maxCells);
    this.comX = new Float64Array(this.maxCells);
    this.comY = new Float64Array(this.maxCells);
    this.comZ = new Float64Array(this.maxCells);
    this.stack = new Int32Array(this.maxCells);
  }

  /** Build topology and center-of-mass values for the supplied body state. */
  build(positions: Float32Array | Float64Array, masses: Float32Array | Float64Array, bodyCount = masses.length): void {
    if (bodyCount > this.maxBodies) throw new Error(`Octree capacity ${this.maxBodies} is smaller than ${bodyCount} bodies`);
    this.positions = positions;
    this.masses = masses;
    this.bodyCount = bodyCount;
    this.cellCount = 1;
    this.child.fill(EMPTY);
    this.internal.fill(0);
    this.head.fill(EMPTY);
    this.nextBody.fill(EMPTY);
    this.totalMass.fill(0);
    if (bodyCount === 0) return;

    let minX = positions[0]!, maxX = positions[0]!;
    let minY = positions[1]!, maxY = positions[1]!;
    let minZ = positions[2]!, maxZ = positions[2]!;
    for (let body = 1; body < bodyCount; body++) {
      const offset = body * 3;
      const x = positions[offset]!, y = positions[offset + 1]!, z = positions[offset + 2]!;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    this.centerX[0] = (minX + maxX) * 0.5;
    this.centerY[0] = (minY + maxY) * 0.5;
    this.centerZ[0] = (minZ + maxZ) * 0.5;
    this.halfSize[0] = Math.max(1e-3, Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + 1e-5);
    for (let body = 0; body < bodyCount; body++) this.insert(0, body, 0, true);
  }

  /** Fill interleaved xyz accelerations by traversing the built tree. */
  accelerations(out: Float32Array | Float64Array): void {
    const softeningSq = this.softening * this.softening;
    for (let body = 0; body < this.bodyCount; body++) {
      const offset = body * 3;
      const x = this.positions[offset]!, y = this.positions[offset + 1]!, z = this.positions[offset + 2]!;
      let ax = 0, ay = 0, az = 0;
      let stackSize = 1;
      this.stack[0] = 0;
      while (stackSize) {
        const cell = this.stack[--stackSize]!;
        if (!this.internal[cell]) {
          for (let other = this.head[cell]!; other !== EMPTY; other = this.nextBody[other]!) {
            if (other === body) continue;
            const otherOffset = other * 3;
            const dx = this.positions[otherOffset]! - x;
            const dy = this.positions[otherOffset + 1]! - y;
            const dz = this.positions[otherOffset + 2]! - z;
            const inv = this.gravitationalConstant * this.masses[other]! / Math.pow(dx * dx + dy * dy + dz * dz + softeningSq, 1.5);
            ax += dx * inv; ay += dy * inv; az += dz * inv;
          }
          continue;
        }

        const dx = this.comX[cell]! - x;
        const dy = this.comY[cell]! - y;
        const dz = this.comZ[cell]! - z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12;
        const containsBody = Math.abs(x - this.centerX[cell]!) <= this.halfSize[cell]! + 1e-9
          && Math.abs(y - this.centerY[cell]!) <= this.halfSize[cell]! + 1e-9
          && Math.abs(z - this.centerZ[cell]!) <= this.halfSize[cell]! + 1e-9;
        if (!containsBody && (this.halfSize[cell]! * 2) / distance < this.theta) {
          const inv = this.gravitationalConstant * this.totalMass[cell]! / Math.pow(distance * distance + softeningSq, 1.5);
          ax += dx * inv; ay += dy * inv; az += dz * inv;
        } else {
          const childOffset = cell * 8;
          for (let octant = 0; octant < 8; octant++) {
            const child = this.child[childOffset + octant]!;
            if (child !== EMPTY) this.stack[stackSize++] = child;
          }
        }
      }
      out[offset] = ax; out[offset + 1] = ay; out[offset + 2] = az;
    }
  }

  private insert(cell: number, body: number, depth: number, includeCell: boolean): void {
    if (includeCell) this.addToAggregate(cell, body);
    const childOffset = cell * 8;
    if (!this.internal[cell]) {
      const existing = this.head[cell]!;
      if (existing === EMPTY) {
        this.head[cell] = body;
        return;
      }
      if (depth >= this.maxDepth || this.coincident(existing, body)) {
        this.nextBody[body] = existing;
        this.head[cell] = body;
        return;
      }
      // Turn a one-or-more body leaf into an internal cell. Parent aggregates
      // already include the existing bodies, so reinsertion starts at children.
      this.head[cell] = EMPTY;
      this.internal[cell] = 1;
      for (let previous = existing; previous !== EMPTY;) {
        const next = this.nextBody[previous]!;
        this.nextBody[previous] = EMPTY;
        this.insertChild(cell, previous, depth + 1);
        previous = next;
      }
    }
    this.insertChild(cell, body, depth + 1);
  }

  private insertChild(parent: number, body: number, depth: number): void {
    const offset = body * 3;
    const octant = (this.positions[offset]! >= this.centerX[parent]! ? 1 : 0)
      | (this.positions[offset + 1]! >= this.centerY[parent]! ? 2 : 0)
      | (this.positions[offset + 2]! >= this.centerZ[parent]! ? 4 : 0);
    const slot = parent * 8 + octant;
    let child = this.child[slot]!;
    if (child === EMPTY) {
      if (this.cellCount >= this.maxCells) throw new Error("Octree cell capacity exhausted");
      child = this.cellCount++;
      this.child[slot] = child;
      const quarter = this.halfSize[parent]! * 0.5;
      this.centerX[child] = this.centerX[parent]! + (octant & 1 ? quarter : -quarter);
      this.centerY[child] = this.centerY[parent]! + (octant & 2 ? quarter : -quarter);
      this.centerZ[child] = this.centerZ[parent]! + (octant & 4 ? quarter : -quarter);
      this.halfSize[child] = quarter;
      this.head[child] = EMPTY;
      this.totalMass[child] = 0;
    }
    this.insert(child, body, depth, true);
  }

  private addToAggregate(cell: number, body: number): void {
    const mass = this.masses[body]!;
    const oldMass = this.totalMass[cell]!;
    const newMass = oldMass + mass;
    const offset = body * 3;
    this.comX[cell] = (this.comX[cell]! * oldMass + this.positions[offset]! * mass) / newMass;
    this.comY[cell] = (this.comY[cell]! * oldMass + this.positions[offset + 1]! * mass) / newMass;
    this.comZ[cell] = (this.comZ[cell]! * oldMass + this.positions[offset + 2]! * mass) / newMass;
    this.totalMass[cell] = newMass;
  }

  private coincident(first: number, second: number): boolean {
    const a = first * 3, b = second * 3;
    const dx = this.positions[a]! - this.positions[b]!;
    const dy = this.positions[a + 1]! - this.positions[b + 1]!;
    const dz = this.positions[a + 2]! - this.positions[b + 2]!;
    return dx * dx + dy * dy + dz * dz < 1e-16;
  }
}

export function bruteForceAccelerations(
  positions: Float32Array | Float64Array,
  masses: Float32Array | Float64Array,
  out: Float32Array | Float64Array,
  options: Pick<BarnesHutOptions, "softening" | "gravitationalConstant"> = {},
): void {
  const softeningSq = (options.softening ?? 0.1) ** 2;
  const gravitationalConstant = options.gravitationalConstant ?? 1;
  for (let body = 0; body < masses.length; body++) {
    const offset = body * 3;
    let ax = 0, ay = 0, az = 0;
    for (let other = 0; other < masses.length; other++) {
      if (other === body) continue;
      const otherOffset = other * 3;
      const dx = positions[otherOffset]! - positions[offset]!;
      const dy = positions[otherOffset + 1]! - positions[offset + 1]!;
      const dz = positions[otherOffset + 2]! - positions[offset + 2]!;
      const inv = gravitationalConstant * masses[other]! / Math.pow(dx * dx + dy * dy + dz * dz + softeningSq, 1.5);
      ax += dx * inv; ay += dy * inv; az += dz * inv;
    }
    out[offset] = ax; out[offset + 1] = ay; out[offset + 2] = az;
  }
}
