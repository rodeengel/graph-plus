import { App, TFile } from "obsidian";
import {
  GraphData,
  GraphNode,
  GraphLink,
  GraphLinkTypesSettings,
  LinkTypeConfig,
  COLOR_PALETTE,
  UNTYPED_LINK_KEY,
} from "./types";

// Matches [key:: value] and (key:: value) inline fields
const INLINE_FIELD_RE = /[\[(](\w[\w\s]*)::([^\])]+)[\])]/g;

// Matches [[wikilink]] or [[wikilink|alias]]
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

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

  function ensureNode(path: string, name: string): void {
    if (!nodeMap.has(path)) {
      nodeMap.set(path, { id: path, name });
    }
  }

  function addLink(sourcePath: string, targetPath: string, type: string): void {
    const key = `${sourcePath}|${targetPath}|${type}`;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push({ source: sourcePath, target: targetPath, type });
    ensureLinkType(settings, type);
  }

  function resolveLink(linkText: string, sourceFile: TFile): string | null {
    const dest = app.metadataCache.getFirstLinkpathDest(linkText, sourceFile.path);
    if (!dest) return null;
    ensureNode(dest.path, dest.basename);
    return dest.path;
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
    ensureNode(file.path, file.basename);

    const cache = app.metadataCache.getFileCache(file);
    const typedTargets = new Set<string>(); // paths found via typed links

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
          // Extract wikilinks from the value
          for (const m of strVal.matchAll(WIKILINK_RE)) {
            const targetPath = resolveLink(m[1], file);
            if (targetPath) {
              addLink(file.path, targetPath, key);
              typedTargets.add(targetPath);
            }
          }
          // Also handle plain text values that might be a note name
          if (!strVal.includes("[[") && !strVal.startsWith("#")) {
            const targetPath = resolveLink(strVal.trim(), file);
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
          const targetPath = resolveLink(wikiMatch[1], file);
          if (targetPath) {
            addLink(file.path, targetPath, fieldKey);
            typedTargets.add(targetPath);
          }
        }
      }

      // Untyped wikilinks from body
      for (const untypedMatch of bodyContent.matchAll(WIKILINK_RE)) {
        const targetPath = resolveLink(untypedMatch[1], file);
        if (targetPath && !typedTargets.has(targetPath)) {
          addLink(file.path, targetPath, UNTYPED_LINK_KEY);
        }
      }
    } else if (cache?.links) {
      // Fallback: use metadataCache links for untyped
      for (const linkCache of cache.links) {
        const targetPath = resolveLink(linkCache.link, file);
        if (targetPath && !typedTargets.has(targetPath)) {
          addLink(file.path, targetPath, UNTYPED_LINK_KEY);
        }
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links,
  };
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
 * Filter graph data based on current visibility settings.
 */
export function filterGraphData(
  data: GraphData,
  settings: GraphLinkTypesSettings
): GraphData {
  const visibleLinks = data.links.filter((link) => {
    if (link.type === UNTYPED_LINK_KEY && !settings.showUntyped) return false;
    const config = settings.linkTypes[link.type];
    return config ? config.visible : true;
  });

  // Only include nodes that have at least one visible link
  const connectedNodes = new Set<string>();
  for (const link of visibleLinks) {
    const sourceId = typeof link.source === "string" ? link.source : link.source.id;
    const targetId = typeof link.target === "string" ? link.target : link.target.id;
    connectedNodes.add(sourceId);
    connectedNodes.add(targetId);
  }

  return {
    nodes: data.nodes.filter((n) => connectedNodes.has(n.id)),
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
