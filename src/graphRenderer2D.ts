import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { select, pointer } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior, type D3ZoomEvent } from "d3-zoom";
import { drag, type D3DragEvent } from "d3-drag";
import type { App } from "obsidian";
import type {
  GraphNode,
  GraphLink,
  GraphData,
  GraphLinkTypesSettings,
  LinkTypeConfig,
  LinkLineStyle,
  ExplicitRelation,
} from "./types";
import { UNTYPED_LINK_KEY, parseForceRules, getEffectiveLinkStrength, getMembershipLinkStrength, type ForceRule } from "./types";
import { applyNodeGroups } from "./linkParser";
import { buildRelationRegionGeometry, type RegionGeometry } from "./relationRegions";

type DisplayMemberIndex = { byId: Map<string, GraphNode>; bySource: Map<string, GraphNode> };

export class GraphRenderer2D {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private simulation: Simulation<GraphNode, GraphLink>;
  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];
  private settings: GraphLinkTypesSettings;
  private app: App;
  private onSelectRelation?: (relation: ExplicitRelation) => void;
  private topologyKey = "";
  private relations: readonly ExplicitRelation[] = [];
  private selectedRelationId: string | null = null;

  private zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown>;
  private transform = zoomIdentity;
  private resizeObserver: ResizeObserver;

  private hoveredNode: GraphNode | null = null;
  private tooltip: HTMLElement;
  private contextMenu: HTMLElement | null = null;
  private middleClick: { node: GraphNode; x: number; y: number; dragged: boolean } | null = null;
  private cancelMiddleClick = (): void => { this.middleClick = null; };

  private width = 0;
  private height = 0;
  private dpr = 1;
  private destroyed = false;

  // Resolved CSS fallback colors
  private resolvedTextColor: string;
  private resolvedBgColor: string;

  // Cached parsed force rules per link type
  private forceRuleCache = new Map<string, ForceRule[]>();

  constructor(container: HTMLElement, app: App, settings: GraphLinkTypesSettings,
    onSelectRelation?: (relation: ExplicitRelation) => void) {
    this.container = container;
    this.app = app;
    this.settings = settings;
    this.onSelectRelation = onSelectRelation;

    // Resolve CSS variables at construction time for Canvas compatibility
    const cs = getComputedStyle(container);
    this.resolvedTextColor = cs.getPropertyValue("--text-normal").trim() || "#ddd";
    this.resolvedBgColor = cs.getPropertyValue("--background-primary").trim() || "#1e1e1e";

    // Create canvas
    this.canvas = document.createElement("canvas");
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    // Tooltip
    this.tooltip = document.createElement("div");
    this.tooltip.className = "gps-tooltip";
    this.tooltip.style.display = "none";
    this.container.appendChild(this.tooltip);

    // Sizing
    this.dpr = window.devicePixelRatio || 1;
    this.updateSize();

    // Simulation — use forceX/forceY instead of forceCenter for per-node centering
    this.simulation = forceSimulation<GraphNode>()
      .force("charge", forceManyBody().strength(settings.chargeStrength))
      .force("x", forceX(this.width / 2).strength(settings.centerForce * 0.1))
      .force("y", forceY(this.height / 2).strength(settings.centerForce * 0.1))
      .force("collide", forceCollide(settings.nodeSize + 2).strength(settings.collisionForce))
      .force("linkType", this.createLinkTypeForce())
      .on("tick", () => this.render());

    if (!settings.animate) {
      this.simulation.stop();
    }

    // Zoom
    this.zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        this.transform = event.transform;
        this.render();
      });

    // Drag — registered BEFORE zoom so stopImmediatePropagation prevents
    // zoom from panning while dragging a node
    const dragBehavior = drag<HTMLCanvasElement, unknown>()
      .subject((event) => this.findNode(event.x, event.y))
      .on("start", (event: D3DragEvent<HTMLCanvasElement, unknown, GraphNode>) => {
        this.startNodeDrag(event.subject, event.active);
      })
      .on("drag", (event: D3DragEvent<HTMLCanvasElement, unknown, GraphNode>) => {
        // Use pointer to get raw mouse position, then inverse-transform to graph space
        const [mx, my] = pointer(event.sourceEvent, this.canvas);
        this.moveNodeDrag(event.subject, mx, my);
      })
      .on("end", (event: D3DragEvent<HTMLCanvasElement, unknown, GraphNode>) => {
        this.endNodeDrag(event.subject, event.active);
      });

    const sel = select(this.canvas);
    sel.call(dragBehavior as any);
    sel.call(this.zoomBehavior as any);

    // Mouse events for hover and click
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("click", this.onClick);
    this.onMiddleMouseDown = this.onMiddleMouseDown.bind(this);
    this.onAuxClick = this.onAuxClick.bind(this);
    this.canvas.addEventListener("mousedown", this.onMiddleMouseDown);
    this.canvas.addEventListener("auxclick", this.onAuxClick);
    this.canvas.addEventListener("mouseleave", this.cancelMiddleClick);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("click", this.dismissContextMenu);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
  }

  updateData(data: GraphData): void {
    // Filtering and simulation never reduce the authored membership record.
    // Refresh it even when the displayed topology has not changed.
    this.relations = data.semantic?.relations ?? data.nodes.flatMap((node) => node.relation ? [node.relation] : []);
    const endpointId = (endpoint: string | GraphNode): string =>
      typeof endpoint === "string" ? endpoint : endpoint.id;
    const topologyKey = JSON.stringify([
      data.nodes.map((node) => node.id).sort(),
      data.links.map((link) => JSON.stringify([
        endpointId(link.source), endpointId(link.target), link.type,
        link.kind ?? "", link.relationId ?? "", link.memberCount ?? 0, link.curvature,
      ])).sort(),
    ]);
    const sameTopology = topologyKey === this.topologyKey;
    const previousNodes = new Map(this.nodes.map((node) => [node.id, node]));
    const previousNodesBySource = new Map(this.nodes.map((node) => [node.relation?.sourcePath ?? node.id, node]));
    const reusedNodes = new Set<GraphNode>();
    const retainedIds = new Set<string>();
    const initialLoad = this.nodes.length === 0;
    const nextNodes: GraphNode[] = data.nodes.map((node) => {
      const exact = previousNodes.get(node.id);
      const source = previousNodesBySource.get(node.relation?.sourcePath ?? node.id);
      // A source note and its junction are representations of the same authored
      // relation. Prefer exact entity IDs, then carry layout across projection.
      const previous = exact && !reusedNodes.has(exact) ? exact
        : source && !reusedNodes.has(source) ? source : undefined;
      // Layout state belongs to this renderer, never to the authored model.
      const metadata = {
        ...node,
        tags: [...node.tags],
        properties: Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, [...value]])),
        groupColor: node.groupColor,
        linkCount: node.linkCount,
        relation: node.relation,
      };
      if (!previous) return metadata;
      reusedNodes.add(previous);
      retainedIds.add(node.id);
      const { x, y, vx, vy, fx, fy, index } = previous;
      Object.assign(previous, metadata, { x, y, vx, vy, fx, fy, index });
      return previous;
    });
    if (sameTopology) {
      // Existing force endpoints still point at these same objects. Metadata
      // refreshes do not restart physics or replace the camera transform.
      this.render();
      return;
    }
    const nextNodesById = new Map(nextNodes.map((node) => [node.id, node]));
    const nextNodesBySource = new Map(nextNodes.map((node) => [node.relation?.sourcePath ?? node.id, node]));
    for (const node of nextNodes) {
      if (!node.relation || retainedIds.has(node.id)) continue;
      const positionedMembers = node.relation.members
        .map((id) => nextNodesBySource.get(id))
        .filter((member): member is GraphNode => !!member && Number.isFinite(member.x) && Number.isFinite(member.y));
      if (positionedMembers.length) {
        node.x = positionedMembers.reduce((sum, member) => sum + member.x!, 0) / positionedMembers.length;
        node.y = positionedMembers.reduce((sum, member) => sum + member.y!, 0) / positionedMembers.length;
      }
    }
    this.topologyKey = topologyKey;
    this.nodes = nextNodes;
    if (this.hoveredNode) this.hoveredNode = nextNodesById.get(this.hoveredNode.id) ?? null;
    this.links = data.links.map((l) => ({
      ...l,
      source: endpointId(l.source),
      target: endpointId(l.target),
    })) as GraphLink[];

    this.rebuildForceRuleCache();
    this.simulation.nodes(this.nodes);
    this.simulation.force(
      "link",
      forceLink<GraphNode, GraphLink>(this.links)
        .id((d) => d.id)
        .distance((l: any) => this.getLinkDistance(l))
        .strength((l: any) => this.getLinkStrength(l))
    );
    this.simulation.alpha(1).restart();

    if (!this.settings.animate) {
      this.simulation.stop();
      // Initial paused graphs still settle as before; later topology refreshes
      // respect the pause and retain the existing entities' positions.
      if (initialLoad) for (let i = 0; i < 300; i++) this.simulation.tick();
      this.render();
    }
  }

  /** Update visual display settings without reheating physics */
  updateSettings(): void {
    this.render();
  }

  /** Relationship selection is presentation state, independent of layout. */
  setSelectedRelation(id: string | null): void {
    this.selectedRelationId = id;
    this.render();
  }

  getDisplayedMemberIds(relation: ExplicitRelation): string[] {
    return this.getDisplayedMembers(relation).map((node) => node.id);
  }

  getRelationDisplayCount(id: string): { displayed: number; total: number } | null {
    const relation = this.getExplicitRelations().find((record) => record.id === id);
    return relation ? { displayed: this.getDisplayedMemberIds(relation).length, total: relation.members.length } : null;
  }

  private getExplicitRelations(): readonly ExplicitRelation[] {
    return this.relations ?? this.nodes.flatMap((node) => node.relation ? [node.relation] : []);
  }

  private createMemberIndex(): DisplayMemberIndex {
    return {
      byId: new Map(this.nodes.map((node) => [node.id, node])),
      bySource: new Map(this.nodes.map((node) => [node.relation?.sourcePath ?? node.id, node])),
    };
  }

  private getDisplayedMembers(relation: ExplicitRelation, index = this.createMemberIndex()): GraphNode[] {
    const members: GraphNode[] = [];
    const seen = new Set<string>();
    for (const id of relation.members) {
      const node = index.byId.get(id) ?? index.bySource.get(id);
      if (node && !seen.has(node.id)) {
        seen.add(node.id);
        members.push(node);
      }
    }
    return members;
  }

  private getRelationRegions(memberIndex?: DisplayMemberIndex): { relation: ExplicitRelation; members: GraphNode[]; geometry: RegionGeometry }[] {
    if (!this.settings.hypergraph2D || !this.settings.hyperrelationRegions) return [];
    const index = memberIndex ?? this.createMemberIndex();
    const visibleJunctions = new Set(this.nodes.flatMap((node) => node.relation ? [node.relation.id] : []));
    const regions = [];
    for (const relation of this.getExplicitRelations()) {
      // A filtered source junction has no region; regions cannot bypass the
      // existing source-note or relationship-type filters.
      if (!visibleJunctions.has(relation.id) || this.settings.linkTypes[relation.type]?.visible === false) continue;
      const members = this.getDisplayedMembers(relation, index);
      const geometry = buildRelationRegionGeometry(members
        .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y))
        .map((node) => ({ x: node.x!, y: node.y!, radius: this.getNodeRadius(node) })));
      if (geometry) regions.push({ relation, members, geometry });
    }
    // Keep a selected border legible when same-color regions overlap.
    return regions.sort((a, b) => Number(a.relation.id === this.selectedRelationId) - Number(b.relation.id === this.selectedRelationId));
  }

  private drawRelationRegions(regions: { relation: ExplicitRelation; members: GraphNode[]; geometry: RegionGeometry }[]): void {
    const ctx = this.ctx;
    const scale = this.transform.k;
    const opacity = Number.isFinite(this.settings.regionFillOpacity)
      ? Math.max(0, Math.min(0.3, this.settings.regionFillOpacity)) : 0.08;
    for (const { relation, members, geometry } of regions) {
      const selected = relation.id === this.selectedRelationId;
      const color = this.settings.linkTypes[relation.type]?.color ?? "#888";
      ctx.save();
      ctx.beginPath();
      geometry.vertices.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = selected ? 0.9 : 0.4;
      ctx.lineWidth = (selected ? 2.4 : 1.2) / scale;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = `${selected ? "600 " : ""}${12 / scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = this.resolvedBgColor;
      const partial = members.length < relation.members.length;
      const label = `${relation.sourceName} [${relation.id}]${partial ? ` · ${members.length}/${relation.members.length} shown (partial)` : ""}`;
      const labelY = geometry.bounds.minY - 4 / scale;
      ctx.strokeText(label, geometry.center.x, labelY);
      ctx.fillStyle = this.resolvedTextColor;
      ctx.fillText(label, geometry.center.x, labelY);
      ctx.restore();
    }
  }

  /** Recolor the current nodes without replacing data or reheating physics. */
  updateNodeGroups(): void {
    if (this.destroyed) return;
    applyNodeGroups(this.nodes, this.settings.nodeGroups);
    this.render();
  }

  /** Update force parameters and reheat simulation */
  updateForces(): void {
    this.rebuildForceRuleCache();

    const charge = this.simulation.force("charge") as any;
    if (charge) charge.strength(this.settings.chargeStrength);

    const xForce = this.simulation.force("x") as any;
    if (xForce) xForce.strength(this.settings.centerForce * 0.1);
    const yForce = this.simulation.force("y") as any;
    if (yForce) yForce.strength(this.settings.centerForce * 0.1);

    const link = this.simulation.force("link") as any;
    if (link) {
      link.distance((l: any) => this.getLinkDistance(l));
      link.strength((l: any) => this.getLinkStrength(l));
    }

    const collide = this.simulation.force("collide") as any;
    if (collide) {
      collide.radius(this.settings.nodeSize + 2);
      collide.strength(this.settings.collisionForce);
    }

    this.simulation.alpha(0.3).restart();

    if (!this.settings.animate) {
      this.simulation.stop();
    }

    this.render();
  }

  /** Reset view to fit all nodes */
  resetView(): void {
    if (this.nodes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of this.nodes) {
      if (node.x == null || node.y == null) continue;
      const r = this.getNodeRadius(node);
      if (node.x - r < minX) minX = node.x - r;
      if (node.y - r < minY) minY = node.y - r;
      if (node.x + r > maxX) maxX = node.x + r;
      if (node.y + r > maxY) maxY = node.y + r;
    }

    if (!isFinite(minX)) return;

    const padding = 40;
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const scale = Math.min(
      (this.width - padding * 2) / bw,
      (this.height - padding * 2) / bh,
      8 // max zoom
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = this.width / 2 - cx * scale;
    const ty = this.height / 2 - cy * scale;

    const newTransform = zoomIdentity.translate(tx, ty).scale(scale);
    select(this.canvas)
      .transition()
      .duration(400)
      .call(this.zoomBehavior.transform as any, newTransform);
  }

  /** Start or stop the simulation */
  setAnimate(running: boolean): void {
    if (running) {
      this.simulation.alpha(0.3).restart();
    } else {
      this.simulation.stop();
    }
  }

  private updateSize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private handleResize(): void {
    if (this.destroyed) return;
    this.updateSize();
    const xForce = this.simulation.force("x") as any;
    const yForce = this.simulation.force("y") as any;
    if (xForce) xForce.x(this.width / 2);
    if (yForce) yForce.y(this.height / 2);
    // Switching tabs also resizes the canvas. A paused graph must redraw at
    // its existing positions rather than quietly resuming its simulation.
    if (this.settings.animate) this.simulation.alpha(0.1).restart();
    this.render();
  }

  private startNodeDrag(node: GraphNode, active: number): void {
    // d3 also starts a drag on a plain click. Inspection must respect pause.
    if (!active && this.settings.animate) this.simulation.alphaTarget(0.3).restart();
    node.fx = node.x;
    node.fy = node.y;
  }

  private moveNodeDrag(node: GraphNode, mouseX: number, mouseY: number): void {
    const t = this.transform;
    node.fx = (mouseX - t.x) / t.k;
    node.fy = (mouseY - t.y) / t.k;
    if (!this.settings.animate) {
      // With no ticks, move only the dragged node and redraw directly.
      node.x = node.fx;
      node.y = node.fy;
      this.render();
    }
  }

  private endNodeDrag(node: GraphNode, active: number): void {
    if (!active) this.simulation.alphaTarget(0);
    node.fx = null;
    node.fy = null;
  }

  private getNodeRadius(node: GraphNode): number {
    const base = this.settings.nodeSize;
    if (node.relation) return Math.max(8, base + 3);
    if (!this.settings.scaleNodeByLinks || !node.linkCount) return base;
    return base * (1 + Math.sqrt(Math.max(0, node.linkCount - 1)) * 0.5);
  }

  private getNodeColor(node: GraphNode): string {
    if (node.relation) return this.settings.linkTypes[node.relation.type]?.color ?? "#888";
    if (node.groupColor) return node.groupColor;
    return this.settings.nodeColor;
  }

  private getLinkConfig(link: GraphLink): LinkTypeConfig | undefined {
    return this.settings.linkTypes[link.type];
  }

  private getLinkWidth(link: GraphLink): number {
    const multiplier = this.getLinkConfig(link)?.widthMultiplier ?? 1;
    return Math.max(0.1, this.settings.linkThickness * multiplier);
  }

  private getLinkOpacity(link: GraphLink): number {
    const opacity = this.getLinkConfig(link)?.opacity ?? 1;
    return Math.max(0, Math.min(1, opacity));
  }

  private shouldShowArrow(link: GraphLink): boolean {
    // Incidences express unordered membership, not a directed pairwise fact.
    if (link.kind === "membership") return false;
    const mode = this.getLinkConfig(link)?.arrowMode ?? "inherit";
    if (mode === "on") return true;
    if (mode === "off") return false;
    return this.settings.showArrows;
  }

  private getLineDash(style: LinkLineStyle | undefined, width: number): number[] {
    switch (style) {
      case "dashed":
        return [Math.max(4, width * 4), Math.max(3, width * 2.5)];
      case "dotted":
        // Round caps on zero-length dashes create circles, including on curves.
        return [0, Math.max(3, width * 2.5)];
      default:
        return [];
    }
  }

  private render(): void {
    if (this.destroyed) return;
    const ctx = this.ctx;
    const t = this.transform;

    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Authored regions follow current positions and remain below all graph
    // links, entities and their labels. They add no hit-testing surface.
    const regionPresentation = this.settings.hypergraph2D && this.settings.hyperrelationRegions;
    const memberIndex = regionPresentation ? this.createMemberIndex() : undefined;
    const relationById = new Map<string, ExplicitRelation>(regionPresentation ? this.getExplicitRelations().map((record) => [record.id, record]) : []);
    const regions = regionPresentation ? this.getRelationRegions(memberIndex) : [];
    this.drawRelationRegions(regions);
    const selectedRelation = this.selectedRelationId ? relationById.get(this.selectedRelationId) : undefined;
    const selectedMembers = new Set(selectedRelation && this.settings.linkTypes[selectedRelation.type]?.visible !== false
      ? this.getDisplayedMembers(selectedRelation, memberIndex).map((node) => node.id) : []);

    const showLabels = this.settings.showLabels;
    const showNodeLabels = this.settings.showNodeLabels;
    const textFadeThreshold = this.settings.textFadeThreshold;
    const hoveredId = this.hoveredNode?.id;

    // Gather connected set for hover dimming
    const connectedToHover = new Set<string>();
    if (hoveredId) {
      connectedToHover.add(hoveredId);
      for (const link of this.links) {
        const sId = typeof link.source === "object" ? (link.source as GraphNode).id : link.source;
        const tId = typeof link.target === "object" ? (link.target as GraphNode).id : link.target;
        if (sId === hoveredId || tId === hoveredId) {
          connectedToHover.add(sId as string);
          connectedToHover.add(tId as string);
        }
      }
    }

    // Draw links
    for (const link of this.links) {
      const source = link.source as GraphNode;
      const target = link.target as GraphNode;
      if (source.x == null || target.x == null) continue;

      const config = this.getLinkConfig(link);
      const color = config?.color ?? "#888";
      const linkWidth = this.getLinkWidth(link);
      const drawArrow = this.shouldShowArrow(link);

      let alpha = this.getLinkOpacity(link);
      if (hoveredId) {
        const sId = source.id;
        const tId = target.id;
        if (sId !== hoveredId && tId !== hoveredId) {
          alpha *= 0.1;
        }
      }

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = linkWidth;
      ctx.lineCap = config?.lineStyle === "dotted" ? "round" : "butt";
      ctx.setLineDash(this.getLineDash(config?.lineStyle, linkWidth));

      const sx = source.x!;
      const sy = source.y!;
      const tx = target.x!;
      const ty = target.y!;

      const targetRadius = this.getNodeRadius(target);

      if (link.curvature !== 0) {
        // Curved edge
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const offset = link.curvature * len * 0.5;
        const cpx = mx + nx * offset;
        const cpy = my + ny * offset;

        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(cpx, cpy, tx, ty);
        ctx.stroke();

        // Arrowheads should never inherit the dash pattern.
        ctx.setLineDash([]);
        if (drawArrow) {
          this.drawArrowhead(ctx, cpx, cpy, tx, ty, targetRadius, color, alpha, linkWidth);
        }

        if (showLabels && link.kind !== "membership" && link.type !== UNTYPED_LINK_KEY && t.k > this.settings.edgeLabelThreshold) {
          const labelX = (sx + 2 * cpx + tx) / 4;
          const labelY = (sy + 2 * cpy + ty) / 4;
          const fs = 1 / Math.max(t.k, 0.5);
          ctx.font = `${16 * fs}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          ctx.lineWidth = 3 * fs;
          ctx.strokeStyle = this.resolvedBgColor;
          ctx.strokeText(link.type, labelX, labelY - 4);
          ctx.fillStyle = color;
          ctx.fillText(link.type, labelX, labelY - 4);
        }
      } else {
        // Straight edge
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // Arrowheads should never inherit the dash pattern.
        ctx.setLineDash([]);
        if (drawArrow) {
          this.drawArrowhead(ctx, sx, sy, tx, ty, targetRadius, color, alpha, linkWidth);
        }

        if (showLabels && link.kind !== "membership" && link.type !== UNTYPED_LINK_KEY && t.k > this.settings.edgeLabelThreshold) {
          const lmx = (sx + tx) / 2;
          const lmy = (sy + ty) / 2;
          const fs = 1 / Math.max(t.k, 0.5);
          ctx.font = `${16 * fs}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          ctx.lineWidth = 3 * fs;
          ctx.strokeStyle = this.resolvedBgColor;
          ctx.strokeText(link.type, lmx, lmy - 4);
          ctx.fillStyle = color;
          ctx.fillText(link.type, lmx, lmy - 4);
        }
      }

      ctx.setLineDash([]);
      ctx.lineCap = "butt";
      ctx.globalAlpha = 1;
    }

    // Draw nodes
    for (const node of this.nodes) {
      if (node.x == null || node.y == null) continue;

      let alpha = 1;
      if (hoveredId && !connectedToHover.has(node.id)) {
        alpha = 0.15;
      }

      const isHovered = node.id === hoveredId;
      const radius = isHovered ? this.getNodeRadius(node) + 2 : this.getNodeRadius(node);
      const fillColor = isHovered && !node.relation
        ? this.settings.nodeColorHover
        : this.getNodeColor(node);

      ctx.globalAlpha = alpha;

      ctx.beginPath();
      if (node.relation) {
        // Relationship junctions remain visibly distinct from entity circles.
        ctx.moveTo(node.x, node.y - radius);
        ctx.lineTo(node.x + radius, node.y);
        ctx.lineTo(node.x, node.y + radius);
        ctx.lineTo(node.x - radius, node.y);
        ctx.closePath();
        ctx.fillStyle = this.resolvedBgColor;
        ctx.fill();
        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (!node.exists) {
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        // Non-existent nodes: dashed stroke outline
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        // Outline
        ctx.strokeStyle = this.resolvedBgColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (selectedMembers.has(node.id) && selectedRelation) {
        const outlineRadius = radius + 3 / t.k;
        ctx.beginPath();
        if (node.relation) {
          ctx.moveTo(node.x, node.y - outlineRadius);
          ctx.lineTo(node.x + outlineRadius, node.y);
          ctx.lineTo(node.x, node.y + outlineRadius);
          ctx.lineTo(node.x - outlineRadius, node.y);
          ctx.closePath();
        } else {
          ctx.arc(node.x, node.y, outlineRadius, 0, Math.PI * 2);
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = this.settings.linkTypes[selectedRelation.type]?.color ?? "#888";
        ctx.lineWidth = 2.4 / t.k;
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }

      // Node label: always on hover; when showNodeLabels is on, also at zoom > threshold
      const showLabel = !!node.relation || isHovered || (showNodeLabels && t.k > textFadeThreshold);
      if (showLabel && node.name) {
        const fs = node.relation ? 1 / t.k : 1 / Math.max(t.k, 0.5);
        ctx.font = `${(node.relation ? 14 : 17) * fs}px sans-serif`;
        ctx.textAlign = "center";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3 * fs;
        ctx.strokeStyle = this.resolvedBgColor;
        let label = node.relation ? `${node.relation.sourceName} [${node.relation.id}]` : node.name;
        if (node.relation && regionPresentation) {
          const relation = relationById.get(node.relation.id) ?? node.relation;
          if (this.getDisplayedMembers(relation, memberIndex).length === 0) label += ` · 0/${relation.members.length} shown (partial)`;
        }
        ctx.strokeText(label, node.x, node.y - radius - 4);
        ctx.fillStyle = this.resolvedTextColor;
        ctx.fillText(label, node.x, node.y - radius - 4);
      }

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /** Draw a filled triangle arrowhead, scaled by the effective link width */
  private drawArrowhead(
    ctx: CanvasRenderingContext2D,
    fromX: number, fromY: number,
    toX: number, toY: number,
    nodeRadius: number,
    color: string,
    alpha: number,
    linkWidth: number
  ): void {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const ux = dx / len;
    const uy = dy / len;

    const tipX = toX - ux * (nodeRadius + 2);
    const tipY = toY - uy * (nodeRadius + 2);

    // Scale arrowhead with effective link thickness
    const scale = linkWidth / 1.5; // normalize to the historical default thickness
    const arrowLen = 8 * scale;
    const arrowWidth = 4 * scale;

    const baseX = tipX - ux * arrowLen;
    const baseY = tipY - uy * arrowLen;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX - uy * arrowWidth, baseY + ux * arrowWidth);
    ctx.lineTo(baseX + uy * arrowWidth, baseY - ux * arrowWidth);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
  }

  private findNode(mouseX: number, mouseY: number): GraphNode | null {
    const t = this.transform;
    const x = (mouseX - t.x) / t.k;
    const y = (mouseY - t.y) / t.k;

    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (node.x == null || node.y == null) continue;
      const r = this.getNodeRadius(node) + 4;
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy < r * r) return node;
    }
    return null;
  }

  private getMousePos(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  private onMouseMove = (event: MouseEvent): void => {
    this.trackMiddleClick(event);
    const { x, y } = this.getMousePos(event);
    const node = this.findNode(x, y);

    if (node !== this.hoveredNode) {
      this.hoveredNode = node;
      this.canvas.style.cursor = node ? "pointer" : "default";

      if (node) {
        this.tooltip.textContent = node.relation
          ? `${node.relation.sourceName} [${node.relation.id}] · ${node.relation.type} · ${node.relation.members.length} members`
          : node.name;
        this.tooltip.style.display = "block";
        this.tooltip.style.left = `${event.clientX - this.container.getBoundingClientRect().left + 12}px`;
        this.tooltip.style.top = `${event.clientY - this.container.getBoundingClientRect().top - 8}px`;
      } else {
        this.tooltip.style.display = "none";
      }

      this.render();
    } else if (node) {
      this.tooltip.style.left = `${event.clientX - this.container.getBoundingClientRect().left + 12}px`;
      this.tooltip.style.top = `${event.clientY - this.container.getBoundingClientRect().top - 8}px`;
    }
  };

  private onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const { x, y } = this.getMousePos(event);
    const node = this.findNode(x, y);
    if (node) this.selectNode(node);
  };

  private onMiddleMouseDown(event: MouseEvent): void {
    this.middleClick = null;
    if (event.button !== 1) return;
    const { x, y } = this.getMousePos(event);
    const node = this.findNode(x, y);
    // Cancel browser autoscroll on nodes; background gestures stay unchanged.
    if (node) {
      this.middleClick = { node, x: event.clientX, y: event.clientY, dragged: false };
      event.preventDefault();
    }
  }

  private trackMiddleClick(event: MouseEvent): void {
    const click = this.middleClick;
    if (click && Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) click.dragged = true;
  }

  private onAuxClick(event: MouseEvent): void {
    if (event.button !== 1 || this.destroyed) return;
    const click = this.middleClick;
    this.middleClick = null;
    if (!click || click.dragged || Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) return;
    const { x, y } = this.getMousePos(event);
    const node = this.findNode(x, y);
    if (!node || node !== click.node) return;
    event.preventDefault();
    event.stopPropagation();
    this.focusNode(node);
  }

  private focusNode(node: GraphNode): void {
    if (this.destroyed || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    const scale = this.transform.k;
    const next = zoomIdentity
      .translate(this.width / 2 - node.x! * scale, this.height / 2 - node.y! * scale)
      .scale(scale);
    this.hoveredNode = null;
    this.tooltip.style.display = "none";
    // Move only the camera. The zoom behavior keeps its internal transform in
    // sync, so subsequent wheel zooms and drags do not jump back.
    select(this.canvas)
      .interrupt()
      .transition()
      .duration(300)
      .call(this.zoomBehavior.transform as any, next);
  }

  private selectNode(node: GraphNode): void {
    if (node.relation && this.onSelectRelation) this.onSelectRelation(node.relation);
    else this.app.workspace.openLinkText(node.relation?.sourcePath ?? node.id, "", false);
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.dismissContextMenu();

    const { x, y } = this.getMousePos(event);
    const node = this.findNode(x, y);
    if (!node) return;

    const menu = document.createElement("div");
    menu.className = "gps-context-menu";
    menu.style.left = `${event.clientX - this.container.getBoundingClientRect().left}px`;
    menu.style.top = `${event.clientY - this.container.getBoundingClientRect().top}px`;

    const openItem = document.createElement("div");
    openItem.className = "gps-context-menu-item";
    openItem.textContent = "Open note";
    openItem.addEventListener("click", () => {
      this.app.workspace.openLinkText(node.relation?.sourcePath ?? node.id, "", false);
      this.dismissContextMenu();
    });

    const openNewTab = document.createElement("div");
    openNewTab.className = "gps-context-menu-item";
    openNewTab.textContent = "Open in new tab";
    openNewTab.addEventListener("click", () => {
      this.app.workspace.openLinkText(node.relation?.sourcePath ?? node.id, "", "tab");
      this.dismissContextMenu();
    });

    menu.appendChild(openItem);
    menu.appendChild(openNewTab);
    this.container.appendChild(menu);
    this.contextMenu = menu;
  };

  private dismissContextMenu = (): void => {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  };

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

    // Backwards compatibility: distance:Nx in the advanced force rule
    // is multiplied with the explicit semantic distance multiplier.
    const rules = this.forceRuleCache.get(link.type);
    if (rules) {
      const distRule = rules.find((r) => r.type === "distance");
      if (distRule) multiplier *= distRule.value;
    }

    return this.settings.linkDistance * Math.max(0.01, multiplier);
  }

  private getLinkStrength(link: any): number {
    const attraction = this.settings.linkTypes[link.type]?.attraction ?? 1;
    if (link.kind === "membership") {
      return getMembershipLinkStrength(this.settings.linkStrength, attraction, link.memberCount);
    }
    return getEffectiveLinkStrength(this.settings.linkStrength, attraction);
  }

  private createLinkTypeForce(): (alpha: number) => void {
    return (alpha: number) => {
      for (const link of this.links) {
        // Directional force rules would invent ordering for unordered members.
        if (link.kind === "membership") continue;
        const source = link.source as GraphNode;
        const target = link.target as GraphNode;
        if (source.vx == null || target.vx == null) continue;

        const rules = this.forceRuleCache.get(link.type);
        if (!rules) continue;

        for (const rule of rules) {
          if (rule.type !== "direction") continue;
          const str = rule.value * 50 * alpha;
          switch (rule.dir) {
            case "down": target.vy! += str; break;
            case "up": target.vy! -= str; break;
            case "right": target.vx! += str; break;
            case "left": target.vx! -= str; break;
            // forward/backward ignored in 2D
          }
        }
      }
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.simulation.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("mousedown", this.onMiddleMouseDown);
    this.canvas.removeEventListener("auxclick", this.onAuxClick);
    this.canvas.removeEventListener("mouseleave", this.cancelMiddleClick);
    this.middleClick = null;
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("click", this.dismissContextMenu);
    this.dismissContextMenu();
    this.tooltip.remove();
    this.canvas.remove();
  }
}
