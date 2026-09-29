/* Melody Writer app: transport, file menu, selection tools, shortcuts, startup. */
(function () {
  const MW = window.MW, st = MW.st, M = MW.music, $ = MW.$, $$ = MW.$$;
  const A = MW.audio;

  function fillSelects() {
    $("#keySel").innerHTML = M.T.KEYNAMES.map((k, i) => `<option value="${i}">${k}</option>`).join("");
    $("#tonSel").innerHTML = M.TONALITIES.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
    $("#voiceSel").innerHTML = M.VOICINGS.map(v => `<option value="${v.id}">${v.name}</option>`).join("");
    const notes = []; for (let p = 36; p <= 84; p++) notes.push(`<option value="${p}">${M.noteName(p)}</option>`);
    $("#rangeLo").innerHTML = notes.join(""); $("#rangeHi").innerHTML = notes.join("");
  }

  /* ---------- transport ---------- */
  function togglePlay() {
    if (st.playing) { A.stop(); return; }
    A.play(st.pos, {});
  }
  function toggleRecord() {
    if (st.recording) { A.stop(); return; }
    if (!st.input.keys && !MW.input.midiOn()) MW.flash("Turn on Computer keys or connect a MIDI keyboard to record.");
    MW.input.startRecording();
    A.play(st.pos, { record: true, countIn: st.mix.countIn });
  }
  function syncTransport() {
    const pb = $("#playBtn"); pb.classList.toggle("on", st.playing && !st.recording);
    pb.querySelector(".ico").textContent = st.playing ? "■" : "▶"; pb.querySelector(".lbl").textContent = st.playing ? "Stop" : "Play";
    const rb = $("#recBtn"); rb.classList.toggle("on", st.recording); rb.querySelector(".lbl").textContent = st.recording ? "Stop" : "Record";
    press("#loopBtn", st.song.loop.on); press("#clickBtn", st.mix.metro); press("#countBtn", st.mix.countIn); press("#followBtn", st.view.follow);
    press("#kbBtn", st.input.keys); press("#midiBtn", MW.input.midiOn());
    $("#midiBtn").title = MW.input.midiOn() ? "MIDI: " + ((MW.input.midiNames || []).join(", ") || "no keyboard found yet") : "Connect a USB MIDI keyboard";
    $("#octVal").textContent = "A = " + M.noteName(MW.input.octaveBase());
    if (document.activeElement !== $("#bpm")) $("#bpm").value = st.song.bpm;
    $("#keySel").value = st.song.key; $("#tonSel").value = st.song.tonality; $("#voiceSel").value = st.song.voicing; $("#patSel").value = st.mix.pattern;
    $("#quantSel").value = String(st.input.quant); $("#qstrSel").value = String(st.input.qstr);
    if (document.activeElement !== $("#songName")) $("#songName").value = st.song.name || "";
    $("#snapSel").value = String(st.view.snap); $("#clashSel").value = st.view.clash;
    $$("[data-tool]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tool === st.view.tool));
    $("#rangeOn").checked = st.view.range.on; $("#rangeLo").value = st.view.range.lo; $("#rangeHi").value = st.view.range.hi;
    $("#rangeTog").classList.toggle("on", st.view.range.on);
    $("#volMel").value = st.mix.mel; $("#volChd").value = st.mix.chd; $("#volClk").value = st.mix.clk;
    $("#undoBtn").disabled = !MW.canUndo(); $("#redoBtn").disabled = !MW.canRedo();
    document.body.classList.toggle("recording", st.recording);
  }
  const press = (s, on) => $(s).setAttribute("aria-pressed", on ? "true" : "false");
  function setBpm(v) { st.song.bpm = Math.max(40, Math.min(200, Math.round(+v || st.song.bpm))); MW.persist(); MW.render({ transport: true }); }

  /* ---------- selection tools ---------- */
  function syncSel() {
    const sel = MW.notesSel(), n = sel.length;
    $$("#selTools [data-act]").forEach(b => { b.disabled = !n || (b.dataset.act === "other" && n < 3) || (b.dataset.act === "keep" && n < 2); });
    if (!n) { $("#selInfo").textContent = "Nothing selected"; return; }
    const counts = {}; sel.forEach(x => { const g = MW.roll.gradeOf(x); if (g) counts[g.cls] = (counts[g.cls] || 0) + 1; });
    const labels = [...new Set(sel.map(x => x.label).filter(Boolean))];
    const bad = ["clash", "outside", "avoid"].filter(c => counts[c]).map(c => `${counts[c]} ${M.CLS_NAME[c].toLowerCase()}${counts[c] > 1 && c !== "outside" ? "s" : ""}`);
    $("#selInfo").innerHTML = `<b>${n} note${n > 1 ? "s" : ""}</b>${labels.length === 1 ? " · " + labels[0] : ""}${bad.length ? ` · <span class="warn">${bad.join(", ")}</span>` : st.view.clash !== "off" ? " · all fit" : ""}`;
    $("#keepN").max = n;
  }
  function act(a) {
    const sel = MW.notesSel(); if (!sel.length) return;
    const ids = new Set(sel.map(n => n.id));
    const replace = arr => { const byId = new Map(arr.map(n => [n.id, n])); st.song.notes = st.song.notes.map(n => byId.get(n.id) || n); };
    const pcs = MW.ctx.keyScale;
    switch (a) {
      case "delete": MW.commit(() => { st.song.notes = st.song.notes.filter(n => !ids.has(n.id)); st.sel = new Set(); }); break;
      case "ripple": MW.commit(() => { st.song.notes = M.rippleDelete(st.song.notes, ids); st.sel = new Set(); }); MW.flash("Deleted. The rest of the block slid over to close the gap."); break;
      case "close": MW.commit(() => replace(M.closeGaps(sel))); break;
      case "keep": {
        const k = Math.max(1, Math.min(sel.length, +$("#keepN").value || 3));
        const r = M.keepFirst(sel, k); const drop = new Set(r.drop.map(n => n.id));
        MW.commit(() => { st.song.notes = st.song.notes.filter(n => !drop.has(n.id)); st.sel = new Set(r.keep.map(n => n.id)); });
        break;
      }
      case "other": {
        const r = M.everyOther(sel); const drop = new Set(r.drop.map(n => n.id));
        MW.commit(() => { st.song.notes = st.song.notes.filter(n => !drop.has(n.id)); replace(r.keep); st.sel = new Set(r.keep.map(n => n.id)); });
        break;
      }
      case "slow": case "fast": {
        const out = M.stretch(sel, a === "slow" ? 2 : 0.5);
        if (Math.max(...out.map(n => n.start + n.dur)) > MW.MAX_BEATS) return MW.flash("That would run past 32 bars.");
        MW.commit(() => replace(out)); break;
      }
      case "reverse": MW.commit(() => replace(M.reversePitches(sel))); break;
      case "up": case "down": MW.commit(() => replace(sel.map(n => Object.assign({}, n, { pitch: clampP(M.stepTranspose(n.pitch, a === "up" ? 1 : -1, pcs)) })))); audSel(); break;
      case "octup": case "octdown": MW.commit(() => replace(sel.map(n => Object.assign({}, n, { pitch: clampP(n.pitch + (a === "octup" ? 12 : -12)) })))); audSel(); break;
      case "dup": duplicate(); break;
      case "play": A.playNotes(MW.notesSel()); break;
    }
  }
  const clampP = p => Math.max(st.view.lo, Math.min(st.view.hi, p));
  function audSel() { const s = M.sortNotes(MW.notesSel()); if (s.length === 1) A.audition(s[0].pitch, 0.3); }
  function duplicate() {
    const sel = M.sortNotes(MW.notesSel()); if (!sel.length) return;
    const s0 = sel[0].start, end = Math.max(...sel.map(n => n.start + n.dur));
    const off = Math.ceil((end - s0) / st.view.snap - 1e-6) * st.view.snap;
    if (end + off > MW.MAX_BEATS) return MW.flash("No room for a copy before bar 32.");
    const gmap = new Map();
    const copies = sel.map(n => { const c = Object.assign({}, n, { id: MW.uid(), start: n.start + off }); if (n.g != null) { if (!gmap.has(n.g)) gmap.set(n.g, MW.uid("g")); c.g = gmap.get(n.g); } return c; });
    MW.commit(() => { st.song.notes.push(...copies); st.sel = new Set(copies.map(c => c.id)); });
    MW.roll.scrollToBeat(copies[0].start);
  }
  function nudge(dBeat) {
    const sel = MW.notesSel(); if (!sel.length) return;
    const min = Math.min(...sel.map(n => n.start)); if (min + dBeat < -1e-6) return;
    MW.commit(() => { st.song.notes = st.song.notes.map(n => st.sel.has(n.id) ? Object.assign({}, n, { start: n.start + dBeat }) : n); }, { roll: true, sel: true });
  }

  /* ---------- songs ---------- */
  const songs = () => MW.store.get("mw.songs", {});
  function syncOpen() {
    const s = songs(), names = Object.keys(s).sort((a, b) => a.localeCompare(b));
    $("#openSel").innerHTML = `<option value="">Open…</option>` + names.map(n => `<option value="${escA(n)}">${escH(n)}</option>`).join("");
  }
  const escH = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const escA = s => escH(s).replace(/"/g, "&quot;");
  function save(asName) {
    let name = asName || st.song.name;
    if (!name) { name = (prompt("Name this song:", "My melody") || "").trim(); if (!name) return; }
    st.song.name = name;
    const s = songs(); s[name] = JSON.parse(JSON.stringify(st.song)); MW.store.set("mw.songs", s);
    MW.persist(); syncOpen(); MW.render({ transport: true }); MW.flash(`Saved “${name}” in this browser.`);
  }
  function loadSong(obj, msg) {
    const v = MW.validSong(obj); if (!v) return MW.flash("That file isn't a Melody Writer song.");
    if (st.playing) A.stop();
    st.song = v; st.sel = new Set(); st.selChord = 0; st.pos = 0; MW.clearHistory(); MW.afterChange({ all: true });
    MW.roll.scrollToBeat(0); if (msg) MW.flash(msg);
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    const t = e.target, typing = t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !["checkbox", "range", "button"].includes(t.type));
    if (typing) { if (e.key === "Escape") t.blur(); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? MW.redo() : MW.undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); MW.redo(); return; }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); return; }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); st.sel = new Set(st.song.notes.map(n => n.id)); MW.render({ sel: true, roll: true }); return; }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
    if (e.code === "Space") { e.preventDefault(); if (e.repeat) return; togglePlay(); return; }
    if (MW.input.handleKeyDown(e)) { e.preventDefault(); return; }
    if (mod || e.altKey) return;
    if (e.key === "Escape") { if (st.armed) MW.blocks.disarm(); else if (st.sel.size) { st.sel = new Set(); MW.render({ sel: true, roll: true }); } $$("details.menu[open]").forEach(d => d.open = false); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); act(e.shiftKey ? "ripple" : "delete"); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { if (!st.sel.size) return; e.preventDefault(); act(e.shiftKey ? (e.key === "ArrowUp" ? "octup" : "octdown") : (e.key === "ArrowUp" ? "up" : "down")); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { if (!st.sel.size) return; e.preventDefault(); nudge((e.key === "ArrowLeft" ? -1 : 1) * st.view.snap); return; }
    if (e.key.toLowerCase() === "r") { toggleRecord(); return; }
  }

  /* ---------- wiring ---------- */
  function wire() {
    $("#playBtn").onclick = togglePlay;
    $("#recBtn").onclick = toggleRecord;
    $("#loopBtn").onclick = () => { st.song.loop.on = !st.song.loop.on; MW.clampLoop(); MW.persist(); MW.render({ transport: true, roll: true }); };
    $("#clickBtn").onclick = () => { st.mix.metro = !st.mix.metro; MW.persist(); MW.render({ transport: true }); };
    $("#countBtn").onclick = () => { st.mix.countIn = !st.mix.countIn; MW.persist(); MW.render({ transport: true }); };
    $("#followBtn").onclick = () => { st.view.follow = !st.view.follow; MW.persist(); MW.render({ transport: true }); };
    $("#kbBtn").onclick = () => { st.input.keys = !st.input.keys; MW.persist(); MW.render({ transport: true }); MW.flash(st.input.keys ? "Computer keys play notes: A W S E D F T G Y H U J K. Z and X change the octave." : "Computer keys are off. Press R to record."); };
    $("#octDown").onclick = () => { st.input.octave = Math.max(1, st.input.octave - 1); MW.persist(); MW.render({ transport: true }); };
    $("#octUp").onclick = () => { st.input.octave = Math.min(7, st.input.octave + 1); MW.persist(); MW.render({ transport: true }); };
    $("#midiBtn").onclick = () => MW.input.connectMidi();
    $("#bpm").onchange = e => setBpm(e.target.value);
    $("#bpmDown").onclick = () => setBpm(st.song.bpm - 2);
    $("#bpmUp").onclick = () => setBpm(st.song.bpm + 2);
    $("#keySel").onchange = e => {
      const nk = +e.target.value, d = ((nk - st.song.key + 18) % 12) - 6;
      const move = st.song.notes.length && confirm(`Move your melody to the new key too? (${d > 0 ? "up" : "down"} ${Math.abs(d)} half step${Math.abs(d) === 1 ? "" : "s"})`);
      MW.commit(() => { st.song.key = nk; if (move) st.song.notes.forEach(n => { n.pitch = clampP(n.pitch + d); }); }, { all: true });
    };
    $("#tonSel").onchange = e => MW.commit(() => { st.song.tonality = e.target.value; }, { all: true });
    $("#voiceSel").onchange = e => MW.commit(() => { st.song.voicing = e.target.value; }, { all: true });
    $("#patSel").onchange = e => { st.mix.pattern = e.target.value; MW.persist(); };
    $("#quantSel").onchange = e => { st.input.quant = +e.target.value; MW.persist(); };
    $("#qstrSel").onchange = e => { st.input.qstr = +e.target.value; MW.persist(); };
    [["#volMel", "mel"], ["#volChd", "chd"], ["#volClk", "clk"]].forEach(([s, k]) => $(s).addEventListener("input", e => { st.mix[k] = +e.target.value; A.setVolumes(); MW.persist(); }));
    $$("[data-tool]").forEach(b => b.onclick = () => { st.view.tool = b.dataset.tool; if (st.armed) MW.blocks.disarm(); MW.render({ transport: true, roll: true }); });
    $("#snapSel").onchange = e => { st.view.snap = +e.target.value; MW.persist(); MW.render({ roll: true }); };
    $("#clashSel").onchange = e => { st.view.clash = e.target.value; MW.persist(); MW.render({ roll: true, sel: true }); };
    $("#zoomIn").onclick = () => MW.roll.zoom(1.25);
    $("#zoomOut").onclick = () => MW.roll.zoom(0.8);
    $("#rangeOn").onchange = e => { st.view.range.on = e.target.checked; MW.persist(); MW.render({ roll: true, transport: true }); };
    $("#rangeLo").onchange = e => { st.view.range.lo = Math.min(+e.target.value, st.view.range.hi - 1); MW.persist(); MW.render({ roll: true, transport: true }); };
    $("#rangeHi").onchange = e => { st.view.range.hi = Math.max(+e.target.value, st.view.range.lo + 1); MW.persist(); MW.render({ roll: true, transport: true }); };
    $("#undoBtn").onclick = () => MW.undo();
    $("#redoBtn").onclick = () => MW.redo();
    $("#selTools").addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) act(b.dataset.act); });
    $("#songName").addEventListener("change", e => { st.song.name = e.target.value.trim(); MW.persist(); });
    $("#saveBtn").onclick = () => save();
    $("#saveAsBtn").onclick = () => { closeMenus(); const n = (prompt("Save a copy as:", (st.song.name || "My melody") + " 2") || "").trim(); if (n) save(n); };
    $("#openSel").onchange = e => { const n = e.target.value; if (!n) return; const s = songs()[n]; e.target.value = ""; if (s) loadSong(s, `Opened “${n}”.`); };
    $("#newBtn").onclick = () => { closeMenus(); if (st.song.notes.length && !confirm("Start a new song? Unsaved changes to this one will be lost.")) return; loadSong(MW.newSong(), "New song. The Axis progression is loaded to get you started."); };
    $("#delSongBtn").onclick = () => {
      closeMenus(); const s = songs(), n = st.song.name;
      if (!n || !s[n]) return MW.flash("This song hasn't been saved, so there's nothing to delete.");
      if (!confirm(`Delete the saved copy of “${n}”?`)) return;
      delete s[n]; MW.store.set("mw.songs", s); syncOpen(); MW.flash(`Deleted “${n}” from this browser. It's still open, so you can save it again.`);
    };
    $("#exportJson").onclick = () => { closeMenus(); MW.download(MW.safeName(st.song.name) + ".melody.json", JSON.stringify(st.song, null, 1), "application/json"); };
    $("#exportMidi").onclick = () => { closeMenus(); MW.download(MW.safeName(st.song.name) + ".mid", new Blob([M.toMidi(st.song, MW.ctx)], { type: "audio/midi" })); MW.flash("MIDI saved: one track for the melody, one for the chords."); };
    $("#importJson").onclick = () => { closeMenus(); $("#importFile").click(); };
    $("#importFile").onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(t => { try { loadSong(JSON.parse(t), `Imported “${f.name}”.`); } catch (er) { MW.flash("That file couldn't be read."); } });
      e.target.value = "";
    };
    $("#helpBtn").onclick = () => { const h = $("#help"); h.hidden = !h.hidden; $("#helpBtn").setAttribute("aria-expanded", !h.hidden); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", e => { if (MW.input.handleKeyUp(e)) e.preventDefault(); });
    document.addEventListener("click", e => { $$("details.menu[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; }); });
    document.addEventListener("pointerdown", () => A.ensure(), { once: true });
  }
  const closeMenus = () => $$("details.menu[open]").forEach(d => d.open = false);

  MW.on(w => {
    if (w.all || w.transport || w.song || w.roll || w.chords || w.sel || w.status) syncTransport();
    if (w.all || w.sel || w.roll || w.song || w.chords) syncSel();
  });

  function start() {
    fillSelects();
    MW.refreshCtx();
    MW.clampLoop();
    MW.roll.init();
    MW.chords.init();
    MW.blocks.init();
    wire(); syncOpen();
    if (window.matchMedia("(max-width: 760px)").matches) $("#blocksWrap").open = false;
    const tr = $("#transport");
    new ResizeObserver(() => document.documentElement.style.setProperty("--th", tr.offsetHeight + "px")).observe(tr);
    A.load(); A.status();
    MW.render({ all: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
