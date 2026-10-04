import type {
  ExplicitRelation, GraphData, GraphLink, GraphNode, RelationDiagnostic,
  SemanticEntity, SemanticGraph, SemanticLink,
} from "./types";

/** Freeze copies, never the mutable objects owned by a renderer or filter. */
export function createSemanticGraph(
  nodes: GraphNode[], links: GraphLink[], relations: ExplicitRelation[], diagnostics: RelationDiagnostic[]
): SemanticGraph {
  const entities: SemanticEntity[] = nodes.map((node) => {
    const properties: Record<string, readonly string[]> = {};
    for (const [key, values] of Object.entries(node.properties)) properties[key] = Object.freeze([...values]);
    return Object.freeze({
      id: node.id, name: node.name, tags: Object.freeze([...node.tags]),
      isAttachment: node.isAttachment, exists: node.exists, properties: Object.freeze(properties),
    });
  });
  const ordinaryLinks: SemanticLink[] = links.filter((link) => link.kind !== "membership").map((link) => {
    const source = typeof link.source === "string" ? link.source : link.source.id;
    const target = typeof link.target === "string" ? link.target : link.target.id;
    return Object.freeze({ id: JSON.stringify([source, target, link.type]), source, target, type: link.type, sourcePath: source });
  });
  return Object.freeze({
    entities: Object.freeze(entities), links: Object.freeze(ordinaryLinks),
    relations: Object.freeze(relations.map((relation) => Object.freeze({ ...relation, members: Object.freeze([...relation.members]) }))),
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))),
  });
}

export function relationJunctionId(relationId: string): string {
  // NUL cannot occur in an Obsidian file path, so authored IDs cannot collide with entities.
  return `\u0000relation:${relationId}`;
}

/**
 * A relation remains one record; its displayed spokes are membership incidence,
 * not inferred directed pairwise facts. Standard mode uses the actual source note.
 */
export function projectGraphData(data: GraphData, junctions: boolean): GraphData {
  if (!data.semantic) {
    return { nodes: data.nodes.map(cloneNode), links: data.links.map(cloneLink) };
  }
  const semantic = data.semantic;
  const prior = new Map(data.nodes.map((node) => [node.relation?.sourcePath ?? node.id, node]));
  const relationSources = new Map(semantic.relations.map((relation) => [relation.sourcePath, relation]));
  const endpoint = (id: string): string => {
    const relation = relationSources.get(id);
    return junctions && relation ? relationJunctionId(relation.id) : id;
  };
  const nodes: GraphNode[] = semantic.entities.map((entity) => {
    const relation = relationSources.get(entity.id);
    const previous = prior.get(entity.id);
    return {
      id: endpoint(entity.id), name: entity.name, tags: [...entity.tags],
      isAttachment: entity.isAttachment, exists: entity.exists,
      properties: Object.fromEntries(Object.entries(entity.properties).map(([key, values]) => [key, [...values]])),
      groupColor: previous?.groupColor,
      ...(junctions && relation ? { relation } : {}),
    };
  });
  const links: GraphLink[] = semantic.links.map((link) => ({
    source: endpoint(link.source), target: endpoint(link.target), type: link.type, curvature: 0,
  }));
  for (const relation of semantic.relations) {
    for (const member of relation.members) {
      links.push({
        source: endpoint(relation.sourcePath), target: endpoint(member), type: relation.type, curvature: 0,
        kind: "membership", relationId: relation.id, memberCount: relation.members.length,
      });
    }
  }
  assignProjectionCurvatures(links);
  return { nodes, links, semantic };
}

function cloneNode(node: GraphNode): GraphNode {
  return { ...node, tags: [...node.tags], properties: Object.fromEntries(Object.entries(node.properties).map(([key, values]) => [key, [...values]])) };
}

function cloneLink(link: GraphLink): GraphLink {
  return {
    ...link,
    source: typeof link.source === "string" ? link.source : link.source.id,
    target: typeof link.target === "string" ? link.target : link.target.id,
  };
}

function assignProjectionCurvatures(links: GraphLink[]): void {
  const pairs = new Map<string, GraphLink[]>();
  for (const link of links) {
    const source = link.source as string;
    const target = link.target as string;
    const key = JSON.stringify(source < target ? [source, target] : [target, source]);
    const group = pairs.get(key) ?? [];
    group.push(link);
    pairs.set(key, group);
  }
  for (const group of pairs.values()) {
    group.forEach((link, index) => {
      link.curvature = (index - (group.length - 1) / 2) * 0.3;
      if ((link.source as string) > (link.target as string)) link.curvature = -link.curvature;
    });
  }
}
