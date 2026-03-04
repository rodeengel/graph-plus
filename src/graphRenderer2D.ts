import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type D3ZoomEvent } from "d3-zoom";
import { drag, type D3DragEvent } from "d3-drag";
import type { App } from "obsidian";
import type { GraphNode, GraphLink, GraphData, GraphLinkTypesSettings } from "./types";
import { UNTYPED_LINK_KEY } from "./types";

export class GraphRenderer2D {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private simulation: Simulation<GraphNode, GraphLink>;
  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];
  private settings: GraphLinkTypesSettings;
  private app: App;

  private zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown>;
  private transform = zoomIdentity;
  private resizeObserver: ResizeObserver;

  private hoveredNode: GraphNode | null = null;
  private tooltip: HTMLElement;
  private contextMenu: HTMLElement | null = null;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private destroyed = false;

  // Resolved CSS fallback colors
  private resolvedTextColor: string;

  constructor(container: HTMLElement, app: App, settings: GraphLinkTypesSettings) {
    this.container = container;
    this.app = app;
    this.settings = settings;

    // Resolve CSS variables at construction time for Canvas compatibility
    const cs = getComputedStyle(container);
    this.resolvedTextColor = cs.getPropertyValue("--text-normal").trim() || "#ddd";

    // Create canvas
    this.canvas = document.createElement("canvas");
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    // Tooltip
    this.tooltip = document.createElement("div");
    this.tooltip.className = "glt-tooltip";
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
      .force("collide", forceCollide(settings.nodeSize + 2))
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
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event: D3DragEvent<HTMLCanvasElement, unknown, GraphNode>) => {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      })
      .on("end", (event: D3DragEvent<HTMLCanvasElement, unknown, GraphNode>) => {
        if (!event.active) this.simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      });

    const sel = select(this.canvas);
    sel.call(dragBehavior as any);
    sel.call(this.zoomBehavior as any);

    // Mouse events for hover and click
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("click", this.onClick);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("click", this.dismissContextMenu);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => {
      this.updateSize();
      const xForce = this.simulation.force("x") as any;
      const yForce = this.simulation.force("y") as any;
      if (xForce) xForce.x(this.width / 2);
      if (yForce) yForce.y(this.height / 2);
      this.simulation.alpha(0.1).restart();
    });
    this.resizeObserver.observe(this.container);
  }

  updateData(data: GraphData): void {
    this.nodes = data.nodes.map((n) => ({ ...n }));
    this.links = data.links.map((l) => ({
      source: typeof l.source === "string" ? l.source : l.source.id,
      target: typeof l.target === "string" ? l.target : l.target.id,
      type: l.type,
      curvature: l.curvature,
    })) as GraphLink[];

    this.simulation.nodes(this.nodes);
    this.simulation.force(
      "link",
      forceLink<GraphNode, GraphLink>(this.links)
        .id((d) => d.id)
        .distance(this.settings.linkDistance)
        .strength(this.settings.linkStrength)
    );
    this.simulation.alpha(1).restart();

    if (!this.settings.animate) {
      this.simulation.stop();
      for (let i = 0; i < 300; i++) this.simulation.tick();
      this.render();
    }
  }

  /** Update forces and display settings without rebuilding data */
  updateSettings(): void {
    const charge = this.simulation.force("charge") as any;
    if (charge) charge.strength(this.settings.chargeStrength);

    const xForce = this.simulation.force("x") as any;
    if (xForce) xForce.strength(this.settings.centerForce * 0.1);
    const yForce = this.simulation.force("y") as any;
    if (yForce) yForce.strength(this.settings.centerForce * 0.1);

    const link = this.simulation.force("link") as any;
    if (link) {
      link.distance(this.settings.linkDistance);
      link.strength(this.settings.linkStrength);
    }

    const collide = this.simulation.force("collide") as any;
    if (collide) collide.radius(this.settings.nodeSize + 2);

    this.simulation.alpha(0.3).restart();

    if (!this.settings.animate) {
      this.simulation.stop();
    }

    this.render();
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

  private getNodeRadius(node: GraphNode): number {
    const base = this.settings.nodeSize;
    if (!this.settings.scaleNodeByLinks || !node.linkCount) return base;
    return base * (1 + Math.sqrt(Math.max(0, node.linkCount - 1)) * 0.5);
  }

  private getNodeColor(node: GraphNode): string {
    if (node.groupColor) return node.groupColor;
    return this.settings.nodeColor;
  }

  private render(): void {
    if (this.destroyed) return;
    const ctx = this.ctx;
    const t = this.transform;

    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    const showLabels = this.settings.showLabels;
    const showNodeLabels = this.settings.showNodeLabels;
    const showArrows = this.settings.showArrows;
    const linkThickness = this.settings.linkThickness;
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

      const config = this.settings.linkTypes[link.type];
      const color = config?.color ?? "#888";

      let alpha = 1;
      if (hoveredId) {
        const sId = source.id;
        const tId = target.id;
        if (sId !== hoveredId && tId !== hoveredId) {
          alpha = 0.1;
        }
      }

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = linkThickness;

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

        if (showArrows) {
          this.drawArrowhead(ctx, cpx, cpy, tx, ty, targetRadius, color, alpha);
        }

        if (showLabels && link.type !== UNTYPED_LINK_KEY && t.k > 0.5) {
          const labelX = (sx + 2 * cpx + tx) / 4;
          const labelY = (sy + 2 * cpy + ty) / 4;
          ctx.font = `${10 / Math.max(t.k, 0.5)}px sans-serif`;
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(link.type, labelX, labelY - 4);
        }
      } else {
        // Straight edge
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        if (showArrows) {
          this.drawArrowhead(ctx, sx, sy, tx, ty, targetRadius, color, alpha);
        }

        if (showLabels && link.type !== UNTYPED_LINK_KEY && t.k > 0.5) {
          const lmx = (sx + tx) / 2;
          const lmy = (sy + ty) / 2;
          ctx.font = `${10 / Math.max(t.k, 0.5)}px sans-serif`;
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(link.type, lmx, lmy - 4);
        }
      }

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
      const fillColor = isHovered
        ? this.settings.nodeColorHover
        : this.getNodeColor(node);

      ctx.globalAlpha = alpha;

      if (!node.exists) {
        // Non-existent nodes: dashed stroke outline
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
      }

      // Node label: always on hover; when showNodeLabels is on, also at zoom > threshold
      const showLabel = isHovered || (showNodeLabels && t.k > textFadeThreshold);
      if (showLabel && node.name) {
        ctx.font = `${12 / Math.max(t.k, 0.5)}px sans-serif`;
        ctx.fillStyle = this.resolvedTextColor;
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y - radius - 4);
      }

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /** Draw a filled triangle arrowhead, scaled by link thickness */
  private drawArrowhead(
    ctx: CanvasRenderingContext2D,
    fromX: number, fromY: number,
    toX: number, toY: number,
    nodeRadius: number,
    color: string,
    alpha: number
  ): void {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const ux = dx / len;
    const uy = dy / len;

    const tipX = toX - ux * (nodeRadius + 2);
    const tipY = toY - uy * (nodeRadius + 2);

    // Scale arrowhead with link thickness
    const scale = this.settings.linkThickness / 1.5; // normalize to default thickness
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
    const { x, y } = this.getMousePos(event);
    const node = this.findNode(x, y);

    if (node !== this.hoveredNode) {
      this.hoveredNode = node;
      this.canvas.style.cursor = node ? "pointer" : "default";

      if (node) {
        this.tooltip.textContent = node.name;
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
    const { x, y } = this.getMousePos(event);
    const node = this.findNode(x, y);
    if (node) {
      this.app.workspace.openLinkText(node.id, "", false);
    }
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.dismissContextMenu();

    const { x, y } = this.getMousePos(event);
    const node = this.findNode(x, y);
    if (!node) return;

    const menu = document.createElement("div");
    menu.className = "glt-context-menu";
    menu.style.left = `${event.clientX - this.container.getBoundingClientRect().left}px`;
    menu.style.top = `${event.clientY - this.container.getBoundingClientRect().top}px`;

    const openItem = document.createElement("div");
    openItem.className = "glt-context-menu-item";
    openItem.textContent = "Open note";
    openItem.addEventListener("click", () => {
      this.app.workspace.openLinkText(node.id, "", false);
      this.dismissContextMenu();
    });

    const openNewTab = document.createElement("div");
    openNewTab.className = "glt-context-menu-item";
    openNewTab.textContent = "Open in new tab";
    openNewTab.addEventListener("click", () => {
      this.app.workspace.openLinkText(node.id, "", "tab");
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

  destroy(): void {
    this.destroyed = true;
    this.simulation.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("click", this.dismissContextMenu);
    this.dismissContextMenu();
    this.tooltip.remove();
    this.canvas.remove();
  }
}
