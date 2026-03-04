import { ItemView, WorkspaceLeaf, Setting } from "obsidian";
import type { GraphLinkTypesSettings, GraphData, LinkTypeConfig } from "./types";
import { UNTYPED_LINK_KEY } from "./types";
import { buildGraphData, filterGraphData, countLinkTypes } from "./linkParser";
import { GraphRenderer2D } from "./graphRenderer2D";
import { GraphRenderer3D } from "./graphRenderer3D";

export const VIEW_TYPE = "graph-link-types-view";

export class GraphLinkTypesView extends ItemView {
  private settings: GraphLinkTypesSettings;
  private saveSettings: () => Promise<void>;
  private fullData: GraphData = { nodes: [], links: [] };
  private renderer2D: GraphRenderer2D | null = null;
  private renderer3D: GraphRenderer3D | null = null;
  private currentMode: "2d" | "3d";
  private filterPanelEl: HTMLElement | null = null;
  private canvasContainerEl: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    settings: GraphLinkTypesSettings,
    saveSettings: () => Promise<void>
  ) {
    super(leaf);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.currentMode = settings.defaultMode;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Graph Link Types";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("glt-container");

    // Toolbar
    const toolbar = container.createDiv({ cls: "glt-toolbar" });

    const refreshBtn = toolbar.createEl("button", { text: "Refresh" });
    refreshBtn.addEventListener("click", () => this.rebuildGraph());

    const modeBtn = toolbar.createEl("button", {
      text: this.currentMode === "2d" ? "Switch to 3D" : "Switch to 2D",
    });
    modeBtn.addEventListener("click", () => {
      this.currentMode = this.currentMode === "2d" ? "3d" : "2d";
      modeBtn.textContent = this.currentMode === "2d" ? "Switch to 3D" : "Switch to 2D";
      this.destroyRenderer();
      this.initRenderer();
      this.pushDataToRenderer();
    });

    // Body
    const body = container.createDiv({ cls: "glt-body" });
    this.filterPanelEl = body.createDiv({ cls: "glt-filter-panel" });
    this.canvasContainerEl = body.createDiv({ cls: "glt-canvas-container" });

    // Build and render
    await this.rebuildGraph();

    // Listen to vault changes
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.debouncedRebuild())
    );
    this.registerEvent(
      this.app.vault.on("create", () => this.debouncedRebuild())
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.debouncedRebuild())
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.debouncedRebuild())
    );
  }

  private debouncedRebuild(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.rebuildGraph(), 500);
  }

  private async rebuildGraph(): Promise<void> {
    this.fullData = await buildGraphData(this.app, this.settings);
    await this.saveSettings();
    this.buildFilterPanel();

    if (!this.renderer2D && !this.renderer3D) {
      this.initRenderer();
    }

    this.pushDataToRenderer();
  }

  private buildFilterPanel(): void {
    const panel = this.filterPanelEl;
    if (!panel) return;
    panel.empty();

    // Link types section
    const section = panel.createDiv({ cls: "glt-filter-section" });
    section.createEl("h4", { text: "Link Types" });

    const counts = countLinkTypes(this.fullData);

    // Sort: untyped last, rest alphabetical
    const types = Object.keys(this.settings.linkTypes).sort((a, b) => {
      if (a === UNTYPED_LINK_KEY) return 1;
      if (b === UNTYPED_LINK_KEY) return -1;
      return a.localeCompare(b);
    });

    for (const type of types) {
      const config = this.settings.linkTypes[type];
      const count = counts.get(type) ?? 0;
      const displayName = type === UNTYPED_LINK_KEY ? "untyped" : type;

      const row = section.createDiv({ cls: "glt-filter-item" });

      // Visibility checkbox
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = type === UNTYPED_LINK_KEY ? this.settings.showUntyped : config.visible;
      checkbox.addEventListener("change", async () => {
        if (type === UNTYPED_LINK_KEY) {
          this.settings.showUntyped = checkbox.checked;
        } else {
          config.visible = checkbox.checked;
        }
        await this.saveSettings();
        this.pushDataToRenderer();
      });

      // Color swatch
      const swatch = row.createEl("input", { type: "color", cls: "glt-color-swatch" });
      swatch.value = config.color;
      swatch.title = `Change color for "${displayName}"`;
      swatch.addEventListener("input", async () => {
        config.color = swatch.value;
        await this.saveSettings();
        this.pushDataToRenderer();
      });

      // Label
      const label = row.createEl("label", { text: displayName });
      label.addEventListener("click", () => {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change"));
      });

      // Count
      row.createEl("span", { text: `(${count})`, cls: "glt-link-count" });
    }

    // Toggles section
    const toggleSection = panel.createDiv({ cls: "glt-filter-section" });
    toggleSection.createEl("h4", { text: "Display" });

    const labelRow = toggleSection.createDiv({ cls: "glt-toggle-row" });
    labelRow.createEl("span", { text: "Show labels" });
    const labelToggle = labelRow.createEl("input", { type: "checkbox" });
    labelToggle.checked = this.settings.showLabels;
    labelToggle.addEventListener("change", async () => {
      this.settings.showLabels = labelToggle.checked;
      await this.saveSettings();
      this.pushDataToRenderer();
    });
  }

  private initRenderer(): void {
    if (!this.canvasContainerEl) return;
    this.canvasContainerEl.empty();

    if (this.currentMode === "2d") {
      this.renderer2D = new GraphRenderer2D(
        this.canvasContainerEl,
        this.app,
        this.settings
      );
    } else {
      this.renderer3D = new GraphRenderer3D(
        this.canvasContainerEl,
        this.app,
        this.settings
      );
    }
  }

  private pushDataToRenderer(): void {
    const filtered = filterGraphData(this.fullData, this.settings);
    if (this.renderer2D) {
      this.renderer2D.updateData(filtered);
    }
    if (this.renderer3D) {
      this.renderer3D.updateData(filtered);
    }
  }

  private destroyRenderer(): void {
    if (this.renderer2D) {
      this.renderer2D.destroy();
      this.renderer2D = null;
    }
    if (this.renderer3D) {
      this.renderer3D.destroy();
      this.renderer3D = null;
    }
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.destroyRenderer();
  }
}
