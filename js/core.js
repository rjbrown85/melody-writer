/* Melody Writer core: state, storage, undo history, render bus. */
(function () {
  const MW = window.MW = window.MW || {};
  const M = MW.music;
  MW.$ = (s, r) => (r || document).querySelector(s);
  MW.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  MW.MAX_BEATS = 128;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  MW.store = store;

  let idc = 0;
  MW.uid = p => (p || "n") + Date.now().toString(36) + (idc++).toString(36);

  MW.newSong = function () {
    return { v: 1, name: "", key: 0, tonality: "major", bpm: 84, bpb: 4, voicing: "written",
      chords: ["I", "V", "vi", "IV", "I", "V", "vi", "IV"].map(n => ({ num: n, beats: 4 })), notes: [], loop: { on: true, a: 0, b: 32 } };
  };
  function validSong(s) {
    if (!s || !Array.isArray(s.chords) || !Array.isArray(s.notes)) return null;
    const base = MW.newSong();
    const out = Object.assign(base, s);
    out.chords = s.chords.filter(c => { try { M.T.parseNumeral(c.num); return c.beats > 0; } catch (e) { return false; } }).map(c => ({ num: c.num, beats: +c.beats }));
    if (!out.chords.length) out.chords = [{ num: "I", beats: 4 }];
    out.notes = s.notes.filter(n => Number.isFinite(n.pitch) && Number.isFinite(n.start) && n.dur > 0).map(n => ({
      id: n.id || MW.uid(), pitch: Math.round(n.pitch), start: +n.start, dur: +n.dur, vel: n.vel || 0.8, g: n.g == null ? null : n.g, label: n.label || null }));
    out.loop = Object.assign({ on: true, a: 0, b: 16 }, s.loop || {});
    if (!M.TONALITIES.some(t => t.id === out.tonality)) out.tonality = "major";
    if (!M.VOICINGS.some(v => v.id === out.voicing)) out.voicing = "written";
    out.key = ((+out.key % 12) + 12) % 12; out.bpm = Math.max(40, Math.min(200, +out.bpm || 84));
    return out;
  }
  MW.validSong = validSong;

  const st = MW.st = {
    song: validSong(store.get("mw.current", null)) || MW.newSong(),
    view: Object.assign({ ppb: 72, rowH: 15, lo: 36, hi: 96, snap: 0.25, tool: "select", clash: "on", follow: true,
      range: { on: false, lo: 48, hi: 69 } }, store.get("mw.view", {})),
    blockOpt: Object.assign({ root: "key", dir: "up", n: 8, rhythm: 0.25, hold: true }, store.get("mw.blockOpt", {})),
    mix: Object.assign({ mel: 0.9, chd: 0.55, clk: 0.6, pattern: "held", metro: false, countIn: true }, store.get("mw.mix", {})),
    input: Object.assign({ keys: true, octave: 4, quant: 0.25, qstr: 1 }, store.get("mw.input", {})),
    sel: new Set(), selChord: 0, armed: null, playing: false, recording: false, pos: 0, hover: null,
    lastDur: 0.5
  };
  st.view.tool = "select";

  MW.ctx = null;
  MW.refreshCtx = function () { MW.ctx = M.context(st.song); return MW.ctx; };
  MW.total = () => st.song.chords.reduce((a, c) => a + c.beats, 0);
  MW.songEnd = function () {
    const t = MW.total();
    const lastNote = st.song.notes.reduce((a, n) => Math.max(a, n.start + n.dur), 0);
    return Math.max(t, Math.ceil(lastNote / st.song.bpb) * st.song.bpb);
  };

  /* ---------- render bus ---------- */
  const subs = [];
  MW.on = fn => subs.push(fn);
  let pending = null;
  MW.render = function (what) {
    pending = Object.assign(pending || {}, what || { all: true });
    if (MW._raf) return;
    MW._raf = requestAnimationFrame(() => { MW._raf = null; const w = pending; pending = null; subs.forEach(fn => fn(w)); });
  };

  /* ---------- persistence ---------- */
  let saveT = null;
  MW.persist = function () {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      store.set("mw.current", st.song); store.set("mw.view", st.view); store.set("mw.blockOpt", st.blockOpt);
      store.set("mw.mix", st.mix); store.set("mw.input", st.input);
    }, 250);
  };

  /* ---------- undo ---------- */
  const undo = [], redo = [];
  const snap = () => JSON.stringify(st.song);
  MW.commit = function (fn, what) {
    undo.push(snap()); if (undo.length > 200) undo.shift(); redo.length = 0;
    fn();
    MW.afterChange(what);
  };
  MW.checkpoint = function () { undo.push(snap()); if (undo.length > 200) undo.shift(); redo.length = 0; };
  MW.afterChange = function (what) {
    clampLoop();
    MW.refreshCtx(); MW.persist(); MW.render(what || { all: true });
  };
  function restore(json) {
    st.song = validSong(JSON.parse(json));
    const ids = new Set(st.song.notes.map(n => n.id));
    st.sel = new Set([...st.sel].filter(id => ids.has(id)));
    st.selChord = Math.min(st.selChord, st.song.chords.length - 1);
    MW.afterChange();
  }
  MW.undo = function () { if (!undo.length) return MW.flash("Nothing to undo."); redo.push(snap()); restore(undo.pop()); };
  MW.redo = function () { if (!redo.length) return MW.flash("Nothing to redo."); undo.push(snap()); restore(redo.pop()); };
  MW.canUndo = () => undo.length > 0; MW.canRedo = () => redo.length > 0;
  MW.clearHistory = () => { undo.length = 0; redo.length = 0; };

  function clampLoop() {
    const L = st.song.loop, end = MW.songEnd();
    L.a = Math.max(0, Math.min(L.a, end - 1));
    L.b = Math.max(L.a + 1, Math.min(L.b, end));
  }
  MW.clampLoop = clampLoop;

  /* ---------- helpers ---------- */
  MW.notesSel = () => st.song.notes.filter(n => st.sel.has(n.id));
  MW.flash = function (msg) {
    const el = MW.$("#status"); if (!el) return;
    el.textContent = msg; el.classList.add("show");
    clearTimeout(MW._flashT); MW._flashT = setTimeout(() => el.classList.remove("show"), 3200);
  };
  MW.snapBeat = (b, grid) => Math.round(b / (grid || st.view.snap)) * (grid || st.view.snap);
  MW.floorBeat = (b, grid) => Math.floor(b / (grid || st.view.snap) + 1e-6) * (grid || st.view.snap);
  MW.fmtBeats = function (b) {
    const r = Math.round(b * 1000) / 1000;
    if (Math.abs(r - Math.round(r)) < 1e-3) return Math.round(r) + (Math.round(r) === 1 ? " beat" : " beats");
    const fr = { 0.25: "¼", 0.5: "½", 0.75: "¾", 0.333: "⅓", 0.667: "⅔" };
    const w = Math.floor(r), f = +(r - w).toFixed(3);
    return (w ? w : "") + (fr[f] || "." + String(f).slice(2)) + " beat" + (r > 1 ? "s" : "");
  };
  MW.download = function (name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  MW.safeName = s => (s || "melody").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 50) || "melody";
})();
