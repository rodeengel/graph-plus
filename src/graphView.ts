import { ItemView, WorkspaceLeaf } from "obsidian";
import type {
  GraphLinkTypesSettings,
  GraphData,
  SettingDef,
  SettingsProfile,
  LinkTypeConfig,
  LinkLineStyle,
  LinkArrowMode,
} from "./types";
import { UNTYPED_LINK_KEY, SETTING_DEFS } from "./types";
import { buildGraphData, filterGraphData, countLinkTypes } from "./linkParser";
import { GraphRenderer2D } from "./graphRenderer2D";
import { GraphRenderer3D } from "./graphRenderer3D";

export const VIEW_TYPE = "graph-plus-semantic-view";

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
    return "Graph Plus Semantic";
  }

  getIcon(): string {
    return "graph-plus-semantic";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("gps-container");

    // Body (no toolbar — buttons are in sidebar)
    const body = container.createDiv({ cls: "gps-body" });
    this.filterPanelEl = body.createDiv({ cls: "gps-filter-panel" });
    this.canvasContainerEl = body.createDiv({ cls: "gps-canvas-container" });

    // Floating sidebar toggle button — on body for z-index above overlay sidebar
    this.toggleBtnEl = body.createEl("button", {
      text: "\u2261",
      cls: "gps-sidebar-toggle",
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
    const section = parent.createDiv({ cls: "gps-filter-section" });

    const header = section.createDiv({ cls: "gps-collapsible-header" });
    const chevron = header.createSpan({ cls: "gps-chevron", text: defaultOpen ? "▾" : "▸" });
    header.createSpan({ text: " " + title });

    const content = section.createDiv({ cls: "gps-collapsible-content" });
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
    const btnRow = panel.createDiv({ cls: "gps-sidebar-buttons" });

    const refreshBtn = btnRow.createEl("button", { text: "Refresh", cls: "gps-sidebar-btn" });
    refreshBtn.addEventListener("click", () => this.rebuildGraph());

    const modeBtn = btnRow.createEl("button", {
      text: this.currentMode === "2d" ? "3D" : "2D",
      cls: "gps-sidebar-btn",
    });
    this.modeBtnEl = modeBtn;
    modeBtn.addEventListener("click", () => {
      this.currentMode = this.currentMode === "2d" ? "3d" : "2d";
      modeBtn.textContent = this.currentMode === "2d" ? "3D" : "2D";
      this.destroyRenderer();
      this.initRenderer();
      this.pushDataToRenderer();
    });

    const homeBtn = btnRow.createEl("button", { text: "Home", cls: "gps-sidebar-btn" });
    homeBtn.addEventListener("click", () => {
      if (this.renderer2D) this.renderer2D.resetView();
      if (this.renderer3D) this.renderer3D.resetCamera();
    });

    // --- Search box ---
    const searchInput = panel.createEl("input", {
      type: "text",
      placeholder: "Search... (path:, file:, tag:, [prop:val])",
      cls: "gps-search-input",
    });
    searchInput.value = this.settings.searchQuery;
    searchInput.addEventListener("input", async () => {
      this.settings.searchQuery = searchInput.value;
      await this.saveSettings();
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

    // --- Link Forces ---
    this.buildLinkForcesSection(panel);

    // --- Groups (manual — complex editor) ---
    const groupsContent = this.createCollapsibleSection(panel, "Groups", false);
    this.buildGroupEditor(groupsContent);

    // --- Profiles ---
    const profilesContent = this.createCollapsibleSection(panel, "Profiles", false);
    this.buildProfileEditor(profilesContent);
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
        if (this.renderer2D) this.renderer2D.updateForces();
        if (this.renderer3D) this.renderer3D.updateForces();
        break;
      case "animate":
        if (this.renderer2D) this.renderer2D.setAnimate(this.settings.animate);
        break;
    }
  }

  /** Build the Relationship Types section with visual + physics controls. */
  private buildLinkTypesSection(panel: HTMLElement): void {
    const content = this.createCollapsibleSection(panel, "Relationship Types", true);
    const help = content.createDiv({ cls: "gps-group-help" });
    help.setText("Appearance controls are 2D-first. Width, arrows, distance and attraction also affect 3D.");

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

      const card = content.createDiv({ cls: "gps-link-type-card" });
      const header = card.createDiv({ cls: "gps-link-type-header" });

      const checkbox = header.createEl("input", { type: "checkbox" });
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

      const swatch = header.createEl("input", { type: "color", cls: "gps-color-swatch" });
      swatch.value = config.color;
      swatch.title = `Change color for "${displayName}"`;
      swatch.addEventListener("input", async () => {
        config.color = swatch.value;
        await this.saveSettings();
        this.updateRelationshipVisuals();
      });

      const label = header.createEl("label", { text: displayName, cls: "gps-link-type-name" });
      label.addEventListener("click", () => {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change"));
      });

      header.createEl("span", { text: `(${count})`, cls: "gps-link-count" });

      const grid = card.createDiv({ cls: "gps-link-style-grid" });

      this.buildCompactSelect(
        grid,
        "Style",
        config.lineStyle,
        [
          ["solid", "Solid"],
          ["dashed", "Dashed"],
          ["dotted", "Dotted"],
        ],
        async (value) => {
          config.lineStyle = value as LinkLineStyle;
          await this.saveSettings();
          this.updateRelationshipVisuals();
        }
      );

      this.buildCompactSelect(
        grid,
        "Arrow",
        config.arrowMode,
        [
          ["inherit", "Inherit"],
          ["on", "On"],
          ["off", "Off"],
        ],
        async (value) => {
          config.arrowMode = value as LinkArrowMode;
          await this.saveSettings();
          this.updateRelationshipVisuals();
        }
      );

      this.buildCompactNumber(
        grid,
        "Width ×",
        config.widthMultiplier,
        0.1,
        5,
        0.1,
        async (value) => {
          config.widthMultiplier = value;
          await this.saveSettings();
          this.updateRelationshipVisuals();
        }
      );

      this.buildCompactNumber(
        grid,
        "Opacity",
        config.opacity,
        0,
        1,
        0.05,
        async (value) => {
          config.opacity = value;
          await this.saveSettings();
          this.updateRelationshipVisuals();
        }
      );

      this.buildCompactNumber(
        grid,
        "Distance ×",
        config.distanceMultiplier,
        0.1,
        5,
        0.1,
        async (value) => {
          config.distanceMultiplier = value;
          await this.saveSettings();
          this.updateRelationshipForces();
        }
      );

      this.buildCompactNumber(
        grid,
        "Attraction ×",
        config.attraction,
        0,
        3,
        0.1,
        async (value) => {
          config.attraction = value;
          await this.saveSettings();
          this.updateRelationshipForces();
        }
      );
    }
  }

  private updateRelationshipVisuals(): void {
    if (this.renderer2D) this.renderer2D.updateSettings();
    if (this.renderer3D) this.renderer3D.updateSettings();
  }

  private updateRelationshipForces(): void {
    if (this.renderer2D) this.renderer2D.updateForces();
    if (this.renderer3D) this.renderer3D.updateForces();
  }

  /** Build the Advanced Link Forces collapsible section */
  private buildLinkForcesSection(panel: HTMLElement): void {
    const content = this.createCollapsibleSection(panel, "Advanced Link Forces", false);

    const help = content.createEl("div", { cls: "gps-group-help" });
    help.createEl("div", { text: "Directional rules: up/down:N, left/right:N" });
    help.createEl("div", { text: "3D only: forward/backward:N" });
    help.createEl("div", { text: "Legacy distance:Nx is multiplied with Distance × above" });

    const types = Object.keys(this.settings.linkTypes).sort((a, b) => {
      if (a === UNTYPED_LINK_KEY) return 1;
      if (b === UNTYPED_LINK_KEY) return -1;
      return a.localeCompare(b);
    });

    for (const type of types) {
      const config = this.settings.linkTypes[type];
      const displayName = type === UNTYPED_LINK_KEY ? "untyped" : type;

      const row = content.createDiv({ cls: "gps-force-rule-row" });
      row.createEl("span", { text: displayName, cls: "gps-force-rule-label" });

      const forceInput = row.createEl("input", {
        type: "text",
        placeholder: "e.g. down:1 right:0.5",
        cls: "gps-force-rule-input",
      });
      forceInput.value = config.forceRule || "";
      forceInput.addEventListener("change", async () => {
        config.forceRule = forceInput.value.trim() || undefined;
        await this.saveSettings();
        this.updateRelationshipForces();
      });
    }
  }

  private buildCompactSelect(
    parent: HTMLElement,
    label: string,
    value: string,
    options: Array<[string, string]>,
    onChange: (value: string) => Promise<void>
  ): void {
    const control = parent.createDiv({ cls: "gps-link-style-control" });
    control.createEl("label", { text: label });
    const select = control.createEl("select");
    for (const [optionValue, optionLabel] of options) {
      const option = select.createEl("option", { text: optionLabel });
      option.value = optionValue;
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
  }

  private buildCompactNumber(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => Promise<void>
  ): void {
    const control = parent.createDiv({ cls: "gps-link-style-control" });
    control.createEl("label", { text: label });
    const input = control.createEl("input", { type: "number" });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("change", () => {
      const parsed = parseFloat(input.value);
      const safe = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
      input.value = String(Math.round(safe * 100) / 100);
      onChange(safe);
    });
  }

  private buildToggle(  private buildToggle(
    parent: HTMLElement,
    label: string,
    value: boolean,
    onChange: (val: boolean) => Promise<void>
  ): void {
    const row = parent.createDiv({ cls: "gps-toggle-row" });
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
    const row = parent.createDiv({ cls: "gps-slider-row" });
    row.createEl("span", { text: label });

    const controls = row.createDiv({ cls: "gps-slider-controls" });
    const slider = controls.createEl("input", { type: "range" });
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);

    const valueDisplay = controls.createEl("span", {
      text: String(Math.round(value * 100) / 100),
      cls: "gps-slider-value",
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
        cls: "gps-group-help",
      });

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const row = parent.createDiv({ cls: "gps-group-row" });

        const queryInput = row.createEl("input", { type: "text", placeholder: "e.g. [type:reference]" });
        queryInput.value = group.query;
        queryInput.className = "gps-group-query-input";
        queryInput.addEventListener("change", async () => {
          group.query = queryInput.value;
          await this.saveSettings();
          await this.rebuildGraph();
        });

        const colorInput = row.createEl("input", { type: "color", cls: "gps-color-swatch" });
        colorInput.value = group.color;
        colorInput.addEventListener("input", async () => {
          group.color = colorInput.value;
          await this.saveSettings();
          await this.rebuildGraph();
        });

        const deleteBtn = row.createEl("button", { text: "×", cls: "gps-group-delete-btn" });
        deleteBtn.addEventListener("click", async () => {
          groups.splice(i, 1);
          await this.saveSettings();
          renderGroups();
          await this.rebuildGraph();
        });
      }

      const addBtn = parent.createEl("button", { text: "+ Add group", cls: "gps-group-add-btn" });
      addBtn.addEventListener("click", async () => {
        groups.push({ query: "", color: "#4363d8" });
        await this.saveSettings();
        renderGroups();
      });
    };

    renderGroups();
  }

  private buildProfileEditor(parent: HTMLElement): void {
    const renderProfiles = () => {
      parent.empty();

      // Save current as new profile
      const saveRow = parent.createDiv({ cls: "gps-profile-save-row" });
      const nameInput = saveRow.createEl("input", {
        type: "text",
        placeholder: "Profile name",
        cls: "gps-profile-name-input",
      });
      const saveBtn = saveRow.createEl("button", {
        text: "Save",
        cls: "gps-sidebar-btn",
      });
      saveBtn.addEventListener("click", async () => {
        const name = nameInput.value.trim();
        if (!name) return;

        const snapshot: Record<string, any> = {};
        for (const def of SETTING_DEFS) {
          snapshot[def.key] = this.settings[def.key];
        }
        snapshot.showUntyped = this.settings.showUntyped;
        snapshot.nodeColor = this.settings.nodeColor;
        snapshot.nodeColorHover = this.settings.nodeColorHover;
        snapshot.nodeGroups = JSON.parse(JSON.stringify(this.settings.nodeGroups));

        // Relationship type styling + physics are part of the graph projection.
        const ltv: Record<string, LinkTypeConfig> = {};
        for (const [type, config] of Object.entries(this.settings.linkTypes)) {
          ltv[type] = { ...config };
        }
        snapshot.linkTypeConfig = ltv;
        snapshot.searchQuery = this.settings.searchQuery;

        this.settings.profiles.push({ name, snapshot });
        await this.saveSettings();
        nameInput.value = "";
        renderProfiles();
      });

      // List existing profiles
      for (let i = 0; i < this.settings.profiles.length; i++) {
        const profile = this.settings.profiles[i];
        const row = parent.createDiv({ cls: "gps-profile-row" });
        row.createEl("span", { text: profile.name, cls: "gps-profile-name" });

        const loadBtn = row.createEl("button", { text: "Load", cls: "gps-sidebar-btn" });
        loadBtn.addEventListener("click", async () => {
          await this.loadProfile(profile);
        });

        const deleteBtn = row.createEl("button", { text: "×", cls: "gps-group-delete-btn" });
        deleteBtn.addEventListener("click", async () => {
          this.settings.profiles.splice(i, 1);
          await this.saveSettings();
          renderProfiles();
        });
      }
    };

    renderProfiles();
  }

  private async loadProfile(profile: SettingsProfile): Promise<void> {
    const snapshot = profile.snapshot;

    // Apply SETTING_DEFS values
    for (const def of SETTING_DEFS) {
      if (snapshot[def.key] !== undefined) {
        (this.settings as any)[def.key] = snapshot[def.key];
      }
    }

    // Apply other values
    if (snapshot.showUntyped !== undefined) this.settings.showUntyped = snapshot.showUntyped;
    if (snapshot.nodeColor !== undefined) this.settings.nodeColor = snapshot.nodeColor;
    if (snapshot.nodeColorHover !== undefined) this.settings.nodeColorHover = snapshot.nodeColorHover;
    if (snapshot.nodeGroups !== undefined) {
      this.settings.nodeGroups = JSON.parse(JSON.stringify(snapshot.nodeGroups));
    }

    // Apply search query
    if (snapshot.searchQuery !== undefined) this.settings.searchQuery = snapshot.searchQuery;

    // Apply full relationship configs. Old profiles that contain only visibility/forceRule
    // continue to work because Object.assign leaves newer semantic fields untouched.
    if (snapshot.linkTypeConfig) {
      for (const [type, cfg] of Object.entries(snapshot.linkTypeConfig as Record<string, Partial<LinkTypeConfig>>)) {
        if (this.settings.linkTypes[type]) {
          Object.assign(this.settings.linkTypes[type], cfg);
        }
      }
    } else if (snapshot.linkTypeVisibility) {
      // Backwards compat with older profiles
      for (const [type, visible] of Object.entries(snapshot.linkTypeVisibility)) {
        if (this.settings.linkTypes[type]) {
          this.settings.linkTypes[type].visible = visible as boolean;
        }
      }
    }

    await this.saveSettings();
    await this.rebuildGraph();
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
    const filtered = filterGraphData(this.fullData, this.settings, this.settings.searchQuery);
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
