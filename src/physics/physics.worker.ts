/// <reference lib="webworker" />
import { SIMULATION } from "./constants.ts";
import { resolveNonOverlappingCollisions, velocityVerletStep } from "./integrator.ts";
import { BarnesHutOctree } from "./octree.ts";
import type { PhysicsWorkerRequest, PhysicsWorkerResponse } from "./worker-protocol.ts";

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let positions: Float32Array | null = null;
let velocities: Float32Array | null = null;
let accelerations: Float32Array | null = null;
let masses: Float32Array | null = null;
let collisionRadii: Float32Array | null = null;
let tree: BarnesHutOctree | null = null;
let paused = false;
let timeScale = 1;
let accumulator = 0;
let lastTime = 0;
let totalSteps = 0;
const available: Array<{ positions: ArrayBuffer; velocities: ArrayBuffer }> = [];

function emit(message: PhysicsWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function computeAccelerations(nextPositions: Float32Array, out: Float32Array): void {
  if (!tree || !masses) return;
  tree.build(nextPositions, masses);
  tree.accelerations(out);
}

function resolveCollisions(nextPositions: Float32Array, nextVelocities: Float32Array): void {
  if (!masses || !collisionRadii) return;
  resolveNonOverlappingCollisions(
    nextPositions,
    nextVelocities,
    masses,
    collisionRadii,
    SIMULATION.collisionRestitution,
    SIMULATION.collisionPasses,
    SIMULATION.collisionPadding,
  );
}

function tick(now: number): void {
  if (!positions || !velocities || !accelerations || !masses || !tree) return;
  if (!lastTime) lastTime = now;
  const elapsed = Math.min(250, now - lastTime) / 1000;
  lastTime = now;
  if (!paused) {
    accumulator += elapsed * timeScale;
    let steps = 0;
    while (accumulator >= SIMULATION.fixedDt && steps < SIMULATION.maxStepsPerTick) {
      velocityVerletStep({ positions, velocities, accelerations, count: masses.length }, SIMULATION.fixedDt, computeAccelerations, resolveCollisions);
      accumulator -= SIMULATION.fixedDt;
      steps++;
      totalSteps++;
    }
    if (steps === SIMULATION.maxStepsPerTick) accumulator = Math.min(accumulator, SIMULATION.fixedDt);
    if (steps > 0) publish(steps);
  }
}

function publish(steps: number): void {
  if (!positions || !velocities) return;
  const output = available.pop();
  if (!output) return;
  new Float32Array(output.positions).set(positions);
  new Float32Array(output.velocities).set(velocities);
  emit({ kind: "state", positions: output.positions, velocities: output.velocities, steps }, [output.positions, output.velocities]);
}

scope.onmessage = (event: MessageEvent<PhysicsWorkerRequest>) => {
  const message = event.data;
  try {
    switch (message.kind) {
      case "init": {
        positions = new Float32Array(message.positions);
        velocities = new Float32Array(message.velocities);
        masses = new Float32Array(message.masses);
        // Parent indices are part of the protocol and initial-condition trace;
        // gravity itself is intentionally parent-agnostic after initialization.
        void new Int32Array(message.parentIndices);
        const types = new Uint8Array(message.types);
        collisionRadii = collisionRadiiFor(types, masses);
        accelerations = new Float32Array(positions.length);
        tree = new BarnesHutOctree(masses.length, {
          theta: SIMULATION.theta,
          softening: SIMULATION.softening,
          gravitationalConstant: SIMULATION.gravitationalConstant,
        });
        const byteLength = positions.byteLength;
        available.length = 0;
        available.push({ positions: new ArrayBuffer(byteLength), velocities: new ArrayBuffer(byteLength) });
        available.push({ positions: new ArrayBuffer(byteLength), velocities: new ArrayBuffer(byteLength) });
        accumulator = 0;
        lastTime = performance.now();
        totalSteps = 0;
        emit({ kind: "initialized", scales: message.scales, brightness: message.brightness, types: message.types }, [message.scales, message.brightness, message.types]);
        publish(0);
        break;
      }
      case "pause": paused = true; break;
      case "resume": paused = false; lastTime = performance.now(); break;
      case "setTimeScale": timeScale = Math.min(4, Math.max(0.1, message.value)); break;
      case "recycle":
        available.push({ positions: message.positions, velocities: message.velocities });
        break;
    }
  } catch (error) {
    emit({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

setInterval(() => tick(performance.now()), 1000 / 60);

/** Physics-only body radii, intentionally unrelated to renderer scale. */
function collisionRadiiFor(types: Uint8Array, bodyMasses: Float32Array): Float32Array {
  const radii = new Float32Array(types.length);
  for (let index = 0; index < types.length; index++) {
    const base = types[index] === 0 ? 2.8 : types[index] === 1 ? 1.45 : types[index] === 2 ? 0.7 : types[index] === 3 ? 0.45 : 0.8;
    radii[index] = base * (0.88 + Math.cbrt(bodyMasses[index]!) * 0.12);
  }
  return radii;
}
