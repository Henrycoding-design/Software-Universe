import type { Universe } from "../../shared/universe-types.ts";

/** Boundary which lets a later BigQuery source replace static JSON cleanly. */
export interface DataSource {
  load(): Promise<Universe>;
}

export class UniverseJsonDataSource implements DataSource {
  constructor(private readonly url = "/data/universe.json") {}

  async load(): Promise<Universe> {
    let response: Response;
    try {
      response = await fetch(this.url, { headers: { accept: "application/json" } });
    } catch (error) {
      throw new Error(`Could not request ${this.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(`${this.url} returned HTTP ${response.status}. Run npm run collect, then npm run params and npm run classify.`);
    const universe = await response.json() as Universe;
    if (!Array.isArray(universe.nodes) || !Array.isArray(universe.edges)) throw new Error(`${this.url} is not a valid Universe JSON file.`);
    return universe;
  }
}
