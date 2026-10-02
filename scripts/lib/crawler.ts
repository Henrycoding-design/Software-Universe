import type { System } from "../../shared/universe-types.ts";
import type { DepsDevClient } from "./depsdev-client.ts";

export interface SeedPackage {
  system: System;
  name: string;
  version?: string;
}

export interface CrawlNode {
  id: string;
  system: System;
  name: string;
  version: string;
  isSeed: boolean;
}

export interface CrawlGraph {
  nodes: CrawlNode[];
  /** Deduplicated [source, target] id pairs; source depends on target. */
  edges: Array<[string, string]>;
  /** Pre-pruning graph stats, keyed by node id. */
  stats: Map<string, { outDegree: number; inDegree: number; transitive: number }>;
  prunedNodeCount: number;
}

export const nodeId = (system: string, name: string, version: string) => `${system}:${name}@${version}`;

export interface CrawlOptions {
  maxNodes: number;
  log?: (msg: string) => void;
}

/** Pick the version to use for a package: pinned > deps.dev default > newest by publishedAt. */
export async function resolveVersion(client: DepsDevClient, seed: SeedPackage): Promise<string | null> {
  if (seed.version) return seed.version;
  const pkg = await client.getPackage(seed.system, seed.name);
  const versions = pkg?.versions ?? [];
  if (versions.length === 0) return null;
  const def = versions.find((v) => v.isDefault);
  if (def) return def.versionKey.version;
  const newest = [...versions]
    .filter((v) => v.publishedAt)
    .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!))[0];
  return (newest ?? versions[versions.length - 1]!).versionKey.version;
}

/**
 * For each seed: resolve a version, fetch its RESOLVED dependency graph (GetDependencies,
 * already transitive), and merge everything into ONE graph keyed by `system:name@version`.
 * A -> C and B -> C therefore yield a single C node with two incoming edges.
 *
 * If the merged graph exceeds maxNodes, seeds are always kept and the remaining slots go to
 * the most widely shared dependencies (highest in-degree).
 */
export async function crawl(client: DepsDevClient, seeds: SeedPackage[], opts: CrawlOptions): Promise<CrawlGraph> {
  const log = opts.log ?? (() => {});
  const nodes = new Map<string, CrawlNode>();
  const edgeSet = new Set<string>();
  const seedIds = new Set<string>();

  const results = await Promise.all(
    seeds.map(async (seed, i) => {
      try {
        const version = await resolveVersion(client, seed);
        if (!version) {
          log(`  [skip] ${seed.system}:${seed.name} - not found on deps.dev`);
          return null;
        }
        const deps = await client.getDependencies(seed.system, seed.name, version);
        log(`  [${String(i + 1).padStart(3)}/${seeds.length}] ${seed.system}:${seed.name}@${version}` +
          ` -> ${deps?.nodes?.length ?? 0} resolved nodes`);
        return { seed, version, deps };
      } catch (err) {
        log(`  [warn] ${seed.system}:${seed.name} failed: ${(err as Error).message}`);
        return null;
      }
    }),
  );

  for (const r of results) {
    if (!r) continue;
    const rootId = nodeId(r.seed.system, r.seed.name, r.version);
    seedIds.add(rootId);
    nodes.set(rootId, { id: rootId, system: r.seed.system, name: r.seed.name, version: r.version, isSeed: true });

    const resolved = r.deps?.nodes ?? [];
    if (r.deps?.error) log(`  [warn] ${rootId}: ${r.deps.error}`);
    const idxToId = resolved.map((n) => nodeId(r.seed.system, n.versionKey.name, n.versionKey.version));
    resolved.forEach((n, i) => {
      const id = idxToId[i]!;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          system: r.seed.system,
          name: n.versionKey.name,
          version: n.versionKey.version,
          isSeed: seedIds.has(id),
        });
      }
    });
    for (const e of r.deps?.edges ?? []) {
      const from = idxToId[e.fromNode ?? 0];
      const to = idxToId[e.toNode ?? 0];
      if (from && to && from !== to) edgeSet.add(`${from}\t${to}`);
    }
  }
  // A seed may also have been discovered as someone else's dependency before being processed.
  for (const id of seedIds) nodes.get(id)!.isSeed = true;

  const allEdges = [...edgeSet].map((k) => k.split("\t") as [string, string]);
  const stats = computeStats([...nodes.keys()], allEdges);

  // ---- prune ---------------------------------------------------------------
  let kept = [...nodes.values()];
  if (kept.length > opts.maxNodes) {
    const seedsKept = kept.filter((n) => n.isSeed);
    const slots = Math.max(0, opts.maxNodes - seedsKept.length);
    const others = kept
      .filter((n) => !n.isSeed)
      .sort((a, b) => stats.get(b.id)!.inDegree - stats.get(a.id)!.inDegree || a.id.localeCompare(b.id))
      .slice(0, slots);
    kept = [...seedsKept, ...others];
  }
  const keptIds = new Set(kept.map((n) => n.id));
  const edges = allEdges.filter(([s, t]) => keptIds.has(s) && keptIds.has(t));

  return { nodes: kept, edges, stats, prunedNodeCount: nodes.size - kept.length };
}

function computeStats(ids: string[], edges: Array<[string, string]>) {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const inDeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [s, t] of edges) {
    out.get(s)!.push(t);
    inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
  }
  const stats = new Map<string, { outDegree: number; inDegree: number; transitive: number }>();
  for (const id of ids) {
    // Iterative DFS for transitive closure size (cycle-safe).
    const seen = new Set<string>([id]);
    const stack = [...out.get(id)!];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nxt of out.get(cur) ?? []) if (!seen.has(nxt)) stack.push(nxt);
    }
    stats.set(id, { outDegree: out.get(id)!.length, inDegree: inDeg.get(id)!, transitive: seen.size - 1 });
  }
  return stats;
}
