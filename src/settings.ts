import { App, PluginSettingTab, Setting } from "obsidian";
import type GraphLinkTypesPlugin from "./main";
import { COLOR_PALETTE, UNTYPED_LINK_KEY, SETTING_DEFS } from "./types";

export class GraphLinkTypesSettingTab extends PluginSettingTab {
  plugin: GraphLinkTypesPlugin;

  constructor(app: App, plugin: GraphLinkTypesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setHeading().setName("Graph Link Types");

    // --- General (manual — unique control types) ---
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

    // --- Schema-driven sections ---
    new Setting(containerEl).setHeading().setName("Display");
    this.renderSettingsSection(containerEl, "display");

    // Color pickers (manual — not in sidebar)
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
      .setDesc("Color for hovered/active nodes (2D)")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.nodeColorHover)
          .onChange(async (value) => {
            this.plugin.settings.nodeColorHover = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setHeading().setName("2D display");
    this.renderSettingsSection(containerEl, "display2d");

    new Setting(containerEl).setHeading().setName("3D display");
    this.renderSettingsSection(containerEl, "display3d");

    new Setting(containerEl).setHeading().setName("Filters");
    this.renderSettingsSection(containerEl, "filters");

    new Setting(containerEl).setHeading().setName("Physics");
    this.renderSettingsSection(containerEl, "forces");

    // --- Node Groups (manual — complex editor) ---
    new Setting(containerEl).setHeading().setName("Node groups");
    containerEl.createEl("p", {
      text: "Color nodes by query. Supports: path:prefix, file:name, tag:#name, [property:value], bare substring. First match wins.",
      cls: "setting-item-description",
    });

    const groupContainer = containerEl.createDiv();
    this.renderGroupSettings(groupContainer);

    // --- Link type colors (manual — dynamic from data) ---
    new Setting(containerEl).setHeading().setName("Link type colors");

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
        )
        .addText((text) =>
          text
            .setPlaceholder("e.g. down:0.5 distance:2x")
            .setValue(config.forceRule || "")
            .onChange(async (value) => {
              config.forceRule = value.trim() || undefined;
              await this.plugin.saveSettings();
            })
        );
    }

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

  /** Render all settings for a section from the declarative schema */
  private renderSettingsSection(containerEl: HTMLElement, section: string): void {
    const defs = SETTING_DEFS.filter((d) => d.section === section);
    for (const def of defs) {
      if (def.type === "toggle") {
        const raw = this.plugin.settings[def.key] as boolean;
        new Setting(containerEl)
          .setName(def.label)
          .setDesc(def.desc ?? "")
          .addToggle((toggle) =>
            toggle.setValue(def.invert ? !raw : raw).onChange(async (value) => {
              (this.plugin.settings as any)[def.key] = def.invert ? !value : value;
              await this.plugin.saveSettings();
            })
          );
      } else if (def.type === "slider") {
        const raw = this.plugin.settings[def.key] as number;
        new Setting(containerEl)
          .setName(def.label)
          .setDesc(def.desc ?? "")
          .addSlider((slider) =>
            slider
              .setLimits(def.min!, def.max!, def.step!)
              .setValue(def.invert ? Math.abs(raw) : raw)
              .setDynamicTooltip()
              .onChange(async (value) => {
                (this.plugin.settings as any)[def.key] = def.invert ? -value : value;
                await this.plugin.saveSettings();
              })
          );
      }
    }
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
            .setPlaceholder("e.g. [type:reference]")
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
        groups.push({ query: "", color: "#4363d8" });
        await this.plugin.saveSettings();
        this.renderGroupSettings(container);
      })
    );
  }
}
