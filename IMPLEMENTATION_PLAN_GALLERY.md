# Software Universe — Gallery Experience & Visual Balance Implementation Plan

**Project:** Software Universe
**Purpose:** GATE New Media Art Gallery
**Primary objective:** Transform the existing interactive software-dependency visualization into an accessible, narrative-driven experience while preserving its underlying data, physics simulation, and interactive exploration.

---

## 1. Project Vision

Software Universe transforms real software package dependencies into a navigable cosmic landscape. Each celestial body represents a software package, while its physical properties, classification, and relationships express aspects of its role in the software ecosystem.

The gallery edition should go beyond visualizing data. It should help visitors understand the invisible infrastructure behind modern software and discover the human ingenuity, accumulated knowledge, and interconnected contributions that make it possible.

**Central artistic statement:**

> Our universe of software is built from humanity's collective knowledge. Every celestial body represents something created, every connection represents something built upon another, and every explorer participates in a story that is still unfolding.

### Core experience

1. **Arrival:** A cinematic spacecraft launch introduces the experience.
2. **Perspective:** The camera reveals Earth and a compact solar system.
3. **Discovery:** The camera pulls back to reveal the much larger software universe.
4. **Exploration:** Visitors navigate the universe and select celestial bodies.
5. **Understanding:** Each selected package reveals an accessible explanation of its purpose, history, and significance.
6. **Return:** A visitor can manually return home through the HUD, or an inactivity prompt offers an automatic reset.

### Design principles

- Preserve the existing software universe and its real dependency data.
- Use cinematic animation to establish context, not to replace the visualization.
- Make the experience understandable to visitors without programming knowledge.
- Ensure the visualization remains readable at both local and global scales.
- Prefer deterministic, reproducible layouts over arbitrary visual randomness.
- Maintain responsive rendering and reliable operation on a public gallery display.

---

## 2. Phase One — AI-Generated Library Overview

**Priority: P0 — Core feature**

### 2.1 Objective

When a visitor selects a celestial body, display a human-readable overview of the represented software package in the existing `details` aside section.

The overview should explain why the library exists and why it matters, rather than simply repeating technical metadata.

### 2.2 Overview content

The AI-generated response should cover the following when reliable information is available:

- **What it is:** A plain-language explanation of the library.
- **What problem it solves:** The need it addresses and why developers use it.
- **How it works:** A simplified explanation of its role.
- **Its contribution:** How it supports other software or contributes to the broader ecosystem.
- **History and interesting facts:** Origins, notable milestones, or meaningful context.
- **Why it matters:** A concrete explanation that connects the package to the software people use.

Avoid inventing historical events, maintainers, adoption figures, or real-world impact. When information is unavailable or uncertain, omit it or explicitly state the uncertainty.

### 2.3 User interface

- Reuse the existing `details` aside rather than introducing another panel.
- Trigger the overview request when a visitor selects a package.
- Show a loading state while the overview is generated or retrieved.
- Keep existing package metadata visible while the request is pending.
- Preserve the current dependency and dependent views.
- Handle errors gracefully and allow retrying.
- Prevent a slow response for a previously selected package from overwriting the details of the package currently selected.

### 2.4 Local caching strategy

Use a simple dictionary-style structure in `localStorage`.

```ts
type LibraryOverview = {
  overview: string;
  generatedAt: number;
  version: number;
};

type OverviewCache = Record<string, LibraryOverview>;
```

Implementation requirements:

1. Normalize package identifiers consistently before using them as keys.
2. Check the local cache before making an API request.
3. Reuse a valid cached overview immediately.
4. Generate or retrieve the overview only when the cache is missing or outdated.
5. Save successful responses to `localStorage`.
6. Do not cache failed or incomplete responses as successful results.
7. Add a version field so changes to the prompt or response format can invalidate old entries.
8. Handle malformed JSON, storage quota errors, and unavailable storage without breaking package selection.
9. Keep caching entirely client-side; no shared server-side overview cache is required for the single-screen gallery setup.

### 2.5 API efficiency and key rotation

- Generate overviews on demand instead of generating them for every package at startup.

- Keep model API keys out of browser code. If requests are routed through an existing backend or serverless function, keep credentials there.

- Implement **round-robin API key rotation** in the trusted request-handling layer when multiple keys are configured.

- Maintain a current key index and advance it modulo the number of configured keys:

  $
  \text{nextIndex}=(\text{currentIndex}+1)\bmod N
  $

  Here, (N) is the number of configured keys.

- Rotate keys according to the configured policy, such as after each request attempt, and avoid repeatedly selecting a key that has already been identified as temporarily unavailable.

- Handle rate limits, quota exhaustion, authentication failures, and transient errors without creating infinite retry loops.

- Do not expose keys, rotation state, or sensitive error details to the browser.

- If only one key is configured, operate normally without unnecessary rotation logic.

- Pre-generate overviews for a small set of prominent packages only if doing so improves the exhibition's reliability.

**Acceptance criteria**

- Selecting a package displays its overview without blocking camera movement.
- Repeated selection reuses cached content.
- Selecting another package while a request is pending does not display the wrong overview.
- API failures do not prevent the existing metadata and dependency interface from working.
- The overview is understandable to someone with no programming background.
- No API key is exposed in the client bundle or browser storage.

---

## 3. Phase Two — Cinematic Spacecraft Introduction

**Priority: P1 — Gallery experience**

### 3.1 Objective

Introduce a short cinematic sequence that gives visitors a familiar point of reference before revealing the software universe.

Reuse the existing Three.js scene, renderer, and camera infrastructure wherever possible. Avoid building a separate simulation when a staged animation can achieve the same effect.

### 3.2 Sequence

#### Act I — Launch from Earth

- Begin with a cinematic view of Earth.
- Introduce a spacecraft on or near the planet's surface.
- Animate its launch and ascent.
- Use atmospheric glow, restrained lighting, and smooth camera movement.
- Keep the opening short enough to work on a public display.

#### Act II — The solar system

- Transition to a wider view of the spacecraft hovering above Earth.
- Reveal the Sun and the surrounding planets.
- Establish the solar system as a recognizable reference point.
- Keep the spacecraft visible long enough to establish scale.

#### Act III — The software universe

- Pull the camera back continuously.
- Reveal the much larger software universe surrounding the compact solar system.
- Transition into the existing interactive visualization.
- Display a short title at the reveal:

> A universe built by humanity.

The physical solar system is an introductory reference and should remain visually distinct from the software universe's actual package data.

### 3.3 Technical implementation

- Implement the introduction as an explicit scene or camera state.
- Use a deterministic camera path with controlled timing and easing.
- Avoid blocking the render loop or physics worker during animation.
- Ensure the transition works with the existing scene scale and camera clipping planes.
- Keep the solar-system assets lightweight.
- Provide a skip option.
- Hand camera control to the visitor immediately after the reveal or when the introduction is skipped.
- Prevent accidental replay during normal exploration.

**Acceptance criteria**

- The complete sequence runs without interrupting the existing physics simulation.
- The transition into the current universe is smooth.
- Visitors can skip the sequence.
- The sequence works on the intended gallery display without excessive loading or frame drops.

---

## 4. Phase Three — Orbital Balance and Visual Hierarchy

**Priority: P0 — Visual correctness**

### 4.1 Problem statement

The existing universe can contain excessive concentrations of moons around individual planets. This causes planets to visually dominate their local systems and makes the intended hierarchy difficult to recognize.

In particular:

- Some planets have so many moons that they appear to be the dominant star of the system.
- Moons cluster at similar orbital radii.
- Multiple planets can orbit the same star at nearly identical radii.
- Multiple moons can orbit the same planet at nearly identical radii.
- Overlapping orbital trails and celestial bodies reduce readability.
- The visual structure becomes crowded even when the underlying dependency data is valid.

The goal is not to remove legitimate dependency relationships. It is to distribute celestial bodies more clearly while preserving the package graph and the existing physical model.

### 4.2 Required hierarchy

The intended visual hierarchy is:

**Star → Planets → Moons**

A star should have the strongest and most legible central presence. Planets should be clearly distributed around their star, while moons should form smaller, readable subsystems around their parent planets.

The hierarchy must remain visually obvious at both local and global camera distances.

### 4.3 Rule A — Limit moon counts relative to planets

A solar system must not become visually dominated by moons.

Define:

- ($P$): number of planets in a system.
- ($M$): number of moons in that system.
- ($K$): maximum allowed moons per planet equivalent for the system.
- ($M\_{\max}$): maximum allowed total moons for the system.

Use a configurable cap:

$$
M\_{\max}=\min(M\_{\text{available}},K\cdot\max(P,1))
$$

For systems containing planets, the total number of moons should not exceed the configured cap. This establishes a bounded moon-to-planet ratio.

For the initial implementation, use **(K=2)** as the default visual limit, with configuration support for later tuning.

This is a visual presentation rule, not a change to the real dependency graph.

#### Selection and assignment

- Preserve the original dependency relationships in the source data.
- Do not delete packages from the underlying universe dataset just because they cannot be displayed as moons.
- When the classification pipeline allows it, prioritize moons that are important to the represented graph or that produce a more balanced layout.
- Reclassify excess moon candidates as independent celestial bodies where appropriate and consistent with the existing classification rules.
- If reclassification would misrepresent package semantics, retain the package in the data and exclude or simplify its moon representation in the rendered view.
- Ensure deterministic assignment so the same input dataset produces the same visual result.

**Important:** The cap applies to the displayed hierarchy, not to the number of actual dependencies a package has.

### 4.4 Rule B — The star must remain the dominant visual center

Every solar system should preserve the star as its principal visual anchor.

Requirements:

- The star must be clearly distinguishable from planets and moons.
- The star should have the strongest local prominence through an intentional combination of size, glow, lighting, and spatial hierarchy.
- The number of directly orbiting planets should be visually greater than the number of directly orbiting moons in the system.
- A planet with multiple moons must not overpower the star or make the system look like a collection of independent planetary centers.
- Avoid excessive moon trails, bloom, and overlapping orbital paths.
- Preserve the existing package classification unless a deliberate, deterministic reclassification is required by Rule A.

Visual prominence should not rely on particle count alone. Body size, brightness, trail density, and spatial distribution must work together.

### 4.5 Rule C — Enforce distinct planetary orbital radii

Multiple planets orbiting the same star must not share the same orbital radius or occupy nearly indistinguishable orbital bands.

For each star:

1. Collect all planets assigned to it.
2. Determine a deterministic orbital ordering.
3. Assign each planet a distinct orbital radius.
4. Enforce a configurable minimum gap between neighboring orbital bands.
5. Expand the system's radial extent when necessary instead of compressing planets into the same space.
6. Ensure the result remains stable across repeated builds.

For (n) planets, a simple initial spacing model is:

$$
r_i=r\_{\min}+i\Delta r,\qquad i=0,\ldots,n-1
$$

Where:

- ($r\_{\min}$) is the minimum permitted planetary orbital radius.
- ($\Delta r$) is the minimum radial separation.
- ($i$) is the planet's deterministic orbital index.

The actual separation may be increased for large planets or bodies with wide visual bounds.

Avoid arbitrary random offsets that could cause inconsistent layouts between builds.

### 4.6 Rule D — Enforce distinct moon orbital radii

Apply the same principle to moons orbiting a planet.

For each planet:

1. Collect its assigned moons.
2. Sort them deterministically.
3. Assign distinct orbital radii around that planet.
4. Enforce a minimum gap between moon orbital bands.
5. Account for moon size, orbital trails, and the parent's visual radius.
6. Expand the local subsystem when needed.

A simple model is:

$$
r_j^{(m)}=r\_{\min}^{(m)}+j\Delta r_m
$$

Where ($r_j^{(m)}$) is the orbital radius of the (j)-th moon around its parent planet.

Planetary and lunar spacing should be configured independently.

### 4.7 Rule E — Prevent orbital overlap and excessive crowding

Distinct radii are necessary but not sufficient. Two bodies can still overlap visually due to their size, orbital inclination, trails, or camera angle.

Requirements:

- Account for body radii when enforcing minimum orbital separation.
- Prevent neighboring orbital trails from becoming indistinguishable.
- Use controlled orbital phase offsets to reduce persistent alignments.
- Consider inclination or other existing layout parameters only where they improve readability.
- Avoid changing the dependency graph to solve a rendering problem.
- Avoid unbounded increases in system size that make the global universe unnecessarily sparse.

Where appropriate, use projected-size and level-of-detail rules to simplify distant orbital trails.

### 4.8 Rule F — Preserve deterministic behavior

The existing universe pipeline produces a deterministic dataset. Preserve this property.

- Use stable package identifiers and stable sort order for orbital assignment.
- Avoid uncontrolled randomness in moon caps, radius allocation, or phase selection.
- Repeated runs using identical source data and configuration should produce identical orbital layouts.
- Make spacing and count limits configurable in the universe configuration file rather than hardcoding them across the renderer and pipeline.

### 4.9 Suggested configuration

Adapt the names to the existing schema in `config/universe.config.json`.

```json
{
  "orbitalLayout": {
    "maxMoonsPerPlanetEquivalent": 2,
    "planetMinRadialGap": 1.0,
    "moonMinRadialGap": 0.5,
    "preventOverlappingOrbitalBands": true,
    "deterministicAssignment": true,
    "preserveSourceDependencyGraph": true
  }
}
```

These values are initial tuning parameters, not final physical units. They must be calibrated against the current body radii, orbital scales, and renderer.

### 4.10 Implementation location

Inspect the existing pipeline before making changes.

Likely responsibilities:

- `scripts/` — package classification, moon-parent assignment, and deterministic orbital parameters, if these are generated during preprocessing.
- `config/universe.config.json` — configurable moon limits and radial spacing.
- `shared/` — shared types and configuration contracts.
- `src/physics/` — runtime orbital dynamics, if the simulation can change orbital radii after initialization.
- `src/render/` — body size, trails, visibility, and level-of-detail behavior.

Do not duplicate orbital-spacing logic independently in several layers. Establish a single authoritative layout stage and ensure the physics simulation respects its output.

### 4.11 Acceptance criteria

- No system exceeds its configured moon-to-planet ratio.
- Systems containing planets display a clearer star–planet–moon hierarchy.
- The star remains the dominant visual anchor.
- No two planets around the same star share an assigned orbital radius.
- No two moons around the same planet share an assigned orbital radius.
- Orbital bands have sufficient spacing to be distinguishable at practical camera distances.
- The dependency graph remains intact.
- Identical inputs produce identical assignments and radii.
- Existing physics, classification, and rendering tests continue to pass.
- Add regression tests for crowded systems, systems with one planet, systems with no planets, and systems with many moon candidates.

---

## 5. Phase Four — Interactive Discovery

**Priority: P1 — Artistic meaning**

### 5.1 Objective

Make the connection between celestial bodies and real software relationships legible to visitors.

### 5.2 Selection behavior

When a visitor selects a package:

- Highlight the selected body.
- Emphasize its direct dependencies and dependents.
- De-emphasize unrelated bodies temporarily without hiding the broader universe.
- Reveal or emphasize relevant relationship paths.
- Display the package overview in the `details` aside.
- Keep the visitor's camera position and controls stable unless they explicitly choose to navigate elsewhere.

### 5.3 Relationship explanation

Explain dependency relationships in plain language.

For example:

- **Dependencies:** The packages this library relies on.
- **Dependents:** The packages that rely on this library.
- **Ecosystem role:** A concise explanation of how these relationships contribute to the wider software ecosystem.

Only display relationships supported by the collected dataset. Do not imply that a package is more important or more widely used than the available evidence establishes.

### 5.4 Interaction design

- Keep selection responsive.
- Avoid unnecessary camera movement when a body is clicked.
- Allow visitors to clear a selection and return to the full universe.
- Maintain legibility when many relationships are highlighted.
- Provide a brief first-use control hint.
- Ensure the overview panel remains usable on the target display.

**Acceptance criteria**

Visitors should be able to select a body, understand what it represents, identify its major relationships, and return to exploring without losing their orientation.

---

## 6. Phase Five — Gallery HUD and Inactivity Reset

**Priority: P1 — Exhibition readiness**

### 6.1 Objective

Provide a manual way to return to the home view and an inactivity-based reset prompt that prevents the gallery display from remaining indefinitely in an unhelpful camera position or stale selection state.

The inactivity reset must be interruptible and must never reset the experience while the visitor is actively interacting.

### 6.2 HUD reset button

Add a clearly labeled **Home / Reset View** button to the existing HUD panel.

When activated:

- Cancel any pending inactivity timer.
- Dismiss the reset confirmation prompt, if visible.
- Clear the selected package and its temporary relationship highlighting.
- Return the camera to the designated home view.
- Restore the appropriate default HUD and details-panel state.
- Do not unnecessarily reload the page or regenerate the universe dataset.

If the spacecraft introduction is designed to play only on initial arrival, returning home should restore the designated home view without automatically replaying the entire introduction unless that behavior is explicitly configured.

### 6.3 Inactivity definition

An inactivity timer should run only when both conditions are satisfied:

1. No celestial body is currently selected.
2. The visitor has not moved or interacted with the visualization for approximately **20 seconds**.

Camera movement, rotation, zoom, navigation input, and relevant HUD interaction should count as activity.

A selected celestial body suspends the inactivity reset, even if the visitor does not move the camera. This avoids interrupting someone who is reading the package overview.

### 6.4 Timer state machine

Implement the behavior using managed timer events or an equivalent centralized timer controller. Avoid creating independent, unmanaged timers for each input event.

#### State A — Active or selected

- If a package is selected, cancel the inactivity timer and hide the confirmation prompt.
- If the visitor moves the camera or interacts with the visualization, restart the inactivity period.
- If the visitor manually presses Home / Reset View, perform the reset immediately.

#### State B — Waiting for inactivity

When no package is selected and no relevant movement or interaction has occurred for 20 seconds, transition to the confirmation state.

#### State C — Reset confirmation

Display a visible, unobtrusive HUD prompt:

> Return to home view in 5 seconds?

Show a countdown from 5 to 1 and provide a way to interrupt or cancel the reset.

The countdown should not block camera controls, package selection, or other normal interactions.

#### State D — Countdown interrupted

If the visitor performs any relevant interaction during the countdown:

- Cancel the countdown immediately.
- Dismiss the prompt.
- Return to the active state.
- Restart the inactivity timer from zero.
- Wait another 20 seconds of qualifying inactivity before showing the prompt again.

Selecting a package also interrupts the countdown and suspends inactivity monitoring until the selection is cleared.

#### State E — Countdown completed

If the five-second countdown expires without interruption:

- Clear the selected package if necessary.
- Return the camera to the home view.
- Clear transient highlights and restore the default interface state.
- Restart the inactivity timer for the next cycle.

### 6.5 Timer implementation requirements

- Maintain at most one active inactivity timer and one active countdown timer.
- Centralize timer creation, cancellation, and reset behavior.
- Use a monotonic clock or elapsed-time calculations so countdown accuracy does not depend on the browser firing every interval callback precisely on time.
- Cancel timers when their state becomes invalid.
- Prevent stale callbacks from resetting the view after a visitor resumes interacting.
- Ensure the timer controller works correctly when the tab loses focus or browser callbacks are delayed.
- Do not use a hard page reload as the reset mechanism.
- Keep all timer logic separate from the per-frame Three.js render loop.

### 6.6 Suggested state model

Adapt the implementation to the existing UI and camera architecture.

```ts
type GalleryIdleState =
  | "active"
  | "waiting"
  | "confirming"
  | "resetting";
```

Suggested behavior:

```text
ACTIVE
  ├─ No selection + no activity → WAITING
  └─ Manual Home button → RESETTING

WAITING
  ├─ Activity or selection → ACTIVE
  └─ 20 seconds elapsed → CONFIRMING

CONFIRMING
  ├─ Activity or selection → ACTIVE
  └─ 5 seconds elapsed → RESETTING

RESETTING
  └─ Home view restored → WAITING
```

In the `ACTIVE` state, selected-package status should suspend the inactivity timer. After the package is deselected, start a fresh 20-second inactivity period.

### 6.7 Acceptance criteria

- The Home / Reset View button is always accessible through the HUD.
- The inactivity prompt appears after 20 seconds only when no package is selected and no qualifying activity occurs.
- The prompt displays a five-second countdown.
- Any relevant interaction interrupts the countdown and restarts the full 20-second waiting period.
- Selecting a package prevents automatic resetting while the visitor reads its overview.
- The view resets automatically if the countdown completes uninterrupted.
- Manual reset works immediately.
- No stale timer can reset the view after the visitor resumes interacting.
- Repeated inactivity cycles do not create duplicate timers.
- The timer logic does not block rendering or normal navigation.

---

## 7. Phase Six — Validation and Gallery Testing

**Priority: P0 — Before exhibition**

### 7.1 Automated tests

Extend the existing test suite to cover:

- Moon-to-planet cap enforcement.
- Deterministic parent assignment.
- Unique orbital radii within each parent system.
- Minimum radial separation.
- Dense systems with many moon candidates.
- Systems with zero or one planet.
- Preservation of dependency relationships.
- Valid configuration handling.
- Overview cache hit, miss, version mismatch, and malformed data.
- Stale AI responses after the selected package changes.
- API key rotation across multiple configured keys.
- Single-key operation.
- Rate-limit and transient-error handling.
- Timer cancellation and restart behavior.
- Inactivity detection only when no package is selected.
- Countdown interruption by camera movement, navigation, and package selection.
- Automatic reset after an uninterrupted countdown.
- Manual HUD reset.
- Repeated inactivity cycles without duplicated timers.
- Camera state transitions and introduction skipping, where testable.

### 7.2 Visual validation

Inspect the visualization at multiple scales:

- Close-up: individual bodies and orbital trails are distinguishable.
- Local: stars, planets, and moons form readable systems.
- Regional: multiple systems remain visually separable.
- Global: the universe reads as a large interconnected structure rather than a uniformly crowded cloud.

Pay particular attention to systems where a planet has many moon candidates and systems with many planets sharing a star.

### 7.3 User testing

Test with visitors who do not have a programming background.

Ask them to explore without an initial explanation, then ask:

- What do you think this universe represents?
- What did you discover by selecting a body?
- Did the spacecraft introduction help you understand the visualization?
- What surprised you?
- What would make you want to explore further?

If visitors remember only the spacecraft or the galaxy's appearance, improve the connection between the cinematic introduction, package selection, and the stories revealed by the details panel.

### 7.4 Exhibition checklist

- [ ] Production website deployed and accessible.
- [ ] Cinematic introduction tested on the exhibition display.
- [ ] Skip behavior verified.
- [ ] HUD Home / Reset View button verified.
- [ ] Inactivity prompt appears after 20 seconds under the correct conditions.
- [ ] Five-second countdown and interruption behavior verified.
- [ ] Automatic reset works after an uninterrupted countdown.
- [ ] AI overview local caching tested.
- [ ] API key rotation tested without exposing credentials.
- [ ] API failure and retry behavior tested.
- [ ] Orbital hierarchy visually balanced.
- [ ] Moon count caps verified.
- [ ] Planetary and lunar orbital radii checked for collisions and crowding.
- [ ] Camera controls and first-use instructions verified.
- [ ] Long-running performance tested.
- [ ] Core visualization remains functional without AI availability.

---

## 8. Recommended Implementation Order

| Order | Work item                                                                                   | Priority |
| ----- | ------------------------------------------------------------------------------------------- | -------- |
| 1     | Inspect the existing classification, parent assignment, and orbital initialization pipeline | P0       |
| 2     | Implement deterministic moon caps and orbital-spacing rules                                 | P0       |
| 3     | Add tests and validate the star–planet–moon hierarchy                                       | P0       |
| 4     | Implement the AI overview and local cache                                                   | P0       |
| 5     | Implement API key rotation in the trusted request-handling layer                            | P1       |
| 6     | Add the spacecraft launch and solar-system reveal                                           | P1       |
| 7     | Connect package selection to relationship highlighting and narrative discovery              | P1       |
| 8     | Add the HUD reset button and interruptible inactivity timer                                 | P1       |
| 9     | Run visual, performance, and non-programmer user tests                                      | P0       |

### Final completion criteria

The gallery edition is ready when it delivers all three of the following:

1. **Visual impact:** A compelling, smooth transition from Earth and the solar system into the software universe.
2. **Conceptual impact:** Visitors can understand that the universe represents the collective architecture and history of human-built software.
3. **Technical clarity:** Celestial systems remain readable, orbital hierarchies are balanced, and package relationships remain grounded in real data.

The final goal is not simply to make the software universe larger or more spectacular. It is to make the invisible structure of software understandable, explorable, and meaningful to people who have never written a line of code.
