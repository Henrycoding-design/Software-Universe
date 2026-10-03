import type { CelestialType } from "../../shared/universe-types.ts";
import { SIMULATION } from "./constants.ts";

export interface InitialBody {
  id: string;
  type: CelestialType;
  activity: number;
  mass: number;
  parentIndex: number;
}

export interface InitialState {
  positions: Float32Array;
  velocities: Float32Array;
  /** Stable host assignment for renderer orbit visualizations. */
  hostIndices: Int32Array;
}

interface StarHost { body: InitialBody; index: number; }

/**
 * Deterministic galaxy-style initial conditions. Stars form a broad rotating
 * disk; hash-distributed planet, asteroid, and comet systems orbit individual
 * stars rather than a shared central anchor. Moons retain their classifier
 * parent. Circular speeds include the same Plummer softening used by forces.
 */
export function createInitialState(bodies: readonly InitialBody[], seed = SIMULATION.initialSeed): InitialState {
  const positions = new Float32Array(bodies.length * 3);
  const velocities = new Float32Array(bodies.length * 3);
  const stars = bodies.map((body, index) => ({ body, index })).filter(({ body }) => body.type === "star")
    .sort((a, b) => b.body.mass - a.body.mass || a.body.id.localeCompare(b.body.id));
  const fallback = mostMassiveBody(bodies);
  const bodyHost = assignHosts(bodies, stars, fallback, seed);
  const systemMass = collectSystemMasses(bodies, bodyHost);

  placeStars(stars, systemMass, positions, velocities, seed);
  // A moon depends on a planet/star position, so place all primary systems
  // first regardless of source JSON order, then attach their moons.
  const hostSlotCount: Record<string, number> = {};
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index]!;
    if (body.type === "star" || body.type === "moon") continue;
    const parent = bodyHost[index]!;
    const key = `${parent}:${body.type}`;
    const slot = hostSlotCount[key] ?? 0;
    hostSlotCount[key] = slot + 1;
    placeOrbiter(index, parent, bodies, positions, velocities, seed, slot);
  }
  const moonSlotCount: Record<number, number> = {};
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index]!;
    if (body.type !== "moon") continue;
    const parent = validParent(body.parentIndex, bodies.length) ? body.parentIndex : bodyHost[index]!;
    const slot = moonSlotCount[parent] ?? 0;
    moonSlotCount[parent] = slot + 1;
    placeOrbiter(index, parent, bodies, positions, velocities, seed, slot);
  }
  removeCenterOfMassDrift(bodies, velocities);
  enforceCometGalaxyDirections(bodies, bodyHost, positions, velocities, seed);
  return { positions, velocities, hostIndices: new Int32Array(bodyHost) };
}

function placeStars(
  stars: readonly StarHost[],
  systemMass: Float64Array,
  positions: Float32Array,
  velocities: Float32Array,
  seed: number,
): void {
  let enclosedMass = 0;
  // Spheroid vertical scale ratio: 0.68 creates an oblate spheroid
  // with significant upward and downward spread rather than a flat sheet.
  const verticalRatio = 0.68;
  for (let rank = 0; rank < stars.length; rank++) {
    const { body, index } = stars[rank]!;
    const random = mulberry32(hash(`${seed}:star:${body.id}`));
    const offset = index * 3;
    if (rank === 0) {
      // The most influential star is the galaxy's visual core.
      enclosedMass += systemMass[index]!;
      continue;
    }
    // Spread stars in an oblate spheroid: radial distance from core scales with rank
    const radius = 120 * Math.sqrt(rank) + random() * 10;
    const azimuth = rank * 2.399963229728653 + random() * 0.22;
    // Elevation spreads upward and downward across the spheroid
    const elevation = (random() - 0.5) * Math.PI * 0.82;
    const cosElevation = Math.cos(elevation);
    const sinElevation = Math.sin(elevation);

    const horizontal = radius * cosElevation;
    const height = radius * sinElevation * verticalRatio;
    const x = Math.cos(azimuth) * horizontal;
    const z = Math.sin(azimuth) * horizontal;
    positions[offset] = x;
    positions[offset + 1] = height;
    positions[offset + 2] = z;
    // Approximate a co-rotating orbit around already placed inner stars
    const speed = circularSpeed(enclosedMass, radius) * 0.94;
    const horizontalLength = Math.hypot(x, z) || 1;
    velocities[offset] = -z / horizontalLength * speed;
    velocities[offset + 1] = (random() - 0.5) * speed * 0.22;
    velocities[offset + 2] = x / horizontalLength * speed;
    enclosedMass += systemMass[index]!;
  }
}

function placeOrbiter(
  index: number,
  parent: number,
  bodies: readonly InitialBody[],
  positions: Float32Array,
  velocities: Float32Array,
  seed: number,
  slot = 0,
): void {
  const body = bodies[index]!;
  const random = mulberry32(hash(`${seed}:orbit:${body.id}`));
  const offset = index * 3;
  const parentOffset = parent * 3;
  const direction = body.type === "comet" ? randomDirection(random) : diskDirection(random, slot, body.type === "moon");
  const radius = initialRadius(body.type, random, slot);
  positions[offset] = positions[parentOffset]! + direction[0] * radius;
  positions[offset + 1] = positions[parentOffset + 1]! + direction[1] * radius;
  positions[offset + 2] = positions[parentOffset + 2]! + direction[2] * radius;

  const parentMass = bodies[parent]?.mass ?? 1;
  let speed = circularSpeed(parentMass, radius);
  if (body.type === "comet") {
    const eccentricity = 0.35 + body.activity * 0.45;
    // Start at apocentre; this produces a visibly eccentric but bound orbit.
    speed *= Math.sqrt(Math.max(0.08, 1 - eccentricity));
  } else speed *= 0.96 + body.activity * 0.08;
  let tangent: [number, number, number];
  if (body.type === "comet") {
    const orbit = cometOrbit(
      direction, seed, body.id,
      positions[offset]!, positions[offset + 2]!,
      positions[parentOffset]!, positions[parentOffset + 2]!,
      velocities[parentOffset]!, velocities[parentOffset + 2]!,
      speed,
    );
    tangent = orbit.tangent;
    speed = orbit.speed;
  } else tangent = perpendicular(direction, random);
  // Orbit velocities are relative to a moving star/planet parent.
  velocities[offset] = velocities[parentOffset]! + tangent[0] * speed;
  velocities[offset + 1] = velocities[parentOffset + 1]! + tangent[1] * speed;
  velocities[offset + 2] = velocities[parentOffset + 2]! + tangent[2] * speed;
}

function chooseHost(body: InitialBody, stars: readonly StarHost[], fallback: number, seed: number): number {
  if (stars.length === 0) return fallback;
  // Stable hashing spreads related visual systems across every available star.
  return stars[hash(`${seed}:host:${body.id}`) % stars.length]!.index;
}

function assignHosts(bodies: readonly InitialBody[], stars: readonly StarHost[], fallback: number, seed: number): Int32Array {
  const hosts = new Int32Array(bodies.length).fill(-1);
  for (const { index } of stars) hosts[index] = index;
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index]!;
    if (body.type !== "star" && body.type !== "moon") hosts[index] = chooseHost(body, stars, fallback, seed);
  }
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index]!;
    if (body.type !== "moon") continue;
    const parent = body.parentIndex;
    hosts[index] = validParent(parent, bodies.length) ? (hosts[parent]! >= 0 ? hosts[parent]! : parent) : chooseHost(body, stars, fallback, seed);
  }
  return hosts;
}

function collectSystemMasses(bodies: readonly InitialBody[], hosts: Int32Array): Float64Array {
  const total = new Float64Array(bodies.length);
  for (let index = 0; index < bodies.length; index++) {
    const host = hosts[index]!;
    if (host >= 0) total[host]! += bodies[index]!.mass;
  }
  return total;
}

/** Keep the full N-body system centered on the camera target rather than drifting away. */
function removeCenterOfMassDrift(bodies: readonly InitialBody[], velocities: Float32Array): void {
  let totalMass = 0;
  let x = 0, y = 0, z = 0;
  for (let index = 0; index < bodies.length; index++) {
    const mass = bodies[index]!.mass;
    const offset = index * 3;
    totalMass += mass;
    x += velocities[offset]! * mass;
    y += velocities[offset + 1]! * mass;
    z += velocities[offset + 2]! * mass;
  }
  if (totalMass === 0) return;
  x /= totalMass; y /= totalMass; z /= totalMass;
  for (let index = 0; index < bodies.length * 3; index += 3) {
    velocities[index]! -= x;
    velocities[index + 1]! -= y;
    velocities[index + 2]! -= z;
  }
}

/**
 * Center-of-mass correction changes every galaxy-frame velocity. Recheck comet
 * handedness after that correction and, for retrograde bodies, add only the
 * tangential speed needed to make the final galaxy-frame Ly oppose its host.
 */
function enforceCometGalaxyDirections(
  bodies: readonly InitialBody[],
  hosts: Int32Array,
  positions: Float32Array,
  velocities: Float32Array,
  seed: number,
): void {
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index]!;
    if (body.type !== "comet") continue;
    const parent = hosts[index]!;
    if (parent < 0) continue;
    const offset = index * 3;
    const parentOffset = parent * 3;
    const hostLy = angularMomentumY(positions, velocities, parent);
    const desiredSign = (Math.sign(hostLy) || 1) * cometOrbitDirection(seed, body.id);
    let relativeX = velocities[offset]! - velocities[parentOffset]!;
    let relativeY = velocities[offset + 1]! - velocities[parentOffset + 1]!;
    let relativeZ = velocities[offset + 2]! - velocities[parentOffset + 2]!;
    const relativeSpeed = Math.hypot(relativeX, relativeY, relativeZ);
    if (relativeSpeed < 1e-6) continue;
    relativeX /= relativeSpeed; relativeY /= relativeSpeed; relativeZ /= relativeSpeed;
    let tangentLy = positions[offset]! * relativeZ - positions[offset + 2]! * relativeX;
    if (desiredSign * tangentLy < 0) {
      relativeX = -relativeX; relativeY = -relativeY; relativeZ = -relativeZ;
      tangentLy = -tangentLy;
    }
    if (desiredSign * tangentLy < 1e-6) continue;
    const currentLy = angularMomentumY(positions, velocities, index);
    const margin = Math.max(1, Math.abs(currentLy) * 0.05);
    const additionalSpeed = (margin - desiredSign * currentLy) / (desiredSign * tangentLy);
    if (additionalSpeed <= 0) continue;
    velocities[offset]! += relativeX * additionalSpeed;
    velocities[offset + 1]! += relativeY * additionalSpeed;
    velocities[offset + 2]! += relativeZ * additionalSpeed;
  }
}

function angularMomentumY(positions: Float32Array, velocities: Float32Array, index: number): number {
  const offset = index * 3;
  return positions[offset]! * velocities[offset + 2]! - positions[offset + 2]! * velocities[offset]!;
}

function mostMassiveBody(bodies: readonly InitialBody[]): number {
  let chosen = 0;
  for (let index = 1; index < bodies.length; index++) {
    if (bodies[index]!.mass > bodies[chosen]!.mass) chosen = index;
  }
  return chosen;
}

function circularSpeed(parentMass: number, radius: number): number {
  const softenedRadiusSq = radius * radius + SIMULATION.softening * SIMULATION.softening;
  return Math.sqrt(SIMULATION.gravitationalConstant * parentMass * radius * radius / Math.pow(softenedRadiusSq, 1.5));
}

function initialRadius(type: CelestialType, random: () => number, slot = 0): number {
  switch (type) {
    // Moons: slot-based orbital shells with jitter so multiple moons spread
    // outward rather than clustering at the same distance from their planet.
    case "moon": return 3.2 + slot * 3.4 + random() * 2.8;
    case "planet": return 22 + slot * 16 + random() * 6; // dedicated orbital shells
    case "comet": return 65 + slot * 20 + random() * 15; // wide eccentric orbits
    case "asteroid": return 36 + (slot % 4) * 8 + random() * 5; // spread across belt
    case "star": return 0;
  }
}

function validParent(parent: number, count: number): boolean {
  return Number.isInteger(parent) && parent >= 0 && parent < count;
}

/** Spread orbiters with 3D inclination angles around their host. Moons get
 *  nearly spherical spread (high inclination); other types stay near the disk. */
function diskDirection(random: () => number, slot = 0, isMoon = false): [number, number, number] {
  // Golden-angle step ensures even azimuthal coverage for any count of orbiters
  const angle = (slot * 2.399963229728653 + random() * 0.4) % (Math.PI * 2);
  // Moons spread across nearly the full sphere; planets/asteroids stay near the disk
  const inclinationRange = isMoon ? 1.8 : 0.38;
  const y = (random() - 0.5) * inclinationRange;
  const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.cos(angle) * horizontal, y, Math.sin(angle) * horizontal];
}

function randomDirection(random: () => number): [number, number, number] {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return [radius * Math.cos(angle), z, radius * Math.sin(angle)];
}

function cometOrbitDirection(seed: number, id: string): 1 | -1 {
  return mulberry32(hash(`${seed}:comet-direction:${id}`))() < 0.5 ? -1 : 1;
}

function cometOrbit(
  direction: [number, number, number],
  seed: number,
  id: string,
  cometX: number, cometZ: number,
  parentX: number, parentZ: number,
  parentVx: number, parentVz: number,
  baseSpeed: number,
): { tangent: [number, number, number]; speed: number } {
  const first = tangentBasis(direction);
  const second: [number, number, number] = [
    direction[1] * first[2] - direction[2] * first[1],
    direction[2] * first[0] - direction[0] * first[2],
    direction[0] * first[1] - direction[1] * first[0],
  ];
  const angle = mulberry32(hash(`${seed}:comet-plane:${id}`))() * Math.PI * 2;
  let x = first[0] * Math.cos(angle) + second[0] * Math.sin(angle);
  let y = first[1] * Math.cos(angle) + second[1] * Math.sin(angle);
  let z = first[2] * Math.cos(angle) + second[2] * Math.sin(angle);
  const orbitDirection = cometOrbitDirection(seed, id);
  const starLy = parentX * parentVz - parentZ * parentVx;
  // A retrograde comet must oppose its host's galaxy-frame rotation; a prograde
  // comet follows it. The core star has zero Ly, so it uses the positive axis.
  const starSign = Math.sign(starLy) || 1; // treat zero as prograde
  const desiredSign = starSign * orbitDirection;
  let tangentLy = cometX * z - cometZ * x;
  if (desiredSign * tangentLy < 0) {
    x = -x; y = -y; z = -z;
    tangentLy = -tangentLy;
  }

  let speed = baseSpeed;
  if (orbitDirection === -1 && Math.abs(tangentLy) > 1e-6) {
    // The complete galaxy-frame Ly is cometPosition × (starVelocity +
    // tangent × speed). Increase a retrograde tangent just enough to overcome
    // the host contribution, plus a small margin so its direction is visible.
    const hostContribution = cometX * parentVz - cometZ * parentVx;
    const flipMargin = Math.max(1, Math.abs(hostContribution) * 0.05);
    const speedToFlip = (Math.max(0, -desiredSign * hostContribution) + flipMargin) / (desiredSign * tangentLy);
    speed = Math.max(baseSpeed, speedToFlip);
  }
  return { tangent: [x, y, z], speed };
}

function perpendicular(
  direction: [number, number, number],
  random: () => number,
): [number, number, number] {
  const [x, y, z] = tangentBasis(direction);
  return random() > 0.5 ? [x, y, z] : [-x, -y, -z];
}

function tangentBasis(direction: [number, number, number]): [number, number, number] {
  const reference: [number, number, number] = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let x = direction[1] * reference[2] - direction[2] * reference[1];
  let y = direction[2] * reference[0] - direction[0] * reference[2];
  let z = direction[0] * reference[1] - direction[1] * reference[0];
  const length = Math.hypot(x, y, z) || 1;
  x /= length; y /= length; z /= length;
  return [x, y, z];
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
