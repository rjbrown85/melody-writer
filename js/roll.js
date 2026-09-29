/* Melody Writer piano roll: canvas drawing, note editing, block placement, ruler and loop. */
(function () {
  const MW = window.MW, st = MW.st, M = MW.music, $ = MW.$;
  const R = MW.roll = {};
  const KW = 56, RH = 20, CH = 26, HH = RH + CH;
  let cv, g, sc, spacer, wrap, W = 0, H = 0, dpr = 1, C = {};
  let drag = null, ghost = null, pointer = null;

  const rows = () => st.view.hi - st.view.lo + 1;
  const viewBeats = () => Math.min(MW.MAX_BEATS, Math.max(MW.total(), MW.songEnd()) + st.song.bpb);
  const X = b => KW + b * st.view.ppb - sc.scrollLeft;
  const Y = p => HH + (st.view.hi - p) * st.view.rowH - sc.scrollTop;
  const beatAt = x => (x - KW + sc.scrollLeft) / st.view.ppb;
  const pitchAt = y => st.view.hi - Math.floor((y - HH + sc.scrollTop) / st.view.rowH);
  const isBlack = p => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
  R.geom = { KW, HH };

  function colors() {
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    C = { ink: v("--ink"), sheet: v("--sheet"), paper: v("--paper"), pink: v("--pink"), blue: v("--blue"), green: v("--green"),
      orange: v("--orange"), yellow: v("--yellow"), red: v("--red"), soft: v("--soft") };
  }
  const FILL = () => ({ chord: C.green, scale: "#ffffff", blue: C.blue, passing: "#ffffff", avoid: C.yellow, outside: C.orange, clash: C.red, none: "#8fb0ff" });
  const TEXT = { chord: "#fff", scale: "#161616", blue: "#fff", passing: "#161616", avoid: "#161616", outside: "#161616", clash: "#fff", none: "#161616" };

  R.init = function () {
    if (window.matchMedia("(pointer: coarse)").matches) st.view.rowH = Math.max(st.view.rowH, 20);
    cv = $("#rollCanvas"); g = cv.getContext("2d"); sc = $("#scroller"); spacer = $("#spacer"); wrap = $("#rollWrap");
    colors();
    new ResizeObserver(() => { R.resize(); }).observe(wrap);
    sc.addEventListener("scroll", () => draw());
    cv.addEventListener("wheel", e => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); R.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX); return; }
      e.preventDefault();
      sc.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX; if (!e.shiftKey) sc.scrollTop += e.deltaY;
    }, { passive: false });
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", () => { if (!drag) { ghost = null; st.hover = null; setInfo(null); draw(); } });
    cv.addEventListener("dblclick", dbl);
    cv.addEventListener("contextmenu", e => { if (st.armed) { e.preventDefault(); MW.blocks.disarm(); } });
    R.resize();
    // start scrolled so the middle of the voice sits in view
    requestAnimationFrame(() => { sc.scrollTop = Math.max(0, (st.view.hi - 79) * st.view.rowH); draw(); });
  };
  R.resize = function () {
    if (!sc) return;
    dpr = window.devicePixelRatio || 1;
    spacer.style.width = (KW + viewBeats() * st.view.ppb + 40) + "px";
    spacer.style.height = (HH + rows() * st.view.rowH + 4) + "px";
    W = sc.clientWidth; H = sc.clientHeight;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.style.width = W + "px"; cv.style.height = H + "px"; cv.width = cw; cv.height = ch; }
    draw();
  };
  R.zoom = function (f, atX) {
    const ax = atX == null ? W / 2 : atX, b = beatAt(ax);
    st.view.ppb = Math.max(24, Math.min(240, st.view.ppb * f));
    R.resize();
    sc.scrollLeft = Math.max(0, KW + b * st.view.ppb - ax);
    MW.persist(); draw();
  };
  R.scrollToBeat = function (b) {
    const x = b * st.view.ppb;
    if (x < sc.scrollLeft || x > sc.scrollLeft + W - KW - 60) sc.scrollLeft = Math.max(0, x - 80);
  };
  R.scrollToPitch = function (p) {
    const y = (st.view.hi - p) * st.view.rowH;
    if (y < sc.scrollTop + 10 || y > sc.scrollTop + H - HH - 30) sc.scrollTop = Math.max(0, y - (H - HH) / 2);
  };
  R.redraw = () => draw();

  /* ---------- grading cache ---------- */
  let gradeFor = null, gradeMap = new Map();
  function gradeOf(n) {
    const key = MW.ctx, mode = st.view.clash;
    if (gradeFor !== key + mode) { /* invalidated below */ }
    if (mode === "off") return null;
    const k = n.pitch + "|" + n.start + "|" + n.dur + "|" + mode;
    if (gradeFor !== key || gradeMap.mode !== mode) { gradeFor = key; gradeMap = new Map(); gradeMap.mode = mode; }
    if (!gradeMap.has(k)) gradeMap.set(k, M.grade(MW.ctx, n, mode === "strict"));
    return gradeMap.get(k);
  }
  R.gradeOf = gradeOf;

  /* ---------- drawing ---------- */
  function draw() {
    if (!g || !MW.ctx) return;
    const v = st.view, ctx = MW.ctx, ppb = v.ppb, rh = v.rowH, bpb = st.song.bpb;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    const b0 = Math.max(0, beatAt(KW)), b1 = beatAt(W);
    const pTop = Math.min(v.hi, pitchAt(HH)), pBot = Math.max(v.lo, pitchAt(H));
    const total = ctx.total;
    g.save(); g.beginPath(); g.rect(KW, HH, W - KW, H - HH); g.clip();

    // row shading per chord
    for (let p = pBot; p <= pTop; p++) {
      const y = Y(p);
      if (v.clash === "off" || !ctx.chords.length) { g.fillStyle = isBlack(p) ? "#eef0ec" : "#fff"; g.fillRect(KW, y, W - KW, rh); }
    }
    if (v.clash !== "off") {
      ctx.chords.forEach((c, i) => {
        const s = ctx.starts[i], e = s + ctx.beats[i];
        if (e < b0 || s > b1) return;
        const kinds = M.rowKinds(ctx, i, v.clash === "strict");
        const x0 = X(s), x1 = X(e);
        for (let p = pBot; p <= pTop; p++) {
          const k = kinds[((p % 12) + 12) % 12];
          g.fillStyle = k === "chord" ? "rgba(20,163,116,.24)" : k === "out" ? "rgba(22,22,22,.14)" : k === "avoid" ? "rgba(255,204,0,.2)" : "#fff";
          g.fillRect(x0, Y(p), x1 - x0, rh);
        }
      });
    }
    // no chords past the end
    if (total < b1) { g.fillStyle = "rgba(22,22,22,.05)"; g.fillRect(X(total), HH, W, H); }
    // range band
    if (v.range.on) {
      g.fillStyle = "rgba(35,80,216,.10)";
      const yHi = Y(v.range.hi), yLo = Y(v.range.lo - 1);
      if (yHi > HH) g.fillRect(KW, HH, W - KW, yHi - HH);
      if (yLo < H) g.fillRect(KW, yLo, W - KW, H - yLo);
      g.strokeStyle = C.blue; g.lineWidth = 1.5; g.setLineDash([6, 4]);
      [yHi, yLo].forEach(y => { g.beginPath(); g.moveTo(KW, y); g.lineTo(W, y); g.stroke(); });
      g.setLineDash([]);
    }
    // horizontal lines
    g.lineWidth = 1;
    for (let p = pBot; p <= pTop + 1; p++) {
      const y = Math.round(Y(p) + rh) + 0.5;
      g.strokeStyle = ((p % 12) + 12) % 12 === 0 ? "rgba(22,22,22,.35)" : "rgba(22,22,22,.08)";
      g.beginPath(); g.moveTo(KW, y); g.lineTo(W, y); g.stroke();
    }
    // vertical grid
    const snap = v.snap, subPx = snap * ppb;
    if (subPx >= 7) {
      g.strokeStyle = "rgba(35,80,216,.10)";
      for (let b = Math.floor(b0 / snap) * snap; b <= b1; b += snap) { const x = Math.round(X(b)) + 0.5; g.beginPath(); g.moveTo(x, HH); g.lineTo(x, H); g.stroke(); }
    }
    for (let b = Math.floor(b0); b <= b1; b++) {
      const x = Math.round(X(b)) + 0.5, bar = b % bpb === 0;
      g.strokeStyle = bar ? "rgba(22,22,22,.55)" : "rgba(22,22,22,.18)"; g.lineWidth = bar ? 1.5 : 1;
      g.beginPath(); g.moveTo(x, HH); g.lineTo(x, H); g.stroke();
    }
    // chord boundaries
    g.strokeStyle = C.ink; g.lineWidth = 2.5;
    ctx.starts.concat([total]).forEach(s => { if (s < b0 - 1 || s > b1 + 1) return; const x = Math.round(X(s)); g.beginPath(); g.moveTo(x, HH); g.lineTo(x, H); g.stroke(); });
    // loop shading
    const L = st.song.loop;

    // notes
    const fill = FILL();
    const grades = [];
    st.song.notes.forEach(n => {
      const x = X(n.start), w = n.dur * ppb, y = Y(n.pitch);
      if (x > W || x + w < KW || y > H || y + rh < HH) return;
      const gr = gradeOf(n), cls = gr ? gr.cls : "none", sel = st.sel.has(n.id);
      grades.push(cls);
      noteRect(x, y, w, rh, fill[cls], cls, sel, n.id === st.hover);
      if (w > 26 && rh >= 12) {
        g.fillStyle = TEXT[cls]; g.font = "bold " + Math.min(11, rh - 3) + "px 'Courier Prime', monospace"; g.textBaseline = "middle";
        g.fillText(M.noteName(n.pitch, ctx.flats), x + 4, y + rh / 2 + 0.5);
      }
    });
    // pending recorded notes
    if (MW.input && MW.input.pending) MW.input.pending().forEach(n => noteRect(X(n.start), Y(n.pitch), Math.max(3, n.dur * ppb), rh, C.pink, "rec", false, false));
    // ghost block
    if (ghost) {
      g.globalAlpha = 0.72;
      ghost.notes.forEach(n => {
        const gr = st.view.clash === "off" ? null : M.grade(ctx, n, st.view.clash === "strict");
        noteRect(X(n.start), Y(n.pitch), n.dur * ppb, rh, fill[gr ? gr.cls : "none"], gr ? gr.cls : "none", false, false, true);
      });
      g.globalAlpha = 1;
    }
    // marquee
    if (drag && drag.type === "marquee") {
      g.fillStyle = "rgba(35,80,216,.12)"; g.strokeStyle = C.blue; g.lineWidth = 1.5; g.setLineDash([5, 3]);
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
      g.fillRect(x, y, w, h); g.strokeRect(x + .5, y + .5, w, h); g.setLineDash([]);
    }
    g.restore();

    // header: ruler + chord strip
    g.fillStyle = C.paper; g.fillRect(KW, 0, W - KW, HH);
    g.save(); g.beginPath(); g.rect(KW, 0, W - KW, HH); g.clip();
    if (L.on) { g.fillStyle = "rgba(255,61,139,.55)"; g.fillRect(X(L.a), 2, (L.b - L.a) * ppb, RH - 4); }
    g.font = "bold 12px 'Courier Prime', monospace"; g.textBaseline = "middle"; g.fillStyle = C.ink;
    for (let b = Math.floor(b0); b <= b1; b++) {
      const x = Math.round(X(b)) + 0.5;
      if (b % bpb === 0) { g.fillRect(x - 0.5, 2, 2, RH - 4); g.fillText(String(b / bpb + 1), x + 5, RH / 2 + 1); }
      else if (ppb > 30) { g.fillRect(x - 0.5, RH - 7, 1, 5); }
    }
    ctx.chords.forEach((c, i) => {
      const s = ctx.starts[i], x0 = X(s), x1 = X(s + ctx.beats[i]);
      if (x1 < KW || x0 > W) return;
      const selc = i === st.selChord;
      g.fillStyle = selc ? C.yellow : i % 2 ? "#ffffff" : "#f4f5f1";
      g.fillRect(x0, RH, x1 - x0, CH);
      g.strokeStyle = C.ink; g.lineWidth = 2; g.strokeRect(x0 + 1, RH + 1, x1 - x0 - 2, CH - 2);
      g.fillStyle = C.ink; g.font = "13px 'Dela Gothic One', 'Arial Black', sans-serif";
      const label = c.name + "  " + c.num.text;
      g.save(); g.beginPath(); g.rect(x0 + 2, RH, x1 - x0 - 4, CH); g.clip();
      g.fillText(label, x0 + 7, RH + CH / 2 + 1); g.restore();
    });
    g.restore();
    g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(KW, HH - 1); g.lineTo(W, HH - 1); g.stroke();

    // keys column
    g.save(); g.beginPath(); g.rect(0, HH, KW, H - HH); g.clip();
    const liveKeys = MW.input ? MW.input.down() : new Set();
    for (let p = pBot; p <= pTop; p++) {
      const y = Y(p), black = isBlack(p), on = liveKeys.has(p) || (pointer && pointer.pitch === p && pointer.inKeys);
      g.fillStyle = on ? C.pink : black ? C.ink : "#fff";
      g.fillRect(0, y, black ? KW * 0.62 : KW, rh);
      if (black) { g.fillStyle = on ? C.pink : "#fff"; g.fillRect(KW * 0.62, y, KW * 0.38, rh); }
      g.strokeStyle = "rgba(22,22,22,.25)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(y + rh) + .5); g.lineTo(KW, Math.round(y + rh) + .5); g.stroke();
      if (((p % 12) + 12) % 12 === 0 || (pointer && pointer.pitch === p && !pointer.inKeys && pointer.inGrid)) {
        g.fillStyle = black ? "#fff" : C.ink; g.font = "bold 10px 'Courier Prime', monospace"; g.textBaseline = "middle";
        g.fillText(M.noteName(p, ctx.flats), black ? KW * 0.64 : KW - 26, y + rh / 2 + .5);
      }
    }
    g.restore();
    g.fillStyle = C.paper; g.fillRect(0, 0, KW, HH);
    g.fillStyle = C.ink; g.font = "bold 10px 'Courier Prime', monospace"; g.textBaseline = "middle";
    g.fillText("bar", 8, RH / 2); g.fillText("chord", 8, RH + CH / 2);
    g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(KW - 1, 0); g.lineTo(KW - 1, H); g.stroke();

    // playhead
    const px = X(st.pos);
    if (px >= KW - 1 && px <= W) {
      g.strokeStyle = C.pink; g.lineWidth = 2.5; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
      g.fillStyle = C.pink; g.beginPath(); g.moveTo(px - 7, 0); g.lineTo(px + 7, 0); g.lineTo(px, 9); g.fill();
    }
  }
  function noteRect(x, y, w, h, fill, cls, sel, hov, isGhost) {
    const pad = 1.5;
    g.fillStyle = fill; g.fillRect(x + pad, y + pad, Math.max(2, w - pad * 2), h - pad * 2);
    g.lineWidth = sel ? 3 : 1.5; g.strokeStyle = sel ? C.pink : C.ink;
    if (cls === "passing" || isGhost) g.setLineDash([4, 3]);
    if (cls === "passing" && !sel) g.strokeStyle = C.orange;
    g.strokeRect(x + pad, y + pad, Math.max(2, w - pad * 2), h - pad * 2);
    g.setLineDash([]);
    if (hov && !sel) { g.strokeStyle = C.blue; g.lineWidth = 2; g.strokeRect(x + pad - 1, y + pad - 1, w - pad * 2 + 2, h - pad * 2 + 2); }
    if (sel) { g.fillStyle = C.pink; g.fillRect(x + w - 5, y + pad, 3.5, h - pad * 2); }
  }

  /* ---------- hit testing ---------- */
  function noteAt(x, y) {
    const ns = st.song.notes;
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i], nx = X(n.start), nw = n.dur * st.view.ppb, ny = Y(n.pitch);
      if (x >= nx && x <= nx + Math.max(nw, 6) && y >= ny && y < ny + st.view.rowH) return { n, edge: nw > 12 && x > nx + nw - 7 };
    }
    return null;
  }
  const where = (x, y) => y < RH ? "ruler" : y < HH ? "chords" : x < KW ? "keys" : "grid";
  function local(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  const clampPitch = p => Math.max(st.view.lo, Math.min(st.view.hi, p));

  /* ---------- info line ---------- */
  function setInfo(html) { const el = $("#info"); if (el) el.innerHTML = html || "Hover a note to see how it fits the chord. Hover an empty row to see what that note would be."; }
  function describeNote(n) {
    const gr = gradeOf(n) || (MW.ctx.chords.length ? M.grade(MW.ctx, n, false) : null);
    const nm = M.noteName(n.pitch, MW.ctx.flats);
    const head = `<b>${nm}</b> · ${MW.fmtBeats(n.dur)} at bar ${Math.floor(n.start / st.song.bpb) + 1}, beat ${+((n.start % st.song.bpb) + 1).toFixed(2)}${n.label ? " · " + esc(n.label) : ""}`;
    if (!gr) return head + " · no chord under this note";
    return `${head} · <span class="gr ${gr.cls}">${M.CLS_NAME[gr.cls]}</span> ${esc(gr.why)}`;
  }
  function describeRow(p, b) {
    const ctx = MW.ctx; const i = M.chordAt(ctx, b);
    if (i < 0 || b >= ctx.total) return `<b>${M.noteName(p, ctx.flats)}</b> · past the last chord`;
    const kinds = M.rowKinds(ctx, i, st.view.clash === "strict"), k = kinds[((p % 12) + 12) % 12];
    const words = { chord: "a chord tone", scale: "in the chord's scale", avoid: "an avoid note (half step above a chord tone)", out: st.view.clash === "strict" ? "outside the key" : "outside the chord's scale" };
    return `<b>${M.noteName(p, ctx.flats)}</b> over <b>${ctx.chords[i].name}</b> is ${words[k]} (the ${M.T.EXT[((p - ctx.chords[i].root) % 12 + 12) % 12]}).`;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  R.describeNote = describeNote;

  /* ---------- pointer handling ---------- */
  function down(e) {
    if (e.button === 2) return;
    cv.focus({ preventScroll: true });
    const { x, y } = local(e), zone = where(x, y), b = beatAt(x), p = clampPitch(pitchAt(y));
    MW.audio.ensure();
    if (zone === "ruler") {
      drag = { type: "ruler", x0: x, beat0: Math.max(0, MW.snapBeat(b, 1)), moved: false };
      cv.setPointerCapture(e.pointerId); return;
    }
    if (zone === "chords") {
      const i = M.chordAt(MW.ctx, b);
      if (i >= 0 && b < MW.ctx.total) { st.selChord = i; $("#chordEd").hidden = false; MW.render({ chords: true, roll: true }); MW.chords.audition(i); }
      return;
    }
    if (zone === "keys") {
      drag = { type: "keys", pitch: p }; pointer = { pitch: p, inKeys: true };
      MW.input.press(p, 0.8); cv.setPointerCapture(e.pointerId); draw(); return;
    }
    // grid
    if (st.armed) {
      const blk = M.block(st.armed), beat = Math.max(0, MW.floorBeat(b));
      const res = M.generate(blk, st.blockOpt, MW.ctx, beat, p);
      MW.blocks.place(blk, res);
      ghost = null; draw(); return;
    }
    const hit = noteAt(x, y), tool = st.view.tool;
    if (tool === "erase") {
      drag = { type: "erase", did: false };
      if (hit) eraseNote(hit.n);
      cv.setPointerCapture(e.pointerId); return;
    }
    if (hit) {
      const n = hit.n;
      if (e.shiftKey) { if (st.sel.has(n.id)) st.sel.delete(n.id); else st.sel.add(n.id); MW.render({ sel: true, roll: true }); if (!st.sel.has(n.id)) return; }
      else if (!st.sel.has(n.id)) { st.sel = new Set([n.id]); MW.render({ sel: true }); }
      const origin = new Map(MW.notesSel().map(m => [m.id, { start: m.start, pitch: m.pitch, dur: m.dur }]));
      drag = { type: hit.edge ? "resize" : "move", x0: x, y0: y, beat0: b, pitch0: p, origin, moved: false, dup: e.altKey, id: n.id, lastPitch: n.pitch };
      if (!hit.edge) MW.audio.audition(n.pitch, 0.3);
      cv.setPointerCapture(e.pointerId); draw(); return;
    }
    if (tool === "draw") {
      MW.checkpoint();
      const n = { id: MW.uid(), pitch: p, start: Math.max(0, MW.floorBeat(b)), dur: st.lastDur, vel: 0.8, g: null };
      st.song.notes.push(n); st.sel = new Set([n.id]);
      drag = { type: "draw", n, moved: false };
      MW.audio.audition(p, 0.3);
      cv.setPointerCapture(e.pointerId); MW.afterChange({ roll: true, sel: true }); return;
    }
    if (e.pointerType === "touch") { drag = { type: "pan", x0: e.clientX, y0: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop }; cv.setPointerCapture(e.pointerId); return; }
    drag = { type: "marquee", x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, base: new Set(e.shiftKey ? st.sel : []) };
    if (!e.shiftKey && st.sel.size) { st.sel = new Set(); MW.render({ sel: true }); }
    cv.setPointerCapture(e.pointerId);
  }
  function move(e) {
    const { x, y } = local(e), zone = where(x, y), b = beatAt(x), p = clampPitch(pitchAt(y));
    if (!drag) {
      pointer = { pitch: p, inKeys: false, inGrid: zone === "grid" };
      if (zone === "grid" && st.armed) {
        const blk = M.block(st.armed), beat = Math.max(0, MW.floorBeat(b));
        ghost = M.generate(blk, st.blockOpt, MW.ctx, beat, p);
        cv.style.cursor = "copy";
        setInfo(`Placing <b>${esc(blk.name)}</b>: ${esc(ghost.label)}, first note ${M.noteName(ghost.notes[0].pitch, MW.ctx.flats)}. Click to drop it.`);
      } else {
        ghost = null;
        const hit = zone === "grid" ? noteAt(x, y) : null;
        st.hover = hit ? hit.n.id : null;
        cv.style.cursor = zone === "ruler" ? "col-resize" : zone === "chords" || zone === "keys" ? "pointer" : hit ? (hit.edge ? "ew-resize" : "grab") : st.view.tool === "draw" ? "crosshair" : st.view.tool === "erase" ? "not-allowed" : "default";
        if (hit) setInfo(describeNote(hit.n));
        else if (zone === "grid" && MW.ctx.chords.length) setInfo(describeRow(p, b));
        else if (zone === "ruler") setInfo("Click to move the playhead. Drag to set the loop.");
        else if (zone === "chords") setInfo("Click a chord to edit it.");
      }
      draw(); return;
    }
    if (drag.type === "ruler") {
      if (Math.abs(x - drag.x0) > 5) {
        drag.moved = true;
        const bb = Math.max(0, MW.snapBeat(b, 1));
        const a = Math.min(drag.beat0, bb), c = Math.max(drag.beat0, bb);
        if (c > a) { st.song.loop = { on: true, a, b: c }; MW.render({ transport: true }); }
      }
      draw(); return;
    }
    if (drag.type === "keys") {
      if (p !== drag.pitch) { MW.input.release(drag.pitch); drag.pitch = p; pointer = { pitch: p, inKeys: true }; MW.input.press(p, 0.8); draw(); }
      return;
    }
    if (drag.type === "pan") { sc.scrollLeft = drag.sl - (e.clientX - drag.x0); sc.scrollTop = drag.st - (e.clientY - drag.y0); return; }
    if (drag.type === "erase") { const hit = noteAt(x, y); if (hit) eraseNote(hit.n); return; }
    if (drag.type === "marquee") {
      drag.x1 = x; drag.y1 = y;
      const bA = beatAt(Math.min(drag.x0, x)), bB = beatAt(Math.max(drag.x0, x));
      const pA = pitchAt(Math.max(drag.y0, y)), pB = pitchAt(Math.min(drag.y0, y));
      const s = new Set(drag.base);
      st.song.notes.forEach(n => { if (n.start < bB && n.start + n.dur > bA && n.pitch >= pA && n.pitch <= pB) s.add(n.id); });
      st.sel = s; MW.render({ sel: true }); draw(); return;
    }
    if (drag.type === "draw") {
      const n = drag.n, len = Math.max(st.view.snap, Math.ceil((b - n.start) / st.view.snap - 1e-6) * st.view.snap);
      if (Math.abs(x - X(n.start)) > 6) { drag.moved = true; n.dur = len; draw(); }
      return;
    }
    if (drag.type === "move" || drag.type === "resize") {
      if (!drag.moved && Math.abs(x - drag.x0) < 4 && Math.abs(y - drag.y0) < 4) return;
      if (!drag.moved) {
        drag.moved = true; MW.checkpoint();
        if (drag.dup && drag.type === "move") {
          const map = new Map(); const gmap = new Map();
          const copies = MW.notesSel().map(n => { const c = Object.assign({}, n, { id: MW.uid() }); if (n.g != null) { if (!gmap.has(n.g)) gmap.set(n.g, MW.uid("g")); c.g = gmap.get(n.g); } map.set(n.id, c.id); return c; });
          st.song.notes.push(...copies);
          drag.origin = new Map(copies.map(c => [c.id, { start: c.start, pitch: c.pitch, dur: c.dur }]));
          st.sel = new Set(copies.map(c => c.id)); drag.id = map.get(drag.id);
        }
      }
      const snap = st.view.snap;
      if (drag.type === "move") {
        let db = Math.round((b - drag.beat0) / snap) * snap;
        const minStart = Math.min(...[...drag.origin.values()].map(o => o.start));
        if (minStart + db < 0) db = -minStart;
        const dp = p - drag.pitch0;
        st.song.notes.forEach(n => { const o = drag.origin.get(n.id); if (o) { n.start = o.start + db; n.pitch = clampPitch(o.pitch + dp); } });
        const lead = st.song.notes.find(n => n.id === drag.id);
        if (lead && lead.pitch !== drag.lastPitch) { drag.lastPitch = lead.pitch; MW.audio.audition(lead.pitch, 0.25); }
        if (lead) setInfo(describeNote(lead));
      } else {
        const d = Math.round((b - drag.beat0) / snap) * snap;
        st.song.notes.forEach(n => { const o = drag.origin.get(n.id); if (o) n.dur = Math.max(Math.min(snap, 0.25), o.dur + d); });
        const lead = st.song.notes.find(n => n.id === drag.id); if (lead) { st.lastDur = lead.dur; setInfo(describeNote(lead)); }
      }
      MW.refreshCtx(); draw();
    }
  }
  function up(e) {
    const d = drag; drag = null;
    try { cv.releasePointerCapture(e.pointerId); } catch (er) { }
    if (!d) return;
    if (d.type === "ruler") {
      if (!d.moved) {
        st.pos = d.beat0;
        if (st.playing) MW.audio.play(st.pos, { record: st.recording });
      }
      MW.persist(); MW.render({ transport: true, roll: true });
    } else if (d.type === "keys") { MW.input.release(d.pitch); pointer = null; }
    else if (d.type === "draw") { st.lastDur = d.n.dur; MW.afterChange({ roll: true, sel: true }); }
    else if (d.type === "move" || d.type === "resize") {
      if (d.moved) MW.afterChange({ roll: true, sel: true });
      else if (!e.shiftKey) { st.sel = new Set([d.id]); MW.render({ sel: true }); }
    } else if (d.type === "erase") { if (d.did) MW.afterChange({ roll: true, sel: true }); }
    draw();
  }
  function eraseNote(n) {
    if (!drag.did) { MW.checkpoint(); drag.did = true; }
    st.song.notes = st.song.notes.filter(m => m.id !== n.id); st.sel.delete(n.id);
    MW.refreshCtx(); draw();
  }
  function dbl(e) {
    const { x, y } = local(e); if (where(x, y) !== "grid" || st.armed) return;
    const hit = noteAt(x, y);
    if (hit) {
      const n = hit.n;
      st.sel = new Set(st.song.notes.filter(m => n.g != null ? m.g === n.g : m.id === n.id).map(m => m.id));
      MW.render({ sel: true, roll: true }); return;
    }
    if (st.view.tool !== "select") return;
    MW.commit(() => {
      const n = { id: MW.uid(), pitch: clampPitch(pitchAt(y)), start: Math.max(0, MW.floorBeat(beatAt(x))), dur: st.lastDur, vel: 0.8, g: null };
      st.song.notes.push(n); st.sel = new Set([n.id]);
      MW.audio.audition(n.pitch, 0.3);
    }, { roll: true, sel: true });
  }

  MW.on(w => {
    if (w.playhead && Object.keys(w).length === 1) draw();
    else R.resize();
    if (w.playhead && st.playing && st.view.follow) {
      const x = st.pos * st.view.ppb;
      if (x > sc.scrollLeft + W - KW - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 60);
    }
  });
})();
