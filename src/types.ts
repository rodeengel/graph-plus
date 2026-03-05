import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";

export interface GraphNode extends SimulationNodeDatum {
  id: string;     // file path
  name: string;   // basename without extension
  tags: string[];
  isAttachment: boolean;
  exists: boolean;
  groupColor?: string;  // color from first matching group
  properties: Record<string, string[]>; // frontmatter properties for query matching
  linkCount?: number;   // number of visible links (set during filtering)
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  curvature: number; // 0 = straight, ±offset for parallel edges
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface LinkTypeConfig {
  color: string;
  visible: boolean;
}

export interface NodeGroup {
  query: string;
  color: string;
}

export interface GraphLinkTypesSettings {
  linkTypes: Record<string, LinkTypeConfig>;
  showLabels: boolean;
  showNodeLabels: boolean;
  showUntyped: boolean;
  defaultMode: "2d" | "3d";
  nodeSize: number;
  chargeStrength: number;
  centerForce: number;      // 0-1, strength of centering force (forceX/forceY)
  linkStrength: number;     // 0-1, strength of link attraction
  linkDistance: number;
  nodeGroups: NodeGroup[];
  showArrows: boolean;
  showAttachments: boolean;
  existingOnly: boolean;
  showOrphans: boolean;
  linkThickness: number;
  linkOpacity: number;       // 0-1, opacity of links (3D)
  nodeOpacity3D: number;     // 0-1, opacity of nodes (3D)
  nodeRelSize3D: number;     // sphere scale factor (3D)
  textFadeThreshold: number;
  edgeLabelThreshold: number;
  collisionForce: number;
  animate: boolean;
  nodeColor: string;
  nodeColorHover: string;
  scaleNodeByLinks: boolean;
}

export const DEFAULT_SETTINGS: GraphLinkTypesSettings = {
  linkTypes: {},
  showLabels: false,
  showNodeLabels: true,
  showUntyped: true,
  defaultMode: "2d",
  nodeSize: 5,
  chargeStrength: -120,
  centerForce: 1,
  linkStrength: 1,
  linkDistance: 60,
  nodeGroups: [],
  showArrows: false,
  showAttachments: true,
  existingOnly: false,
  showOrphans: true,
  linkThickness: 1.5,
  linkOpacity: 1.0,
  nodeOpacity3D: 1.0,
  nodeRelSize3D: 4,
  textFadeThreshold: 1.0,
  edgeLabelThreshold: 0.5,
  collisionForce: 0.7,
  animate: true,
  nodeColor: "#888888",
  nodeColorHover: "#7b6cd9",
  scaleNodeByLinks: false,
};

// --- Declarative settings schema ---
// Both the sidebar (graphView) and settings tab (settings) render from this.
// To add a new toggle/slider: add the field to GraphLinkTypesSettings + DEFAULT_SETTINGS,
// then add one entry here. No need to touch graphView.ts or settings.ts.

export type SettingEffect = "rebuild" | "visual" | "force" | "animate";

export interface SettingDef {
  key: keyof GraphLinkTypesSettings;
  label: string;
  desc?: string;
  section: "filters" | "display" | "display2d" | "display3d" | "forces";
  type: "toggle" | "slider";
  min?: number;
  max?: number;
  step?: number;
  invert?: boolean;       // negate value for display (e.g. chargeStrength stored negative)
  effect: SettingEffect;
  renderers?: "both" | "2d" | "3d";
}

export const SETTING_DEFS: SettingDef[] = [
  // Filters
  { key: "showAttachments", label: "Attachments", desc: "Include attachment files (images, PDFs, etc.)", section: "filters", type: "toggle", effect: "rebuild" },
  { key: "existingOnly", label: "Existing only", desc: "Hide nodes for unresolved/non-existent files", section: "filters", type: "toggle", effect: "rebuild" },
  { key: "showOrphans", label: "Orphans", desc: "Show nodes without any visible links", section: "filters", type: "toggle", effect: "rebuild" },

  // Display (shared)
  { key: "showArrows", label: "Arrows", desc: "Draw directional arrowheads on links", section: "display", type: "toggle", effect: "visual", renderers: "both" },
  { key: "scaleNodeByLinks", label: "Scale by connections", desc: "Make nodes with more links appear larger", section: "display", type: "toggle", effect: "visual", renderers: "both" },
  { key: "nodeSize", label: "Node size", desc: "Base radius of graph nodes (1–20)", section: "display", type: "slider", min: 1, max: 20, step: 1, effect: "visual", renderers: "both" },
  { key: "linkThickness", label: "Link thickness", desc: "Width of graph edges (0.5–5)", section: "display", type: "slider", min: 0.5, max: 5, step: 0.5, effect: "visual", renderers: "both" },

  // 2D Display
  { key: "showLabels", label: "Edge labels", desc: "Display link type names on edges", section: "display2d", type: "toggle", effect: "visual", renderers: "2d" },
  { key: "showNodeLabels", label: "Node labels", desc: "Display node names when zoomed in", section: "display2d", type: "toggle", effect: "visual", renderers: "2d" },
  { key: "textFadeThreshold", label: "Node label zoom", desc: "Zoom level at which node labels appear (0.1–5)", section: "display2d", type: "slider", min: 0.1, max: 5, step: 0.1, effect: "visual", renderers: "2d" },
  { key: "edgeLabelThreshold", label: "Edge label zoom", desc: "Zoom level at which edge labels appear (0.1–5)", section: "display2d", type: "slider", min: 0.1, max: 5, step: 0.1, effect: "visual", renderers: "2d" },

  // 3D Display
  { key: "nodeRelSize3D", label: "Node scale", desc: "Size of 3D node spheres (1–20)", section: "display3d", type: "slider", min: 1, max: 20, step: 1, effect: "visual", renderers: "3d" },
  { key: "nodeOpacity3D", label: "Node opacity", desc: "Opacity of 3D nodes (0–1)", section: "display3d", type: "slider", min: 0, max: 1, step: 0.05, effect: "visual", renderers: "3d" },
  { key: "linkOpacity", label: "Link opacity", desc: "Opacity of 3D links (0–1)", section: "display3d", type: "slider", min: 0, max: 1, step: 0.05, effect: "visual", renderers: "3d" },

  // Forces
  { key: "centerForce", label: "Center force", desc: "Pull nodes toward center (0–2)", section: "forces", type: "slider", min: 0, max: 2, step: 0.05, effect: "force" },
  { key: "chargeStrength", label: "Repel force", desc: "Push nodes apart (10–2000, higher = more spread)", section: "forces", type: "slider", min: 10, max: 2000, step: 10, effect: "force", invert: true },
  { key: "linkStrength", label: "Link force", desc: "Strength of link attraction (0–2)", section: "forces", type: "slider", min: 0, max: 2, step: 0.05, effect: "force" },
  { key: "linkDistance", label: "Link distance", desc: "Preferred distance between linked nodes (5–500)", section: "forces", type: "slider", min: 5, max: 500, step: 5, effect: "force" },
  { key: "collisionForce", label: "Collision", desc: "Prevent node overlap (0–1)", section: "forces", type: "slider", min: 0, max: 1, step: 0.05, effect: "force" },
  { key: "animate", label: "Pause physics", desc: "Freeze the force simulation", section: "forces", type: "toggle", effect: "animate", invert: true },
];

export const COLOR_PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
  "#dcbeff", "#9A6324", "#800000", "#aaffc3", "#808000",
  "#ffd8b1", "#000075", "#a9a9a9",
];

export const UNTYPED_LINK_KEY = "__untyped__";
