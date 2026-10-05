const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

const result = esbuild.buildSync({
  stdin: {
    contents: 'export * from "./src/linkParser"; export * from "./src/searchQuery"; export * from "./src/types";',
    resolveDir: path.resolve(__dirname, ".."),
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", target: "es2020",
  external: ["obsidian"], write: false, logLevel: "silent",
});
const compiled = new Module(path.join(__dirname, "query.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(result.outputFiles[0].text, compiled.filename);
const { matchesQuery, compileSearchQuery, applyNodeGroups, filterGraphData, DEFAULT_SETTINGS } = compiled.exports;

function node(id, tags = [], properties = {}, name = path.posix.basename(id, ".md")) {
  return { id, name, tags, properties, isAttachment: false, exists: true };
}
const vampire = node("Vampire/People/Autumn People.md", ["game/vampire", "kind/leader"], { status: ["active"] });
const vampireNpc = node("Vampire/Elsewhere/Ash.md", ["game/vampire", "kind/npc"]);
const demon = node("Demon/Ash.md", ["game/demon", "kind/npc"], { status: ["active"] });
const demonLeader = node("Demon/Leaders/Ember.md", ["game/demon", "kind/leader"], { status: ["inactive"] });
const other = node("Mage/Autumn People.md", ["kind/leader"]);
const nodes = [vampire, vampireNpc, demon, demonLeader, other];
const matching = (query) => nodes.filter((entry) => matchesQuery(entry, query)).map((entry) => entry.id);

test("path and tag OR include either family without requiring both", () => {
  assert.deepEqual(matching("path:Vampire/ OR path:Demon/"), [vampire.id, vampireNpc.id, demon.id, demonLeader.id]);
  assert.deepEqual(matching("tag:#game/vampire OR tag:game/demon"), [vampire.id, vampireNpc.id, demon.id, demonLeader.id]);
  assert.equal(matchesQuery(vampire, "tag:game"), true);
  assert.equal(matchesQuery(vampire, "tag:gam"), false);
});

test("implicit AND binds more tightly than OR, and parentheses change the grouping", () => {
  assert.deepEqual(matching("path:Vampire/ OR path:Demon/ tag:kind/leader"), [vampire.id, vampireNpc.id, demonLeader.id]);
  assert.deepEqual(matching("(path:Vampire/ OR path:Demon/) tag:kind/leader"), [vampire.id, demonLeader.id]);
  assert.deepEqual(matching("path:Vampire/ path:Vampire/People/"), [vampire.id]);
  assert.deepEqual(matching("tag:game/vampire tag:#kind/leader"), [vampire.id]);
  assert.deepEqual(matching("path:Vampire/ file:Autumn"), [vampire.id]);
  assert.deepEqual(matching("Autumn tag:game/vampire"), [vampire.id]);
});

test("quoted values retain spaces, reserved words, parentheses, and leading hyphens", () => {
  const literal = node("Vampire OR Demon/-Archive/Record.md", ["-hidden"],
    { role: ["spirit OR-world".toLowerCase()] }, "OR -Shadow (Old)");
  assert.equal(matchesQuery(literal, 'path:"Vampire OR Demon/-Archive/" file:"OR -Shadow (Old)"'), true);
  assert.equal(matchesQuery(literal, '[role:"spirit OR-world"] tag:"-hidden"'), true);
  assert.equal(matchesQuery(literal, '"OR"'), true);
  assert.equal(matchesQuery(literal, '"-Shadow (Old)"'), true);
  assert.equal(matchesQuery(node("AND NOT.md"), '"AND" "NOT"'), true);
  assert.equal(matchesQuery(literal, 'path: "Vampire OR Demon/-Archive/"'), true);
  assert.equal(matchesQuery(node("AND/OR.md"), "path:AND/"), true);
});

test("single and double quotes support literal quote and backslash escaping", () => {
  assert.equal(matchesQuery(node("O'Brien.md"), "file:'O\\'Brien'"), true);
  assert.equal(matchesQuery(node('A "quoted" title.md'), 'file:"A \\"quoted\\" title"'), true);
  assert.equal(matchesQuery(node("A\\B.md"), 'file:"A\\\\B"'), true);
  assert.equal(matchesQuery(node("Record.md", [], { title: ["a] b"] }), '[title:"a] b"]'), true);
});

test("unary minus negates atoms and grouped compounds without changing property matching", () => {
  assert.deepEqual(matching("path:Vampire/ -tag:kind/npc"), [vampire.id]);
  assert.deepEqual(matching("-(path:Vampire/ OR path:Demon/)"), [other.id]);
  assert.deepEqual(matching("(path:Vampire/ OR path:Demon/) -[status:active]"), [vampireNpc.id]);
  assert.equal(matchesQuery(vampire, "--tag:game/vampire"), true);
  assert.equal(matchesQuery(vampire, "[STATUS:'ACT']"), true);
  assert.equal(matchesQuery(vampire, "-[missing:active]"), true);
});

test("legacy unquoted phrases keep one-expression behavior when no compound syntax appears", () => {
  for (const query of ["Autumn People", "file:Autumn People", "file: Autumn People"]) {
    assert.equal(matchesQuery(vampire, query), true, query);
    assert.equal(matchesQuery(node("Autumn and People.md"), query), false, query);
  }
  assert.equal(matchesQuery(node("Folder With Spaces/Note.md"), "path:Folder With Spaces/"), true);
  assert.equal(matchesQuery(vampire, "-file:Autumn People"), false);
  assert.equal(matchesQuery(node("Autumn or Winter.md"), "Autumn or Winter"), true);
  assert.equal(matchesQuery(node("People's.md"), "People's"), true);
  assert.equal(matchesQuery(node("-Archive.md"), "file: -Archive"), true);
  assert.equal(matchesQuery(node("status:active.md"), "status:active"), true);
  assert.equal(matchesQuery(node("Record.md", [], { role: ["spirit or-world"] }), "[role:spirit OR-world]"), true);
});

test("invalid syntax always matches no nodes, including incomplete negated queries", () => {
  const invalid = [
    "", " ", "-", "path:", "file:", "tag:", "tag:#", '[role:""]', "[role:]", "-path:", "-[role:]",
    "path:Vampire/ OR", "OR path:Vampire/", "path:Vampire/ OR OR path:Demon/", "()", "(path:Vampire/", "path:Vampire/)",
    "path:Vampire/ AND path:Demon/", "NOT path:Vampire/", "path:Vampire/ || path:Demon/", "path:Vampire/ && path:Demon/",
    '"Autumn', 'path:"Vampire/', '[role:"spirit]', "[role:active", "[role:active]]", 'file:"Autumn"People',
    "[role:active]junk", "[bad key:value]", "-()", "-(path:Vampire/ OR)",
    "path: OR path:Demon/", "-path: OR path:Demon/", "-path: path:Demon/", "-path: tag:kind/leader", "file: AND", "-path: -",
    "x".repeat(4097), Array(257).fill('"x"').join(" "), "(".repeat(33) + "path:Vampire/" + ")".repeat(33),
  ];
  for (const query of invalid) {
    for (const entry of nodes) assert.equal(matchesQuery(entry, query), false, JSON.stringify(query));
  }
});

test("filtering and first-match node groups share source-path matching for relationship junctions", () => {
  const junction = node("@relation:meeting", ["kind/leader"], {}, "Meeting");
  junction.relation = { id: "meeting", type: "meeting", ordered: false, members: [vampire.id, demon.id],
    sourcePath: "Demon/Relations/Meeting.md", sourceName: "Meeting" };
  const query = "path:Vampire/ OR path:Demon/";
  assert.equal(matchesQuery(junction, query), true);
  assert.equal(matchesQuery(junction, "path:@relation:"), false);
  assert.equal(matchesQuery(junction, "Demon/Relations"), true);
  applyNodeGroups([junction], [{ query, color: "#123456" }, { query: "Meeting", color: "#654321" }]);
  assert.equal(junction.groupColor, "#123456");
  const data = { nodes: [vampire, junction, other], links: [] };
  const filtered = filterGraphData(data, { ...DEFAULT_SETTINGS, showOrphans: true }, query);
  assert.deepEqual(filtered.nodes.map((entry) => entry.id), [vampire.id, junction.id]);
});

test("compiled queries are reused across nodes and the cache has a bounded entry count", () => {
  const original = compileSearchQuery('file:"Cache target"');
  assert.equal(compileSearchQuery('  file:"Cache target"  '), original);
  for (let i = 0; i < 128; i++) compileSearchQuery(`path:Cache-${i}/`);
  assert.notEqual(compileSearchQuery('file:"Cache target"'), original);
  const invalid = compileSearchQuery("-(path:)");
  assert.equal(invalid(vampire), false);
  assert.equal(compileSearchQuery("-(path:)"), invalid);
});
