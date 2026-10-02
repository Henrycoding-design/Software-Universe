/** State buffers owned by the physics worker. xyz values are interleaved. */
export interface IntegratorState {
  positions: Float32Array;
  velocities: Float32Array;
  accelerations: Float32Array;
  count: number;
}

export type AccelerationComputer = (positions: Float32Array, out: Float32Array) => void;
export type CollisionResolver = (positions: Float32Array, velocities: Float32Array) => void;

/**
 * Velocity Verlet is time-reversible and much more stable for orbits than a
 * simple Euler update: force -> half kick -> drift -> force -> half kick.
 */
export function velocityVerletStep(
  state: IntegratorState,
  dt: number,
  computeAccelerations: AccelerationComputer,
  resolveCollisions?: CollisionResolver,
): void {
  const length = state.count * 3;
  computeAccelerations(state.positions, state.accelerations);
  const halfDt = dt * 0.5;
  for (let index = 0; index < length; index++) {
    state.velocities[index]! += state.accelerations[index]! * halfDt;
    state.positions[index]! += state.velocities[index]! * dt;
  }
  resolveCollisions?.(state.positions, state.velocities);
  computeAccelerations(state.positions, state.accelerations);
  for (let index = 0; index < length; index++) state.velocities[index]! += state.accelerations[index]! * halfDt;
}

/**
 * Exact short-range non-penetration solver. It deliberately uses flat-array
 * pair iteration (no second spatial structure) after each drift; Barnes-Hut
 * remains the sole force-approximation structure. Positional correction keeps
 * bodies separated while a low-restitution impulse prevents repeated overlap.
 */
export function resolveNonOverlappingCollisions(
  positions: Float32Array,
  velocities: Float32Array,
  masses: Float32Array,
  radii: Float32Array,
  restitution = 0.28,
  passes = 2,
  padding = 0.02,
): void {
  for (let pass = 0; pass < passes; pass++) {
    let corrected = false;
    for (let first = 0; first < masses.length; first++) {
      const firstOffset = first * 3;
      for (let second = first + 1; second < masses.length; second++) {
        const secondOffset = second * 3;
        let dx = positions[secondOffset]! - positions[firstOffset]!;
        let dy = positions[secondOffset + 1]! - positions[firstOffset + 1]!;
        let dz = positions[secondOffset + 2]! - positions[firstOffset + 2]!;
        const minimumDistance = radii[first]! + radii[second]!;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq >= minimumDistance * minimumDistance) continue;
        corrected = true;
        let distance = Math.sqrt(distanceSq);
        if (distance < 1e-8) {
          // Deterministic normal for exactly coincident bodies.
          const axis = (first * 31 + second * 17) % 3;
          dx = axis === 0 ? 1 : 0;
          dy = axis === 1 ? 1 : 0;
          dz = axis === 2 ? 1 : 0;
          distance = 1;
        } else {
          dx /= distance; dy /= distance; dz /= distance;
        }
        const inverseFirst = 1 / masses[first]!;
        const inverseSecond = 1 / masses[second]!;
        const inverseTotal = inverseFirst + inverseSecond;
        const correction = (minimumDistance - distance + padding) / inverseTotal;
        positions[firstOffset]! -= dx * correction * inverseFirst;
        positions[firstOffset + 1]! -= dy * correction * inverseFirst;
        positions[firstOffset + 2]! -= dz * correction * inverseFirst;
        positions[secondOffset]! += dx * correction * inverseSecond;
        positions[secondOffset + 1]! += dy * correction * inverseSecond;
        positions[secondOffset + 2]! += dz * correction * inverseSecond;

        const relativeVelocity = (velocities[secondOffset]! - velocities[firstOffset]!) * dx
          + (velocities[secondOffset + 1]! - velocities[firstOffset + 1]!) * dy
          + (velocities[secondOffset + 2]! - velocities[firstOffset + 2]!) * dz;
        if (relativeVelocity >= 0) continue;
        const impulse = -(1 + restitution) * relativeVelocity / inverseTotal;
        velocities[firstOffset]! -= dx * impulse * inverseFirst;
        velocities[firstOffset + 1]! -= dy * impulse * inverseFirst;
        velocities[firstOffset + 2]! -= dz * impulse * inverseFirst;
        velocities[secondOffset]! += dx * impulse * inverseSecond;
        velocities[secondOffset + 1]! += dy * impulse * inverseSecond;
        velocities[secondOffset + 2]! += dz * impulse * inverseSecond;
      }
    }
    if (!corrected) break;
  }
}

/** Sum m*v per axis, useful for conservation tests and debug instrumentation. */
export function totalMomentum(velocities: Float32Array, masses: Float32Array): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let body = 0; body < masses.length; body++) {
    const offset = body * 3;
    x += masses[body]! * velocities[offset]!;
    y += masses[body]! * velocities[offset + 1]!;
    z += masses[body]! * velocities[offset + 2]!;
  }
  return [x, y, z];
}
