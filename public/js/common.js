// 生徒画面・先生画面の共通処理
(function () {
  const CFG = window.APP_CONFIG;

  function apiBase() {
    // ローカルで動かすときだけ ?api= で接続先を差し替えられる
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      const p = new URLSearchParams(location.search).get('api');
      if (p) return p.replace(/\/+$/, '');
    }
    return CFG.API_BASE.replace(/\/+$/, '');
  }

  async function request(method, path, body) {
    const opt = { method, cache: 'no-store' };
    if (body !== undefined) {
      opt.headers = { 'Content-Type': 'application/json' };
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(apiBase() + path, opt);
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* 何もしない */
    }
    if (!res.ok) {
      const e = new Error((data && data.error) || 'HTTP ' + res.status);
      e.status = res.status;
      throw e;
    }
    return data;
  }

  const api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };

  function classCode() {
    return new URLSearchParams(location.search).get('c') || '';
  }

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, ...children) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const c of children.flat()) if (c) e.append(c);
    return e;
  }

  // 一定間隔で呼び出す（前の呼び出しが終わってから次を待つ。タブが隠れている間は止める）
  function poll(fn, ms) {
    let timer = null;
    let stopped = false;
    async function tick() {
      timer = null;
      if (stopped) return;
      if (!document.hidden) {
        try {
          await fn();
        } catch (e) {
          console.warn(e);
        }
      }
      if (!stopped) timer = setTimeout(tick, ms);
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && timer) {
        clearTimeout(timer);
        tick();
      }
    });
    tick();
    return { stop: () => ((stopped = true), timer && clearTimeout(timer)), now: () => (timer && clearTimeout(timer), tick()) };
  }

  // 円のデータ（64方向の半径）から座標列へ
  function circlePoints(r, cx, cy, scale) {
    const n = r.length;
    return r.map((v, i) => {
      const a = (i / n) * Math.PI * 2;
      return [cx + Math.cos(a) * v * scale, cy + Math.sin(a) * v * scale];
    });
  }

  function pointsToPath(pts, closed) {
    if (!pts.length) return '';
    let d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (let i = 1; i < pts.length; i++) d += 'L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1);
    return closed ? d + 'Z' : d;
  }

  // ミュラー・リヤーの線（SVG の g 要素）。fins: 'in' は <—>、'out' は >—<
  function mullerLyer(cx, y, len, fins, fin, opts) {
    const o = Object.assign({ stroke: 'currentColor', width: 4 }, opts || {});
    const x1 = cx - len / 2;
    const x2 = cx + len / 2;
    const dx = fin * Math.cos(Math.PI / 5);
    const dy = fin * Math.sin(Math.PI / 5);
    const s = fins === 'in' ? 1 : -1; // in：羽根が線の内側へ戻る形（矢印）
    const d =
      `M${x1} ${y}L${x2} ${y}` +
      `M${x1 + s * dx} ${y - dy}L${x1} ${y}L${x1 + s * dx} ${y + dy}` +
      `M${x2 - s * dx} ${y - dy}L${x2} ${y}L${x2 - s * dx} ${y + dy}`;
    return svg('path', {
      d,
      fill: 'none',
      stroke: o.stroke,
      'stroke-width': o.width,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
  }

  window.App = { CFG, api, classCode, el, svg, poll, circlePoints, pointsToPath, mullerLyer };
})();
