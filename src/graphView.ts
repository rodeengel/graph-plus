import { ItemView, WorkspaceLeaf } from "obsidian";
import type { GraphLinkTypesSettings, GraphData, NodeGroup } from "./types";
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
  private searchQuery: string = "";

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

  // --- Collapsible section helper ---
  private createCollapsibleSection(
    parent: HTMLElement,
    title: string,
    defaultOpen: boolean = true
  ): HTMLElement {
    const section = parent.createDiv({ cls: "glt-filter-section" });

    const header = section.createDiv({ cls: "glt-collapsible-header" });
    const chevron = header.createSpan({ cls: "glt-chevron", text: defaultOpen ? "▾" : "▸" });
    header.createSpan({ text: " " + title });

    const content = section.createDiv({ cls: "glt-collapsible-content" });
    if (!defaultOpen) {
      content.style.display = "none";
    }

    header.addEventListener("click", () => {
      const isOpen = content.style.display !== "none";
      content.style.display = isOpen ? "none" : "";
      chevron.textContent = isOpen ? "▸" : "▾";
    });

    return content;
  }

  private buildFilterPanel(): void {
    const panel = this.filterPanelEl;
    if (!panel) return;
    panel.empty();

    // --- Search box (supports Obsidian query syntax) ---
    const searchInput = panel.createEl("input", {
      type: "text",
      placeholder: "Search... (path:, file:, tag:, [prop:val])",
      cls: "glt-search-input",
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.pushDataToRenderer();
    });

    // --- Filters (collapsible) ---
    const filtersContent = this.createCollapsibleSection(panel, "Filters", true);
    this.buildToggle(filtersContent, "Attachments", this.settings.showAttachments, async (val) => {
      this.settings.showAttachments = val;
      await this.saveSettings();
      this.pushDataToRenderer();
    });
    this.buildToggle(filtersContent, "Existing only", this.settings.existingOnly, async (val) => {
      this.settings.existingOnly = val;
      await this.saveSettings();
      this.pushDataToRenderer();
    });
    this.buildToggle(filtersContent, "Orphans", this.settings.showOrphans, async (val) => {
      this.settings.showOrphans = val;
      await this.saveSettings();
      this.pushDataToRenderer();
    });

    // --- Link Types (collapsible) ---
    const linkTypesContent = this.createCollapsibleSection(panel, "Link Types", true);

    const counts = countLinkTypes(this.fullData);

    const types = Object.keys(this.settings.linkTypes).sort((a, b) => {
      if (a === UNTYPED_LINK_KEY) return 1;
      if (b === UNTYPED_LINK_KEY) return -1;
      return a.localeCompare(b);
    });

    for (const type of types) {
      const config = this.settings.linkTypes[type];
      const count = counts.get(type) ?? 0;
      const displayName = type === UNTYPED_LINK_KEY ? "untyped" : type;

      const row = linkTypesContent.createDiv({ cls: "glt-filter-item" });

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

      const swatch = row.createEl("input", { type: "color", cls: "glt-color-swatch" });
      swatch.value = config.color;
      swatch.title = `Change color for "${displayName}"`;
      swatch.addEventListener("input", async () => {
        config.color = swatch.value;
        await this.saveSettings();
        this.pushDataToRenderer();
      });

      const label = row.createEl("label", { text: displayName });
      label.addEventListener("click", () => {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change"));
      });

      row.createEl("span", { text: `(${count})`, cls: "glt-link-count" });
    }

    // --- Display (collapsible) ---
    const displayContent = this.createCollapsibleSection(panel, "Display", false);

    this.buildToggle(displayContent, "Edge labels", this.settings.showLabels, async (val) => {
      this.settings.showLabels = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
      else this.pushDataToRenderer();
    });

    this.buildToggle(displayContent, "Node labels", this.settings.showNodeLabels, async (val) => {
      this.settings.showNodeLabels = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
      else this.pushDataToRenderer();
    });

    this.buildToggle(displayContent, "Arrows", this.settings.showArrows, async (val) => {
      this.settings.showArrows = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
      else this.pushDataToRenderer();
    });

    this.buildToggle(displayContent, "Scale by connections", this.settings.scaleNodeByLinks, async (val) => {
      this.settings.scaleNodeByLinks = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
      else this.pushDataToRenderer();
    });

    this.buildSlider(displayContent, "Node label zoom", this.settings.textFadeThreshold, 0.1, 5, 0.1, async (val) => {
      this.settings.textFadeThreshold = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
    });

    this.buildSlider(displayContent, "Edge label zoom", this.settings.edgeLabelThreshold, 0.1, 5, 0.1, async (val) => {
      this.settings.edgeLabelThreshold = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
    });

    this.buildSlider(displayContent, "Node size", this.settings.nodeSize, 1, 20, 1, async (val) => {
      this.settings.nodeSize = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
      else this.pushDataToRenderer();
    });

    this.buildSlider(displayContent, "Link thickness", this.settings.linkThickness, 0.5, 5, 0.5, async (val) => {
      this.settings.linkThickness = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
      else this.pushDataToRenderer();
    });

    // --- Forces (collapsible) ---
    const forcesContent = this.createCollapsibleSection(panel, "Forces", false);

    this.buildSlider(forcesContent, "Center force", this.settings.centerForce, 0, 2, 0.05, async (val) => {
      this.settings.centerForce = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
    });

    // Repel force: display as positive, store as negative internally
    this.buildSlider(forcesContent, "Repel force", Math.abs(this.settings.chargeStrength), 10, 2000, 10, async (val) => {
      this.settings.chargeStrength = -val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
    });

    this.buildSlider(forcesContent, "Link force", this.settings.linkStrength, 0, 2, 0.05, async (val) => {
      this.settings.linkStrength = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
    });

    this.buildSlider(forcesContent, "Link distance", this.settings.linkDistance, 5, 500, 5, async (val) => {
      this.settings.linkDistance = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
    });

    this.buildSlider(forcesContent, "Collision", this.settings.collisionForce, 0, 1, 0.05, async (val) => {
      this.settings.collisionForce = val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.updateSettings();
    });

    this.buildToggle(forcesContent, "Pause physics", !this.settings.animate, async (val) => {
      this.settings.animate = !val;
      await this.saveSettings();
      if (this.renderer2D) this.renderer2D.setAnimate(!val);
    });

    // --- Groups (collapsible) ---
    const groupsContent = this.createCollapsibleSection(panel, "Groups", false);
    this.buildGroupEditor(groupsContent);
  }

  private buildToggle(
    parent: HTMLElement,
    label: string,
    value: boolean,
    onChange: (val: boolean) => Promise<void>
  ): void {
    const row = parent.createDiv({ cls: "glt-toggle-row" });
    row.createEl("span", { text: label });
    const toggle = row.createEl("input", { type: "checkbox" });
    toggle.checked = value;
    toggle.addEventListener("change", () => onChange(toggle.checked));
  }

  private buildSlider(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (val: number) => Promise<void>
  ): void {
    const row = parent.createDiv({ cls: "glt-slider-row" });
    row.createEl("span", { text: label });

    const controls = row.createDiv({ cls: "glt-slider-controls" });
    const slider = controls.createEl("input", { type: "range" });
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);

    const valueDisplay = controls.createEl("span", {
      text: String(Math.round(value * 100) / 100),
      cls: "glt-slider-value",
    });

    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      valueDisplay.textContent = String(Math.round(v * 100) / 100);
      onChange(v);
    });
  }

  private buildGroupEditor(parent: HTMLElement): void {
    const groups = this.settings.nodeGroups;

    const renderGroups = () => {
      parent.empty();

      // Help text
      parent.createEl("div", {
        text: "Query: path:, file:, tag:#, [prop:val]",
        cls: "glt-group-help",
      });

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const row = parent.createDiv({ cls: "glt-group-row" });

        const queryInput = row.createEl("input", { type: "text", placeholder: "e.g. [type:reference]" });
        queryInput.value = group.query;
        queryInput.className = "glt-group-query-input";
        queryInput.addEventListener("change", async () => {
          group.query = queryInput.value;
          await this.saveSettings();
          await this.rebuildGraph();
        });

        const colorInput = row.createEl("input", { type: "color", cls: "glt-color-swatch" });
        colorInput.value = group.color;
        colorInput.addEventListener("input", async () => {
          group.color = colorInput.value;
          await this.saveSettings();
          await this.rebuildGraph();
        });

        const deleteBtn = row.createEl("button", { text: "×", cls: "glt-group-delete-btn" });
        deleteBtn.addEventListener("click", async () => {
          groups.splice(i, 1);
          await this.saveSettings();
          renderGroups();
          await this.rebuildGraph();
        });
      }

      const addBtn = parent.createEl("button", { text: "+ Add group", cls: "glt-group-add-btn" });
      addBtn.addEventListener("click", async () => {
        groups.push({ query: "", color: "#4363d8" });
        await this.saveSettings();
        renderGroups();
      });
    };

    renderGroups();
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
    const filtered = filterGraphData(this.fullData, this.settings, this.searchQuery);
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
