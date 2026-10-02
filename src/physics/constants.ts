/**
 * Simulation units are deliberately visual rather than astrophysical:
 * distance is a world unit, time is a simulation second, and simulated mass
 * is unitless. These values are the single tuning point for stable 100-1000
 * body systems. Rendering scale never feeds back into these calculations.
 */
export const SIMULATION = {
  // Slightly reduced G keeps wider orbits stable without destabilizing inner moons.
  gravitationalConstant: 0.18,
  softening: 1.6,
  theta: 0.5,
  fixedDt: 1 / 60,
  massBase: 1,
  massScale: 18,
  /** Short-range collision solver tuning; independent of render scale. */
  collisionRestitution: 0.28,
  // Extra passes run only while an overlap exists, so sparse universes remain cheap.
  collisionPasses: 4,
  collisionPadding: 0.06,
  maxStepsPerTick: 6,
  initialSeed: 0x51a7e,
} as const;

/** Convert a normalized preprocessing mass into the mass used by N-body physics. */
export function simulatedMass(normalizedMass: number): number {
  const clamped = Math.min(1, Math.max(0, normalizedMass));
  return SIMULATION.massBase + SIMULATION.massScale * clamped * clamped;
}
