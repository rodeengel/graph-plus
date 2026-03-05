import { ItemView, WorkspaceLeaf } from "obsidian";
import type { GraphLinkTypesSettings, GraphData, NodeGroup, SettingDef } from "./types";
import { UNTYPED_LINK_KEY, SETTING_DEFS } from "./types";
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
  private sidebarVisible: boolean = true;
  private modeBtnEl: HTMLElement | null = null;
  private toggleBtnEl: HTMLElement | null = null;

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

    // Body (no toolbar — buttons are in sidebar)
    const body = container.createDiv({ cls: "glt-body" });
    this.filterPanelEl = body.createDiv({ cls: "glt-filter-panel" });
    this.canvasContainerEl = body.createDiv({ cls: "glt-canvas-container" });

    // Floating sidebar toggle button
    this.toggleBtnEl = this.canvasContainerEl.createEl("button", {
      text: "\u2261",
      cls: "glt-sidebar-toggle",
      attr: { "aria-label": "Toggle sidebar" },
    });
    this.toggleBtnEl.addEventListener("click", () => {
      this.sidebarVisible = !this.sidebarVisible;
      if (this.filterPanelEl) {
        this.filterPanelEl.style.display = this.sidebarVisible ? "" : "none";
      }
    });

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

    // --- Sidebar buttons row ---
    const btnRow = panel.createDiv({ cls: "glt-sidebar-buttons" });

    const refreshBtn = btnRow.createEl("button", { text: "Refresh", cls: "glt-sidebar-btn" });
    refreshBtn.addEventListener("click", () => this.rebuildGraph());

    const modeBtn = btnRow.createEl("button", {
      text: this.currentMode === "2d" ? "3D" : "2D",
      cls: "glt-sidebar-btn",
    });
    this.modeBtnEl = modeBtn;
    modeBtn.addEventListener("click", () => {
      this.currentMode = this.currentMode === "2d" ? "3d" : "2d";
      modeBtn.textContent = this.currentMode === "2d" ? "3D" : "2D";
      this.destroyRenderer();
      this.initRenderer();
      this.pushDataToRenderer();
    });

    const homeBtn = btnRow.createEl("button", { text: "Home", cls: "glt-sidebar-btn" });
    homeBtn.addEventListener("click", () => {
      if (this.renderer2D) this.renderer2D.resetView();
      if (this.renderer3D) this.renderer3D.resetCamera();
    });

    // --- Search box ---
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

    // --- Schema-driven sections ---
    const filtersContent = this.createCollapsibleSection(panel, "Filters", true);
    this.renderSettingsSection(filtersContent, "filters");

    // --- Link Types (manual — dynamic from data) ---
    this.buildLinkTypesSection(panel);

    const displayContent = this.createCollapsibleSection(panel, "Display", false);
    this.renderSettingsSection(displayContent, "display");

    const display2DContent = this.createCollapsibleSection(panel, "2D Display", false);
    this.renderSettingsSection(display2DContent, "display2d");

    const display3DContent = this.createCollapsibleSection(panel, "3D Display", false);
    this.renderSettingsSection(display3DContent, "display3d");

    const forcesContent = this.createCollapsibleSection(panel, "Forces", false);
    this.renderSettingsSection(forcesContent, "forces");

    // --- Groups (manual — complex editor) ---
    const groupsContent = this.createCollapsibleSection(panel, "Groups", false);
    this.buildGroupEditor(groupsContent);
  }

  /** Render all settings for a section from the declarative schema */
  private renderSettingsSection(parent: HTMLElement, section: string): void {
    const defs = SETTING_DEFS.filter((d) => d.section === section);
    for (const def of defs) {
      if (def.type === "toggle") {
        const raw = this.settings[def.key] as boolean;
        this.buildToggle(parent, def.label, def.invert ? !raw : raw, async (val) => {
          (this.settings as any)[def.key] = def.invert ? !val : val;
          await this.saveSettings();
          this.applySettingEffect(def);
        });
      } else if (def.type === "slider") {
        const raw = this.settings[def.key] as number;
        this.buildSlider(parent, def.label, def.invert ? Math.abs(raw) : raw, def.min!, def.max!, def.step!, async (val) => {
          (this.settings as any)[def.key] = def.invert ? -val : val;
          await this.saveSettings();
          this.applySettingEffect(def);
        });
      }
    }
  }

  /** Apply the appropriate renderer update for a setting change */
  private applySettingEffect(def: SettingDef): void {
    const r = def.renderers ?? "both";
    switch (def.effect) {
      case "rebuild":
        this.pushDataToRenderer();
        break;
      case "visual":
        if ((r === "both" || r === "2d") && this.renderer2D) this.renderer2D.updateSettings();
        if ((r === "both" || r === "3d") && this.renderer3D) this.renderer3D.updateSettings();
        break;
      case "force":
        if (this.renderer2D) this.renderer2D.updateSettings();
        if (this.renderer3D) this.renderer3D.updateForces();
        break;
      case "animate":
        if (this.renderer2D) this.renderer2D.setAnimate(this.settings.animate);
        break;
    }
  }

  /** Build the Link Types collapsible section (dynamic, not schema-driven) */
  private buildLinkTypesSection(panel: HTMLElement): void {
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
    // Detach toggle button before emptying so it's not destroyed
    const toggleBtn = this.toggleBtnEl;
    if (toggleBtn) toggleBtn.remove();
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
    // Re-append toggle button after renderer creates its elements
    if (toggleBtn) this.canvasContainerEl.appendChild(toggleBtn);
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
