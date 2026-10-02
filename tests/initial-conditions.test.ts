import { describe, expect, it } from "vitest";
import { createInitialState, type InitialBody } from "../src/physics/initial-conditions.ts";

const body = (id: string, type: InitialBody["type"], mass: number, parentIndex = -1): InitialBody => ({ id, type, mass, parentIndex, activity: 0.4 });

function distance(positions: Float32Array, first: number, second: number): number {
  const a = first * 3, b = second * 3;
  return Math.hypot(positions[a]! - positions[b]!, positions[a + 1]! - positions[b + 1]!, positions[a + 2]! - positions[b + 2]!);
}

describe("galaxy initial conditions", () => {
  it("separates star systems and attaches a moon to its declared parent", () => {
    const bodies = [
      body("star-a", "star", 18), body("star-b", "star", 12), body("star-c", "star", 8),
      body("planet", "planet", 5), body("moon", "moon", 1, 3), body("belt", "asteroid", 2), body("comet", "comet", 1),
    ];
    const first = createInitialState(bodies);
    const second = createInitialState(bodies);
    expect(first.positions).toEqual(second.positions);
    expect(first.velocities).toEqual(second.velocities);
    expect(distance(first.positions, 0, 1)).toBeGreaterThan(25);
    expect(distance(first.positions, 0, 2)).toBeGreaterThan(40);
    expect(distance(first.positions, 3, 4)).toBeGreaterThanOrEqual(2.8);
    expect(distance(first.positions, 3, 4)).toBeLessThanOrEqual(6.1);
  });
});
