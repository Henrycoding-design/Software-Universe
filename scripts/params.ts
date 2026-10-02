/** Phase 2: derive normalized physics parameters from the collected universe. */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { Universe } from "../shared/universe-types.ts";
import { applyPhysics } from "./lib/physics-params.ts";

const { values } = parseArgs({ options: { input: { type: "string", default: "public/data/universe.json" } } });
const path = values.input!;
const universe = JSON.parse(await readFile(path, "utf8")) as Universe;
applyPhysics(universe, (message) => console.error(message));
await writeFile(path, JSON.stringify(universe, null, 2) + "\n");

const buckets = new Array<number>(10).fill(0);
for (const node of universe.nodes) {
  const p = node.physics!;
  buckets[Math.min(9, Math.floor(p.centrality * 10))]!++;
}
console.log(`[params] wrote ${universe.nodes.length} nodes to ${path}`);
console.log(`[params] centrality histogram (0.0-1.0): ${buckets.join(" ")}`);
