import type { CelestialType, Universe, UniverseNode } from "../../shared/universe-types.ts";

const TYPES: readonly CelestialType[] = ["star", "planet", "moon", "asteroid", "comet"];

export class UniverseInterface {
  private readonly fps = document.querySelector<HTMLElement>("#fps")!;
  private readonly physics = document.querySelector<HTMLElement>("#physics-rate")!;
  private readonly renderCount = document.querySelector<HTMLElement>("#render-count")!;
  private readonly typeCount = document.querySelector<HTMLElement>("#type-count")!;
  private readonly pause = document.querySelector<HTMLButtonElement>("#pause")!;
  private readonly timeScale = document.querySelector<HTMLInputElement>("#time-scale")!;
  private readonly timeScaleValue = document.querySelector<HTMLElement>("#time-scale-value")!;
  private readonly panel = document.querySelector<HTMLElement>("#details")!;
  private lastFrame = performance.now();
  private frames = 0;
  private fpsValue = 0;
  private steps = 0;
  private lastRate = performance.now();
  private paused = false;

  constructor(
    private readonly universe: Universe,
    handlers: {
      pause: (paused: boolean) => void;
      timeScale: (value: number) => void;
      selectId: (id: string) => void;
      deselect: () => void;
    },
  ) {
    this.typeCount.textContent = TYPES.map(
      (type) => `${type.charAt(0).toUpperCase()}${type.slice(1)} ${universe.nodes.filter((node) => node.celestialType === type).length}`,
    ).join(" · ");
    this.pause.addEventListener("click", () => {
      this.paused = !this.paused;
      this.pause.textContent = this.paused ? "Resume" : "Pause";
      handlers.pause(this.paused);
    });
    this.timeScale.addEventListener("input", () => {
      const value = Number(this.timeScale.value);
      this.timeScaleValue.textContent = `${value.toFixed(1)}×`;
      handlers.timeScale(value);
    });
    this.panel.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      // Close button
      if (target.classList.contains("panel-close")) {
        handlers.deselect();
        return;
      }
      const id = target.dataset.nodeId;
      if (id) handlers.selectId(id);
    });
  }

  frame(rendered: number): void {
    const now = performance.now();
    this.frames++;
    if (now - this.lastFrame >= 500) {
      this.fpsValue = this.frames * 1000 / (now - this.lastFrame);
      this.frames = 0;
      this.lastFrame = now;
      this.fps.textContent = `${this.fpsValue.toFixed(0)} FPS`;
    }
    this.renderCount.textContent = `${rendered}/${this.universe.nodes.length} rendered`;
    if (now - this.lastRate >= 1_000) {
      this.physics.textContent = `${this.steps} physics steps/s`;
      this.steps = 0;
      this.lastRate = now;
    }
  }

  addPhysicsSteps(steps: number): void { this.steps += steps; }

  showNode(node: UniverseNode, dependents: readonly UniverseNode[]): void {
    const physics = node.physics!;
    this.panel.replaceChildren();

    // Header row with name + close button
    const header = document.createElement("div");
    header.className = "panel-header";
    const heading = document.createElement("h2");
    heading.textContent = node.name;
    const closeBtn = document.createElement("button");
    closeBtn.className = "panel-close";
    closeBtn.title = "Deselect (Esc)";
    closeBtn.textContent = "✕";
    header.append(heading, closeBtn);

    const version = document.createElement("p");
    version.className = "muted";
    version.textContent = `${node.ecosystem} · ${node.version} · ${node.celestialType}`;

    const metrics = document.createElement("dl");
    appendMetric(metrics, "Mass", physics.mass.toFixed(3));
    appendMetric(metrics, "Activity", physics.activity.toFixed(3));
    appendMetric(metrics, "Age", physics.age.toFixed(3));
    appendMetric(metrics, "Centrality", physics.centrality.toFixed(3));
    appendMetric(metrics, "Dependents", String(node.raw.dependentCount ?? node.raw.crawlDependentCount));
    appendMetric(metrics, "Releases (365d)", String(node.raw.releasesLast365d));
    appendMetric(metrics, "Versions", String(node.raw.versionCount));
    if (node.parentId) appendMetric(metrics, "Parent", node.parentId);

    const hint = document.createElement("p");
    hint.className = "muted orbit-hint";
    hint.textContent = "Orbit trail active · Esc or ✕ to deselect";

    this.panel.append(
      header, version, hint, metrics,
      relationList("Dependencies", node.dependencies),
      relationList("Dependents", dependents.map((dependent) => dependent.id)),
    );
  }

  showEmpty(): void {
    this.panel.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Select a body";
    const copy = document.createElement("p");
    copy.textContent = "Click a celestial body to inspect its metrics. Orbit trail renders automatically.";
    const nav = document.createElement("p");
    nav.className = "muted";
    nav.textContent = "Navigate: WASD / Arrow keys · Q/E or scroll to zoom · Press Esc to deselect";
    this.panel.append(heading, copy, nav);
  }
}

function appendMetric(target: HTMLDListElement, label: string, value: string): void {
  const dt = document.createElement("dt"); dt.textContent = label;
  const dd = document.createElement("dd"); dd.textContent = value;
  target.append(dt, dd);
}

function relationList(title: string, ids: readonly string[]): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h3"); heading.textContent = title;
  const list = document.createElement("ul");
  for (const id of ids.slice(0, 20)) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "node-link";
    button.dataset.nodeId = id;
    button.textContent = id;
    item.append(button); list.append(item);
  }
  if (ids.length > 20) {
    const more = document.createElement("li");
    more.textContent = `… ${ids.length - 20} more`;
    list.append(more);
  }
  section.append(heading, list);
  return section;
}
