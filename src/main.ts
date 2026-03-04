import { Plugin, WorkspaceLeaf } from "obsidian";
import type { GraphLinkTypesSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { GraphLinkTypesView, VIEW_TYPE } from "./graphView";
import { GraphLinkTypesSettingTab } from "./settings";

export default class GraphLinkTypesPlugin extends Plugin {
  settings: GraphLinkTypesSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) =>
      new GraphLinkTypesView(leaf, this.settings, () => this.saveSettings())
    );

    // Ribbon icon
    this.addRibbonIcon("git-fork", "Open Graph Link Types", () => {
      this.activateView();
    });

    // Command palette
    this.addCommand({
      id: "open-graph-link-types",
      name: "Open Graph Link Types view",
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
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onunload(): void {
    // Views are automatically cleaned up by Obsidian
  }
}
