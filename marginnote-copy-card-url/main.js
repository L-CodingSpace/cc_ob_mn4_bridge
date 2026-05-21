JSB.newAddon = function(mainPath) {
  var ADDON_VERSION = "0.4.0";

  var CopyCardURLAddon = JSB.defineClass("CopyCardURLAddon : JSExtension", {
    sceneWillConnect: function() {
      self.studyController = Application.sharedInstance().studyController(self.window);
      showHUD("Copy Card URL loaded");
    },

    queryAddonCommandStatus: function() {
      return {
        image: "logo_44x44.png",
        object: self,
        selector: "copyFocusedCardURL:",
        checked: false
      };
    },

    copyFocusedCardURL: function(sender) {
      var selections = findFocusedSelections();
      if (!selections.length) {
        showHUD("No focused card");
        return;
      }

      var cards = uniqueCardsFromSelections(selections);
      if (!cards.length) {
        showHUD("No card URL");
        return;
      }

      if (cards.length === 1) {
        UIPasteboard.generalPasteboard().string = cards[0].url;
        showHUD("Copied card URL");
        return;
      }

      UIPasteboard.generalPasteboard().string = JSON.stringify({
        type: "marginnote-selection",
        version: ADDON_VERSION,
        noteIds: cards.map(function(card) { return card.noteId; }),
        links: cards.map(function(card) { return card.url; })
      });
      showHUD("Copied " + cards.length + " card URLs");
    }
  }, {});

  return CopyCardURLAddon;
};

function findFocusedSelection() {
  var selections = findFocusedSelections();
  return selections.length ? selections[0] : null;
}

function findFocusedSelections() {
  var controller = getStudyController();
  if (!controller) return [];

  var notebookController = readValue(controller, "notebookController");
  if (!notebookController) return [];

  var result = [];
  var mindmapView = readValue(notebookController, "mindmapView");
  var selectedViews = readValue(mindmapView, "selViewLst");
  if (selectedViews && selectedViews.count && selectedViews.count() > 0) {
    for (var i = 0; i < selectedViews.count(); i++) {
      var selectedView = selectedViews.objectAtIndex(i);
      var note = unwrapNote(selectedView);
      if (note) result.push({ note: note, view: selectedView });
    }
    if (result.length) return result;
  }

  var candidates = [
    readValue(notebookController, "focusNote"),
    readValue(notebookController, "visibleFocusNote"),
    readValue(notebookController, "selectedNote")
  ];

  for (var j = 0; j < candidates.length; j++) {
    var candidate = unwrapNote(candidates[j]);
    if (candidate) return [{ note: candidate, view: null }];
  }

  return [];
}

function uniqueCardsFromSelections(selections) {
  var result = [];
  var seen = {};

  for (var i = 0; i < selections.length; i++) {
    var noteId = getNoteId(selections[i].note);
    if (!noteId || seen[noteId]) continue;
    seen[noteId] = true;
    result.push({
      noteId: noteId,
      url: "marginnote3app://note/" + encodeURIComponent(noteId)
    });
  }

  return result;
}

function findViewForNoteId(noteId) {
  var controller = getStudyController();
  if (!controller) return null;

  var notebookController = readValue(controller, "notebookController");
  var roots = [
    readValue(notebookController, "mindmapView"),
    readValue(notebookController, "view"),
    readValue(notebookController, "contentView"),
    readValue(controller, "view")
  ];

  for (var i = 0; i < roots.length; i++) {
    var found = findViewForNoteIdInTree(roots[i], noteId, 0);
    if (found) return found;
  }

  try {
    var appWindow = self.window;
    var contentView = readValue(appWindow, "contentView");
    var foundInWindow = findViewForNoteIdInTree(contentView, noteId, 0);
    if (foundInWindow) return foundInWindow;
  } catch (error) {}

  return null;
}

function findViewForNoteIdInTree(value, noteId, depth) {
  if (!value || depth > 12) return null;

  var note = unwrapNote(value);
  if (note && getNoteId(note) === noteId) {
    var renderable = findRenderableView(value);
    if (renderable) return renderable;
  }

  var children = childViews(value);
  for (var i = 0; i < children.length; i++) {
    var found = findViewForNoteIdInTree(children[i], noteId, depth + 1);
    if (found) return found;
  }

  return null;
}

function childViews(value) {
  var result = [];
  var childContainers = [
    readValue(value, "subviews"),
    readValue(value, "children"),
    readValue(value, "UIElements"),
    readValue(value, "uiElements")
  ];

  for (var i = 0; i < childContainers.length; i++) {
    appendCollection(result, childContainers[i]);
  }

  return result;
}

function debugSelection(selection, renderableView) {
  var parts = [];
  try {
    parts.push("noteId=" + getNoteId(selection.note));
    parts.push("selectionView=" + describeObject(selection.view));
    parts.push("renderableView=" + describeObject(renderableView));
    parts.push("note=" + describeObject(selection.note));
  } catch (error) {
    parts.push("debugError=" + error);
  }
  return parts.join("; ");
}

function describeObject(value) {
  if (!value) return "null";

  var pieces = [];
  try {
    pieces.push(String(value));
  } catch (error) {}

  var bounds = getBounds(value);
  if (bounds && bounds.size) {
    pieces.push("bounds=" + bounds.size.width + "x" + bounds.size.height);
  }

  var note = unwrapNote(value);
  if (note) pieces.push("noteId=" + getNoteId(note));

  return pieces.join(",");
}

function appendCollection(result, collection) {
  if (!collection) return;

  try {
    if (collection.count && collection.objectAtIndex) {
      var count = collection.count();
      for (var i = 0; i < count; i++) result.push(collection.objectAtIndex(i));
      return;
    }
  } catch (error) {}

  try {
    if (collection.length) {
      for (var j = 0; j < collection.length; j++) result.push(collection[j]);
    }
  } catch (nestedError) {}
}

function getStudyController() {
  if (self.studyController) return self.studyController;

  try {
    self.studyController = Application.sharedInstance().studyController(self.window);
    return self.studyController;
  } catch (error) {
    return null;
  }
}

function unwrapNote(value) {
  if (!value) return null;
  if (getNoteId(value)) return value;

  var keys = ["note", "mbnote", "bookNote", "representedObject", "data", "node", "model"];
  for (var i = 0; i < keys.length; i++) {
    var nested = readValue(value, keys[i]);
    if (nested && getNoteId(nested)) return nested;
  }

  return null;
}

function getNoteId(note) {
  if (!note) return null;

  var keys = ["noteId", "noteID", "noteid", "id"];
  for (var i = 0; i < keys.length; i++) {
    var value = readValue(note, keys[i]);
    if (value) return String(value);
  }

  return null;
}

function renderViewToTemporaryPNG(view, noteId) {
  var safeId = String(noteId).replace(/[^A-Za-z0-9_-]/g, "-");
  var path = NSTemporaryDirectory().stringByAppendingPathComponent("marginnote-card-" + safeId + ".png");

  if (renderUIKitViewToPNG(view, path)) return path;
  if (renderAppKitViewToPNG(view, path)) return path;

  return null;
}

function writePayloadToTemporaryJSON(note, noteId, sourceUrl) {
  try {
    var payload = {
      link: sourceUrl,
      noteId: noteId,
      title: firstTextValue(note, ["noteTitle", "title", "topic", "topicText", "notebookTitle"]),
      excerpt: firstTextValue(note, ["excerptText", "excerpt", "text", "summary", "notesText", "noteText", "content"]),
      comment: firstTextValue(note, ["comment", "comments", "commentText", "annotation", "annotationText"])
    };

    var json = JSON.stringify(payload);
    var safeId = String(noteId).replace(/[^A-Za-z0-9_-]/g, "-");
    var path = NSTemporaryDirectory().stringByAppendingPathComponent("marginnote-card-" + safeId + ".json");
    var nsString = NSString.stringWithString(json);
    try {
      if (nsString.writeToFile_atomically_encoding_error(path, true, 4, null)) return path;
    } catch (firstWriteError) {}

    try {
      var data = nsString.dataUsingEncoding(4);
      if (data && data.writeToFile_atomically(path, true)) return path;
    } catch (secondWriteError) {}
  } catch (error) {}

  return null;
}

function firstTextValue(object, keys) {
  for (var i = 0; i < keys.length; i++) {
    var value = readValue(object, keys[i]);
    var text = stringifyValue(value);
    if (text) return text;
  }

  return "";
}

function stringifyValue(value) {
  if (!value) return "";

  try {
    var text = String(value);
    if (text && text !== "[object Object]" && text.indexOf("[object ") !== 0) return text;
  } catch (error) {}

  try {
    if (value.count && value.objectAtIndex) {
      var parts = [];
      var count = value.count();
      for (var i = 0; i < count && i < 8; i++) {
        var part = stringifyValue(value.objectAtIndex(i));
        if (part) parts.push(part);
      }
      return parts.join(" ");
    }
  } catch (nestedError) {}

  return "";
}

function renderUIKitViewToPNG(view, path) {
  try {
    var bounds = getBounds(view);
    if (!bounds || bounds.size.width <= 0 || bounds.size.height <= 0) return null;

    UIGraphicsBeginImageContextWithOptions(bounds.size, false, 0);

    var rendered = false;
    try {
      rendered = view.drawViewHierarchyInRect_afterScreenUpdates(bounds, true);
    } catch (error) {
      rendered = false;
    }

    if (!rendered) {
      try {
        view.layer().renderInContext(UIGraphicsGetCurrentContext());
        rendered = true;
      } catch (nestedError) {
        rendered = false;
      }
    }

    var image = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();

    if (!rendered || !image) return null;

    var data = UIImagePNGRepresentation(image);
    if (!data) return null;

    if (data.writeToFile_atomically(path, true)) return path;
  } catch (error) {
    try {
      UIGraphicsEndImageContext();
    } catch (nestedError) {}
  }

  return null;
}

function renderAppKitViewToPNG(view, path) {
  try {
    var bounds = getBounds(view);
    if (!bounds || bounds.size.width <= 0 || bounds.size.height <= 0) return null;

    var rep = view.bitmapImageRepForCachingDisplayInRect(bounds);
    if (!rep) return null;

    view.cacheDisplayInRect_toBitmapImageRep(bounds, rep);
    var data = rep.representationUsingType_properties(4, NSDictionary.dictionary());
    if (!data) return null;

    if (data.writeToFile_atomically(path, true)) return path;
  } catch (error) {}

  return null;
}

function findRenderableView(value) {
  if (!value) return null;
  if (hasRenderableBounds(value)) return value;

  var keys = [
    "view",
    "cardView",
    "noteView",
    "contentView",
    "containerView",
    "superview"
  ];

  for (var i = 0; i < keys.length; i++) {
    var nested = readValue(value, keys[i]);
    if (nested && hasRenderableBounds(nested)) return nested;
  }

  return null;
}

function hasRenderableBounds(view) {
  var bounds = getBounds(view);
  return !!(bounds && bounds.size && bounds.size.width > 0 && bounds.size.height > 0);
}

function getBounds(view) {
  try {
    var bounds = readValue(view, "bounds");
    if (bounds && bounds.size) return bounds;
  } catch (error) {}

  try {
    var frame = readValue(view, "frame");
    if (frame && frame.size) return { origin: { x: 0, y: 0 }, size: frame.size };
  } catch (error) {}

  return null;
}

function openURL(urlString) {
  try {
    var url = NSURL.URLWithString(urlString);

    try {
      UIApplication.sharedApplication().openURL(url);
      return true;
    } catch (iosError) {}

    try {
      NSWorkspace.sharedWorkspace().openURL(url);
      return true;
    } catch (macError) {}
  } catch (error) {}

  return false;
}

function readValue(object, key) {
  if (!object) return null;

  try {
    var value = object[key];
    if (typeof value === "function") return value.call(object);
    return value;
  } catch (error) {
    return null;
  }
}

function showHUD(message) {
  try {
    Application.sharedInstance().showHUD(message, self.window, 2);
  } catch (error) {}
}
