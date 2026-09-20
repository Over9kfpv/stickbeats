/* Browser-only mix builder. Catalogue links never include private recordings. */
(async function () {
  const $ = id => document.getElementById(id);
  const status = $('status'), savedState = $('saved-state');
  SB.markNav(); SB.nowbar();
  let D, V;
  try { [D, V] = await Promise.all([SB.data(), SB.voices()]); }
  catch (_) { status.textContent = 'Could not load the sound catalogue. Check your connection and reload.'; savedState.textContent = ''; return; }
  if (!D.themes.length) { status.textContent = 'No sound themes are available yet.'; return; }
  const A = MixAudio, files = D.groups.flatMap(g => g.files), ids = D.themes.map(t => t.id);
  const base = $('base'), vbase = $('vbase'), rows = $('rows');
  let pick = {}, clips = new Map(), dirty = false, saving = false, revision = 0, persistChain = Promise.resolve();
  let localProject = null;
  const explicitLink = !!(location.hash || SB.param('voice'));
  let shared = explicitLink;
  const defaultId = ids.includes('8bit-hero') ? '8bit-hero' : ids[0];
  const recommended = file => D.eventBy[file].recommendedDuration || (/^(warn_a|warn_b|lost|found|signal_warn|signal_crit|lowbat|critbat|error)$/.test(D.eventBy[file].role) ? 1.2 : 2);
  D.themes.forEach(t => base.appendChild(new Option(t.name, t.id)));
  base.value = defaultId;
  V.packed.forEach(v => vbase.appendChild(new Option(`${v.flag} ${v.name} · ${v.native} (${SB.size(v.packSize)})`, v.id)));
  files.forEach(f => { pick[f] = defaultId; });
  const voice = SB.param('voice');
  if (V.packed.some(v => v.id === voice)) vbase.value = voice;
  const hash = location.hash.slice(1);
  if (hash) {
    const values = hash.match(/^[a-z0-9]+$/) && hash.length === files.length * 2
      ? files.map((_, i) => ids[parseInt(hash.slice(i * 2, i * 2 + 2), 36)]) : [];
    if (values.length === files.length && values.every(Boolean)) files.forEach((f, i) => { pick[f] = values[i]; });
    else status.textContent = 'This mix link is invalid. Starting with the default theme.';
  }
  function validClip(c) {
    return c && c.samples instanceof Float32Array && c.samples.length > 0 && c.samples.length <= A.RATE * 35 &&
      Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start && c.end <= c.samples.length / A.RATE + .00001 &&
      c.end - c.start <= 10.00001 && c.wav instanceof Blob;
  }
  function restore(project) {
    const s = project.settings;
    if (!s || s.version !== 1) return false;
    pick = Object.fromEntries(files.map(f => [f, ids.includes(s.pick?.[f]) ? s.pick[f] : defaultId]));
    base.value = ids.includes(s.base) ? s.base : defaultId;
    vbase.value = V.packed.some(v => v.id === s.voice) ? s.voice : '';
    clips = new Map(files.filter(f => (s.customFiles || []).includes(f) && validClip(project.clips.get(f))).map(f => [f, project.clips.get(f)]));
    const missing = (s.customFiles || []).filter(f => files.includes(f) && !clips.has(f));
    if (missing.length) status.textContent = `${missing.length} saved recording(s) are missing or unreadable. Their theme sounds are used; record them again.`;
    return true;
  }
  try {
    localProject = await MixStore.load();
    if (!shared && restore(localProject)) savedState.textContent = 'Local project restored.';
    else savedState.textContent = shared ? 'Shared theme selections. Recordings here stay in this session until you save this project locally.' : 'Recordings and choices will be saved in this browser.';
  } catch (_) {
    savedState.textContent = 'Browser storage is unavailable. You can still record and download during this session.';
  }
  $('resume').hidden = !shared || !localProject?.settings;
  $('keep').hidden = !shared;
  function settings() { return { version: 1, pick: { ...pick }, base: base.value, voice: vbase.value, customFiles: [...clips.keys()] }; }
  function cleanURL() { const u = new URL(location.href); u.hash = ''; u.searchParams.delete('voice'); history.replaceState(null, '', u); }
  function shareURL() {
    const u = new URL(location.href);
    u.hash = files.map(f => ids.indexOf(pick[f]).toString(36).padStart(2, '0')).join('');
    if (vbase.value) u.searchParams.set('voice', vbase.value); else u.searchParams.delete('voice');
    return u.href;
  }
  function persist() {
    dirty = true;
    const myRevision = ++revision;
    if (shared) { savedState.textContent = 'Session only. Save this project locally or download it before leaving.'; return Promise.resolve(false); }
    const snapshot = { settings: settings(), clips: new Map(clips) };
    savedState.textContent = 'Saving locally…';
    // Serialize writes so older saves cannot replace newer takes.
    persistChain = persistChain.then(async () => {
      saving = true;
      try {
        await MixStore.save(snapshot.settings, snapshot.clips);
        localProject = snapshot;
        if (myRevision === revision) { dirty = false; savedState.textContent = 'Saved in this browser.'; $('retry-save').hidden = true; }
        return true;
      } catch (_) {
        if (myRevision === revision) {
          savedState.textContent = 'Not saved: browser storage is full or unavailable. Your previous saved project is intact. Download this mix now or retry saving.';
          $('retry-save').hidden = false;
        }
        return false;
      } finally { saving = false; }
    });
    return persistChain;
  }
  $('retry-save').onclick = persist;
  $('resume').onclick = () => {
    if (dirty && !confirm('Discard this session’s changes and resume your saved local project?')) return;
    stopAudio(); restore(localProject); shared = false; dirty = false; cleanURL();
    $('resume').hidden = $('keep').hidden = true; savedState.textContent = 'Local project restored.'; sync();
  };
  $('keep').onclick = async () => {
    if (localProject?.settings && !confirm('Replace the saved local project with this mix? Download the previous project first if you want to keep it.')) return;
    shared = false;
    if (await persist()) { cleanURL(); $('resume').hidden = $('keep').hidden = true; }
    else { shared = true; $('retry-save').hidden = true; }
  };
  const options = D.categories.map(c => {
    const themes = D.themes.filter(t => t.category === c.id);
    return themes.length ? `<optgroup label="${SB.esc(c.name)}">${themes.map(t => `<option value="${SB.esc(t.id)}">${SB.esc(t.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  rows.innerHTML = D.groups.map(g => `<tr class="group"><th colspan="4">${SB.esc(g.name)}</th></tr>` + g.files.map(f => `
    <tr data-file="${SB.esc(f)}">
      <td><button class="play" type="button" data-action="play" aria-label="Play ${SB.esc(D.eventBy[f].label)}">${SB.PLAY_SVG}</button></td>
      <td><span class="lbl">${SB.esc(D.eventBy[f].label)}</span><span class="clip-state"></span></td>
      <td class="file">${SB.esc(f)}.wav</td>
      <td class="act"><div class="mix-controls">
        <select aria-label="Theme for ${SB.esc(D.eventBy[f].label)}">${options}</select>
        <button class="btn ghost" type="button" data-action="record" aria-label="Record ${SB.esc(D.eventBy[f].label)}">Record</button>
        <button class="btn ghost" type="button" data-action="edit" hidden>Edit</button>
        <button class="btn ghost" type="button" data-action="remove" hidden>Use theme sound</button>
      </div></td>
    </tr>`).join('')).join('');
  function sync() {
    const counts = {};
    rows.querySelectorAll('tr[data-file]').forEach(row => {
      const f = row.dataset.file, c = clips.get(f);
      row.querySelector('select').value = pick[f];
      row.querySelector('.clip-state').textContent = c ? `Your recording · ${(c.end - c.start).toFixed(2)}s` : '';
      row.querySelector('[data-action=edit]').hidden = !c;
      row.querySelector('[data-action=remove]').hidden = !c;
      if (!c) counts[pick[f]] = (counts[pick[f]] || 0) + 1;
    });
    $('used').innerHTML = 'In this mix: ' + (clips.size ? `<span>Your recordings × ${clips.size}</span>` : '') +
      Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, n]) => `<span>${SB.esc(D.byId[id].name)} × ${n}</span>`).join('');
    $('share').textContent = clips.size ? 'Copy theme selections link' : 'Copy link';
  }
  sync();
  rows.onchange = e => { const row = e.target.closest('tr[data-file]'); if (!row || e.target.tagName !== 'SELECT') return; pick[row.dataset.file] = e.target.value; sync(); persist(); play(row.dataset.file); };
  rows.onclick = async e => {
    const button = e.target.closest('[data-action]'), row = button?.closest('tr[data-file]');
    if (!row) return;
    const f = row.dataset.file;
    switch (button.dataset.action) {
      case 'play': play(f, button); break;
      case 'record': openEditor(f, false); break;
      case 'edit': openEditor(f, true); break;
      case 'remove':
        if (!confirm('Remove this recording and use the selected theme sound?')) return;
        stopAudio(); clips.delete(f); sync(); await persist(); break;
    }
  };
  base.onchange = () => persist();
  vbase.onchange = () => persist();
  $('fill').onclick = () => { files.forEach(f => { pick[f] = base.value; }); sync(); persist(); };
  $('random').onclick = () => {
    D.groups.forEach(g => { const t = ids[Math.floor(Math.random() * ids.length)]; g.files.forEach(f => { pick[f] = Math.random() < .2 ? ids[Math.floor(Math.random() * ids.length)] : t; }); });
    sync(); persist();
  };
  $('share').onclick = async () => {
    const link = shareURL(), note = clips.size ? ' Recordings are private and are not included in this link.' : '';
    try { await navigator.clipboard.writeText(link); status.textContent = 'Theme selections link copied.' + note; }
    catch (_) { status.textContent = 'Copy this address: ' + link + note; }
  };
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
  }
  /** Build the mix as a JSZip (SOUNDS/<lang>/... + README); shared by download and install. */
  async function buildMix() {
    // Freeze the export even if selections change while downloads are in progress.
    const selected = { ...pick }, personal = new Map(clips), v = V.byId[vbase.value], link = shareURL();
    const lang = v ? v.lang : 'en';
    let zip = new JSZip();
    if (v) {
      zip = await SB.voiceZip(v, text => { status.textContent = text; });
      const readme = zip.file('README.txt');
      if (readme) zip.file('VOICE-README.txt', await readme.async('string'));
    }
    status.textContent = `Collecting ${files.length} sounds…`;
    // Bounded downloads keep memory/network pressure low on phones.
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < files.length) {
        const f = files[next++];
        let bytes;
        if (personal.has(f)) bytes = await personal.get(f).wav.arrayBuffer();
        else {
          const response = await fetch(`wav/${D.byId[selected[f]].clips[f]}.wav`);
          if (!response.ok) throw new Error(`${f}.wav: HTTP ${response.status}`);
          bytes = await response.arrayBuffer();
        }
        zip.file(`SOUNDS/${lang}/${f}.wav`, bytes);
      }
    }));
    zip.file('README.txt', `Stickbeats custom mix\n\n${files.map(f => `${f}.wav <- ${personal.has(f) ? 'Personal recording' : D.byId[selected[f]].name}`).join('\n')}\n\nCopy the SOUNDS folder onto the root of your EdgeTX SD card.${v ? ` Set the radio voice language to ${v.language}.` : ''}\nPersonal recordings: no license is assigned by Stickbeats.\nCatalogue theme sounds: CC0 1.0. Any bundled voice retains its original license.\nTheme selections only (personal recordings are not in the link): ${link}\nhttps://over9kfpv.github.io/stickbeats/\n`);
    return { zip, name: v ? `stickbeats-mix-${v.id}.zip` : 'stickbeats-mix.zip' };
  }
  $('download').onclick = async () => {
    $('download').disabled = true;
    try {
      const { zip, name } = await buildMix();
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      download(blob, name); status.textContent = `Downloaded ${name} (${SB.size(blob.size)}).`;
    } catch (error) { status.textContent = `Download failed: ${error.message}. Your recordings are still here; check your connection and retry.`; }
    finally { $('download').disabled = false; }
  };
  SB.wireInstall($('install'), async () => (await buildMix()).zip, status);

  // Recording/editor state is separate from saved clips until Use recording is pressed.
  const editor = $('editor'), editorStatus = $('editor-status');
  let ctx, playback = null, playbackGeneration = 0, stream = null, recorder = null, source = null, analyser = null;
  let timeout, frame, started = 0, generation = 0, editorFile = null, take = null, editorDirty = false, working = false;
  function context() { return ctx ||= new (window.AudioContext || window.webkitAudioContext)(); }
  function stopPersonalAudio() {
    playbackGeneration++;
    if (playback) {
      playback.onended = null;
      try { playback.stop(); } catch (_) {}
      playback.disconnect(); playback = null;
    }
    $('preview').dataset.playing = 'false';
    $('preview').innerHTML = '<span aria-hidden="true">▶</span> Play recording';
    $('stop-preview').disabled = true;
  }
  function stopAudio() { SB.stop(); stopPersonalAudio(); }
  SB.onPlay(s => { if (s.state === 'play') stopPersonalAudio(); });
  async function playBlob(blob, inEditor = false) {
    stopAudio();
    const my = playbackGeneration;
    if (inEditor) $('stop-preview').disabled = false;
    try {
      // Use the recorder's audio context rather than a detached media element in a modal.
      const ac = context();
      await ac.resume();
      const buffer = await ac.decodeAudioData(await blob.arrayBuffer());
      if (my !== playbackGeneration) return;
      const current = ac.createBufferSource(); current.buffer = buffer; current.connect(ac.destination);
      playback = current;
      current.onended = () => { if (playback === current) stopPersonalAudio(); };
      current.start();
      if (inEditor) {
        $('preview').dataset.playing = 'true';
        $('preview').innerHTML = '<span aria-hidden="true">↻</span> Replay recording';
        $('stop-preview').disabled = false;
      }
    } catch (error) {
      // Stop, a new preview, an edit or closing the dialog may supersede a pending decode.
      if (my !== playbackGeneration) return;
      stopPersonalAudio(); throw error;
    }
  }
  async function play(f, el) {
    try {
      stopAudio();
      if (clips.has(f)) await playBlob(clips.get(f).wav);
      else await SB.play(D.byId[pick[f]].clips[f], { text: `${D.byId[pick[f]].name} · ${D.eventBy[f].label}` }, el);
    } catch (_) { status.textContent = 'Could not play this sound. Try again or check your connection.'; }
  }
  function releaseMic() {
    clearTimeout(timeout); cancelAnimationFrame(frame);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; source?.disconnect(); analyser?.disconnect(); source = analyser = null;
    $('level').value = 0;
  }
  function abortRecording() {
    generation++;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null; releaseMic(); working = false;
  }
  function setWorking(value) {
    working = value; $('record').disabled = value; $('trim-tools').inert = value;
    $('stop-record').disabled = !recorder || recorder.state !== 'recording';
  }
  function openEditor(f, edit) {
    stopAudio(); abortRecording(); editorFile = f; editorDirty = false;
    const c = edit && clips.get(f);
    take = c ? { samples: c.samples, start: c.start, end: c.end } : null;
    $('editor-title').textContent = `${edit ? 'Edit' : 'Record'} · ${D.eventBy[f].label}`;
    $('recommendation').textContent = `Recommended: up to ${recommended(f)}s for this event. Your selection can be up to 10s. Recording stops at 30s.`;
    editorStatus.textContent = 'Press Start recording, then Stop when finished. Microphone access is requested only when you start.';
    $('elapsed').textContent = '0.0s / 30s'; $('record').textContent = take ? 'Rerecord' : 'Start recording';
    setWorking(false); editor.showModal(); updateTrim();
  }
  function closeEditor() {
    if ((editorDirty || working) && !confirm('Discard the unsaved take or trim changes? Your saved recording will be kept.')) return;
    abortRecording(); stopAudio(); take = null; editorDirty = false; editor.close();
  }
  $('close-editor').onclick = closeEditor;
  editor.addEventListener('cancel', e => { e.preventDefault(); closeEditor(); });
  function drawWaveform() {
    if (!take || !editor.open) return;
    const canvas = $('waveform'), rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * scale)); canvas.height = Math.round(130 * scale);
    const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height, samples = take.samples, duration = samples.length / A.RATE;
    const style = getComputedStyle(editor);
    g.fillStyle = style.getPropertyValue('--accent'); g.globalAlpha = .16;
    g.fillRect(take.start / duration * w, 0, (take.end - take.start) / duration * w, h); g.globalAlpha = 1;
    g.fillStyle = style.getPropertyValue('--ink');
    for (let x = 0; x < w; x += 2) {
      let peak = 0;
      for (let i = Math.floor(x / w * samples.length); i < Math.min(samples.length, Math.ceil((x + 2) / w * samples.length)); i++) peak = Math.max(peak, Math.abs(samples[i]));
      g.fillRect(x, h / 2 - Math.max(1, peak * h / 2), 1, Math.max(2, peak * h));
    }
  }
  function validSelection() { return take && Number.isFinite(take.start) && Number.isFinite(take.end) && take.start >= 0 && take.end <= take.samples.length / A.RATE + .00001 && take.end - take.start >= .01 && take.end - take.start <= 10.00001; }
  function updateTrim() {
    $('trim-tools').hidden = !take;
    if (!take) return;
    const duration = take.samples.length / A.RATE;
    for (const name of ['start', 'end']) {
      const number = $(`trim-${name}`), range = $(`${name}-range`);
      number.max = range.max = duration;
      number.value = range.value = Number.isFinite(take[name]) ? take[name] : '';
    }
    const length = take.end - take.start, valid = validSelection();
    $('selection-info').textContent = valid ? `${length.toFixed(2)}s selected.${length > recommended(editorFile) ? ' Longer than recommended for this event.' : ''}` : 'Choose a selection between 0.01 and 10 seconds, within the recording.';
    for (const id of ['preview', 'download-take', 'save-clip']) $(id).disabled = !valid;
    drawWaveform();
  }
  for (const name of ['start', 'end']) {
    for (const id of [`trim-${name}`, `${name}-range`]) $(id).oninput = e => {
      if (!take) return;
      stopAudio(); take[name] = e.target.valueAsNumber; editorDirty = true;
      // Preserve the focused number field so partially entered decimals remain editable.
      const value = e.target.value; updateTrim(); e.target.value = value;
    };
  }
  function autoTrim() {
    if (!take) return;
    const result = A.smartTrim(take.samples); take.start = result.start; take.end = result.end; editorDirty = true;
    editorStatus.textContent = result.confident ? 'Silence trimmed at the edges. Listen before saving; pauses inside the recording are preserved.' : 'No clear sound boundaries found. The full take is selected; adjust the ends or rerecord.';
    updateTrim();
  }
  $('auto-trim').onclick = () => { stopAudio(); autoTrim(); };
  $('reset-trim').onclick = () => { stopAudio(); take.start = 0; take.end = take.samples.length / A.RATE; editorDirty = true; updateTrim(); };
  const output = () => A.wav(A.render(take.samples, take.start, take.end));
  $('preview').onclick = async () => {
    // An earlier failed attempt must not remain visible when the user retries successfully.
    if (editorStatus.textContent.startsWith('Preview failed:')) editorStatus.textContent = '';
    try { await playBlob(output(), true); }
    catch (e) { editorStatus.textContent = `Preview failed: ${e.message}`; }
  };
  $('stop-preview').onclick = stopAudio;
  $('download-take').onclick = () => { try { download(output(), `${editorFile.split('/').pop()}.wav`); } catch (e) { editorStatus.textContent = e.message; } };
  $('save-clip').onclick = async () => {
    if (!validSelection() || working) return;
    try {
      const clip = { ...take, wav: output() };
      clips.set(editorFile, clip); sync(); editorDirty = false; stopAudio(); editor.close(); take = null;
      await persist();
    } catch (e) { editorStatus.textContent = `Could not use this recording: ${e.message}`; }
  };
  $('record').onclick = async () => {
    if (working) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      editorStatus.textContent = 'Recording needs a browser with microphone support, on HTTPS or localhost. Try a current Chrome, Firefox, or Safari browser.'; return;
    }
    if (editorDirty && take && !confirm('Replace this unsaved take? The previously saved recording will stay until you use the new take.')) return;
    const my = ++generation;
    stopAudio(); setWorking(true); editorStatus.textContent = 'Waiting for microphone permission…';
    try {
      const ac = context(); await ac.resume();
      if (my !== generation) return;
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (my !== generation) { media.getTracks().forEach(t => t.stop()); return; }
      stream = media;
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [];
      recorder = recording;
      recording.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recording.onerror = () => {
        if (my !== generation) return;
        abortRecording(); setWorking(false); editorStatus.textContent = 'Microphone recording failed. Your previous take is kept; try again.';
      };
      recording.onstop = async () => {
        if (my !== generation) return;
        releaseMic(); recorder = null; setWorking(true); editorStatus.textContent = 'Processing recording…';
        try {
          const samples = await A.decode(new Blob(chunks, { type: recording.mimeType }), ac);
          if (my !== generation) return;
          take = { samples, start: 0, end: samples.length / A.RATE }; editorDirty = true;
          $('record').textContent = 'Rerecord'; autoTrim();
          $('preview').scrollIntoView({ block: 'nearest' });
        } catch (_) {
          if (my === generation) editorStatus.textContent = 'This recording could not be decoded. Your previous take is kept. Try recording again or use another browser.';
        } finally { if (my === generation) { setWorking(false); updateTrim(); } }
      };
      source = ac.createMediaStreamSource(stream); analyser = ac.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
      const meter = new Float32Array(analyser.fftSize);
      started = performance.now();
      function tick() {
        if (my !== generation || !analyser) return;
        analyser.getFloatTimeDomainData(meter);
        $('level').value = Math.min(1, Math.sqrt(meter.reduce((sum, x) => sum + x * x, 0) / meter.length) * 4);
        $('elapsed').textContent = `${Math.min(30, (performance.now() - started) / 1000).toFixed(1)}s / 30s`;
        frame = requestAnimationFrame(tick);
      }
      recording.start(); setWorking(true); tick(); editorStatus.textContent = 'Recording… Press Stop recording when finished.';
      timeout = setTimeout(() => { if (recording.state === 'recording') recording.stop(); releaseMic(); }, 30000);
    } catch (e) {
      if (my !== generation) return;
      abortRecording(); setWorking(false);
      editorStatus.textContent = e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser’s site settings and try again.' : `Could not start the microphone: ${e.message}. Check that it is connected and available.`;
    }
  };
  $('stop-record').onclick = () => { if (recorder?.state === 'recording') recorder.stop(); releaseMic(); $('stop-record').disabled = true; };
  // Pasting another mix's hash into this tab must enter the same isolated flow as a fresh link.
  addEventListener('hashchange', e => {
    if ((dirty || editorDirty || working) && !confirm('Discard unsaved changes and open these shared theme selections?')) {
      history.replaceState(null, '', e.oldURL); return;
    }
    dirty = editorDirty = false; abortRecording(); stopAudio(); location.reload();
  });
  addEventListener('resize', drawWaveform);
  addEventListener('keydown', e => { if (e.key === 'Escape') stopAudio(); });
  addEventListener('beforeunload', e => { if (dirty || saving || editorDirty || working) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('pagehide', () => { abortRecording(); stopAudio(); });
})();
