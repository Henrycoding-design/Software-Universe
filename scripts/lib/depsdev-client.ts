import type { System } from "../../shared/universe-types.ts";
import { DiskCache } from "./cache.ts";
import { createLimiter, sleep } from "./limiter.ts";

const BASE = "https://api.deps.dev";
const USER_AGENT = "software-universe/0.1 (+deps.dev v3 collector)";
const MAX_RETRIES = 5;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// ---- Minimal response shapes (only the fields we use) ---------------------

export interface VersionKey {
  system: string;
  name: string;
  version: string;
}

export interface PackageResponse {
  packageKey: { system: string; name: string };
  versions?: Array<{
    versionKey: VersionKey;
    publishedAt?: string;
    isDefault?: boolean;
  }>;
}

export interface VersionResponse {
  versionKey: VersionKey;
  publishedAt?: string;
  isDefault?: boolean;
  licenses?: string[];
  advisoryKeys?: Array<{ id: string }>;
}

export interface DependenciesResponse {
  nodes?: Array<{
    versionKey: VersionKey;
    bundled?: boolean;
    relation?: "SELF" | "DIRECT" | "INDIRECT" | string;
    errors?: string[];
  }>;
  /** fromNode / toNode are indexes into `nodes`. */
  edges?: Array<{ fromNode?: number; toNode?: number; requirement?: string }>;
  error?: string;
}

export interface DependentsResponse {
  // int64 fields may arrive as strings in protobuf-JSON; callers coerce with Number().
  dependentCount?: number | string;
  directDependentCount?: number | string;
  indirectDependentCount?: number | string;
}

export class DepsDevError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    super(`deps.dev ${status} for ${path}: ${body.slice(0, 200)}`);
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

const enc = encodeURIComponent;

export interface ClientOptions {
  cache: DiskCache;
  concurrency?: number;
}

/**
 * deps.dev client. Uses the stable v3 API for everything except GetDependents,
 * which currently exists only in v3alpha (best effort, may change).
 *
 * Path parameters are percent-encoded (e.g. "@babel/core" -> "%40babel%2Fcore").
 * Every response is cached on disk; 404 resolves to null.
 */
export class DepsDevClient {
  private readonly cache: DiskCache;
  private readonly limit: ReturnType<typeof createLimiter>;
  requestCount = 0;
  cacheHits = 0;

  constructor(opts: ClientOptions) {
    this.cache = opts.cache;
    this.limit = createLimiter(opts.concurrency ?? 8);
  }

  getPackage(system: System, name: string) {
    return this.getJson<PackageResponse>(`/v3/systems/${system}/packages/${enc(name)}`);
  }

  getVersion(system: System, name: string, version: string) {
    return this.getJson<VersionResponse>(
      `/v3/systems/${system}/packages/${enc(name)}/versions/${enc(version)}`,
    );
  }

  /** Resolved (transitive) dependency graph for one version. */
  getDependencies(system: System, name: string, version: string) {
    return this.getJson<DependenciesResponse>(
      `/v3/systems/${system}/packages/${enc(name)}/versions/${enc(version)}:dependencies`,
    );
  }

  /** v3alpha only. */
  getDependents(system: System, name: string, version: string) {
    return this.getJson<DependentsResponse>(
      `/v3alpha/systems/${system}/packages/${enc(name)}/versions/${enc(version)}:dependents`,
    );
  }

  private async getJson<T>(path: string): Promise<T | null> {
    const cached = await this.cache.read(path);
    if (cached) {
      this.cacheHits++;
      return cached.status === 404 ? null : (cached.body as T);
    }

    return this.limit(async () => {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          this.requestCount++;
          res = await fetch(BASE + path, {
            headers: { accept: "application/json", "user-agent": USER_AGENT },
          });
        } catch (err) {
          if (attempt >= MAX_RETRIES) throw err;
          await sleep(backoffMs(attempt));
          continue;
        }

        if (res.ok) {
          const body = (await res.json()) as T;
          await this.cache.write(path, 200, body);
          return body;
        }
        if (res.status === 404) {
          await this.cache.write(path, 404, null);
          return null;
        }
        if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
          const retryAfter = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
          continue;
        }
        throw new DepsDevError(res.status, path, await res.text().catch(() => ""));
      }
    });
  }
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
