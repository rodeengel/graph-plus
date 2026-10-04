import type { App } from "obsidian";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { GraphNode, GraphLink, GraphData, GraphLinkTypesSettings } from "./types";
import { UNTYPED_LINK_KEY, parseForceRules, getEffectiveLinkStrength, getMembershipLinkStrength, type ForceRule } from "./types";
import { applyNodeGroups } from "./linkParser";
import { forceX, forceY } from "d3-force";
// @ts-expect-error — d3-force-3d does not ship TypeScript declarations.
import { forceZ } from "d3-force-3d";

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
  private focusCanvas: HTMLCanvasElement | null = null;
  private middleClick: { pointerId: number; x: number; y: number; node: any; dragged: boolean } | null = null;
  private suppressMiddleAuxClick = false;

  private onMiddlePointerDown = (event: PointerEvent): void => this.startMiddleClick(event);
  private onMiddlePointerMove = (event: PointerEvent): void => this.moveMiddleClick(event);
  private onMiddlePointerUp = (event: PointerEvent): void => this.endMiddleClick(event);
  private onMiddlePointerCancel = (): void => { this.middleClick = null; };
  private onMiddleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1 && this.suppressMiddleAuxClick) {
      event.preventDefault();
      this.suppressMiddleAuxClick = false;
    }
  };

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
    if (link.kind === "membership") return false;
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
      this.graph = new ForceGraph3D(this.wrapper)
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

      this.attachFocusInteractions(this.graph.renderer().domElement);

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
      properties: n.properties,
      isAttachment: n.isAttachment,
      linkCount: n.linkCount,
    }));

    const links = data.links.map((l) => ({
      source: typeof l.source === "string" ? l.source : l.source.id,
      target: typeof l.target === "string" ? l.target : l.target.id,
      type: l.type,
      curvature: l.curvature,
      kind: l.kind,
      relationId: l.relationId,
      memberCount: l.memberCount,
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

  /** Recolor the current nodes without replacing data or reheating physics. */
  updateNodeGroups(): void {
    if (this.destroyed) return;
    if (!this.graph) {
      if (this.pendingData) {
        applyNodeGroups(this.pendingData.nodes, this.settings.nodeGroups);
      }
      return;
    }

    applyNodeGroups(this.graph.graphData().nodes as GraphNode[], this.settings.nodeGroups);
    this.graph
      .nodeColor((node: any) => node.groupColor || this.settings.nodeColor)
      // A new accessor invalidates custom wireframes as well as default spheres.
      .nodeThreeObject((node: any) => this.nodeThreeObjectFn(node));
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

  private attachFocusInteractions(canvas: HTMLCanvasElement): void {
    this.focusCanvas = canvas;
    // In the installed libraries, navigation controls register synchronously
    // during graph construction. Node DragControls register later, after the
    // asynchronous data digest, and are recreated after later data updates.
    // Bubble ordering lets navigation see middle presses first, then prevents
    // the node dragger from pinning/reheating nodes for that same gesture.
    canvas.addEventListener("pointerdown", this.onMiddlePointerDown);
    canvas.addEventListener("pointermove", this.onMiddlePointerMove, true);
    canvas.addEventListener("pointerup", this.onMiddlePointerUp, true);
    canvas.addEventListener("pointercancel", this.onMiddlePointerCancel, true);
    canvas.addEventListener("auxclick", this.onMiddleAuxClick);
  }

  private startMiddleClick(event: PointerEvent): void {
    if (event.button !== 1 || this.destroyed) return;
    this.suppressMiddleAuxClick = false;
    const node = this.pickNodeAt(event.clientX, event.clientY);
    this.middleClick = node ? {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, node, dragged: false,
    } : null;
    event.stopImmediatePropagation();
    // The renderer tracks presses on the canvas parent. Forward the press only
    // to that parent, so its normal move/up handlers can clear drag/hover state
    // without sending a second press to navigation or the node dragger.
    this.focusCanvas?.parentElement?.dispatchEvent(new PointerEvent("pointerdown", event));
    // Prevent native autoscroll on a node, without blocking pointer events from
    // the graph's navigation controls. A moved gesture still remains a zoom.
    if (node) event.preventDefault();
  }

  private moveMiddleClick(event: PointerEvent): void {
    const click = this.middleClick;
    if (!click || click.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) click.dragged = true;
  }

  private endMiddleClick(event: PointerEvent): void {
    const click = this.middleClick;
    if (!click || click.pointerId !== event.pointerId || event.button !== 1) return;
    this.middleClick = null;
    if (click.dragged || Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) return;
    if (!this.graph?.graphData().nodes.includes(click.node)) return;
    this.focusNode(click.node);
    this.suppressMiddleAuxClick = true;
    event.preventDefault();
  }

  private pickNodeAt(clientX: number, clientY: number): any | null {
    if (!this.graph || !this.THREE || !this.focusCanvas) return null;
    const rect = this.focusCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const camera = this.graph.camera();
    this.graph.scene().updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const raycaster = new this.THREE.Raycaster();
    raycaster.setFromCamera(new this.THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ), camera);
    // Use the library's current displayed objects, including missing-note
    // wireframes. This does not depend on its throttled hover state.
    const objects = this.graph.graphData().nodes
      .map((node: any) => node.__threeObj)
      .filter((object: any) => object && object.visible !== false);
    for (const hit of raycaster.intersectObjects(objects, true)) {
      let object = hit.object;
      while (object && !Object.prototype.hasOwnProperty.call(object, "__graphObjType")) object = object.parent;
      if (object?.__graphObjType === "node") return object.__data ?? null;
    }
    return null;
  }

  private focusNode(node: any): void {
    if (!this.graph || this.destroyed || ![node.x, node.y, node.z].every(Number.isFinite)) return;
    const position = this.graph.cameraPosition();
    const controls = this.graph.controls() as { target?: { x: number; y: number; z: number } };
    const target = controls.target ?? (position as any).lookAt ?? { x: 0, y: 0, z: 0 };
    if (![position.x, position.y, position.z, target.x, target.y, target.z].every(Number.isFinite)) return;
    // Translate the camera and its target together: orientation and current
    // camera-to-target distance stay unchanged, and no layout state is touched.
    this.graph.cameraPosition({
      x: position.x + node.x - target.x,
      y: position.y + node.y - target.y,
      z: position.z + node.z - target.z,
    }, { x: node.x, y: node.y, z: node.z });
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
    if (link.kind === "membership") return getMembershipLinkStrength(this.settings.linkStrength, attraction, link.memberCount);
    return getEffectiveLinkStrength(this.settings.linkStrength, attraction);
  }

  private createLinkTypeForce(): (alpha: number) => void {
    return (alpha: number) => {
      if (!this.graph) return;
      const linkForce = this.graph.d3Force("link");
      if (!linkForce) return;
      const links = linkForce.links();

      for (const link of links) {
        if (link.kind === "membership") continue;
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
    if (this.focusCanvas) {
      this.focusCanvas.removeEventListener("pointerdown", this.onMiddlePointerDown);
      this.focusCanvas.removeEventListener("pointermove", this.onMiddlePointerMove, true);
      this.focusCanvas.removeEventListener("pointerup", this.onMiddlePointerUp, true);
      this.focusCanvas.removeEventListener("pointercancel", this.onMiddlePointerCancel, true);
      this.focusCanvas.removeEventListener("auxclick", this.onMiddleAuxClick);
      this.focusCanvas = null;
    }
    this.middleClick = null;
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
