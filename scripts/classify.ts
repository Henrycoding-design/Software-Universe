/** Phase 3: assign stable celestial types after physics derivation. */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { Universe } from "../shared/universe-types.ts";
import { classifyUniverse, countTypes, type ClassifierThresholds } from "./lib/classifier.ts";

const { values } = parseArgs({ options: { input: { type: "string", default: "public/data/universe.json" }, config: { type: "string", default: "config/universe.config.json" } } });
const [rawUniverse, rawConfig] = await Promise.all([readFile(values.input!, "utf8"), readFile(values.config!, "utf8")]);
const universe = JSON.parse(rawUniverse) as Universe;
const thresholds = (JSON.parse(rawConfig) as { thresholds: ClassifierThresholds }).thresholds;
classifyUniverse(universe, thresholds);
await writeFile(values.input!, JSON.stringify(universe, null, 2) + "\n");
const count = countTypes(universe.nodes);
const starPercent = universe.nodes.length === 0 ? 0 : (100 * count.star / universe.nodes.length);
console.log(`[classify] wrote ${universe.nodes.length} nodes to ${values.input!}`);
console.log(`[classify] star=${count.star} comet=${count.comet} planet=${count.planet} moon=${count.moon} asteroid=${count.asteroid}`);
if (starPercent < 3 || starPercent > 10) {
  console.warn(`[classify] stars are ${starPercent.toFixed(1)}% (target roughly 3-10%). Tune thresholds.star in config/universe.config.json; no rule was changed.`);
}
