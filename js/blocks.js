/* Melody Writer block palette: scales, arpeggios, Vocallicks blocks. Pick one, then click the grid. */
(function () {
  const MW = window.MW, st = MW.st, M = MW.music, $ = MW.$, D = M.D;
  const B = MW.blocks = {};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const opt = (arr, v) => arr.map(o => `<option value="${o.v}"${String(o.v) === String(v) ? " selected" : ""}>${o.name}</option>`).join("");
  const TIPS = {
    "s-major": "Do re mi. Click the note you want to start on.", "s-minor": "The major scale's darker relative.",
    "s-majpent": "Five notes, no half steps. Hard to make it clash.", "s-minpent": "The R&B and blues workhorse.",
    "s-blues": "Minor pentatonic plus the ♭5 blue note.", "a-maj": "1 3 5 and the octave.", "a-min": "1 ♭3 5 and the octave.",
    "a-maj7": "1 3 5 7. The neo-soul sound.", "a-m7": "1 ♭3 5 ♭7.", "a-7": "1 3 5 ♭7. Built on V so it pulls home.",
    "a-chord": "Whatever chord is under the spot you click."
  };

  B.init = function () {
    $("#bRoot").innerHTML = opt(M.ROOTS, st.blockOpt.root);
    $("#bDir").innerHTML = opt(M.DIRS, st.blockOpt.dir);
    $("#bRhy").innerHTML = opt(M.RHYTHMS.map(r => ({ v: r.v, name: r.name })), st.blockOpt.rhythm);
    $("#bN").value = st.blockOpt.n; $("#bHold").checked = st.blockOpt.hold;
    const upd = () => {
      st.blockOpt.root = $("#bRoot").value; st.blockOpt.dir = $("#bDir").value; st.blockOpt.rhythm = +$("#bRhy").value;
      st.blockOpt.n = Math.max(2, Math.min(15, +$("#bN").value || 8)); st.blockOpt.hold = $("#bHold").checked;
      MW.persist(); MW.roll.redraw();
    };
    ["#bRoot", "#bDir", "#bRhy", "#bN", "#bHold"].forEach(s => $(s).addEventListener("change", upd));
    $("#bN").addEventListener("input", upd);
    const cats = [];
    M.BLOCKS.forEach(b => { if (!cats.includes(b.cat)) cats.push(b.cat); });
    $("#blockList").innerHTML = cats.map(c => `<div class="bcat"><h3>${esc(c)}</h3><div class="bcards">${M.BLOCKS.filter(b => b.cat === c).map(card).join("")}</div></div>`).join("");
    $("#blockList").addEventListener("click", e => {
      const pv = e.target.closest("[data-prev]");
      if (pv) { preview(pv.dataset.prev); return; }
      const b = e.target.closest("[data-blk]"); if (!b) return;
      if (st.armed === b.dataset.blk) B.disarm(); else B.arm(b.dataset.blk);
    });
    $("#armedBar").addEventListener("click", e => { if (e.target.closest("[data-disarm]")) B.disarm(); });
    render();
  };
  function card(b) {
    let sub = b.fixed ? (D.BLOCKS[b.id.slice(2)] ? D.BLOCKS[b.id.slice(2)].rhythm : (b.desc || "").split(". ")[0].replace(/\.$/, "")) : TIPS[b.id] || "";
    if (sub.length > 58) sub = sub.slice(0, 56).replace(/\s+\S*$/, "") + "…";
    const sw = b.kind === "shape" ? "" : `<span class="shape">${shapeSvg(b)}</span>`;
    return `<div class="bcard" style="--c:${b.c};--on:${b.on || "var(--ink)"}"><button type="button" class="barm" data-blk="${b.id}" aria-pressed="false" title="${esc(b.desc || (D.BLOCKS[b.id.slice(2)] || {}).tip || TIPS[b.id] || "")}">
      <span class="chip"></span><span class="bt"><b>${esc(b.name)}</b><small>${esc(sub)}</small></span>${sw}</button>
      <button type="button" class="bprev" data-prev="${b.id}" aria-label="Hear ${esc(b.name)}" title="Hear it">▶</button></div>`;
  }
  /* tiny staircase of the riff's contour */
  function shapeSvg(b) {
    let ctx = MW.ctx || M.context(st.song);
    let res; try { res = M.generate(b, { root: "key" }, ctx, 0, 67); } catch (e) { return ""; }
    const ns = res.notes, lo = Math.min(...ns.map(n => n.pitch)), hi = Math.max(...ns.map(n => n.pitch)), tot = ns[ns.length - 1].start + ns[ns.length - 1].dur;
    const w = 52, h = 22, sy = p => h - 3 - ((p - lo) / Math.max(1, hi - lo)) * (h - 6);
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${ns.map(n => `<rect x="${(n.start / tot * w).toFixed(1)}" y="${(sy(n.pitch) - 2).toFixed(1)}" width="${Math.max(2, n.dur / tot * w - 1).toFixed(1)}" height="4"/>`).join("")}</svg>`;
  }
  function preview(id) {
    const b = M.block(id), ctx = MW.ctx;
    const i = Math.max(0, M.chordAt(ctx, st.pos));
    const res = M.generate(b, st.blockOpt, ctx, ctx.starts[i] || 0, 67);
    MW.audio.playNotes(res.notes);
    MW.flash(`${b.name}: ${res.label}, over ${ctx.chords[i] ? ctx.chords[i].name : "no chord"}.`);
  }
  B.arm = function (id) {
    st.armed = id; st.sel = new Set();
    const blk = M.block(id);
    if (blk.kind === "shape") { st.blockOpt.n = blk.n; $("#bN").value = blk.n; MW.persist(); }
    render(); MW.render({ sel: true, roll: true });
  };
  B.disarm = function () { st.armed = null; render(); MW.render({ roll: true }); };
  /* drop generated notes into the song as one block */
  B.place = function (blk, res) {
    const gid = MW.uid("g");
    const notes = res.notes.map(n => ({ id: MW.uid(), pitch: n.pitch, start: n.start, dur: n.dur, vel: n.vel, g: gid, label: blk.name }));
    const end = Math.max(...notes.map(n => n.start + n.dur));
    if (end > MW.MAX_BEATS) return MW.flash("That block would run past 32 bars.");
    MW.commit(() => { st.song.notes.push(...notes); st.sel = new Set(notes.map(n => n.id)); }, { roll: true, sel: true });
    if (!st.playing) MW.audio.playNotes(notes);
    const counts = {}; notes.forEach(n => { const gr = M.grade(MW.ctx, n, st.view.clash === "strict"); if (gr) counts[gr.cls] = (counts[gr.cls] || 0) + 1; });
    const bad = (counts.clash || 0) + (counts.avoid || 0) + (counts.outside || 0);
    MW.flash(`Placed ${blk.name}: ${res.label}.${bad ? ` ${bad} note${bad > 1 ? "s" : ""} to check.` : " Every note fits."} Click again for another, or press Done.`);
  };
  function render() {
    MW.$$("#blockList [data-blk]").forEach(b => { const on = b.dataset.blk === st.armed; b.setAttribute("aria-pressed", on); b.parentElement.classList.toggle("on", on); });
    const blk = st.armed ? M.block(st.armed) : null;
    const fixed = blk && blk.kind !== "shape";
    ["#bDir", "#bN", "#bRhy", "#bHold"].forEach(s => { $(s).disabled = !!fixed; });
    $("#bNote").textContent = fixed ? "Vocallicks blocks keep their own shape and rhythm. Built on still applies." : "Shape settings apply to scales and arpeggios.";
    const bar = $("#armedBar");
    if (blk) { bar.hidden = false; bar.innerHTML = `<span>Placing <b>${esc(blk.name)}</b>. Click the grid where the first note goes${blk.kind === "encl" ? " (for the enclosure, click the note it should land on)" : ""}.</span> <button type="button" class="btn xs" data-disarm>Done</button>`; }
    else bar.hidden = true;
    requestAnimationFrame(() => MW.roll && MW.roll.resize());
  }
  B.refreshShapes = function () {
    MW.$$("#blockList .bcard").forEach(el => {
      const id = el.querySelector("[data-blk]").dataset.blk, b = M.block(id), sh = el.querySelector(".shape");
      if (sh) sh.innerHTML = shapeSvg(b);
    });
  };
})();
