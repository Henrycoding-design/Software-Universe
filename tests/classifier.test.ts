import { describe, expect, it } from "vitest";
import type { PhysicsParams, Universe, UniverseNode } from "../shared/universe-types.ts";
import { classifyUniverse, primaryType } from "../scripts/lib/classifier.ts";

const thresholds = { star: 0.75, cometActivity: 0.8, planetMass: 0.5, moonParentShare: 0.5 };

function node(id: string, physics: Partial<PhysicsParams>): UniverseNode {
  return {
    id, name: id, version: "1", ecosystem: "npm", isSeed: false, dependencies: [],
    raw: { firstPublishedAt: null, versionPublishedAt: null, latestPublishedAt: null, versionCount: 0, stableVersionCount: 0, releasesLast90d: 0, releasesLast365d: 0, prereleasesLast365d: 0, directDependencyCount: 0, transitiveDependencyCount: 0, crawlDependentCount: 0, dependentCount: null, licenses: [], advisoryCount: 0 },
    physics: { mass: 0, activity: 0, age: 0, centrality: 0, ...physics }, celestialType: null,
  };
}

function universe(nodes: UniverseNode[], edges: Universe["edges"]): Universe {
  return { meta: { schemaVersion: 1, generatedAt: "2025-01-01", source: "deps.dev-v3", seedCount: 0, nodeCount: nodes.length, edgeCount: edges.length, prunedNodeCount: 0, options: { maxNodes: 10, fetchDependents: false } }, nodes, edges };
}

describe("celestial classifier", () => {
  it("honors star, comet, planet precedence in that order", () => {
    expect(primaryType(node("all", { centrality: 1, activity: 1, mass: 1 }), thresholds)).toBe("star");
    expect(primaryType(node("comet", { activity: 0.9, mass: 1 }), thresholds)).toBe("comet");
    expect(primaryType(node("planet", { mass: 0.5 }), thresholds)).toBe("planet");
    expect(primaryType(node("asteroid", {}), thresholds)).toBe("asteroid");
  });

  it("classifies qualifying low-precedence dependencies as moons with their heaviest parent", () => {
    const heavy = node("heavy", { mass: 0.9 });
    const light = node("light", { mass: 0.6 });
    const satellite = node("satellite", { mass: 0.1 });
    const u = universe([heavy, light, satellite], [
      { source: "heavy", target: "satellite", type: "dependency" },
      { source: "light", target: "satellite", type: "dependency" },
    ]);
    classifyUniverse(u, thresholds);
    expect(satellite.celestialType).toBe("moon");
    expect(satellite.parentId).toBe("heavy");
  });

  it("does not replace higher-precedence types with moons", () => {
    const parent = node("parent", { mass: 0.9 });
    const star = node("star", { centrality: 0.9, mass: 0.1 });
    const u = universe([parent, star], [{ source: "parent", target: "star", type: "dependency" }]);
    classifyUniverse(u, thresholds);
    expect(star.celestialType).toBe("star");
    expect(star.parentId).toBeUndefined();
  });
});
