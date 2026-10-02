/**
 * Universe JSON schema (v1). Shared by the preprocessing pipeline (Node)
 * and the runtime (worker + renderer).
 *
 * Layering rule: raw software metrics are ALWAYS retained next to derived
 * values so formulas can change without re-downloading anything.
 */

export type System = "npm" | "pypi" | "cargo" | "maven" | "go" | "nuget";

export type CelestialType = "star" | "planet" | "moon" | "asteroid" | "comet";

export interface RawMetrics {
  /** Earliest publishedAt across all versions of the package (ISO 8601). */
  firstPublishedAt: string | null;
  /** publishedAt of the resolved version in this universe. */
  versionPublishedAt: string | null;
  /** Latest publishedAt across all versions. */
  latestPublishedAt: string | null;
  versionCount: number;
  /** Versions excluding pre-releases (canary, nightly, rc, dev, SNAPSHOT...). */
  stableVersionCount: number;
  /** STABLE releases only, trailing windows measured at `meta.generatedAt`. */
  releasesLast90d: number;
  releasesLast365d: number;
  /** Pre-release publishes in the trailing 365 days (kept raw so the filter can be revisited). */
  prereleasesLast365d: number;
  /** Direct dependencies of this version (out-degree in the resolved graph). */
  directDependencyCount: number;
  /** Everything reachable from this node (transitive closure size). */
  transitiveDependencyCount: number;
  /** Distinct packages in the crawl that depend on this node (pre-pruning in-degree). */
  crawlDependentCount: number;
  /** Global dependents from deps.dev v3alpha. null unless fetchDependents was enabled / available. */
  dependentCount: number | null;
  licenses: string[];
  advisoryCount: number;
}

/** All values normalized to [0, 1]. Filled by the physics-parameter step (not by the collector). */
export interface PhysicsParams {
  mass: number;
  activity: number;
  age: number;
  centrality: number;
}

export interface UniverseNode {
  /** `${system}:${name}@${version}` - ecosystem-prefixed to avoid cross-ecosystem name collisions. */
  id: string;
  name: string;
  version: string;
  ecosystem: System;
  /** True for the ~100 seed packages; false for transitive nodes pulled in by the crawl. */
  isSeed: boolean;
  /** Target node ids (outgoing edges). Convenience mirror of `edges`. */
  dependencies: string[];
  raw: RawMetrics;
  /** null until compute-physics runs. */
  physics: PhysicsParams | null;
  /** null until the classifier runs. */
  celestialType: CelestialType | null;
  /**
   * The id of the most massive qualifying star/planet parent when this body is
   * classified as a moon. Absent for every other celestial type.
   */
  parentId?: string;
}

export interface UniverseEdge {
  /** source depends on target. */
  source: string;
  target: string;
  type: "dependency";
}

export interface UniverseMeta {
  schemaVersion: 1;
  generatedAt: string;
  source: "deps.dev-v3";
  seedCount: number;
  nodeCount: number;
  edgeCount: number;
  /** Nodes dropped by the maxNodes cap (so you know the graph was pruned). */
  prunedNodeCount: number;
  options: { maxNodes: number; fetchDependents: boolean };
}

export interface Universe {
  meta: UniverseMeta;
  nodes: UniverseNode[];
  edges: UniverseEdge[];
}
