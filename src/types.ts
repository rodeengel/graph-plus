import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";

/** Authored meaning, kept independent of mutable force/rendering objects. */
export interface SemanticEntity {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly isAttachment: boolean;
  readonly exists: boolean;
  readonly properties: Readonly<Record<string, readonly string[]>>;
}

export interface SemanticLink {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly sourcePath: string;
}

export interface ExplicitRelation {
  readonly id: string;
  readonly type: string;
  readonly ordered: false;
  readonly members: readonly string[];
  readonly sourcePath: string;
  readonly sourceName: string;
}

export interface RelationDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly sourcePath: string;
  readonly relationId?: string;
}

export interface SemanticGraph {
  readonly entities: readonly SemanticEntity[];
  readonly links: readonly SemanticLink[];
  readonly relations: readonly ExplicitRelation[];
  readonly diagnostics: readonly RelationDiagnostic[];
}

export interface GraphNode extends SimulationNodeDatum {
  id: string;     // file path
  name: string;   // basename without extension
  tags: string[];
  isAttachment: boolean;
  exists: boolean;
  groupColor?: string;  // color from first matching group
  properties: Record<string, string[]>; // frontmatter properties for query matching
  linkCount?: number;   // number of visible links (set during filtering)
  relation?: ExplicitRelation; // present only on a projected relationship junction
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  curvature: number; // 0 = straight, ±offset for parallel edges
  kind?: "membership";
  relationId?: string;
  memberCount?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  semantic?: SemanticGraph;
}

export type LinkLineStyle = "solid" | "dashed" | "dotted";
export type LinkArrowMode = "inherit" | "on" | "off";

/**
 * Rendering + layout behavior for one semantic relationship type.
 *
 * These values deliberately separate:
 * - meaning (the link type itself)
 * - appearance (color/style/width/opacity/arrow)
 * - physics (distance/attraction)
 *
 * `forceRule` remains for directional layout rules and backwards compatibility.
 */
export interface LinkTypeConfig {
  color: string;
  visible: boolean;
  forceRule?: string;
  lineStyle: LinkLineStyle;
  widthMultiplier: number;
  opacity: number;
  arrowMode: LinkArrowMode;
  distanceMultiplier: number;
  attraction: number;
}

export const DEFAULT_LINK_TYPE_STYLE = {
  lineStyle: "solid" as LinkLineStyle,
  widthMultiplier: 1,
  opacity: 1,
  arrowMode: "inherit" as LinkArrowMode,
  distanceMultiplier: 1,
  attraction: 1,
};

export const MAX_EFFECTIVE_LINK_STRENGTH = 2;

/** Keep strong multiplier combinations stable when d3 reheats to alpha 1. */
export function getEffectiveLinkStrength(baseStrength: number, attraction: number): number {
  return Math.min(MAX_EFFECTIVE_LINK_STRENGTH, Math.max(0, baseStrength * Math.max(0, attraction)));
}

/**
 * One relation has a bounded total spring budget, shared equally by its members.
 * Distance remains the preferred participant-to-junction distance. This is a
 * layout convention, not a physical model or a claim about hypergraph physics.
 */
export function getMembershipLinkStrength(baseStrength: number, attraction: number, memberCount: number): number {
  const base = Number.isFinite(baseStrength) ? Math.max(0, baseStrength) : 0;
  const multiplier = Number.isFinite(attraction) ? Math.max(0, attraction) : 0;
  const count = Number.isFinite(memberCount) ? Math.max(2, Math.floor(memberCount)) : 2;
  return getEffectiveLinkStrength(base, multiplier) / count;
}

export function createLinkTypeConfig(
  color: string,
  overrides: Partial<LinkTypeConfig> = {}
): LinkTypeConfig {
  return {
    color,
    visible: true,
    ...DEFAULT_LINK_TYPE_STYLE,
    ...overrides,
  };
}

/**
 * Fill semantic link fields added after Graph Plus 0.1.0.
 * Mutates the supplied object so existing saved settings migrate in place.
 */
export function normalizeLinkTypeConfig(config: LinkTypeConfig | Record<string, any>): LinkTypeConfig {
  if (config.lineStyle === undefined) config.lineStyle = DEFAULT_LINK_TYPE_STYLE.lineStyle;
  if (config.widthMultiplier === undefined) config.widthMultiplier = DEFAULT_LINK_TYPE_STYLE.widthMultiplier;
  if (config.opacity === undefined) config.opacity = DEFAULT_LINK_TYPE_STYLE.opacity;
  if (config.arrowMode === undefined) config.arrowMode = DEFAULT_LINK_TYPE_STYLE.arrowMode;
  if (config.distanceMultiplier === undefined) config.distanceMultiplier = DEFAULT_LINK_TYPE_STYLE.distanceMultiplier;
  if (config.attraction === undefined) config.attraction = DEFAULT_LINK_TYPE_STYLE.attraction;
  return config as LinkTypeConfig;
}

export interface ForceRule {
  type: "direction" | "distance";
  dir?: "up" | "down" | "left" | "right" | "forward" | "backward";
  value: number;
}

export function parseForceRules(rule: string): ForceRule[] {
  if (!rule) return [];
  const rules: ForceRule[] = [];
  for (const part of rule.trim().split(/\s+/)) {
    const colonIdx = part.indexOf(":");
    if (colonIdx < 0) continue;
    const key = part.slice(0, colonIdx).toLowerCase();
    const rawVal = part.slice(colonIdx + 1);

    if (["up", "down", "left", "right", "forward", "backward"].includes(key)) {
      const num = parseFloat(rawVal);
      if (!isNaN(num)) rules.push({ type: "direction", dir: key as ForceRule["dir"], value: num });
    } else if (key === "distance") {
      const num = parseFloat(rawVal.replace(/x$/i, ""));
      if (!isNaN(num) && num > 0) rules.push({ type: "distance", value: num });
    }
  }
  return rules;
}

export interface NodeGroup {
  query: string;
  color: string;
}

export interface SettingsProfile {
  name: string;
  snapshot: Record<string, any>;
}

export interface GraphLinkTypesSettings {
  linkTypes: Record<string, LinkTypeConfig>;
  showLabels: boolean;
  showNodeLabels: boolean;
  hypergraph2D: boolean;
  hyperrelationRegions: boolean;
  regionFillOpacity: number;
  showUntyped: boolean;
  defaultMode: "2d" | "3d";
  nodeSize: number;
  chargeStrength: number;
  centerForce: number;      // 0-1, strength of centering force (forceX/forceY)
  linkStrength: number;     // global base strength; per-type attraction multiplies this
  linkDistance: number;     // global base distance; per-type distanceMultiplier multiplies this
  nodeGroups: NodeGroup[];
  showArrows: boolean;
  showAttachments: boolean;
  existingOnly: boolean;
  showOrphans: boolean;
  linkThickness: number;    // global base width; per-type widthMultiplier multiplies this
  linkOpacity: number;      // 0-1, global opacity of links (3D)
  nodeOpacity3D: number;    // 0-1, opacity of nodes (3D)
  nodeRelSize3D: number;    // sphere scale factor (3D)
  textFadeThreshold: number;
  edgeLabelThreshold: number;
  collisionForce: number;
  animate: boolean;
  nodeColor: string;
  nodeColorHover: string;
  scaleNodeByLinks: boolean;
  profiles: SettingsProfile[];
  searchQuery: string;
}

export const DEFAULT_SETTINGS: GraphLinkTypesSettings = {
  linkTypes: {},
  showLabels: false,
  showNodeLabels: true,
  hypergraph2D: true,
  hyperrelationRegions: false,
  regionFillOpacity: 0.08,
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
  profiles: [],
  searchQuery: "",
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
  { key: "showArrows", label: "Arrows", desc: "Default arrow behavior for link types set to Inherit", section: "display", type: "toggle", effect: "visual", renderers: "both" },
  { key: "scaleNodeByLinks", label: "Scale by connections", desc: "Make nodes with more links appear larger", section: "display", type: "toggle", effect: "visual", renderers: "both" },
  { key: "nodeSize", label: "Node size", desc: "Base radius of graph nodes (1–20)", section: "display", type: "slider", min: 1, max: 20, step: 1, effect: "visual", renderers: "both" },
  { key: "linkThickness", label: "Base link thickness", desc: "Base width of graph edges before per-type width multipliers (0.5–10)", section: "display", type: "slider", min: 0.5, max: 10, step: 0.5, effect: "visual", renderers: "both" },

  // 2D Display
  { key: "hypergraph2D", label: "Relationship junctions", desc: "Show explicit multi-member relations as junctions in 2D; disable for the standard note graph", section: "display2d", type: "toggle", effect: "rebuild", renderers: "2d" },
  { key: "hyperrelationRegions", label: "Relationship regions", desc: "Approximate enclosures of displayed members in 2D junction mode. A node inside an enclosure is not necessarily a member; filters can hide a relation's junction and region.", section: "display2d", type: "toggle", effect: "visual", renderers: "2d" },
  { key: "regionFillOpacity", label: "Region fill opacity", desc: "Low-opacity fill for relationship regions (0–0.3)", section: "display2d", type: "slider", min: 0, max: 0.3, step: 0.01, effect: "visual", renderers: "2d" },
  { key: "showLabels", label: "Edge labels", desc: "Display link type names on edges", section: "display2d", type: "toggle", effect: "visual", renderers: "2d" },
  { key: "showNodeLabels", label: "Node labels", desc: "Display node names when zoomed in", section: "display2d", type: "toggle", effect: "visual", renderers: "2d" },
  { key: "textFadeThreshold", label: "Node label zoom", desc: "Zoom level at which node labels appear (0.1–5)", section: "display2d", type: "slider", min: 0.1, max: 5, step: 0.1, effect: "visual", renderers: "2d" },
  { key: "edgeLabelThreshold", label: "Edge label zoom", desc: "Zoom level at which edge labels appear (0.1–5)", section: "display2d", type: "slider", min: 0.1, max: 5, step: 0.1, effect: "visual", renderers: "2d" },

  // 3D Display
  { key: "nodeRelSize3D", label: "Node scale", desc: "Size of 3D node spheres (1–20)", section: "display3d", type: "slider", min: 1, max: 20, step: 1, effect: "visual", renderers: "3d" },
  { key: "nodeOpacity3D", label: "Node opacity", desc: "Opacity of 3D nodes (0–1)", section: "display3d", type: "slider", min: 0, max: 1, step: 0.05, effect: "visual", renderers: "3d" },
  { key: "linkOpacity", label: "Link opacity", desc: "Global opacity of 3D links (0–1)", section: "display3d", type: "slider", min: 0, max: 1, step: 0.05, effect: "visual", renderers: "3d" },

  // Forces
  { key: "centerForce", label: "Center force", desc: "Pull nodes toward center (0–2)", section: "forces", type: "slider", min: 0, max: 2, step: 0.05, effect: "force" },
  { key: "chargeStrength", label: "Repel force", desc: "Push nodes apart (10–2000, higher = more spread)", section: "forces", type: "slider", min: 10, max: 2000, step: 10, effect: "force", invert: true },
  { key: "linkStrength", label: "Base link force", desc: "Base link attraction before per-type attraction multipliers (0–2)", section: "forces", type: "slider", min: 0, max: 2, step: 0.05, effect: "force" },
  { key: "linkDistance", label: "Base link distance", desc: "Base preferred distance before per-type distance multipliers (5–500)", section: "forces", type: "slider", min: 5, max: 500, step: 5, effect: "force" },
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
