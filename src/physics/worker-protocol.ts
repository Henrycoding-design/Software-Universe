export const CELESTIAL_TYPE_INDEX = { star: 0, planet: 1, moon: 2, asteroid: 3, comet: 4 } as const;

export type PhysicsWorkerRequest =
  | { kind: "init"; positions: ArrayBuffer; velocities: ArrayBuffer; masses: ArrayBuffer; parentIndices: ArrayBuffer; types: ArrayBuffer; scales: ArrayBuffer; brightness: ArrayBuffer }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "setTimeScale"; value: number }
  | { kind: "recycle"; positions: ArrayBuffer; velocities: ArrayBuffer };

export type PhysicsWorkerResponse =
  | { kind: "initialized"; scales: ArrayBuffer; brightness: ArrayBuffer; types: ArrayBuffer }
  | { kind: "state"; positions: ArrayBuffer; velocities: ArrayBuffer; steps: number }
  | { kind: "error"; message: string };
