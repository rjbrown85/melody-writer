/* Melody Writer chord chart: cards, editor, palette, progression library. */
(function () {
  const MW = window.MW, st = MW.st, M = MW.music, $ = MW.$, D = M.D;
  const CH = MW.chords = {};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const myProgs = () => MW.store.get("mw.myProgs", []);
  const nameOf = num => { try { return M.chord(num, st.song.key, st.song.tonality, "written").name; } catch (e) { return num; } };
  const pretty = num => num.replace(/^b/, "♭").replace(/^#/, "♯");

  CH.init = function () {
    $("#chart").addEventListener("click", e => {
      const b = e.target.closest("[data-i]"); if (!b) return;
      st.selChord = +b.dataset.i; $("#chordEd").hidden = false; MW.render({ chords: true, roll: true });
      const s = MW.ctx.starts[st.selChord]; MW.roll.scrollToBeat(s);
      auditionChord(st.selChord);
    });
    $("#chDone").onclick = () => { $("#chordEd").hidden = true; MW.roll.resize(); };
    $("#beatsDown").onclick = () => setBeats(-1);
    $("#beatsUp").onclick = () => setBeats(1);
    $("#chLeft").onclick = () => moveChord(-1);
    $("#chRight").onclick = () => moveChord(1);
    $("#chSeventh").onclick = () => edit(c => { c.num = M.seventh(c.num); }, true);
    $("#chDup").onclick = () => {
      const c = st.song.chords[st.selChord];
      if (MW.total() + c.beats > MW.MAX_BEATS) return MW.flash("That would go past 32 bars.");
      MW.commit(() => { st.song.chords.splice(st.selChord + 1, 0, Object.assign({}, c)); st.selChord++; }, { chords: true });
    };
    $("#chDel").onclick = () => {
      if (st.song.chords.length < 2) return MW.flash("A song needs at least one chord.");
      MW.commit(() => { st.song.chords.splice(st.selChord, 1); st.selChord = Math.max(0, st.selChord - 1); }, { chords: true });
    };
    $("#addChord").onclick = () => {
      if (MW.total() + 4 > MW.MAX_BEATS) return MW.flash("You're at the 32-bar limit.");
      const tonic = ["minor", "dorian"].includes(st.song.tonality) ? "i" : "I";
      MW.commit(() => { st.song.chords.splice(st.selChord + 1, 0, { num: tonic, beats: 4 }); st.selChord++; }, { chords: true });
      CH.reveal();
    };
    $("#repeatAll").onclick = () => {
      if (MW.total() * 2 > MW.MAX_BEATS) return MW.flash("Repeating would go past 32 bars.");
      MW.commit(() => { st.song.chords = st.song.chords.concat(st.song.chords.map(c => Object.assign({}, c))); st.song.loop = { on: st.song.loop.on, a: 0, b: MW.total() }; }, { chords: true });
      MW.flash("Chords repeated. Your notes stayed where they were.");
    };
    $("#saveProg").onclick = () => {
      const name = (prompt("Name this progression:", st.song.name || "My progression") || "").trim();
      if (!name) return;
      const list = myProgs().filter(p => p.name !== name);
      list.push({ id: MW.uid("p"), name, tonality: st.song.tonality, chords: st.song.chords.map(c => ({ num: c.num, beats: c.beats })) });
      MW.store.set("mw.myProgs", list); renderLib(); MW.flash(`Saved “${name}” under My progressions.`);
    };
    $("#libList").addEventListener("click", e => {
      const del = e.target.closest("[data-del]");
      if (del) { MW.store.set("mw.myProgs", myProgs().filter(p => p.id !== del.dataset.del)); renderLib(); return; }
      const b = e.target.closest("[data-prog]"); if (!b) return;
      loadProg(b.dataset.prog);
    });
    $("#palDia").addEventListener("click", palClick);
    $("#palOther").addEventListener("click", palClick);
    renderLib();
  };
  function palClick(e) {
    const b = e.target.closest("[data-num]"); if (!b) return;
    edit(c => { c.num = b.dataset.num; }, true);
  }
  function edit(fn, listen) {
    MW.commit(() => fn(st.song.chords[st.selChord]), { chords: true });
    if (listen) auditionChord(st.selChord);
  }
  function setBeats(d) {
    const c = st.song.chords[st.selChord], nb = Math.max(1, Math.min(16, c.beats + d));
    if (nb === c.beats) return;
    if (MW.total() + (nb - c.beats) > MW.MAX_BEATS) return MW.flash("That would go past 32 bars.");
    edit(ch => { ch.beats = nb; });
  }
  function moveChord(d) {
    const i = st.selChord, j = i + d; if (j < 0 || j >= st.song.chords.length) return;
    MW.commit(() => { const a = st.song.chords; [a[i], a[j]] = [a[j], a[i]]; st.selChord = j; }, { chords: true });
  }
  function auditionChord(i) {
    if (st.playing) return;
    const c = MW.ctx.chords[i]; if (!c) return;
    const v = M.voice(c, 62);
    MW.audio.playNotes([v.bass].concat(v.upper).map(p => ({ pitch: p, start: 0, dur: 1.5, vel: 0.5 })));
  }
  CH.audition = auditionChord;

  function loadProg(id) {
    let p = D.PROGRESSIONS.find(x => x.id === id), mine = false;
    if (!p) { p = myProgs().find(x => x.id === id); mine = true; }
    if (!p) return;
    const f = +$("#libBars").value, rep = +$("#libRep").value;
    let one = mine ? p.chords.map(c => ({ num: c.num, beats: c.beats * f })) : p.chords.map((n, i) => ({ num: n, beats: ((p.beats || [])[i] || 4) * f }));
    one = one.map(c => ({ num: c.num, beats: Math.max(1, Math.round(c.beats)) }));
    let chords = [];
    for (let r = 0; r < rep; r++) {
      const tot = chords.concat(one).reduce((a, c) => a + c.beats, 0);
      if (tot > MW.MAX_BEATS) break;
      chords = chords.concat(one.map(c => Object.assign({}, c)));
    }
    if (!chords.length) chords = one.slice(0, 1);
    MW.commit(() => {
      st.song.chords = chords; st.song.tonality = p.tonality || st.song.tonality; st.selChord = 0;
      st.song.loop = { on: st.song.loop.on, a: 0, b: chords.reduce((a, c) => a + c.beats, 0) };
    }, { all: true });
    $("#libMenu").open = false;
    MW.roll.scrollToBeat(0);
    MW.flash(`Loaded ${p.name}${st.song.notes.length ? ". Your notes stayed where they were" : ""}. The scale is now ${M.TONALITIES.find(t => t.id === st.song.tonality).name.toLowerCase()}.`);
  }

  function renderLib() {
    const groups = {};
    const mine = myProgs();
    if (mine.length) groups["My progressions"] = mine.map(p => ({ id: p.id, name: p.name, nums: p.chords.map(c => c.num), mine: true }));
    D.PROGRESSIONS.forEach(p => { (groups[p.group] = groups[p.group] || []).push({ id: p.id, name: p.name, nums: p.chords, note: p.note, ton: p.tonality }); });
    $("#libList").innerHTML = Object.keys(groups).map(gname => `<div class="lib-group"><h3>${esc(gname)}</h3>${groups[gname].map(p =>
      `<div class="lib-item"><button type="button" data-prog="${p.id}" title="${esc(p.note || "")}"><b>${esc(p.name)}</b><small>${p.nums.map(pretty).join(" – ")}${p.ton && p.ton !== "major" ? " · " + p.ton : ""}</small></button>${p.mine ? `<button type="button" class="x" data-del="${p.id}" aria-label="Delete ${esc(p.name)}">×</button>` : ""}</div>`).join("")}</div>`).join("");
  }

  function renderChart() {
    const ctx = MW.ctx, bpb = st.song.bpb;
    st.selChord = Math.max(0, Math.min(st.selChord, st.song.chords.length - 1));
    $("#chart").innerHTML = ctx.chords.map((c, i) => {
      const s = ctx.starts[i], bar = Math.abs(s % bpb) < 1e-6 ? `<span class="bar">bar ${s / bpb + 1}</span>` : "";
      return `<button type="button" role="option" aria-selected="${i === st.selChord}" class="card${i === st.selChord ? " on" : ""}" data-i="${i}" style="--w:${Math.max(1, ctx.beats[i])}">
        ${bar}<b class="num">${esc(c.num.text)}</b><span class="nm">${esc(c.name)}</span><small>${MW.fmtBeats(ctx.beats[i])}</small></button>`;
    }).join("");
    const tot = MW.total(), bars = Math.floor(tot / bpb), extra = tot - bars * bpb;
    $("#chordMeta").textContent = `${ctx.chords.length} chord${ctx.chords.length === 1 ? "" : "s"} · ${bars} bar${bars === 1 ? "" : "s"}${extra ? " + " + MW.fmtBeats(extra) : ""} of 32 · ${M.T.KEYNAMES[st.song.key]} ${M.TONALITIES.find(t => t.id === st.song.tonality).name.toLowerCase()} · click a chord to change it`;
    // editor
    const c = st.song.chords[st.selChord], rc = ctx.chords[st.selChord], info = ctx.infos[st.selChord];
    $("#chedName").innerHTML = `Chord ${st.selChord + 1}: ${esc(rc.name)} <small>(${esc(rc.num.text)} · ${esc(info.modeName)})</small>`;
    $("#beatsVal").textContent = c.beats;
    $("#chLeft").disabled = st.selChord === 0; $("#chRight").disabled = st.selChord === st.song.chords.length - 1;
    $("#chDel").disabled = st.song.chords.length < 2;
    const pal = M.palette(st.song.tonality);
    const btn = n => `<button type="button" class="pc${n === c.num ? " on" : ""}" data-num="${esc(n)}"><b>${esc(pretty(n))}</b><small>${esc(nameOf(n))}</small></button>`;
    $("#palDia").innerHTML = pal.diatonic.map(pair => `<span class="pair">${btn(pair[0])}${btn(pair[1])}</span>`).join("");
    $("#palOther").innerHTML = pal.other.map(btn).join("");
  }
  CH.reveal = function () {
    const el = $(`#chart [data-i="${st.selChord}"]`); if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  MW.on(w => { if (w.all || w.chords || w.song) renderChart(); });
})();
