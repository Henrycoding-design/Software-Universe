import type { CelestialType, Universe, UniverseNode } from "../../shared/universe-types.ts";

export interface ClassifierThresholds {
  star: number;
  cometActivity: number;
  planetMass: number;
  moonParentShare: number;
}

/**
 * The first classification pass encodes the documented precedence table.
 * Moons are intentionally left as asteroids here because their relationship
 * rule requires the complete set of already-classified star/planet parents.
 */
export function primaryType(node: UniverseNode, thresholds: ClassifierThresholds): CelestialType {
  const physics = node.physics;
  if (!physics) throw new Error(`Cannot classify ${node.id}: missing physics parameters. Run npm run params first.`);
  const isPopular = Boolean(node.isSeed) || physics.centrality >= thresholds.star || physics.mass >= thresholds.star;
  if (isPopular) return "star";
  if (physics.activity >= thresholds.cometActivity) return "comet";
  if (physics.mass >= thresholds.planetMass) return "planet";
  return "asteroid";
}

/**
 * Classify in deterministic order. A moon is a low-precedence candidate which
 * is depended on by one or more star/planet nodes, and whose dependents are at
 * least the configured share of those strong parents. Its heaviest parent wins
 * ties by stable id, so repeated pipeline runs have identical parentIds.
 */
export function classifyUniverse(universe: Universe, thresholds: ClassifierThresholds): Universe {
  const ordered = [...universe.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(ordered.map((node) => [node.id, node]));
  const typeById = new Map<string, CelestialType>();
  for (const node of ordered) typeById.set(node.id, primaryType(node, thresholds));

  const dependents = new Map<string, UniverseNode[]>();
  for (const edge of universe.edges) {
    const source = byId.get(edge.source);
    if (!source || !byId.has(edge.target)) continue;
    const list = dependents.get(edge.target) ?? [];
    list.push(source);
    dependents.set(edge.target, list);
  }

  for (const node of ordered) {
    const preliminary = typeById.get(node.id)!;
    if (preliminary !== "asteroid") continue;
    const parents = (dependents.get(node.id) ?? [])
      .filter((dependent) => {
        const type = typeById.get(dependent.id);
        return type === "star" || type === "planet";
      })
      .sort((a, b) => b.physics!.mass - a.physics!.mass || a.id.localeCompare(b.id));
    const allDependents = dependents.get(node.id) ?? [];
    if (parents.length > 0 && allDependents.length > 0 && parents.length / allDependents.length >= thresholds.moonParentShare) {
      typeById.set(node.id, "moon");
      node.parentId = parents[0]!.id;
    }
  }

  for (const node of universe.nodes) {
    node.celestialType = typeById.get(node.id)!;
    if (node.celestialType !== "moon") delete node.parentId;
  }
  return universe;
}

export function countTypes(nodes: readonly UniverseNode[]): Record<CelestialType, number> {
  const count: Record<CelestialType, number> = { star: 0, comet: 0, planet: 0, moon: 0, asteroid: 0 };
  for (const node of nodes) if (node.celestialType) count[node.celestialType]++;
  return count;
}
