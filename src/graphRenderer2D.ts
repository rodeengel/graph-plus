import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationLinkDatum,
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

  constructor(container: HTMLElement, app: App, settings: GraphLinkTypesSettings) {
    this.container = container;
    this.app = app;
    this.settings = settings;

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

    // Simulation
    this.simulation = forceSimulation<GraphNode>()
      .force("charge", forceManyBody().strength(settings.chargeStrength))
      .force("center", forceCenter(this.width / 2, this.height / 2))
      .force("collide", forceCollide(settings.nodeSize + 2))
      .on("tick", () => this.render());

    // Zoom
    this.zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        this.transform = event.transform;
        this.render();
      });

    const sel = select(this.canvas);
    sel.call(this.zoomBehavior as any);

    // Drag
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

    sel.call(dragBehavior as any);

    // Mouse events for hover and click
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("click", this.onClick);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("click", this.dismissContextMenu);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => {
      this.updateSize();
      this.simulation.force("center", forceCenter(this.width / 2, this.height / 2));
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
    })) as GraphLink[];

    this.simulation.nodes(this.nodes);
    this.simulation.force(
      "link",
      forceLink<GraphNode, GraphLink>(this.links)
        .id((d) => d.id)
        .distance(this.settings.linkDistance)
    );
    this.simulation.alpha(1).restart();
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

  private render(): void {
    if (this.destroyed) return;
    const ctx = this.ctx;
    const t = this.transform;

    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    const nodeSize = this.settings.nodeSize;
    const showLabels = this.settings.showLabels;
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

      // Dim non-connected links when hovering
      let alpha = 1;
      if (hoveredId) {
        const sId = source.id;
        const tId = target.id;
        if (sId !== hoveredId && tId !== hoveredId) {
          alpha = 0.1;
        }
      }

      ctx.beginPath();
      ctx.moveTo(source.x!, source.y!);
      ctx.lineTo(target.x!, target.y!);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Edge labels
      if (showLabels && link.type !== UNTYPED_LINK_KEY && t.k > 0.5) {
        const mx = (source.x! + target.x!) / 2;
        const my = (source.y! + target.y!) / 2;
        ctx.font = `${10 / Math.max(t.k, 0.5)}px sans-serif`;
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(link.type, mx, my - 4);
        ctx.globalAlpha = 1;
      }
    }

    // Draw nodes
    for (const node of this.nodes) {
      if (node.x == null || node.y == null) continue;

      let alpha = 1;
      if (hoveredId && !connectedToHover.has(node.id)) {
        alpha = 0.15;
      }

      const isHovered = node.id === hoveredId;

      ctx.beginPath();
      ctx.arc(node.x, node.y, isHovered ? nodeSize + 2 : nodeSize, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? "var(--interactive-accent, #7b6cd9)" : "var(--text-normal, #ddd)";
      ctx.globalAlpha = alpha;
      ctx.fill();

      // Node label on hover or when zoomed in
      if ((isHovered || t.k > 2) && node.name) {
        ctx.font = `${12 / Math.max(t.k, 0.5)}px sans-serif`;
        ctx.fillStyle = "var(--text-normal, #ddd)";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y - nodeSize - 4);
      }

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private findNode(mouseX: number, mouseY: number): GraphNode | null {
    const t = this.transform;
    const x = (mouseX - t.x) / t.k;
    const y = (mouseY - t.y) / t.k;
    const r = this.settings.nodeSize + 4;

    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (node.x == null || node.y == null) continue;
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
