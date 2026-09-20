/* "Install to radio": writes a pack straight onto the radio's SD card.
   The radio is put in USB Storage mode; the browser never talks to the radio itself, it only
   writes into the folder the user picks (File System Access API, Chromium desktop browsers). */
(() => {
  const SB = window.SB;
  const MARKERS = ["RADIO", "MODELS", "SOUNDS", "SCRIPTS", "WIDGETS", "THEMES", "LOGS", "IMAGES", "EEPROM"];

  SB.canInstall = () => typeof window.showDirectoryPicker === "function" && window.isSecureContext;

  /** zip: JSZip holding SOUNDS/... files. Resolves to a summary, or null when the picker was cancelled. */
  SB.installToRadio = async (zip, progress = () => {}) => {
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && n.startsWith("SOUNDS/"));
    if (!names.length) throw new Error("This pack has no SOUNDS files.");
    for (const n of names) if (n.split("/").some((p) => !p || p === "." || p === "..")) throw new Error(`Unsafe path: ${n}`);

    progress("Choose the radio's SD card…");
    let root;
    try { root = await window.showDirectoryPicker({ id: "edgetx-sd", mode: "readwrite" }); }
    catch (e) { if (e.name === "AbortError") { progress(""); return null; } throw e; }

    const top = new Set();
    for await (const k of root.keys()) top.add(k);
    if (!MARKERS.some((m) => top.has(m)) &&
        !confirm(`"${root.name}" doesn't look like an EdgeTX SD card (no RADIO, MODELS or SOUNDS folder). Write the sounds there anyway?`)) {
      progress(""); return null;
    }

    const dirs = new Map();
    const dirFor = async (parts, create) => {
      let d = root, key = "";
      for (const p of parts) {
        key += "/" + p;
        if (!dirs.has(key)) dirs.set(key, await d.getDirectoryHandle(p, { create }));
        d = dirs.get(key);
      }
      return d;
    };
    let existing = 0;
    for (const n of names) {
      const parts = n.split("/");
      try { const d = await dirFor(parts.slice(0, -1), false); await d.getFileHandle(parts.at(-1)); existing++; } catch (_) { /* not there yet */ }
    }
    const langs = [...new Set(names.map((n) => n.split("/")[1]))].join(", ");
    if (!confirm(`Write ${names.length} sound files to SOUNDS/${langs} on "${root.name}"?` +
        (existing ? `\n\n${existing} existing file${existing > 1 ? "s" : ""} will be replaced.` : "") +
        "\n\nDon't unplug the radio until it finishes.")) { progress(""); return null; }

    let done = 0, next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < names.length) {
        const n = names[next++], parts = n.split("/");
        const d = await dirFor(parts.slice(0, -1), true);
        const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
        try { await w.write(await zip.file(n).async("uint8array")); } finally { await w.close(); }
        progress(`Writing ${++done} / ${names.length}…`);
      }
    }));
    return { files: names.length, replaced: existing, card: root.name };
  };

  /** Wire a button: getZip() -> JSZip. Hidden where the browser can't do it. */
  SB.wireInstall = (btn, getZip, status) => {
    if (!btn) return;
    if (!SB.canInstall()) { btn.hidden = true; return; }
    const label = btn.innerHTML;
    const say = (m) => { if (status) status.textContent = m; };
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await SB.installToRadio(await getZip(say), say);
        if (r) say(`Wrote ${r.files} sounds to ${r.card}. Not finished yet: your computer may still be buffering them. Eject the drive in your file manager and wait for it to say it is safe, THEN unplug the radio or leave USB Storage mode.`);
      } catch (e) { say(`Install failed: ${e.message}`); }
      finally { btn.innerHTML = label; btn.disabled = false; }
    };
  };
})();
