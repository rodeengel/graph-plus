import type { GraphNode } from "./types";

type SearchNode = Pick<GraphNode, "id" | "name" | "tags" | "properties" | "relation">;
export type SearchMatcher = (node: SearchNode) => boolean;
type Token = { kind: "term"; match: SearchMatcher; structured: boolean; property: boolean; quoted: boolean }
  | { kind: "or" | "open" | "close" | "minus" };

const NEVER: SearchMatcher = () => false;
const CACHE_LIMIT = 128;
const MAX_LENGTH = 4096;
const MAX_TOKENS = 256;
const MAX_DEPTH = 32;
const queryCache = new Map<string, SearchMatcher>();

function invalid(): never {
  throw new Error("Invalid Graph Plus search query");
}

function quotedValue(source: string, start: number): { value: string; end: number } {
  const quote = source[start];
  let value = "";
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === quote) return { value, end: i + 1 };
    if (char === "\\" && (source[i + 1] === quote || source[i + 1] === "\\")) {
      value += source[++i];
    } else {
      value += char;
    }
  }
  return invalid();
}

function valueOf(raw: string): string {
  const value = raw.trim();
  if (!value) return invalid();
  if (value[0] !== '"' && value[0] !== "'") return value;
  const quoted = quotedValue(value, 0);
  if (quoted.end !== value.length || !quoted.value) return invalid();
  return quoted.value;
}

function atom(selector: "path" | "file" | "tag" | "bare" | "property", raw: string, key?: string): SearchMatcher {
  const value = valueOf(raw).toLowerCase();
  if (selector === "path") return (node) => (node.relation?.sourcePath ?? node.id).toLowerCase().startsWith(value);
  if (selector === "file") return (node) => node.name.toLowerCase().includes(value);
  if (selector === "tag") {
    const tag = value.replace(/^#/, "");
    if (!tag) return invalid();
    return (node) => node.tags.some((entry) => {
      const lower = entry.toLowerCase();
      return lower === tag || lower.startsWith(tag + "/");
    });
  }
  if (selector === "property") {
    const property = key!.toLowerCase();
    return (node) => node.properties[property]?.some((entry) => entry.includes(value)) ?? false;
  }
  return (node) => node.name.toLowerCase().includes(value)
    || (node.relation?.sourcePath ?? node.id).toLowerCase().includes(value);
}

/** Tokenize operators only outside quoted values and bracketed property values. */
function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < query.length;) {
    if (/\s/.test(query[i])) { i++; continue; }
    if (tokens.length >= MAX_TOKENS) return invalid();
    const char = query[i];
    if (char === "(" || char === ")" || char === "-") {
      tokens.push({ kind: char === "(" ? "open" : char === ")" ? "close" : "minus" });
      i++;
      continue;
    }
    if (char === "[") {
      const start = ++i;
      for (; i < query.length && query[i] !== "]"; i++) {
        if (query[i] === "[") return invalid();
        // Property values may contain spaces and operators without creating a compound.
        if ((query[i] === '"' || query[i] === "'") && /^\w+:\s*$/.test(query.slice(start, i))) {
          i = quotedValue(query, i).end - 1;
        }
      }
      if (i === query.length) return invalid();
      const property = query.slice(start, i++).match(/^(\w+):([\s\S]+)$/);
      if (!property) return invalid();
      if (i < query.length && !/[\s()]/.test(query[i])) return invalid();
      tokens.push({ kind: "term", match: atom("property", property[2], property[1]), structured: true,
        property: true, quoted: /^[\s]*["']/.test(property[2]) });
      continue;
    }
    if (char === "]") return invalid();
    const prefix = query.slice(i).match(/^(path|file|tag):/);
    if (prefix) {
      i += prefix[0].length;
      const valueStart = i;
      while (i < query.length && /\s/.test(query[i])) i++;
      // An unfinished prefix must not consume the next operator/filter and become valid under negation.
      if (i > valueStart && (/^(?:OR|AND|NOT|-+)(?:$|\s|[()])/.test(query.slice(i))
        || /^-*(?:path|file|tag):/.test(query.slice(i)))) return invalid();
    }
    const start = i;
    let quoted = false;
    if (query[i] === '"' || query[i] === "'") {
      quoted = true;
      i = quotedValue(query, i).end;
      if (i < query.length && !/[\s()]/.test(query[i])) return invalid();
    } else {
      while (i < query.length && !/[\s()[\]]/.test(query[i])) i++;
      if (query[i] === "[" || query[i] === "]") return invalid();
    }
    const raw = query.slice(start, i);
    if (!prefix && !quoted && raw === "OR") {
      tokens.push({ kind: "or" });
    } else {
      if (!quoted && ((!prefix && (raw === "AND" || raw === "NOT")) || raw.includes("||") || raw.includes("&&"))) return invalid();
      tokens.push({ kind: "term", match: atom(prefix ? prefix[1] as "path" | "file" | "tag" : "bare", raw),
        structured: !!prefix, property: false, quoted });
    }
  }
  return tokens;
}

function hasCompoundSyntax(tokens: Token[]): boolean {
  let terms = 0;
  for (const token of tokens) {
    if (token.kind === "or" || token.kind === "open" || token.kind === "close") return true;
    if (token.kind === "minus" && terms > 0) return true;
    if (token.kind === "term") {
      if (token.quoted || (token.structured && terms > 0) || (token.property && tokens.length > 1)) return true;
      terms++;
    }
  }
  return false;
}

function legacy(query: string, depth = 0): SearchMatcher {
  if (depth > MAX_DEPTH) return invalid();
  if (query.startsWith("-")) {
    const inner = query.slice(1).trim();
    if (!inner) return invalid();
    const match = legacy(inner, depth + 1);
    return (node) => !match(node);
  }
  const prefix = query.match(/^(path|file|tag):/);
  if (prefix) return atom(prefix[1] as "path" | "file" | "tag", query.slice(prefix[0].length));
  const property = query.match(/^\[(\w+):([\s\S]+)\]$/);
  if (property) return atom("property", property[2], property[1]);
  return atom("bare", query);
}

function compound(tokens: Token[]): SearchMatcher {
  let index = 0;
  function unary(depth: number): SearchMatcher {
    if (depth > MAX_DEPTH) return invalid();
    const token = tokens[index++];
    if (!token) return invalid();
    if (token.kind === "minus") {
      const match = unary(depth + 1);
      return (node) => !match(node);
    }
    if (token.kind === "open") {
      const match = disjunction(depth + 1);
      if (tokens[index++]?.kind !== "close") return invalid();
      return match;
    }
    if (token.kind !== "term") return invalid();
    return token.match;
  }
  function conjunction(depth: number): SearchMatcher {
    let match = unary(depth);
    while (index < tokens.length && tokens[index].kind !== "or" && tokens[index].kind !== "close") {
      const left = match;
      const right = unary(depth);
      match = (node) => left(node) && right(node);
    }
    return match;
  }
  function disjunction(depth: number): SearchMatcher {
    let match = conjunction(depth);
    while (tokens[index]?.kind === "or") {
      index++;
      const left = match;
      const right = conjunction(depth);
      match = (node) => left(node) || right(node);
    }
    return match;
  }
  const match = disjunction(0);
  if (index !== tokens.length) return invalid();
  return match;
}

/** Compile once per distinct query; invalid expressions always match no nodes, including under negation. */
export function compileSearchQuery(query: string): SearchMatcher {
  const key = query.trim();
  if (!key || key.length > MAX_LENGTH) return NEVER;
  const cached = queryCache.get(key);
  if (cached) return cached;
  let match: SearchMatcher;
  try {
    const tokens = tokenize(key);
    match = hasCompoundSyntax(tokens) ? compound(tokens) : legacy(key);
  } catch {
    match = NEVER;
  }
  if (queryCache.size >= CACHE_LIMIT) queryCache.delete(queryCache.keys().next().value!);
  queryCache.set(key, match);
  return match;
}
