import { App, TFile } from "obsidian";
import {
  GraphData,
  GraphNode,
  GraphLink,
  GraphLinkTypesSettings,
  LinkTypeConfig,
  NodeGroup,
  COLOR_PALETTE,
  UNTYPED_LINK_KEY,
} from "./types";

// Matches [[wikilink]] or [[wikilink|alias]]
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

// Matches key:: rest-of-line (handles bare, bracket-wrapped, and paren-wrapped inline fields)
// The value capture extends to end of line; wikilinks are extracted from it separately.
const INLINE_FIELD_RE = /([\w][\w ]*?)::[ \t]*(.*)/gm;

// Matches #tag in body text
const TAG_RE = /#([a-zA-Z_][\w/-]*)/g;

// Extensions considered attachments (non-markdown)
const ATTACHMENT_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "svg", "webp",
  "mp3", "wav", "ogg", "m4a", "flac",
  "mp4", "webm", "ogv", "mov",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "rar", "7z", "tar", "gz",
  "csv", "json", "xml", "yaml", "yml",
]);

/**
 * Build the full graph data from the vault.
 */
export async function buildGraphData(
  app: App,
  settings: GraphLinkTypesSettings
): Promise<GraphData> {
  const nodeMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const linkSet = new Set<string>(); // dedup: "source|target|type"

  const markdownFiles = app.vault.getMarkdownFiles();

  function ensureNode(path: string, name: string, exists: boolean = true): GraphNode {
    let node = nodeMap.get(path);
    if (!node) {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const isAttachment = !path.endsWith(".md") && ATTACHMENT_EXTENSIONS.has(ext);
      node = { id: path, name, tags: [], isAttachment, exists, properties: {} };
      nodeMap.set(path, node);
    }
    if (exists && !node.exists) {
      node.exists = true;
    }
    return node;
  }

  function addLink(sourcePath: string, targetPath: string, type: string): void {
    const key = `${sourcePath}|${targetPath}|${type}`;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push({ source: sourcePath, target: targetPath, type, curvature: 0 });
    ensureLinkType(settings, type);
  }

  /**
   * Resolve a wikilink target. Creates an unresolved node when the file doesn't exist.
   */
  function resolveWikilink(linkText: string, sourceFile: TFile): string {
    const dest = app.metadataCache.getFirstLinkpathDest(linkText, sourceFile.path);
    if (dest) {
      ensureNode(dest.path, dest.basename, true);
      return dest.path;
    }
    // Unresolved wikilink — create a non-existent node
    const unresolvedPath = linkText.endsWith(".md") ? linkText : linkText + ".md";
    const unresolvedName = linkText.replace(/\.md$/, "").split("/").pop() ?? linkText;
    ensureNode(unresolvedPath, unresolvedName, false);
    return unresolvedPath;
  }

  // Read all files in parallel
  const fileContents = await Promise.all(
    markdownFiles.map(async (file) => {
      try {
        const content = await app.vault.cachedRead(file);
        return { file, content };
      } catch {
        return { file, content: null };
      }
    })
  );

  for (const { file, content } of fileContents) {
    const node = ensureNode(file.path, file.basename, true);

    const cache = app.metadataCache.getFileCache(file);
    const typedTargets = new Set<string>(); // paths found via typed links

    // --- Collect tags & properties from frontmatter ---
    if (cache?.frontmatter) {
      const fm = cache.frontmatter;

      // Store all frontmatter properties for query matching
      for (const [key, value] of Object.entries(fm)) {
        if (key === "position") continue; // internal Obsidian field
        const values = Array.isArray(value) ? value : [value];
        node.properties[key.toLowerCase()] = values.map((v) => String(v).toLowerCase());
      }

      // Extract tags
      const fmTags = fm.tags ?? fm.tag;
      if (fmTags) {
        const tagArray = Array.isArray(fmTags) ? fmTags : [fmTags];
        for (const t of tagArray) {
          const tagStr = String(t).replace(/^#/, "");
          if (tagStr && !node.tags.includes(tagStr)) {
            node.tags.push(tagStr);
          }
        }
      }

      // --- Frontmatter typed links (ONLY from explicit [[wikilinks]]) ---
      const skipKeys = new Set([
        "tags", "tag", "aliases", "alias",
        "cssclasses", "cssclass", "position",
      ]);

      for (const [key, value] of Object.entries(fm)) {
        if (skipKeys.has(key)) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          const strVal = String(v);
          // Only extract explicit wikilinks — do NOT resolve plain text values
          for (const m of strVal.matchAll(WIKILINK_RE)) {
            const targetPath = resolveWikilink(m[1], file);
            addLink(file.path, targetPath, key);
            typedTargets.add(targetPath);
          }
        }
      }
    }

    // --- Body text: tags, inline fields, untyped links ---
    if (content) {
      const bodyContent = stripFrontmatter(content);

      // Collect body tags
      for (const m of bodyContent.matchAll(TAG_RE)) {
        const tag = m[1];
        if (!node.tags.includes(tag)) {
          node.tags.push(tag);
        }
      }

      // Inline fields (bare, bracket-wrapped, and paren-wrapped)
      for (const fieldMatch of bodyContent.matchAll(INLINE_FIELD_RE)) {
        const fieldKey = fieldMatch[1].trim();
        const fieldValue = fieldMatch[2];

        for (const wikiMatch of fieldValue.matchAll(WIKILINK_RE)) {
          const targetPath = resolveWikilink(wikiMatch[1], file);
          addLink(file.path, targetPath, fieldKey);
          typedTargets.add(targetPath);
        }
      }

      // Untyped wikilinks from body
      for (const untypedMatch of bodyContent.matchAll(WIKILINK_RE)) {
        const targetPath = resolveWikilink(untypedMatch[1], file);
        if (!typedTargets.has(targetPath)) {
          addLink(file.path, targetPath, UNTYPED_LINK_KEY);
        }
      }
    } else if (cache?.links) {
      // Fallback: use metadataCache links for untyped
      for (const linkCache of cache.links) {
        const targetPath = resolveWikilink(linkCache.link, file);
        if (!typedTargets.has(targetPath)) {
          addLink(file.path, targetPath, UNTYPED_LINK_KEY);
        }
      }
    }
  }

  const nodes = Array.from(nodeMap.values());

  // Apply node groups
  applyNodeGroups(nodes, settings.nodeGroups);

  // Assign curvatures for parallel edges
  assignCurvatures(links);

  // Clean up stale link types (types that no longer exist in the data)
  cleanStaleLinkTypes(settings, links);

  return { nodes, links };
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return content;
  return content.slice(endIdx + 3);
}

/**
 * Ensure a link type exists in settings, auto-assigning a color from the palette.
 */
export function ensureLinkType(
  settings: GraphLinkTypesSettings,
  type: string
): void {
  if (settings.linkTypes[type]) return;
  const usedColors = new Set(
    Object.values(settings.linkTypes).map((c: LinkTypeConfig) => c.color)
  );
  const color =
    COLOR_PALETTE.find((c) => !usedColors.has(c)) ??
    COLOR_PALETTE[Object.keys(settings.linkTypes).length % COLOR_PALETTE.length];
  settings.linkTypes[type] = { color, visible: true };
}

/**
 * Remove link types from settings that have zero links in current data.
 */
function cleanStaleLinkTypes(settings: GraphLinkTypesSettings, links: GraphLink[]): void {
  const activeTypes = new Set<string>();
  for (const link of links) {
    activeTypes.add(link.type);
  }
  for (const type of Object.keys(settings.linkTypes)) {
    if (!activeTypes.has(type)) {
      delete settings.linkTypes[type];
    }
  }
}

/**
 * Apply node groups: test groups in order, first match sets node.groupColor.
 */
export function applyNodeGroups(nodes: GraphNode[], groups: NodeGroup[]): void {
  for (const node of nodes) {
    node.groupColor = undefined;
    for (const group of groups) {
      if (matchesQuery(node, group.query)) {
        node.groupColor = group.color;
        break;
      }
    }
  }
}

/**
 * Test if a node matches a query string.
 * Supports: path:prefix, file:pattern, tag:#name, [property:value], -negation, bare substring.
 */
export function matchesQuery(node: GraphNode, query: string): boolean {
  const q = query.trim();
  if (!q) return false;

  // Negation
  if (q.startsWith("-")) {
    const inner = q.slice(1);
    return inner.length > 0 && !matchesQuery(node, inner);
  }

  // path: prefix
  if (q.startsWith("path:")) {
    const prefix = q.slice(5).trim();
    return node.id.toLowerCase().startsWith(prefix.toLowerCase());
  }

  // file: pattern
  if (q.startsWith("file:")) {
    const pattern = q.slice(5).trim().toLowerCase();
    return node.name.toLowerCase().includes(pattern);
  }

  // tag:#name
  if (q.startsWith("tag:#")) {
    const tag = q.slice(5).trim().toLowerCase();
    return node.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(tag + "/"));
  }
  // Also support tag:name (without #)
  if (q.startsWith("tag:")) {
    const tag = q.slice(4).trim().toLowerCase();
    return node.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(tag + "/"));
  }

  // [property:value] — frontmatter property match (strips quotes from value)
  const propMatch = q.match(/^\[(\w+):(.+)\]$/);
  if (propMatch) {
    const prop = propMatch[1].toLowerCase();
    const val = propMatch[2].trim().replace(/^["']|["']$/g, "").toLowerCase();
    const nodeVals = node.properties[prop];
    if (!nodeVals) return false;
    return nodeVals.some((v) => v.includes(val));
  }

  // Bare text: match node name or path (case-insensitive substring)
  const lower = q.toLowerCase();
  return node.name.toLowerCase().includes(lower) || node.id.toLowerCase().includes(lower);
}

/**
 * Assign curvatures for parallel edges (multiple links between same node pair).
 */
export function assignCurvatures(links: GraphLink[]): void {
  const pairMap = new Map<string, GraphLink[]>();

  for (const link of links) {
    const sId = typeof link.source === "string" ? link.source : link.source.id;
    const tId = typeof link.target === "string" ? link.target : link.target.id;
    const pairKey = sId < tId ? `${sId}|${tId}` : `${tId}|${sId}`;
    let arr = pairMap.get(pairKey);
    if (!arr) {
      arr = [];
      pairMap.set(pairKey, arr);
    }
    arr.push(link);
  }

  for (const group of pairMap.values()) {
    if (group.length <= 1) {
      group[0].curvature = 0;
      continue;
    }
    const step = 0.3; // increased from 0.2 for more visible curvature
    const total = group.length;
    for (let i = 0; i < total; i++) {
      group[i].curvature = (i - (total - 1) / 2) * step;
    }
  }
}

/**
 * Filter graph data based on current visibility settings and optional search query.
 */
export function filterGraphData(
  data: GraphData,
  settings: GraphLinkTypesSettings,
  searchQuery?: string
): GraphData {
  // Filter nodes by search and node-level filters
  const nodePassesFilter = (node: GraphNode): boolean => {
    if (searchQuery) {
      if (!matchesQuery(node, searchQuery)) {
        return false;
      }
    }
    if (!settings.showAttachments && node.isAttachment) {
      return false;
    }
    if (settings.existingOnly && !node.exists) {
      return false;
    }
    return true;
  };

  const allowedNodes = new Set<string>();
  for (const node of data.nodes) {
    if (nodePassesFilter(node)) {
      allowedNodes.add(node.id);
    }
  }

  const visibleLinks = data.links.filter((link) => {
    if (link.type === UNTYPED_LINK_KEY && !settings.showUntyped) return false;
    const config = settings.linkTypes[link.type];
    if (config && !config.visible) return false;

    const sourceId = typeof link.source === "string" ? link.source : link.source.id;
    const targetId = typeof link.target === "string" ? link.target : link.target.id;
    return allowedNodes.has(sourceId) && allowedNodes.has(targetId);
  });

  // Count links per node for sizing
  const linkCounts = new Map<string, number>();
  for (const link of visibleLinks) {
    const sourceId = typeof link.source === "string" ? link.source : link.source.id;
    const targetId = typeof link.target === "string" ? link.target : link.target.id;
    linkCounts.set(sourceId, (linkCounts.get(sourceId) ?? 0) + 1);
    linkCounts.set(targetId, (linkCounts.get(targetId) ?? 0) + 1);
  }

  // Nodes connected via visible links
  const connectedNodes = new Set<string>(linkCounts.keys());

  const filteredNodes = data.nodes.filter((n) => {
    if (!allowedNodes.has(n.id)) return false;
    if (settings.showOrphans) return true;
    return connectedNodes.has(n.id);
  });

  // Set link counts on nodes
  for (const node of filteredNodes) {
    node.linkCount = linkCounts.get(node.id) ?? 0;
  }

  // Reassign curvatures for parallel edges among visible links only
  assignCurvatures(visibleLinks);

  return {
    nodes: filteredNodes,
    links: visibleLinks,
  };
}

/**
 * Count links per type.
 */
export function countLinkTypes(data: GraphData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const link of data.links) {
    counts.set(link.type, (counts.get(link.type) ?? 0) + 1);
  }
  return counts;
}
