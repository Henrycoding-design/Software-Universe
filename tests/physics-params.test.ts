import { describe, expect, it } from "vitest";
import type { Universe, UniverseNode } from "../shared/universe-types.ts";
import { ageValues, derivePhysics, pageRankTowardDependencies, percentileNormalize } from "../scripts/lib/physics-params.ts";

function node(id: string, overrides: Partial<UniverseNode["raw"]> = {}): UniverseNode {
  return {
    id, name: id, version: "1.0.0", ecosystem: "npm", isSeed: false, dependencies: [],
    raw: {
      firstPublishedAt: "2020-01-01T00:00:00.000Z", versionPublishedAt: null, latestPublishedAt: null,
      versionCount: 1, stableVersionCount: 1, releasesLast90d: 0, releasesLast365d: 0,
      prereleasesLast365d: 0, directDependencyCount: 0, transitiveDependencyCount: 0,
      crawlDependentCount: 0, dependentCount: null, licenses: [], advisoryCount: 0, ...overrides,
    }, physics: null, celestialType: null,
  };
}

describe("physics parameter derivation", () => {
  it("normalizes tied values deterministically", () => {
    expect(percentileNormalize([2, 2, 8])).toEqual([0.25, 0.25, 1]);
  });

  it("sends PageRank importance toward dependencies and handles a cycle", () => {
    const ids = ["app", "library", "cycle-a", "cycle-b", "isolated"];
    const ranks = pageRankTowardDependencies(ids, [
      { source: "app", target: "library", type: "dependency" },
      { source: "cycle-a", target: "cycle-b", type: "dependency" },
      { source: "cycle-b", target: "cycle-a", type: "dependency" },
    ]);
    expect(ranks[1]).toBeGreaterThan(ranks[0]!);
    expect(ranks.every((rank) => Number.isFinite(rank) && rank >= 0 && rank <= 1)).toBe(true);
  });

  it("uses neutral age for missing dates and retains all four normalized values", () => {
    const nodes = [node("old", { firstPublishedAt: "2010-01-01T00:00:00.000Z", dependentCount: 100 }), node("unknown", { firstPublishedAt: null, releasesLast365d: 10, releasesLast90d: 2 })];
    expect(ageValues(nodes, "2025-01-01T00:00:00.000Z", () => {})).toEqual([0, 0.5]);
    const universe: Universe = {
      meta: { schemaVersion: 1, generatedAt: "2025-01-01T00:00:00.000Z", source: "deps.dev-v3", seedCount: 0, nodeCount: 2, edgeCount: 1, prunedNodeCount: 0, options: { maxNodes: 2, fetchDependents: false } },
      nodes, edges: [{ source: "unknown", target: "old", type: "dependency" }],
    };
    for (const physics of derivePhysics(universe, () => {})) {
      expect(Object.values(physics).every((value) => value >= 0 && value <= 1)).toBe(true);
    }
  });
});
