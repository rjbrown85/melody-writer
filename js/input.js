/* Melody Writer input: computer keys as a piano, Web MIDI keyboards, recording with quantize. */
(function () {
  const MW = window.MW, st = MW.st, M = MW.music, $ = MW.$;
  const I = MW.input = {};
  const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
  I.KEYMAP = KEYMAP;
  const held = new Map();        // pitch -> source count
  const pend = new Map();        // pitch -> {start, vel}
  const kbHeld = new Map();      // key code -> pitch
  let take = null, sustain = false; const sustained = new Set();
  let midiAccess = null;

  I.down = () => new Set(held.keys());
  I.pending = function () {
    if (!st.recording) return [];
    const now = curBeat();
    return [...pend.entries()].map(([p, v]) => ({ pitch: p, start: v.start, dur: Math.max(0.05, now - v.start) }));
  };
  function curBeat() {
    let b = MW.audio.beatNow();
    const L = st.song.loop;
    if (MW.audio.inCountIn()) return st.pos;
    if (L.on && L.b > L.a && b >= L.b) b = L.a + ((b - L.a) % (L.b - L.a));
    return Math.max(0, b);
  }
  I.press = function (p, vel) {
    if (p < 21 || p > 108) return;
    held.set(p, (held.get(p) || 0) + 1);
    sustained.delete(p);
    MW.audio.noteOn(p, vel);
    if (st.recording) pend.set(p, { start: curBeat(), vel: vel == null ? 0.8 : vel });
    MW.roll.redraw();
  };
  I.release = function (p) {
    const c = (held.get(p) || 0) - 1;
    if (c > 0) held.set(p, c); else held.delete(p);
    if (sustain) sustained.add(p); else MW.audio.noteOff(p);
    if (st.recording && pend.has(p)) closeNote(p, curBeat());
    MW.roll.redraw();
  };
  function closeNote(p, endBeat) {
    const v = pend.get(p); pend.delete(p);
    let dur = endBeat - v.start;
    const L = st.song.loop;
    if (dur <= 0.01) dur = L.on && L.b > v.start ? L.b - v.start : 0.25;
    let n = { id: MW.uid(), pitch: p, start: v.start, dur: Math.max(0.0625, dur), vel: v.vel, g: take, label: "Recorded take" };
    const q = st.input.quant;
    if (q > 0) n = M.quantize([n], q, st.input.qstr)[0];
    if (L.on && n.start >= L.b - 1e-6) n.start = L.a;
    st.song.notes.push(n);
    MW.afterChange({ roll: true, sel: true });
  }
  I.startRecording = function () { take = MW.uid("g"); pend.clear(); MW.checkpoint(); };
  I.finishRecording = function () {
    const end = curBeat();
    [...pend.keys()].forEach(p => closeNote(p, end));
    const n = st.song.notes.filter(x => x.g === take).length;
    if (n) { st.sel = new Set(st.song.notes.filter(x => x.g === take).map(x => x.id)); MW.flash(`Recorded ${n} note${n > 1 ? "s" : ""}. They're selected, so you can snap, trim, or delete them.`); }
    take = null;
    MW.afterChange({ roll: true, sel: true });
  };

  /* ---------- computer keys ---------- */
  const typing = e => { const t = e.target; return t && (t.tagName === "INPUT" && !["checkbox", "range", "button"].includes(t.type) || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); };
  I.octaveBase = () => (st.input.octave + 1) * 12;
  I.handleKeyDown = function (e) {
    if (!st.input.keys || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.code === "KeyZ" || e.code === "KeyX") {
      st.input.octave = Math.max(1, Math.min(7, st.input.octave + (e.code === "KeyX" ? 1 : -1)));
      MW.persist(); MW.render({ transport: true }); MW.flash(`Computer keys: A is now ${M.noteName(I.octaveBase())}.`);
      return true;
    }
    if (!(e.code in KEYMAP)) return false;
    if (e.repeat || kbHeld.has(e.code)) return true;
    const p = I.octaveBase() + KEYMAP[e.code];
    kbHeld.set(e.code, p); I.press(p, 0.8);
    return true;
  };
  I.handleKeyUp = function (e) {
    if (!kbHeld.has(e.code)) return false;
    const p = kbHeld.get(e.code); kbHeld.delete(e.code); I.release(p); return true;
  };
  window.addEventListener("blur", () => { [...kbHeld.values()].forEach(p => I.release(p)); kbHeld.clear(); });

  /* ---------- MIDI ---------- */
  I.midiSupported = () => typeof navigator !== "undefined" && !!navigator.requestMIDIAccess;
  I.connectMidi = function () {
    if (!I.midiSupported()) { MW.flash("This browser doesn't support MIDI keyboards. Use Chrome, Edge, or Firefox. Safari has no Web MIDI."); return; }
    navigator.requestMIDIAccess().then(acc => {
      midiAccess = acc; attach();
      acc.onstatechange = attach;
    }).catch(() => MW.flash("MIDI access was blocked. Allow it in the browser's site settings and try again."));
  };
  function attach() {
    const names = [];
    midiAccess.inputs.forEach(inp => { inp.onmidimessage = onMidi; if (inp.state !== "disconnected") names.push(inp.name); });
    I.midiNames = names;
    MW.flash(names.length ? `MIDI connected: ${names.join(", ")}.` : "MIDI is on, but no keyboard is plugged in yet.");
    MW.render({ transport: true });
  }
  function onMidi(ev) {
    const [s, a, b] = ev.data, type = s & 0xf0;
    MW.audio.ensure();
    if (type === 0x90 && b > 0) I.press(a, Math.max(0.15, b / 127));
    else if (type === 0x80 || (type === 0x90 && b === 0)) I.release(a);
    else if (type === 0xb0 && a === 64) {
      sustain = b >= 64;
      if (!sustain) { sustained.forEach(p => { if (!held.has(p)) MW.audio.noteOff(p); }); sustained.clear(); }
    }
  }
  I.midiOn = () => !!midiAccess;
})();
