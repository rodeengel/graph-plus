import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";

export interface GraphNode extends SimulationNodeDatum {
  id: string;     // file path
  name: string;   // basename without extension
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface LinkTypeConfig {
  color: string;
  visible: boolean;
}

export interface GraphLinkTypesSettings {
  linkTypes: Record<string, LinkTypeConfig>;
  showLabels: boolean;
  showUntyped: boolean;
  defaultMode: "2d" | "3d";
  nodeSize: number;
  chargeStrength: number;
  linkDistance: number;
}

export const DEFAULT_SETTINGS: GraphLinkTypesSettings = {
  linkTypes: {},
  showLabels: false,
  showUntyped: true,
  defaultMode: "2d",
  nodeSize: 5,
  chargeStrength: -120,
  linkDistance: 60,
};

export const COLOR_PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
  "#dcbeff", "#9A6324", "#800000", "#aaffc3", "#808000",
  "#ffd8b1", "#000075", "#a9a9a9",
];

export const UNTYPED_LINK_KEY = "__untyped__";
