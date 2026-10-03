import "./style.css";
import type { UniverseNode } from "../shared/universe-types.ts";
import { UniverseJsonDataSource } from "./data/loader.ts";
import { createInitialState } from "./physics/initial-conditions.ts";
import { simulatedMass } from "./physics/constants.ts";
import type { PhysicsWorkerRequest, PhysicsWorkerResponse } from "./physics/worker-protocol.ts";
import { CELESTIAL_TYPE_INDEX } from "./physics/worker-protocol.ts";
import { RenderCharacteristicMapper } from "./render/characteristics.ts";
import { UniverseRenderer } from "./render/universe-renderer.ts";
import { UniverseInterface } from "./ui/interface.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#universe-canvas")!;
const loading = document.querySelector<HTMLElement>("#loading")!;

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    const universe = await new UniverseJsonDataSource().load();
    const mapper = new RenderCharacteristicMapper();
    const characteristics = universe.nodes.map((node) => mapper.mapNode(node));
    const indices = new Map(universe.nodes.map((node, index) => [node.id, index]));
    const types = new Uint8Array(universe.nodes.length);
    const parentIndices = new Int32Array(universe.nodes.length).fill(-1);
    const masses = new Float32Array(universe.nodes.length);
    for (let index = 0; index < universe.nodes.length; index++) {
      const node = universe.nodes[index]!;
      types[index] = CELESTIAL_TYPE_INDEX[node.celestialType!];
      parentIndices[index] = node.parentId ? indices.get(node.parentId) ?? -1 : -1;
      masses[index] = simulatedMass(node.physics!.mass);
    }
    const initial = createInitialState(universe.nodes.map((node, index) => ({
      id: node.id, type: node.celestialType!, activity: node.physics!.activity, mass: masses[index]!, parentIndex: parentIndices[index]!,
    })));
    // The renderer has a one-time copy until its first transferred worker state.
    const renderer = new UniverseRenderer(
      canvas,
      universe,
      characteristics,
      new Float32Array(initial.positions),
      new Float32Array(initial.velocities),
      initial.hostIndices,
      new Float32Array(masses),
    );
    const nodeById = new Map(universe.nodes.map((node) => [node.id, node]));
    const dependents = new Map<string, UniverseNode[]>();
    for (const edge of universe.edges) {
      const source = nodeById.get(edge.source);
      if (source) (dependents.get(edge.target) ?? dependents.set(edge.target, []).get(edge.target)!).push(source);
    }
    let worker: Worker;
    const select = (index: number) => {
      renderer.setSelected(index);
      const node = universe.nodes[index];
      if (node) ui.showNode(node, dependents.get(node.id) ?? []);
      else ui.showEmpty();
    };
    const deselect = () => {
      renderer.deselect();
      ui.showEmpty();
    };
    const ui = new UniverseInterface(universe, {
      pause: (paused) => worker.postMessage({ kind: paused ? "pause" : "resume" } satisfies PhysicsWorkerRequest),
      timeScale: (value) => worker.postMessage({ kind: "setTimeScale", value } satisfies PhysicsWorkerRequest),
      selectId: (id) => { const index = indices.get(id); if (index !== undefined) select(index); },
      deselect,
    });
    ui.showEmpty();
    worker = new Worker(new URL("./physics/physics.worker.ts", import.meta.url), { type: "module" });
    let lease: { positions: ArrayBuffer; velocities: ArrayBuffer } | null = null;
    worker.onmessage = (event: MessageEvent<PhysicsWorkerResponse>) => {
      const message = event.data;
      if (message.kind === "initialized") {
        renderer.setStatic(new Float32Array(message.scales), new Float32Array(message.brightness));
      } else if (message.kind === "state") {
        renderer.setState(new Float32Array(message.positions), new Float32Array(message.velocities));
        if (lease) worker.postMessage({ kind: "recycle", ...lease } satisfies PhysicsWorkerRequest, [lease.positions, lease.velocities]);
        lease = { positions: message.positions, velocities: message.velocities };
        ui.addPhysicsSteps(message.steps);
      } else if (message.kind === "error") {
        showError(`Physics worker error: ${message.message}`);
      }
    };
    worker.onerror = (event) => showError(`Physics worker error: ${event.message}`);
    const scales = new Float32Array(characteristics.map((characteristic) => characteristic.scale));
    const brightness = new Float32Array(characteristics.map((characteristic) => characteristic.brightness));
    worker.postMessage({ kind: "init", positions: initial.positions.buffer, velocities: initial.velocities.buffer, masses: masses.buffer, parentIndices: parentIndices.buffer, types: types.buffer, scales: scales.buffer, brightness: brightness.buffer }, [initial.positions.buffer, initial.velocities.buffer, masses.buffer, parentIndices.buffer, types.buffer, scales.buffer, brightness.buffer]);
    loading.remove();

    canvas.addEventListener("mousemove", (event) => {
      const picked = renderer.pick(event.clientX, event.clientY);
      renderer.setHovered(picked ?? -1);
      canvas.style.cursor = picked === null ? "grab" : "pointer";
    });
    canvas.addEventListener("click", (event) => {
      const picked = renderer.pick(event.clientX, event.clientY);
      if (picked !== null) select(picked);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        deselect();
      }
    });
    const animate = () => {
      const counts = renderer.render();
      ui.frame(counts.rendered);
      requestAnimationFrame(animate);
    };
    animate();
    window.addEventListener("beforeunload", () => { if (lease) worker.postMessage({ kind: "recycle", ...lease }, [lease.positions, lease.velocities]); worker.terminate(); renderer.dispose(); }, { once: true });
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function showError(message: string): void {
  loading.className = "error";
  loading.textContent = `${message} Run npm run collect, then npm run params and npm run classify (or npm run pipeline).`;
}
