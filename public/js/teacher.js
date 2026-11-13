// 先生画面（進行・結果表示）
(function () {
  const { CFG, api, el, svg, poll, circlePoints, pointsToPath, mullerLyer } = window.App;
  const $ = (id) => document.getElementById(id);
  const MARK = { 0: '開始前', 1: '①', 2: '②', 3: '③', 4: '④', 9: 'おわり' };
  const SEQ = [
    [0, 1],
    [1, 0],
    [1, 1],
    [2, 0],
    [2, 1],
    [3, 0],
    [3, 1],
    [4, 0],
    [4, 1],
    [9, 1],
  ];
  const COLOR = { ink: '#1d1c1a', soft: '#55504a', accent: '#34507a', red: '#c2553d', line: '#d8d0c2' };

  const params = new URLSearchParams(location.search);
  let cls = params.get('c') || '';
  let key = '';
  try {
    key = sessionStorage.getItem('uts_teacher_key') || '';
  } catch {
    /* 何もしない */
  }

  let state = { stage: 0, waiting: 1, view: 'live', reveal: 0 };
  const results = {};
  let sortByRate = false;
  let lastSig = '';
  let lastError = '';
  let busy = false;
  let poller = null;
  let lastTug = 50;

  $('brand').textContent = CFG.TITLE;

  // ---------- ログイン ----------
  function showLogin(msg) {
    $('login').classList.remove('hidden');
    $('loginClass').value = cls;
    $('loginMsg').textContent = msg || '';
    ($('loginClass').value ? $('loginKey') : $('loginClass')).focus();
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = $('loginClass').value.trim();
    const k = $('loginKey').value;
    $('loginMsg').textContent = '確認しています…';
    try {
      await api.post('/api/check', { class: c, key: k });
    } catch (err) {
      $('loginMsg').textContent =
        err.status === 401 ? 'パスフレーズがちがいます。' : err.status === 403 ? 'そのクラスコードは登録されていません。' : 'サーバーにつながりません。';
      return;
    }
    cls = c;
    key = k;
    try {
      sessionStorage.setItem('uts_teacher_key', k);
    } catch {
      /* 何もしない */
    }
    params.set('c', cls);
    history.replaceState(null, '', '?' + params.toString());
    $('login').classList.add('hidden');
    $('loginKey').value = '';
    start();
  });

  // ---------- 進行操作 ----------
  async function setState(patch) {
    if (busy) return;
    busy = true;
    try {
      state = await api.post('/api/state', Object.assign({ class: cls, key }, patch));
      lastError = '';
      await loadResults();
      render();
    } catch (err) {
      if (err.status === 401) showLogin('パスフレーズをもう一度入れてください。');
      else {
        lastError = '操作を送れませんでした（' + err.message + '）';
        renderStatus();
      }
    } finally {
      busy = false;
    }
  }

  function seqIndex() {
    if (state.stage === 0) return 0;
    if (state.stage === 9) return SEQ.length - 1;
    const i = SEQ.findIndex(([s, w]) => s === state.stage && w === (state.waiting ? 1 : 0));
    return i < 0 ? 0 : i;
  }

  function go(delta) {
    const i = Math.max(0, Math.min(SEQ.length - 1, seqIndex() + delta));
    const [stage, waiting] = SEQ[i];
    if (stage === state.stage && waiting === state.waiting) return;
    setState({ stage, waiting });
  }

  $('prev').addEventListener('click', () => go(-1));
  $('next').addEventListener('click', () => go(1));
  $('wait').addEventListener('click', () => setState({ waiting: !state.waiting }));
  $('view').addEventListener('click', () => setState({ view: state.view === 'result' ? 'live' : 'result' }));
  $('reveal').addEventListener('click', () => setState({ reveal: !state.reveal, view: 'result' }));
  $('sort').addEventListener('click', () => {
    sortByRate = !sortByRate;
    render();
  });
  $('full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });
  $('reset').addEventListener('click', async () => {
    const ok = confirm(`クラス「${cls}」の回答と進行を、すべて削除します。\nもとに戻せません。よろしいですか？`);
    if (!ok) return;
    try {
      await api.post('/api/reset', { class: cls, key });
      for (const k of Object.keys(results)) delete results[k];
      state = { stage: 0, waiting: 1, view: 'live', reveal: 0 };
      lastError = '';
      render();
    } catch (err) {
      if (err.status === 401) showLogin('パスフレーズをもう一度入れてください。');
      else alert('リセットできませんでした（' + err.message + '）');
    }
  });
  $('qr').addEventListener('click', () => {
    const o = $('qrOverlay');
    o.replaceChildren(qrBox(Math.min(window.innerWidth, window.innerHeight) * 0.68), el('p', { class: 'qr-url', text: 'クリックで閉じる' }));
    o.classList.remove('hidden');
  });
  $('qrOverlay').addEventListener('click', () => $('qrOverlay').classList.add('hidden'));

  document.addEventListener('keydown', (e) => {
    if (!$('login').classList.contains('hidden') || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Escape') $('qrOverlay').classList.add('hidden');
  });
  window.addEventListener('resize', () => {
    lastSig = '';
    render();
  });

  const steps = [0, 1, 2, 3, 4, 9].map((s) => {
    const b = el('button', { text: MARK[s], title: s >= 1 && s <= 4 ? CFG.stages[s].label : '' });
    b.addEventListener('click', () => setState({ stage: s, waiting: s === 0 || s === 9 ? 1 : 0 }));
    return b;
  });
  $('steps').append(...steps);

  // ---------- データ取得 ----------
  async function loadResults() {
    const s = state.stage;
    if (s < 1 || s > 4) return;
    results[s] = await api.get(`/api/results?class=${encodeURIComponent(cls)}&stage=${s}`);
  }

  async function refresh() {
    try {
      state = await api.get(`/api/state?class=${encodeURIComponent(cls)}`);
      await loadResults();
      lastError = '';
    } catch (err) {
      lastError = 'サーバーにつながりません（' + err.message + '）';
    }
    render();
  }

  function studentUrl() {
    const u = new URL('./', location.href);
    u.searchParams.set('c', cls);
    const apiParam = params.get('api');
    if (apiParam && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) u.searchParams.set('api', apiParam);
    return u.toString();
  }

  function qrBox(px) {
    const url = studentUrl();
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const margin = 2;
    const cell = Math.max(2, Math.floor(px / (n + margin * 2)));
    const size = cell * (n + margin * 2);
    const c = el('canvas', { width: size, height: size });
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) ctx.fillRect((k + margin) * cell, (r + margin) * cell, cell, cell);
    return el('div', { class: 'qr-box' }, c, el('div', { class: 'qr-url', text: url }));
  }

  // ---------- 表示 ----------
  function renderStatus() {
    const s = state.stage;
    steps.forEach((b, i) => {
      const v = [0, 1, 2, 3, 4, 9][i];
      b.classList.toggle('current', v === s);
      b.classList.toggle('waiting', v === s && !!state.waiting && v !== 0 && v !== 9);
    });
    $('cls').textContent = 'クラス ' + cls;
    $('prev').disabled = seqIndex() === 0;
    $('next').disabled = seqIndex() === SEQ.length - 1;

    const inStage = s >= 1 && s <= 4;
    const isDisplay3 = s === 3 && CFG.stages[3].mode !== 'vote';
    $('wait').disabled = !inStage;
    $('wait').textContent = state.waiting && inStage ? '待機を解除' : '待機にする';
    $('view').classList.toggle('hidden', !inStage || isDisplay3);
    $('view').textContent = state.view === 'result' ? '問いに戻す' : '結果を見せる';
    $('sort').classList.toggle('hidden', !(s === 2 && state.view === 'result'));
    $('sort').textContent = sortByRate ? 'もとの順に戻す' : '割合順に並べる';
    $('reveal').classList.toggle('hidden', !(s === 4 && state.view === 'result'));
    $('reveal').textContent = state.reveal ? '正解を隠す' : '正解を表示';

    let student;
    if (s === 0) student = '開始前の画面';
    else if (s === 9) student = 'おわりの画面';
    else if (state.waiting) student = '待機中（' + CFG.WAIT_TEXT + '）';
    else student = MARK[s] + ' ' + CFG.stages[s].label;
    const st = $('status');
    st.replaceChildren(
      ...[
        el('span', null, el('span', { class: 'dot' + (inStage && !state.waiting ? '' : ' wait') }), '生徒画面：' + student),
        inStage && results[s] && !isDisplay3 ? el('span', { text: MARK[s] + ' の回答 ' + results[s].count + ' 人' }) : null,
        lastError ? el('span', { class: 'err', text: lastError }) : null,
      ].filter(Boolean)
    );
  }

  function render() {
    renderStatus();
    const s = state.stage;
    const sig = JSON.stringify([s, state.view, state.reveal, sortByRate, s >= 1 && s <= 4 ? results[s] : null]);
    if (sig === lastSig) return;
    lastSig = sig;
    const main = $('main');
    main.replaceChildren();

    if (s === 0) {
      main.append(
        el(
          'div',
          { class: 't-start' },
          el('div', { class: 't-title' }, el('h1', { text: CFG.TITLE }), el('p', { text: CFG.SUBTITLE })),
          qrBox(Math.min(window.innerHeight * 0.55, window.innerWidth * 0.32))
        )
      );
      return;
    }
    if (s === 9) {
      main.append(el('div', { class: 't-title' }, el('h1', { text: CFG.END_TEXT }), el('p', { text: CFG.TITLE })));
      return;
    }

    const conf = CFG.stages[s];
    const data = results[s] || { count: 0, answers: [] };
    main.append(el('div', { class: 't-tag', text: MARK[s] + ' ' + conf.label }));

    if (s === 3 && conf.mode !== 'vote') {
      main.append(
        el('p', { class: 't-question', text: conf.question }),
        el('div', { class: 'slide-choices' }, conf.choices.map((c) => el('div', { text: c.label })))
      );
      return;
    }

    if (state.view !== 'result') {
      main.append(
        el('p', { class: 't-question', text: conf.question }),
        el('div', { class: 't-count' }, '回答', el('b', { text: String(data.count) }), '人')
      );
      return;
    }

    if (s === 1) renderCircles(main, data);
    else if (s === 2) renderWords(main, data);
    else if (s === 3) renderTug(main, data);
    else if (s === 4) renderLines(main, data);
  }

  // ① 全員の円の重ね図
  function renderCircles(main, data) {
    const V = 1000;
    const R = 380;
    const g = svg('svg', { viewBox: `0 0 ${V} ${V}`, style: 'height:100%;width:auto' });
    const n = data.answers.length;
    const alpha = n ? Math.max(0.12, Math.min(0.6, 5 / n)) : 0;
    for (const a of data.answers) {
      g.append(
        svg('path', {
          d: pointsToPath(circlePoints(a.r, V / 2, V / 2, R), true),
          fill: 'none',
          stroke: COLOR.accent,
          'stroke-opacity': alpha,
          'stroke-width': 3,
          'stroke-linejoin': 'round',
        })
      );
    }
    g.append(
      svg('circle', {
        cx: V / 2,
        cy: V / 2,
        r: R,
        fill: 'none',
        stroke: COLOR.red,
        'stroke-width': 5,
        'stroke-dasharray': '14 14',
      })
    );
    const avg = n ? data.answers.reduce((x, a) => x + a.score, 0) / n : null;
    main.append(
      el('div', { class: 't-figure' }, g),
      el(
        'div',
        { class: 't-stats' },
        el('span', null, '回答', el('b', { text: String(n) }), ' 人'),
        el('span', null, '平均の真円度', el('b', { text: avg === null ? '—' : String(Math.round(avg)) }), ' ％')
      )
    );
  }

  // ② 言葉のタイル
  function renderWords(main, data) {
    const words = CFG.stages[2].words;
    const n = data.answers.length;
    const counts = Object.fromEntries(words.map((w) => [w, 0]));
    for (const a of data.answers) for (const w of a.selected || []) if (w in counts) counts[w]++;
    let order = words.map((w, i) => ({ w, i, rate: n ? counts[w] / n : 0 }));
    if (sortByRate) order = order.slice().sort((a, b) => b.rate - a.rate || a.i - b.i);
    const tiles = el('div', { class: 'tiles' });
    for (const o of order) {
      const t = el('div', { class: 'tile' }, el('div', { class: 'w', text: o.w }), el('div', { class: 'p', text: n ? Math.round(o.rate * 100) + '％' : '—' }));
      t.style.background = `rgba(52, 80, 122, ${(0.04 + o.rate * 0.86).toFixed(3)})`;
      t.style.color = o.rate > 0.45 ? '#fff' : COLOR.ink;
      t.style.borderColor = o.rate > 0.45 ? 'transparent' : COLOR.line;
      tiles.append(t);
    }
    main.append(el('div', { class: 't-figure' }, tiles), el('div', { class: 't-stats' }, el('span', null, '回答', el('b', { text: String(n) }), ' 人')));
  }

  // ③ 綱引きのバー（投票モード）
  function renderTug(main, data) {
    const [c1, c2] = CFG.stages[3].choices;
    let a = 0;
    let b = 0;
    for (const x of data.answers) {
      if (x.choice === c1.id) a++;
      else if (x.choice === c2.id) b++;
    }
    const total = a + b;
    const left = total ? (a / total) * 100 : 50;
    const pct = (v) => (total ? Math.round((v / total) * 100) + '％' : '—');
    const leftBar = el('div', { class: 'tug-left' });
    leftBar.style.width = lastTug + '%';
    lastTug = left;
    main.append(
      el('p', { class: 't-question', style: 'font-size:clamp(1.4rem,2.6vw,2.4rem)', text: CFG.stages[3].question }),
      el(
        'div',
        { class: 'tug' },
        el('div', { class: 'tug-labels' }, el('span', { text: c1.label }), el('span', { text: c2.label })),
        el('div', { class: 'tug-bar' }, leftBar, el('div', { class: 'tug-mid' })),
        el('div', { class: 'tug-nums' }, el('span', { text: `${a}人（${pct(a)}）` }), el('span', { text: `${b}人（${pct(b)}）` }))
      )
    );
    requestAnimationFrame(() => requestAnimationFrame(() => (leftBar.style.width = left + '%')));
  }

  // ④ 比率の分布と正解
  function renderLines(main, data) {
    const conf = CFG.stages[4];
    const W = 1600;
    const reveal = !!state.reveal;
    const H = reveal ? 860 : 400;
    const pad = 90;
    const x = (v) => pad + ((Math.max(conf.MIN, Math.min(conf.MAX, v)) - conf.MIN) / (conf.MAX - conf.MIN)) * (W - pad * 2);
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;height:100%' });
    const y0 = 50;
    const y1 = 290;

    g.append(svg('line', { x1: pad, x2: W - pad, y1, y2: y1, stroke: COLOR.soft, 'stroke-width': 3 }));
    for (let i = 0; i <= Math.round((conf.MAX - conf.MIN) * 10); i++) {
      const v = conf.MIN + i / 10;
      g.append(svg('line', { x1: x(v), x2: x(v), y1: y1, y2: y1 + 14, stroke: COLOR.soft, 'stroke-width': 3 }));
      const t = svg('text', { x: x(v), y: y1 + 50, 'text-anchor': 'middle', 'font-size': 32, fill: COLOR.soft });
      t.textContent = v.toFixed(1);
      g.append(t);
    }

    const n = data.answers.length;
    const alpha = n ? Math.max(0.15, Math.min(0.7, 6 / n)) : 0;
    for (const a of data.answers) {
      g.append(svg('line', { x1: x(a.ratio), x2: x(a.ratio), y1: y0, y2: y1, stroke: COLOR.accent, 'stroke-opacity': alpha, 'stroke-width': 5 }));
    }
    if (n) {
      const mean = data.answers.reduce((s, a) => s + a.ratio, 0) / n;
      const mx = x(mean);
      g.append(svg('path', { d: `M${mx} ${y1 + 62}l-16 26h32z`, fill: COLOR.accent }));
      const t = svg('text', { x: mx, y: y1 + 120, 'text-anchor': 'middle', 'font-size': 32, fill: COLOR.accent, 'font-weight': 700 });
      t.textContent = '平均 ' + mean.toFixed(2);
      g.append(t);
    }

    if (reveal) {
      g.append(svg('line', { x1: x(1), x2: x(1), y1: y0 - 30, y2: y1, stroke: COLOR.red, 'stroke-width': 9 }));
      const t = svg('text', { x: x(1) + 16, y: y0 - 4, 'font-size': 34, fill: COLOR.red, 'font-weight': 700 });
      t.textContent = '同じ長さ（1.00）';
      g.append(t);

      // A と B を本当に同じ長さで描いた図
      const cx = W / 2;
      const L = 520;
      const ya = 560;
      const yb = 760;
      for (const gx of [cx - L / 2, cx + L / 2]) {
        g.append(svg('line', { x1: gx, x2: gx, y1: ya - 95, y2: yb + 95, stroke: COLOR.red, 'stroke-width': 4, 'stroke-dasharray': '12 10' }));
      }
      g.append(
        mullerLyer(cx, ya, L, 'in', 130, { stroke: COLOR.ink, width: 8 }),
        mullerLyer(cx, yb, L, 'out', 130, { stroke: COLOR.ink, width: 8 })
      );
    }

    main.append(el('div', { class: 't-figure' }, g), el('div', { class: 't-stats' }, el('span', null, '回答', el('b', { text: String(n) }), ' 人')));
  }

  // ---------- 開始 ----------
  function start() {
    lastSig = '';
    if (poller) poller.stop();
    poller = poll(refresh, CFG.POLL_MS || 2000);
  }

  if (!cls || !key) {
    showLogin();
  } else {
    api
      .post('/api/check', { class: cls, key })
      .then(start)
      .catch((err) => showLogin(err.status === 401 ? 'パスフレーズをもう一度入れてください。' : ''));
  }
})();
