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

  // 制限時間のあいだ、何回でも描ける。描いた円は1本ずつすぐに送る
  // 1本目は端末IDのまま（＝回答済みの印）、2本目以降は端末IDに番号を付けて保存する
  function stageCircle(mine) {
    const conf = CFG.stages[1];
    const LIMIT = conf.TIME_LIMIT || 30;
    const MAX = conf.MAX_CIRCLES || 30;
    const hint = header(1);
    const status = el('div', { class: 'circle-status' });
    const canvas = el('canvas', { class: 'draw' });
    const wrap = el('div', { class: 'canvas-wrap' }, canvas);
    const scoreEl = el('div', { class: 'score hidden' });
    const comment = el('div', { class: 'circle-comment' });
    // 一周までの進み具合（円の形のガイドにならないよう、横棒で示す）
    const meterFill = el('div', { class: 'loop-meter-fill' });
    const meter = el('div', { class: 'loop-meter', 'aria-hidden': 'true' }, meterFill);
    const actions = el('div', { class: 'actions' });
    const note = el('div', { class: 'done-note hidden' });
    app.append(status, wrap, meter, scoreEl, comment, actions, note);

    const ctx = canvas.getContext('2d');
    let size = 300;
    let phase = mine ? 'over' : 'ready'; // ready | drawing | between | over
    let stroke = []; // 0〜1 に正規化した座標
    let result = null;
    let pointerId = null;
    let reveal = 1;
    let fade = 1; // 前の円の濃さ（次を描けるようになると薄れて消える）
    let anim = 0;
    let count = 0;
    let endAt = 0;
    let timer = null;
    const mineCircles = []; // この端末で描いた円（64方向の半径）
    let pending = Promise.resolve();

    function layout() {
      const w = Math.min(app.clientWidth - 8, 720);
      const top = canvas.getBoundingClientRect().top + window.scrollY;
      const h = window.innerHeight - top - 250;
      size = Math.max(240, Math.min(w, h));
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function setStatus() {
      if (phase === 'over') {
        status.replaceChildren();
        return;
      }
      const left = endAt ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) : LIMIT;
      status.replaceChildren(
        el('span', { class: 'timer' + (endAt && left <= 5 ? ' hurry' : '') }, '残り ', el('b', { text: String(left) }), ' 秒'),
        el('span', { class: 'count' }, '描いた円 ', el('b', { text: String(count) }), ' 本')
      );
    }

    function updateMeter() {
      if (phase !== 'drawing' || stroke.length < 3) {
        meter.classList.toggle('on', phase === 'drawing');
        meterFill.style.width = '0%';
        meter.classList.remove('full');
        return;
      }
      let cx = 0;
      let cy = 0;
      for (const p of stroke) {
        cx += p[0];
        cy += p[1];
      }
      cx /= stroke.length;
      cy /= stroke.length;
      let sweep = 0;
      let prev = Math.atan2(stroke[0][1] - cy, stroke[0][0] - cx);
      for (let i = 1; i < stroke.length; i++) {
        const a = Math.atan2(stroke[i][1] - cy, stroke[i][0] - cx);
        let da = a - prev;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        sweep += da;
        prev = a;
      }
      const f = Math.min(1, Math.abs(sweep) / ((300 * Math.PI) / 180));
      meter.classList.add('on');
      meter.classList.toggle('full', f >= 1);
      meterFill.style.width = (f * 100).toFixed(1) + '%';
    }

    function redraw() {
      ctx.clearRect(0, 0, size, size);
      if (phase === 'over') {
        // 自分が描いた円をすべて、同じ中心・同じ大きさで重ねる
        const rr = size * 0.36;
        const list = mineCircles.length ? mineCircles : mine ? [mine.r] : [];
        const alpha = Math.max(0.25, Math.min(0.9, 2.5 / Math.max(1, list.length)));
        for (const r of list) drawPath(circlePoints(r, size / 2, size / 2, rr), true, `rgba(42,40,38,${alpha})`, 3);
        dashed(size / 2, size / 2, rr);
        return;
      }
      ctx.save();
      ctx.globalAlpha = fade;
      if (stroke.length) drawPath(stroke.map((p) => [p[0] * size, p[1] * size]), false, '#2a2826', 4);
      if (result && phase === 'between') dashed(result.cx * size, result.cy * size, result.R * size, Math.min(1, reveal / 0.6));
      ctx.restore();
      // 描ける状態のときは、キャンバスの中に案内を出す
      if ((phase === 'ready' || phase === 'between') && fade < 0.35) {
        ctx.save();
        ctx.globalAlpha = 1 - fade / 0.35;
        ctx.fillStyle = '#9a9387';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(size * 0.05)}px ${getComputedStyle(document.body).fontFamily}`;
        ctx.fillText(count ? 'つぎの円をどうぞ' : 'ここに描いてね', size / 2, size / 2);
        ctx.restore();
      }
    }

    // 結果を見せたあと、前の円をすっと消して「次を描ける」状態に
    function fadeOut(id) {
      const start = performance.now();
      function frame(now) {
        if (id !== anim) return;
        fade = Math.max(0, 1 - (now - start) / 500);
        redraw();
        if (fade > 0) requestAnimationFrame(frame);
        else {
          stroke = [];
          result = null;
          canvas.classList.add('ready');
          redraw();
        }
      }
      requestAnimationFrame(frame);
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

    function dashed(x, y, r, frac) {
      const f = frac === undefined ? 1 : frac;
      if (f <= 0) return;
      ctx.save();
      ctx.setLineDash([7, 8]);
      ctx.strokeStyle = '#c2553d';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      ctx.stroke();
      ctx.restore();
    }

    function showScore(score, shown) {
      scoreEl.classList.remove('hidden');
      scoreEl.replaceChildren(
        el('span', { class: 'label', text: '真円度' }),
        el('span', { class: 'value', text: String(Math.round(shown === undefined ? score : shown)) }),
        el('span', { class: 'unit', text: '％' })
      );
    }

    // 点数にそえるひとこと（「美しさ」の評価にはしない）
    function circleComment(score) {
      for (const c of conf.comments || []) if (score >= c.min) return c.text;
      return '';
    }

    // 点線の円がぐるりと描かれ、数字が数え上がる
    function playResult(res) {
      const start = performance.now();
      const dur = 800;
      const id = ++anim;
      comment.classList.remove('show');
      scoreEl.classList.remove('bump');
      function frame(now) {
        if (id !== anim) return;
        reveal = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - reveal, 3);
        showScore(res.score, res.score * e);
        redraw();
        if (reveal < 1) requestAnimationFrame(frame);
        else {
          showScore(res.score);
          scoreEl.classList.add('bump');
          comment.textContent = circleComment(res.score);
          comment.classList.add('show');
          // 1.2秒見せてから、前の円を消す
          setTimeout(() => id === anim && phase === 'between' && fadeOut(id), 1200);
        }
      }
      requestAnimationFrame(frame);
    }

    function sendCircle(res, n) {
      const cid = n === 1 ? clientId : `${clientId}-${n}`;
      const payload = { r: res.r, score: Math.round(res.score * 10) / 10 };
      // 失敗したら2回まで送り直す
      const attempt = (k) =>
        api.post('/api/answer', { class: cls, stage: 1, client_id: cid, payload }).catch((e) => {
          if (k < 2) return new Promise((ok) => setTimeout(ok, 800)).then(() => attempt(k + 1));
          throw e;
        });
      pending = pending.then(() => attempt(0)).catch(() => {
        hint.className = 'hint warn';
        hint.textContent = '送れなかった円があります。通信を確かめてください。';
      });
      if (n === 1) markDone(1);
    }

    function startTimer() {
      endAt = Date.now() + LIMIT * 1000;
      timer = setInterval(() => {
        setStatus();
        if (Date.now() >= endAt && phase !== 'drawing') finish();
      }, 250);
    }

    function finish() {
      if (phase === 'over') return;
      // 1本も描けていなければ、描けるまで待つ
      if (!count) {
        hint.className = 'hint warn';
        hint.textContent = '時間です。最後に1本だけ、ぐるっと描いてください。';
        return;
      }
      clearInterval(timer);
      phase = 'over';
      anim++;
      fade = 1;
      canvas.classList.remove('ready');
      stroke = [];
      result = null;
      updateMeter();
      scoreEl.classList.add('hidden');
      comment.classList.remove('show');
      actions.replaceChildren();
      hint.className = 'hint';
      hint.textContent = `おわり！ ${count} 本の円を描きました。`;
      setStatus();
      redraw();
      pending.then(() => {
        note.textContent = '送信しました。前を見て待っていてね。';
        note.classList.remove('hidden');
      });
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
    }

    function onDown(e) {
      e.preventDefault();
      if ((phase !== 'ready' && phase !== 'between') || !e.isPrimary) return;
      if (!endAt) startTimer();
      pointerId = e.pointerId;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 何もしない */
      }
      anim++;
      fade = 1;
      canvas.classList.remove('ready');
      phase = 'drawing';
      result = null;
      stroke = [pos(e)];
      scoreEl.classList.add('hidden');
      comment.classList.remove('show');
      hint.className = 'hint';
      hint.textContent = conf.hint;
      updateMeter();
      redraw();
    }
    function onMove(e) {
      e.preventDefault();
      if (phase !== 'drawing' || e.pointerId !== pointerId) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) stroke.push(pos(ev));
      redraw();
      updateMeter();
    }
    function onUp(e) {
      if (phase !== 'drawing' || e.pointerId !== pointerId) return;
      e.preventDefault();
      pointerId = null;
      const res = analyzeStroke(stroke);
      phase = 'between';
      updateMeter();
      if (!res || res.sweep < (300 * Math.PI) / 180 || res.R < 0.1) {
        // 本数には数えない
        stroke = [];
        fade = 0;
        canvas.classList.add('ready');
        hint.className = 'hint warn';
        hint.textContent = 'ぐるっと一周してね';
        canvas.classList.remove('shake');
        void canvas.offsetWidth;
        canvas.classList.add('shake');
        redraw();
      } else {
        count++;
        result = res;
        mineCircles.push(res.r);
        sendCircle(res, count);
        hint.className = 'hint';
        hint.textContent = count >= MAX ? 'ここまでです。' : '点線は、完璧な円です。もう一度描けます。';
        reveal = 0;
        playResult(res);
      }
      setStatus();
      if (count >= MAX || (endAt && Date.now() >= endAt && count)) setTimeout(finish, 900);
      else if (count && !actions.childElementCount) {
        actions.append(el('button', { class: 'btn', onclick: finish, text: 'これで終わる' }));
      }
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
      hint.textContent = '回答済みです。';
      note.classList.add('hidden');
    } else {
      hint.textContent = `制限時間は ${LIMIT} 秒。描き始めるとスタートします。`;
      fade = 0;
      canvas.classList.add('ready');
    }
    setStatus();
    requestAnimationFrame(layout);

    return {
      destroy: () => {
        window.removeEventListener('resize', onResize);
        clearInterval(timer);
        anim++;
      },
    };
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

  // ブレンターノ型（1本の線を真ん中の点で2つに分ける形）
  // 矢羽根が内向きの側を「in」、外向きの側を「out」とし、比率は out ÷ in
  const BREN = { W: 1000, H: 380, T: 640, FIN: 80, Y: 190, STROKE: 6 };

  function brentanoPath(cx, y, T, ratio, flip, fin) {
    const lin = T / (1 + ratio);
    const x0 = cx - T / 2;
    const x1 = cx + T / 2;
    const xm = flip ? x1 - lin : x0 + lin;
    const dx = fin * Math.cos(Math.PI / 5);
    const dy = fin * Math.sin(Math.PI / 5);
    const s = flip ? -1 : 1;
    const v = (x, dir) => `M${x + dir * dx} ${y - dy}L${x} ${y}L${x + dir * dx} ${y + dy}`;
    return { d: `M${x0} ${y}L${x1} ${y}` + v(x0, s) + v(xm, -s) + v(x1, s), x0, x1, xm };
  }

  function brentanoSvg(ratio, opts) {
    const o = opts || {};
    const cx = BREN.W / 2;
    const g = svg('svg', { viewBox: `0 0 ${BREN.W} ${BREN.H}`, class: 'lines-svg', role: 'img', 'aria-label': '真ん中に点のある線' });
    const path = svg('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': BREN.STROKE, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const dot = svg('circle', { r: 11, cy: BREN.Y, fill: '#34507a' });
    if (o.truth) {
      g.append(
        svg('line', { x1: cx, x2: cx, y1: BREN.Y - 120, y2: BREN.Y + 110, stroke: '#c2553d', 'stroke-width': 3, 'stroke-dasharray': '10 9' })
      );
      const t = svg('text', { x: cx, y: BREN.Y - 132, 'text-anchor': 'middle', 'font-size': 26, fill: '#c2553d', 'font-weight': 700 });
      t.textContent = 'ほんとうの真ん中';
      g.append(t);
    }
    g.append(path, dot);
    function set(r) {
      const b = brentanoPath(cx, BREN.Y, BREN.T, r, !!o.flip, BREN.FIN);
      path.setAttribute('d', b.d);
      dot.setAttribute('cx', b.xm);
    }
    set(ratio);
    return { svg: g, set };
  }

  // 長方形（面積は一定のまま、横÷縦の比 k を変える）。保存するのは 縦÷横（= 1/k）
  const RECT = { W: 1000, H: 600, AREA: 250000 };

  function rectSvg(k, opts) {
    const o = opts || {};
    const W = o.W || RECT.W;
    const H = o.H || RECT.H;
    const area = o.area || RECT.AREA;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lines-svg', role: 'img', 'aria-label': '長方形', style: o.style || '' });
    const r = svg('rect', { fill: '#e6ecf4', stroke: '#2a2826', 'stroke-width': 5, rx: 2 });
    g.append(r);
    function set(kk) {
      const w = Math.sqrt(area * kk);
      const h = Math.sqrt(area / kk);
      r.setAttribute('x', (W - w) / 2);
      r.setAttribute('y', (H - h) / 2);
      r.setAttribute('width', w);
      r.setAttribute('height', h);
    }
    set(k);
    return { svg: g, set };
  }

  const fmtK = (k) => k.toFixed(2);

  function stageRect(mine, reveal) {
    const conf = CFG.stages[4];
    const hint = header(4);

    if (mine) {
      hint.textContent = '';
      const myK = 1 / mine.ratio;
      if (!reveal) {
        app.append(rectSvg(myK).svg, el('div', { class: 'done-note', text: '回答済みです。前を見て待っていてね。' }));
        return;
      }
      // 自分の長方形とクラスの平均を並べる
      const pair = el('div', { class: 'rect-pair' });
      const mineBox = el(
        'figure',
        null,
        rectSvg(myK, { W: 600, H: 420, area: 70000 }).svg,
        el('figcaption', null, 'あなた　横は縦の ', el('b', { text: fmtK(myK) }), ' 倍')
      );
      pair.append(mineBox);
      app.append(pair);
      api
        .get(`/api/results?class=${encodeURIComponent(cls)}&stage=4`)
        .then((res) => {
          const ks = res.answers.map((a) => 1 / a.ratio);
          if (!ks.length) return;
          const avg = ks.reduce((x, y) => x + y, 0) / ks.length;
          pair.append(
            el(
              'figure',
              null,
              rectSvg(avg, { W: 600, H: 420, area: 70000 }).svg,
              el('figcaption', null, `クラスの平均（${ks.length}人）　`, el('b', { text: fmtK(avg) }), ' 倍')
            )
          );
        })
        .catch(() => {});
      return;
    }

    let k = conf.RECT_START_MIN + Math.random() * (conf.RECT_START_MAX - conf.RECT_START_MIN);
    const fig = rectSvg(k);
    const toK = (v) => conf.RECT_MIN + (v / 1000) * (conf.RECT_MAX - conf.RECT_MIN);
    const slider = el('input', {
      type: 'range',
      class: 'big',
      min: 0,
      max: 1000,
      step: 1,
      value: Math.round(((k - conf.RECT_MIN) / (conf.RECT_MAX - conf.RECT_MIN)) * 1000),
      'aria-label': '長方形の形',
    });
    k = toK(Number(slider.value));
    fig.set(k);

    // 一度もスライダーを動かしていないうちは決定できない
    let moved = false;
    const go = el('button', { class: 'btn primary', text: 'これで決定', disabled: true });
    slider.addEventListener('input', () => {
      k = toK(Number(slider.value));
      fig.set(k);
      if (!moved) {
        moved = true;
        go.disabled = false;
      }
    });
    const actions = el('div', { class: 'actions' }, go);
    app.append(fig.svg, el('div', { class: 'slider-row' }, slider), actions);

    go.addEventListener('click', async () => {
      go.disabled = true;
      slider.disabled = true;
      try {
        await send(4, { ratio: Math.round((1 / k) * 10000) / 10000 });
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

  function stageLines(mine, reveal) {
    const conf = CFG.stages[4];
    if (conf.variant === 'rectangle') return stageRect(mine, reveal);
    const classic = conf.variant === 'classic';
    const hint = header(4);

    if (mine) {
      hint.textContent = '';
      app.append(classic ? linesSvg(mine.ratio, { guides: reveal }).svg : brentanoSvg(mine.ratio, { truth: reveal }).svg);
      if (reveal) {
        app.append(
          numberLine(mine.ratio),
          el(
            'p',
            { class: 'compare' },
            'あなたの答え ',
            el('b', { text: mine.ratio.toFixed(2) }),
            '　／　ほんとうに同じ長さなら ',
            el('b', { text: '1.00' })
          )
        );
      } else {
        app.append(el('div', { class: 'done-note', text: '回答済みです。前を見て待っていてね。' }));
      }
      return;
    }

    let ratio = conf.START_MIN + Math.random() * (conf.START_MAX - conf.START_MIN);
    // スライダーの位置（0〜1000）と比率の対応
    let fig;
    let toRatio;
    let toPos;
    if (classic) {
      const shift = (Math.random() < 0.5 ? -1 : 1) * (LINE.SHIFT_MIN + Math.random() * (LINE.SHIFT_MAX - LINE.SHIFT_MIN));
      const f = linesSvg(ratio, { shift });
      fig = { svg: f.svg, set: f.setB };
      toRatio = (v) => conf.MIN + (v / 1000) * (conf.MAX - conf.MIN);
      toPos = (r) => ((r - conf.MIN) / (conf.MAX - conf.MIN)) * 1000;
    } else {
      // 左右の向きも端末ごとにランダム。つまみを動かした向きに真ん中の点が動く
      const flip = Math.random() < 0.5;
      fig = brentanoSvg(ratio, { flip });
      // 真ん中の点の位置（左端からの割合）
      const frac = (r) => (flip ? r / (1 + r) : 1 / (1 + r));
      const fa = frac(conf.MIN);
      const fb = frac(conf.MAX);
      const lo = Math.min(fa, fb);
      const hi = Math.max(fa, fb);
      toRatio = (v) => {
        const f = lo + (v / 1000) * (hi - lo);
        return flip ? f / (1 - f) : (1 - f) / f;
      };
      toPos = (r) => ((frac(r) - lo) / (hi - lo)) * 1000;
    }

    const slider = el('input', {
      type: 'range',
      class: 'big',
      min: 0,
      max: 1000,
      step: 1,
      value: Math.round(toPos(ratio)),
      'aria-label': classic ? '下の線の長さ' : '真ん中の点の位置',
    });
    ratio = toRatio(Number(slider.value));
    fig.set(ratio);

    // 一度もスライダーを動かしていないうちは決定できない
    let moved = false;
    const go = el('button', { class: 'btn primary', text: 'これで決定', disabled: true });
    slider.addEventListener('input', () => {
      ratio = toRatio(Number(slider.value));
      fig.set(ratio);
      if (!moved) {
        moved = true;
        go.disabled = false;
      }
    });
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
