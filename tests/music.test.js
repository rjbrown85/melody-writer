/* Melody Writer engine tests. Run: node tests/music.test.js */
const M = require("../js/music.js");
const T = M.T, D = M.D;
let checks = 0, fails = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; if (fails < 40) console.log("FAIL:", msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + " — got " + JSON.stringify(a) + " want " + JSON.stringify(b)); }
const song = (chords, key = 0, tonality = "major", voicing = "written") => ({ key, tonality, voicing, bpb: 4, bpm: 90, name: "t", chords: chords.map(c => typeof c === "string" ? { num: c, beats: 4 } : c), notes: [] });

/* chords */
eq(M.chord("I", 0, "major").name, "C", "I in C");
eq(M.chord("V7", 0, "major").name, "G7", "V7 in C");
eq(M.chord("ii7", 0, "major").name, "Dm7", "ii7 in C");
eq(M.chord("IVmaj7", 0, "major").name, "Fmaj7", "IVmaj7 in C");
eq(M.chord("viiø", 0, "major").name, "Bø7", "viiø in C");
eq(M.chord("vii°", 0, "major").name, "B°", "vii° in C");
eq(M.chord("bVII", 0, "major").name, "Bb", "bVII in C uses flat");
eq(M.chord("bVI", 9, "minor").name, "F", "bVI in A minor");
eq(M.seventh("I"), "Imaj7", "7th toggle I");
eq(M.seventh("ii"), "ii7", "7th toggle ii");
eq(M.seventh("V7"), "V", "7th toggle back");
eq(M.seventh("vii°"), "viiø", "7th toggle dim");

/* every progression and palette numeral realizes in every key, tonality, voicing */
D.PROGRESSIONS.forEach(p => {
  for (let k = 0; k < 12; k++) M.VOICINGS.forEach(v => {
    let ctx;
    try { ctx = M.context(song(p.chords.map((c, i) => ({ num: c, beats: (p.beats || [])[i] || 4 })), k, p.tonality, v.id)); }
    catch (e) { ok(false, p.id + " " + e.message); return; }
    ok(ctx.total > 0 && ctx.infos.length === p.chords.length, p.id + " context");
  });
});
M.TONALITIES.forEach(t => {
  const pal = M.palette(t.id);
  pal.diatonic.flat().concat(pal.other).forEach(n => {
    for (let k = 0; k < 12; k++) { try { M.chord(n, k, t.id, "written"); ok(true, ""); } catch (e) { ok(false, "palette " + n + " " + e.message); } }
    ok(M.seventh(M.seventh(n)) === n || /°|ø|7/.test(n), "7th toggle round-trip " + n);
  });
});
eq(D.PROGRESSIONS.length, 51, "51 progressions imported");

/* clash grading in C major over C (beats 0-4) then F (4-8) then G7 (8-12) */
const ctx = M.context(song(["I", "IV", "V7", "I"]));
const g = (pitch, start, dur, strict) => M.grade(ctx, { pitch, start, dur }, strict).cls;
eq(g(64, 0, 1), "chord", "E over C");
eq(g(62, 0.5, 0.5), "scale", "D over C");
eq(g(65, 0, 2), "avoid", "F held on beat 1 over C");
eq(g(65, 1.75, 0.25), "passing", "F 16th off-beat over C");
eq(g(61, 0, 2), "clash", "C# held over C");
eq(g(61, 1.5, 0.25), "passing", "C# short off-beat over C");
eq(g(63, 1.5, 0.25), "blue", "Eb short over C is a blue note");
eq(g(63, 0, 2), "clash", "Eb held on beat 1 over C in major");
eq(g(65, 8, 1), "chord", "F over G7 is the 7th");
eq(g(60, 8, 2), "avoid", "C held over G7 (11 over dominant)");
eq(g(64, 3, 2), "scale", "E held from C into F is graded over F too (maj7 of F)");
eq(M.grade(ctx, { pitch: 64, start: 3, dur: 2 }).chord, 1, "worst grade comes from the F chord");
eq(g(64, 3, 1.25), "chord", "a quarter-beat tail into F is ignored");
eq(g(71, 3.5, 1), "scale", "B across C and F is maj7 then #11");
eq(g(66, 3, 2), "clash", "F# held into F grinds against F");
eq(g(66, 0, 1, true), "clash", "strict: F# is outside C major");
eq(g(65, 0.5, 0.25, true), "scale", "strict: short F is in key");
// Creep: I III IV iv in G. Over B major (III), a held G natural grinds against F#? G vs F# (5th of B) half step
const creep = M.context(song(["I", "III", "IV", "iv"], 7));
eq(M.grade(creep, { pitch: 67, start: 4, dur: 2 }).cls, "clash", "G held over B in Creep");
eq(M.grade(creep, { pitch: 63, start: 4, dur: 2 }).cls, "chord", "D# over B in Creep is a chord tone, not flagged");
eq(M.grade(creep, { pitch: 63, start: 4, dur: 2 }, true).cls, "chord", "strict still accepts chord tones out of key");
// blues tonality: Eb over C7 is fine
const bl = M.context(song(["I7", "IV7"], 0, "blues"));
eq(M.grade(bl, { pitch: 63, start: 0, dur: 2 }).cls, "blue", "Eb held over C7 in blues");
eq(M.grade(bl, { pitch: 66, start: 0.5, dur: 0.5 }).cls, "blue", "Gb over C7 in blues");

/* grading never throws, always returns a class, across random notes */
const progs = D.PROGRESSIONS;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 20000; i++) {
  const p = progs[Math.floor(rnd() * progs.length)], k = Math.floor(rnd() * 12);
  const c = M.context(song(p.chords.map((x, j) => ({ num: x, beats: (p.beats || [])[j] || 4 })), k, p.tonality, M.VOICINGS[Math.floor(rnd() * 6)].id));
  const st = Math.floor(rnd() * c.total * 4) / 4, du = [0.25, 1 / 3, 0.5, 1, 2, 3][Math.floor(rnd() * 6)];
  const r = M.grade(c, { pitch: 48 + Math.floor(rnd() * 36), start: st, dur: du }, rnd() < 0.3);
  ok(r && M.SEV[r.cls] != null && typeof r.why === "string" && r.why.length > 5, "grade result " + p.id);
  const kinds = M.rowKinds(c, M.chordAt(c, st), rnd() < 0.3);
  ok(kinds.length === 12 && kinds.filter(x => x === "chord").length >= 3, "row kinds");
}

/* block generation */
const nm = ns => ns.map(n => M.noteName(n.pitch));
const gen = (id, opt, c, beat, pitch) => M.generate(M.block(id), opt, c, beat, pitch).notes;
eq(nm(gen("s-major", { dir: "up", n: 8, rhythm: 0.5 }, ctx, 0, 60)), ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"], "C major scale up from C4");
eq(nm(gen("s-major", { dir: "down", n: 5 }, ctx, 0, 67)), ["G4", "F4", "E4", "D4", "C4"], "major scale down from G4");
eq(nm(gen("s-major", { dir: "updown", n: 3 }, ctx, 0, 64)), ["E4", "F4", "G4", "F4", "E4"], "up and back");
eq(nm(gen("s-minor", { n: 3 }, ctx, 0, 69)), ["A4", "B4", "C5"], "natural minor in C major key -> A minor (relative)");
eq(nm(gen("s-minpent", { n: 6 }, ctx, 0, 69)), ["A4", "C5", "D5", "E5", "G5", "A5"], "minor pent relative");
eq(nm(gen("s-majpent", { n: 3 }, ctx, 0, 61)), ["C4", "D4", "E4"], "C# snaps down to C in major pent");
eq(nm(gen("s-major", { n: 3, root: "chord" }, ctx, 4, 65)), ["F4", "G4", "A4"], "chord root: F major over IV");
eq(nm(gen("s-major", { n: 3, root: "drop" }, ctx, 0, 62)), ["D4", "E4", "F#4"], "drop root: D major");
eq(nm(gen("a-maj", { n: 4 }, ctx, 0, 60)), ["C4", "E4", "G4", "C5"], "C major arpeggio");
eq(nm(gen("a-7", { n: 5 }, ctx, 0, 55)), ["G3", "B3", "D4", "F4", "G4"], "dominant 7th on V in major");
eq(nm(gen("a-chord", { n: 4 }, ctx, 8, 55)), ["G3", "B3", "D4", "F4"], "chord tones over G7");
eq(nm(gen("a-min", { n: 4, root: "key" }, M.context(song(["i", "iv"], 9, "minor")), 0, 57)), ["A3", "C4", "E4", "A4"], "minor arp in A minor");
const r8 = gen("s-major", { n: 4, rhythm: 0.25, hold: true }, ctx, 2, 60);
eq(r8.map(n => n.start), [2, 2.25, 2.5, 2.75], "16th rhythm starts");
eq(r8.map(n => n.dur), [0.25, 0.25, 0.25, 1], "held last note");
eq(gen("s-major", { n: 4, rhythm: 0.5, hold: false }, ctx, 0, 60).map(n => n.dur), [0.5, 0.5, 0.5, 0.5], "no hold");
// Vocallicks blocks
eq(nm(gen("v-qd", {}, ctx, 0, 69)), ["A4", "G4", "E4"], "Quick Dip from A in C major key pent");
eq(nm(gen("v-skip", {}, ctx, 0, 72)), ["C5", "A4", "G4", "E4", "D4"], "Skip Quick Dip Trip starts where clicked");
eq(gen("v-qd", {}, ctx, 0, 69).map(n => n.dur), [0.5, 0.25, 0.25], "Quick Dip rhythm");
eq(nm(gen("v-gospel", {}, ctx, 0, 72)), ["C5", "A4", "G4", "E4", "D4", "C4"], "Gospel descent on key");
eq(nm(gen("v-encl", {}, ctx, 0, 64)), ["F4", "D#4", "E4"], "enclosure onto E");
eq(nm(gen("v-fivemaj", {}, ctx, 0, 60)), ["C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4", "C4"], "five-note major run");
// every block generates in every tonality and root mode, notes contiguous in time
M.BLOCKS.forEach(b => M.TONALITIES.forEach(t => ["key", "chord", "drop"].forEach(root => {
  for (let k = 0; k < 12; k += 5) {
    const c = M.context(song(["I", "IV"].map(x => ({ num: t.id === "minor" || t.id === "dorian" ? x.toLowerCase() : x, beats: 4 })), k, t.id));
    [48, 60, 71].forEach(p => {
      const res = M.generate(b, { root, dir: "updown", n: 5, rhythm: 1 / 3 }, c, 1, p);
      ok(res.notes.length >= 3 && res.notes.every(n => Number.isFinite(n.pitch) && n.dur > 0 && n.pitch > 20 && n.pitch < 109), "gen " + b.id + " " + t.id + " " + root);
      for (let i = 1; i < res.notes.length; i++) ok(Math.abs(res.notes[i].start - (res.notes[i - 1].start + res.notes[i - 1].dur)) < 1e-9, "contiguous " + b.id);
      ok(Math.abs(res.notes[0].start - 1) < 1e-9, "starts at drop beat " + b.id);
      if (b.kind === "shape" || b.kind === "pent" || b.kind === "scale") ok(Math.abs(res.notes[0].pitch - p) <= 3, "first note near click " + b.id);
      ok(typeof res.label === "string", "label");
    });
  }
})));

/* transforms */
const sel = [0, 1, 2, 3, 4].map(i => ({ id: "n" + i, pitch: 60 + i, start: i * 0.5, dur: 0.5, g: "g1" }));
eq(M.keepFirst(sel, 2).keep.map(n => n.id), ["n0", "n1"], "keep first 2");
const eo = M.everyOther(sel);
eq(eo.keep.map(n => [n.id, n.dur]), [["n0", 1], ["n2", 1], ["n4", 0.5]], "every other stretches kept notes");
eq(M.stretch(sel, 2).map(n => [n.start, n.dur]), [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], "half speed");
eq(M.stretch(sel.slice(1), 0.5).map(n => n.start), [0.5, 0.75, 1, 1.25], "double speed anchors at first");
eq(M.reversePitches(sel).map(n => n.pitch), [64, 63, 62, 61, 60], "reverse pitches");
const gap = [{ id: "a", pitch: 60, start: 0, dur: 0.5 }, { id: "b", pitch: 62, start: 2, dur: 0.5 }, { id: "c", pitch: 64, start: 3, dur: 1 }];
eq(M.closeGaps(gap).map(n => n.start), [0, 0.5, 1], "close gaps");
const other = { id: "x", pitch: 50, start: 5, dur: 1 };
const rip = M.rippleDelete(sel.concat([other]), new Set(["n1", "n2"]));
eq(rip.map(n => [n.id, n.start]), [["n0", 0], ["n3", 0.5], ["n4", 1], ["x", 5]], "ripple delete closes within block only");
eq(M.stepTranspose(60, 1, ctx.keyScale), 62, "step up C->D");
eq(M.stepTranspose(64, 1, ctx.keyScale), 65, "step up E->F");
eq(M.stepTranspose(61, -1, ctx.keyScale), 60, "C# step down -> C");
eq(M.stepTranspose(60, -2, ctx.keyScale), 57, "two steps down C->A");
eq(M.quantize([{ pitch: 60, start: 0.23, dur: 0.4 }], 0.25, 1).map(n => [n.start, n.dur]), [[0.25, 0.5]], "quantize full");
eq(M.quantize([{ pitch: 60, start: 0.2, dur: 0.5 }], 0.25, 0.5).map(n => +n.start.toFixed(3)), [0.225], "quantize half strength");

/* voicing */
for (let k = 0; k < 12; k++) ["I", "ii7", "V7", "IVmaj7", "vii°", "bVII"].forEach(n => ["written", "rnb", "gospel"].forEach(v => {
  const c = M.chord(n, k, "major", v), vo = M.voice(c, 62);
  ok(vo.upper.every(m => c.pcs.includes(m % 12)), "voicing uses chord tones " + c.name);
  ok(vo.upper.length >= 3 && vo.upper.length <= 4, "voicing size " + c.name);
  ok(vo.bass % 12 === c.root && vo.bass >= 36 && vo.bass < 48, "bass root " + c.name);
  ok(vo.upper[0] >= 48 && vo.upper[vo.upper.length - 1] <= 79, "voicing range " + c.name + " " + vo.upper);
}));

/* MIDI */
const s2 = song(["I", "V"]); s2.notes = [{ pitch: 60, start: 0, dur: 1, vel: 0.8 }, { pitch: 62, start: 1, dur: 0.5 }];
const mid = M.toMidi(s2, M.context(s2));
eq(Array.from(mid.slice(0, 4)).map(c => String.fromCharCode(c)).join(""), "MThd", "MIDI header");
eq([mid[10], mid[11]], [0, 3], "3 tracks");
let pos = 14, tracks = 0; while (pos < mid.length) { ok(String.fromCharCode(...mid.slice(pos, pos + 4)) === "MTrk", "track chunk"); const len = (mid[pos + 4] << 24) | (mid[pos + 5] << 16) | (mid[pos + 6] << 8) | mid[pos + 7]; pos += 8 + len; tracks++; }
eq(pos, mid.length, "chunks tile the file"); eq(tracks, 3, "track count");

console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
