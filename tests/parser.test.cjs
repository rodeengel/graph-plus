const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

// Bundle the real parser and configuration code with the installed build tool.
// Fixtures supply only the Obsidian vault/metadata interfaces used by the parser.
const projectRoot = path.resolve(__dirname, "..");
const result = esbuild.buildSync({
  stdin: {
    contents: [
      'export * from "./src/linkParser";',
      'export * from "./src/types";',
    ].join("\n"),
    resolveDir: projectRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2020",
  external: ["obsidian"],
  write: false,
  logLevel: "silent",
});
const compiled = new Module(path.join(__dirname, "parser.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(result.outputFiles[0].text, compiled.filename);
const {
  buildGraphData, filterGraphData, ensureLinkType,
  DEFAULT_SETTINGS, DEFAULT_LINK_TYPE_STYLE, COLOR_PALETTE, UNTYPED_LINK_KEY,
  createLinkTypeConfig, normalizeLinkTypeConfig,
} = compiled.exports;

function settings(linkTypes = {}, overrides = {}) {
  return structuredClone({ ...DEFAULT_SETTINGS, linkTypes, ...overrides });
}

function vaultFixture(notes, attachments = []) {
  const files = notes.map((note) => ({
    path: note.path,
    basename: path.posix.basename(note.path, ".md"),
  }));
  const targets = [...files, ...attachments];
  const resolutions = [];
  return {
    resolutions,
    vault: {
      getMarkdownFiles() { return files; },
      async cachedRead(file) {
        const note = notes.find((entry) => entry.path === file.path);
        if (note.unreadable) throw new Error("Fixture read failure");
        return note.content ?? "";
      },
    },
    metadataCache: {
      getFileCache(file) {
        return notes.find((entry) => entry.path === file.path).cache ?? {};
      },
      getFirstLinkpathDest(linkpath, sourcePath) {
        resolutions.push({ linkpath, sourcePath });
        return targets.find((file) =>
          file.path === linkpath || file.path === `${linkpath}.md` || file.basename === linkpath
        ) ?? null;
      },
    },
  };
}

function edges(data) {
  return data.links.map(({ source, target, type }) => [source, target, type])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

test("frontmatter parses explicit wikilinks and aliases without treating plain values or reserved fields as links", async () => {
  const app = vaultFixture([
    {
      path: "Source.md",
      content: "---\nmentor: '[[Alpha|Display name]]'\naliases: '[[Ignored]]'\n---\n",
      cache: {
        frontmatter: {
          mentor: "[[Alpha|Display name]]",
          allies: ["[[Alpha]]", "[[Beta]]", "Beta", "[[Beta|B]]"],
          occupation: "Alpha",
          tags: ["character", "#person"],
          aliases: ["[[Ignored]]"],
          cssclasses: "[[Ignored]]",
          position: { start: 0 },
        },
      },
    },
    { path: "Alpha.md" },
    { path: "Beta.md" },
  ]);
  const config = settings();
  const data = await buildGraphData(app, config);
  assert.deepEqual(edges(data), [
    ["Source.md", "Alpha.md", "allies"],
    ["Source.md", "Alpha.md", "mentor"],
    ["Source.md", "Beta.md", "allies"],
  ]);
  assert.deepEqual(Object.keys(config.linkTypes).sort(), ["allies", "mentor"]);
  assert.ok(app.resolutions.every(({ linkpath }) => !linkpath.includes("|") && linkpath !== "Ignored"));
  const source = data.nodes.find((node) => node.id === "Source.md");
  assert.deepEqual(source.tags, ["character", "person"]);
  assert.deepEqual(source.properties.occupation, ["alpha"]);
  assert.equal(source.properties.position, undefined);
});

test("bare, bracketed, and parenthesized inline fields retain typed links and body links stay untyped", async () => {
  const app = vaultFixture([
    {
      path: "Source.md",
      content: [
        "mentor:: [[Alpha|A]] [[Alpha]]",
        "[ally:: [[Beta|B]]]",
        "(enemy:: [[Gamma]])",
        "Ordinary body link [[BodyOnly|Display]].",
        "Repeated typed target [[Alpha]] should not create another untyped edge.",
        "#character/body",
      ].join("\n"),
    },
    ...["Alpha", "Beta", "Gamma", "BodyOnly"].map((name) => ({ path: `${name}.md` })),
  ]);
  const data = await buildGraphData(app, settings());
  assert.deepEqual(edges(data), [
    ["Source.md", "Alpha.md", "mentor"],
    ["Source.md", "Beta.md", "ally"],
    ["Source.md", "BodyOnly.md", UNTYPED_LINK_KEY],
    ["Source.md", "Gamma.md", "enemy"],
  ]);
  assert.deepEqual(data.nodes.find((node) => node.id === "Source.md").tags, ["character/body"]);
});

test("plain frontmatter and inline text never create semantic or unresolved links", async () => {
  const app = vaultFixture([
    {
      path: "Source.md",
      content: "mentor:: Alpha\n[ally:: Beta]\n(enemy:: Missing)\nPlain Alpha text.",
      cache: { frontmatter: { mentor: "Alpha", allies: ["Beta", "Missing"] } },
    },
    { path: "Alpha.md" },
    { path: "Beta.md" },
  ]);
  const config = settings();
  const data = await buildGraphData(app, config);
  assert.deepEqual(data.links, []);
  assert.deepEqual(config.linkTypes, {});
  assert.deepEqual(app.resolutions, []);
  assert.equal(data.nodes.some((node) => !node.exists), false);
});

test("unresolved targets retain their paths, receive defaults, and respect the existing-only filter", async () => {
  const app = vaultFixture([
    {
      path: "Source.md",
      content: "missing:: [[Folder/Ghost|Display]] [[Missing.md]]\n[[Resolved]]",
    },
    { path: "Resolved.md" },
  ]);
  const config = settings();
  const data = await buildGraphData(app, config);
  const unresolved = data.nodes.filter((node) => !node.exists)
    .map(({ id, name }) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(unresolved, [
    { id: "Folder/Ghost.md", name: "Ghost" },
    { id: "Missing.md", name: "Missing" },
  ]);
  assert.deepEqual(edges(data), [
    ["Source.md", "Folder/Ghost.md", "missing"],
    ["Source.md", "Missing.md", "missing"],
    ["Source.md", "Resolved.md", UNTYPED_LINK_KEY],
  ]);
  for (const type of ["missing", UNTYPED_LINK_KEY]) {
    const { color, visible, ...semantic } = config.linkTypes[type];
    assert.ok(COLOR_PALETTE.includes(color));
    assert.equal(visible, true);
    assert.deepEqual(semantic, DEFAULT_LINK_TYPE_STYLE);
  }
  const filtered = filterGraphData(data, { ...config, existingOnly: true });
  assert.equal(filtered.nodes.every((node) => node.exists), true);
  assert.deepEqual(edges(filtered), [["Source.md", "Resolved.md", UNTYPED_LINK_KEY]]);
});

test("read failures use cached body links while preserving frontmatter typing and deduplication", async () => {
  const app = vaultFixture([
    {
      path: "Source.md",
      unreadable: true,
      cache: {
        frontmatter: { mentor: "[[Alpha]]" },
        links: [{ link: "Alpha" }, { link: "Beta" }, { link: "Beta" }],
      },
    },
    { path: "Alpha.md" },
    { path: "Beta.md" },
  ]);
  const data = await buildGraphData(app, settings());
  assert.deepEqual(edges(data), [
    ["Source.md", "Alpha.md", "mentor"],
    ["Source.md", "Beta.md", UNTYPED_LINK_KEY],
  ]);
});

test("legacy relationship configuration migrates in place without changing color, visibility, or force rules", () => {
  const legacy = { color: "#123456", visible: false, forceRule: "up:25 distance:2x" };
  const normalized = normalizeLinkTypeConfig(legacy);
  assert.equal(normalized, legacy);
  assert.deepEqual(normalized, {
    color: "#123456", visible: false, forceRule: "up:25 distance:2x",
    ...DEFAULT_LINK_TYPE_STYLE,
  });
  const config = settings({ mentor: { color: "#654321", visible: false, forceRule: "left:10" } });
  const prior = config.linkTypes.mentor;
  ensureLinkType(config, "mentor");
  assert.equal(config.linkTypes.mentor, prior);
  assert.deepEqual(config.linkTypes.mentor, {
    color: "#654321", visible: false, forceRule: "left:10",
    ...DEFAULT_LINK_TYPE_STYLE,
  });
});

test("semantic overrides including zero values survive repeated normalization", () => {
  const custom = createLinkTypeConfig("#abcdef", {
    visible: false, forceRule: "right:30", lineStyle: "dotted",
    widthMultiplier: 3, opacity: 0, arrowMode: "off", distanceMultiplier: 2.5, attraction: 0,
  });
  const before = structuredClone(custom);
  assert.equal(normalizeLinkTypeConfig(custom), custom);
  normalizeLinkTypeConfig(custom);
  assert.deepEqual(custom, before);
  const defaultConfig = createLinkTypeConfig("#fedcba");
  defaultConfig.opacity = 0.25;
  assert.equal(createLinkTypeConfig("#fedcba").opacity, 1);
  assert.equal(DEFAULT_LINK_TYPE_STYLE.opacity, 1);
});

test("new link types avoid previously allocated colors and initialize every semantic setting", () => {
  const config = settings({ mentor: { color: COLOR_PALETTE[0], visible: true } });
  ensureLinkType(config, "ally");
  assert.deepEqual(config.linkTypes.ally, {
    color: COLOR_PALETTE[1], visible: true, ...DEFAULT_LINK_TYPE_STYLE,
  });
});
