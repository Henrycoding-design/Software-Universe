import type { CelestialType, PhysicsParams, System, UniverseNode } from "../../shared/universe-types.ts";

export interface RenderCharacteristics {
  scale: number;
  brightness: number;
  color: number;
}

const TYPE_BASE: Record<CelestialType, { scale: number; brightness: number }> = {
  star: { scale: 2.35, brightness: 4.2 },
  planet: { scale: 1.3, brightness: 1.4 },
  moon: { scale: 0.68, brightness: 0.9 },
  asteroid: { scale: 0.42, brightness: 0.7 },
  comet: { scale: 0.66, brightness: 2.0 },
};

const ECOSYSTEM_TINT: Record<System, number> = {
  npm: 0xff4d6d, pypi: 0x38bdf8, cargo: 0xf97316,
  maven: 0xec4899, go: 0x06b6d4, nuget: 0xa855f7,
};

/**
 * Rendering-only seeded variation. Each id seeds the same pseudo-random
 * sequence every load, so a package keeps its natural color, scale, and glow
 * without persisting presentation state in Universe JSON.
 */
export class RenderCharacteristicMapper {
  map(type: CelestialType, physics: PhysicsParams, ecosystem: System, seed: string = type): RenderCharacteristics {
    const base = TYPE_BASE[type];
    const random = mulberry32(hash(seed));
    const color = blendHex(natureColor(type, random), ECOSYSTEM_TINT[ecosystem], 0.20);
    const scaleVariation = 0.88 + random() * 0.24;
    const brightnessVariation = 0.88 + random() * 0.28;
    return {
      scale: base.scale * scaleVariation * (0.78 + physics.mass * 0.42),
      brightness: base.brightness * brightnessVariation * (0.76 + physics.activity * 0.32 + physics.centrality * 0.18),
      color,
    };
  }

  mapNode(node: UniverseNode): RenderCharacteristics {
    if (!node.physics || !node.celestialType) throw new Error(`${node.id} is missing derived pipeline data. Run npm run pipeline.`);
    return this.map(node.celestialType, node.physics, node.ecosystem, node.id);
  }
}

function natureColor(type: CelestialType, random: () => number): number {
  switch (type) {
    case "star": {
      // Golden suns, sapphire giants, fiery rubies, and violet flares
      const starHues = [26, 38, 48, 195, 215, 275, 345];
      const hue = starHues[Math.floor(random() * starHues.length)]!;
      return hslToHex(hue + (random() - 0.5) * 12, 0.90 + random() * 0.10, 0.52 + random() * 0.10);
    }
    case "planet": {
      // Vivid oceans, lush terran greens, warm sandstone, deep amethysts, volcanic reds
      const hues = [12, 28, 45, 85, 145, 175, 195, 225, 275, 310];
      const hue = hues[Math.floor(random() * hues.length)]!;
      return hslToHex(hue + (random() - 0.5) * 10, 0.80 + random() * 0.18, 0.48 + random() * 0.12);
    }
    case "moon": {
      // Pearlescent silver, frosty azure, lavender mist, and slate
      const hues = [35, 190, 215, 260];
      const hue = hues[Math.floor(random() * hues.length)]!;
      return hslToHex(hue, 0.40 + random() * 0.25, 0.58 + random() * 0.12);
    }
    case "asteroid": {
      // Rich bronze, oxidised copper, metallic gold, deep rust, slate teal
      const hues = [16, 28, 42, 165, 210];
      const hue = hues[Math.floor(random() * hues.length)]!;
      return hslToHex(hue, 0.60 + random() * 0.25, 0.44 + random() * 0.10);
    }
    case "comet": {
      // Pale pink-purple, icy cyan, and ethereal violet loved by user
      const cometHues = [175, 200, 280, 310, 335];
      const hue = cometHues[Math.floor(random() * cometHues.length)]!;
      return hslToHex(hue, 0.75 + random() * 0.20, 0.62 + random() * 0.10);
    }
  }
}

function hslToHex(hue: number, saturation: number, lightness: number): number {
  const h = ((hue % 360) + 360) % 360 / 360;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset: number) => {
    let value = h + offset;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    const color = value < 1 / 6 ? p + (q - p) * 6 * value : value < 1 / 2 ? q : value < 2 / 3 ? p + (q - p) * (2 / 3 - value) * 6 : p;
    return Math.round(Math.min(1, Math.max(0, color)) * 255);
  };
  return (channel(1 / 3) << 16) | (channel(0) << 8) | channel(-1 / 3);
}

function blendHex(base: number, tint: number, amount: number): number {
  const blend = (shift: number) => Math.round(((base >> shift) & 255) * (1 - amount) + ((tint >> shift) & 255) * amount);
  return (blend(16) << 16) | (blend(8) << 8) | blend(0);
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
