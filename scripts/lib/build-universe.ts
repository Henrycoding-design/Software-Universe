import type { Universe, UniverseNode } from "../../shared/universe-types.ts";
import type { CrawlGraph } from "./crawler.ts";
import type { RawMetrics } from "../../shared/universe-types.ts";

/** Assemble the normalized Universe JSON (graph + raw metrics). physics/celestialType stay null for later stages. */
export function buildUniverse(
  graph: CrawlGraph,
  metrics: Map<string, RawMetrics>,
  meta: { generatedAt: string; maxNodes: number; fetchDependents: boolean },
): Universe {
  const targets = new Map<string, string[]>();
  for (const [s, t] of graph.edges) {
    if (!targets.has(s)) targets.set(s, []);
    targets.get(s)!.push(t);
  }

  // Deterministic order: seeds first, then everything else, each alphabetical by id.
  const ordered = [...graph.nodes].sort((a, b) => Number(b.isSeed) - Number(a.isSeed) || a.id.localeCompare(b.id));

  const nodes: UniverseNode[] = ordered.map((n) => ({
    id: n.id,
    name: n.name,
    version: n.version,
    ecosystem: n.system,
    isSeed: n.isSeed,
    dependencies: (targets.get(n.id) ?? []).slice().sort(),
    raw: metrics.get(n.id)!,
    physics: null,
    celestialType: null,
  }));

  const edges = [...graph.edges]
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    .map(([source, target]) => ({ source, target, type: "dependency" as const }));

  return {
    meta: {
      schemaVersion: 1,
      generatedAt: meta.generatedAt,
      source: "deps.dev-v3",
      seedCount: nodes.filter((n) => n.isSeed).length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      prunedNodeCount: graph.prunedNodeCount,
      options: { maxNodes: meta.maxNodes, fetchDependents: meta.fetchDependents },
    },
    nodes,
    edges,
  };
}
