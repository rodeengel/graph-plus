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
  textFadeThreshold: number;
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
  textFadeThreshold: 1.0,
  animate: true,
  nodeColor: "#888888",
  nodeColorHover: "#7b6cd9",
  scaleNodeByLinks: false,
};

export const COLOR_PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
  "#dcbeff", "#9A6324", "#800000", "#aaffc3", "#808000",
  "#ffd8b1", "#000075", "#a9a9a9",
];

export const UNTYPED_LINK_KEY = "__untyped__";
