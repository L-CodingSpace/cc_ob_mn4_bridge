# cc_ob_mn4_bridge

Bridge MarginNote 4 cards into Obsidian notes with the card image and a backlink.

This repository contains three pieces that work together:

- **Obsidian plugin**: inserts the card image and MarginNote backlink into the active note.
- **MarginNote addon**: copies the currently focused card URL to the clipboard.
- **macOS helper**: triggers MarginNote's Word export, waits for the exported `.docx`, extracts the image for the selected card, and returns it to Obsidian.

## Current Workflow

1. In MarginNote 4, select a card.
2. Click the `Copy Card URL` addon button.
3. In Obsidian, place the cursor where the card should be inserted.
4. Run `Export MarginNote Word and Import Card from Clipboard Link`, or press `Cmd+Shift+Option+W`.
5. MarginNote opens its Word export flow.
6. Manually answer the MarginNote dialogs:
   - `否` for exporting excerpt colors.
   - `存储` for saving the Word file.
7. Obsidian imports the matching card image and inserts a backlink.

The inserted Markdown looks like:

```md
![[attachments/pdf-captures/source-link-p1-20260521-092756.png]]

[Open in MarginNote](marginnote3app://note/72D289A5-9A11-4338-B4D8-08D2C8AB2F1D)
```

## Repository Layout

```text
.
├── main.ts                         # Obsidian plugin source
├── manifest.json                   # Obsidian plugin manifest
├── styles.css                      # Obsidian plugin styles
├── scripts/
│   └── pdf-expert-capture-helper.sh # macOS helper
├── marginnote-copy-card-url/
│   ├── main.js                     # MarginNote addon source
│   ├── mnaddon.json                # MarginNote addon manifest
│   └── logo_44x44.png
├── CopyCardURL.mnaddon             # Packaged MarginNote addon
├── package.json
└── tsconfig.json
```

## Build Obsidian Plugin

```bash
npm install
npm run build
```

Copy these files into the Obsidian plugin directory:

```text
<vault>/.obsidian/plugins/pdf-expert-capture/
```

Required files:

```text
main.js
manifest.json
styles.css
scripts/pdf-expert-capture-helper.sh
```

For the current local vault, that directory is:

```text
/Users/ming/paper_notes/.obsidian/plugins/pdf-expert-capture/
```

## Install MarginNote Addon

Install:

```text
CopyCardURL.mnaddon
```

The addon only copies the focused card URL to the clipboard. It does not export images and does not control Obsidian.

## Key Commands

Obsidian commands:

- `Capture from PDF Expert`
- `Capture with Clipboard Link`
- `Import Latest MarginNote Card Image`
- `Export MarginNote Word and Import Card from Clipboard Link`
- `Export MarginNote Word as Markdown Outline`

Most important command for the current MarginNote workflow:

```text
Export MarginNote Word and Import Card from Clipboard Link
```

Default hotkey:

```text
Cmd+Shift+Option+W
```

Batch outline import command:

```text
Export MarginNote Word as Markdown Outline
```

Default hotkey:

```text
Cmd+Shift+Option+O
```

This command parses MarginNote's Word export into a Markdown bullet outline. It preserves Word heading levels, MarginNote backlinks, and card images where they are available in the `.docx`.

## Notes

- This is macOS-only for now.
- MarginNote's Word export shows native dialogs. The current stable workflow lets the user handle those dialogs manually.
- The helper only accepts a `.docx` created or changed during the current export run. It does not reuse older Word exports.
- PDF Expert support remains in the code as an earlier fallback workflow.
