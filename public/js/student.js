// 生徒画面
(function () {
  const { CFG, api, classCode, el, svg, poll, circlePoints, pointsToPath, mullerLyer } = window.App;
  const app = document.getElementById('app');
  const connEl = document.getElementById('conn');
  const STAGE_MARK = { 1: '①', 2: '②', 3: '③', 4: '④' };

  // ---------- 端末ID ----------
  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = (Math.random() * 256) | 0));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  let clientId = null;
  try {
    clientId = localStorage.getItem('uts_client_id');
  } catch {
    /* 保存できない環境 */
  }
  if (!clientId) {
    clientId = makeId();
    try {
      localStorage.setItem('uts_client_id', clientId);
    } catch {
      /* 保存できない環境では、このページを開いている間だけ有効 */
    }
  }

  const cls = classCode();
  document.getElementById('brand').textContent = CFG.TITLE;

  if (!cls) {
    classForm();
    return;
  }

  let screenKey = null;
  let controller = null;

  function screenOf(s) {
    if (s.stage === 9) return 'end';
    if (s.stage === 0 || ![1, 2, 3, 4].includes(s.stage)) return 'start';
    if (s.waiting) return 'wait';
    const done = s.mine && s.mine[s.stage] ? 'd' : 't';
    const reveal = s.stage === 4 && done === 'd' && s.reveal ? 'r' : '';
    return `s${s.stage}${done}${reveal}`;
  }

  async function refresh() {
    let s;
    try {
      s = await api.get(`/api/state?class=${encodeURIComponent(cls)}&client_id=${encodeURIComponent(clientId)}`);
      connEl.classList.add('hidden');
    } catch (e) {
      if (e.status === 403) {
        show('bad', () => message('クラスコードが見つかりません', 'URL をもう一度確かめてください。'));
        return;
      }
      connEl.classList.remove('hidden');
      return;
    }
    const key = screenOf(s);
    if (key === screenKey) return;
    show(key, () => build(key, s));
  }

  function show(key, factory) {
    if (key === screenKey) return;
    screenKey = key;
    if (controller && controller.destroy) controller.destroy();
    app.replaceChildren();
    controller = factory() || null;
  }

  // 回答を送ったあと、次の取得で画面を作り直さないようにする
  function markDone(stage) {
    screenKey = `s${stage}d`;
  }

  function build(key, s) {
    if (key === 'start') return message(CFG.TITLE, CFG.SUBTITLE, CFG.START_TEXT, true);
    if (key === 'wait') return message(CFG.WAIT_TEXT, CFG.WAIT_SUB, null, true);
    if (key === 'end') return message(CFG.END_TEXT, CFG.END_SUB);
    const mine = (s.mine || {})[s.stage];
    if (s.stage === 1) return stageCircle(mine);
    if (s.stage === 2) return stageWords(mine);
    if (s.stage === 3) return stageBaby(mine);
    if (s.stage === 4) return stageLines(mine, !!s.reveal);
  }

  function message(title, sub, note, breathe) {
    app.append(
      el(
        'div',
        { class: 'center-screen' },
        breathe ? el('div', { class: 'wait-mark' }) : null,
        el('h1', { text: title }),
        sub ? el('p', { class: 'sub', text: sub }) : null,
        note ? el('p', { class: 'sub', text: note }) : null
      )
    );
  }

  function header(stage, hintText) {
    const c = CFG.stages[stage];
    const hint = el('p', { class: 'hint', text: hintText || c.hint || '' });
    app.append(
      el('div', { class: 'stage-tag', text: `${STAGE_MARK[stage]} ${c.label}` }),
      el('p', { class: 'question', text: c.question }),
      hint
    );
    return hint;
  }

  async function send(stage, payload) {
    return api.post('/api/answer', { class: cls, stage, client_id: clientId, payload });
  }

  function classForm() {
    const input = el('input', { type: 'text', placeholder: 'クラスコード', autocapitalize: 'off', autocomplete: 'off' });
    const go = () => {
      const v = input.value.trim();
      if (v) location.search = '?c=' + encodeURIComponent(v);
    };
    app.append(
      el(
        'div',
        { class: 'center-screen' },
        el('h1', { text: CFG.TITLE }),
        el('p', { class: 'sub', text: 'クラスコードを入れてください。' }),
        el('div', { class: 'classform' }, input, el('button', { class: 'btn primary', onclick: go, text: 'はじめる' }))
      )
    );
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  }

  // =====================================================
  // ① 円を描く
  // =====================================================
  function analyzeStroke(raw) {
    if (raw.length < 8) return null;
    // 弧長で等間隔に並べ直す（描く速さで点の密度が偏らないように）
    let total = 0;
    for (let i = 1; i < raw.length; i++) total += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    if (total < 1e-6) return null;
    const N = Math.max(64, Math.min(1000, Math.round(total / 0.004)));
    const step = total / N;
    const pts = [raw[0]];
    let acc = 0;
    for (let i = 1; i < raw.length; i++) {
      let [x0, y0] = raw[i - 1];
      const [x1, y1] = raw[i];
      let seg = Math.hypot(x1 - x0, y1 - y0);
      while (acc + seg >= step && seg > 0) {
        const t = (step - acc) / seg;
        x0 += (x1 - x0) * t;
        y0 += (y1 - y0) * t;
        pts.push([x0, y0]);
        seg = Math.hypot(x1 - x0, y1 - y0);
        acc = 0;
      }
      acc += seg;
    }

    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;

    const d = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
    const R = d.reduce((a, b) => a + b, 0) / d.length;
    const rms = Math.sqrt(d.reduce((a, b) => a + (b - R) ** 2, 0) / d.length);

    // 重心のまわりを何度まわったか
    let sweep = 0;
    let prev = Math.atan2(pts[0][1] - cy, pts[0][0] - cx);
    for (let i = 1; i < pts.length; i++) {
      const a = Math.atan2(pts[i][1] - cy, pts[i][0] - cx);
      let da = a - prev;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      sweep += da;
      prev = a;
    }

    const scale = CFG.stages[1].SCORE_SCALE || 3;
    const score = Math.max(0, Math.min(100, 100 - scale * (rms / R) * 100));

    // 64方向ごとの半径（平均半径で割る）
    const B = 64;
    const sum = new Array(B).fill(0);
    const cnt = new Array(B).fill(0);
    pts.forEach((p, i) => {
      let a = Math.atan2(p[1] - cy, p[0] - cx);
      if (a < 0) a += 2 * Math.PI;
      const k = Math.min(B - 1, Math.floor((a / (2 * Math.PI)) * B));
      sum[k] += d[i] / R;
      cnt[k]++;
    });
    const r = new Array(B).fill(null);
    for (let k = 0; k < B; k++) if (cnt[k]) r[k] = sum[k] / cnt[k];
    for (let k = 0; k < B; k++) {
      if (r[k] !== null) continue;
      let a = 1;
      let b = 1;
      while (r[(k - a + B) % B] === null && a < B) a++;
      while (r[(k + b) % B] === null && b < B) b++;
      const va = r[(k - a + B) % B];
      const vb = r[(k + b) % B];
      r[k] = va === null || vb === null ? 1 : va + ((vb - va) * a) / (a + b);
    }
    const rOut = r.map((v) => Math.round(Math.max(0, Math.min(3, v)) * 1000) / 1000);

    return { cx, cy, R, score, sweep: Math.abs(sweep), r: rOut };
  }

  function stageCircle(mine) {
    const hint = header(1);
    const canvas = el('canvas', { class: 'draw' });
    const wrap = el('div', { class: 'canvas-wrap' }, canvas);
    const scoreEl = el('div', { class: 'score hidden' });
    const actions = el('div', { class: 'actions' });
    const note = el('div', { class: 'done-note hidden' });
    app.append(wrap, scoreEl, actions, note);

    const ctx = canvas.getContext('2d');
    let size = 300;
    let phase = mine ? 'saved' : 'draw'; // draw | drawing | result | sending | saved
    let stroke = []; // 0〜1 に正規化した座標
    let result = null;
    let attempts = 0;
    let pointerId = null;

    function layout() {
      const w = Math.min(app.clientWidth - 8, 720);
      const top = canvas.getBoundingClientRect().top + window.scrollY;
      const h = window.innerHeight - top - 190;
      size = Math.max(240, Math.min(w, h));
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function redraw() {
      ctx.clearRect(0, 0, size, size);
      if (phase === 'saved' && mine) {
        const rr = size * 0.36;
        drawPath(circlePoints(mine.r, size / 2, size / 2, rr), true, '#2a2826', 4);
        dashed(size / 2, size / 2, rr);
        return;
      }
      if (stroke.length) drawPath(stroke.map((p) => [p[0] * size, p[1] * size]), false, '#2a2826', 4);
      if (result && (phase === 'result' || phase === 'sending' || phase === 'saved')) {
        dashed(result.cx * size, result.cy * size, result.R * size);
      }
    }

    function drawPath(pts, closed, color, width) {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (closed) ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    function dashed(x, y, r) {
      ctx.save();
      ctx.setLineDash([7, 8]);
      ctx.strokeStyle = '#c2553d';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function showScore(score) {
      scoreEl.classList.remove('hidden');
      scoreEl.replaceChildren(
        el('span', { class: 'label', text: '真円度' }),
        el('span', { class: 'value', text: String(Math.round(score)) }),
        el('span', { class: 'unit', text: '％' })
      );
    }

    function setActions() {
      actions.replaceChildren();
      if (phase === 'result' || phase === 'sending') {
        if (attempts < 2) {
          actions.append(
            el('button', { class: 'btn', onclick: retry, disabled: phase === 'sending', text: 'もう一度描く（1回だけ）' })
          );
        }
        actions.append(el('button', { class: 'btn primary', onclick: submit, disabled: phase === 'sending', text: 'これで決定' }));
      }
    }

    function retry() {
      stroke = [];
      result = null;
      phase = 'draw';
      scoreEl.classList.add('hidden');
      hint.className = 'hint';
      hint.textContent = 'あと1回だけ描けます。';
      setActions();
      redraw();
    }

    async function submit() {
      if (!result) return;
      phase = 'sending';
      setActions();
      try {
        await send(1, { r: result.r, score: Math.round(result.score * 10) / 10 });
        phase = 'saved';
        markDone(1);
        actions.replaceChildren();
        hint.textContent = '';
        note.textContent = '送信しました。前を見て待っていてね。';
        note.classList.remove('hidden');
      } catch {
        phase = 'result';
        setActions();
        hint.className = 'hint warn';
        hint.textContent = '送信できませんでした。もう一度「これで決定」を押してください。';
      }
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
    }

    function onDown(e) {
      e.preventDefault();
      if (phase !== 'draw' || !e.isPrimary) return;
      pointerId = e.pointerId;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 何もしない */
      }
      phase = 'drawing';
      stroke = [pos(e)];
      hint.className = 'hint';
      hint.textContent = CFG.stages[1].hint;
      redraw();
    }
    function onMove(e) {
      e.preventDefault();
      if (phase !== 'drawing' || e.pointerId !== pointerId) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) stroke.push(pos(ev));
      redraw();
    }
    function onUp(e) {
      if (phase !== 'drawing' || e.pointerId !== pointerId) return;
      e.preventDefault();
      pointerId = null;
      const res = analyzeStroke(stroke);
      if (!res || res.sweep < (300 * Math.PI) / 180 || res.R < 0.1) {
        // 回数には数えない
        stroke = [];
        phase = 'draw';
        hint.className = 'hint warn';
        hint.textContent = 'ぐるっと一周してね';
        redraw();
        return;
      }
      attempts++;
      result = res;
      phase = 'result';
      hint.className = 'hint';
      hint.textContent = attempts < 2 ? '点線は、完璧な円です。' : 'これが最後の1回です。';
      showScore(res.score);
      setActions();
      redraw();
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const onResize = () => phase !== 'drawing' && layout();
    window.addEventListener('resize', onResize);

    if (mine) {
      hint.textContent = '';
      showScore(mine.score);
      note.textContent = '回答済みです。';
      note.classList.remove('hidden');
    }
    requestAnimationFrame(layout);

    return { destroy: () => window.removeEventListener('resize', onResize) };
  }

  // =====================================================
  // ② 美しいもの仲間分け
  // =====================================================
  function stageWords(mine) {
    const conf = CFG.stages[2];
    const hint = header(2);
    const selected = new Set(mine ? mine.selected : []);
    const grid = el('div', { class: 'cards' });
    const actions = el('div', { class: 'actions' });
    const note = el('div', { class: 'done-note hidden' });
    const cards = conf.words.map((w) => {
      const b = el('button', { class: 'card', 'aria-pressed': selected.has(w) ? 'true' : 'false', text: w, disabled: !!mine });
      b.addEventListener('click', () => {
        if (selected.has(w)) selected.delete(w);
        else selected.add(w);
        b.setAttribute('aria-pressed', selected.has(w) ? 'true' : 'false');
      });
      return b;
    });
    grid.append(...cards);
    app.append(grid, actions, note);

    function done(text) {
      cards.forEach((c) => (c.disabled = true));
      actions.replaceChildren();
      hint.textContent = '';
      note.textContent = text;
      note.classList.remove('hidden');
    }

    if (mine) {
      done('回答済みです。');
      return;
    }

    const go = el('button', { class: 'btn primary', text: '決定' });
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await send(2, { selected: conf.words.filter((w) => selected.has(w)) });
        markDone(2);
        done('送信しました。前を見て待っていてね。');
      } catch {
        go.disabled = false;
        hint.className = 'hint warn';
        hint.textContent = '送信できませんでした。もう一度「決定」を押してください。';
      }
    });
    actions.append(go);
  }

  // =====================================================
  // ③ 赤ちゃんの問い
  // =====================================================
  function stageBaby(mine) {
    const conf = CFG.stages[3];
    app.append(el('div', { class: 'stage-tag', text: `${STAGE_MARK[3]} ${conf.label}` }), el('p', { class: 'question', text: conf.question }));
    const box = el('div', { class: 'choices' });
    app.append(box);

    if (conf.mode !== 'vote') {
      box.append(...conf.choices.map((c) => el('div', { class: 'choice static', text: c.label })));
      app.append(el('p', { class: 'hand', text: conf.handText }));
      return;
    }

    const note = el('div', { class: 'done-note hidden' });
    app.append(note);
    const buttons = conf.choices.map((c) => {
      const b = el('button', {
        class: 'choice',
        'aria-pressed': mine && mine.choice === c.id ? 'true' : 'false',
        disabled: !!mine,
        text: c.label,
      });
      b.addEventListener('click', async () => {
        buttons.forEach((x) => (x.disabled = true));
        b.setAttribute('aria-pressed', 'true');
        try {
          await send(3, { choice: c.id });
          markDone(3);
          note.textContent = '投票しました。前を見て待っていてね。';
          note.classList.remove('hidden');
        } catch {
          b.setAttribute('aria-pressed', 'false');
          buttons.forEach((x) => (x.disabled = false));
          note.textContent = '送信できませんでした。もう一度えらんでください。';
          note.classList.remove('hidden');
        }
      });
      return b;
    });
    box.append(...buttons);
    if (mine) {
      note.textContent = '投票済みです。';
      note.classList.remove('hidden');
    }
  }

  // =====================================================
  // ④ 錯視の線
  // =====================================================
  // 矢羽根は線の長さの約25％。下の線は左右にずらして、端を縦にそろえて比べられないようにする
  const LINE = { W: 1000, H: 560, LA: 360, FIN: 90, YA: 170, YB: 400, STROKE: 6, SHIFT_MIN: 60, SHIFT_MAX: 120 };

  function linesSvg(ratio, opts) {
    const o = opts || {};
    const cx = LINE.W / 2;
    const bx = cx + (o.shift || 0);
    const g = svg('svg', { viewBox: `0 0 ${LINE.W} ${LINE.H}`, class: 'lines-svg', role: 'img', 'aria-label': '二本の線' });
    if (o.guides) {
      for (const x of [cx - LINE.LA / 2, cx + LINE.LA / 2]) {
        g.append(
          svg('line', {
            x1: x,
            x2: x,
            y1: LINE.YA - 90,
            y2: LINE.YB + 90,
            stroke: '#c2553d',
            'stroke-width': 3,
            'stroke-dasharray': '10 9',
          })
        );
      }
    }
    g.append(mullerLyer(cx, LINE.YA, LINE.LA, 'in', LINE.FIN, { width: LINE.STROKE }));
    let b = mullerLyer(bx, LINE.YB, LINE.LA * ratio, 'out', LINE.FIN, { width: LINE.STROKE });
    g.append(b);
    function setB(r) {
      const next = mullerLyer(bx, LINE.YB, LINE.LA * r, 'out', LINE.FIN, { width: LINE.STROKE });
      b.replaceWith(next);
      b = next;
    }
    return { svg: g, setB };
  }

  function numberLine(mineRatio) {
    const conf = CFG.stages[4];
    const W = 1000;
    const H = 150;
    const pad = 60;
    const x = (v) => pad + ((v - conf.MIN) / (conf.MAX - conf.MIN)) * (W - pad * 2);
    const clamp = (v) => Math.max(conf.MIN, Math.min(conf.MAX, v));
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lines-svg', style: 'margin-top:14px' });
    g.append(svg('line', { x1: pad, x2: W - pad, y1: 80, y2: 80, stroke: '#cfc7b8', 'stroke-width': 4 }));
    for (let v = conf.MIN; v <= conf.MAX + 1e-9; v += 0.1) {
      const t = svg('text', { x: x(v), y: 125, 'text-anchor': 'middle', 'font-size': 22, fill: '#6b665e' });
      t.textContent = v.toFixed(1);
      g.append(svg('line', { x1: x(v), x2: x(v), y1: 72, y2: 88, stroke: '#cfc7b8', 'stroke-width': 3 }), t);
    }
    g.append(svg('line', { x1: x(1), x2: x(1), y1: 30, y2: 100, stroke: '#c2553d', 'stroke-width': 6 }));
    const tc = svg('text', { x: x(1), y: 24, 'text-anchor': 'middle', 'font-size': 24, fill: '#c2553d', 'font-weight': 700 });
    tc.textContent = '正解';
    const mx = x(clamp(mineRatio));
    g.append(svg('circle', { cx: mx, cy: 80, r: 14, fill: '#34507a' }));
    const tm = svg('text', { x: mx, y: 52, 'text-anchor': 'middle', 'font-size': 24, fill: '#34507a', 'font-weight': 700 });
    tm.textContent = 'あなた';
    g.append(tc, tm);
    return g;
  }

  function stageLines(mine, reveal) {
    const conf = CFG.stages[4];
    const hint = header(4);

    if (mine) {
      hint.textContent = '';
      const fig = linesSvg(mine.ratio, { guides: reveal });
      app.append(fig.svg);
      if (reveal) {
        app.append(
          numberLine(mine.ratio),
          el(
            'p',
            { class: 'compare' },
            'あなたの答え：上の線の ',
            el('b', { text: mine.ratio.toFixed(2) }),
            ' 倍　／　ほんとうは ',
            el('b', { text: '1.00' }),
            ' 倍（同じ長さ）'
          )
        );
      } else {
        app.append(el('div', { class: 'done-note', text: '回答済みです。前を見て待っていてね。' }));
      }
      return;
    }

    let ratio = conf.START_MIN + Math.random() * (conf.START_MAX - conf.START_MIN);
    const shift = (Math.random() < 0.5 ? -1 : 1) * (LINE.SHIFT_MIN + Math.random() * (LINE.SHIFT_MAX - LINE.SHIFT_MIN));
    const fig = linesSvg(ratio, { shift });
    const slider = el('input', {
      type: 'range',
      class: 'big',
      min: conf.MIN,
      max: conf.MAX,
      step: 0.001,
      value: ratio.toFixed(3),
      'aria-label': '下の線の長さ',
    });
    slider.addEventListener('input', () => {
      ratio = Number(slider.value);
      fig.setB(ratio);
      if (!moved) {
        moved = true;
        go.disabled = false;
      }
    });
    // 一度もスライダーを動かしていないうちは決定できない
    let moved = false;
    const go = el('button', { class: 'btn primary', text: 'これで決定', disabled: true });
    const actions = el('div', { class: 'actions' }, go);
    app.append(fig.svg, el('div', { class: 'slider-row' }, slider), actions);

    go.addEventListener('click', async () => {
      go.disabled = true;
      slider.disabled = true;
      try {
        await send(4, { ratio: Math.round(ratio * 10000) / 10000 });
        markDone(4);
        actions.replaceChildren(el('div', { class: 'done-note', text: '送信しました。前を見て待っていてね。' }));
        hint.textContent = '';
      } catch {
        go.disabled = !moved;
        slider.disabled = false;
        hint.className = 'hint warn';
        hint.textContent = '送信できませんでした。もう一度「これで決定」を押してください。';
      }
    });
  }

  // iPad Safari のピンチ拡大を止める
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  poll(refresh, CFG.POLL_MS || 2000);
})();
