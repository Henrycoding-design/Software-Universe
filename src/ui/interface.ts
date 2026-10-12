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
  private readonly navBackHud = document.querySelector<HTMLButtonElement>("#nav-back-control");
  private lastFrame = performance.now();
  private frames = 0;
  private fpsValue = 0;
  private steps = 0;
  private lastRate = performance.now();
  private paused = false;

  constructor(
    private readonly universe: Universe,
    private readonly handlers: {
      pause: (paused: boolean) => void;
      timeScale: (value: number) => void;
      selectId: (id: string) => void;
      deselect: () => void;
      navigateBack: () => void;
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
    this.navBackHud?.addEventListener("click", () => {
      handlers.navigateBack();
    });
    this.panel.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      // Close button
      if (target.closest(".panel-close")) {
        handlers.deselect();
        return;
      }
      // Navigate back button
      if (target.closest(".panel-nav-back")) {
        handlers.navigateBack();
        return;
      }
      const button = target.closest<HTMLElement>("[data-node-id]");
      const id = button?.dataset.nodeId;
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
    if (this.navBackHud) this.navBackHud.style.display = "inline-flex";
    const physics = node.physics!;
    this.panel.replaceChildren();

    // Header row with name + navigate back button + close button
    const header = document.createElement("div");
    header.className = "panel-header";
    const heading = document.createElement("h2");
    heading.textContent = node.name;

    const navBackBtn = document.createElement("button");
    navBackBtn.className = "panel-nav-back";
    navBackBtn.title = "Navigate back to selected body";
    navBackBtn.setAttribute("aria-label", "Navigate back to selected body");
    const navIcon = document.createElement("i");
    navIcon.className = "bi bi-arrow-counterclockwise";
    navBackBtn.append(navIcon);

    const closeBtn = document.createElement("button");
    closeBtn.className = "panel-close";
    closeBtn.title = "Deselect (Esc)";
    closeBtn.textContent = "✕";
    header.append(heading, navBackBtn, closeBtn);

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
      relationDropdown("Dependencies", node.dependencies, (id) => this.handlers.selectId(id)),
      relationDropdown("Dependents", dependents.map((dependent) => dependent.id), (id) => this.handlers.selectId(id)),
    );
  }

  showEmpty(): void {
    if (this.navBackHud) this.navBackHud.style.display = "none";
    this.panel.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Select a body";
    const copy = document.createElement("p");
    copy.textContent = "Click a celestial body to inspect its metrics. Orbit trail renders automatically.";
    const nav = document.createElement("p");
    nav.className = "muted";
    nav.textContent = "Navigate: WASD (move) · Arrow keys (rotate/look around) · Q/E or scroll to zoom · Press Esc to deselect";
    this.panel.append(heading, copy, nav);
  }
}

function appendMetric(target: HTMLDListElement, label: string, value: string): void {
  const dt = document.createElement("dt"); dt.textContent = label;
  const dd = document.createElement("dd"); dd.textContent = value;
  target.append(dt, dd);
}

function relationDropdown(
  title: string,
  ids: readonly string[],
  onSelect: (id: string) => void,
): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = `${title} (${ids.length})`;

  if (ids.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = `No ${title.toLowerCase()}`;
    section.append(heading, empty);
    return section;
  }

  const select = document.createElement("select");
  select.className = "dependencies-dropdown";
  select.setAttribute("aria-label", `${title} list`);

  const singular = title === "Dependencies" ? "dependency" : "dependent";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = `— Select a ${singular} (${ids.length}) —`;
  defaultOption.selected = true;
  select.append(defaultOption);

  for (const id of ids) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    select.append(option);
  }

  select.addEventListener("change", () => {
    const id = select.value;
    if (id) {
      onSelect(id);
      select.value = "";
    }
  });

  section.append(heading, select);
  return section;
}
