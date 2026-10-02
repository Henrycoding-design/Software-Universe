import { describe, expect, it } from "vitest";
import { RenderCharacteristicMapper } from "../src/render/characteristics.ts";

describe("seeded render characteristics", () => {
  it("is deterministic for an id while providing varied planet colors", () => {
    const mapper = new RenderCharacteristicMapper();
    const physics = { mass: 0.5, activity: 0.4, age: 0.5, centrality: 0.3 };
    const first = mapper.map("planet", physics, "npm", "npm:alpha@1.0.0");
    expect(mapper.map("planet", physics, "npm", "npm:alpha@1.0.0")).toEqual(first);
    const colors = new Set(Array.from({ length: 10 }, (_, index) => mapper.map("planet", physics, "npm", `npm:package-${index}@1.0.0`).color));
    expect(colors.size).toBeGreaterThan(4);
  });

  it("keeps asteroids visibly darker than planets", () => {
    const mapper = new RenderCharacteristicMapper();
    const physics = { mass: 0.5, activity: 0.4, age: 0.5, centrality: 0.3 };
    expect(mapper.map("asteroid", physics, "npm", "a").brightness).toBeLessThan(mapper.map("planet", physics, "npm", "a").brightness);
  });
});
