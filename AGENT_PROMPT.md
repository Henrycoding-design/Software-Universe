# Task: finish Software Universe V1

You are continuing an existing TypeScript project (`README.md` has the structure). **Stage 1 is done and tested**:
`npm run collect` turns deps.dev v3 data into `public/data/universe.json` (nodes + edges + RAW metrics, schema in
`shared/universe-types.ts`). Your job is everything after that. Read `README.md`, `shared/universe-types.ts`,
`config/universe.config.json` and `scripts/lib/*` first. Do not rewrite stage 1 unless you find a bug; if so, fix and tell me.

## Hard constraints (V1 scope)
- IN: 100 seed packages, deps.dev v3, 4 physics parameters, 5 celestial types, rule-based classifier, Web Worker,
  3D Barnes–Hut octree, TypedArrays over **transferable ArrayBuffers**, Three.js, **InstancedMesh**, rendering-only LOD.
- OUT (do not build): BigQuery, WebGPU, SharedArrayBuffer, million-particle optimizations, any spatial optimization beyond Barnes–Hut, ML classification, interpolation between physics states.
- Layering is strict: **preprocessing derives physics values; the renderer never computes them.** Render characteristics (scale, brightness) are computed by a `RenderCharacteristicMapper` at load time and are NOT stored in the JSON.
- Raw metrics and normalized parameters must both stay in the JSON.
- Everything deterministic (seeded RNG, stable ordering). Same input JSON ⇒ same universe.
- Thresholds come from `config/universe.config.json`, never hard-coded.

## Phase 2 – Physics parameters (`scripts/lib/physics-params.ts`, `npm run params`)
Read `universe.json`, fill `node.physics` = `{mass, activity, age, centrality}`, all in [0,1], write it back.
- **mass**: influence by popularity. Use `log1p(dependentCount ?? crawlDependentCount)`, then percentile-rank or min-max normalize across nodes.
- **activity**: from `releasesLast365d` (and `releasesLast90d` as a recency boost), log-scaled then normalized.
- **age**: years since `firstPublishedAt`, normalized (null ⇒ 0.5 and log a warning).
- **centrality**: PageRank on the REVERSED dependency graph (importance flows toward dependencies), damping 0.85, then normalized. Must handle cycles and isolated nodes.
- Make the formulas small pure functions with unit tests. Document each in a header comment so they can be swapped later.
- Sanity-check the output distribution (print a histogram). With defaults, Stars should be a small minority (roughly 3–10% of nodes); if not, tell me what to tune in the config rather than silently changing the rules.

## Phase 3 – Celestial classifier (`scripts/lib/classifier.ts`, `npm run classify`)
Deterministic precedence (first match wins):
1. `centrality >= thresholds.star` → **star**
2. `activity >= thresholds.cometActivity` → **comet**
3. `mass >= thresholds.planetMass` → **planet**
4. strong parent relationship → **moon**
5. otherwise → **asteroid**

Moon rule (requires a second pass because it depends on other nodes' types): a node is a moon if it is a dependency of at least one star/planet AND at least 50% of its dependents (in the universe) are stars/planets… make that share a config key `moonParentShare` (default 0.5). Its **parent** is the highest-mass star/planet among its dependents; store it as `parentId` on the node (add to the schema in `shared/universe-types.ts`; keep it optional). Unit-test the precedence table, including a node that qualifies for star+comet+planet at once (must be star).

## Phase 4 – Physics engine (`src/physics/`)
- `octree.ts`: 3D Barnes–Hut octree on flat TypedArrays (no per-node object allocation in the hot path), center-of-mass per cell, opening angle θ configurable (default 0.5), Plummer softening configurable. Handle coincident bodies without infinite recursion.
- `integrator.ts`: velocity Verlet or leapfrog, fixed `dt`.
- `physics.worker.ts`: owns position, velocity, acceleration, mass for all bodies. Fixed timestep of 60 steps/sec using an accumulator, independent of render FPS. Step order: build octree → centers of mass → forces → acceleration → integrate velocity → integrate position → publish.
- **Initial conditions** (seeded, deterministic): stars near the center; planets on roughly circular orbits around the nearest/most massive star (`v = sqrt(G·M/r)`); moons orbit `parentId`; comets get eccentric orbits; asteroids loosely scattered in a belt. `activity` scales orbital speed/eccentricity. Document your unit system and G; pick values that look good with ~100–400 bodies and stay stable for several minutes.
- Simulated mass is derived from normalized `mass` (e.g. `1 + k·mass²`), configurable in one place.
- **Messaging**: main → worker `init` (types, masses, parent indices, initial state) and `pause/resume/setTimeScale`. Worker → main: `Float32Array` positions (xyz interleaved), velocities, plus static `scales`, `brightness`, `Uint8Array types`. Use transferable buffers with ping-pong (main returns buffers after use) so there are no per-frame allocations. No SharedArrayBuffer.
- Tests (vitest): Barnes–Hut force vs brute-force O(n²) on a random set stays within a few percent at θ=0.5 and converges as θ→0; two-body circular orbit keeps radius within tolerance over N steps; total momentum approximately conserved.

## Phase 5 – Renderer (`src/render/`, `src/data/`, `src/main.ts`, `index.html`)
- `data/loader.ts`: load `/data/universe.json` through a `DataSource` interface (so BigQuery can replace deps.dev later without touching other layers). Fail with a readable on-screen message if the file is missing, pointing to `npm run collect`.
- `RenderCharacteristicMapper`: celestial type + physics → `{scale, brightness, color}`. Star: large, very bright, glow. Planet: medium, solid. Moon: small, dim. Asteroid: tiny, low-poly/irregular. Comet: small, medium, with a tail (trail from recent positions or a stretched sprite). Color by ecosystem (npm / pypi / cargo) as a subtle tint.
- **One `InstancedMesh` per celestial type** (5 total). Never one `THREE.Mesh` per body. Update instance matrices from the worker's position array each frame; keep a body→(mesh, instanceIndex) lookup table.
- Scene: perspective camera with orbit controls (`three/examples/jsm/controls/OrbitControls`), starfield backdrop, point lights at stars, bloom post-processing (`UnrealBloomPass`) for star glow.
- **LOD (rendering only)**: all bodies are always simulated. Each frame, frustum-cull and distance-tier the rendering: full detail near the camera, reduced geometry/no tail mid-range, points or hidden when far or outside the frustum. A body leaving and re-entering the view must continue from its true simulated position (no teleport, no reset). Expose a debug overlay showing simulated vs rendered counts.
- Interaction: hover/click picking (raycast or CPU picking against positions) → side panel with package name, version, ecosystem, celestial type, the four physics values, key raw metrics, and links to its dependencies/dependents. Optionally highlight a selected node's edges as lines.
- HUD: FPS, physics steps/sec, body counts by type, pause/resume, time scale slider.

## Phase 6 – Wiring and docs
- npm scripts: `params`, `classify`, `pipeline` (collect → params → classify), `dev`, `build`, `test`, `typecheck`. `npm run typecheck` and `npm test` must pass.
- Update `README.md` with the final architecture diagram (use the one from the design doc), the unit system, tuning knobs, and known limitations.

## Working rules
- Work phase by phase; after each phase run typecheck + tests and give me a 3–5 line summary before moving on.
- Don't add dependencies beyond three, vite, vitest, tsx, typescript without asking.
- When the spec is ambiguous, pick the simplest option consistent with the constraints above, note the decision in the README under "Decisions", and continue.
- Be honest about anything you could not verify (e.g. visual quality, real network behavior).

## Definition of done
`npm run pipeline && npm run dev` shows an interactive universe: stars at the center with planets and moons orbiting, comets on eccentric paths with tails, an asteroid belt, smooth camera control, ~60 FPS with ≤ 400 bodies, working picking panel, passing tests.
