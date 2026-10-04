import type { App } from "obsidian";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { GraphNode, GraphLink, GraphData, GraphLinkTypesSettings, ExplicitRelation } from "./types";
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
  private onSelectRelation?: (relation: ExplicitRelation) => void;
  private relations: readonly ExplicitRelation[] = [];
  private selectedRelationId: string | null = null;
  private topologyKey: string | null = null;
  private selectionDirty = true;
  private layoutStopped = false;
  private pendingCamera: { position: any; quaternion: any; up: any; target: any } | null = null;

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

  constructor(container: HTMLElement, app: App, settings: GraphLinkTypesSettings,
    onSelectRelation?: (relation: ExplicitRelation) => void) {
    this.container = container;
    this.app = app;
    this.settings = settings;
    this.onSelectRelation = onSelectRelation;

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
    if (node.relation && this.THREE) return this.createJunctionObject(node);
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

  private getRelationColor(relation: ExplicitRelation): string {
    return this.settings.linkTypes[relation.type]?.color ?? "#888";
  }

  private getJunctionLabel(relation: ExplicitRelation): string {
    const count = this.getRelationDisplayCount(relation.id);
    const partial = count && count.displayed < count.total
      ? ` · ${count.displayed}/${count.total} shown (partial)` : "";
    return `${relation.sourceName} [${relation.id}]${partial}`;
  }

  /** A relationship is a scene object in three dimensions, not an entity sphere. */
  private createJunctionObject(node: any): any {
    const group = new this.THREE.Group();
    group.name = "gps-relationship-junction";
    const radius = Math.cbrt(this.getNodeVal(node)) * this.settings.nodeRelSize3D;
    const body = new this.THREE.Mesh(
      new this.THREE.OctahedronGeometry(radius * 1.25),
      new this.THREE.MeshBasicMaterial({
        color: this.getRelationColor(node.relation), transparent: true,
        opacity: this.settings.nodeOpacity3D,
      }),
    );
    body.name = "gps-junction-body";
    group.add(body);
    this.updateJunctionLabel(group, node.relation, radius);
    return group;
  }

  private updateJunctionLabel(object: any, relation: ExplicitRelation, radius: number): void {
    const text = this.getJunctionLabel(relation);
    const count = this.getRelationDisplayCount(relation.id);
    object.userData.relationId = relation.id;
    object.userData.displayedMemberCount = count?.displayed ?? 0;
    object.userData.totalMemberCount = relation.members.length;
    if (object.userData.labelText === text) return;
    const old = object.getObjectByName("gps-junction-label");
    if (old) {
      object.remove(old);
      old.material.map?.dispose();
      old.material.dispose();
    }
    const lines = [relation.sourceName, `[${relation.id}]`];
    if (count && count.displayed < count.total) lines.push(`${count.displayed}/${count.total} shown (partial)`);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = "24px sans-serif";
    canvas.width = Math.min(2048, Math.max(64, Math.ceil(Math.max(...lines.map((line) => context.measureText(line).width))) + 24));
    canvas.height = lines.length * 30 + 12;
    context.font = "24px sans-serif";
    context.fillStyle = "rgba(20, 20, 24, 0.78)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    lines.forEach((line, index) => context.fillText(line, canvas.width / 2, 21 + index * 30, canvas.width - 16));
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    const label = new this.THREE.Sprite(new this.THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, depthTest: false,
    }));
    label.name = "gps-junction-label";
    label.userData.text = text;
    const height = Math.max(16, radius * 2.5);
    label.scale.set(height * canvas.width / canvas.height, height, 1);
    label.position.y = radius * 1.25 + height / 2 + 3;
    label.renderOrder = 10;
    // Labels and selection shells do not enlarge the node's pointer target.
    label.raycast = () => {};
    object.add(label);
    object.userData.labelText = text;
  }

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
        .nodeLabel((node: any) => node.relation ? this.getJunctionLabel(node.relation) : node.name)
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
          this.selectNode(node);
        })
        .onNodeRightClick((node: any) => {
          this.selectNode(node, true);
        })
        .onNodeDrag(() => {
          // The library's drag handler resets its cooldown and alpha target.
          // Keep a paused graph at zero ticks; an animated drag may wake it.
          if (this.settings.animate && this.layoutStopped) {
            this.layoutStopped = false;
            this.graph?.cooldownTicks(Infinity);
          }
        })
        .onEngineTick(() => {
          this.restorePendingCamera();
          if (this.selectionDirty) {
            this.syncSelectionHighlights();
            this.updateJunctionLabels();
          }
        })
        .onEngineStop(() => {
          // The installed library resumes its engine after visual digests.
          // Zero cooldown ticks prevents a settled graph from taking even one
          // extra force step while its materials/objects are updated.
          this.layoutStopped = true;
          this.graph?.cooldownTicks(0);
          this.restorePendingCamera();
          if (this.selectionDirty) {
            this.syncSelectionHighlights();
            this.updateJunctionLabels();
          }
        });

      this.graph.cooldownTicks(this.settings.animate ? Infinity : 0).warmupTicks(0);
      this.layoutStopped = !this.settings.animate;

      this.attachFocusInteractions(this.graph.renderer().domElement);
      const navInfo = this.wrapper.querySelector<HTMLElement>(".scene-nav-info");
      if (navInfo) navInfo.textContent = "Left-drag: rotate, Wheel/middle-drag: zoom, Right-drag: pan, Middle-click node: focus";

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

    // Inspection can run before the asynchronous scene constructor completes.
    // Counts use the pending projection's nodes and the same authored records
    // immediately, so a carried selection does not leave a stale loading hint.
    this.relations = data.semantic?.relations ?? data.nodes.flatMap((node) => node.relation ? [node.relation] : []);

    if (!this.graph) {
      this.pendingData = data;
      return;
    }

    this.applyData(data);
  }

  private applyData(data: GraphData): void {
    if (!this.graph) return;
    this.relations = data.semantic?.relations ?? data.nodes.flatMap((node) => node.relation ? [node.relation] : []);
    const endpointId = (endpoint: string | GraphNode): string => typeof endpoint === "string" ? endpoint : endpoint.id;
    const topologyKey = JSON.stringify([
      data.nodes.map((node) => node.id).sort(),
      data.links.map((link) => JSON.stringify([
        endpointId(link.source), endpointId(link.target), link.type,
        link.kind ?? "", link.relationId ?? "", link.memberCount ?? 0, link.curvature,
      ])).sort(),
    ]);
    const previous = this.graph.graphData();
    const byId = new Map(previous.nodes.map((node: any) => [node.id, node]));
    const bySource = new Map(previous.nodes.map((node: any) => [node.relation?.sourcePath ?? node.id, node]));
    const reused = new Set<any>();
    const retainedIds = new Set<string>();
    let visualMetadataChanged = false;
    const nodes = data.nodes.map((node) => {
      const exact: any = byId.get(node.id);
      const source: any = bySource.get(node.relation?.sourcePath ?? node.id);
      const old = exact && !reused.has(exact) ? exact : source && !reused.has(source) ? source : null;
      const metadata = {
        ...node, tags: [...node.tags],
        properties: Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, [...value]])),
        relation: node.relation,
      };
      if (!old) return metadata;
      visualMetadataChanged ||= old.exists !== node.exists || old.groupColor !== node.groupColor
        || old.linkCount !== node.linkCount || old.relation?.type !== node.relation?.type
        || old.relation?.id !== node.relation?.id || old.relation?.sourceName !== node.relation?.sourceName;
      reused.add(old);
      retainedIds.add(node.id);
      const { x, y, z, vx, vy, vz, fx, fy, fz, index } = old;
      Object.assign(old, metadata, { x, y, z, vx, vy, vz, fx, fy, fz, index });
      return old;
    });
    this.selectionDirty = true;
    if (topologyKey === this.topologyKey) {
      // Force endpoints, scene objects and camera continue to refer to the
      // existing nodes. A metadata refresh never resets graphData or alpha.
      this.syncSelectionHighlights();
      this.updateJunctionLabels();
      if (visualMetadataChanged) this.updateSettings();
      return;
    }
    const nextBySource = new Map(nodes.map((node) => [node.relation?.sourcePath ?? node.id, node]));
    for (const node of nodes) {
      if (!node.relation || retainedIds.has(node.id)) continue;
      const positioned: any[] = node.relation.members.map((id: string) => nextBySource.get(id))
        .filter((member: any) => member && [member.x, member.y, member.z].every(Number.isFinite));
      if (positioned.length) {
        for (const axis of ["x", "y", "z"] as const) {
          node[axis] = positioned.reduce((sum: number, member: any) => sum + member[axis], 0) / positioned.length;
        }
      }
    }
    this.topologyKey = topologyKey;
    this.rebuildForceRuleCache();
    const initial = previous.nodes.length === 0;
    if (!initial) this.captureCamera();
    this.layoutStopped = !this.settings.animate;
    this.graph.cooldownTicks(this.settings.animate ? Infinity : 0)
      // One initial paused layout is useful; later filtering/projection changes
      // must never warm up or move surviving nodes behind the user's back.
      .warmupTicks(initial && !this.settings.animate ? 300 : 0);
    const links = data.links.map((link) => ({ ...link, source: endpointId(link.source), target: endpointId(link.target) }));
    // The library's graphData digest retains a reused node's custom scene
    // object. Projection changes must replace the sphere/octahedron accessor
    // while retaining that same node's layout state and force identity.
    if (visualMetadataChanged) this.graph.nodeThreeObject((node: any) => this.nodeThreeObjectFn(node));
    this.graph.graphData({ nodes, links });
  }

  /** Update visual display settings without reheating physics */
  updateSettings(): void {
    if (!this.graph) return;

    this.captureCamera();
    this.selectionDirty = true;
    this.graph
      .nodeColor((node: any) => node.groupColor || this.settings.nodeColor)
      .linkColor((link: any) => this.settings.linkTypes[link.type]?.color ?? "#888")
      .linkWidth((link: any) => this.getLinkWidth(link))
      .linkDirectionalArrowLength((link: any) =>
        this.shouldShowArrow(link) ? 6 * (this.getLinkWidth(link) / 1.5) : 0
      )
      .linkOpacity(this.settings.linkOpacity)
      .nodeOpacity(this.settings.nodeOpacity3D)
      .nodeRelSize(this.settings.nodeRelSize3D)
      .nodeVal((node: any) => this.getNodeVal(node))
      .nodeThreeObject((node: any) => this.nodeThreeObjectFn(node));
  }

  /** Only layout stepping pauses; WebGL rendering and navigation stay active. */
  setAnimate(animate: boolean): void {
    if (!this.graph || this.destroyed) return;
    this.graph.warmupTicks(0).cooldownTicks(animate ? Infinity : 0);
    this.layoutStopped = !animate;
    if (animate) this.graph.d3ReheatSimulation();
  }

  private selectNode(node: any, newTab = false): void {
    if (node.relation && !newTab && this.onSelectRelation) {
      this.setSelectedRelation(node.relation.id);
      this.onSelectRelation(node.relation);
      return;
    }
    this.app.workspace.openLinkText(node.relation?.sourcePath ?? node.id, "", newTab ? "tab" : false);
  }

  setSelectedRelation(id: string | null): void {
    this.selectedRelationId = id;
    this.selectionDirty = true;
    this.syncSelectionHighlights();
  }

  getDisplayedMemberIds(relation: ExplicitRelation): string[] {
    const nodes: any[] = this.graph?.graphData().nodes ?? this.pendingData?.nodes ?? [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const bySource = new Map(nodes.map((node) => [node.relation?.sourcePath ?? node.id, node]));
    const seen = new Set<string>();
    const members: string[] = [];
    for (const id of relation.members) {
      // Referencing another relation's source note selects its one junction,
      // never the nested relation's participants.
      const node = byId.get(id) ?? bySource.get(id);
      if (node && !seen.has(node.id)) {
        seen.add(node.id);
        members.push(node.id);
      }
    }
    return members;
  }

  getRelationDisplayCount(id: string): { displayed: number; total: number } | null {
    const relation = this.relations?.find((record) => record.id === id);
    return relation ? { displayed: this.getDisplayedMemberIds(relation).length, total: relation.members.length } : null;
  }

  private updateJunctionLabels(): void {
    if (!this.graph || !this.THREE) return;
    for (const node of this.graph.graphData().nodes as any[]) {
      if (!node.relation || !node.__threeObj) continue;
      const radius = Math.cbrt(this.getNodeVal(node)) * this.settings.nodeRelSize3D;
      this.updateJunctionLabel(node.__threeObj, node.relation, radius);
    }
  }

  private captureCamera(): void {
    if (!this.graph || this.pendingCamera || typeof this.graph.camera !== "function" || !this.graph.graphData().nodes.length) return;
    const camera = this.graph.camera();
    const controls = this.graph.controls() as any;
    this.pendingCamera = {
      position: camera.position.clone(), quaternion: camera.quaternion.clone(),
      up: camera.up.clone(), target: controls?.target?.clone() ?? null,
    };
  }

  private restorePendingCamera(): void {
    if (!this.graph || !this.pendingCamera) return;
    const camera = this.graph.camera();
    const controls = this.graph.controls() as any;
    camera.position.copy(this.pendingCamera.position);
    camera.quaternion.copy(this.pendingCamera.quaternion);
    camera.up.copy(this.pendingCamera.up);
    if (this.pendingCamera.target && controls?.target) controls.target.copy(this.pendingCamera.target);
    camera.updateMatrixWorld(true);
    this.pendingCamera = null;
  }

  private syncSelectionHighlights(): void {
    if (!this.graph || !this.THREE) return;
    const selected = this.relations?.find((relation) => relation.id === this.selectedRelationId);
    const visible = selected && this.settings.linkTypes[selected.type]?.visible !== false;
    const members = new Set(visible ? this.getDisplayedMemberIds(selected) : []);
    let ready = true;
    for (const node of this.graph.graphData().nodes as any[]) {
      const object = node.__threeObj;
      if (!object) { ready = false; continue; }
      const previous = object.getObjectByName("gps-semantic-selection");
      if (previous) {
        object.remove(previous);
        previous.geometry.dispose();
        previous.material.dispose();
      }
      if (!visible || (!members.has(node.id) && node.relation?.id !== selected.id)) continue;
      const radius = Math.cbrt(this.getNodeVal(node)) * this.settings.nodeRelSize3D;
      const geometry = node.relation ? new this.THREE.OctahedronGeometry(radius * 1.55)
        : new this.THREE.SphereGeometry(radius * 1.28, 16, 12);
      const shell = new this.THREE.Mesh(geometry, new this.THREE.MeshBasicMaterial({
        color: this.getRelationColor(selected), wireframe: true,
        transparent: true, opacity: 0.95, depthWrite: false,
      }));
      shell.name = "gps-semantic-selection";
      shell.userData.relationId = selected.id;
      shell.userData.directMember = members.has(node.id);
      shell.raycast = () => {};
      object.add(shell);
    }
    this.selectionDirty = !ready;
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
    this.captureCamera();
    this.selectionDirty = true;
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

    if (this.settings.animate) {
      this.layoutStopped = false;
      this.graph.cooldownTicks(Infinity).d3ReheatSimulation();
    }
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
