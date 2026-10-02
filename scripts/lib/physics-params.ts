import type { PhysicsParams, Universe, UniverseEdge, UniverseNode } from "../../shared/universe-types.ts";

/**
 * Convert a non-negative metric into a robust [0, 1] percentile rank. Tied
 * values receive their average rank, keeping results independent of node order.
 */
export function percentileNormalize(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const finite = values.map((value) => (Number.isFinite(value) ? value : 0));
  const sorted = [...finite].sort((a, b) => a - b);
  const rank = new Map<number, number>();
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end] === sorted[start]) end++;
    rank.set(sorted[start]!, (start + end - 1) / 2);
    start = end;
  }
  const denominator = Math.max(1, finite.length - 1);
  return finite.map((value) => rank.get(value)! / denominator);
}

/**
 * Mass models package influence: global dependent count when available,
 * otherwise the crawl's in-degree. log1p tempers very popular packages and a
 * percentile rank makes the classifier resilient to long-tail outliers.
 */
export function massValues(nodes: readonly UniverseNode[]): number[] {
  return percentileNormalize(nodes.map((node) => Math.log1p(Math.max(0, node.raw.dependentCount ?? node.raw.crawlDependentCount))));
}

/**
 * Activity models stable release cadence. Recent (90-day) releases receive an
 * extra unit of weight before log scaling, then values are percentile ranked.
 */
export function activityValues(nodes: readonly UniverseNode[]): number[] {
  return percentileNormalize(nodes.map((node) => {
    const releases365 = Math.max(0, node.raw.releasesLast365d);
    const releases90 = Math.max(0, node.raw.releasesLast90d);
    return Math.log1p(releases365 + releases90);
  }));
}

/**
 * Age is elapsed years since first publish, normalized among known dates.
 * Missing or invalid dates deliberately get the neutral 0.5 value.
 */
export function ageValues(nodes: readonly UniverseNode[], generatedAt: string, warn: (message: string) => void = console.warn): number[] {
  const now = Date.parse(generatedAt);
  const raw = nodes.map((node) => {
    const then = node.raw.firstPublishedAt ? Date.parse(node.raw.firstPublishedAt) : Number.NaN;
    return Number.isFinite(then) && Number.isFinite(now) ? Math.max(0, (now - then) / (365.25 * 86_400_000)) : null;
  });
  const known = raw.filter((value): value is number => value !== null);
  const normalizedKnown = percentileNormalize(known);
  let knownIndex = 0;
  return raw.map((value, index) => {
    if (value !== null) return normalizedKnown[knownIndex++]!;
    warn(`[params] ${nodes[index]!.id} has no valid firstPublishedAt; using neutral age=0.5`);
    return 0.5;
  });
}

/**
 * PageRank uses the dependency-flow orientation (importer -> dependency), the
 * reverse of the conventional "dependency has dependents" relation. Rank thus
 * flows toward dependencies. Dangling rank is distributed uniformly; cycles
 * converge through fixed deterministic iterations.
 */
export function pageRankTowardDependencies(
  nodeIds: readonly string[],
  edges: readonly UniverseEdge[],
  damping = 0.85,
  iterations = 80,
): number[] {
  const count = nodeIds.length;
  if (count === 0) return [];
  const byId = new Map(nodeIds.map((id, index) => [id, index]));
  const outgoing = Array.from({ length: count }, () => [] as number[]);
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source !== undefined && target !== undefined && source !== target) outgoing[source]!.push(target);
  }
  const base = (1 - damping) / count;
  let ranks = new Float64Array(count).fill(1 / count);
  for (let step = 0; step < iterations; step++) {
    const next = new Float64Array(count).fill(base);
    let dangling = 0;
    for (let source = 0; source < count; source++) {
      const targets = outgoing[source]!;
      if (targets.length === 0) dangling += ranks[source]!;
      else {
        const share = damping * ranks[source]! / targets.length;
        for (const target of targets) next[target]! += share;
      }
    }
    const danglingShare = damping * dangling / count;
    for (let index = 0; index < count; index++) next[index]! += danglingShare;
    ranks = next;
  }
  return percentileNormalize([...ranks]);
}

export function derivePhysics(universe: Universe, warn?: (message: string) => void): PhysicsParams[] {
  const ids = universe.nodes.map((node) => node.id);
  const mass = massValues(universe.nodes);
  const activity = activityValues(universe.nodes);
  const age = ageValues(universe.nodes, universe.meta.generatedAt, warn);
  const centrality = pageRankTowardDependencies(ids, universe.edges);
  return universe.nodes.map((_, index) => ({
    mass: mass[index]!,
    activity: activity[index]!,
    age: age[index]!,
    centrality: centrality[index]!,
  }));
}

/** Mutates only derived physics values; raw source metrics remain untouched. */
export function applyPhysics(universe: Universe, warn?: (message: string) => void): Universe {
  const physics = derivePhysics(universe, warn);
  universe.nodes.forEach((node, index) => { node.physics = physics[index]!; });
  return universe;
}
