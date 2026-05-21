import {
  App,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath
} from "obsidian";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

declare const require: (moduleName: string) => {
  clipboard?: {
    readText: () => string;
  };
};

const electron = require("electron");
const electronClipboard = electron.clipboard;

interface PdfExpertCaptureSettings {
  captureFolder: string;
  imageNameTemplate: string;
  marginNoteExportFolder: string;
  marginNoteExportTimeoutMs: number;
  deleteMarginNoteExportAfterImport: boolean;
  pdfApp: string;
  sourceLinkApp: string;
  sourceLinkCopyMenuItem: string;
  sourceLinkCopyShortcut: string;
  sourceLinkCopyDelayMs: number;
  enableAccessibilityPositioning: boolean;
  preferClipboardLink: boolean;
  allowedClipboardSchemes: string;
  insertMode: "image-and-link" | "image-only" | "link-only";
  helperPath: string;
}

interface CaptureResult {
  imagePath: string;
  pdfPath?: string;
  page: number;
  rect?: string | null;
  sourceTitle?: string | null;
  externalLink?: string | null;
}

interface AnchorParams {
  file?: string;
  vaultPath?: string;
  name?: string;
  page?: string;
  rect?: string;
}

interface InsertParams {
  imagePath?: string;
  payloadPath?: string;
  link?: string;
  title?: string;
  autoScreen?: string;
}

interface MarginNotePayload {
  link?: string;
  title?: string;
  excerpt?: string;
  comment?: string;
  noteId?: string;
}

const DEFAULT_SETTINGS: PdfExpertCaptureSettings = {
  captureFolder: "attachments/pdf-captures",
  imageNameTemplate: "{pdfName}-p{page}-{timestamp}.png",
  marginNoteExportFolder: "/Users/ming/Desktop/imgs",
  marginNoteExportTimeoutMs: 20000,
  deleteMarginNoteExportAfterImport: false,
  pdfApp: "PDF Expert",
  sourceLinkApp: "MarginNote 4",
  sourceLinkCopyMenuItem: "复制卡片 URL",
  sourceLinkCopyShortcut: "cmd+shift+c",
  sourceLinkCopyDelayMs: 700,
  enableAccessibilityPositioning: false,
  preferClipboardLink: true,
  allowedClipboardSchemes: "marginnote,marginnote3app,marginnote4app,liquidtext,lt,hook,obsidian",
  insertMode: "image-and-link",
  helperPath: ""
};

export default class PdfExpertCapturePlugin extends Plugin {
  settings: PdfExpertCaptureSettings;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "capture-from-pdf-expert",
      name: "Capture from PDF Expert",
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "U"
        }
      ],
      callback: () => {
        void this.captureFromPdfExpert();
      }
    });

    this.addCommand({
      id: "capture-with-clipboard-link",
      name: "Capture with Clipboard Link",
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "L"
        }
      ],
      callback: () => {
        void this.captureWithClipboardLink();
      }
    });

    this.addCommand({
      id: "capture-with-auto-source-link",
      name: "Capture with Auto Source Link",
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "K"
        }
      ],
      callback: () => {
        void this.captureWithAutoSourceLink();
      }
    });

    this.addCommand({
      id: "import-latest-marginnote-card-image",
      name: "Import Latest MarginNote Card Image",
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "M"
        }
      ],
      callback: () => {
        void this.importLatestMarginNoteCardImage();
      }
    });

    this.addCommand({
      id: "export-and-import-marginnote-card-image",
      name: "Export and Import MarginNote Card Image",
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "E"
        }
      ],
      callback: () => {
        void this.exportAndImportMarginNoteCardImage();
      }
    });

    this.addCommand({
      id: "export-marginnote-word-and-import-card",
      name: "Export MarginNote Word and Import Card from Clipboard Link",
      hotkeys: [
        {
          modifiers: ["Mod", "Shift", "Alt"],
          key: "W"
        }
      ],
      callback: () => {
        void this.exportMarginNoteWordAndImportCard();
      }
    });

    this.registerObsidianProtocolHandler("pdf-expert-anchor", (params) => {
      void this.openAnchor(params as AnchorParams);
    });

    this.registerObsidianProtocolHandler("pdf-expert-capture-insert", (params) => {
      void this.insertExternalCapture(params as InsertParams);
    });

    this.addSettingTab(new PdfExpertCaptureSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async captureFromPdfExpert() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note before capturing from PDF Expert.");
      return;
    }

    try {
      const externalLink = this.settings.preferClipboardLink ? this.readSupportedClipboardLink() : null;
      new Notice("Select the source PDF, then drag the screenshot region.");
      const capture = await this.runHelper<CaptureResult>([
        "capture",
        "--pdf-app",
        this.settings.pdfApp
      ]);

      if (!capture.imagePath || !capture.pdfPath) {
        throw new Error("The helper did not return a screenshot path and PDF path.");
      }

      capture.externalLink = externalLink;
      const vaultImagePath = await this.importCaptureImage(capture);
      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);
      new Notice("PDF capture inserted.");
    } catch (error) {
      new Notice(`PDF Expert capture failed: ${formatError(error)}`);
      console.error("PDF Expert capture failed", error);
    }
  }

  private async captureWithClipboardLink() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note before capturing with a clipboard link.");
      return;
    }

    const externalLink = this.readSupportedClipboardLink();
    if (!externalLink) {
      new Notice("Copy a supported MarginNote/LiquidText link first.");
      return;
    }

    try {
      new Notice("Drag the screenshot region.");
      const capture = await this.runHelper<CaptureResult>(["capture-image"]);

      if (!capture.imagePath) {
        throw new Error("The helper did not return a screenshot path.");
      }

      capture.externalLink = externalLink;
      capture.sourceTitle = this.sourceTitleFromLink(externalLink);
      capture.page = capture.page || 1;

      const vaultImagePath = await this.importCaptureImage(capture);
      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);
      new Notice("Linked capture inserted.");
    } catch (error) {
      new Notice(`Clipboard link capture failed: ${formatError(error)}`);
      console.error("Clipboard link capture failed", error);
    }
  }

  private async captureWithAutoSourceLink() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note before capturing with an auto source link.");
      return;
    }

    try {
      new Notice(`Copying source link from ${this.settings.sourceLinkApp}, then capture the region.`);
      const capture = await this.runHelper<CaptureResult>([
        "capture-auto-link",
        "--source-app",
        this.settings.sourceLinkApp,
        "--copy-menu-item",
        this.settings.sourceLinkCopyMenuItem,
        "--copy-shortcut",
        this.settings.sourceLinkCopyShortcut,
        "--copy-delay-ms",
        String(this.settings.sourceLinkCopyDelayMs)
      ]);

      if (!capture.imagePath) {
        throw new Error("The helper did not return a screenshot path.");
      }

      const externalLink = this.readSupportedClipboardLink();
      if (!externalLink) {
        throw new Error(`No supported source link was copied from ${this.settings.sourceLinkApp}. Check the copy-link shortcut in plugin settings.`);
      }

      capture.externalLink = externalLink;
      capture.sourceTitle = this.sourceTitleFromLink(externalLink);
      capture.page = capture.page || 1;

      const vaultImagePath = await this.importCaptureImage(capture);
      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);
      new Notice("Auto-linked capture inserted.");
    } catch (error) {
      new Notice(`Auto source link capture failed: ${formatError(error)}`);
      console.error("Auto source link capture failed", error);
    }
  }

  private async importLatestMarginNoteCardImage() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note before importing a MarginNote card image.");
      return;
    }

    try {
      const exportImage = await findLatestMarginNoteExport(this.settings.marginNoteExportFolder);
      const noteId = noteIdFromMarginNoteImageName(path.basename(exportImage));
      if (!noteId) {
        throw new Error(`Could not parse noteId from MarginNote export: ${path.basename(exportImage)}`);
      }

      const capture: CaptureResult = {
        imagePath: exportImage,
        page: 1,
        sourceTitle: "marginnote",
        externalLink: `marginnote4app://note/${noteId}`
      };

      const vaultImagePath = await this.importCaptureImage(capture);
      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);

      if (this.settings.deleteMarginNoteExportAfterImport) {
        await fs.unlink(exportImage);
      }

      new Notice("MarginNote card image imported.");
    } catch (error) {
      new Notice(`Could not import MarginNote card image: ${formatError(error)}`);
      console.error("Could not import MarginNote card image", error);
    }
  }

  private async exportAndImportMarginNoteCardImage() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note before exporting a MarginNote card image.");
      return;
    }

    try {
      new Notice("Exporting selected MarginNote card long image.");
      const exportCapture = await this.runHelper<CaptureResult>([
        "export-marginnote-card",
        "--source-app",
        this.settings.sourceLinkApp,
        "--export-folder",
        this.settings.marginNoteExportFolder,
        "--timeout-ms",
        String(this.settings.marginNoteExportTimeoutMs)
      ]);

      if (!exportCapture.imagePath) {
        throw new Error("The helper did not return an exported MarginNote image path.");
      }

      const noteId = noteIdFromMarginNoteImageName(path.basename(exportCapture.imagePath));
      if (!noteId) {
        throw new Error(`Could not parse noteId from MarginNote export: ${path.basename(exportCapture.imagePath)}`);
      }

      const capture: CaptureResult = {
        imagePath: exportCapture.imagePath,
        page: 1,
        sourceTitle: "marginnote",
        externalLink: `marginnote4app://note/${noteId}`
      };

      const vaultImagePath = await this.importCaptureImage(capture);
      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);

      if (this.settings.deleteMarginNoteExportAfterImport) {
        await fs.unlink(exportCapture.imagePath);
      }

      new Notice("MarginNote card image exported and imported.");
    } catch (error) {
      new Notice(`Could not export/import MarginNote card image: ${formatError(error)}`);
      console.error("Could not export/import MarginNote card image", error);
    }
  }

  private async exportMarginNoteWordAndImportCard() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note before importing a MarginNote card image.");
      return;
    }

    const externalLink = this.readSupportedClipboardLink();
    const noteId = externalLink ? noteIdFromMarginNoteUrl(externalLink) : null;
    if (!externalLink || !noteId) {
      new Notice("Copy the current MarginNote card URL first, then run the Word export import command.");
      return;
    }

    try {
      new Notice("Exporting MarginNote Word file and extracting the selected card image.");
      const exportCapture = await this.runHelper<CaptureResult>([
        "export-marginnote-word-card",
        "--source-app",
        this.settings.sourceLinkApp,
        "--note-id",
        noteId,
        "--export-folder",
        this.settings.marginNoteExportFolder,
        "--timeout-ms",
        String(this.settings.marginNoteExportTimeoutMs)
      ]);

      if (!exportCapture.imagePath) {
        throw new Error("The helper did not return an extracted MarginNote card image path.");
      }

      const capture: CaptureResult = {
        imagePath: exportCapture.imagePath,
        page: 1,
        sourceTitle: "marginnote",
        externalLink
      };

      const vaultImagePath = await this.importCaptureImage(capture);
      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);
      new Notice("MarginNote card image extracted from Word export.");
    } catch (error) {
      new Notice(`Could not extract MarginNote card image from Word export: ${formatError(error)}`);
      console.error("Could not extract MarginNote card image from Word export", error);
    }
  }

  private async openAnchor(params: AnchorParams) {
    const file = await this.resolvePdfPath(params);
    if (!file) {
      new Notice("PDF backlink source could not be found.");
      return;
    }

    try {
      await fs.access(file);
    } catch {
      new Notice(`Source PDF does not exist: ${file}`);
      return;
    }

    try {
      await this.runHelper([
        "open",
        "--pdf-app",
        this.settings.pdfApp,
        "--file",
        file,
        "--page",
        String(parsePositiveInteger(params.page) ?? 1),
        "--enable-positioning",
        this.settings.enableAccessibilityPositioning ? "1" : "0"
      ]);
    } catch (error) {
      new Notice(`Could not open PDF Expert backlink: ${formatError(error)}`);
      console.error("Could not open PDF Expert backlink", error);
    }
  }

  private async insertExternalCapture(params: InsertParams) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note before inserting a MarginNote capture.");
      return;
    }

    const payloadPath = decodeParam(params.payloadPath);
    const imagePath = decodeParam(params.imagePath);
    const externalLink = decodeParam(params.link);

    if (params.autoScreen === "1" && externalLink) {
      await this.insertScreenDetectedCapture(view, externalLink, decodeParam(params.title) || "marginnote");
      return;
    }

    if (payloadPath) {
      await this.insertMarginNotePayload(view, payloadPath);
      return;
    }

    if (!imagePath || !externalLink) {
      new Notice("MarginNote capture is missing its image or source link.");
      return;
    }

    if (!await fileExists(imagePath)) {
      new Notice(`MarginNote capture image does not exist: ${imagePath}`);
      return;
    }

    try {
      const capture: CaptureResult = {
        imagePath,
        page: 1,
        sourceTitle: decodeParam(params.title) || this.sourceTitleFromLink(externalLink),
        externalLink
      };

      const vaultImagePath = await this.importCaptureImage(capture);
      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);
      new Notice("MarginNote capture inserted.");
    } catch (error) {
      new Notice(`Could not insert MarginNote capture: ${formatError(error)}`);
      console.error("Could not insert MarginNote capture", error);
    }
  }

  private async insertScreenDetectedCapture(view: MarkdownView, externalLink: string, title: string) {
    try {
      const capture = await this.runHelper<CaptureResult>([
        "capture-selected-card",
        "--source-app",
        this.settings.sourceLinkApp
      ]);

      if (!capture.imagePath) {
        throw new Error("The helper did not return a selected card screenshot.");
      }

      capture.externalLink = externalLink;
      capture.sourceTitle = title;
      capture.page = 1;

      const vaultImagePath = await this.importCaptureImage(capture);
      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);
      new Notice("MarginNote selected card inserted.");
    } catch (error) {
      new Notice(`Could not detect selected MarginNote card: ${formatError(error)}`);
      console.error("Could not detect selected MarginNote card", error);
    }
  }

  private async insertMarginNotePayload(view: MarkdownView, payloadPath: string) {
    if (!await fileExists(payloadPath)) {
      new Notice(`MarginNote payload does not exist: ${payloadPath}`);
      return;
    }

    try {
      const payload = JSON.parse(await fs.readFile(payloadPath, "utf8")) as MarginNotePayload;
      if (!payload.link) {
        throw new Error("MarginNote payload is missing its source link.");
      }

      const vaultImagePath = await this.createCardSvg(payload);
      const capture: CaptureResult = {
        imagePath: vaultImagePath,
        page: 1,
        sourceTitle: "marginnote",
        externalLink: payload.link
      };

      const markdown = this.buildMarkdown(vaultImagePath, capture);
      view.editor.replaceSelection(markdown);
      new Notice("MarginNote card inserted.");
    } catch (error) {
      new Notice(`Could not insert MarginNote card: ${formatError(error)}`);
      console.error("Could not insert MarginNote card", error);
    }
  }

  private async createCardSvg(payload: MarginNotePayload): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("This plugin requires a local filesystem vault.");
    }

    const folder = normalizePath(this.settings.captureFolder.trim() || DEFAULT_SETTINGS.captureFolder);
    await ensureVaultFolder(this.app, folder);

    const fileName = renderImageName(this.settings.imageNameTemplate, "marginnote", 1).replace(/\.png$/i, ".svg");
    const uniquePath = await nextAvailableVaultPath(this.app, normalizePath(`${folder}/${fileName}`));
    const destinationPath = path.join(adapter.getBasePath(), uniquePath);

    await fs.writeFile(destinationPath, renderCardSvg(payload), "utf8");
    return uniquePath;
  }

  private async importCaptureImage(capture: CaptureResult): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("This plugin requires a local filesystem vault.");
    }

    const folder = normalizePath(this.settings.captureFolder.trim() || DEFAULT_SETTINGS.captureFolder);
    await ensureVaultFolder(this.app, folder);

    const sourceName = capture.pdfPath
      ? path.basename(capture.pdfPath, path.extname(capture.pdfPath))
      : capture.sourceTitle || "source-link";
    const fileName = renderImageName(this.settings.imageNameTemplate, sourceName, capture.page);
    const uniquePath = await nextAvailableVaultPath(this.app, normalizePath(`${folder}/${fileName}`));
    const destinationPath = path.join(adapter.getBasePath(), uniquePath);

    await fs.copyFile(capture.imagePath, destinationPath);
    return uniquePath;
  }

  private buildMarkdown(vaultImagePath: string, capture: CaptureResult): string {
    const image = `![[${vaultImagePath}]]`;
    const link = `[${this.buildLinkLabel(capture)}](${this.buildAnchorUrl(capture)})`;

    if (this.settings.insertMode === "image-only") {
      return `${image}\n`;
    }

    if (this.settings.insertMode === "link-only") {
      return `${link}\n`;
    }

    return `${image}\n\n${link}\n`;
  }

  private buildAnchorUrl(capture: CaptureResult): string {
    if (capture.externalLink) {
      return capture.externalLink;
    }

    if (!capture.pdfPath) {
      throw new Error("Capture has neither an external link nor a source PDF path.");
    }

    const query = new URLSearchParams();
    query.set("file", encodeURIComponent(capture.pdfPath));
    query.set("name", encodeURIComponent(path.basename(capture.pdfPath)));

    const vaultPath = this.toVaultRelativePath(capture.pdfPath);
    if (vaultPath) {
      query.set("vaultPath", encodeURIComponent(vaultPath));
    }

    query.set("page", String(capture.page || 1));

    if (capture.rect) {
      query.set("rect", encodeURIComponent(capture.rect));
    }

    return `obsidian://pdf-expert-anchor?${query.toString()}`;
  }

  private buildLinkLabel(capture: CaptureResult): string {
    if (!capture.externalLink) {
      return "Open in PDF Expert";
    }

    const scheme = capture.externalLink.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme?.includes("margin")) {
      return "Open in MarginNote";
    }

    if (scheme?.includes("liquid") || scheme === "lt") {
      return "Open in LiquidText";
    }

    return "Open source link";
  }

  private sourceTitleFromLink(link: string): string {
    const scheme = link.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme?.includes("margin")) {
      return "marginnote";
    }

    if (scheme?.includes("liquid") || scheme === "lt") {
      return "liquidtext";
    }

    return "source-link";
  }

  private readSupportedClipboardLink(): string | null {
    const text = electronClipboard?.readText().trim() ?? "";
    if (!text) {
      return null;
    }

    const url = firstUrlLikeToken(text);
    if (!url) {
      return null;
    }

    const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (!scheme) {
      return null;
    }

    const allowed = this.settings.allowedClipboardSchemes
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    return allowed.includes(scheme) ? url : null;
  }

  private async resolvePdfPath(params: AnchorParams): Promise<string | null> {
    const absolutePath = decodeParam(params.file);
    if (absolutePath && await fileExists(absolutePath)) {
      return absolutePath;
    }

    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const vaultPath = decodeParam(params.vaultPath);
      if (vaultPath) {
        const candidate = path.join(adapter.getBasePath(), vaultPath);
        if (await fileExists(candidate)) {
          return candidate;
        }
      }

      const name = decodeParam(params.name) || (absolutePath ? path.basename(absolutePath) : null);
      if (name) {
        const found = await findFileByName(adapter.getBasePath(), name);
        if (found) {
          return found;
        }
      }
    }

    return absolutePath;
  }

  private toVaultRelativePath(filePath: string): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }

    const basePath = adapter.getBasePath();
    const relative = path.relative(basePath, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }

    return normalizePath(relative);
  }

  private async runHelper<T = unknown>(args: string[]): Promise<T> {
    const helperPath = await this.resolveHelperPath();

    return new Promise<T>((resolve, reject) => {
      execFile(helperPath, args, { timeout: 120_000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        const output = stdout.trim();
        if (!output) {
          resolve({} as T);
          return;
        }

        try {
          resolve(JSON.parse(output) as T);
        } catch {
          reject(new Error(`Helper returned invalid JSON: ${output}`));
        }
      });
    });
  }

  private async resolveHelperPath(): Promise<string> {
    if (this.settings.helperPath.trim()) {
      return this.settings.helperPath.trim();
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("This plugin requires a local filesystem vault.");
    }

    const manifestDir = this.manifest.dir;
    if (!manifestDir) {
      throw new Error("Plugin manifest directory is unavailable.");
    }

    return path.join(adapter.getBasePath(), manifestDir, "scripts/pdf-expert-capture-helper.sh");
  }
}

class PdfExpertCaptureSettingTab extends PluginSettingTab {
  plugin: PdfExpertCapturePlugin;

  constructor(app: App, plugin: PdfExpertCapturePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "PDF Expert Capture" });

    new Setting(containerEl)
      .setName("Capture folder")
      .setDesc("Vault-relative folder where screenshots are stored.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.captureFolder)
          .setValue(this.plugin.settings.captureFolder)
          .onChange(async (value) => {
            this.plugin.settings.captureFolder = value.trim() || DEFAULT_SETTINGS.captureFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Image name template")
      .setDesc("Available tokens: {pdfName}, {page}, {timestamp}.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.imageNameTemplate)
          .setValue(this.plugin.settings.imageNameTemplate)
          .onChange(async (value) => {
            this.plugin.settings.imageNameTemplate = value.trim() || DEFAULT_SETTINGS.imageNameTemplate;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("MarginNote export folder")
      .setDesc("Folder where MarginNote exports card long images.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.marginNoteExportFolder)
          .setValue(this.plugin.settings.marginNoteExportFolder)
          .onChange(async (value) => {
            this.plugin.settings.marginNoteExportFolder = value.trim() || DEFAULT_SETTINGS.marginNoteExportFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("MarginNote export timeout")
      .setDesc("Milliseconds to wait for a new exported *_Flatten.png after triggering MarginNote long-image export.")
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.marginNoteExportTimeoutMs))
          .setValue(String(this.plugin.settings.marginNoteExportTimeoutMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.marginNoteExportTimeoutMs = Number.isFinite(parsed) && parsed > 0
              ? parsed
              : DEFAULT_SETTINGS.marginNoteExportTimeoutMs;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Delete MarginNote export after import")
      .setDesc("Delete the original exported PNG after it has been copied into the vault.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteMarginNoteExportAfterImport)
          .onChange(async (value) => {
            this.plugin.settings.deleteMarginNoteExportAfterImport = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PDF app")
      .setDesc("The macOS app used to open backlinks.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.pdfApp)
          .setValue(this.plugin.settings.pdfApp)
          .onChange(async (value) => {
            this.plugin.settings.pdfApp = value.trim() || DEFAULT_SETTINGS.pdfApp;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Source link app")
      .setDesc("The reader app used by Capture with Auto Source Link.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.sourceLinkApp)
          .setValue(this.plugin.settings.sourceLinkApp)
          .onChange(async (value) => {
            this.plugin.settings.sourceLinkApp = value.trim() || DEFAULT_SETTINGS.sourceLinkApp;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Source link copy shortcut")
      .setDesc("Fallback shortcut the reader app uses to copy the current location link, for example cmd+shift+c or cmd+option+c.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.sourceLinkCopyShortcut)
          .setValue(this.plugin.settings.sourceLinkCopyShortcut)
          .onChange(async (value) => {
            this.plugin.settings.sourceLinkCopyShortcut = value.trim().toLowerCase() || DEFAULT_SETTINGS.sourceLinkCopyShortcut;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Source link copy menu item")
      .setDesc("Visible menu item to click before falling back to the shortcut. For MarginNote 4 card menus, use 复制卡片 URL.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.sourceLinkCopyMenuItem)
          .setValue(this.plugin.settings.sourceLinkCopyMenuItem)
          .onChange(async (value) => {
            this.plugin.settings.sourceLinkCopyMenuItem = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Source link copy delay")
      .setDesc("Milliseconds to wait after the copy-link shortcut before starting the screenshot.")
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.sourceLinkCopyDelayMs))
          .setValue(String(this.plugin.settings.sourceLinkCopyDelayMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.sourceLinkCopyDelayMs = Number.isFinite(parsed) && parsed >= 0
              ? parsed
              : DEFAULT_SETTINGS.sourceLinkCopyDelayMs;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Insertion mode")
      .setDesc("Choose whether captures insert the image, backlink, or both.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("image-and-link", "Image and backlink")
          .addOption("image-only", "Image only")
          .addOption("link-only", "Backlink only")
          .setValue(this.plugin.settings.insertMode)
          .onChange(async (value: PdfExpertCaptureSettings["insertMode"]) => {
            this.plugin.settings.insertMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Try page positioning")
      .setDesc("Uses macOS accessibility keystrokes after opening PDF Expert. This is best-effort because PDF Expert does not expose a stable public deep-link API.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAccessibilityPositioning)
          .onChange(async (value) => {
            this.plugin.settings.enableAccessibilityPositioning = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Prefer clipboard source links")
      .setDesc("If the clipboard contains a supported MarginNote/LiquidText-style URL, insert that link instead of the PDF Expert fallback link.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.preferClipboardLink)
          .onChange(async (value) => {
            this.plugin.settings.preferClipboardLink = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Allowed clipboard URL schemes")
      .setDesc("Comma-separated URL schemes accepted as source links.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.allowedClipboardSchemes)
          .setValue(this.plugin.settings.allowedClipboardSchemes)
          .onChange(async (value) => {
            this.plugin.settings.allowedClipboardSchemes = value.trim() || DEFAULT_SETTINGS.allowedClipboardSchemes;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Helper path")
      .setDesc("Optional absolute path to a custom helper script. Leave empty to use the bundled helper.")
      .addText((text) =>
        text
          .setPlaceholder("Bundled helper")
          .setValue(this.plugin.settings.helperPath)
          .onChange(async (value) => {
            this.plugin.settings.helperPath = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}

async function ensureVaultFolder(app: App, folder: string) {
  const parts = normalizePath(folder).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

async function nextAvailableVaultPath(app: App, initialPath: string): Promise<string> {
  if (!app.vault.getAbstractFileByPath(initialPath)) {
    return initialPath;
  }

  const ext = path.posix.extname(initialPath);
  const base = initialPath.slice(0, -ext.length);

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!app.vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not find an available screenshot filename.");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFileByName(root: string, fileName: string): Promise<string | null> {
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }

    if (entry.isDirectory()) {
      const found = await findFileByName(fullPath, fileName);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

async function findLatestMarginNoteExport(folder: string): Promise<string> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const candidates: Array<{ path: string; mtimeMs: number }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!/_Flatten\.png$/i.test(entry.name)) {
      continue;
    }

    if (!noteIdFromMarginNoteImageName(entry.name)) {
      continue;
    }

    const fullPath = path.join(folder, entry.name);
    const stat = await fs.stat(fullPath);
    candidates.push({ path: fullPath, mtimeMs: stat.mtimeMs });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) {
    throw new Error(`No MarginNote *_Flatten.png exports found in ${folder}`);
  }

  return candidates[0].path;
}

function noteIdFromMarginNoteImageName(fileName: string): string | null {
  const match = fileName.match(/^([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})_/);
  return match?.[1]?.toUpperCase() ?? null;
}

function noteIdFromMarginNoteUrl(url: string): string | null {
  const match = url.match(/marginnote(?:3app|4app)?:\/\/note\/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function renderImageName(template: string, pdfName: string, page: number): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");

  const rendered = template
    .replace(/\{pdfName\}/g, sanitizeFileName(pdfName))
    .replace(/\{page\}/g, String(page || 1))
    .replace(/\{timestamp\}/g, timestamp);

  const withExtension = path.extname(rendered) ? rendered : `${rendered}.png`;
  return sanitizeFileName(withExtension);
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "capture.png";
}

function decodeParam(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePositiveInteger(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstUrlLikeToken(value: string): string | null {
  const markdownLink = value.match(/\[[^\]]+\]\(([^)\s]+)\)/);
  if (markdownLink?.[1]) {
    return markdownLink[1];
  }

  const token = value.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)"]+/i)
    ?? value.match(/\b[a-z][a-z0-9+.-]*:[^\s<>)"]+/i);

  return token?.[0] ?? null;
}

function renderCardSvg(payload: MarginNotePayload): string {
  const width = 1180;
  const padding = 34;
  const title = cleanCardText(payload.title || "MarginNote card");
  const excerpt = cleanCardText(payload.excerpt || "");
  const comment = cleanCardText(payload.comment || "");
  const titleLines = wrapText(title, 38);
  const excerptLines = wrapText(excerpt, 48);
  const commentLines = wrapText(comment, 44);
  const titleHeight = titleLines.length * 38;
  const excerptHeight = excerptLines.length * 34;
  const commentHeight = commentLines.length ? commentLines.length * 30 + 34 : 0;
  const height = Math.max(220, padding * 2 + titleHeight + excerptHeight + commentHeight + 42);

  let y = padding + 28;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" rx="18" fill="#fffbea"/>`,
    `<rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="14" fill="none" stroke="#e6d94f" stroke-width="6"/>`,
    `<style>text{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif;fill:#1f2933}.title{font-size:30px;font-weight:700}.body{font-size:27px}.comment{font-size:24px;fill:#d11f1f;font-weight:600}</style>`
  ];

  for (const line of titleLines) {
    parts.push(`<text class="title" x="${padding}" y="${y}">${escapeXml(line)}</text>`);
    y += 38;
  }

  y += 16;

  for (const line of excerptLines) {
    parts.push(`<text class="body" x="${padding}" y="${y}">${escapeXml(line)}</text>`);
    y += 34;
  }

  if (commentLines.length) {
    y += 22;
    for (const line of commentLines) {
      parts.push(`<text class="comment" x="${padding}" y="${y}">${escapeXml(line)}</text>`);
      y += 30;
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

function cleanCardText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function wrapText(value: string, maxChars: number): string[] {
  if (!value) {
    return [];
  }

  const lines: string[] = [];
  let current = "";

  for (const char of value) {
    const candidate = `${current}${char}`;
    if (displayWidth(candidate) > maxChars && current) {
      lines.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 18);
}

function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += char.charCodeAt(0) > 255 ? 2 : 1;
  }
  return width;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
