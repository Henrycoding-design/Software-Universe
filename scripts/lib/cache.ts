import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface CacheEntry {
  key: string;
  status: number;
  fetchedAt: string;
  body: unknown;
}

/**
 * Disk cache for raw API responses (data/raw/<sha1>.json).
 * This is the "retain raw data" layer: re-runs are free and offline-friendly.
 * 404s are cached too, so missing packages are not re-requested.
 */
export class DiskCache {
  private readonly dir: string;
  private readonly opts: { refresh: boolean };

  constructor(dir: string, opts: { refresh: boolean } = { refresh: false }) {
    this.dir = dir;
    this.opts = opts;
  }

  private file(key: string): string {
    return join(this.dir, createHash("sha1").update(key).digest("hex") + ".json");
  }

  async read(key: string): Promise<CacheEntry | null> {
    if (this.opts.refresh) return null;
    try {
      return JSON.parse(await readFile(this.file(key), "utf8")) as CacheEntry;
    } catch {
      return null;
    }
  }

  async write(key: string, status: number, body: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: CacheEntry = { key, status, fetchedAt: new Date().toISOString(), body };
    await writeFile(this.file(key), JSON.stringify(entry));
  }
}
