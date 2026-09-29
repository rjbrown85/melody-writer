/* Melody Writer audio: Salamander grand (Tone.js), synth fallback, lookahead scheduler with loop, metronome. */
(function () {
  const MW = window.MW, st = MW.st, M = MW.music;
  const HAS_TONE = typeof window.Tone !== "undefined";
  const A = MW.audio = { ready: false, failed: !HAS_TONE };
  const URLS = {};
  for (let m = 21; m <= 108; m += 3) { const nm = M.T.SHARP[m % 12] + (Math.floor(m / 12) - 1); URLS[nm] = nm.replace("#", "s") + ".mp3"; }
  A.URLS = URLS;
  let buffers = null, buses = null, live = null, run = null, preview = null;
  const toDb = v => v <= 0.001 ? -Infinity : 20 * Math.log10(v);
  const nn = m => Tone.Frequency(m, "midi").toNote();

  A.status = function () {
    const el = MW.$("#soundStatus"); if (!el) return;
    el.textContent = A.ready ? "Grand piano loaded." : A.failed ? "The grand piano didn't load, so a simple synth is playing instead. Reloading usually fixes it." : "Loading the grand piano…";
  };
  A.load = function () {
    if (!HAS_TONE) { A.status(); return; }
    try {
      buffers = new Tone.ToneAudioBuffers({ urls: URLS, baseUrl: "piano/",
        onload: () => { A.ready = true; A.status(); if (buses) live = makeInst(buses.mel); MW.render({ status: true }); },
        onerror: () => { A.failed = true; A.status(); } });
    } catch (e) { A.failed = true; A.status(); }
  };
  function ensure() {
    if (!HAS_TONE) return false;
    Tone.start().catch(() => { });
    if (!buses) {
      buses = { mel: new Tone.Volume(toDb(st.mix.mel)).toDestination(), chd: new Tone.Volume(toDb(st.mix.chd)).toDestination(),
        clk: new Tone.Volume(toDb(st.mix.clk)).toDestination() };
      live = makeInst(buses.mel);
    }
    return true;
  }
  A.ensure = ensure;
  A.setVolumes = function () {
    if (!buses) return;
    buses.mel.volume.rampTo(toDb(st.mix.mel), 0.05); buses.chd.volume.rampTo(toDb(st.mix.chd), 0.05); buses.clk.volume.rampTo(toDb(st.mix.clk), 0.05);
  };
  function makeInst(out) {
    if (A.ready && buffers) {
      try {
        const urls = {}; Object.keys(URLS).forEach(k => { urls[k] = buffers.get(k); });
        const s = new Tone.Sampler({ urls, release: 0.8 }); s.volume.value = -4; s.connect(out); return s;
      } catch (e) { }
    }
    const p = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.3, sustain: 0.25, release: 0.4 } });
    p.volume.value = -12; p.connect(out); return p;
  }
  function makeClick(out) {
    const s = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } });
    s.volume.value = -14; s.connect(out); return s;
  }
  function trash(inst, fadeAt) {
    if (!inst) return;
    try { inst.releaseAll && inst.releaseAll(); } catch (e) { }
    try { inst.volume.rampTo(-80, 0.05); } catch (e) { }
    setTimeout(() => { try { inst.dispose(); } catch (e) { } }, 1500);
  }

  /* ---------- live notes (keyboard, MIDI, audition) ---------- */
  const held = new Map();
  A.noteOn = function (m, vel) {
    if (!ensure()) return;
    if (held.has(m)) try { live.triggerRelease(nn(m), Tone.immediate()); } catch (e) { }
    held.set(m, true);
    try { live.triggerAttack(nn(m), Tone.immediate(), vel == null ? 0.8 : vel); } catch (e) { }
  };
  A.noteOff = function (m) {
    if (!held.has(m) || !live) return; held.delete(m);
    try { live.triggerRelease(nn(m), Tone.immediate() + 0.02); } catch (e) { }
  };
  A.audition = function (m, dur, vel) {
    if (!ensure()) return;
    try { live.triggerAttackRelease(nn(m), dur || 0.4, Tone.immediate(), vel || 0.75); } catch (e) { }
  };
  /* play a list of notes once (block preview, selection) */
  A.playNotes = function (notes, onEnd) {
    if (!ensure() || !notes.length) return;
    A.stopPreview();
    const spb = 60 / st.song.bpm, s0 = Math.min(...notes.map(n => n.start)), t0 = Tone.immediate() + 0.08;
    const inst = makeInst(buses.mel);
    notes.forEach(n => inst.triggerAttackRelease(nn(n.pitch), Math.max(0.05, n.dur * spb * 0.95), t0 + (n.start - s0) * spb, n.vel || 0.8));
    const end = Math.max(...notes.map(n => n.start + n.dur)) - s0;
    preview = { inst, t: setTimeout(() => { trash(inst); preview = null; onEnd && onEnd(); }, end * spb * 1000 + 900) };
  };
  A.stopPreview = function () { if (preview) { clearTimeout(preview.t); trash(preview.inst); preview = null; } };

  /* ---------- chord hits for the whole song ---------- */
  let hitsFor = null, hits = [];
  function chordHits() {
    if (hitsFor === MW.ctx && hits.patt === st.mix.pattern) return hits;
    hitsFor = MW.ctx; hits = []; hits.patt = st.mix.pattern;
    if (st.mix.pattern === "off") return hits;
    const ctx = MW.ctx, bpb = st.song.bpb;
    const step = st.mix.pattern === "quarters" ? 1 : st.mix.pattern === "halves" ? 2 : bpb;
    let center = null;
    ctx.chords.forEach((c, i) => {
      const v = M.voice(c, center); center = v.center;
      const s = ctx.starts[i], e = s + ctx.beats[i];
      const times = [s];
      for (let b = Math.ceil((s + 1e-6) / step) * step; b < e - 1e-6; b += step) if (b > s + 1e-6) times.push(b);
      times.forEach((b, k) => {
        const end = k + 1 < times.length ? times[k + 1] : e;
        hits.push({ beat: b, dur: end - b, notes: v.upper, bass: v.bass, first: k === 0 });
      });
    });
    return hits;
  }

  /* ---------- transport ---------- */
  const CHUNK = 0.25, AHEAD = 0.18;
  A.isPlaying = () => !!run;
  A.play = function (fromBeat, opts) {
    opts = opts || {};
    if (!ensure()) { MW.flash("Audio isn't available in this browser."); return; }
    A.stop(true);
    const spb = 60 / st.song.bpm;
    const now = Tone.immediate() + 0.12;
    const L = st.song.loop, loopOn = L.on && L.b > L.a;
    let from = fromBeat == null ? st.pos : fromBeat;
    if (loopOn && (from < L.a - 1e-6 || from >= L.b - 1e-6)) from = L.a;
    if (!loopOn && from >= MW.songEnd() - 1e-6) from = 0;
    const r = run = { mel: makeInst(buses.mel), chd: makeInst(buses.chd), clk: makeClick(buses.clk), record: !!opts.record,
      segs: [], b: from, t: now, endT: null, startBeat: from };
    if (opts.countIn) {
      for (let i = 0; i < st.song.bpb; i++) r.clk.triggerAttackRelease(i === 0 ? "C6" : "G5", 0.03, now + i * spb);
      r.t = now + st.song.bpb * spb;
    }
    r.segs.push({ t: r.t, beat: from, spb });
    st.pos = from; st.playing = true; st.recording = r.record;
    pump();
    r.timer = setInterval(pump, 25);
    MW.render({ transport: true });
    tick();
  };
  function pump() {
    const r = run; if (!r) return;
    const now = Tone.immediate();
    if (r.endT != null) { if (now >= r.endT) A.stop(); return; }
    const L = st.song.loop, song = st.song;
    while (r.t < now + AHEAD) {
      const spb = 60 / song.bpm;
      const lastSeg = r.segs[r.segs.length - 1];
      if (Math.abs(lastSeg.spb - spb) > 1e-9) r.segs.push({ t: r.t, beat: r.b, spb });
      const loopOn = L.on && L.b > L.a;
      const end = loopOn ? L.b : MW.songEnd();
      if (!loopOn && r.b >= end - 1e-6) { r.endT = r.t + 0.05; return; }
      const b0 = r.b, b1 = Math.min(b0 + CHUNK, end);
      // melody
      song.notes.forEach(n => {
        if (n.start >= b0 - 1e-6 && n.start < b1 - 1e-6) {
          const d = Math.min(n.dur, end - n.start);
          if (d > 0.01) r.mel.triggerAttackRelease(nn(n.pitch), Math.max(0.05, d * spb * 0.97), r.t + (n.start - b0) * spb, n.vel || 0.8);
        }
      });
      // chords
      chordHits().forEach(h => {
        if (h.beat >= b0 - 1e-6 && h.beat < b1 - 1e-6) {
          const t = r.t + (h.beat - b0) * spb, d = Math.max(0.1, Math.min(h.dur, end - h.beat) * spb * 0.98);
          r.chd.triggerAttackRelease(nn(h.bass), d, t, 0.55);
          h.notes.forEach((m, j) => r.chd.triggerAttackRelease(nn(m), d, t + j * 0.008, h.first ? 0.5 : 0.4));
        }
      });
      // click
      if (st.mix.metro) {
        for (let b = Math.ceil(b0 - 1e-6); b < b1 - 1e-6; b++) {
          const bar = Math.abs(b % song.bpb) < 1e-6;
          r.clk.triggerAttackRelease(bar ? "C6" : "G5", 0.03, r.t + (b - b0) * spb);
        }
      }
      r.t += (b1 - b0) * spb; r.b = b1;
      if (loopOn && r.b >= L.b - 1e-6) { r.b = L.a; r.segs.push({ t: r.t, beat: L.a, spb }); if (r.segs.length > 64) r.segs.splice(1, r.segs.length - 40); }
    }
  }
  const outLat = () => { try { const c = Tone.getContext().rawContext; return (c.outputLatency || 0) + (c.baseLatency || 0); } catch (e) { return 0; } };
  /* the song beat that is audible right now (negative offset during count-in) */
  A.beatNow = function () {
    const r = run; if (!r) return st.pos;
    const t = Tone.immediate() - outLat();
    let s = r.segs[0];
    for (const x of r.segs) if (x.t <= t + 1e-9) s = x;
    return s.beat + (t - s.t) / s.spb;
  };
  A.inCountIn = () => !!run && Tone.immediate() - outLat() < run.segs[0].t;
  A.stop = function (quiet) {
    const r = run; if (!r) return;
    clearInterval(r.timer); run = null;
    trash(r.mel); trash(r.chd); trash(r.clk);
    st.playing = false; st.pos = r.startBeat;
    if (st.recording && MW.input && MW.input.finishRecording) MW.input.finishRecording();
    st.recording = false;
    if (!quiet) MW.render({ transport: true, roll: true });
  };
  function tick() {
    if (!run) return;
    if (!A.inCountIn()) {
      let b = A.beatNow();
      const L = st.song.loop;
      if (L.on && b >= L.b) b = L.a + ((b - L.a) % (L.b - L.a));
      st.pos = Math.max(0, b);
    }
    MW.render({ playhead: true });
    requestAnimationFrame(tick);
  }
})();
