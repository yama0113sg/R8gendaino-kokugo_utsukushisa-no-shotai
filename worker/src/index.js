// うつくしさの境目 — API（Cloudflare Worker + D1）

const STAGES = [1, 2, 3, 4];
const STAGE3_CHOICES = ['innate', 'experience'];
const CIRCLE_SAMPLES = 64;
const MAX_BODY = 8 * 1024;

function list(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = list(env.ALLOWED_ORIGINS);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function checkClass(env, cls) {
  if (typeof cls !== 'string' || !list(env.ALLOWED_CLASSES).includes(cls)) {
    throw new HttpError(403, 'unknown class');
  }
  return cls;
}

function checkStage(stage) {
  const n = Number(stage);
  if (!STAGES.includes(n)) throw new HttpError(400, 'invalid stage');
  return n;
}

function checkClientId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    throw new HttpError(400, 'invalid client_id');
  }
  return id;
}

// 文字列比較の時間を一定にする
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

function checkTeacher(env, key) {
  if (!env.TEACHER_KEY || !safeEqual(key, env.TEACHER_KEY)) {
    throw new HttpError(401, 'unauthorized');
  }
}

function isNum(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

// 段階ごとの回答の形式チェック。保存用に必要な項目だけを取り出して返す
function validatePayload(env, stage, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new HttpError(400, 'invalid payload');
  if (stage === 1) {
    if (!Array.isArray(p.r) || p.r.length !== CIRCLE_SAMPLES || !p.r.every((v) => isNum(v, 0, 3))) {
      throw new HttpError(400, 'invalid circle');
    }
    if (!isNum(p.score, 0, 100)) throw new HttpError(400, 'invalid score');
    return { r: p.r.map((v) => Math.round(v * 1000) / 1000), score: Math.round(p.score * 10) / 10 };
  }
  if (stage === 2) {
    const words = list(env.WORDS);
    if (!Array.isArray(p.selected) || p.selected.length > 50) throw new HttpError(400, 'invalid selection');
    const selected = [...new Set(p.selected)];
    for (const w of selected) {
      if (typeof w !== 'string' || w.length > 30) throw new HttpError(400, 'invalid word');
      if (words.length && !words.includes(w)) throw new HttpError(400, 'unknown word');
    }
    return { selected };
  }
  if (stage === 3) {
    if (!STAGE3_CHOICES.includes(p.choice)) throw new HttpError(400, 'invalid choice');
    return { choice: p.choice };
  }
  if (stage === 4) {
    if (!isNum(p.ratio, 0.3, 2.0)) throw new HttpError(400, 'invalid ratio');
    return { ratio: Math.round(p.ratio * 10000) / 10000 };
  }
  throw new HttpError(400, 'invalid stage');
}

const DEFAULT_STATE = { stage: 0, waiting: 1, view: 'live', reveal: 0, updated_at: 0 };

async function readState(env, cls) {
  const row = await env.DB.prepare('SELECT stage, waiting, view, reveal, updated_at FROM state WHERE class = ?')
    .bind(cls)
    .first();
  return row || { ...DEFAULT_STATE };
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid json');
  }
}

async function handle(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // 現在の段階（client_id があれば、その端末の回答済みデータも返す）
  if (path === '/api/state' && method === 'GET') {
    const cls = checkClass(env, url.searchParams.get('class'));
    const state = await readState(env, cls);
    const out = { ...state };
    const cid = url.searchParams.get('client_id');
    if (cid) {
      checkClientId(cid);
      const { results } = await env.DB.prepare('SELECT stage, payload FROM answers WHERE class = ? AND client_id = ?')
        .bind(cls, cid)
        .all();
      out.mine = {};
      for (const r of results) out.mine[r.stage] = JSON.parse(r.payload);
    }
    return out;
  }

  // 進行の変更（教員のみ）
  if (path === '/api/state' && method === 'POST') {
    const body = await readBody(request);
    const cls = checkClass(env, body.class);
    checkTeacher(env, body.key);
    const cur = await readState(env, cls);
    const next = { ...cur };
    if (body.stage !== undefined) {
      const s = Number(body.stage);
      if (![0, 1, 2, 3, 4, 9].includes(s)) throw new HttpError(400, 'invalid stage');
      if (s !== cur.stage) {
        next.view = 'live';
        next.reveal = 0;
      }
      next.stage = s;
    }
    if (body.waiting !== undefined) next.waiting = body.waiting ? 1 : 0;
    if (body.view !== undefined) {
      if (!['live', 'result'].includes(body.view)) throw new HttpError(400, 'invalid view');
      next.view = body.view;
    }
    if (body.reveal !== undefined) next.reveal = body.reveal ? 1 : 0;
    next.updated_at = Date.now();
    await env.DB.prepare(
      `INSERT INTO state (class, stage, waiting, view, reveal, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (class) DO UPDATE SET stage = excluded.stage, waiting = excluded.waiting,
         view = excluded.view, reveal = excluded.reveal, updated_at = excluded.updated_at`
    )
      .bind(cls, next.stage, next.waiting, next.view, next.reveal, next.updated_at)
      .run();
    return next;
  }

  // 回答の保存（同じ端末・同じ段階は上書き）
  if (path === '/api/answer' && method === 'POST') {
    const body = await readBody(request);
    const cls = checkClass(env, body.class);
    const stage = checkStage(body.stage);
    const cid = checkClientId(body.client_id);
    const payload = validatePayload(env, stage, body.payload);
    await env.DB.prepare(
      `INSERT INTO answers (class, stage, client_id, payload, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (class, stage, client_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    )
      .bind(cls, stage, cid, JSON.stringify(payload), Date.now())
      .run();
    return { ok: true, payload };
  }

  // 段階ごとの回答一覧（端末IDは返さない）
  if (path === '/api/results' && method === 'GET') {
    const cls = checkClass(env, url.searchParams.get('class'));
    const stage = checkStage(url.searchParams.get('stage'));
    const { results } = await env.DB.prepare('SELECT payload FROM answers WHERE class = ? AND stage = ? ORDER BY updated_at')
      .bind(cls, stage)
      .all();
    const answers = results.map((r) => JSON.parse(r.payload));
    return { stage, count: answers.length, answers };
  }

  // パスフレーズの確認（教員画面のログイン用）
  if (path === '/api/check' && method === 'POST') {
    const body = await readBody(request);
    checkClass(env, body.class);
    checkTeacher(env, body.key);
    return { ok: true };
  }

  // クラスの回答と段階をすべて消す（教員のみ）
  if (path === '/api/reset' && method === 'POST') {
    const body = await readBody(request);
    const cls = checkClass(env, body.class);
    checkTeacher(env, body.key);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM answers WHERE class = ?').bind(cls),
      env.DB.prepare('DELETE FROM state WHERE class = ?').bind(cls),
    ]);
    return { ok: true };
  }

  if (path === '' || path === '/api/health') return { ok: true };

  throw new HttpError(404, 'not found');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const data = await handle(request, env, new URL(request.url));
      return json(data, 200, cors);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error(err);
      return json({ error: 'server error' }, 500, cors);
    }
  },
};
