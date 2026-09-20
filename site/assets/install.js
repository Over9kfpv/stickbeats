/* "Install to radio": writes a pack straight onto the radio's SD card.
   The radio is put in USB Storage mode; the browser never talks to the radio itself, it only
   writes into the folder the user picks (File System Access API, Chromium desktop browsers).

   Safety, because a browser cannot force the OS to flush to the device:
   - files that are already identical are skipped, so a retry only writes what is missing;
   - anything that would be replaced is first saved to a backup ZIP download;
   - files are written one at a time (fewest half-written files if the radio drops off USB);
   - every file is read back and compared right after it is written;
   - "Verify card" re-reads the card later (after eject and remount) and compares it byte for byte. */
(() => {
  const SB = window.SB;
  const MARKERS = ["RADIO", "MODELS", "SOUNDS", "SCRIPTS", "WIDGETS", "THEMES", "LOGS", "IMAGES", "EEPROM"];

  SB.canInstall = () => typeof window.showDirectoryPicker === "function" && window.isSecureContext;

  const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  const bytesOf = async (fileHandle) => new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());

  function soundNames(zip) {
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && n.startsWith("SOUNDS/"));
    if (!names.length) throw new Error("This pack has no SOUNDS files.");
    for (const n of names) if (n.split("/").some((p) => !p || p === "." || p === "..")) throw new Error(`Unsafe path: ${n}`);
    return names;
  }

  /** Ask for the SD card folder. Resolves to a directory handle, or null if cancelled. */
  async function pickCard(progress) {
    progress("Choose the radio's SD card…");
    let root;
    try { root = await window.showDirectoryPicker({ id: "edgetx-sd", mode: "readwrite" }); }
    catch (e) { if (e.name === "AbortError") { progress(""); return null; } throw e; }
    const top = new Set();
    for await (const k of root.keys()) top.add(k);
    if (!MARKERS.some((m) => top.has(m)) &&
        !confirm(`"${root.name}" doesn't look like an EdgeTX SD card (no RADIO, MODELS or SOUNDS folder). Use it anyway?`)) {
      progress(""); return null;
    }
    return root;
  }

  const dirCache = new WeakMap();
  async function dirFor(root, parts, create) {
    const cache = dirCache.get(root) || dirCache.set(root, new Map()).get(root);
    let d = root, key = "";
    for (const p of parts) {
      key += "/" + p;
      if (!cache.has(key)) cache.set(key, await d.getDirectoryHandle(p, { create }));
      d = cache.get(key);
    }
    return d;
  }
  async function existingFile(root, name) {
    const parts = name.split("/");
    try { return await (await dirFor(root, parts.slice(0, -1), false)).getFileHandle(parts.at(-1)); }
    catch (_) { return null; }
  }

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
  }

  /** Install a JSZip's SOUNDS/ files. Resolves to a summary, or null if cancelled. */
  SB.installToRadio = async (zip, progress = () => {}) => {
    const names = soundNames(zip);
    const root = await pickCard(progress);
    if (!root) return null;

    // Plan: skip identical files, back up the ones that would be replaced.
    progress("Checking what is already on the card…");
    const todo = [], replace = [];
    let identical = 0;
    for (const n of names) {
      const want = await zip.file(n).async("uint8array");
      const fh = await existingFile(root, n);
      if (fh) {
        let have = null;
        try { have = await bytesOf(fh); } catch (_) { /* unreadable: treat as damaged */ }
        if (have && same(have, want)) { identical++; continue; }
        replace.push({ n, have });
      }
      todo.push(n);
    }
    if (!todo.length) return { files: 0, identical, replaced: 0, card: root.name, backup: null };

    const langs = [...new Set(todo.map((n) => n.split("/")[1]))].join(", ");
    if (!confirm(`Write ${todo.length} sound file${todo.length > 1 ? "s" : ""} to SOUNDS/${langs} on "${root.name}"?` +
        (identical ? `\n${identical} already identical, skipped.` : "") +
        (replace.length ? `\n${replace.length} existing file${replace.length > 1 ? "s" : ""} will be replaced. A backup ZIP of them downloads first.` : "") +
        "\n\nKeep the radio plugged in and in USB Storage mode until it says the card is safe to remove.")) { progress(""); return null; }

    let backup = null;
    const saved = replace.filter((r) => r.have && r.have.length);
    if (saved.length) {
      progress("Saving a backup of the files being replaced…");
      const bz = new JSZip();
      for (const r of saved) bz.file(r.n, r.have);
      backup = `edgetx-sounds-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      saveBlob(await bz.generateAsync({ type: "blob" }), backup);
    }

    const guard = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    let wake = null;
    try { wake = await navigator.wakeLock?.request("screen"); } catch (_) { /* optional */ }
    try {
      let done = 0;
      for (const n of todo) {                       // one at a time: fewer half-written files if the radio drops off
        const parts = n.split("/");
        const want = await zip.file(n).async("uint8array");
        const d = await dirFor(root, parts.slice(0, -1), true);
        const fh = await d.getFileHandle(parts.at(-1), { create: true });
        const w = await fh.createWritable();
        try { await w.write(want); } finally { await w.close(); }
        let back;
        try { back = await bytesOf(fh); } catch (e) { throw new Error(`${n} could not be read back (${e.name}). The card may be damaged; see below.`); }
        if (!same(back, want)) throw new Error(`${n} does not match after writing. The card may be damaged; see below.`);
        progress(`Writing ${++done} / ${todo.length}…`, done / todo.length);
      }
    } finally {
      window.removeEventListener("beforeunload", guard);
      try { await wake?.release(); } catch (_) { /* ignore */ }
    }
    return { files: todo.length, identical, replaced: replace.length, card: root.name, backup };
  };

  /** Compare the card with the pack. Resolves to {ok, missing, different, unreadable} or null if cancelled. */
  SB.verifyRadio = async (zip, progress = () => {}) => {
    const names = soundNames(zip);
    const root = await pickCard(progress);
    if (!root) return null;
    const out = { ok: 0, missing: [], different: [], unreadable: [], card: root.name };
    let i = 0;
    for (const n of names) {
      progress(`Checking ${++i} / ${names.length}…`, i / names.length);
      const fh = await existingFile(root, n);
      if (!fh) { out.missing.push(n); continue; }
      let have;
      try { have = await bytesOf(fh); } catch (_) { out.unreadable.push(n); continue; }
      if (same(have, await zip.file(n).async("uint8array"))) out.ok++; else out.different.push(n);
    }
    return out;
  };

  const FIX = "If files are zero bytes or unreadable, the card's filesystem was interrupted mid-write: check the card on your computer (fsck.vfat on Linux, Check Disk on Windows, Disk Utility on macOS), then run the install again.";

  /** The big progress bar. state: busy (indeterminate) | run | warn (written, eject!) | ok | err */
  function makeBar(before) {
    const bar = document.createElement("div");
    bar.className = "install-bar"; bar.hidden = true;
    bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100");
    bar.innerHTML = '<div class="fill"></div><span class="label"></span><span class="pct"></span>';
    if (before) before.before(bar); else document.body.appendChild(bar);
    const fill = bar.querySelector(".fill"), label = bar.querySelector(".label"), pct = bar.querySelector(".pct");
    return (state, frac, text) => {
      if (!state) { bar.hidden = true; return; }
      bar.hidden = false; bar.dataset.state = state;
      const f = state === "busy" ? 1 : Math.max(0, Math.min(1, frac ?? 1));
      fill.style.width = `${f * 100}%`;
      label.textContent = text || ""; pct.textContent = state === "run" ? `${Math.round(f * 100)}%` : "";
      if (state === "run") bar.setAttribute("aria-valuenow", String(Math.round(f * 100))); else bar.removeAttribute("aria-valuenow");
      bar.setAttribute("aria-valuetext", text || state);
    };
  }

  /** Wire a button: getZip(say) -> JSZip. Hidden where the browser can't do it. */
  SB.wireInstall = (btn, getZip, status) => {
    if (!btn) return;
    if (!SB.canInstall()) { btn.hidden = true; return; }
    const bar = makeBar(status);
    const say = (m, f) => {
      if (status) status.textContent = m;
      if (!m) bar(null); else if (typeof f === "number") bar("run", f, m); else bar("busy", 1, m);
    };
    let zipPromise = null;
    const zip = (s) => (zipPromise = zipPromise || Promise.resolve(getZip(s)).catch((e) => { zipPromise = null; throw e; }));
    let vbtn = null;
    const showVerify = () => {
      if (vbtn) { vbtn.hidden = false; return; }
      vbtn = document.createElement("button");
      vbtn.type = "button"; vbtn.className = "btn ghost"; vbtn.textContent = "Verify card";
      vbtn.title = "After ejecting and reconnecting: re-read the card and compare it with this pack";
      btn.after(vbtn);
      vbtn.onclick = async () => {
        vbtn.disabled = true;
        try {
          const r = await SB.verifyRadio(await zip(say), say);
          if (!r) return;
          const bad = r.missing.length + r.different.length + r.unreadable.length;
          say(bad ? `Card check FAILED: ${r.ok} OK, ${r.missing.length} missing, ${r.different.length} different, ${r.unreadable.length} unreadable` +
                    ` (first: ${[...r.missing, ...r.different, ...r.unreadable][0]}). Run the install again. ${bad ? FIX : ""}`
                  : `Card verified: all ${r.ok} sound files on ${r.card} match this pack.`);
          bar(bad ? "err" : "ok", 1, bad ? "Card check failed. Run the install again" : "Verified: safe to unplug the radio");
        } catch (e) { say(`Verify failed: ${e.message}`); bar("err", 1, "Verify failed"); }
        finally { vbtn.disabled = false; }
      };
    };
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await SB.installToRadio(await zip(say), say);
        if (!r) return;
        if (!r.files) { say(`Nothing to write: all ${r.identical} files on ${r.card} already match this pack. Use Verify card to double-check.`); bar("ok", 1, "Already up to date"); showVerify(); return; }
        showVerify();
        say(`Wrote and read back ${r.files} sounds on ${r.card}${r.identical ? ` (${r.identical} already up to date)` : ""}.` +
            (r.backup ? ` Backup of replaced files saved as ${r.backup}.` : "") +
            ` NOT SAFE TO UNPLUG YET: your computer may still be buffering the data. Eject the drive in your file manager and wait until it says it is safe to remove. Then reconnect and press Verify card.`);
        bar("warn", 1, "Written. NOT SAFE TO UNPLUG YET: eject the drive first");
      } catch (e) { say(`Install failed: ${e.message}. Keep the radio connected, then run the install again: only missing or changed files are rewritten. ${FIX}`); bar("err", 1, "Install failed"); }
      finally { btn.disabled = false; }
    };
  };
})();
