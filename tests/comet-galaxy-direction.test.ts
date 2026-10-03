import { describe, expect, it } from "vitest";
import { createInitialState, type InitialBody } from "../src/physics/initial-conditions.ts";
import { SIMULATION } from "../src/physics/constants.ts";

const comet = (id: string): InitialBody => ({ id, type: "comet", activity: 0.5, mass: 1, parentIndex: -1 });
const star = (id: string, mass: number): InitialBody => ({ id, type: "star", activity: 0.2, mass, parentIndex: -1 });

function galaxyLy(positions: Float32Array, velocities: Float32Array, index: number): number {
  const offset = index * 3;
  return positions[offset]! * velocities[offset + 2]! - positions[offset + 2]! * velocities[offset]!;
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

function cometDirection(id: string): 1 | -1 {
  return mulberry32(hash(`${SIMULATION.initialSeed}:comet-direction:${id}`))() < 0.5 ? -1 : 1;
}

describe("comet galaxy-frame direction", () => {
  it("creates a substantial population orbiting against the galaxy's rotation", () => {
    const bodies = [
      star("core", 30), star("host-a", 20), star("host-b", 16), star("host-c", 12),
      ...Array.from({ length: 128 }, (_, index) => comet(`comet-${index}`)),
    ];
    const { positions, velocities } = createInitialState(bodies);
    const directions = bodies.slice(4).map((_, index) => Math.sign(galaxyLy(positions, velocities, index + 4)));
    const prograde = directions.filter((direction) => direction > 0).length;
    const retrograde = directions.filter((direction) => direction < 0).length;

    expect(prograde).toBeGreaterThan(24);
    expect(retrograde).toBeGreaterThan(24);
    const stars = bodies.slice(0, 4).map((body, index) => ({ body, index }))
      .sort((first, second) => second.body.mass - first.body.mass || first.body.id.localeCompare(second.body.id));
    for (let index = 4; index < bodies.length; index++) {
      const node = bodies[index]!;
      const host = stars[hash(`${SIMULATION.initialSeed}:host:${node.id}`) % stars.length]!.index;
      const hostSign = Math.sign(galaxyLy(positions, velocities, host)) || 1;
      expect(Math.sign(galaxyLy(positions, velocities, index))).toBe(hostSign * cometDirection(node.id));
    }
  });
});
