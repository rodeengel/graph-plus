import { Plugin, WorkspaceLeaf, addIcon } from "obsidian";
import type { GraphLinkTypesSettings } from "./types";
import { DEFAULT_SETTINGS, normalizeLinkTypeConfig } from "./types";
import { GraphLinkTypesView, VIEW_TYPE } from "./graphView";
import { GraphLinkTypesSettingTab } from "./settings";

export default class GraphPlusSemanticPlugin extends Plugin {
  settings: GraphLinkTypesSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) =>
      new GraphLinkTypesView(leaf, this.settings, () => this.saveSettings())
    );

    // Ribbon icon
    addIcon("graph-plus-semantic", `<g transform="translate(2,2) scale(4)"><circle cx="12" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12v3" fill="none" stroke="currentColor" stroke-width="2"/><line x1="17" y1="21" x2="23" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="20" y1="18" x2="20" y2="24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>`);
    this.addRibbonIcon("graph-plus-semantic", "Open Graph Plus Semantic", () => {
      this.activateView();
    });

    // Command palette
    this.addCommand({
      id: "open-graph-plus-semantic",
      name: "Open Graph Plus Semantic view",
      callback: () => this.activateView(),
    });

    // Settings tab
    this.addSettingTab(new GraphLinkTypesSettingTab(this.app, this));
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) ?? {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      linkTypes: { ...(data.linkTypes ?? {}) },
      nodeGroups: data.nodeGroups ?? [],
      profiles: data.profiles ?? [],
    };

    // Migrate settings saved by Graph Plus 0.1.0.
    for (const config of Object.values(this.settings.linkTypes)) {
      normalizeLinkTypeConfig(config);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onunload(): void {
    // Views are automatically cleaned up by Obsidian
  }
}
