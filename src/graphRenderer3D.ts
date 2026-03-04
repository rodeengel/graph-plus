import type { App } from "obsidian";
import type { GraphNode, GraphLink, GraphData, GraphLinkTypesSettings } from "./types";
import { UNTYPED_LINK_KEY } from "./types";

interface ForceGraph3DInstance {
  graphData(data: { nodes: any[]; links: any[] }): ForceGraph3DInstance;
  width(w: number): ForceGraph3DInstance;
  height(h: number): ForceGraph3DInstance;
  backgroundColor(c: string): ForceGraph3DInstance;
  nodeColor(fn: (node: any) => string): ForceGraph3DInstance;
  nodeLabel(fn: (node: any) => string): ForceGraph3DInstance;
  nodeVal(fn: (node: any) => number): ForceGraph3DInstance;
  linkColor(fn: (link: any) => string): ForceGraph3DInstance;
  linkLabel(fn: (link: any) => string): ForceGraph3DInstance;
  linkWidth(w: number | ((link: any) => number)): ForceGraph3DInstance;
  linkCurvature(v: number | string | ((link: any) => number)): ForceGraph3DInstance;
  linkDirectionalParticles(n: number): ForceGraph3DInstance;
  linkDirectionalArrowLength(n: number | ((link: any) => number)): ForceGraph3DInstance;
  linkDirectionalArrowRelPos(n: number): ForceGraph3DInstance;
  linkOpacity(n: number): ForceGraph3DInstance;
  onNodeClick(fn: (node: any) => void): ForceGraph3DInstance;
  onNodeRightClick(fn: (node: any) => void): ForceGraph3DInstance;
  d3Force(name: string, force?: any): any;
  d3ReheatSimulation(): ForceGraph3DInstance;
  zoomToFit(ms?: number, padding?: number): ForceGraph3DInstance;
  _destructor?(): void;
  pauseAnimation?(): void;
  resumeAnimation?(): void;
}

export class GraphRenderer3D {
  private container: HTMLElement;
  private wrapper: HTMLElement;
  private graph: ForceGraph3DInstance | null = null;
  private app: App;
  private settings: GraphLinkTypesSettings;
  private resizeObserver: ResizeObserver;
  private destroyed = false;
  private pendingData: GraphData | null = null;

  constructor(container: HTMLElement, app: App, settings: GraphLinkTypesSettings) {
    this.container = container;
    this.app = app;
    this.settings = settings;

    this.wrapper = document.createElement("div");
    this.wrapper.className = "glt-3d-container";
    this.wrapper.style.width = "100%";
    this.wrapper.style.height = "100%";
    this.container.appendChild(this.wrapper);

    this.resizeObserver = new ResizeObserver(() => {
      if (this.graph && !this.destroyed) {
        const rect = this.wrapper.getBoundingClientRect();
        this.graph.width(rect.width).height(rect.height);
      }
    });
    this.resizeObserver.observe(this.wrapper);

    this.initGraph();
  }

  private async initGraph(): Promise<void> {
    try {
      const ForceGraph3D = (await import("3d-force-graph")).default;
      if (this.destroyed) return;

      const rect = this.wrapper.getBoundingClientRect();
      this.graph = ForceGraph3D()(this.wrapper)
        .width(rect.width)
        .height(rect.height)
        .backgroundColor("rgba(0,0,0,0)")
        .nodeColor((node: any) => {
          if (node.groupColor) return node.groupColor;
          return this.settings.nodeColor;
        })
        .nodeLabel((node: any) => node.name)
        .nodeVal((node: any) => {
          const base = this.settings.nodeSize;
          if (!this.settings.scaleNodeByLinks || !node.linkCount) return base;
          return base * (1 + Math.sqrt(Math.max(0, node.linkCount - 1)) * 0.5);
        })
        .linkColor((link: any) => {
          const config = this.settings.linkTypes[link.type];
          return config?.color ?? "#888";
        })
        .linkLabel((link: any) => {
          if (link.type === UNTYPED_LINK_KEY) return "";
          return link.type;
        })
        .linkWidth(this.settings.linkThickness)
        .linkCurvature((link: any) => link.curvature ?? 0)
        .linkDirectionalArrowLength(this.settings.showArrows ? 6 * (this.settings.linkThickness / 1.5) : 0)
        .linkDirectionalArrowRelPos(1)
        .linkOpacity(this.settings.linkOpacity)
        .onNodeClick((node: any) => {
          this.app.workspace.openLinkText(node.id, "", false);
        })
        .onNodeRightClick((node: any) => {
          this.app.workspace.openLinkText(node.id, "", "tab");
        });

      // Configure forces
      const chargeForce = this.graph.d3Force("charge");
      if (chargeForce) chargeForce.strength(this.settings.chargeStrength);
      const centerForce = this.graph.d3Force("center");
      if (centerForce) centerForce.strength(this.settings.centerForce);
      const linkForce = this.graph.d3Force("link");
      if (linkForce) {
        linkForce.distance(this.settings.linkDistance);
        linkForce.strength(this.settings.linkStrength);
      }

      // Apply pending data if updateData was called before graph was ready
      if (this.pendingData) {
        this.applyData(this.pendingData);
        this.pendingData = null;
      }
    } catch (err) {
      console.error("Graph Link Types: Failed to initialize 3D renderer", err);
      this.wrapper.textContent = "3D rendering unavailable. Check console for errors.";
    }
  }

  updateData(data: GraphData): void {
    if (this.destroyed) return;

    if (!this.graph) {
      this.pendingData = data;
      return;
    }

    this.applyData(data);
  }

  private applyData(data: GraphData): void {
    if (!this.graph) return;

    const nodes = data.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      groupColor: n.groupColor,
      exists: n.exists,
      tags: n.tags,
      isAttachment: n.isAttachment,
      linkCount: n.linkCount,
    }));

    const links = data.links.map((l) => ({
      source: typeof l.source === "string" ? l.source : l.source.id,
      target: typeof l.target === "string" ? l.target : l.target.id,
      type: l.type,
      curvature: l.curvature,
    }));

    this.graph.graphData({ nodes, links });
  }

  /** Update forces and display settings without rebuilding data */
  updateSettings(): void {
    if (!this.graph) return;

    this.graph
      .linkWidth(this.settings.linkThickness)
      .linkDirectionalArrowLength(this.settings.showArrows ? 6 * (this.settings.linkThickness / 1.5) : 0)
      .linkOpacity(this.settings.linkOpacity)
      .nodeVal((node: any) => {
        const base = this.settings.nodeSize;
        if (!this.settings.scaleNodeByLinks || !node.linkCount) return base;
        return base * (1 + Math.sqrt(Math.max(0, node.linkCount - 1)) * 0.5);
      });

    const chargeForce = this.graph.d3Force("charge");
    if (chargeForce) chargeForce.strength(this.settings.chargeStrength);
    const centerForce = this.graph.d3Force("center");
    if (centerForce) centerForce.strength(this.settings.centerForce);
    const linkForce = this.graph.d3Force("link");
    if (linkForce) {
      linkForce.distance(this.settings.linkDistance);
      linkForce.strength(this.settings.linkStrength);
    }

    this.graph.d3ReheatSimulation();
  }

  /** Reset camera to fit all nodes */
  resetCamera(): void {
    if (!this.graph) return;
    this.graph.zoomToFit(400);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    if (this.graph) {
      if (typeof this.graph._destructor === "function") {
        this.graph._destructor();
      }
      if (typeof this.graph.pauseAnimation === "function") {
        this.graph.pauseAnimation();
      }
    }
    this.wrapper.innerHTML = "";
    this.wrapper.remove();
  }
}
