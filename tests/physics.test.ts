import { describe, expect, it } from "vitest";
import { resolveNonOverlappingCollisions, velocityVerletStep, totalMomentum } from "../src/physics/integrator.ts";
import { BarnesHutOctree, bruteForceAccelerations } from "../src/physics/octree.ts";

function randomState(count: number): { positions: Float32Array; masses: Float32Array } {
  let seed = 0x12345678;
  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  const positions = new Float32Array(count * 3);
  const masses = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    positions[index * 3] = random() * 20 - 10;
    positions[index * 3 + 1] = random() * 20 - 10;
    positions[index * 3 + 2] = random() * 20 - 10;
    masses[index] = 0.5 + random() * 2;
  }
  return { positions, masses };
}

function meanRelativeError(actual: Float32Array, expected: Float32Array): number {
  let total = 0;
  for (let offset = 0; offset < actual.length; offset += 3) {
    const dx = actual[offset]! - expected[offset]!;
    const dy = actual[offset + 1]! - expected[offset + 1]!;
    const dz = actual[offset + 2]! - expected[offset + 2]!;
    total += Math.hypot(dx, dy, dz) / Math.max(1e-8, Math.hypot(expected[offset]!, expected[offset + 1]!, expected[offset + 2]!));
  }
  return total / (actual.length / 3);
}

describe("Barnes-Hut physics", () => {
  it("is within a few percent of brute force at theta=0.5 and converges as theta decreases", () => {
    const { positions, masses } = randomState(48);
    const exact = new Float32Array(positions.length);
    bruteForceAccelerations(positions, masses, exact, { softening: 0.4, gravitationalConstant: 1.5 });
    const approximate = new Float32Array(positions.length);
    const tree = new BarnesHutOctree(masses.length, { theta: 0.5, softening: 0.4, gravitationalConstant: 1.5 });
    tree.build(positions, masses); tree.accelerations(approximate);
    const fine = new Float32Array(positions.length);
    const fineTree = new BarnesHutOctree(masses.length, { theta: 0.05, softening: 0.4, gravitationalConstant: 1.5 });
    fineTree.build(positions, masses); fineTree.accelerations(fine);
    expect(meanRelativeError(approximate, exact)).toBeLessThan(0.05);
    expect(meanRelativeError(fine, exact)).toBeLessThan(meanRelativeError(approximate, exact));
  });

  it("keeps a two-body circular orbit within tolerance", () => {
    const masses = new Float32Array([10, 10]);
    const positions = new Float32Array([-10, 0, 0, 10, 0, 0]);
    const velocities = new Float32Array([0, -Math.sqrt(0.5), 0, 0, Math.sqrt(0.5), 0]);
    const accelerations = new Float32Array(6);
    const tree = new BarnesHutOctree(2, { theta: 0.5, softening: 0, gravitationalConstant: 2 });
    const initialDistance = 20;
    for (let step = 0; step < 2_000; step++) {
      velocityVerletStep({ positions, velocities, accelerations, count: 2 }, 1 / 120, (p, out) => {
        tree.build(p, masses); tree.accelerations(out);
      });
    }
    const distance = Math.hypot(positions[3]! - positions[0]!, positions[4]! - positions[1]!, positions[5]! - positions[2]!);
    expect(Math.abs(distance - initialDistance) / initialDistance).toBeLessThan(0.03);
  });

  it("approximately conserves total momentum", () => {
    const { positions, masses } = randomState(12);
    const velocities = new Float32Array(positions.length);
    const accelerations = new Float32Array(positions.length);
    const tree = new BarnesHutOctree(masses.length, { theta: 0.01, softening: 0.3, gravitationalConstant: 1 });
    const before = totalMomentum(velocities, masses);
    for (let step = 0; step < 200; step++) velocityVerletStep({ positions, velocities, accelerations, count: masses.length }, 1 / 120, (p, out) => {
      tree.build(p, masses); tree.accelerations(out);
    });
    const after = totalMomentum(velocities, masses);
    expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeLessThan(1e-3);
  });

  it("separates overlapping bodies and sends approaching bodies apart", () => {
    const positions = new Float32Array([0, 0, 0, 0.5, 0, 0]);
    const velocities = new Float32Array([1, 0, 0, -1, 0, 0]);
    const masses = new Float32Array([1, 1]);
    const radii = new Float32Array([1, 1]);
    resolveNonOverlappingCollisions(positions, velocities, masses, radii, 0.28, 2);
    expect(Math.hypot(positions[3]! - positions[0]!)).toBeGreaterThanOrEqual(2);
    expect(velocities[3]! - velocities[0]!).toBeGreaterThan(0);
  });
});
