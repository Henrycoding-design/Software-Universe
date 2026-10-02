import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Universe } from "../../shared/universe-types.ts";
import { buildUniverse } from "./build-universe.ts";
import { DiskCache } from "./cache.ts";
import { crawl, type SeedPackage } from "./crawler.ts";
import { DepsDevClient } from "./depsdev-client.ts";
import { enrich } from "./enrich.ts";

export interface CollectOptions {
  seedPath: string;
  outPath: string;
  rawDir: string;
  maxNodes: number;
  concurrency: number;
  fetchDependents: boolean;
  refresh: boolean;
  limit?: number;
}

export async function runCollect(o: CollectOptions): Promise<Universe> {
  const log = (m: string) => console.error(m);
  const seedFile = JSON.parse(await readFile(o.seedPath, "utf8")) as { packages: SeedPackage[] };
  const seeds = o.limit ? seedFile.packages.slice(0, o.limit) : seedFile.packages;

  const client = new DepsDevClient({ cache: new DiskCache(o.rawDir, { refresh: o.refresh }), concurrency: o.concurrency });
  const now = new Date();

  log(`1/3 Crawling resolved dependency graphs for ${seeds.length} seeds...`);
  const graph = await crawl(client, seeds, { maxNodes: o.maxNodes, log });
  log(`    merged graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges (${graph.prunedNodeCount} pruned)`);

  log(`2/3 Fetching package metadata...`);
  const metrics = await enrich(client, graph, { fetchDependents: o.fetchDependents, now, log });

  log(`3/3 Writing ${o.outPath}`);
  const universe = buildUniverse(graph, metrics, {
    generatedAt: now.toISOString(),
    maxNodes: o.maxNodes,
    fetchDependents: o.fetchDependents,
  });
  await mkdir(dirname(o.outPath), { recursive: true });
  await writeFile(o.outPath, JSON.stringify(universe, null, 2));
  log(`done. ${client.requestCount} HTTP requests, ${client.cacheHits} cache hits.`);
  return universe;
}
