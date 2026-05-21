#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  pdf-expert-capture-helper.sh capture --pdf-app "PDF Expert"
  pdf-expert-capture-helper.sh capture-image
  pdf-expert-capture-helper.sh capture-selected-card --source-app "MarginNote 4"
  pdf-expert-capture-helper.sh export-marginnote-card --source-app "MarginNote 4" --export-folder /Users/ming/Desktop/imgs --timeout-ms 20000
  pdf-expert-capture-helper.sh export-marginnote-word-card --source-app "MarginNote 4" --note-id UUID --timeout-ms 20000
  pdf-expert-capture-helper.sh export-marginnote-word-outline --source-app "MarginNote 4" --export-folder /Users/ming/Desktop/imgs --timeout-ms 60000
  pdf-expert-capture-helper.sh parse-marginnote-word-outline --file /path/to/export.docx
  pdf-expert-capture-helper.sh capture-auto-link --source-app "MarginNote 4" --copy-menu-item "复制卡片 URL" --copy-shortcut "cmd+shift+c" --copy-delay-ms 700
  pdf-expert-capture-helper.sh open --pdf-app "PDF Expert" --file /path/to/file.pdf --page 12 --enable-positioning 0
EOF
}

json_string() {
  osascript -l JavaScript -e 'ObjC.import("Foundation"); const s = $.NSProcessInfo.processInfo.environment.objectForKey("VALUE").js; JSON.stringify(String(s));'
}

emit_json() {
  local image_path="${1:-}"
  local pdf_path="${2:-}"
  local page="${3:-1}"
  local rect="${4:-}"
  local source_title="${5:-}"

  IMAGE_PATH="$image_path" PDF_PATH="$pdf_path" PAGE="$page" RECT="$rect" SOURCE_TITLE="$source_title" \
    osascript -l JavaScript -e '
      ObjC.import("Foundation");
      const env = $.NSProcessInfo.processInfo.environment;
      function v(key) {
        const value = env.objectForKey(key);
        return value ? String(value.js) : "";
      }
      JSON.stringify({
        imagePath: v("IMAGE_PATH"),
        pdfPath: v("PDF_PATH"),
        page: Number(v("PAGE") || "1"),
        rect: v("RECT") || null,
        sourceTitle: v("SOURCE_TITLE") || null
      });
    '
}

arg_value() {
  local name="$1"
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      "$name")
        shift
        printf '%s' "${1:-}"
        return 0
        ;;
    esac
    shift
  done
}

capture() {
  local pdf_app
  pdf_app="$(arg_value "--pdf-app" "$@")"
  pdf_app="${pdf_app:-PDF Expert}"

  local pdf_path
  pdf_path="$(osascript <<'APPLESCRIPT'
set selectedFile to choose file with prompt "Select the source PDF for this capture" of type {"pdf"}
POSIX path of selectedFile
APPLESCRIPT
)"

  local page
  page="1"

  open -a "$pdf_app" "$pdf_path" >/dev/null 2>&1 || {
    echo "Could not open $pdf_app for $pdf_path" >&2
    exit 3
  }

  sleep 0.5

  local tmpdir image_path
  tmpdir="${TMPDIR:-/tmp}/pdf-expert-capture"
  mkdir -p "$tmpdir"
  image_path="$tmpdir/capture-$(date +%Y%m%d-%H%M%S).png"

  /usr/sbin/screencapture -i "$image_path"

  if [[ ! -s "$image_path" ]]; then
    echo "Screenshot was cancelled or empty." >&2
    exit 4
  fi

  emit_json "$image_path" "$pdf_path" "$page" "" "$(basename "$pdf_path")"
}

capture_image() {
  local tmpdir image_path
  tmpdir="${TMPDIR:-/tmp}/pdf-expert-capture"
  mkdir -p "$tmpdir"
  image_path="$tmpdir/capture-$(date +%Y%m%d-%H%M%S).png"

  /usr/sbin/screencapture -i "$image_path"

  if [[ ! -s "$image_path" ]]; then
    echo "Screenshot was cancelled or empty." >&2
    exit 4
  fi

  emit_json "$image_path" "" "1" "" "source-link"
}

capture_selected_card() {
  local source_app tmpdir screenshot_path image_path
  source_app="$(arg_value "--source-app" "$@")"
  source_app="${source_app:-MarginNote 4}"

  tmpdir="${TMPDIR:-/tmp}/pdf-expert-capture"
  mkdir -p "$tmpdir"
  screenshot_path="$tmpdir/screen-$(date +%Y%m%d-%H%M%S).png"
  image_path="$tmpdir/selected-card-$(date +%Y%m%d-%H%M%S).png"

  osascript -e "tell application \"$source_app\" to activate" >/dev/null 2>&1 || true
  sleep 0.35

  /usr/sbin/screencapture -x "$screenshot_path"

  python3 - "$screenshot_path" "$image_path" <<'PY'
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
img = Image.open(src).convert("RGB")
w, h = img.size
pixels = img.load()

blue = []
min_x = int(w * 0.35)
for y in range(h):
    for x in range(min_x, w):
        r, g, b = pixels[x, y]
        if b >= 175 and r <= 120 and g <= 170 and (b - r) >= 80 and (b - g) >= 45:
            blue.append((x, y))

if not blue:
    raise SystemExit("No blue selection pixels found")

row_counts = {}
col_counts = {}
for x, y in blue:
    row_counts[y] = row_counts.get(y, 0) + 1
    col_counts[x] = col_counts.get(x, 0) + 1

row_threshold = max(35, int(w * 0.035))
col_threshold = max(18, int(h * 0.018))

def groups_from_counts(counts, threshold):
    keys = sorted(k for k, v in counts.items() if v >= threshold)
    groups = []
    for key in keys:
        if not groups or key > groups[-1][-1] + 3:
            groups.append([key, key])
        else:
            groups[-1][-1] = key
    return groups

row_groups = groups_from_counts(row_counts, row_threshold)
col_groups = groups_from_counts(col_counts, col_threshold)

if len(row_groups) < 2 or len(col_groups) < 2:
    # Fallback to all blue pixels on the right half. This may include handles,
    # but avoids returning nothing when dashed borders are sparse.
    xs = [p[0] for p in blue]
    ys = [p[1] for p in blue]
    left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
else:
    best = None
    for top_group in row_groups:
        for bottom_group in row_groups:
            top = top_group[0]
            bottom = bottom_group[-1]
            if bottom - top < 80:
                continue
            for left_group in col_groups:
                for right_group in col_groups:
                    left = left_group[0]
                    right = right_group[-1]
                    if right - left < 120:
                        continue
                    score = (right - left) * (bottom - top)
                    # Prefer plausible card rectangles on the mind-map side.
                    if best is None or score > best[0]:
                        best = (score, left, top, right, bottom)
    if best is None:
        xs = [p[0] for p in blue]
        ys = [p[1] for p in blue]
        left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
    else:
        _, left, top, right, bottom = best

pad = 10
left = max(0, left - pad)
top = max(0, top - pad)
right = min(w - 1, right + pad)
bottom = min(h - 1, bottom + pad)

if right <= left or bottom <= top:
    raise SystemExit("Invalid selected card crop")

img.crop((left, top, right + 1, bottom + 1)).save(dst)
PY

  if [[ ! -s "$image_path" ]]; then
    echo "Could not detect selected card region." >&2
    exit 6
  fi

  emit_json "$image_path" "" "1" "" "marginnote"
}

export_marginnote_card() {
  local source_app export_folder timeout_ms start_ms image_path
  source_app="$(arg_value "--source-app" "$@")"
  export_folder="$(arg_value "--export-folder" "$@")"
  timeout_ms="$(arg_value "--timeout-ms" "$@")"

  source_app="${source_app:-MarginNote 4}"
  export_folder="${export_folder:-/Users/ming/Desktop/imgs}"
  timeout_ms="${timeout_ms:-20000}"

  start_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

  osascript -e "tell application \"$source_app\" to activate" >/dev/null 2>&1 || true
  sleep 0.25

  click_visible_menu_item "$source_app" "高级" 350 || click_marginnote_popover_point "$source_app" "advanced" || true

  click_visible_menu_item "$source_app" "导出" 450 || click_marginnote_popover_point "$source_app" "export" || {
    echo "Could not click MarginNote export button." >&2
    exit 7
  }

  click_visible_menu_item "$source_app" "长图" 450 || click_marginnote_export_dialog_point "$source_app" "long-image" || {
    echo "Could not click MarginNote long-image export button." >&2
    exit 8
  }

  image_path="$(python3 - "$export_folder" "$start_ms" "$timeout_ms" <<'PY'
import os
import re
import sys
import time

folder = sys.argv[1]
start_ms = int(sys.argv[2])
timeout_ms = int(sys.argv[3])
deadline = time.time() + timeout_ms / 1000
pattern = re.compile(r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}_.+_Flatten\.png$")

while time.time() < deadline:
    candidates = []
    try:
        names = os.listdir(folder)
    except FileNotFoundError:
        names = []

    for name in names:
        if not pattern.match(name):
            continue
        path = os.path.join(folder, name)
        try:
            stat = os.stat(path)
        except OSError:
            continue
        if stat.st_mtime * 1000 >= start_ms - 1000 and stat.st_size > 0:
            candidates.append((stat.st_mtime, path))

    if candidates:
        candidates.sort(reverse=True)
        print(candidates[0][1])
        raise SystemExit(0)

    time.sleep(0.25)

raise SystemExit("No new MarginNote *_Flatten.png export found")
PY
)" || {
    echo "No new MarginNote *_Flatten.png export found in $export_folder." >&2
    exit 9
  }

  emit_json "$image_path" "" "1" "" "marginnote"
}

export_marginnote_word_card() {
  local source_app note_id export_folder timeout_ms tmpdir stamp snapshot_path docx_path image_path
  source_app="$(arg_value "--source-app" "$@")"
  note_id="$(arg_value "--note-id" "$@")"
  export_folder="$(arg_value "--export-folder" "$@")"
  timeout_ms="$(arg_value "--timeout-ms" "$@")"

  source_app="${source_app:-MarginNote 4}"
  export_folder="${export_folder:-/Users/ming/Desktop/imgs}"
  timeout_ms="${timeout_ms:-20000}"
  if [[ "$timeout_ms" =~ ^[0-9]+$ && "$timeout_ms" -lt 60000 ]]; then
    timeout_ms="60000"
  fi

  if [[ -z "$note_id" ]]; then
    echo "Missing --note-id for MarginNote Word export." >&2
    exit 10
  fi

  tmpdir="${TMPDIR:-/tmp}/pdf-expert-capture"
  mkdir -p "$tmpdir"
  stamp="$(date +%Y%m%d-%H%M%S)"
  snapshot_path="$tmpdir/marginnote-docx-snapshot-$stamp.json"
  image_path="$tmpdir/marginnote-card-$note_id-$stamp.png"

  snapshot_docx_exports "$export_folder" "$snapshot_path"

  trigger_marginnote_word_export "$source_app"
  docx_path="$(find_changed_marginnote_docx_export "$export_folder" "$snapshot_path" "$timeout_ms")" || {
    echo "MarginNote Word export did not create a new .docx in $export_folder." >&2
    rm -f "$snapshot_path"
    exit 11
  }

  extract_marginnote_card_image_from_docx "$docx_path" "$note_id" "$image_path" || {
    rm -f "$snapshot_path"
    exit 12
  }

  delete_changed_export "$docx_path" "$snapshot_path" || true
  rm -f "$snapshot_path"

  if [[ ! -s "$image_path" ]]; then
    echo "Could not extract a card image for MarginNote noteId $note_id from the Word export." >&2
    exit 13
  fi

  emit_json "$image_path" "" "1" "" "marginnote"
}

export_marginnote_word_outline() {
  local source_app export_folder timeout_ms tmpdir stamp snapshot_path docx_path image_dir
  source_app="$(arg_value "--source-app" "$@")"
  export_folder="$(arg_value "--export-folder" "$@")"
  timeout_ms="$(arg_value "--timeout-ms" "$@")"

  source_app="${source_app:-MarginNote 4}"
  export_folder="${export_folder:-/Users/ming/Desktop/imgs}"
  timeout_ms="${timeout_ms:-60000}"
  if [[ "$timeout_ms" =~ ^[0-9]+$ && "$timeout_ms" -lt 60000 ]]; then
    timeout_ms="60000"
  fi

  tmpdir="${TMPDIR:-/tmp}/pdf-expert-capture"
  mkdir -p "$tmpdir"
  stamp="$(date +%Y%m%d-%H%M%S)"
  snapshot_path="$tmpdir/marginnote-docx-outline-snapshot-$stamp.json"
  image_dir="$tmpdir/marginnote-outline-$stamp"
  mkdir -p "$image_dir"

  snapshot_docx_exports "$export_folder" "$snapshot_path"

  trigger_marginnote_word_export "$source_app"
  docx_path="$(find_changed_marginnote_docx_export "$export_folder" "$snapshot_path" "$timeout_ms")" || {
    echo "MarginNote Word export did not create a new .docx in $export_folder." >&2
    rm -f "$snapshot_path"
    exit 11
  }

  parse_marginnote_word_outline "$docx_path" "$image_dir" || {
    rm -f "$snapshot_path"
    exit 14
  }

  delete_changed_export "$docx_path" "$snapshot_path" || true
  rm -f "$snapshot_path"
}

parse_marginnote_word_outline_file() {
  local docx_path tmpdir stamp image_dir
  docx_path="$(arg_value "--file" "$@")"

  if [[ -z "$docx_path" || ! -f "$docx_path" ]]; then
    echo "MarginNote Word export does not exist: $docx_path" >&2
    exit 15
  fi

  tmpdir="${TMPDIR:-/tmp}/pdf-expert-capture"
  mkdir -p "$tmpdir"
  stamp="$(date +%Y%m%d-%H%M%S)"
  image_dir="$tmpdir/marginnote-outline-$stamp"
  mkdir -p "$image_dir"

  parse_marginnote_word_outline "$docx_path" "$image_dir"
}

trigger_marginnote_word_export() {
  local source_app="$1"

  SOURCE_APP="$source_app" osascript <<'APPLESCRIPT' >/dev/null
set sourceApp to system attribute "SOURCE_APP"

tell application sourceApp to activate
delay 0.4

tell application "System Events"
  tell process sourceApp
    set frontmost to true
    click menu item "导出到 MS Word(docx)" of menu 1 of menu item "导出" of menu 1 of menu bar item "文件" of menu bar 1
  end tell
end tell

return ""
APPLESCRIPT
}

snapshot_docx_exports() {
  local export_folder="$1"
  local snapshot_path="$2"

  python3 - "$export_folder" "$snapshot_path" <<'PY'
import json
import os
import sys

folder, snapshot_path = sys.argv[1], sys.argv[2]
snapshot = {}

try:
    names = os.listdir(folder)
except FileNotFoundError:
    names = []

for name in names:
    if not name.lower().endswith(".docx") or name.startswith("~$"):
        continue
    path = os.path.join(folder, name)
    try:
        stat = os.stat(path)
    except OSError:
        continue
    snapshot[path] = {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}

os.makedirs(os.path.dirname(snapshot_path), exist_ok=True)
with open(snapshot_path, "w", encoding="utf-8") as handle:
    json.dump(snapshot, handle)
PY
}

find_changed_marginnote_docx_export() {
  local export_folder="$1"
  local snapshot_path="$2"
  local timeout_ms="$3"

  python3 - "$export_folder" "$snapshot_path" "$timeout_ms" <<'PY'
import json
import os
import sys
import time

folder = sys.argv[1]
snapshot_path = sys.argv[2]
timeout_ms = int(sys.argv[3])
deadline = time.time() + timeout_ms / 1000

try:
    with open(snapshot_path, "r", encoding="utf-8") as handle:
        before = json.load(handle)
except FileNotFoundError:
    before = {}

while time.time() < deadline:
    candidates = []
    try:
        names = os.listdir(folder)
    except FileNotFoundError:
        names = []

    for name in names:
        if not name.lower().endswith(".docx") or name.startswith("~$"):
            continue
        path = os.path.join(folder, name)
        try:
            stat = os.stat(path)
        except OSError:
            continue
        previous = before.get(path)
        if not previous and stat.st_size > 0:
            candidates.append((stat.st_mtime_ns, path))
            continue
        if previous and (stat.st_mtime_ns != previous.get("mtime_ns") or stat.st_size != previous.get("size")) and stat.st_size > 0:
            candidates.append((stat.st_mtime_ns, path))

    if candidates:
        candidates.sort(reverse=True)
        print(candidates[0][1])
        raise SystemExit(0)

    time.sleep(0.25)

raise SystemExit(1)
PY
}

delete_changed_export() {
  local file_path="$1"
  local snapshot_path="$2"

  python3 - "$file_path" "$snapshot_path" <<'PY'
import json
import os
import sys

path = sys.argv[1]
snapshot_path = sys.argv[2]

try:
    with open(snapshot_path, "r", encoding="utf-8") as handle:
        before = json.load(handle)
except FileNotFoundError:
    before = {}

try:
    stat = os.stat(path)
except OSError:
    raise SystemExit(0)

previous = before.get(path)
if (not previous) or stat.st_mtime_ns != previous.get("mtime_ns") or stat.st_size != previous.get("size"):
    os.unlink(path)
PY
}

wait_for_file() {
  local file_path="$1"
  local timeout_ms="$2"

  python3 - "$file_path" "$timeout_ms" <<'PY'
import os
import sys
import time

path = sys.argv[1]
timeout_ms = int(sys.argv[2])
deadline = time.time() + timeout_ms / 1000

while time.time() < deadline:
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        raise SystemExit(0)
    time.sleep(0.25)

raise SystemExit(1)
PY
}

extract_marginnote_card_image_from_docx() {
  local docx_path="$1"
  local note_id="$2"
  local image_path="$3"

  python3 - "$docx_path" "$note_id" "$image_path" <<'PY'
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

docx_path, note_id, image_path = sys.argv[1], sys.argv[2].upper(), sys.argv[3]

rel_ns = "{http://schemas.openxmlformats.org/package/2006/relationships}"
with zipfile.ZipFile(docx_path) as zf:
    try:
        document = zf.read("word/document.xml").decode("utf-8", "replace")
        rels_xml = zf.read("word/_rels/document.xml.rels")
    except KeyError as exc:
        raise SystemExit(f"Invalid Word export, missing {exc}") from exc

    rels = {}
    hyperlink_rel_ids = set()
    root = ET.fromstring(rels_xml)
    for rel in root.findall(f"{rel_ns}Relationship"):
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target", "")
        if not rel_id:
            continue
        rels[rel_id] = target
        if note_id in target.upper():
            hyperlink_rel_ids.add(rel_id)

    paragraphs = re.findall(r"<w:p\b[\s\S]*?</w:p>", document)
    previous_embeds = []
    target_embed = None

    for paragraph in paragraphs:
        embeds = re.findall(r'r:embed="([^"]+)"', paragraph)
        rel_ids = re.findall(r'r:id="([^"]+)"', paragraph)
        paragraph_matches = note_id in paragraph.upper() or any(rel_id in hyperlink_rel_ids for rel_id in rel_ids)

        if paragraph_matches:
            if embeds:
                target_embed = embeds[-1]
                break
            if previous_embeds:
                target_embed = previous_embeds[-1]
                break

        if embeds:
            previous_embeds = embeds

    if not target_embed:
        note_index = document.upper().find(note_id)
        if note_index >= 0:
            before = document[:note_index]
            embeds = re.findall(r'r:embed="([^"]+)"', before)
            if embeds:
                target_embed = embeds[-1]

    if not target_embed:
        raise SystemExit(f"No image relationship found near MarginNote noteId {note_id}")

    target = rels.get(target_embed)
    if not target:
        raise SystemExit(f"Image relationship {target_embed} was not found in document relationships")

    target = target.lstrip("/")
    if not target.startswith("word/"):
        target = posixpath.normpath(posixpath.join("word", target))

    try:
        data = zf.read(target)
    except KeyError as exc:
        raise SystemExit(f"Image file {target} was not found in the Word export") from exc

os.makedirs(os.path.dirname(image_path), exist_ok=True)
with open(image_path, "wb") as handle:
    handle.write(data)
PY
}

parse_marginnote_word_outline() {
  local docx_path="$1"
  local image_dir="$2"

  python3 - "$docx_path" "$image_dir" <<'PY'
import html
import json
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

docx_path, image_dir = sys.argv[1], sys.argv[2]

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
W_VAL = "{%s}val" % NS["w"]
W_LEFT = "{%s}left" % NS["w"]
R_EMBED = "{%s}embed" % NS["r"]

def text_of(paragraph):
    return html.unescape("".join(t.text or "" for t in paragraph.findall(".//w:t", NS))).strip()

def clean_text(value):
    return re.sub(r"\s+", " ", value).replace(" >>", "").replace(">>", "").strip()

def level_of(paragraph):
    ppr = paragraph.find("w:pPr", NS)
    if ppr is None:
        return 0

    outline = ppr.find("w:outlineLvl", NS)
    if outline is not None and outline.attrib.get(W_VAL, "").isdigit():
        return int(outline.attrib[W_VAL])

    ilvl = ppr.find(".//w:ilvl", NS)
    if ilvl is not None and ilvl.attrib.get(W_VAL, "").isdigit():
        return int(ilvl.attrib[W_VAL])

    style = ppr.find("w:pStyle", NS)
    style_value = style.attrib.get(W_VAL, "") if style is not None else ""
    match = re.search(r"Heading(\d+)", style_value, re.I)
    if match:
        return max(0, int(match.group(1)) - 1)

    ind = ppr.find("w:ind", NS)
    if ind is not None and ind.attrib.get(W_LEFT, "").isdigit():
        left = int(ind.attrib[W_LEFT])
        if left >= 800:
            return 2
        if left >= 560:
            return 1
        return 0

    return 0

def hyperlink_of(paragraph):
    xml = ET.tostring(paragraph, encoding="unicode")
    match = re.search(r'HYPERLINK\s+"(marginnote[34]app://note/[0-9A-Fa-f-]+)"', xml)
    return match.group(1) if match else ""

with zipfile.ZipFile(docx_path) as zf:
    document = ET.fromstring(zf.read("word/document.xml"))
    rels_xml = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
    rels = {}
    for rel in rels_xml.findall(f"{REL_NS}Relationship"):
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target", "")
        if rel_id:
            rels[rel_id] = target

    os.makedirs(image_dir, exist_ok=True)

    items = []
    previous_item = None
    image_index = 0

    for paragraph in document.findall(".//w:p", NS):
        text = clean_text(text_of(paragraph))
        link = hyperlink_of(paragraph)
        embeds = [blip.attrib.get(R_EMBED) for blip in paragraph.findall(".//a:blip", NS) if blip.attrib.get(R_EMBED)]
        level = level_of(paragraph)

        image_paths = []
        for embed in embeds:
            target = rels.get(embed)
            if not target:
                continue
            target = target.lstrip("/")
            if not target.startswith("word/"):
                target = posixpath.normpath(posixpath.join("word", target))
            try:
                data = zf.read(target)
            except KeyError:
                continue
            ext = os.path.splitext(target)[1] or ".png"
            image_index += 1
            image_path = os.path.join(image_dir, f"card-{image_index:03d}{ext}")
            with open(image_path, "wb") as handle:
                handle.write(data)
            image_paths.append(image_path)

        if image_paths and not link and not text and previous_item is not None:
            if not previous_item.get("imagePath"):
                previous_item["imagePath"] = image_paths[0]
            else:
                previous_item.setdefault("body", []).append("")
                previous_item.setdefault("extraImagePaths", []).append(image_paths[0])
            for extra_image in image_paths[1:]:
                previous_item.setdefault("extraImagePaths", []).append(extra_image)
            continue

        if link or image_paths:
            item = {
                "level": level,
                "title": text,
                "link": link,
                "body": [],
            }
            if image_paths:
                item["imagePath"] = image_paths[0]
                for extra_image in image_paths[1:]:
                    items.append({"level": level + 1, "title": "", "link": "", "imagePath": extra_image, "body": []})
            items.append(item)
            previous_item = item
            continue

        if text and previous_item is not None:
            previous_item.setdefault("body", []).append(text)

print(json.dumps({"items": items}, ensure_ascii=False))
PY
}

click_marginnote_popover_point() {
  local source_app="$1"
  local target="$2"

  SOURCE_APP="$source_app" TARGET="$target" osascript <<'APPLESCRIPT' >/dev/null 2>&1
set sourceApp to system attribute "SOURCE_APP"
set targetName to system attribute "TARGET"

tell application sourceApp to activate
delay 0.1

tell application "System Events"
  tell process sourceApp
    set winPos to position of front window
    set winSize to size of front window
    set leftX to item 1 of winPos
    set topY to item 2 of winPos
    set widthW to item 1 of winSize
    set heightW to item 2 of winSize

    if targetName is "advanced" then
      click at {leftX + (widthW * 0.53), topY + (heightW * 0.46)}
    else if targetName is "export" then
      click at {leftX + (widthW * 0.74), topY + (heightW * 0.55)}
    else
      error "unknown target"
    end if
  end tell
end tell
APPLESCRIPT
}

click_marginnote_export_dialog_point() {
  local source_app="$1"
  local target="$2"

  SOURCE_APP="$source_app" TARGET="$target" osascript <<'APPLESCRIPT' >/dev/null 2>&1
set sourceApp to system attribute "SOURCE_APP"
set targetName to system attribute "TARGET"

tell application sourceApp to activate
delay 0.2

tell application "System Events"
  tell process sourceApp
    set winPos to position of front window
    set winSize to size of front window
    set leftX to item 1 of winPos
    set topY to item 2 of winPos
    set widthW to item 1 of winSize
    set heightW to item 2 of winSize

    if targetName is "long-image" then
      click at {leftX + (widthW * 0.52), topY + (heightW * 0.53)}
    else
      error "unknown target"
    end if
  end tell
end tell
APPLESCRIPT
}

copy_source_link() {
  local source_app copy_menu_item copy_shortcut copy_delay_ms key modifiers
  source_app="$(arg_value "--source-app" "$@")"
  copy_menu_item="$(arg_value "--copy-menu-item" "$@")"
  copy_shortcut="$(arg_value "--copy-shortcut" "$@")"
  copy_delay_ms="$(arg_value "--copy-delay-ms" "$@")"

  source_app="${source_app:-MarginNote 4}"
  copy_menu_item="${copy_menu_item:-复制卡片 URL}"
  copy_shortcut="${copy_shortcut:-cmd+shift+c}"
  copy_delay_ms="${copy_delay_ms:-700}"

  if [[ -n "$copy_menu_item" ]]; then
    if click_visible_menu_item "$source_app" "$copy_menu_item" "$copy_delay_ms"; then
      return 0
    fi
  fi

  key="${copy_shortcut##*+}"
  modifiers="${copy_shortcut%+*}"
  if [[ "$key" == "$copy_shortcut" ]]; then
    modifiers=""
  fi

  SOURCE_APP="$source_app" COPY_KEY="$key" COPY_MODIFIERS="$modifiers" COPY_DELAY_MS="$copy_delay_ms" osascript <<'APPLESCRIPT'
set sourceApp to system attribute "SOURCE_APP"
set copyKey to system attribute "COPY_KEY"
set copyModifiers to system attribute "COPY_MODIFIERS"
set copyDelayMs to (system attribute "COPY_DELAY_MS") as number

tell application sourceApp to activate
delay 0.3

set modifierList to {}
if copyModifiers contains "cmd" or copyModifiers contains "command" or copyModifiers contains "mod" then set end of modifierList to command down
if copyModifiers contains "shift" then set end of modifierList to shift down
if copyModifiers contains "option" or copyModifiers contains "alt" then set end of modifierList to option down
if copyModifiers contains "ctrl" or copyModifiers contains "control" then set end of modifierList to control down

tell application "System Events"
  if (count of modifierList) is 0 then
    keystroke copyKey
  else
    keystroke copyKey using modifierList
  end if
end tell

delay (copyDelayMs / 1000)
APPLESCRIPT
}

click_visible_menu_item() {
  local source_app="$1"
  local copy_menu_item="$2"
  local copy_delay_ms="$3"

  SOURCE_APP="$source_app" COPY_MENU_ITEM="$copy_menu_item" COPY_DELAY_MS="$copy_delay_ms" osascript <<'APPLESCRIPT' >/dev/null 2>&1
on clickMatchingElement(theElement, targetName)
  try
    set elementName to ""
    try
      set elementName to name of theElement as text
    end try

    set elementValue to ""
    try
      set elementValue to value of theElement as text
    end try

    set elementDescription to ""
    try
      set elementDescription to description of theElement as text
    end try

    if elementName contains targetName or elementValue contains targetName or elementDescription contains targetName then
      click theElement
      return true
    end if
  end try

  try
    repeat with childElement in UI elements of theElement
      if my clickMatchingElement(childElement, targetName) then return true
    end repeat
  end try

  return false
end clickMatchingElement

set sourceApp to system attribute "SOURCE_APP"
set targetName to system attribute "COPY_MENU_ITEM"
set copyDelayMs to (system attribute "COPY_DELAY_MS") as number

tell application sourceApp to activate
delay 0.2

tell application "System Events"
  tell process sourceApp
    repeat with appWindow in windows
      if my clickMatchingElement(appWindow, targetName) then
        delay (copyDelayMs / 1000)
        return
      end if
    end repeat
  end tell
end tell

error "Visible menu item not found: " & targetName
APPLESCRIPT
}

capture_auto_link() {
  copy_source_link "$@"
  capture_image
}

open_anchor() {
  local pdf_app file page enable_positioning
  pdf_app="$(arg_value "--pdf-app" "$@")"
  file="$(arg_value "--file" "$@")"
  page="$(arg_value "--page" "$@")"
  enable_positioning="$(arg_value "--enable-positioning" "$@")"

  pdf_app="${pdf_app:-PDF Expert}"
  page="${page:-1}"
  enable_positioning="${enable_positioning:-0}"

  if [[ -z "$file" || ! -f "$file" ]]; then
    echo "Source PDF does not exist: $file" >&2
    exit 5
  fi

  open -a "$pdf_app" "$file"

  if [[ "$enable_positioning" == "1" && "$page" =~ ^[0-9]+$ && "$page" -gt 1 ]]; then
    sleep 1
    PDF_APP="$pdf_app" PAGE="$page" osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
set pdfApp to system attribute "PDF_APP"
set pageNumber to system attribute "PAGE"
tell application pdfApp to activate
delay 0.2
tell application "System Events"
  keystroke "g" using {command down, option down}
  delay 0.2
  keystroke pageNumber
  key code 36
end tell
APPLESCRIPT
  fi

  printf '{}\n'
}

if [[ $# -lt 1 ]]; then
  usage
  exit 64
fi

action="$1"
shift

case "$action" in
  capture)
    capture "$@"
    ;;
  capture-image)
    capture_image "$@"
    ;;
  capture-selected-card)
    capture_selected_card "$@"
    ;;
  export-marginnote-card)
    export_marginnote_card "$@"
    ;;
  export-marginnote-word-card)
    export_marginnote_word_card "$@"
    ;;
  export-marginnote-word-outline)
    export_marginnote_word_outline "$@"
    ;;
  parse-marginnote-word-outline)
    parse_marginnote_word_outline_file "$@"
    ;;
  capture-auto-link)
    capture_auto_link "$@"
    ;;
  open)
    open_anchor "$@"
    ;;
  *)
    usage
    exit 64
    ;;
esac
