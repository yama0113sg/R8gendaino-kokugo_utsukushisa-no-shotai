#!/usr/bin/env node
// ダミー回答を投入して、先生画面の見え方を確かめるためのスクリプト
//
// 使い方：
//   node scripts/seed-dummy.mjs --api https://<Worker の URL> --class test --n 40
//
// 端末IDは毎回ランダムに作るので、実行するたびに回答が増えます。
// 消すときは先生画面の「リセット」を使ってください。

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((s) => {
      const [k, ...v] = s.trim().split(/\s+/);
      return [k, v.join(' ') || true];
    })
);

const API = String(args.api || '').replace(/\/+$/, '');
const CLASS = String(args.class || 'test');
const N = Number(args.n || 40);
const STAGES = String(args.stages || '1,2,3,4')
  .split(',')
  .map(Number);

if (!API) {
  console.error('--api に Worker の URL を指定してください');
  process.exit(1);
}

const WORDS = ['花', '富士山', '夕焼け', '雲', '雨の日', '数式', 'さびた自転車', '古い写真', '猫', '夜のコンビニ'];
// 言葉ごとの「選ばれやすさ」
const WORD_RATE = {
  花: 0.95,
  富士山: 0.8,
  夕焼け: 0.97,
  雲: 0.5,
  雨の日: 0.3,
  数式: 0.4,
  さびた自転車: 0.45,
  古い写真: 0.65,
  猫: 0.7,
  夜のコンビニ: 0.25,
};

const rand = (a, b) => a + Math.random() * (b - a);
function gauss() {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 真円度 50〜95％ 程度になるよう、ゆがみを加えた円
function dummyCircle() {
  const target = rand(50, 95);
  const B = 64;
  const comps = [2, 3, 4, 5].map((k) => ({ k, a: Math.random() / k, p: rand(0, Math.PI * 2) }));
  const raw = [];
  for (let i = 0; i < B; i++) {
    const t = (i / B) * Math.PI * 2;
    let v = 0;
    for (const c of comps) v += c.a * Math.cos(c.k * t + c.p);
    v += gauss() * 0.02;
    raw.push(v);
  }
  const mean = raw.reduce((a, b) => a + b, 0) / B;
  const sd = Math.sqrt(raw.reduce((a, b) => a + (b - mean) ** 2, 0) / B) || 1;
  // 真円度 = 100 − 3 × (RMS / 平均半径) × 100 になるよう振れ幅を合わせる
  const wantRel = (100 - target) / 300;
  const r = raw.map((v) => Math.round((1 + ((v - mean) / sd) * wantRel) * 1000) / 1000);
  return { r, score: Math.round(target * 10) / 10 };
}

function payloadFor(stage) {
  if (stage === 1) return dummyCircle();
  if (stage === 2) return { selected: WORDS.filter((w) => Math.random() < WORD_RATE[w]) };
  if (stage === 3) return { choice: Math.random() < 0.45 ? 'innate' : 'experience' };
  if (stage === 4) return { ratio: Math.round(Math.max(0.6, Math.min(1.2, 0.85 + gauss() * 0.04)) * 10000) / 10000 };
}

let ok = 0;
let ng = 0;
for (let i = 0; i < N; i++) {
  const client_id = crypto.randomUUID();
  for (const stage of STAGES) {
    const res = await fetch(API + '/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class: CLASS, stage, client_id, payload: payloadFor(stage) }),
    });
    if (res.ok) ok++;
    else {
      ng++;
      if (ng <= 3) console.error(stage, res.status, await res.text());
    }
  }
}
console.log(`投入しました：成功 ${ok} 件／失敗 ${ng} 件（クラス ${CLASS}、${N} 人分）`);
