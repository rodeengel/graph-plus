const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

// Run actual view, parser and settings code. Only the Obsidian host controls
// and renderer instances are substituted; these checks do not launch Obsidian.
class HostElement {
  constructor(tag = "div", options = {}) {
    Object.assign(this, options);
    this.tag = tag;
    this.children = [];
    this.settings = [];
    this.listeners = {};
    this.style = { display: "" };
    this.value = "";
    this.scrollTop = 0;
  }
  empty() { this.children = []; this.settings = []; }
  createEl(tag, options) {
    const child = new HostElement(tag, options);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  async fire(event) { await this.listeners[event](); }
  setText(value) { this.text = value; }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  matches(selector) { return selector.split(",").some((tag) => tag.trim() === this.tag); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const result = child.find(predicate);
      if (result) return result;
    }
  }
}

class HostControl {
  constructor(kind) { this.kind = kind; }
  addOption() { return this; }
  setValue(value) { this.value = value; return this; }
  setLimits() { return this; }
  setDynamicTooltip() { return this; }
  setTooltip() { return this; }
  setPlaceholder() { return this; }
  setButtonText(value) { this.text = value; return this; }
  setWarning() { return this; }
  onChange(callback) { this.change = callback; return this; }
  onClick(callback) { this.click = callback; return this; }
}

class HostSetting {
  constructor(container) { this.controls = []; container.settings.push(this); }
  setHeading() { return this; }
  setName(value) { this.name = value; return this; }
  setDesc() { return this; }
  add(kind, callback) {
    const control = new HostControl(kind);
    this.controls.push(control);
    callback(control);
    return this;
  }
  addDropdown(callback) { return this.add("dropdown", callback); }
  addToggle(callback) { return this.add("toggle", callback); }
  addSlider(callback) { return this.add("slider", callback); }
  addColorPicker(callback) { return this.add("color", callback); }
  addText(callback) { return this.add("text", callback); }
  addButton(callback) { return this.add("button", callback); }
}

const obsidianHost = {
  ItemView: class { constructor(leaf) { this.app = leaf.app; this.contentEl = new HostElement(); } },
  PluginSettingTab: class { constructor(app) { this.app = app; this.containerEl = new HostElement(); } },
  Setting: HostSetting,
};
const projectRoot = path.resolve(__dirname, "..");
const result = esbuild.buildSync({
  stdin: {
    contents: [
      'export { GraphLinkTypesView, VIEW_TYPE } from "./src/graphView";',
      'export { GraphLinkTypesSettingTab } from "./src/settings";',
      'export { DEFAULT_SETTINGS, createLinkTypeConfig } from "./src/types";',
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
const compiled = new Module(path.join(__dirname, "settings.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
const nativeRequire = compiled.require.bind(compiled);
compiled.require = (id) => id === "obsidian" ? obsidianHost : nativeRequire(id);
compiled._compile(result.outputFiles[0].text, compiled.filename);
const { GraphLinkTypesView, GraphLinkTypesSettingTab, VIEW_TYPE, DEFAULT_SETTINGS, createLinkTypeConfig } = compiled.exports;

const copy = (value) => JSON.parse(JSON.stringify(value));
global.document = { activeElement: null };
function fixture(overrides = {}) {
  const settings = { ...copy(DEFAULT_SETTINGS), linkTypes: { rel: createLinkTypeConfig("#e6194b") }, ...overrides };
  const files = [{ path: "A.md", basename: "A" }, { path: "B.md", basename: "B" }];
  const notes = { "A.md": "rel:: [[B]]", "B.md": "" };
  const leaves = [];
  let reads = 0;
  const app = {
    workspace: { getLeavesOfType(type) { assert.equal(type, VIEW_TYPE); return leaves; } },
    vault: { getMarkdownFiles: () => files, async cachedRead(file) { reads++; return notes[file.path]; } },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: (link) => files.find((file) => file.basename === link),
    },
  };
  const saved = [];
  const plugin = { settings, async saveSettings() { saved.push(copy(settings)); } };
  const view = new GraphLinkTypesView({ app }, settings, () => plugin.saveSettings());
  const calls = [];
  const renderer = (mode) => ({
    updateData(data) { calls.push({ mode, effect: "data", data }); },
    updateForces() { calls.push({ mode, effect: "force", charge: settings.chargeStrength, center: settings.centerForce }); },
    updateSettings() { calls.push({ mode, effect: "visual" }); },
    updateNodeGroups() { calls.push({ mode, effect: "groups" }); },
    setAnimate(running) { calls.push({ mode, effect: "animate", running }); },
  });
  view.renderer2D = renderer("2d");
  view.renderer3D = renderer("3d");
  let sidebarRefreshes = 0;
  view.buildFilterPanel = () => { sidebarRefreshes++; };
  leaves.push({ view });
  const tab = new GraphLinkTypesSettingTab(app, plugin);
  tab.display();
  function control(name, kind = "slider") {
    const setting = tab.containerEl.settings.find((setting) => setting.name === name);
    assert.ok(setting, `Missing setting ${name}`);
    const result = setting.controls.find((control) => control.kind === kind);
    assert.ok(result, `Missing ${kind} control for ${name}`);
    return result;
  }
  return { settings, view, tab, calls, control, saved, notes, reads: () => reads, sidebarRefreshes: () => sidebarRefreshes };
}

function realSidebar(f) {
  f.view.filterPanelEl = new HostElement();
  f.view.buildFilterPanel = GraphLinkTypesView.prototype.buildFilterPanel.bind(f.view);
  f.view.buildFilterPanel();
  return f.view.filterPanelEl;
}

function section(panel, title) {
  const header = panel.find((element) => element.cls === "gps-collapsible-header"
    && element.children.some((child) => child.text === " " + title));
  assert.ok(header, `Missing section ${title}`);
  const content = header.parentElement.children.find((child) => child.cls === "gps-collapsible-content");
  return { header, content };
}

test("profile JSON roundtrip restores semantic fields and clears an advanced rule added later", async () => {
  const f = fixture({ animate: false, chargeStrength: -640, centerForce: 0.4 });
  Object.assign(f.settings.linkTypes.rel, {
    color: "#4363d8", lineStyle: "dotted", widthMultiplier: 2.2,
    opacity: 0.35, arrowMode: "on", distanceMultiplier: 1.8, attraction: 0,
  });
  const expected = copy(f.settings.linkTypes.rel);
  const parent = new HostElement();
  f.view.buildProfileEditor(parent);
  parent.find((element) => element.placeholder === "Profile name").value = "semantic";
  await parent.find((element) => element.tag === "button" && element.text === "Save").fire("click");
  const stored = copy(f.settings.profiles[0]);
  assert.equal(Object.hasOwn(stored.snapshot.linkTypeConfig.rel, "forceRule"), false);
  Object.assign(f.settings.linkTypes.rel, {
    color: "#ffffff", lineStyle: "solid", widthMultiplier: 1,
    opacity: 1, arrowMode: "off", distanceMultiplier: 1, attraction: 2,
    forceRule: "down:1 distance:2x",
  });
  f.settings.chargeStrength = -120;
  f.settings.centerForce = 1;
  await f.view.loadProfile(stored);
  assert.deepEqual(copy(f.settings.linkTypes.rel), expected);
  assert.equal(f.settings.linkTypes.rel.forceRule, undefined);
  assert.equal(f.settings.chargeStrength, -640);
  assert.equal(f.settings.centerForce, 0.4);
  assert.deepEqual(stored.snapshot.linkTypeConfig.rel, expected, "Restoring must not mutate the snapshot");
  assert.equal(f.reads(), 2, "Rebuild uses the real parser and read-only vault API");
  const order = f.calls.filter((call) => call.mode === "2d").map((call) => call.effect);
  assert.deepEqual(order, ["force", "data", "visual"], "Paused layout needs restored forces before data settles");
});

test("legacy profile visibility and force rules preserve newer semantic settings", async () => {
  const f = fixture();
  Object.assign(f.settings.linkTypes.rel, { lineStyle: "dashed", attraction: 0.3, forceRule: "down:1" });
  await f.view.loadProfile({ name: "legacy", snapshot: { linkTypeConfig: { rel: { visible: false } } } });
  assert.equal(f.settings.linkTypes.rel.visible, false);
  assert.equal(f.settings.linkTypes.rel.lineStyle, "dashed");
  assert.equal(f.settings.linkTypes.rel.attraction, 0.3);
  assert.equal(f.settings.linkTypes.rel.forceRule, undefined);
});

test("settings-tab relationship controls update open renderers without rereading or resetting graph data", async () => {
  const f = fixture();
  await f.control("rel: distance").change(2.5);
  await f.control("rel: attraction").change(0);
  assert.equal(f.settings.linkTypes.rel.distanceMultiplier, 2.5);
  assert.equal(f.settings.linkTypes.rel.attraction, 0);
  assert.deepEqual(f.calls.map((call) => [call.mode, call.effect]), [
    ["2d", "force"], ["3d", "force"], ["2d", "force"], ["3d", "force"],
  ]);
  f.calls.length = 0;
  await f.control("rel: appearance", "dropdown").change("dotted");
  await f.control("rel: opacity").change(0.25);
  assert.deepEqual(f.calls.map((call) => [call.mode, call.effect]), [["2d", "visual"], ["2d", "visual"]]);
  assert.equal(f.reads(), 0);
  assert.equal(f.saved.length, 4);
  assert.equal(f.sidebarRefreshes(), 4);
});

test("settings-tab filtering and schema effects refresh an already-open graph", async () => {
  const f = fixture();
  await f.view.rebuildGraph();
  f.calls.length = 0;
  await f.control("rel", "toggle").change(false);
  assert.ok(f.calls.every((call) => call.effect === "data" && call.data.links.length === 0));
  f.calls.length = 0;
  await f.control("Pause physics", "toggle").change(true);
  assert.deepEqual(f.calls, [{ mode: "2d", effect: "animate", running: false }]);
  assert.equal(f.reads(), 2, "Settings changes reuse existing parsed graph data");
});

test("section expansion and scroll survive settings-tab and structural sidebar refreshes", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  await section(panel, "Groups").header.fire("click");
  panel.scrollTop = 280;
  await f.control("rel: opacity").change(0.4);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  assert.equal(panel.scrollTop, 280);
  f.settings.linkTypes.other = createLinkTypeConfig("#abcdef");
  f.view.refreshFilterPanel();
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  assert.equal(panel.scrollTop, 280);
});

test("sidebar group query and color edits keep their inputs and recolor without vault reads or layout updates", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  await section(panel, "Groups").header.fire("click");
  panel.scrollTop = 250;
  const groupContent = section(panel, "Groups").content;
  const query = groupContent.find((element) => element.className === "gps-group-query-input");
  const color = groupContent.find((element) => element.type === "color");
  query.value = "file:B";
  await query.fire("change");
  color.value = "#abcdef";
  await color.fire("input");
  assert.equal(section(panel, "Groups").content, groupContent);
  assert.equal(groupContent.find((element) => element.type === "color"), color);
  assert.equal(groupContent.find((element) => element.className === "gps-group-query-input"), query);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(panel.scrollTop, 250);
  assert.deepEqual(f.settings.nodeGroups, [{ query: "file:B", color: "#abcdef" }]);
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.calls.map((call) => call.effect), ["groups", "groups", "groups", "groups"]);
  await groupContent.find((element) => element.text === "+ Add group").fire("click");
  assert.equal(f.settings.nodeGroups.length, 2);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  assert.equal(panel.scrollTop, 250);
});

test("vault rebuilds update relationship counts without replacing an active group editor", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  await f.view.rebuildGraph();
  const query = section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input");
  document.activeElement = query;
  f.notes["B.md"] = "rel:: [[A]]";
  await f.view.rebuildGraph();
  assert.equal(section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input"), query);
  assert.equal(f.view.linkCountEls.get("rel").textContent, "(2)");
  document.activeElement = null;
});

test("new relationship controls wait until relationship editing ends and retain navigation", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  await section(panel, "Groups").header.fire("click");
  panel.scrollTop = 250;
  const query = section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input");
  document.activeElement = section(panel, "Relationship Types").content.find((element) => element.type === "number");
  f.notes["A.md"] += "\nother:: [[B]]";
  await f.view.rebuildGraph();
  assert.equal(f.view.sidebarRebuildPending, true);
  assert.equal(section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input"), query);
  document.activeElement = null;
  f.view.refreshFilterPanel();
  assert.equal(f.view.sidebarRebuildPending, false);
  assert.ok(panel.find((element) => element.text === "other"));
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  assert.equal(panel.scrollTop, 250);
  assert.equal(section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input"), query);
});

test("new relationship types preserve a focused group editor and its next add action", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  const groups = section(panel, "Groups");
  const query = groups.content.find((element) => element.className === "gps-group-query-input");
  const add = groups.content.find((element) => element.text === "+ Add group");
  document.activeElement = query;
  f.notes["A.md"] += "\nother:: [[B]]";
  await f.view.rebuildGraph();
  assert.ok(panel.find((element) => element.text === "other"));
  assert.equal(section(panel, "Groups").content, groups.content);
  assert.equal(panel.contains(query), true);
  assert.equal(panel.contains(add), true);
  await add.fire("click");
  assert.equal(f.settings.nodeGroups.length, 2);
  document.activeElement = null;
});

test("settings-tab group changes recolor open renderers without resetting their data", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const groupContainer = f.tab.containerEl.find((element) => element.settings.some((setting) => setting.name === "Group 1"));
  const group = groupContainer.settings.find((setting) => setting.name === "Group 1");
  await group.controls.find((control) => control.kind === "text").change("file:B");
  await group.controls.find((control) => control.kind === "color").change("#abcdef");
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.calls.map((call) => call.effect), ["groups", "groups", "groups", "groups"]);
  assert.deepEqual(f.settings.nodeGroups, [{ query: "file:B", color: "#abcdef" }]);
});
