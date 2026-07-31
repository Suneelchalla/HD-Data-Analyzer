/* hd-store.js
   Shared storage for the HD dashboards.
   The launcher (index.html) saves the uploaded Excel here once; each dashboard
   (followup.html, trend.html) reads it back — including when opened in a new
   browser tab, which starts with empty memory. Uses IndexedDB because a large
   Jira export can exceed localStorage's ~5MB limit. The raw file (Blob) is
   stored as-is, so each dashboard parses it with its own existing XLSX code. */
(function () {
  var DB = "hd-tracker", STORE = "files", KEY = "current";

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
    }
  };
})();
