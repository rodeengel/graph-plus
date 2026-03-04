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

// Matches [key:: value] and (key:: value) inline fields
const INLINE_FIELD_RE = /[\[(](\w[\w\s]*)::([^\])]+)[\])]/g;

// Matches [[wikilink]] or [[wikilink|alias]]
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

// Matches #tag in body text (not inside frontmatter)
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
 * Parses typed links from frontmatter and inline fields,
 * plus untyped links from regular wikilinks.
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
      node = { id: path, name, tags: [], isAttachment, exists };
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
   * Resolve a link target. If createIfMissing is true (for explicit [[wikilinks]]),
   * creates an unresolved node when the file doesn't exist.
   * For plain text values (createIfMissing=false), returns null if unresolved.
   */
  function resolveLink(linkText: string, sourceFile: TFile, createIfMissing: boolean = false): string | null {
    const dest = app.metadataCache.getFirstLinkpathDest(linkText, sourceFile.path);
    if (dest) {
      ensureNode(dest.path, dest.basename, true);
      return dest.path;
    }
    if (!createIfMissing) return null;
    // Unresolved wikilink — create a non-existent node
    const unresolvedPath = linkText.endsWith(".md") ? linkText : linkText + ".md";
    const unresolvedName = linkText.replace(/\.md$/, "").split("/").pop() ?? linkText;
    ensureNode(unresolvedPath, unresolvedName, false);
    return unresolvedPath;
  }

  // Read all files in parallel for inline field parsing
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

    // --- Collect tags ---
    // From frontmatter
    if (cache?.frontmatter) {
      const fmTags = cache.frontmatter.tags ?? cache.frontmatter.tag;
      if (fmTags) {
        const tagArray = Array.isArray(fmTags) ? fmTags : [fmTags];
        for (const t of tagArray) {
          const tagStr = String(t).replace(/^#/, "");
          if (tagStr && !node.tags.includes(tagStr)) {
            node.tags.push(tagStr);
          }
        }
      }
    }
    // From body text
    if (content) {
      const bodyContent = stripFrontmatter(content);
      for (const m of bodyContent.matchAll(TAG_RE)) {
        const tag = m[1];
        if (!node.tags.includes(tag)) {
          node.tags.push(tag);
        }
      }
    }

    // --- Frontmatter typed links ---
    if (cache?.frontmatter) {
      const fm = cache.frontmatter;
      const skipKeys = new Set([
        "tags", "tag", "aliases", "alias",
        "cssclasses", "cssclass", "position",
      ]);

      for (const [key, value] of Object.entries(fm)) {
        if (skipKeys.has(key)) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          const strVal = String(v);
          // Extract wikilinks from the value (create unresolved nodes for missing targets)
          for (const m of strVal.matchAll(WIKILINK_RE)) {
            const targetPath = resolveLink(m[1], file, true);
            if (targetPath) {
              addLink(file.path, targetPath, key);
              typedTargets.add(targetPath);
            }
          }
          // Also handle plain text values that might be a note name (strict: no unresolved nodes)
          if (!strVal.includes("[[") && !strVal.startsWith("#")) {
            const targetPath = resolveLink(strVal.trim(), file, false);
            if (targetPath) {
              addLink(file.path, targetPath, key);
              typedTargets.add(targetPath);
            }
          }
        }
      }
    }

    // --- Inline fields + untyped links from body text ---
    if (content) {
      const bodyContent = stripFrontmatter(content);

      // Find inline fields
      for (const fieldMatch of bodyContent.matchAll(INLINE_FIELD_RE)) {
        const fieldKey = fieldMatch[1].trim();
        const fieldValue = fieldMatch[2];

        for (const wikiMatch of fieldValue.matchAll(WIKILINK_RE)) {
          const targetPath = resolveLink(wikiMatch[1], file, true);
          if (targetPath) {
            addLink(file.path, targetPath, fieldKey);
            typedTargets.add(targetPath);
          }
        }
      }

      // Untyped wikilinks from body (create unresolved nodes for missing targets)
      for (const untypedMatch of bodyContent.matchAll(WIKILINK_RE)) {
        const targetPath = resolveLink(untypedMatch[1], file, true);
        if (targetPath && !typedTargets.has(targetPath)) {
          addLink(file.path, targetPath, UNTYPED_LINK_KEY);
        }
      }
    } else if (cache?.links) {
      // Fallback: use metadataCache links for untyped
      for (const linkCache of cache.links) {
        const targetPath = resolveLink(linkCache.link, file, true);
        if (targetPath && !typedTargets.has(targetPath)) {
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
 * Apply node groups: test groups in order, first match sets node.group.
 * Query formats: path:prefix, tag:#tagname, file:pattern, or bare substring.
 */
export function applyNodeGroups(nodes: GraphNode[], groups: NodeGroup[]): void {
  for (const node of nodes) {
    node.group = undefined;
    for (const group of groups) {
      if (matchesGroupQuery(node, group.query)) {
        node.group = group.name;
        break;
      }
    }
  }
}

function matchesGroupQuery(node: GraphNode, query: string): boolean {
  const q = query.trim();
  if (!q) return false;

  if (q.startsWith("path:")) {
    const prefix = q.slice(5);
    return node.id.startsWith(prefix);
  }
  if (q.startsWith("tag:#")) {
    const tag = q.slice(5);
    return node.tags.some((t) => t === tag || t.startsWith(tag + "/"));
  }
  if (q.startsWith("file:")) {
    const pattern = q.slice(5).toLowerCase();
    return node.name.toLowerCase().includes(pattern);
  }
  // Bare substring: match against path
  return node.id.toLowerCase().includes(q.toLowerCase());
}

/**
 * Assign curvatures for parallel edges (multiple links between same node pair).
 * Groups by unordered pair, distributes curvatures symmetrically.
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
    const step = 0.2;
    const total = group.length;
    for (let i = 0; i < total; i++) {
      // Distribute symmetrically around 0
      group[i].curvature = (i - (total - 1) / 2) * step;
    }
  }
}

/**
 * Filter graph data based on current visibility settings.
 */
export function filterGraphData(
  data: GraphData,
  settings: GraphLinkTypesSettings,
  searchQuery?: string
): GraphData {
  // First filter nodes by search and node-level filters
  const nodePassesFilter = (node: GraphNode): boolean => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!node.name.toLowerCase().includes(q) && !node.id.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (!settings.showTags && node.tags.length > 0 && node.isAttachment === false && node.exists) {
      // showTags controls whether tag-only nodes are shown — we don't filter by tag presence
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

  // Nodes that have at least one visible link
  const connectedNodes = new Set<string>();
  for (const link of visibleLinks) {
    const sourceId = typeof link.source === "string" ? link.source : link.source.id;
    const targetId = typeof link.target === "string" ? link.target : link.target.id;
    connectedNodes.add(sourceId);
    connectedNodes.add(targetId);
  }

  const filteredNodes = data.nodes.filter((n) => {
    if (!allowedNodes.has(n.id)) return false;
    if (settings.showOrphans) return true;
    return connectedNodes.has(n.id);
  });

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
