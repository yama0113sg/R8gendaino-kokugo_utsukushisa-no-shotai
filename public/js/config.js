// 設定ファイル：文言・言葉リスト・モードなどはここで差し替える
window.APP_CONFIG = {
  // Cloudflare Worker の URL（末尾に / を付けない）
  API_BASE: 'https://utsukushisa-sakaime.ryousukey0113.workers.dev',

  // 状態・結果を取りに行く間隔（ミリ秒）
  POLL_MS: 2000,

  TITLE: 'うつくしさの境目',
  SUBTITLE: '正解はありません。感じたままに。',

  WAIT_TEXT: '前を見てね',
  WAIT_SUB: 'つぎの体験まで、少しお待ちください。',
  START_TEXT: 'はじまるまで、少し待っていてね',
  END_TEXT: 'おつかれさまでした',
  END_SUB: 'いま感じたことを、ことばにしてみましょう。',

  stages: {
    1: {
      label: '円を描く',
      question: 'できるだけ、美しい円を描いてください。',
      hint: '指で一筆で。指をはなすと終わります。',
      // 真円度 = 100 − SCALE × (RMS偏差 ÷ 平均半径) × 100
      SCORE_SCALE: 3,
    },
    2: {
      label: '美しいもの仲間分け',
      question: 'この中で、「美しい」と思うものを全部えらんでください。',
      hint: 'いくつえらんでも、えらばなくてもかまいません。',
      // 変更するときは worker/wrangler.toml の WORDS も同じにする
      words: ['花', '富士山', '夕焼け', '雲', '雨の日', '数式', 'さびた自転車', '古い写真', '猫', '夜のコンビニ'],
    },
    3: {
      label: '赤ちゃんの問い',
      question: '生まれたばかりの赤ちゃんは、夕焼けを「美しい」と感じるでしょうか？',
      // 'display'：表示のみ（挙手で答える） / 'vote'：タップで投票
      mode: 'display',
      choices: [
        { id: 'innate', label: '生まれつき感じる' },
        { id: 'experience', label: '経験してから感じるようになる' },
      ],
      handText: '手を挙げて答えてね',
    },
    4: {
      label: '錯視の線',
      // 'brentano'：1本の線の真ん中の点を動かして、左右を同じ長さにする
      // 'classic' ：上下2本の線で、下の線の長さを上にそろえる（question も下のコメントの文に戻す）
      variant: 'brentano',
      question: '真ん中の点を動かして、この線を美しく二等分してください。',
      // classic のとき：'下の線を、上の線と同じ長さに見えるように調整してください。'
      hint: 'スライダーを動かして合わせてね。',
      // 比率の範囲（brentano：外向きの側 ÷ 内向きの側／classic：下の線 ÷ 上の線）
      MIN: 0.5,
      MAX: 1.5,
      // 初期位置のランダム範囲
      START_MIN: 0.7,
      START_MAX: 1.3,
    },
  },
};
