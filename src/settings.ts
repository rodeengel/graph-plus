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

    // General settings
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

    // Physics settings
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
      .setName("Repulsion strength")
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

    // Link type colors
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
}
