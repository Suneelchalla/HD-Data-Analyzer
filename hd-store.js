/* hd-store.js
   Shared storage for the HD dashboards.
   The launcher (index.html) saves the uploaded Excel here once; each dashboard
   (followup.html, trend.html) reads it back — including when opened in a new
   browser tab, which starts with empty memory. Uses IndexedDB because a large
   Jira export can exceed localStorage's ~5MB limit. The raw file (Blob) is
   stored as-is, so each dashboard parses it with its own existing XLSX code. */
(function () {
  var DB = "hd-tracker", STORE = "files", KEY = "current", ROWS_KEY = "edited-rows", SNAP_KEY = "weekly-snapshots";

  function open() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  window.HDStore = {
    // Save the uploaded file. `file` is a File/Blob; `name` is its display name.
    saveFile: function (file, name) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, "readwrite");
          t.objectStore(STORE).put({ blob: file, name: name, savedAt: Date.now() }, KEY);
          t.oncomplete = function () { res(true); };
          t.onerror = function () { rej(t.error); };
        });
      });
    },
    // Returns { blob, name, savedAt } or null if nothing has been uploaded yet.
    loadFile: function () {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var g = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
          g.onsuccess = function () { res(g.result || null); };
          g.onerror = function () { rej(g.error); };
        });
      }).catch(function () { return null; });
    },
    // Forget the current file (used by "Change file").
    clearFile: function () {
      return open().then(function (db) {
        return new Promise(function (res) {
          var t = db.transaction(STORE, "readwrite");
          t.objectStore(STORE).delete(KEY);
          t.oncomplete = function () { res(true); };
        });
      }).catch(function () { return false; });
    },

    /* ── Edited rows ──
       The dashboards let you correct the parsed data in-app (an "Edit Data"
       tab) and recalculate without re-uploading the Excel. The corrected rows
       are stored here as an array of plain objects using the ORIGINAL Excel
       column names — the same shape XLSX.sheet_to_json produces — so both
       followup.html and trend.html can consume them directly. IndexedDB uses
       structured clone, so Date cells survive as real Dates. Whichever
       dashboard you edit in, the other picks the changes up when it next opens.
       Uploading a new file (or "Change file") clears these edits. */
    saveRows: function (rows) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, "readwrite");
          t.objectStore(STORE).put({ rows: rows, savedAt: Date.now() }, ROWS_KEY);
          t.oncomplete = function () { res(true); };
          t.onerror = function () { rej(t.error); };
        });
      });
    },
    // Returns the edited rows array, or null if no edits have been saved yet.
    loadRows: function () {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var g = db.transaction(STORE, "readonly").objectStore(STORE).get(ROWS_KEY);
          g.onsuccess = function () { res(g.result ? g.result.rows : null); };
          g.onerror = function () { rej(g.error); };
        });
      }).catch(function () { return null; });
    },
    // Discard edits (used by "Revert to original upload" and on new upload).
    clearRows: function () {
      return open().then(function (db) {
        return new Promise(function (res) {
          var t = db.transaction(STORE, "readwrite");
          t.objectStore(STORE).delete(ROWS_KEY);
          t.oncomplete = function () { res(true); };
        });
      }).catch(function () { return false; });
    },

    /* ── Weekly snapshots (for the Weekly Report) ──
       A single Jira export only knows today's open state, so the Weekly Report
       accumulates a small per-week summary each time a fresh export is opened.
       Stored as ONE object { "2026-34": {...week summary...}, ... } keyed by
       ISO week. Deliberately NOT cleared by "Change file" / new upload — the
       whole point is that history survives across weekly uploads. Reset only
       happens through the Weekly Report's own controls. */
    saveSnapshots: function (obj) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, "readwrite");
          t.objectStore(STORE).put({ snaps: obj, savedAt: Date.now() }, SNAP_KEY);
          t.oncomplete = function () { res(true); };
          t.onerror = function () { rej(t.error); };
        });
      });
    },
    // Returns the snapshots object (possibly {}), never null.
    loadSnapshots: function () {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var g = db.transaction(STORE, "readonly").objectStore(STORE).get(SNAP_KEY);
          g.onsuccess = function () { res(g.result ? g.result.snaps || {} : {}); };
          g.onerror = function () { rej(g.error); };
        });
      }).catch(function () { return {}; });
    },
    // Wipe all captured weekly history (explicit user action only).
    clearSnapshots: function () {
      return open().then(function (db) {
        return new Promise(function (res) {
          var t = db.transaction(STORE, "readwrite");
          t.objectStore(STORE).delete(SNAP_KEY);
          t.oncomplete = function () { res(true); };
        });
      }).catch(function () { return false; });
    }
  };
})();
