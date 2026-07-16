import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: {
        "header.nav.home": "Home",
        "header.nav.editor": "Editor",
        "header.nav.examples": "Examples",
        "header.nav.github": "GitHub",
        "editor.shell.dragResize": "Drag to resize",
        "editor.toolbar.compile": "Compile",
        "editor.toolbar.run": "Run",
        "editor.toolbar.stop": "Stop",
        "editor.toolbar.reset": "Reset",
        "editor.toolbar.save": "Save",
        "editor.toolbar.settings": "Settings",
        "editor.fileExplorer.newFile": "New File",
        "editor.fileExplorer.rename": "Rename",
        "editor.fileExplorer.delete": "Delete",
        "componentPicker.title": "Add Component",
        "componentPicker.search": "Search components...",
        "serialMonitor.title": "Serial Monitor",
        "serialMonitor.send": "Send",
        "boardPicker.title": "Select Board",
        "boardPicker.arduino": "Arduino",
        "boardPicker.esp32": "ESP32",
        "boardPicker.raspberryPi": "Raspberry Pi",
        "boardPicker.stm32": "STM32",
        "agent.chat.placeholder": "Ask CircuitMuse to build a circuit...",
        "agent.settings.title": "AI Provider Settings",
        "projects.title": "Projects",
        "projects.new": "New Project",
        "projects.import": "Import",
        "projects.open": "Open",
        "projects.delete": "Delete",
        "export.title": "Export Project",
        "export.vlx": "CircuitMuse Format (.vlx)",
        "export.zip": "Wokwi Compatible (.zip)",
        "export.json": "Raw JSON (.json)",
        "export.html": "HTML Report (.html)",
        "setup.title": "System Setup",
        "setup.required": "Required",
        "setup.optional": "Optional",
        "setup.installed": "Installed",
        "setup.missing": "Missing",
        "setup.install": "Install",
        "setup.reScan": "Re-scan",
      },
    },
  },
  lng: "en",
  fallbackLng: "en",
  ns: ["common"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export async function loadLocale(_locale: string): Promise<void> {}

export { i18n };
