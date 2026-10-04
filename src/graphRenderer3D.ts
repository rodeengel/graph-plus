import type { App } from "obsidian";
import type { GraphNode, GraphLink, GraphData, GraphLinkTypesSettings } from "./types";
import { UNTYPED_LINK_KEY, parseForceRules, type ForceRule } from "./types";
import { forceX, forceY } from "d3-force";
// @ts-ignore — d3-force-3d is a transitive dep of 3d-force-graph
import { forceZ } from "d3-force-3d";

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
  nodeOpacity(n: number): ForceGraph3DInstance;
  nodeRelSize(n: number): ForceGraph3DInstance;
  onNodeClick(fn: (node: any) => void): ForceGraph3DInstance;
  onNodeRightClick(fn: (node: any) => void): ForceGraph3DInstance;
  nodeThreeObject(fn: ((node: any) => any) | null): ForceGraph3DInstance;
  nodeThreeObjectExtend(v: boolean): ForceGraph3DInstance;
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
  private THREE: any = null;
  private forceRuleCache = new Map<string, ForceRule[]>();

  constructor(container: HTMLElement, app: App, settings: GraphLinkTypesSettings) {
    this.container = container;
    this.app = app;
    this.settings = settings;

    this.wrapper = document.createElement("div");
    this.wrapper.className = "gps-3d-container";
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

  private getNodeVal(node: any): number {
    const base = this.settings.nodeSize;
    if (!this.settings.scaleNodeByLinks || !node.linkCount) return base;
    const s = 1 + Math.sqrt(Math.max(0, node.linkCount - 1)) * 0.5;
    return base * s * s * s;
  }

  private getLinkWidth(link: any): number {
    const multiplier = this.settings.linkTypes[link.type]?.widthMultiplier ?? 1;
    return Math.max(0.1, this.settings.linkThickness * multiplier);
  }

  private shouldShowArrow(link: any): boolean {
    const mode = this.settings.linkTypes[link.type]?.arrowMode ?? "inherit";
    if (mode === "on") return true;
    if (mode === "off") return false;
    return this.settings.showArrows;
  }

  private nodeThreeObjectFn = (node: any): any => {
    if (!node.exists && this.THREE) {
      const val = this.getNodeVal(node);
      const radius = Math.cbrt(val) * this.settings.nodeRelSize3D;
      const color = node.groupColor || this.settings.nodeColor;
      const geometry = new this.THREE.SphereGeometry(radius, 12, 8);
      const wireframe = new this.THREE.WireframeGeometry(geometry);
      const material = new this.THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: this.settings.nodeOpacity3D,
      });
      return new this.THREE.LineSegments(wireframe, material);
    }
    return undefined;
  };

  private async initGraph(): Promise<void> {
    try {
      const [ForceGraph3DModule, threeModule] = await Promise.all([
        import("3d-force-graph"),
        import("three"),
      ]);
      const ForceGraph3D = ForceGraph3DModule.default;
      this.THREE = threeModule;
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
        .nodeVal((node: any) => this.getNodeVal(node))
        .nodeThreeObject(this.nodeThreeObjectFn)
        .linkColor((link: any) => {
          const config = this.settings.linkTypes[link.type];
          return config?.color ?? "#888";
        })
        .linkLabel((link: any) => {
          if (link.type === UNTYPED_LINK_KEY) return "";
          return link.type;
        })
        .linkWidth((link: any) => this.getLinkWidth(link))
        .linkCurvature((link: any) => link.curvature ?? 0)
        .linkDirectionalArrowLength((link: any) =>
          this.shouldShowArrow(link) ? 6 * (this.getLinkWidth(link) / 1.5) : 0
        )
        .linkDirectionalArrowRelPos(1)
        .linkOpacity(this.settings.linkOpacity)
        .nodeOpacity(this.settings.nodeOpacity3D)
        .nodeRelSize(this.settings.nodeRelSize3D)
        .onNodeClick((node: any) => {
          this.app.workspace.openLinkText(node.id, "", false);
        })
        .onNodeRightClick((node: any) => {
          this.app.workspace.openLinkText(node.id, "", "tab");
        });

      // Configure forces — use forceX/Y/Z instead of forceCenter
      // (forceCenter only shifts center of mass, doesn't pull orphans back)
      const chargeForce = this.graph.d3Force("charge");
      if (chargeForce) chargeForce.strength(this.settings.chargeStrength);

      const centerStr = this.settings.centerForce * 0.1;
      this.graph.d3Force("center", null);
      this.graph.d3Force("x", forceX(0).strength(centerStr));
      this.graph.d3Force("y", forceY(0).strength(centerStr));
      this.graph.d3Force("z", forceZ(0).strength(centerStr));

      const linkForce = this.graph.d3Force("link");
      if (linkForce) {
        linkForce.distance((l: any) => this.getLinkDistance(l));
        linkForce.strength((l: any) => this.getLinkStrength(l));
      }

      // Custom link-type directional forces
      this.graph.d3Force("linkType", this.createLinkTypeForce());

      // Apply pending data if updateData was called before graph was ready
      if (this.pendingData) {
        this.applyData(this.pendingData);
        this.pendingData = null;
      }
    } catch (err) {
      console.error("Graph Plus Semantic: Failed to initialize 3D renderer", err);
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
    this.rebuildForceRuleCache();

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

  /** Update visual display settings without reheating physics */
  updateSettings(): void {
    if (!this.graph) return;

    this.graph
      .linkWidth((link: any) => this.getLinkWidth(link))
      .linkDirectionalArrowLength((link: any) =>
        this.shouldShowArrow(link) ? 6 * (this.getLinkWidth(link) / 1.5) : 0
      )
      .linkOpacity(this.settings.linkOpacity)
      .nodeOpacity(this.settings.nodeOpacity3D)
      .nodeRelSize(this.settings.nodeRelSize3D)
      .nodeVal((node: any) => this.getNodeVal(node))
      .nodeThreeObject(this.nodeThreeObjectFn);
  }

  /** Update force parameters and reheat the simulation */
  updateForces(): void {
    if (!this.graph) return;
    this.rebuildForceRuleCache();

    const chargeForce = this.graph.d3Force("charge");
    if (chargeForce) chargeForce.strength(this.settings.chargeStrength);

    const centerStr = this.settings.centerForce * 0.1;
    const xForce = this.graph.d3Force("x");
    if (xForce) xForce.strength(centerStr);
    const yForce = this.graph.d3Force("y");
    if (yForce) yForce.strength(centerStr);
    const zForce = this.graph.d3Force("z");
    if (zForce) zForce.strength(centerStr);

    const linkForce = this.graph.d3Force("link");
    if (linkForce) {
      linkForce.distance((l: any) => this.getLinkDistance(l));
      linkForce.strength((l: any) => this.getLinkStrength(l));
    }

    this.graph.d3ReheatSimulation();
  }

  /** Reset camera to fit all nodes */
  resetCamera(): void {
    if (!this.graph) return;
    this.graph.zoomToFit(400);
  }

  private rebuildForceRuleCache(): void {
    this.forceRuleCache.clear();
    for (const [type, config] of Object.entries(this.settings.linkTypes)) {
      if (config.forceRule) {
        this.forceRuleCache.set(type, parseForceRules(config.forceRule));
      }
    }
  }

  private getLinkDistance(link: any): number {
    const config = this.settings.linkTypes[link.type];
    let multiplier = config?.distanceMultiplier ?? 1;

    const rules = this.forceRuleCache.get(link.type);
    if (rules) {
      const distRule = rules.find((r) => r.type === "distance");
      if (distRule) multiplier *= distRule.value;
    }

    return this.settings.linkDistance * Math.max(0.01, multiplier);
  }

  private getLinkStrength(link: any): number {
    const attraction = this.settings.linkTypes[link.type]?.attraction ?? 1;
    return this.settings.linkStrength * Math.max(0, attraction);
  }

  private createLinkTypeForce(): (alpha: number) => void {
    return (alpha: number) => {
      if (!this.graph) return;
      const linkForce = this.graph.d3Force("link");
      if (!linkForce) return;
      const links = linkForce.links();

      for (const link of links) {
        const source = link.source;
        const target = link.target;
        if (!source || !target) continue;

        const rules = this.forceRuleCache.get(link.type);
        if (!rules) continue;

        for (const rule of rules) {
          if (rule.type !== "direction") continue;
          const str = rule.value * 50 * alpha;
          switch (rule.dir) {
            case "down": target.vy = (target.vy || 0) - str; break;
            case "up": target.vy = (target.vy || 0) + str; break;
            case "right": target.vx = (target.vx || 0) + str; break;
            case "left": target.vx = (target.vx || 0) - str; break;
            case "forward": target.vz = (target.vz || 0) - str; break;
            case "backward": target.vz = (target.vz || 0) + str; break;
          }
        }
      }
    };
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
    this.wrapper.empty();
    this.wrapper.remove();
  }
}
