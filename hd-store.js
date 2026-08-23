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

/* ══════════════════════ HD Dashboards — soft app lock ══════════════════════
   A light deterrent for the public GitHub Pages build. This is NOT real
   security: the source is open, so anyone who reads it can find or bypass the
   password — and that's an accepted trade-off. Config is stored per-browser in
   localStorage. Everything is wrapped so a failure never blocks the app
   (fail-open). Loaded on every page via hd-store.js.
   - Hidden hotspot: bottom-left corner → Admin panel.
   - Admin: set/change password, enable/disable, auto-lock interval (min).
   - When enabled, the app locks every N minutes (default 60). */
(function(){
  var KEY="hd-applock";
  function cfg(){ try{ return JSON.parse(localStorage.getItem(KEY))||{}; }catch(e){ return {}; } }
  function save(c){ try{ localStorage.setItem(KEY, JSON.stringify(c)); }catch(e){} }
  function hash(s){ var h=5381,i=s.length; while(i){ h=(h*33)^s.charCodeAt(--i); } return (h>>>0).toString(36); }
  function mins(){ var c=cfg(); return (c.mins&&c.mins>0)? c.mins : 60; }
  function isLocked(){ var c=cfg(); if(!c.enabled||!c.hash) return false; return (Date.now()-(c.unlockAt||0)) >= mins()*60000; }
  function markUnlocked(){ var c=cfg(); c.unlockAt=Date.now(); save(c); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]; }); }

  var STY=""
    +".hdlk-ov{position:fixed;inset:0;z-index:2147483000;background:linear-gradient(135deg,#0f172a,#1f2937);display:flex;align-items:center;justify-content:center;font-family:'Inter',system-ui,-apple-system,sans-serif}"
    +".hdlk-card{background:#fff;border-radius:16px;padding:26px 28px;width:min(380px,92vw);box-shadow:0 24px 70px rgba(0,0,0,.45);text-align:center;box-sizing:border-box}"
    +".hdlk-ico{font-size:34px}"
    +".hdlk-card h3{font-size:18px;margin:8px 0 4px;color:#111827;font-weight:800}"
    +".hdlk-card p{font-size:12px;color:#6b7280;margin:0 0 14px;line-height:1.5}"
    +".hdlk-card input[type=password],.hdlk-card input[type=number]{width:100%;padding:11px 13px;border:1px solid #d1d5db;border-radius:9px;font-size:14px;margin-bottom:10px;box-sizing:border-box;font-family:inherit}"
    +".hdlk-card button{width:100%;padding:11px;border:none;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit}"
    +".hdlk-card button:hover{filter:brightness(1.06)}"
    +".hdlk-err{color:#dc2626;font-size:12px;min-height:16px;margin-bottom:4px;font-weight:600}"
    +".hdlk-lab{display:flex;align-items:center;gap:9px;font-size:14px;color:#111827;font-weight:600;margin-bottom:12px;cursor:pointer;text-align:left}"
    +".hdlk-lab input{width:16px;height:16px;margin:0}"
    +".hdlk-fl{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px;text-align:left}"
    +".hdlk-btns{display:flex;gap:8px;margin-top:6px}.hdlk-btns button{width:auto;flex:1}"
    +".hdlk-note{font-size:10.5px;color:#9ca3af;margin-top:12px;line-height:1.5;text-align:left}"
    +".hdlk-hot{position:fixed;left:0;bottom:0;width:48px;height:48px;z-index:2147482000;cursor:pointer;background:transparent}"
    +".hdlk-hot span{position:absolute;left:9px;bottom:9px;font-size:15px;line-height:1;opacity:0;transition:opacity .18s;color:#94a3b8;pointer-events:none}"
    +".hdlk-hot:hover span{opacity:.55}";
  function ensureStyle(){ if(document.getElementById("hdlk-style"))return; var s=document.createElement("style"); s.id="hdlk-style"; s.textContent=STY; (document.head||document.documentElement).appendChild(s); }
  function host(){ return document.body||document.documentElement; }
  function removeOverlay(){ var o=document.getElementById("hdlk-ov"); if(o)o.remove(); }
  function overlay(html){ removeOverlay(); ensureStyle(); var d=document.createElement("div"); d.id="hdlk-ov"; d.className="hdlk-ov"; d.innerHTML=html; host().appendChild(d); return d; }

  /* password prompt — used to unlock the app AND to gate the admin panel */
  function promptPw(opts){
    var d=overlay('<div class="hdlk-card"><div class="hdlk-ico">🔒</div><h3>'+esc(opts.title)+'</h3><p>'+esc(opts.sub||"")+'</p>'
      +'<div class="hdlk-err" id="hdlk-e"></div>'
      +'<input type="password" id="hdlk-pw" placeholder="Password" autocomplete="off">'
      +'<button id="hdlk-go">'+esc(opts.btn||"Unlock")+'</button>'
      +(opts.allowClose?'<button id="hdlk-x" style="background:#6b7280;margin-top:8px">Cancel</button>':'')+'</div>');
    var pw=d.querySelector("#hdlk-pw"), err=d.querySelector("#hdlk-e");
    function go(){ var c=cfg(); if(!c.hash || hash(pw.value)===c.hash){ removeOverlay(); opts.onok&&opts.onok(); } else { err.textContent="Incorrect password"; pw.value=""; pw.focus(); } }
    d.querySelector("#hdlk-go").onclick=go;
    pw.addEventListener("keydown",function(e){ if(e.key==="Enter") go(); });
    var x=d.querySelector("#hdlk-x"); if(x)x.onclick=removeOverlay;
    setTimeout(function(){ try{pw.focus();}catch(e){} },50);
  }

  function showAdmin(){
    var c=cfg();
    var d=overlay('<div class="hdlk-card" style="text-align:left;width:min(430px,94vw)">'
      +'<h3 style="text-align:center">🔧 App Lock — Admin</h3>'
      +'<p style="text-align:center">Soft deterrent only — the source is public, so treat this as a light lock, not real security.</p>'
      +'<label class="hdlk-lab"><input type="checkbox" id="hdlk-en" '+(c.enabled?"checked":"")+'> Enable lock</label>'
      +'<div class="hdlk-fl">Password '+(c.hash?"(set — leave blank to keep)":"(not set yet)")+'</div>'
      +'<input type="password" id="hdlk-npw" placeholder="'+(c.hash?"New password (optional)":"Set a password")+'" autocomplete="new-password">'
      +'<div class="hdlk-fl">Auto-lock after (minutes)</div>'
      +'<input type="number" id="hdlk-min" min="1" value="'+(c.mins||60)+'">'
      +'<div class="hdlk-err" id="hdlk-e"></div>'
      +'<div class="hdlk-btns"><button id="hdlk-save">Save</button><button id="hdlk-now" style="background:#b45309">Lock now</button><button id="hdlk-x" style="background:#6b7280">Close</button></div>'
      +'<div class="hdlk-note">Status: <b>'+(c.enabled?"ON":"OFF")+'</b> · locks every '+(c.mins||60)+' min. Forgot the password? Clear this site\u2019s data in your browser to reset.</div>'
    +'</div>');
    function collect(){ var cc=cfg(); var np=d.querySelector("#hdlk-npw").value; var en=d.querySelector("#hdlk-en").checked; var mn=parseInt(d.querySelector("#hdlk-min").value)||60; if(np)cc.hash=hash(np); cc.mins=mn; cc.enabled=en; if(en&&!cc.hash){ d.querySelector("#hdlk-e").textContent="Set a password before enabling."; return null; } return cc; }
    d.querySelector("#hdlk-save").onclick=function(){ var cc=collect(); if(!cc)return; if(cc.enabled)cc.unlockAt=Date.now(); save(cc); removeOverlay(); };
    d.querySelector("#hdlk-now").onclick=function(){ var np=d.querySelector("#hdlk-npw").value; var cc=cfg(); if(np)cc.hash=hash(np); if(!cc.hash){ d.querySelector("#hdlk-e").textContent="Set a password first."; return; } cc.enabled=true; cc.mins=parseInt(d.querySelector("#hdlk-min").value)||60; cc.unlockAt=0; save(cc); removeOverlay(); guard(); };
    d.querySelector("#hdlk-x").onclick=removeOverlay;
  }

  function openAdmin(){ if(isLocked()){ guard(); return; } var c=cfg(); if(c.hash){ promptPw({title:"Admin access", sub:"Enter the app password to open settings", btn:"Continue", allowClose:true, onok:showAdmin}); } else { showAdmin(); } }
  function guard(){ if(isLocked()){ promptPw({title:"HD Dashboards is locked", sub:"Enter the password to continue", btn:"Unlock", allowClose:false, onok:markUnlocked}); } }
  function hotspot(){ if(document.getElementById("hdlk-hot"))return; ensureStyle(); var b=document.createElement("div"); b.id="hdlk-hot"; b.className="hdlk-hot"; b.title="App lock (Ctrl+Shift+L)"; b.innerHTML="<span>\uD83D\uDD12</span>"; b.addEventListener("click",openAdmin); host().appendChild(b); }

  function boot(){ try{ ensureStyle(); hotspot(); guard(); setInterval(guard,30000);
    document.addEventListener("keydown",function(e){ if((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==="L"||e.key==="l")){ e.preventDefault(); openAdmin(); } });
  }catch(e){} }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
  window.HDLock={ openAdmin:openAdmin, isLocked:isLocked };
})();
