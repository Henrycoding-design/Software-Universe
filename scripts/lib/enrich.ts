import type { RawMetrics, System } from "../../shared/universe-types.ts";
import type { CrawlGraph, CrawlNode } from "./crawler.ts";
import type { DepsDevClient, PackageResponse } from "./depsdev-client.ts";
import { isPrerelease } from "./versions.ts";

const DAY_MS = 86_400_000;

/** Fetch package + version metadata for every kept node and derive RAW metrics (no normalization here). */
export async function enrich(
  client: DepsDevClient,
  graph: CrawlGraph,
  opts: { fetchDependents: boolean; now: Date; log?: (m: string) => void },
): Promise<Map<string, RawMetrics>> {
  const log = opts.log ?? (() => {});
  const out = new Map<string, RawMetrics>();
  let done = 0;

  await Promise.all(
    graph.nodes.map(async (node) => {
      try {
        out.set(node.id, await metricsFor(client, graph, node, opts));
      } catch (err) {
        log(`  [warn] metadata failed for ${node.id}: ${(err as Error).message}`);
        out.set(node.id, emptyMetrics(graph, node));
      }
      done++;
      if (done % 25 === 0 || done === graph.nodes.length) log(`  metadata ${done}/${graph.nodes.length}`);
    }),
  );
  return out;
}

async function metricsFor(
  client: DepsDevClient,
  graph: CrawlGraph,
  node: CrawlNode,
  opts: { fetchDependents: boolean; now: Date },
): Promise<RawMetrics> {
  const [pkg, ver, dependents] = await Promise.all([
    client.getPackage(node.system, node.name),
    client.getVersion(node.system, node.name, node.version),
    opts.fetchDependents
      ? client.getDependents(node.system, node.name, node.version).catch(() => null)
      : Promise.resolve(null),
  ]);

  const releases = publishInfo(node.system, pkg);
  const now = opts.now.getTime();
  const count = (stable: boolean, days: number) =>
    releases.filter((r) => r.stable === stable && r.t <= now && now - r.t <= days * DAY_MS).length;
  const allTimes = releases.map((r) => r.t);
  const s = graph.stats.get(node.id)!;

  return {
    // Age uses ALL versions: the first publish is the first publish, stable or not.
    firstPublishedAt: allTimes.length ? new Date(Math.min(...allTimes)).toISOString() : null,
    versionPublishedAt: ver?.publishedAt ?? null,
    latestPublishedAt: allTimes.length ? new Date(Math.max(...allTimes)).toISOString() : null,
    versionCount: pkg?.versions?.length ?? 0,
    stableVersionCount: (pkg?.versions ?? []).filter((v) => !isPrerelease(node.system, v.versionKey.version)).length,
    releasesLast90d: count(true, 90),
    releasesLast365d: count(true, 365),
    prereleasesLast365d: count(false, 365),
    directDependencyCount: s.outDegree,
    transitiveDependencyCount: s.transitive,
    crawlDependentCount: s.inDegree,
    dependentCount: dependents?.dependentCount != null ? Number(dependents.dependentCount) : null,
    licenses: ver?.licenses ?? [],
    advisoryCount: ver?.advisoryKeys?.length ?? 0,
  };
}

function emptyMetrics(graph: CrawlGraph, node: CrawlNode): RawMetrics {
  const s = graph.stats.get(node.id)!;
  return {
    firstPublishedAt: null,
    versionPublishedAt: null,
    latestPublishedAt: null,
    versionCount: 0,
    stableVersionCount: 0,
    releasesLast90d: 0,
    releasesLast365d: 0,
    prereleasesLast365d: 0,
    directDependencyCount: s.outDegree,
    transitiveDependencyCount: s.transitive,
    crawlDependentCount: s.inDegree,
    dependentCount: null,
    licenses: [],
    advisoryCount: 0,
  };
}

function publishInfo(system: System, pkg: PackageResponse | null): Array<{ t: number; stable: boolean }> {
  return (pkg?.versions ?? [])
    .filter((v) => v.publishedAt && Number.isFinite(Date.parse(v.publishedAt)))
    .map((v) => ({ t: Date.parse(v.publishedAt!), stable: !isPrerelease(system, v.versionKey.version) }));
}