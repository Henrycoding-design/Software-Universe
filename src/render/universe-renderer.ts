import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { CelestialType, Universe } from "../../shared/universe-types.ts";
import { SIMULATION } from "../physics/constants.ts";
import type { RenderCharacteristics } from "./characteristics.ts";

const TYPES: readonly CelestialType[] = ["star", "planet", "moon", "asteroid", "comet"];
const WHITE = new THREE.Color(0xffffff);
const COMET_TRAIL_POINTS = 14;
const COMET_TRAIL_STRETCH = 52;
const ORBIT_LOOP_SEGMENTS = 128;
const COMET_PICK_RADIUS_PX = 8;

interface BodyLookup { mesh: THREE.InstancedMesh; instanceIndex: number; type: CelestialType; }
interface MeshGroup { mesh: THREE.InstancedMesh; type: CelestialType; }

export interface RenderCounts { simulated: number; rendered: number; }

/** Three.js scene with exactly one InstancedMesh per celestial body type. */
export class UniverseRenderer {
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly controls: OrbitControls;
  private readonly scene = new THREE.Scene();
  private readonly groups = new Map<CelestialType, MeshGroup>();
  readonly bodyToInstance: BodyLookup[];
  private readonly characteristics: readonly RenderCharacteristics[];
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchColor = new THREE.Color();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly starLights: Array<{ body: number; light: THREE.PointLight }> = [];
  private readonly starBodies: number[];
  private readonly starCoronaGeometry: THREE.BufferGeometry;
  private readonly cometBodies: number[];
  private readonly cometHistory: Float32Array;
  private readonly cometTailGeometry: THREE.BufferGeometry;
  private readonly cometComaGeometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private velocities: Float32Array;
  private baseScales: Float32Array;
  private baseBrightness: Float32Array;
  private selected = -1;
  private hovered = -1;

  // Orbit path visualization for selected body
  private orbitLine: THREE.Line | null = null;
  private orbitPoints: THREE.Points | null = null;
  private orbitTrail: THREE.Line | null = null;
  private orbitTrailPositions: Float32Array | null = null;
  private orbitTrailWriteHead = 0;
  private orbitTrailFilled = 0;

  // Keyboard navigation state
  private readonly keysDown = new Set<string>();

  // Camera smooth navigation/zoom transition
  private cameraAnimation: {
    targetIndex: number;
    startTime: number;
    duration: number;
    startCamPos: THREE.Vector3;
    startControlsTarget: THREE.Vector3;
  } | null = null;

  // Per-moon always-visible orbit rings, updated each frame to follow the parent planet
  private readonly moonOrbitRings: Array<{ moonIndex: number; parentIndex: number; radius: number; line: THREE.LineLoop }> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly universe: Universe,
    characteristics: readonly RenderCharacteristics[],
    initialPositions: Float32Array,
    initialVelocities: Float32Array,
    private readonly hostIndices: Int32Array,
    private readonly masses: Float32Array,
  ) {
    this.characteristics = characteristics;
    this.positions = initialPositions;
    this.velocities = initialVelocities;
    this.baseScales = Float32Array.from(characteristics.map((value) => value.scale));
    this.baseBrightness = Float32Array.from(characteristics.map((value) => value.brightness));

    this.starBodies = universe.nodes.reduce<number[]>((out, node, index) => {
      if (node.celestialType === "star") out.push(index);
      return out;
    }, []);
    this.starCoronaGeometry = new THREE.BufferGeometry();
    this.starCoronaGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.starBodies.length * 3), 3));
    this.starCoronaGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.starBodies.length * 3), 3));

    this.cometBodies = universe.nodes.reduce<number[]>((out, node, index) => {
      if (node.celestialType === "comet") out.push(index);
      return out;
    }, []);
    this.cometHistory = new Float32Array(this.cometBodies.length * COMET_TRAIL_POINTS * 3);
    this.cometTailGeometry = new THREE.BufferGeometry();
    this.cometTailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.cometBodies.length * (COMET_TRAIL_POINTS - 1) * 2 * 3), 3));
    this.cometComaGeometry = new THREE.BufferGeometry();
    this.cometComaGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.cometBodies.length * 3), 3));

    this.scene.background = new THREE.Color(0x04060f);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4_000);
    this.camera.position.set(0, 140, 360);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom tuned to bloom luminous stars, comets, and orbit lines while keeping planet colors saturated
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.4, 0.58));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 3_000;
    this.controls.zoomSpeed = 1.2;
    this.controls.rotateSpeed = 0.7;
    this.controls.panSpeed = 0.8;
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.target.set(0, 0, 0);

    this.bodyToInstance = new Array(universe.nodes.length);
    this.createMeshes();
    this.createStarCorona();
    this.createCometEffects();
    this.createMoonOrbitRings();
    this.createStarfield();
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  setState(positions: Float32Array, velocities: Float32Array): void {
    this.positions = positions;
    this.velocities = velocities;
    this.updateCometEffects();
    this.updateMoonOrbitRings();
    this.updateStarCorona();
  }

  setStatic(scales: Float32Array, brightness?: Float32Array): void {
    if (scales.length === this.baseScales.length) this.baseScales = scales;
    if (brightness && brightness.length === this.baseBrightness.length) {
      this.baseBrightness = brightness;
      for (const { body, light } of this.starLights) light.intensity = this.baseBrightness[body]! * 2.5;
    }
  }

  setSelected(index: number, autoZoom = true): void {
    if (this.selected !== index) {
      this.selected = index;
      this.initOrbitPath();
    }
    if (autoZoom) {
      this.navigateToBody(index);
    }
  }

  focusSelected(): void {
    if (this.selected >= 0) {
      this.navigateToBody(this.selected);
    }
  }

  navigateToBody(index: number, duration = 650): void {
    if (index < 0 || index >= this.universe.nodes.length) return;
    this.cameraAnimation = {
      targetIndex: index,
      startTime: performance.now(),
      duration,
      startCamPos: this.camera.position.clone(),
      startControlsTarget: this.controls.target.clone(),
    };
  }

  setHovered(index: number): void { this.hovered = index; }

  /** Deselect currently selected body and clear all orbit line visualizations. */
  deselect(): void {
    this.selected = -1;
    this.cameraAnimation = null;
    this.clearOrbitPath();
  }

  /** CPU sphere picking works for hidden/far bodies too, using true simulation positions. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let closest = -1;
    let closestDistance = Infinity;
    for (let body = 0; body < this.universe.nodes.length; body++) {
      const offset = body * 3;
      this.scratchPosition.set(this.positions[offset]!, this.positions[offset + 1]!, this.positions[offset + 2]!);
      const type = this.universe.nodes[body]!.celestialType!;
      const radius = type === "comet"
        ? this.cometPickRadius(this.scratchPosition)
        : Math.max(0.45, this.baseScales[body]! * 1.5);
      const distance = this.raycaster.ray.distanceSqToPoint(this.scratchPosition);
      if (distance <= radius * radius) {
        const alongRay = this.scratchPosition.sub(this.raycaster.ray.origin).dot(this.raycaster.ray.direction);
        if (alongRay > 0 && alongRay < closestDistance) { closest = body; closestDistance = alongRay; }
      }
    }
    return closest >= 0 ? closest : null;
  }

  render(): RenderCounts {
    this.applyKeyboardNavigation();
    if (this.cameraAnimation) {
      const now = performance.now();
      const progress = Math.min(1, (now - this.cameraAnimation.startTime) / this.cameraAnimation.duration);
      const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const targetIdx = this.cameraAnimation.targetIndex;
      const to = targetIdx * 3;
      const currentBodyPos = new THREE.Vector3(this.positions[to]!, this.positions[to + 1]!, this.positions[to + 2]!);
      const scale = this.baseScales[targetIdx] ?? 1.5;
      const viewDist = Math.max(16, scale * 10 + 12);
      const dir = new THREE.Vector3().subVectors(this.cameraAnimation.startCamPos, currentBodyPos);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0.4, 1);
      dir.normalize();
      if (dir.y < 0.25) { dir.y = 0.35; dir.normalize(); }
      const endCamPos = currentBodyPos.clone().addScaledVector(dir, viewDist);

      this.controls.target.lerpVectors(this.cameraAnimation.startControlsTarget, currentBodyPos, ease);
      this.camera.position.lerpVectors(this.cameraAnimation.startCamPos, endCamPos, ease);
      if (progress >= 1) {
        this.cameraAnimation = null;
      }
    }
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.projection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    const writes: Record<CelestialType, number> = { star: 0, planet: 0, moon: 0, asteroid: 0, comet: 0 };
    let rendered = 0;

    for (let body = 0; body < this.universe.nodes.length; body++) {
      const offset = body * 3;
      this.scratchPosition.set(this.positions[offset]!, this.positions[offset + 1]!, this.positions[offset + 2]!);
      const distance = this.camera.position.distanceTo(this.scratchPosition);
      const type = this.universe.nodes[body]!.celestialType!;
      const group = this.groups.get(type)!;
      const near = distance < 650;
      const visible = distance < 3_500 && this.frustum.containsPoint(this.scratchPosition);
      if (!visible) { this.bodyToInstance[body] = { mesh: group.mesh, instanceIndex: -1, type }; continue; }
      const instanceIndex = writes[type]++;
      this.bodyToInstance[body] = { mesh: group.mesh, instanceIndex, type };
      let scale = this.baseScales[body]! * (near ? 1 : 0.88);
      if (body === this.selected || body === this.hovered) scale *= body === this.selected ? 1.4 : 1.18;
      this.scratchScale.setScalar(scale);
      this.scratchQuaternion.identity();
      if (type === "comet") this.scratchScale.setScalar(scale * 0.7);
      this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
      group.mesh.setMatrixAt(instanceIndex, this.scratchMatrix);

      this.scratchColor.setHex(this.characteristics[body]!.color);
      if (body === this.selected) this.scratchColor.lerp(WHITE, 0.25);
      group.mesh.setColorAt(instanceIndex, this.scratchColor);
      rendered++;
    }
    for (const type of TYPES) {
      const mesh = this.groups.get(type)!.mesh;
      mesh.count = writes[type];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const { body, light } of this.starLights) {
      const offset = body * 3;
      light.position.set(this.positions[offset]!, this.positions[offset + 1]!, this.positions[offset + 2]!);
    }

    // Update orbit lines & trail for selected body
    this.updateOrbitPath();

    this.composer.render();
    return { simulated: this.universe.nodes.length, rendered };
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.controls.dispose();
    this.clearOrbitPath();
    for (const { line } of this.moonOrbitRings) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.starCoronaGeometry.dispose();
    this.cometTailGeometry.dispose();
    this.cometComaGeometry.dispose();
    this.renderer.dispose();
    this.composer.dispose();
  }

  // ─── Orbit path visualization ───────────────────────────────────────────────

  private initOrbitPath(): void {
    this.clearOrbitPath();
    if (this.selected < 0) return;

    const baseColor = new THREE.Color(this.characteristics[this.selected]!.color);
    // Vibrant neon version of the selected body's color
    const orbitColor = baseColor.clone().offsetHSL(0, 0.15, 0.18);

    // 1. Smooth orbit loop geometry
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array((ORBIT_LOOP_SEGMENTS + 1) * 3), 3));
    const lineMaterial = new THREE.LineBasicMaterial({
      color: orbitColor,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.orbitLine = new THREE.Line(lineGeom, lineMaterial);
    this.orbitLine.frustumCulled = false;

    // 2. Dotted glowing beads along the orbit loop for high visibility
    const pointsGeom = new THREE.BufferGeometry();
    pointsGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array((ORBIT_LOOP_SEGMENTS / 2 + 1) * 3), 3));
    const pointsMaterial = new THREE.PointsMaterial({
      color: orbitColor,
      map: circularPointTexture(),
      size: 3.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.orbitPoints = new THREE.Points(pointsGeom, pointsMaterial);
    this.orbitPoints.frustumCulled = false;

    // 3. Dynamic active motion trail
    const TRAIL_LENGTH = 160;
    this.orbitTrailPositions = new Float32Array(TRAIL_LENGTH * 3);
    this.orbitTrailWriteHead = 0;
    this.orbitTrailFilled = 0;
    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_LENGTH * 3), 3));
    const trailColors = new Float32Array(TRAIL_LENGTH * 4);
    trailGeom.setAttribute("color", new THREE.BufferAttribute(trailColors, 4));
    trailGeom.setDrawRange(0, 0);
    const trailMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.orbitTrail = new THREE.Line(trailGeom, trailMaterial);
    this.orbitTrail.frustumCulled = false;

    this.scene.add(this.orbitLine, this.orbitPoints, this.orbitTrail);
    this.updateOrbitPath();
  }

  private clearOrbitPath(): void {
    if (this.orbitLine) {
      this.scene.remove(this.orbitLine);
      this.orbitLine.geometry.dispose();
      (this.orbitLine.material as THREE.Material).dispose();
      this.orbitLine = null;
    }
    if (this.orbitPoints) {
      this.scene.remove(this.orbitPoints);
      this.orbitPoints.geometry.dispose();
      (this.orbitPoints.material as THREE.Material).dispose();
      this.orbitPoints = null;
    }
    if (this.orbitTrail) {
      this.scene.remove(this.orbitTrail);
      this.orbitTrail.geometry.dispose();
      (this.orbitTrail.material as THREE.Material).dispose();
      this.orbitTrail = null;
    }
    this.orbitTrailPositions = null;
    this.orbitTrailWriteHead = 0;
    this.orbitTrailFilled = 0;
  }

  private updateOrbitPath(): void {
    if (this.selected < 0 || !this.orbitLine) return;
    const body = this.selected;
    const bOffset = body * 3;
    const bx = this.positions[bOffset]!;
    const by = this.positions[bOffset + 1]!;
    const bz = this.positions[bOffset + 2]!;

    const type = this.universe.nodes[body]!.celestialType;
    let parentX = 0, parentY = 0, parentZ = 0;
    let parentVx = 0, parentVy = 0, parentVz = 0;
    let parentIndex = -1;

    if (type === "star") {
      // Star orbits the galactic core (0, 0, 0)
      parentX = 0; parentY = 0; parentZ = 0;
    } else if (type === "moon") {
      // Moon orbits its declared parent planet
      const pId = this.universe.nodes[body]!.parentId;
      let pIdx = pId ? this.universe.nodes.findIndex((n) => n.id === pId) : -1;
      if (pIdx < 0) pIdx = this.findNearestHost(body, false);
      if (pIdx >= 0) {
        parentIndex = pIdx;
        const po = pIdx * 3;
        parentX = this.positions[po]!; parentY = this.positions[po + 1]!; parentZ = this.positions[po + 2]!;
        parentVx = this.velocities[po]!; parentVy = this.velocities[po + 1]!; parentVz = this.velocities[po + 2]!;
      }
    } else if (type === "comet") {
      // A comet's host is assigned by deterministic initial conditions, which
      // need not be the closest star after the N-body simulation advances.
      const hostIndex = this.hostIndices[body] ?? -1;
      if (hostIndex >= 0 && this.universe.nodes[hostIndex]?.celestialType === "star") {
        parentIndex = hostIndex;
        const so = hostIndex * 3;
        parentX = this.positions[so]!; parentY = this.positions[so + 1]!; parentZ = this.positions[so + 2]!;
        parentVx = this.velocities[so]!; parentVy = this.velocities[so + 1]!; parentVz = this.velocities[so + 2]!;
      } else {
        const starIdx = this.findNearestStar(body);
        if (starIdx >= 0) {
          parentIndex = starIdx;
          const so = starIdx * 3;
          parentX = this.positions[so]!; parentY = this.positions[so + 1]!; parentZ = this.positions[so + 2]!;
          parentVx = this.velocities[so]!; parentVy = this.velocities[so + 1]!; parentVz = this.velocities[so + 2]!;
        }
      }
    } else {
      // Planet and asteroid orbit their nearest host star.
      const starIdx = this.findNearestStar(body);
      if (starIdx >= 0) {
        parentIndex = starIdx;
        const so = starIdx * 3;
        parentX = this.positions[so]!; parentY = this.positions[so + 1]!; parentZ = this.positions[so + 2]!;
        parentVx = this.velocities[so]!; parentVy = this.velocities[so + 1]!; parentVz = this.velocities[so + 2]!;
      }
    }

    // Relative position vector
    const rx = bx - parentX;
    const ry = by - parentY;
    const rz = bz - parentZ;
    const radius = Math.hypot(rx, ry, rz);
    if (radius > 1e-3) {
      // Unit vector u1 along current position
      const u1x = rx / radius, u1y = ry / radius, u1z = rz / radius;

      // Relative velocity
      const vx = this.velocities[bOffset]! - parentVx;
      const vy = this.velocities[bOffset + 1]! - parentVy;
      const vz = this.velocities[bOffset + 2]! - parentVz;

      // Angular momentum normal h = r x v
      let hx = ry * vz - rz * vy;
      let hy = rz * vx - rx * vz;
      let hz = rx * vy - ry * vx;
      let hLen = Math.hypot(hx, hy, hz);
      if (hLen < 1e-4) {
        hx = 0; hy = 1; hz = 0;
        hLen = 1;
      } else {
        hx /= hLen; hy /= hLen; hz /= hLen;
      }

      // Unit vector u2 in orbital plane (perpendicular to u1)
      let u2x = hy * u1z - hz * u1y;
      let u2y = hz * u1x - hx * u1z;
      let u2z = hx * u1y - hy * u1x;
      const u2Len = Math.hypot(u2x, u2y, u2z) || 1;
      u2x /= u2Len; u2y /= u2Len; u2z /= u2Len;

      const lineAttr = this.orbitLine.geometry.getAttribute("position") as THREE.BufferAttribute;
      const lineArray = lineAttr.array as Float32Array;
      const pointsAttr = this.orbitPoints?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      const pointsArray = pointsAttr?.array as Float32Array | undefined;
      const pointCount = type === "comet"
        ? this.writeCometOrbitPath(parentIndex, parentX, parentY, parentZ, rx, ry, rz, vx, vy, vz, lineArray, pointsArray)
        : this.writeCircularOrbitPath(parentX, parentY, parentZ, radius, u1x, u1y, u1z, u2x, u2y, u2z, lineArray, pointsArray);

      lineAttr.needsUpdate = true;
      this.orbitLine.geometry.setDrawRange(0, pointCount);
      if (pointsAttr) {
        pointsAttr.needsUpdate = true;
        this.orbitPoints!.geometry.setDrawRange(0, Math.ceil(pointCount / 2));
      }
    }

    // Update active motion trail
    if (this.orbitTrail && this.orbitTrailPositions) {
      const TRAIL_LEN = this.orbitTrailPositions.length / 3;
      const head = this.orbitTrailWriteHead;
      this.orbitTrailPositions[head * 3] = bx;
      this.orbitTrailPositions[head * 3 + 1] = by;
      this.orbitTrailPositions[head * 3 + 2] = bz;
      this.orbitTrailWriteHead = (head + 1) % TRAIL_LEN;
      if (this.orbitTrailFilled < TRAIL_LEN) this.orbitTrailFilled++;

      const trailAttr = this.orbitTrail.geometry.getAttribute("position") as THREE.BufferAttribute;
      const trailColors = this.orbitTrail.geometry.getAttribute("color") as THREE.BufferAttribute;
      const destPos = trailAttr.array as Float32Array;
      const destCol = trailColors.array as Float32Array;
      const filled = this.orbitTrailFilled;
      const start = filled < TRAIL_LEN ? 0 : this.orbitTrailWriteHead;

      const baseCol = new THREE.Color(this.characteristics[body]!.color);

      for (let i = 0; i < filled; i++) {
        const src = ((start + i) % TRAIL_LEN) * 3;
        const d = i * 3;
        const d4 = i * 4;
        destPos[d] = this.orbitTrailPositions[src]!;
        destPos[d + 1] = this.orbitTrailPositions[src + 1]!;
        destPos[d + 2] = this.orbitTrailPositions[src + 2]!;
        const alpha = Math.pow(i / Math.max(1, filled - 1), 1.5);
        destCol[d4] = baseCol.r;
        destCol[d4 + 1] = baseCol.g;
        destCol[d4 + 2] = baseCol.b;
        destCol[d4 + 3] = alpha;
      }
      trailAttr.needsUpdate = true;
      trailColors.needsUpdate = true;
      this.orbitTrail.geometry.setDrawRange(0, filled);
    }
  }

  /** Draw an osculating two-body conic around the comet's actual assigned host. */
  private writeCometOrbitPath(
    parent: number,
    parentX: number,
    parentY: number,
    parentZ: number,
    rx: number,
    ry: number,
    rz: number,
    vx: number,
    vy: number,
    vz: number,
    line: Float32Array,
    points: Float32Array | undefined,
  ): number {
    const radius = Math.hypot(rx, ry, rz);
    const hx = ry * vz - rz * vy;
    const hy = rz * vx - rx * vz;
    const hz = rx * vy - ry * vx;
    const angularMomentumSq = hx * hx + hy * hy + hz * hz;
    const parentMass = parent >= 0 ? this.masses[parent]! : 1;
    const mu = SIMULATION.gravitationalConstant * parentMass;
    if (radius < 1e-4 || angularMomentumSq < 1e-8 || mu <= 0) {
      return 0;
    }

    const inverseRadius = 1 / radius;
    const eccentricityX = (vy * hz - vz * hy) / mu - rx * inverseRadius;
    const eccentricityY = (vz * hx - vx * hz) / mu - ry * inverseRadius;
    const eccentricityZ = (vx * hy - vy * hx) / mu - rz * inverseRadius;
    const eccentricity = Math.hypot(eccentricityX, eccentricityY, eccentricityZ);
    const hLength = Math.sqrt(angularMomentumSq);
    const normalX = hx / hLength, normalY = hy / hLength, normalZ = hz / hLength;
    const periX = eccentricity > 1e-4 ? eccentricityX / eccentricity : rx * inverseRadius;
    const periY = eccentricity > 1e-4 ? eccentricityY / eccentricity : ry * inverseRadius;
    const periZ = eccentricity > 1e-4 ? eccentricityZ / eccentricity : rz * inverseRadius;
    const tangentX = normalY * periZ - normalZ * periY;
    const tangentY = normalZ * periX - normalX * periZ;
    const tangentZ = normalX * periY - normalY * periX;
    const semiLatusRectum = angularMomentumSq / mu;
    const closed = eccentricity < 0.995;
    const pointCount = closed ? ORBIT_LOOP_SEGMENTS + 1 : ORBIT_LOOP_SEGMENTS;
    const limit = closed ? Math.PI : Math.acos(Math.max(-1, -1 / eccentricity)) - 0.04;

    for (let index = 0; index < pointCount; index++) {
      const fraction = index / (pointCount - 1);
      const anomaly = closed ? -Math.PI + fraction * Math.PI * 2 : -limit + fraction * limit * 2;
      const orbitalRadius = semiLatusRectum / (1 + eccentricity * Math.cos(anomaly));
      const cos = Math.cos(anomaly), sin = Math.sin(anomaly);
      const offset = index * 3;
      line[offset] = parentX + orbitalRadius * (periX * cos + tangentX * sin);
      line[offset + 1] = parentY + orbitalRadius * (periY * cos + tangentY * sin);
      line[offset + 2] = parentZ + orbitalRadius * (periZ * cos + tangentZ * sin);
      if (points && index % 2 === 0) {
        const pointOffset = (index / 2) * 3;
        points[pointOffset] = line[offset]!;
        points[pointOffset + 1] = line[offset + 1]!;
        points[pointOffset + 2] = line[offset + 2]!;
      }
    }
    return pointCount;
  }

  private writeCircularOrbitPath(
    parentX: number, parentY: number, parentZ: number, radius: number,
    u1x: number, u1y: number, u1z: number, u2x: number, u2y: number, u2z: number,
    line: Float32Array, points: Float32Array | undefined,
  ): number {
    for (let index = 0; index <= ORBIT_LOOP_SEGMENTS; index++) {
      const angle = index / ORBIT_LOOP_SEGMENTS * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const offset = index * 3;
      line[offset] = parentX + (u1x * cos + u2x * sin) * radius;
      line[offset + 1] = parentY + (u1y * cos + u2y * sin) * radius;
      line[offset + 2] = parentZ + (u1z * cos + u2z * sin) * radius;
      if (points && index % 2 === 0) {
        const pointOffset = (index / 2) * 3;
        points[pointOffset] = line[offset]!;
        points[pointOffset + 1] = line[offset + 1]!;
        points[pointOffset + 2] = line[offset + 2]!;
      }
    }
    return ORBIT_LOOP_SEGMENTS + 1;
  }

  /** Invisible comet-only pick radius: at least 16 CSS pixels without changing its mesh. */
  private cometPickRadius(position: THREE.Vector3): number {
    const distance = this.camera.position.distanceTo(position);
    const visibleHeight = 2 * distance * Math.tan(this.camera.fov * Math.PI / 360);
    const worldRadiusForPixels = visibleHeight * COMET_PICK_RADIUS_PX / Math.max(1, this.canvas.clientHeight);
    return Math.max(2.5, worldRadiusForPixels);
  }

  private findNearestStar(body: number): number {
    const bo = body * 3;
    const bx = this.positions[bo]!, by = this.positions[bo + 1]!, bz = this.positions[bo + 2]!;
    let closest = -1;
    let closestDistSq = Infinity;
    for (const starIndex of this.starBodies) {
      if (starIndex === body) continue;
      const so = starIndex * 3;
      const dx = bx - this.positions[so]!;
      const dy = by - this.positions[so + 1]!;
      const dz = bz - this.positions[so + 2]!;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closest = starIndex;
      }
    }
    return closest;
  }

  private findNearestHost(body: number, starsOnly: boolean): number {
    const bo = body * 3;
    const bx = this.positions[bo]!, by = this.positions[bo + 1]!, bz = this.positions[bo + 2]!;
    let closest = -1;
    let closestDistSq = Infinity;
    for (let i = 0; i < this.universe.nodes.length; i++) {
      if (i === body) continue;
      const t = this.universe.nodes[i]!.celestialType;
      if (starsOnly && t !== "star") continue;
      if (!starsOnly && t !== "planet" && t !== "star") continue;
      const io = i * 3;
      const dx = bx - this.positions[io]!;
      const dy = by - this.positions[io + 1]!;
      const dz = bz - this.positions[io + 2]!;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closest = i;
      }
    }
    return closest;
  }

  // ─── Keyboard navigation ─────────────────────────────────────────────────────

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      event.preventDefault();
    }
    this.keysDown.add(key);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.key.toLowerCase());
  };

  private applyKeyboardNavigation(): void {
    if (this.keysDown.size === 0) return;
    const fast = this.keysDown.has("shift");
    const speed = fast ? 3.5 : 1.0;
    const dist = this.camera.position.length();
    const moveSpeed = Math.max(0.6, dist * 0.025) * speed;
    const zoomSpeed = Math.max(0.6, dist * 0.03) * speed;

    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    this.camera.getWorldDirection(forward);
    right.crossVectors(forward, up).normalize();

    const delta = new THREE.Vector3();

    // WASD: Camera movement (move camera, but the angle of rotation of the camera stays)
    if (this.keysDown.has("w")) delta.addScaledVector(forward, moveSpeed);
    if (this.keysDown.has("s")) delta.addScaledVector(forward, -moveSpeed);
    if (this.keysDown.has("a")) delta.addScaledVector(right, -moveSpeed);
    if (this.keysDown.has("d")) delta.addScaledVector(right, moveSpeed);
    if (this.keysDown.has("q") || this.keysDown.has("pageup")) {
      const dir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position).normalize();
      delta.addScaledVector(dir, zoomSpeed);
    }
    if (this.keysDown.has("e") || this.keysDown.has("pagedown")) {
      const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
      delta.addScaledVector(dir, zoomSpeed);
    }

    if (delta.lengthSq() > 0) {
      if (this.cameraAnimation) this.cameraAnimation = null;
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }

    // Arrow keys: Camera rotation (move the angle of rotation / look around, but the pos should stay the same)
    const rotSpeed = fast ? 0.045 : 0.02;
    let yaw = 0;
    let pitch = 0;
    if (this.keysDown.has("arrowleft")) yaw += rotSpeed;
    if (this.keysDown.has("arrowright")) yaw -= rotSpeed;
    if (this.keysDown.has("arrowup")) pitch += rotSpeed;
    if (this.keysDown.has("arrowdown")) pitch -= rotSpeed;

    if (yaw !== 0 || pitch !== 0) {
      if (this.cameraAnimation) this.cameraAnimation = null;
      const lookDir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
      const lookDist = Math.max(1, lookDir.length());
      lookDir.normalize();

      if (yaw !== 0) {
        lookDir.applyAxisAngle(up, yaw);
      }
      if (pitch !== 0) {
        const rightAxis = new THREE.Vector3().crossVectors(lookDir, up).normalize();
        const currentPitch = Math.asin(Math.max(-1, Math.min(1, lookDir.y)));
        const newPitch = Math.max(-1.45, Math.min(1.45, currentPitch + pitch));
        lookDir.applyAxisAngle(rightAxis, newPitch - currentPitch);
      }

      this.controls.target.copy(this.camera.position).addScaledVector(lookDir, lookDist);
    }
  }

  // ─── Meshes & Materials ──────────────────────────────────────────────────────

  private createMeshes(): void {
    for (const type of TYPES) {
      const members = this.universe.nodes.reduce<number[]>((out, node, index) => {
        if (node.celestialType === type) out.push(index);
        return out;
      }, []);
      const geometry = type === "asteroid" || type === "comet"
        ? new THREE.IcosahedronGeometry(1, type === "comet" ? 1 : 0)
        : new THREE.SphereGeometry(1, type === "star" ? 18 : 12, type === "star" ? 12 : 8);

      // All celestial bodies use MeshBasicMaterial with instance colors so they are
      // always vividly visible and never fail WebGL uniform limits or shadow dropouts.
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
      });

      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, members.length));
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, members.length) * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.groups.set(type, { mesh, type });
      this.scene.add(mesh);

      if (type === "star") {
        // Cap point lights to top 4 core stars so WebGL fragment uniform limits are never exceeded
        for (const body of members.slice(0, 4)) {
          const light = new THREE.PointLight(this.characteristics[body]!.color, this.characteristics[body]!.brightness * 2.5, 200, 1.4);
          this.starLights.push({ body, light });
          this.scene.add(light);
        }
      }
    }

    // Clean neutral ambient fill so colors are rich and legible from all angles
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.82));
  }

  /** Luminous corona aura for each star, matching its exact celestial color. */
  private createStarCorona(): void {
    if (this.starBodies.length === 0) return;
    const colors = this.starCoronaGeometry.getAttribute("color").array as Float32Array;
    for (let i = 0; i < this.starBodies.length; i++) {
      const color = new THREE.Color(this.characteristics[this.starBodies[i]!]!.color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    this.starCoronaGeometry.getAttribute("color").needsUpdate = true;
    const corona = new THREE.Points(this.starCoronaGeometry, new THREE.PointsMaterial({
      vertexColors: true,
      map: circularPointTexture(),
      size: 16.0,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    corona.frustumCulled = false;
    this.scene.add(corona);
    this.updateStarCorona();
  }

  private updateStarCorona(): void {
    if (this.starBodies.length === 0) return;
    const positions = this.starCoronaGeometry.getAttribute("position").array as Float32Array;
    for (let i = 0; i < this.starBodies.length; i++) {
      const body = this.starBodies[i]!;
      const offset = body * 3;
      positions[i * 3] = this.positions[offset]!;
      positions[i * 3 + 1] = this.positions[offset + 1]!;
      positions[i * 3 + 2] = this.positions[offset + 2]!;
    }
    this.starCoronaGeometry.getAttribute("position").needsUpdate = true;
  }

  /** One shared trail and coma system: comet nuclei remain the fifth InstancedMesh. */
  private createCometEffects(): void {
    if (this.cometBodies.length === 0) return;
    const tailPositions = this.cometTailGeometry.getAttribute("position").array as Float32Array;
    const tailColors = new Float32Array(tailPositions.length);
    const comaColors = new Float32Array(this.cometBodies.length * 3);
    let vertex = 0;
    for (let comet = 0; comet < this.cometBodies.length; comet++) {
      const color = new THREE.Color(this.characteristics[this.cometBodies[comet]!]!.color);
      comaColors[comet * 3] = color.r;
      comaColors[comet * 3 + 1] = color.g;
      comaColors[comet * 3 + 2] = color.b;
      for (let segment = 0; segment < COMET_TRAIL_POINTS - 1; segment++) {
        const intensity = 0.22 + (1 - segment / (COMET_TRAIL_POINTS - 1)) * 0.78;
        for (let endpoint = 0; endpoint < 2; endpoint++, vertex++) {
          const offset = vertex * 3;
          tailColors[offset] = color.r * intensity;
          tailColors[offset + 1] = color.g * intensity;
          tailColors[offset + 2] = color.b * intensity;
        }
      }
    }
    this.cometTailGeometry.setAttribute("color", new THREE.BufferAttribute(tailColors, 3));
    this.cometComaGeometry.setAttribute("color", new THREE.BufferAttribute(comaColors, 3));
    const tails = new THREE.LineSegments(this.cometTailGeometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const coma = new THREE.Points(this.cometComaGeometry, new THREE.PointsMaterial({
      color: 0xffffff, vertexColors: true, map: circularPointTexture(), transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, size: 7.5, sizeAttenuation: true,
    }));
    tails.frustumCulled = false;
    coma.frustumCulled = false;
    this.scene.add(tails, coma);
    this.updateCometEffects(true);
  }

  private updateCometEffects(seed = false): void {
    if (this.cometBodies.length === 0) return;
    const tailPositions = this.cometTailGeometry.getAttribute("position").array as Float32Array;
    const comaPositions = this.cometComaGeometry.getAttribute("position").array as Float32Array;
    let tailVertex = 0;
    for (let comet = 0; comet < this.cometBodies.length; comet++) {
      const body = this.cometBodies[comet]!;
      const source = body * 3;
      const history = comet * COMET_TRAIL_POINTS * 3;
      const x = this.positions[source]!, y = this.positions[source + 1]!, z = this.positions[source + 2]!;
      if (seed) {
        for (let point = 0; point < COMET_TRAIL_POINTS; point++) {
          const offset = history + point * 3;
          const elapsed = point * 0.035;
          this.cometHistory[offset] = x - this.velocities[source]! * elapsed;
          this.cometHistory[offset + 1] = y - this.velocities[source + 1]! * elapsed;
          this.cometHistory[offset + 2] = z - this.velocities[source + 2]! * elapsed;
        }
      } else {
        for (let point = COMET_TRAIL_POINTS - 1; point > 0; point--) {
          const destination = history + point * 3;
          const previous = destination - 3;
          this.cometHistory[destination] = this.cometHistory[previous]!;
          this.cometHistory[destination + 1] = this.cometHistory[previous + 1]!;
          this.cometHistory[destination + 2] = this.cometHistory[previous + 2]!;
        }
        this.cometHistory[history] = x;
        this.cometHistory[history + 1] = y;
        this.cometHistory[history + 2] = z;
      }
      comaPositions[comet * 3] = x;
      comaPositions[comet * 3 + 1] = y;
      comaPositions[comet * 3 + 2] = z;
      for (let segment = 0; segment < COMET_TRAIL_POINTS - 1; segment++) {
        for (let endpoint = 0; endpoint < 2; endpoint++, tailVertex++) {
          const point = segment + endpoint;
          const stored = history + point * 3;
          const destination = tailVertex * 3;
          tailPositions[destination] = x + (this.cometHistory[stored]! - x) * COMET_TRAIL_STRETCH;
          tailPositions[destination + 1] = y + (this.cometHistory[stored + 1]! - y) * COMET_TRAIL_STRETCH;
          tailPositions[destination + 2] = z + (this.cometHistory[stored + 2]! - z) * COMET_TRAIL_STRETCH;
        }
      }
    }
    this.cometTailGeometry.getAttribute("position").needsUpdate = true;
    this.cometComaGeometry.getAttribute("position").needsUpdate = true;
  }

  /** Build a colored orbit ring for every moon in the scene. Each ring uses
   *  the moon's render color so moons of the same planet look visually distinct. */
  private createMoonOrbitRings(): void {
    const RING_SEGS = 60;
    for (let moonIndex = 0; moonIndex < this.universe.nodes.length; moonIndex++) {
      const node = this.universe.nodes[moonIndex]!;
      if (node.celestialType !== "moon") continue;
      const parentId = node.parentId;
      const parentIndex = parentId ? this.universe.nodes.findIndex((n) => n.id === parentId) : -1;
      if (parentIndex < 0) continue;

      // Each moon's orbit ring uses the moon's own unique color, brightened slightly
      const baseColor = new THREE.Color(this.characteristics[moonIndex]!.color);
      const ringColor = baseColor.clone().offsetHSL(0, 0.12, 0.14);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RING_SEGS * 3), 3));
      const mat = new THREE.LineBasicMaterial({
        color: ringColor,
        transparent: true,
        opacity: 0.40,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.LineLoop(geom, mat);
      line.frustumCulled = false;
      this.scene.add(line);

      // Compute orbital radius from current initial positions
      const mo = moonIndex * 3;
      const po = parentIndex * 3;
      const dx = this.positions[mo]! - this.positions[po]!;
      const dy = this.positions[mo + 1]! - this.positions[po + 1]!;
      const dz = this.positions[mo + 2]! - this.positions[po + 2]!;
      const radius = Math.hypot(dx, dy, dz) || 5;

      this.moonOrbitRings.push({ moonIndex, parentIndex, radius, line });
    }
    // Initial geometry fill
    this.updateMoonOrbitRings();
  }

  /** Each frame: reposition every moon orbit ring to follow its parent planet,
   *  recompute the orbital plane from live positions, and hide rings that are
   *  too far from the camera to be meaningful. */
  private updateMoonOrbitRings(): void {
    const RING_SEGS = 60;
    const CAM_NEAR_THRESHOLD_SQ = 400 * 400;
    for (const ring of this.moonOrbitRings) {
      const { moonIndex, parentIndex, line } = ring;
      const po = parentIndex * 3;
      const mo = moonIndex * 3;

      const px = this.positions[po]!, py = this.positions[po + 1]!, pz = this.positions[po + 2]!;

      // Compute orbital plane normal from relative position and relative velocity
      let rx = this.positions[mo]! - px;
      let ry = this.positions[mo + 1]! - py;
      let rz = this.positions[mo + 2]! - pz;
      const rLen = Math.hypot(rx, ry, rz) || 1;
      // Update stored radius with a smooth drift toward current separation
      ring.radius = ring.radius * 0.96 + rLen * 0.04;
      const radius = ring.radius;
      rx /= rLen; ry /= rLen; rz /= rLen;

      const vx = this.velocities[mo]! - this.velocities[po]!;
      const vy = this.velocities[mo + 1]! - this.velocities[po + 1]!;
      const vz = this.velocities[mo + 2]! - this.velocities[po + 2]!;
      // h = r × v  (angular momentum normal)
      let hx = ry * vz - rz * vy;
      let hy = rz * vx - rx * vz;
      let hz = rx * vy - ry * vx;
      const hLen = Math.hypot(hx, hy, hz) || 1;
      hx /= hLen; hy /= hLen; hz /= hLen;
      // u2 perpendicular to u1 in orbital plane
      let u2x = hy * rz - hz * ry;
      let u2y = hz * rx - hx * rz;
      let u2z = hx * ry - hy * rx;
      const u2Len = Math.hypot(u2x, u2y, u2z) || 1;
      u2x /= u2Len; u2y /= u2Len; u2z /= u2Len;

      // Show/hide based on camera proximity (avoid clutter for distant systems)
      const cdx = this.camera.position.x - px;
      const cdy = this.camera.position.y - py;
      const cdz = this.camera.position.z - pz;
      const camDistSq = cdx * cdx + cdy * cdy + cdz * cdz;
      (line.material as THREE.LineBasicMaterial).opacity = camDistSq < CAM_NEAR_THRESHOLD_SQ ? 0.40 : 0.0;

      const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < RING_SEGS; i++) {
        const angle = (i / RING_SEGS) * Math.PI * 2;
        const cosA = Math.cos(angle), sinA = Math.sin(angle);
        const d = i * 3;
        arr[d] = px + (rx * cosA + u2x * sinA) * radius;
        arr[d + 1] = py + (ry * cosA + u2y * sinA) * radius;
        arr[d + 2] = pz + (rz * cosA + u2z * sinA) * radius;
      }
      attr.needsUpdate = true;
    }
  }

  private createStarfield(): void {
    let state = 0xdecafbad;
    const random = () => { state = Math.imul(state ^ (state >>> 15), state | 1); return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296; };
    const positions = new Float32Array(720 * 3);
    const colors = new Float32Array(720 * 3);
    for (let index = 0; index < positions.length; index += 3) {
      const z = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const radius = 320 + random() * 380;
      const horizontal = Math.sqrt(1 - z * z);
      positions[index] = Math.cos(angle) * horizontal * radius;
      positions[index + 1] = z * radius;
      positions[index + 2] = Math.sin(angle) * horizontal * radius;
      const warm = random();
      colors[index] = 0.82 + warm * 0.18;
      colors[index + 1] = 0.85 + random() * 0.15;
      colors[index + 2] = 0.88 + (1 - warm) * 0.12;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      vertexColors: true, map: circularPointTexture(), transparent: true, opacity: 0.72,
      alphaTest: 0.04, depthWrite: false, size: 1.25, sizeAttenuation: true,
    })));
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  };
}

function circularPointTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.18, "rgba(255,255,255,0.95)");
  glow.addColorStop(0.48, "rgba(210,224,255,0.32)");
  glow.addColorStop(1, "rgba(210,224,255,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
