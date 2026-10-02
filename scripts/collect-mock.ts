/**
 * Offline smoke test: stubs global fetch with a tiny fake deps.dev so the whole
 * collector can be exercised without network access.   npm run collect:mock
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCollect } from "./lib/run-collect.ts";

const vk = (name: string, version = "1.0.0") => ({ system: "NPM", name, version });
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

// a -> c, b -> c, c -> d   (c must be ONE node with two incoming edges)
const graphs: Record<string, { names: string[]; edges: Array<[number, number]> }> = {
  a: { names: ["a", "c", "d"], edges: [[0, 1], [1, 2]] },
  b: { names: ["b", "c", "d"], edges: [[0, 1], [1, 2]] },
};

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const m = url.pathname.match(/^\/v3(?:alpha)?\/systems\/npm\/packages\/([^/]+)(?:\/versions\/([^/:]+)(:\w+)?)?$/);
  if (!m) return json({}, 404);
  const name = decodeURIComponent(m[1]!);
  if (!m[2]) {
    return json({
      packageKey: { system: "NPM", name },
      versions: [
        { versionKey: vk(name, "0.9.0"), publishedAt: iso(900) },
        { versionKey: vk(name), publishedAt: iso(20), isDefault: true },
      ],
    });
  }
  if (m[3] === ":dependencies") {
    const g = graphs[name];
    if (!g) return json({ nodes: [{ versionKey: vk(name), relation: "SELF" }], edges: [] });
    return json({
      nodes: g.names.map((n, i) => ({ versionKey: vk(n), relation: i === 0 ? "SELF" : "DIRECT" })),
      edges: g.edges.map(([fromNode, toNode]) => ({ fromNode, toNode })),
    });
  }
  if (m[3] === ":dependents") return json({ dependentCount: "1234" });
  return json({ versionKey: vk(name), publishedAt: iso(20), licenses: ["MIT"], advisoryKeys: [] });
}) as typeof fetch;

const dir = await mkdtemp(join(tmpdir(), "su-"));
await writeFile(
  join(dir, "seeds.json"),
  JSON.stringify({ packages: [{ system: "npm", name: "a" }, { system: "npm", name: "b" }] }),
);
const u = await runCollect({
  seedPath: join(dir, "seeds.json"),
  outPath: join(dir, "universe.json"),
  rawDir: join(dir, "raw"),
  maxNodes: 10,
  concurrency: 4,
  fetchDependents: true,
  refresh: true,
});
console.log(JSON.stringify({ meta: u.meta, edges: u.edges, c: u.nodes.find((n) => n.name === "c") }, null, 2));
