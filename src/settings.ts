import { App, PluginSettingTab, Setting } from "obsidian";
import type GraphLinkTypesPlugin from "./main";
import type { GraphLinkTypesSettings, LinkTypeConfig } from "./types";
import { COLOR_PALETTE, UNTYPED_LINK_KEY } from "./types";

export class GraphLinkTypesSettingTab extends PluginSettingTab {
  plugin: GraphLinkTypesPlugin;

  constructor(app: App, plugin: GraphLinkTypesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Graph Link Types" });

    // --- General settings ---
    new Setting(containerEl)
      .setName("Default mode")
      .setDesc("Default rendering mode when opening the graph view")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("2d", "2D (Canvas)")
          .addOption("3d", "3D (WebGL)")
          .setValue(this.plugin.settings.defaultMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultMode = value as "2d" | "3d";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show edge labels")
      .setDesc("Display link type names on edges")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLabels)
          .onChange(async (value) => {
            this.plugin.settings.showLabels = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show untyped links")
      .setDesc("Show regular wikilinks that have no type annotation")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showUntyped)
          .onChange(async (value) => {
            this.plugin.settings.showUntyped = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Display settings ---
    containerEl.createEl("h3", { text: "Display" });

    new Setting(containerEl)
      .setName("Show arrows")
      .setDesc("Draw directional arrowheads on links")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showArrows)
          .onChange(async (value) => {
            this.plugin.settings.showArrows = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Text fade threshold")
      .setDesc("Zoom level at which node labels appear (0.1 - 5)")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 5, 0.1)
          .setValue(this.plugin.settings.textFadeThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.textFadeThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Link thickness")
      .setDesc("Width of graph edges (0.5 - 5)")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 5, 0.5)
          .setValue(this.plugin.settings.linkThickness)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.linkThickness = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Node colors ---
    new Setting(containerEl)
      .setName("Node color")
      .setDesc("Default color for graph nodes")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.nodeColor)
          .onChange(async (value) => {
            this.plugin.settings.nodeColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Node hover color")
      .setDesc("Color for hovered/active nodes")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.nodeColorHover)
          .onChange(async (value) => {
            this.plugin.settings.nodeColorHover = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Filters ---
    containerEl.createEl("h3", { text: "Filters" });

    new Setting(containerEl)
      .setName("Show tags")
      .setDesc("Include nodes that have tags")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTags)
          .onChange(async (value) => {
            this.plugin.settings.showTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show attachments")
      .setDesc("Include attachment files (images, PDFs, etc.)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showAttachments)
          .onChange(async (value) => {
            this.plugin.settings.showAttachments = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Existing files only")
      .setDesc("Hide nodes for unresolved/non-existent files")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.existingOnly)
          .onChange(async (value) => {
            this.plugin.settings.existingOnly = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show orphans")
      .setDesc("Show nodes without any visible links")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showOrphans)
          .onChange(async (value) => {
            this.plugin.settings.showOrphans = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Physics settings ---
    containerEl.createEl("h3", { text: "Physics" });

    new Setting(containerEl)
      .setName("Node size")
      .setDesc("Radius of graph nodes (1-20)")
      .addSlider((slider) =>
        slider
          .setLimits(1, 20, 1)
          .setValue(this.plugin.settings.nodeSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.nodeSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Center force")
      .setDesc("Strength of centering force (0-1)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.centerForce)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.centerForce = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Repel force")
      .setDesc("Charge force between nodes (-500 to -10)")
      .addSlider((slider) =>
        slider
          .setLimits(-500, -10, 10)
          .setValue(this.plugin.settings.chargeStrength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.chargeStrength = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Link force")
      .setDesc("Strength of link attraction (0-1)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.linkStrength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.linkStrength = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Link distance")
      .setDesc("Preferred distance between linked nodes (20-200)")
      .addSlider((slider) =>
        slider
          .setLimits(20, 200, 5)
          .setValue(this.plugin.settings.linkDistance)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.linkDistance = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Pause physics")
      .setDesc("Freeze the force simulation (nodes stop moving)")
      .addToggle((toggle) =>
        toggle
          .setValue(!this.plugin.settings.animate)
          .onChange(async (value) => {
            this.plugin.settings.animate = !value;
            await this.plugin.saveSettings();
          })
      );

    // --- Node Groups ---
    containerEl.createEl("h3", { text: "Node Groups" });
    containerEl.createEl("p", {
      text: "Groups color nodes by query. Queries: path:prefix, tag:#name, file:pattern, or bare substring. First matching group wins.",
      cls: "setting-item-description",
    });

    const groupContainer = containerEl.createDiv();
    this.renderGroupSettings(groupContainer);

    // --- Link type colors ---
    containerEl.createEl("h3", { text: "Link Type Colors" });

    const types = Object.keys(this.plugin.settings.linkTypes).sort((a, b) => {
      if (a === UNTYPED_LINK_KEY) return 1;
      if (b === UNTYPED_LINK_KEY) return -1;
      return a.localeCompare(b);
    });

    for (const type of types) {
      const config = this.plugin.settings.linkTypes[type];
      const displayName = type === UNTYPED_LINK_KEY ? "untyped" : type;

      new Setting(containerEl)
        .setName(displayName)
        .addColorPicker((picker) =>
          picker.setValue(config.color).onChange(async (value) => {
            config.color = value;
            await this.plugin.saveSettings();
          })
        )
        .addToggle((toggle) =>
          toggle
            .setTooltip("Visible")
            .setValue(
              type === UNTYPED_LINK_KEY
                ? this.plugin.settings.showUntyped
                : config.visible
            )
            .onChange(async (value) => {
              if (type === UNTYPED_LINK_KEY) {
                this.plugin.settings.showUntyped = value;
              } else {
                config.visible = value;
              }
              await this.plugin.saveSettings();
            })
        );
    }

    // Reset button
    new Setting(containerEl).addButton((button) =>
      button
        .setButtonText("Reset colors to defaults")
        .onClick(async () => {
          let i = 0;
          for (const type of Object.keys(this.plugin.settings.linkTypes)) {
            this.plugin.settings.linkTypes[type].color =
              COLOR_PALETTE[i % COLOR_PALETTE.length];
            i++;
          }
          await this.plugin.saveSettings();
          this.display();
        })
    );
  }

  private renderGroupSettings(container: HTMLElement): void {
    container.empty();
    const groups = this.plugin.settings.nodeGroups;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      new Setting(container)
        .setName(`Group ${i + 1}`)
        .addText((text) =>
          text
            .setPlaceholder("Name")
            .setValue(group.name)
            .onChange(async (value) => {
              group.name = value;
              await this.plugin.saveSettings();
            })
        )
        .addText((text) =>
          text
            .setPlaceholder("Query (path:, tag:#, file:)")
            .setValue(group.query)
            .onChange(async (value) => {
              group.query = value;
              await this.plugin.saveSettings();
            })
        )
        .addColorPicker((picker) =>
          picker.setValue(group.color).onChange(async (value) => {
            group.color = value;
            await this.plugin.saveSettings();
          })
        )
        .addButton((button) =>
          button
            .setButtonText("Remove")
            .setWarning()
            .onClick(async () => {
              groups.splice(i, 1);
              await this.plugin.saveSettings();
              this.renderGroupSettings(container);
            })
        );
    }

    new Setting(container).addButton((button) =>
      button.setButtonText("Add group").onClick(async () => {
        groups.push({ name: "", query: "", color: "#4363d8" });
        await this.plugin.saveSettings();
        this.renderGroupSettings(container);
      })
    );
  }
}
