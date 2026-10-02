/**
 * Stage 1 of the pipeline: deps.dev v3 -> public/data/universe.json
 *
 *   npm run collect
 *   npm run collect -- --max-nodes 300 --dependents
 *   npm run collect:smoke               (5 seeds, 40 nodes)
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runCollect } from "./lib/run-collect.ts";

const cfg = JSON.parse(await readFile("config/universe.config.json", "utf8")).crawl as {
  maxNodes: number;
  concurrency: number;
  fetchDependents: boolean;
};

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "config/seed-packages.json" },
    out: { type: "string", default: "public/data/universe.json" },
    raw: { type: "string", default: "data/raw" },
    "max-nodes": { type: "string", default: String(cfg.maxNodes) },
    concurrency: { type: "string", default: String(cfg.concurrency) },
    limit: { type: "string" },
    dependents: { type: "boolean", default: cfg.fetchDependents },
    refresh: { type: "boolean", default: false },
  },
});

await runCollect({
  seedPath: values.seed!,
  outPath: values.out!,
  rawDir: values.raw!,
  maxNodes: Number(values["max-nodes"]),
  concurrency: Number(values.concurrency),
  fetchDependents: values.dependents!,
  refresh: values.refresh!,
  limit: values.limit ? Number(values.limit) : undefined,
});
