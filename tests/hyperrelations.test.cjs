"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  stdin: {
    contents: 'export * from "./src/linkParser"; export * from "./src/types"; export * from "./src/semanticGraph";',
    resolveDir: root, loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", target: "es2020",
  external: ["obsidian"], write: false, logLevel: "silent",
});
const compiled = new Module(path.join(__dirname, "hyperrelations.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const {
  buildGraphData, projectGraphData, relationJunctionId, filterGraphData,
  matchesQuery, applyNodeGroups, countLinkTypes, getMembershipLinkStrength,
  DEFAULT_SETTINGS, UNTYPED_LINK_KEY, MAX_EFFECTIVE_LINK_STRENGTH,
} = compiled.exports;

const fixtureDir = path.join(__dirname, "fixtures", "hyperrelations");
const validNames = ["Alice", "Bob", "Carol", "Dan", "Triad", "Liaison"];
function fixtures(names = validNames) {
  return names.map((name) => {
    const content = fs.readFileSync(path.join(fixtureDir, `${name}.md`), "utf8");
    // The fixture only implements the parsed frontmatter shape supplied by
    // Obsidian. YAML parsing itself remains Obsidian's responsibility.
    const frontmatter = {};
    const fmText = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmText) {
      let listKey;
      for (const line of fmText[1].split(/\r?\n/)) {
        const item = line.match(/^  - (.+)$/);
        if (item) { frontmatter[listKey].push(JSON.parse(item[1])); continue; }
        const field = line.match(/^(\w+):\s*(.*)$/);
        if (!field) continue;
        const [, key, value] = field;
        if (!value) { listKey = key; frontmatter[key] = []; }
        else frontmatter[key] = value === "true" ? true : value === "false" ? false : value;
      }
    }
    return { path: `${name}.md`, content, frontmatter };
  });
}
function appFor(notes, attachments = []) {
  const files = notes.map((note) => ({ path: note.path, basename: path.posix.basename(note.path, ".md") }));
  return {
    vault: {
      getMarkdownFiles() { return files; },
      async cachedRead(file) { return notes.find((note) => note.path === file.path).content ?? ""; },
    },
    metadataCache: {
      getFileCache(file) { return { frontmatter: notes.find((note) => note.path === file.path).frontmatter ?? {} }; },
      getFirstLinkpathDest(target) {
        return [...files, ...attachments].find((file) => file.path === target || file.path === `${target}.md` || file.basename === target) ?? null;
      },
    },
  };
}
function settings(overrides = {}) { return structuredClone({ ...DEFAULT_SETTINGS, ...overrides }); }
function linkEndpoints(link) { return [typeof link.source === "string" ? link.source : link.source.id, typeof link.target === "string" ? link.target : link.target.id]; }

test("explicit overlapping relations retain identity, shared entities, and independently authored ordinary links", async () => {
  const config = settings();
  const data = await buildGraphData(appFor(fixtures()), config);
  assert.deepEqual(data.semantic.relations.map(({ id, type, ordered, members, sourcePath }) => ({ id, type, ordered, members, sourcePath })), [
    { id: "alliance-triad", type: "alliance", ordered: false, members: ["Alice.md", "Bob.md", "Carol.md"], sourcePath: "Triad.md" },
    { id: "alliance-liaison", type: "alliance", ordered: false, members: ["Carol.md", "Dan.md"], sourcePath: "Liaison.md" },
  ]);
  assert.deepEqual(data.semantic.diagnostics, []);
  const projected = projectGraphData(data, true);
  assert.equal(projected.nodes.filter((node) => node.id === "Carol.md").length, 1);
  assert.equal(projected.nodes.filter((node) => node.relation).length, 2);
  assert.equal(projected.nodes.some((node) => node.id === "Triad.md" || node.id === "Liaison.md"), false);
  assert.equal(projected.links.filter((link) => link.kind === "membership").length, 5);
  assert.equal(projected.links.some((link) => link.type === "members"), false);
  assert.equal(projected.links.some((link) => link.type === "trusts" && link.source === "Alice.md" && link.target === "Bob.md"), true);
  assert.equal(projected.links.some((link) => link.type === "sponsor" && link.source === relationJunctionId("alliance-triad") && link.target === "Dan.md"), true);
  assert.equal(projected.links.some((link) => link.type === UNTYPED_LINK_KEY && link.source === "Alice.md" && link.target === relationJunctionId("alliance-triad")), true);
  assert.deepEqual(projected.links.filter((link) => link.kind === "membership" && link.target === "Carol.md").map((link) => link.relationId).sort(), ["alliance-liaison", "alliance-triad"]);
  assert.equal(countLinkTypes(projected).get("alliance"), 2, "type counts represent authored relations, not five projection spokes");
  assert.equal(data.semantic.links.every((link) => link.sourcePath === link.source), true);
  assert.equal(data.semantic.links.some((link) => link.type === "members"), false);
});

test("semantic snapshots are deeply frozen and independent of filters and simulation objects", async () => {
  const config = settings();
  const data = await buildGraphData(appFor(fixtures()), config);
  const semantic = data.semantic;
  assert.ok(Object.isFrozen(semantic) && Object.isFrozen(semantic.entities) && Object.isFrozen(semantic.links));
  assert.ok(Object.isFrozen(semantic.relations[0]) && Object.isFrozen(semantic.relations[0].members));
  const triad = semantic.entities.find((node) => node.id === "Triad.md");
  assert.ok(Object.isFrozen(triad.properties) && Object.isFrozen(triad.properties.members) && Object.isFrozen(triad.tags));
  assert.throws(() => semantic.relations[0].members.push("Invented.md"), TypeError);
  const one = projectGraphData(data, true);
  const two = projectGraphData(data, true);
  one.nodes.find((node) => node.id === "Alice.md").x = 100;
  one.nodes.find((node) => node.relation).properties.members.push("invented");
  one.links[0].source = one.nodes[0];
  assert.equal(two.nodes.find((node) => node.id === "Alice.md").x, undefined);
  assert.equal(triad.properties.members.includes("invented"), false);
  const filtered = filterGraphData(two, config, "-file:Carol");
  filtered.nodes[0].x = -123;
  filtered.links[0].source = filtered.nodes[0];
  assert.notEqual(filtered.nodes[0], two.nodes.find((node) => node.id === filtered.nodes[0].id));
  assert.equal(typeof two.links[0].source, "string");
  assert.equal(filtered.semantic, semantic);
  assert.deepEqual(filtered.nodes.find((node) => node.relation?.id === "alliance-triad").relation.members, ["Alice.md", "Bob.md", "Carol.md"], "inspection preserves complete membership when a participant is filtered out");
});

test("standard projection retains relationship notes, their connections, source queries, and group colors", async () => {
  const config = settings();
  const data = await buildGraphData(appFor(fixtures()), config);
  const standard = projectGraphData(data, false);
  assert.equal(standard.nodes.some((node) => node.id === "Triad.md"), true);
  assert.equal(standard.nodes.some((node) => node.relation), false);
  assert.equal(standard.links.filter((link) => link.kind === "membership" && link.source === "Triad.md").length, 3);
  assert.equal(standard.links.some((link) => link.source === "Alice.md" && link.target === "Triad.md"), true);
  const hyper = projectGraphData(data, true);
  const triad = hyper.nodes.find((node) => node.relation?.id === "alliance-triad");
  assert.equal(matchesQuery(triad, "path:Triad"), true);
  assert.equal(matchesQuery(triad, "Triad.md"), true);
  assert.equal(matchesQuery(triad, "[graph_kind:relation]"), true);
  applyNodeGroups(hyper.nodes, [{ query: "path:Triad", color: "#123456" }]);
  assert.equal(triad.groupColor, "#123456");
  assert.equal(projectGraphData(hyper, false).nodes.find((node) => node.id === "Triad.md").groupColor, "#123456");
});

test("duplicate IDs, invalid members, and unsupported ordering remain inspectable standard notes without hyperrelations", async () => {
  const names = [...validNames, "DuplicateOne", "DuplicateTwo", "Invalid", "Ordered"];
  const data = await buildGraphData(appFor(fixtures(names)), settings());
  assert.deepEqual(data.semantic.relations.map((relation) => relation.id), ["alliance-triad", "alliance-liaison"]);
  const diagnostics = data.semantic.diagnostics;
  assert.equal(diagnostics.filter((item) => item.code === "duplicate_id").length, 2);
  assert.equal(diagnostics.some((item) => item.code === "invalid_member" && item.sourcePath === "Invalid.md"), true);
  assert.equal(diagnostics.some((item) => item.code === "unsupported_ordering" && item.sourcePath === "Ordered.md"), true);
  const hyper = projectGraphData(data, true);
  for (const name of names.slice(validNames.length)) assert.equal(hyper.nodes.some((node) => node.id === `${name}.md` && !node.relation), true);
  assert.equal(hyper.links.some((link) => link.source === "DuplicateOne.md" && link.target === "Alice.md" && link.type === "members"), true);
  assert.equal(hyper.links.some((link) => link.source === "Ordered.md" && link.target === "Bob.md" && link.type === "members"), true);
  assert.equal(data.semantic.diagnostics.every((item) => item.severity === "error"), true);
});

test("member aliases resolve to one identity, role objects and attachments reject, and missing notes remain diagnosed entities", async () => {
  const common = { graph_kind: "relation", relation_type: "test", ordered: false };
  const notes = [
    { path: "Alice.md" }, { path: "Bob.md" },
    { path: "Repeated.md", frontmatter: { ...common, graph_id: "repeated", members: ["[[Alice]]", "[[Alice|Alias]]", "[[Bob]]"] } },
    { path: "Role.md", content: "[[Alice]]", frontmatter: { ...common, graph_id: "role", members: [{ role: "leader", member: "[[Alice]]" }, "[[Bob]]"] } },
    { path: "TopRole.md", frontmatter: { ...common, graph_id: "top-role", roles: ["leader", "follower"], members: ["[[Alice]]", "[[Bob]]"] } },
    { path: "Attachment.md", frontmatter: { ...common, graph_id: "attachment", members: ["[[Alice]]", "[[Image.png]]"] } },
    { path: "Missing.md", frontmatter: { ...common, graph_id: "missing", members: ["[[Alice]]", "[[Ghost]]"] } },
  ];
  const config = settings();
  const data = await buildGraphData(appFor(notes, [{ path: "Image.png", basename: "Image" }]), config);
  assert.deepEqual(data.semantic.relations.map((relation) => relation.id), ["missing"]);
  assert.equal(data.semantic.diagnostics.some((item) => item.code === "duplicate_member" && item.sourcePath === "Repeated.md"), true);
  assert.equal(data.semantic.diagnostics.some((item) => item.code === "invalid_member" && item.sourcePath === "Role.md"), true);
  assert.equal(data.semantic.diagnostics.some((item) => item.code === "unsupported_roles" && item.sourcePath === "TopRole.md"), true);
  assert.equal(data.semantic.diagnostics.some((item) => item.code === "invalid_member" && item.sourcePath === "Attachment.md"), true);
  assert.equal(data.semantic.diagnostics.some((item) => item.code === "unresolved_member" && item.severity === "warning"), true);
  const hyper = projectGraphData(data, true);
  assert.equal(hyper.nodes.find((node) => node.id === "Ghost.md").exists, false);
  const filtered = filterGraphData(hyper, { ...config, existingOnly: true });
  assert.equal(filtered.nodes.some((node) => node.id === "Ghost.md"), false);
  assert.deepEqual(filtered.nodes.find((node) => node.relation).relation.members, ["Alice.md", "Ghost.md"]);
  assert.equal(data.links.some((link) => link.source === "Role.md" && link.target === "Alice.md" && link.type === UNTYPED_LINK_KEY), true);
});

test("membership attraction has a bounded total budget and uses authored member count even under filtering", () => {
  for (const count of [2, 3, 10, 100]) {
    assert.equal(getMembershipLinkStrength(1, 1, count) * count, 1);
    assert.equal(getMembershipLinkStrength(2, 20, count) * count, MAX_EFFECTIVE_LINK_STRENGTH);
  }
  assert.equal(getMembershipLinkStrength(1, 0, 3), 0);
  assert.equal(getMembershipLinkStrength(-1, 1, 3), 0);
  assert.equal(getMembershipLinkStrength(1, NaN, 3), 0);
  assert.equal(getMembershipLinkStrength(Infinity, 1, 3), 0);
  assert.equal(getMembershipLinkStrength(1, 1, 0), 0.5);
});

test("ordinary triangles and shared tags do not infer relations, and explicit typed body links remain ordinary facts", async () => {
  const plain = [
    { path: "Alice.md", content: "knows:: [[Bob]] [[Carol]]\n#shared" },
    { path: "Bob.md", content: "knows:: [[Carol]]\n#shared" },
    { path: "Carol.md", content: "#shared" },
  ];
  const ordinary = await buildGraphData(appFor(plain), settings());
  assert.equal(ordinary.semantic.relations.length, 0);
  assert.equal(ordinary.semantic.links.length, 3);
  assert.equal(projectGraphData(ordinary, true).links.length, 3);
  const authored = [...plain, {
    path: "Authored.md", content: "knows:: [[Alice]]\n[[Alice]] [[Bob]]",
    frontmatter: { graph_kind: "relation", graph_id: "authored", relation_type: "alliance", ordered: false, members: ["[[Alice]]", "[[Bob]]"] },
  }];
  const data = await buildGraphData(appFor(authored), settings());
  assert.equal(data.links.filter((link) => link.source === "Authored.md" && link.kind === "membership").length, 2);
  assert.equal(data.links.filter((link) => link.source === "Authored.md" && link.type === "knows").length, 1);
  assert.equal(data.links.some((link) => link.source === "Authored.md" && link.type === UNTYPED_LINK_KEY), false);
  assert.equal(data.semantic.links.find((link) => link.source === "Authored.md").sourcePath, "Authored.md");
});
