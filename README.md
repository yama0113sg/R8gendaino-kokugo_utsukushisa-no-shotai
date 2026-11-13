# うつくしさの境目

教室で、生徒が各自のタブレットで小さな体験をし、先生がプロジェクターで全員の結果を見せるための Web サイトです。

- **生徒画面** `index.html?c=<クラスコード>` … 名前は取りません（端末ごとの匿名ID）
- **先生画面** `teacher.html?c=<クラスコード>` … パスフレーズで入り、進行と結果表示を操作します

| 段階 | 体験 | 生徒の操作 | 先生画面の結果 |
|---|---|---|---|
| ① | 円を描く | 指で一筆描き → 真円度を表示（やり直し1回） | 全員の円を同じ中心・大きさで重ねた図＋完璧な円（点線） |
| ② | 美しいもの仲間分け | 言葉のカードを複数選択 | 選んだ人の割合で色づくタイル（割合順の並べ替えあり） |
| ③ | 赤ちゃんの問い | 表示のみ（設定で投票モード） | 問いのスライド／投票モードでは綱引き風のバー |
| ④ | 錯視の線 | スライダーで下の線の長さを上の線にそろえる（設定で、1本の線を真ん中の点で二等分する形にも変更可） | 全員の比率を重ねた分布、1.00 より左・右の割合、正解（生徒画面にも正解を表示） |

```
public/            GitHub Pages で公開する静的ファイル（ビルド不要）
  index.html       生徒画面
  teacher.html     先生画面
  js/config.js     ★設定ファイル（Worker の URL・文言・言葉リスト・③のモード）
worker/            Cloudflare Worker（API）と D1 のテーブル定義
scripts/           ダミー回答の投入スクリプト
```

---

## 1. Cloudflare の準備（Worker ＋ D1）

パソコンに [Node.js](https://nodejs.org/ja)（LTS 版）を入れておきます。以下はすべて `worker` フォルダの中で実行します。

```bash
cd worker
```

### 1-1. Cloudflare にログイン

```bash
npx wrangler login
```

ブラウザが開くので、Cloudflare のアカウントで許可します。

### 1-2. D1 データベースを作る

```bash
npx wrangler d1 create utsukushisa-sakaime
```

表示された中の `database_id = "xxxxxxxx-...."` をコピーし、`worker/wrangler.toml` の
`database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"` の部分に貼り付けます。

### 1-3. テーブルを作る

```bash
npx wrangler d1 execute utsukushisa-sakaime --remote --file=schema.sql
```

### 1-4. 設定を確認する（`worker/wrangler.toml` の `[vars]`）

| 名前 | 意味 | 例 |
|---|---|---|
| `ALLOWED_CLASSES` | 受け付けるクラスコード（カンマ区切り）。これ以外は拒否されます | `1-1,1-3,test` |
| `ALLOWED_ORIGINS` | API を使ってよいサイトのオリジン（GitHub Pages のアドレスの `https://〜.github.io` まで。末尾の `/` やリポジトリ名は付けない） | `https://yourname.github.io` |
| `WORDS` | ②で受け付ける言葉。`public/js/config.js` の `words` と**同じ並び・同じ字**にします | `花,富士山,…` |

### 1-5. Worker を公開する

```bash
npx wrangler deploy
```

最後に `https://utsukushisa-sakaime.<あなたのサブドメイン>.workers.dev` のような URL が表示されます。これが **Worker の URL** です（あとで使います）。

> 同じアカウントにすでに別の Worker があっても、名前（`utsukushisa-sakaime`）が違うので別の Worker として作られます。既存の Worker には影響しません。

### 1-6. 教員用パスフレーズ（`TEACHER_KEY`）を設定する

```bash
npx wrangler secret put TEACHER_KEY
```

入力を求められたらパスフレーズを入れて Enter。**パスフレーズはファイルに書かないでください**（Cloudflare 側にだけ保存されます）。変えたいときは同じコマンドをもう一度実行します。

### 1-7. 動作確認

ブラウザで `https://<Worker の URL>/api/state?class=test` を開き、`{"stage":0,...}` のような文字が出れば成功です。

---

## 2. GitHub Pages の準備

1. `public/js/config.js` を開き、`API_BASE` を 1-5 で表示された **Worker の URL** に書き換えて保存し、GitHub に反映（push）します。
2. GitHub のリポジトリ画面で **Settings → Pages** を開き、**Build and deployment** の **Source** を **GitHub Actions** にします。
3. `main` ブランチに push すると、`.github/workflows/pages.yml` が `public/` の中身を自動で公開します（**Actions** タブで進み具合を見られます）。
4. 公開先は `https://<GitHubのユーザー名>.github.io/<リポジトリ名>/` です。
   - 生徒用：`https://〜/<リポジトリ名>/?c=1-1`
   - 先生用：`https://〜/<リポジトリ名>/teacher.html?c=1-1`

> 生徒には先生画面の QR を読み取ってもらえば、URL を入力させる必要はありません。

---

## 3. 設定の変え方（`public/js/config.js`）

- **文言**：各段階の `question`（問い）、`hint`（補足）、タイトルや待機画面の文言
- **②の言葉**：`stages[2].words`（変えたら `worker/wrangler.toml` の `WORDS` も同じにして `npx wrangler deploy`）
- **③のモード**：`stages[3].mode` を `'display'`（表示のみ・挙手）か `'vote'`（タップで投票）に
- **①の真円度の厳しさ**：`stages[1].SCORE_SCALE`（大きいほど辛口。初期値 3）
- **④の図の形**：`stages[4].variant` を `'classic'`（上下2本の線・初期値）か `'brentano'`（1本の線を真ん中の点で分ける形）に。変えたら `question` も合わせて変える
- **④のスライダー範囲**：`MIN`／`MAX`、初期位置のランダム範囲 `START_MIN`／`START_MAX`
- **更新間隔**：`POLL_MS`（ミリ秒。初期値 2000＝2秒）

---

## 4. 当日の使い方

### 先生画面の操作

| ボタン | はたらき |
|---|---|
| `開始前` `①`〜`④` `おわり` | その段階へ直接移動（生徒画面も切り替わる） |
| `次へ ▶` / `◀ 戻る` | 開始前 → ① → ①待機 → ② → ②待機 → … → ④待機 → おわり の順に進む／戻る（キーボードの → ← でも可） |
| `待機にする` / `待機を解除` | 生徒画面を「前を見てね」にする。先生画面はその段階の表示のまま |
| `結果を見せる` / `問いに戻す` | 先生画面を「問い＋回答人数」と「結果の図」で切り替え（回答中は問いのままにしておくと、結果に引っ張られません） |
| `割合順に並べる`（②） | タイルを選ばれた割合の高い順に並べ替え |
| `結果と正解を見せる`（④） | ④では結果の図と同時に正解の線・「同じ長さの図」を出し、**生徒画面にも**自分の答えと正解を表示（`問いに戻す` で正解も隠れる） |
| `QR` | 生徒用 URL の QR コードを大きく表示（クリックで閉じる）。`開始前` の画面にも QR が出ます |
| `全画面` | プロジェクター用に全画面表示 |
| `リセット` | そのクラスの回答と進行をすべて削除（確認あり・もとに戻せません） |

生徒画面は 2 秒ごとに状態を確認して自動で切り替わります。途中から開いた端末も、いまの段階から始まります。回答済みの段階に戻ると、自分の結果が表示されます（答え直しはできません）。

### 予行演習 → リセット → 本番

1. **前日まで**：クラスコード `test` で一通り操作してみる。
   - 先生画面：`teacher.html?c=test` を開き、パスフレーズを入れる
   - 何台かの端末で `?c=test` を開いて回答してみる
   - 必要ならダミー回答で図の見え方を確認（下の「5」）
2. **予行演習のあと**：先生画面の `リセット` で回答を消す（本番のクラスで練習した場合は、そのクラスもリセット）。
3. **本番**：
   1. 先生画面 `teacher.html?c=<本番のクラス>` を開き、`全画面` に。
   2. `開始前` の画面の QR を生徒に読み取ってもらう。
   3. `次へ ▶` で①へ。回答がそろったら `結果を見せる`。
   4. 講義に入るときは `次へ ▶`（＝待機）。生徒画面は「前を見てね」になります。
   5. 以下同様に ②・③・④ と進め、最後に `おわり`。

---

## 5. ダミー回答で見え方を確かめる

40人分の回答を入れて、先生画面の図が見やすいかを確認できます（Node.js 18 以上）。

```bash
node scripts/seed-dummy.mjs --api https://<Worker の URL> --class test --n 40
```

- ①：真円度 50〜95％のばらついた円
- ②：「花」「夕焼け」はほぼ全員、「雲」「数式」「さびた自転車」は割れる
- ③：投票（投票モードのときの見え方確認用）
- ④：比率 0.85 前後に集まる

確認が終わったら、先生画面の `リセット` で消してください。

---

## 6. 校内ネットワークでつながらないとき

生徒の端末（または先生のパソコン）のブラウザで、次の2つを開いてみてください。

| 開くアドレス | つながっているときの表示 |
|---|---|
| `https://<Worker の URL>/api/health` | `{"ok":true}` |
| `https://<GitHubのユーザー名>.github.io/<リポジトリ名>/` | サイトのトップ |

- **どちらも開けない／フィルタの警告画面になる** → 校内のフィルタで `workers.dev` や `github.io` が止められている可能性があります。情報担当の先生に、この2つのドメインを許可してもらえるか相談してください。
- **サイトは開くが、生徒画面の右上に「接続を確認しています…」が出続ける** → Worker（`workers.dev`）だけが止められているか、`ALLOWED_ORIGINS` の設定が GitHub Pages のアドレスと一致していません（`https://〜.github.io` まで。末尾の `/` は付けない）。
- **先生画面で「サーバーにつながりません」** → 上と同じ確認に加え、`config.js` の `API_BASE` が正しいかを確かめてください。
- テザリング（スマートフォンの回線）だと開ける場合は、校内のフィルタが原因です。

### 回数の目安（Cloudflare 無料プラン）

無料プランの Worker は **1日 10 万リクエスト**まで（同じアカウントの他の Worker と合算）です。
2秒ごとの更新で、40人×50分 ≈ 6 万リクエスト程度になります。同じ日に2クラス以上で使うときは、`POLL_MS` を `3000`（3秒）にするか、有料プランを検討してください。
（画面を閉じている・隠れている端末は通信しません。）

---

## 7. 手元で動かす（開発用）

```bash
cd worker
npx wrangler d1 execute utsukushisa-sakaime --local --file=schema.sql
echo 'TEACHER_KEY=localpass' > .dev.vars      # 手元だけで使う仮のパスフレーズ
npx wrangler dev --port 8787 --var ALLOWED_ORIGINS:http://localhost:8080
```

別のターミナルで：

```bash
cd public
python3 -m http.server 8080
```

`http://localhost:8080/teacher.html?c=test&api=http://localhost:8787` を開きます（`?api=` による接続先の差し替えは localhost のときだけ有効です）。

---

## ライセンス表記

QR コードの生成に [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（Copyright (c) 2009 Kazuhiko Arase, MIT License）を同梱しています（`public/js/vendor/qrcode.js`）。
