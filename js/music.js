/* Melody Writer music engine: chords, clash grading, block generators, note transforms, MIDI export.
   Builds on the Vocallicks theory engine (js/theory.js). Works in the browser (window.MW.music) and in Node. */
(function (root) {
  const T = (typeof module !== "undefined" && module.exports) ? require("./theory.js") : root.VL.theory;
  const D = (typeof module !== "undefined" && module.exports) ? require("./data.js") : root.VL.data;
  const M = {};
  const mod = T.mod;
  const EPS = 1e-6;
  M.T = T; M.D = D;

  /* ---------- names ---------- */
  M.NOTE_SHARP = T.SHARP;
  M.noteName = (m, flats) => (flats ? T.FLAT : T.SHARP)[mod(m)] + (Math.floor(m / 12) - 1);
  M.TONALITIES = [
    { id: "major", name: "Major" }, { id: "minor", name: "Minor" }, { id: "mixolydian", name: "Mixolydian" },
    { id: "dorian", name: "Dorian" }, { id: "blues", name: "Blues" }
  ];
  M.keyScale = (key, tonality) => T.MODES[T.TONALITY[tonality].base].map(i => mod(key + i));
  M.useFlats = (key, tonality) => T.keyUsesFlats(key, tonality);

  /* ---------- chords ---------- */
  const WRITTEN = { maj: "maj", min: "m", dom: "7", hdim: "m7b5", dim: "dim" };
  M.VOICINGS = [
    { id: "written", name: "As written" }, { id: "pop", name: "Pop (add9s)" }, { id: "rnb", name: "R&B (9ths)" },
    { id: "gospel", name: "Gospel (11ths, 13ths)" }, { id: "jazz", name: "Jazz (7ths)" }, { id: "rock", name: "Rock (triads)" }
  ];
  M.chord = function (numeral, key, tonality, voicing) {
    const num = T.parseNumeral(numeral);
    let c;
    if (!voicing || voicing === "written") {
      let q = WRITTEN[num.fam];
      if (num.fam === "maj" && num.hint === "maj7") q = "maj7";
      if (num.fam === "min" && (num.hint === "7" || num.hint === "maj7")) q = "m7";
      const r = mod(key + num.deg);
      c = { root: r, q, fam: T.family(q), num, pcs: T.pcsOf(r, q) };
    } else c = T.realize(num, key, tonality, voicing);
    c.name = T.chordName(c, numeral[0] === "b" ? true : numeral[0] === "#" ? false : M.useFlats(key, tonality));
    c.numeral = numeral;
    return c;
  };

  /* chord palette: diatonic triads and 7ths, then common borrowed and secondary chords */
  const DIA = {
    major: [["I", "Imaj7"], ["ii", "ii7"], ["iii", "iii7"], ["IV", "IVmaj7"], ["V", "V7"], ["vi", "vi7"], ["vii°", "viiø"]],
    minor: [["i", "i7"], ["ii°", "iiø"], ["bIII", "bIIImaj7"], ["iv", "iv7"], ["v", "v7"], ["bVI", "bVImaj7"], ["bVII", "bVII7"]],
    mixolydian: [["I", "I7"], ["ii", "ii7"], ["iii°", "iiiø"], ["IV", "IVmaj7"], ["v", "v7"], ["vi", "vi7"], ["bVII", "bVIImaj7"]],
    dorian: [["i", "i7"], ["ii", "ii7"], ["bIII", "bIIImaj7"], ["IV", "IV7"], ["v", "v7"], ["vi°", "viø"], ["bVII", "bVIImaj7"]],
    blues: [["I", "I7"], ["IV", "IV7"], ["V", "V7"], ["i", "i7"], ["bIII", "bIIImaj7"], ["iv", "iv7"], ["bVII", "bVII7"]]
  };
  const BORROW = ["I", "i", "IV", "iv", "V", "V7", "bII", "bIII", "bVI", "bVII", "II", "II7", "III", "III7", "VI7", "I7", "IV7", "ii", "iii", "vi"];
  M.palette = function (tonality) {
    const dia = DIA[tonality] || DIA.major;
    const have = new Set(dia.flat());
    const other = BORROW.filter(n => !have.has(n));
    return { diatonic: dia, other };
  };
  /* toggle a numeral between its triad and its 7th version */
  M.seventh = function (numeral) {
    const m = /^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(maj7|7|ø|°)?$/.exec(numeral);
    if (!m) return numeral;
    const base = (m[1] || "") + m[2], hint = m[3] || "", upper = m[2] === m[2].toUpperCase();
    if (hint === "maj7" || hint === "7") return base;
    if (hint === "ø") return base + "°";
    if (hint === "°") return base + "ø";
    return base + (upper ? "maj7" : "7");
  };
  M.dom7 = numeral => { const m = /^(b|#)?(VII|VI|V|IV|III|II|I)(maj7|7)?$/.exec(numeral); return m ? (m[1] || "") + m[2] + "7" : numeral; };

  /* ---------- song context ---------- */
  M.context = function (song) {
    const key = song.key, ton = song.tonality;
    const chords = song.chords.map(c => M.chord(c.num, key, ton, song.voicing));
    const starts = []; let acc = 0; song.chords.forEach(c => { starts.push(acc); acc += c.beats; });
    const n = chords.length;
    const infos = chords.map((c, i) => T.chordScale(c, chords[(i + 1) % n], ton, key));
    const keyScale = M.keyScale(key, ton);
    return { key, tonality: ton, chords, starts, beats: song.chords.map(c => c.beats), total: acc, infos, keyScale,
      keyHome: T.keyHome(ton, key), flats: M.useFlats(key, ton), bpb: song.bpb || 4 };
  };
  M.chordAt = function (ctx, beat) {
    if (!ctx.chords.length) return -1;
    let i = 0; for (let k = 0; k < ctx.starts.length; k++) if (ctx.starts[k] <= beat + EPS) i = k;
    return i;
  };

  /* ---------- clash grading ---------- */
  M.SEV = { chord: 0, scale: 1, blue: 1, passing: 2, avoid: 3, outside: 3, clash: 4 };
  M.CLS_NAME = { chord: "Chord tone", scale: "Scale tone", blue: "Blue note", passing: "Passing tone", avoid: "Avoid note", outside: "Outside the chord's scale", clash: "Clash" };
  function relName(pc, c, ctx) { return T.EXT[mod(pc - c.root)]; }
  function blueSet(ctx, c) {
    const k = ctx.key, s = new Set([mod(k + 3), mod(k + 6), mod(k + 10)]);
    if (c.fam === "dom") s.add(mod(c.root + 3));
    return s;
  }
  /* grade one pitch sounding over chord i. pos: {onset (beat), dur (beats inside this chord), entering (held into a new chord)} */
  M.gradeAt = function (ctx, i, midi, pos, strict) {
    const c = ctx.chords[i], info = ctx.infos[i], pc = mod(midi);
    const inBar = mod(pos.onset, ctx.bpb);
    const onBeat = Math.abs(pos.onset - Math.round(pos.onset)) < EPS;
    const strongBeat = onBeat && (Math.abs(inBar) < EPS || (ctx.bpb === 4 && Math.abs(inBar - 2) < EPS));
    const held = pos.dur >= 0.5 - EPS;
    const strong = pos.entering || (onBeat && held) || pos.dur >= 1 - EPS || (strongBeat && pos.dur >= 0.25 - EPS);
    const weakPassing = !pos.entering && (pos.dur <= 1 / 3 + EPS || (pos.dur <= 0.5 + EPS && !onBeat));
    const nearTone = c.pcs.find(t => Math.abs(mod(pc - t + 6) - 6) === 1);
    const deg = relName(pc, c, ctx);
    const out = (cls, why) => ({ cls, sev: M.SEV[cls], chord: i, deg, why });
    const nm = x => T.spell(x, ctx.flats);
    if (c.pcs.includes(pc)) return out("chord", `${nm(pc)} is the ${deg === "R" ? "root" : deg} of ${c.name}.`);
    if (strict) {
      if (!ctx.keyScale.includes(pc)) return out("clash", `${nm(pc)} is outside the key.`);
      if (info.avoid.some(a => a.pc === pc) && strong) return out("avoid", `${nm(pc)} sits a half step above ${nm(nearTone)} in ${c.name}.`);
      return out("scale", `${nm(pc)} is in the key (the ${deg} over ${c.name}).`);
    }
    if (info.modePcs.includes(pc)) {
      if (info.avoid.some(a => a.pc === pc)) {
        const tone = mod(pc - 1);
        return strong ? out("avoid", `${nm(pc)} sits a half step above ${nm(tone)} in ${c.name}. Fine when it moves on, harsh when held.`)
          : out("passing", `${nm(pc)} rubs against ${nm(tone)} in ${c.name}, but it passes quickly.`);
      }
      return out("scale", `${nm(pc)} is the ${deg} over ${c.name}, in its scale.`);
    }
    const bluesy = ctx.tonality === "blues" || ctx.tonality === "mixolydian" || c.fam === "dom";
    if (blueSet(ctx, c).has(pc) && (bluesy || !held || pos.dur < 1 - EPS) && !(nearTone !== undefined && strong && !bluesy))
      return out("blue", `${nm(pc)} is a blue note, a bluesy rub that singers use on purpose.`);
    if (weakPassing) return out("passing", `${nm(pc)} is outside ${c.name}, but it's short and off the beat, so it passes.`);
    if (nearTone !== undefined) return out("clash", `${nm(pc)} grinds a half step against ${nm(nearTone)} in ${c.name}.`);
    return out("outside", `${nm(pc)} is outside the scale of ${c.name}.`);
  };
  /* grade a note over every chord it sounds across (tails under half a beat are ignored) */
  M.grade = function (ctx, note, strict) {
    if (!ctx.chords.length) return null;
    const s = note.start, e = note.start + note.dur;
    let worst = null;
    for (let i = 0; i < ctx.chords.length; i++) {
      const cs = ctx.starts[i], ce = cs + ctx.beats[i];
      const a = Math.max(s, cs), b = Math.min(e, ce);
      if (b - a <= EPS) continue;
      const first = s >= cs - EPS && s < ce - EPS;
      if (!first && b - a < 0.5 - EPS) continue;
      const g = M.gradeAt(ctx, i, note.pitch, { onset: first ? s : cs, dur: b - a, entering: !first }, strict);
      if (!worst || g.sev > worst.sev) worst = g;
    }
    if (!worst && s >= ctx.total - EPS) return null;
    return worst;
  };
  /* what each row means under chord i: 'chord' | 'scale' | 'avoid' | 'out' */
  M.rowKinds = function (ctx, i, strict) {
    const c = ctx.chords[i], info = ctx.infos[i], k = [];
    for (let pc = 0; pc < 12; pc++) {
      if (c.pcs.includes(pc)) k.push("chord");
      else if (strict ? !ctx.keyScale.includes(pc) : !info.modePcs.includes(pc)) k.push("out");
      else if (info.avoid.some(a => a.pc === pc)) k.push("avoid");
      else k.push("scale");
    }
    return k;
  };

  /* ---------- blocks ---------- */
  const SC = { major: T.MODES.ionian, minor: T.MODES.aeolian, majpent: [0, 2, 4, 7, 9], minpent: T.MINPENT, blues: T.BLUES,
    harmminor: [0, 2, 3, 5, 7, 8, 11] };
  const q = 0.25;
  M.BLOCKS = [
    { id: "s-major", cat: "Scales", name: "Major scale", kind: "shape", pcsType: "major", majorType: true, n: 8, c: "var(--yellow)" },
    { id: "s-minor", cat: "Scales", name: "Natural minor scale", kind: "shape", pcsType: "minor", majorType: false, n: 8, c: "var(--blue)" },
    { id: "s-majpent", cat: "Scales", name: "Major pentatonic", kind: "shape", pcsType: "majpent", majorType: true, n: 6, c: "var(--orange)" },
    { id: "s-minpent", cat: "Scales", name: "Minor pentatonic", kind: "shape", pcsType: "minpent", majorType: false, n: 6, c: "var(--pink)" },
    { id: "s-blues", cat: "Scales", name: "Blues scale", kind: "shape", pcsType: "blues", majorType: false, n: 7, c: "var(--green)" },
    { id: "a-maj", cat: "Arpeggios", name: "Major arpeggio", kind: "shape", arp: [0, 4, 7], majorType: true, n: 4, c: "var(--yellow)" },
    { id: "a-min", cat: "Arpeggios", name: "Minor arpeggio", kind: "shape", arp: [0, 3, 7], majorType: false, n: 4, c: "var(--blue)" },
    { id: "a-maj7", cat: "Arpeggios", name: "Major 7th arpeggio", kind: "shape", arp: [0, 4, 7, 11], majorType: true, n: 5, c: "var(--orange)" },
    { id: "a-m7", cat: "Arpeggios", name: "Minor 7th arpeggio", kind: "shape", arp: [0, 3, 7, 10], majorType: false, n: 5, c: "var(--pink)" },
    { id: "a-7", cat: "Arpeggios", name: "Dominant 7th arpeggio", kind: "shape", arp: [0, 4, 7, 10], majorType: true, dom: true, n: 5, c: "var(--green)" },
    { id: "a-chord", cat: "Arpeggios", name: "Chord tones (follows the chord)", kind: "shape", chordTones: true, n: 4, c: "var(--ink)", on: "#fff" }
  ];
  // the five Crystal Cherelle blocks from Vocallicks (minor pentatonic shapes)
  D.ORDER.forEach(id => {
    const b = D.SETS.minor.blocks[id], meta = D.BLOCKS[id];
    M.BLOCKS.push({ id: "v-" + id, cat: "Vocallicks blocks", name: meta.name, kind: "pent", steps: b.n, beats: b.b, vel: b.v, c: meta.c, on: meta.on, fixed: true });
  });
  D.VOCAB.forEach(v => {
    const cat = v.cat === "run" ? "Vocallicks runs" : "Vocallicks licks";
    M.BLOCKS.push(Object.assign({ cat, fixed: true }, v, { id: "v-" + v.id }));
  });
  M.block = id => M.BLOCKS.find(b => b.id === id);
  M.RHYTHMS = [{ v: 0.25, name: "16ths" }, { v: 1 / 3, name: "8th triplets" }, { v: 0.5, name: "8ths" }, { v: 1, name: "Quarters" }];
  M.DIRS = [{ v: "up", name: "Up" }, { v: "down", name: "Down" }, { v: "updown", name: "Up and back" }, { v: "downup", name: "Down and back" }];
  M.ROOTS = [{ v: "key", name: "The key" }, { v: "chord", name: "The chord under it" }, { v: "drop", name: "The note I click" }];

  /* the root a block is built on */
  function relRoot(ctx, majorType) {
    const k = ctx.key, t = ctx.tonality;
    if (t === "blues") return k;
    const minorish = t === "minor" || t === "dorian";
    if (majorType && minorish) return mod(k + (t === "minor" ? 3 : 10));
    if (!majorType && !minorish) return mod(k + (t === "mixolydian" ? 2 : 9));
    return k;
  }
  M.ladder = (pcs, lo = 21, hi = 108) => T.ladder(pcs, lo, hi);
  function snapIndex(lad, pitch) {
    let bi = 0, bd = 1e9;
    lad.forEach((m, i) => { const d = Math.abs(m - pitch) + (m > pitch ? 0.1 : 0); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }
  /* returns {pcs, rootPc, label} for a block at a drop point */
  M.blockPcs = function (blk, opt, ctx, beat, pitch) {
    const ci = M.chordAt(ctx, beat), ch = ci >= 0 ? ctx.chords[ci] : null, info = ci >= 0 ? ctx.infos[ci] : null;
    const rootMode = opt.root || "key";
    const nm = pc => T.spell(pc, ctx.flats);
    if (blk.chordTones) {
      if (!ch) return { pcs: [mod(pitch)], rootPc: mod(pitch), label: "one note" };
      return { pcs: ch.pcs.slice(), rootPc: ch.root, label: ch.name + " chord tones" };
    }
    if (blk.kind === "shape") {
      const iv = blk.arp || SC[blk.pcsType];
      let r;
      if (rootMode === "drop") r = mod(pitch);
      else if (rootMode === "chord" && ch) r = ch.root;
      else r = blk.dom ? mod(ctx.key + (ctx.tonality === "mixolydian" || ctx.tonality === "blues" ? 0 : 7)) : relRoot(ctx, blk.majorType);
      return { pcs: iv.map(i => mod(r + i)), rootPc: r, label: nm(r) + " " + blk.name.toLowerCase() };
    }
    if (blk.kind === "pent") {
      if (rootMode === "drop") return { pcs: T.MINPENT.map(i => mod(pitch + i)), rootPc: mod(pitch), label: nm(pitch) + " minor pentatonic" };
      if (rootMode === "chord" && info) { const h = T.pickHome(info, "sweet"); return { pcs: h.pcs, rootPc: h.minorRoot, label: nm(h.minorRoot) + " minor pentatonic, which fits " + ch.name }; }
      const h = ctx.keyHome; return { pcs: h.pcs, rootPc: h.minorRoot, label: nm(h.minorRoot) + " minor pentatonic, which fits the key" };
    }
    if (blk.kind === "scale") {
      if (rootMode === "drop") { const iv = blk.ctx === "major" ? T.MODES.ionian : T.MODES.aeolian; return { pcs: iv.map(i => mod(pitch + i)), rootPc: mod(pitch), label: nm(pitch) + (blk.ctx === "major" ? " major" : " natural minor") }; }
      if (rootMode === "chord" && info) return { pcs: info.modePcs, rootPc: ch.root, label: nm(ch.root) + " " + info.modeName };
      return { pcs: ctx.keyScale, rootPc: ctx.key, label: "the key's scale" };
    }
    if (blk.kind === "semi") {
      let r;
      if (rootMode === "drop") r = mod(pitch - blk.semis[0]);
      else if (rootMode === "chord" && ch) r = ch.root;
      else r = relRoot(ctx, blk.ctx === "major");
      return { pcs: blk.semis.map(s => mod(r + s)), rootPc: r, label: "on " + nm(r) };
    }
    if (blk.kind === "encl") return { pcs: ch ? ch.pcs : [mod(pitch)], rootPc: ch ? ch.root : mod(pitch), label: "lands on a chord tone" };
    return { pcs: ctx.keyScale, rootPc: ctx.key, label: "" };
  };
  function shapeIdx(n, dir) {
    const up = []; for (let i = 0; i < n; i++) up.push(i);
    if (dir === "down") return up.map(i => -i);
    if (dir === "updown") return up.concat(up.slice(0, -1).reverse());
    if (dir === "downup") return up.map(i => -i).concat(up.slice(0, -1).reverse().map(i => -i));
    return up;
  }
  /* generate notes for a block dropped at (beat, pitch). opt: {root, dir, n, rhythm, hold} */
  M.generate = function (blk, opt, ctx, beat, pitch) {
    opt = opt || {};
    const src = M.blockPcs(blk, opt, ctx, beat, pitch);
    let pitches, beats, vels;
    if (blk.kind === "shape") {
      const n = Math.max(2, Math.min(15, opt.n || blk.n));
      const idx = shapeIdx(n, opt.dir || "up");
      const lad = M.ladder(src.pcs);
      const j = snapIndex(lad, pitch);
      pitches = idx.map(i => lad[Math.max(0, Math.min(lad.length - 1, j + i))]);
      const r = opt.rhythm || 0.5;
      beats = pitches.map(() => r);
      if (opt.hold !== false) beats[beats.length - 1] = Math.max(1, r * 2);
      vels = pitches.map((_, i) => i === 0 ? 0.86 : 0.76);
    } else if (blk.kind === "pent" || blk.kind === "scale") {
      const lad = M.ladder(src.pcs);
      const j = snapIndex(lad, pitch), s0 = blk.steps[0];
      pitches = blk.steps.map(s => {
        if (Array.isArray(s)) return lad[Math.max(0, Math.min(lad.length - 1, j + s[0] - (Array.isArray(s0) ? s0[0] : s0)))] + s[1];
        return lad[Math.max(0, Math.min(lad.length - 1, j + s - (Array.isArray(s0) ? s0[0] : s0)))];
      });
      beats = blk.beats.slice(); vels = blk.vel ? blk.vel.slice() : pitches.map((_, i) => i === 0 ? 0.86 : 0.76);
    } else if (blk.kind === "semi") {
      const first = src.rootPc + blk.semis[0];
      let base = first; while (base < pitch - 6) base += 12; while (base > pitch + 6) base -= 12;
      const shift = base - first;
      pitches = blk.semis.map(s => src.rootPc + s + shift);
      beats = blk.beats.slice(); vels = pitches.map((_, i) => i === 0 ? 0.86 : 0.76);
    } else if (blk.kind === "encl") {
      const land = beat + blk.beats[0] + blk.beats[1];
      const ci = M.chordAt(ctx, land);
      const pcs = ci >= 0 ? ctx.chords[ci].pcs : [mod(pitch)];
      const lad = M.ladder(pcs); const t = lad[snapIndex(lad, pitch)];
      const above = M.ladder(ctx.keyScale.concat(pcs), t + 1, t + 4)[0] || t + 2;
      pitches = [above, t - 1, t]; beats = blk.beats.slice(); vels = [0.8, 0.74, 0.86];
    }
    let t = beat;
    return { label: src.label, notes: pitches.map((p, i) => { const nt = { pitch: p, start: t, dur: beats[i], vel: vels[i] || 0.8 }; t += beats[i]; return nt; }) };
  };

  /* ---------- note transforms (pure: return new arrays) ---------- */
  const byStart = (a, b) => a.start - b.start || a.pitch - b.pitch;
  const clone = n => Object.assign({}, n);
  M.sortNotes = arr => arr.slice().sort(byStart);
  M.keepFirst = function (sel, n) { const s = sel.slice().sort(byStart); return { keep: s.slice(0, n), drop: s.slice(n) }; };
  M.everyOther = function (sel) {
    const s = sel.slice().sort(byStart).map(clone), keep = s.filter((_, i) => i % 2 === 0), drop = s.filter((_, i) => i % 2 === 1);
    keep.forEach((nt, i) => { const nx = keep[i + 1]; if (nx) nt.dur = Math.max(nt.dur, nx.start - nt.start); else { const last = s[s.length - 1]; nt.dur = Math.max(nt.dur, last.start + last.dur - nt.start); } });
    return { keep, drop };
  };
  M.stretch = function (sel, f) {
    const s0 = Math.min(...sel.map(n => n.start));
    return sel.map(n => Object.assign(clone(n), { start: s0 + (n.start - s0) * f, dur: n.dur * f }));
  };
  M.reversePitches = function (sel) {
    const s = sel.slice().sort(byStart).map(clone), ps = s.map(n => n.pitch).reverse();
    s.forEach((n, i) => { n.pitch = ps[i]; }); return s;
  };
  M.closeGaps = function (sel) {
    const s = sel.slice().sort(byStart).map(clone);
    for (let i = 1; i < s.length; i++) { const p = s[i - 1]; const end = p.start + p.dur; if (s[i].start > end + EPS) s[i].start = end; }
    return s;
  };
  /* delete notes and slide the rest of each affected block left to close the hole */
  M.rippleDelete = function (all, delIds) {
    const del = all.filter(n => delIds.has(n.id));
    return all.filter(n => !delIds.has(n.id)).map(n => {
      const c = clone(n);
      if (n.g == null) return c;
      del.forEach(d => { if (d.g === n.g && n.start >= d.start + d.dur - EPS) c.start -= d.dur; });
      return c;
    });
  };
  M.stepTranspose = function (pitch, steps, pcs) {
    let p = pitch;
    const dir = Math.sign(steps);
    for (let k = 0; k < Math.abs(steps); k++) { do { p += dir; } while (!pcs.includes(mod(p)) && p > 0 && p < 127); }
    return p;
  };
  M.quantize = function (notes, grid, strength) {
    strength = strength == null ? 1 : strength;
    return notes.map(n => {
      const s = n.start + (Math.round(n.start / grid) * grid - n.start) * strength;
      const e0 = n.start + n.dur, e = e0 + (Math.round(e0 / grid) * grid - e0) * strength;
      return Object.assign(clone(n), { start: Math.max(0, s), dur: Math.max(grid / 2, e - s) });
    });
  };

  /* ---------- chord voicing (bass + close position, voice-led) ---------- */
  M.voice = function (c, prevCenter) {
    let pcs = c.pcs.slice();
    if (pcs.length > 4) pcs = pcs.filter(p => p !== c.root);
    if (pcs.length > 4) pcs = pcs.filter(p => p !== mod(c.root + 7));
    pcs = pcs.slice(0, 4);
    const target = prevCenter || 62;
    let best = null;
    for (let r = 0; r < pcs.length; r++) {
      const order = pcs.slice(r).concat(pcs.slice(0, r));
      for (const startOct of [48, 60]) {
        let m = startOct + mod(order[0] - startOct); const notes = [m];
        for (let k = 1; k < order.length; k++) { m = m + mod(order[k] - m) || m + 12; notes.push(m); }
        if (notes[0] < 52 || notes[notes.length - 1] > 76) continue;
        const center = notes.reduce((a, b) => a + b, 0) / notes.length;
        const sc = Math.abs(center - target);
        if (!best || sc < best.sc) best = { sc, notes, center };
      }
    }
    if (!best) { const notes = pcs.map(p => 60 + mod(p - 60)).sort((a, b) => a - b); best = { notes, center: 62 }; }
    const bass = 36 + mod(c.root - 36);
    return { bass, upper: best.notes, center: best.center };
  };

  /* ---------- MIDI export (SMF type 1, 480 ppq) ---------- */
  function vlq(n) { const b = [n & 0x7f]; n >>= 7; while (n > 0) { b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; }
  function track(events) {
    events.sort((a, b) => a.t - b.t || a.o - b.o);
    const bytes = []; let last = 0;
    events.forEach(e => { bytes.push(...vlq(Math.max(0, e.t - last)), ...e.d); last = e.t; });
    bytes.push(0, 0xff, 0x2f, 0);
    const len = bytes.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...bytes];
  }
  const txt = (type, s) => { const b = Array.from(unescape(encodeURIComponent(s))).map(ch => ch.charCodeAt(0)); return [0xff, type, ...vlq(b.length), ...b]; };
  M.toMidi = function (song, ctx) {
    const P = 480, tick = b => Math.round(b * P);
    const us = Math.round(60000000 / song.bpm);
    const t0 = [{ t: 0, o: 0, d: txt(3, song.name || "Melody") }, { t: 0, o: 0, d: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
      { t: 0, o: 0, d: [0xff, 0x58, 4, song.bpb || 4, 2, 24, 8] }];
    const mel = [{ t: 0, o: 0, d: txt(3, "Melody") }, { t: 0, o: 0, d: [0xc0, 0] }];
    song.notes.forEach(n => {
      const p = Math.max(0, Math.min(127, n.pitch)), v = Math.max(1, Math.min(127, Math.round((n.vel || 0.8) * 127)));
      mel.push({ t: tick(n.start), o: 1, d: [0x90, p, v] }, { t: tick(n.start + n.dur), o: 0, d: [0x80, p, 0] });
    });
    const chd = [{ t: 0, o: 0, d: txt(3, "Chords") }, { t: 0, o: 0, d: [0xc1, 0] }];
    let center = null;
    ctx.chords.forEach((c, i) => {
      const v = M.voice(c, center); center = v.center;
      const s = ctx.starts[i], e = s + ctx.beats[i];
      chd.push({ t: tick(s), o: 0, d: txt(6, c.name) });
      [v.bass].concat(v.upper).forEach(p => chd.push({ t: tick(s), o: 1, d: [0x91, p, 70] }, { t: tick(e), o: 0, d: [0x81, p, 0] }));
    });
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, (P >> 8) & 255, P & 255];
    return new Uint8Array(head.concat(track(t0), track(mel), track(chd)));
  };

  if (typeof module !== "undefined" && module.exports) module.exports = M;
  else { root.MW = root.MW || {}; root.MW.music = M; }
})(typeof window !== "undefined" ? window : globalThis);
