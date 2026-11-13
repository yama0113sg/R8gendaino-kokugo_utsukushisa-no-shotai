-- 回答（1端末・1段階につき1行。上書き保存）
CREATE TABLE IF NOT EXISTS answers (
  class      TEXT NOT NULL,
  stage      INTEGER NOT NULL,
  client_id  TEXT NOT NULL,
  payload    TEXT NOT NULL,   -- JSON
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (class, stage, client_id)
);

-- クラスごとの進行状態
CREATE TABLE IF NOT EXISTS state (
  class      TEXT PRIMARY KEY,
  stage      INTEGER NOT NULL DEFAULT 0,
  waiting    INTEGER NOT NULL DEFAULT 1,
  view       TEXT NOT NULL DEFAULT 'live',  -- 'live' | 'result'
  reveal     INTEGER NOT NULL DEFAULT 0,    -- ④の正解表示
  updated_at INTEGER NOT NULL
);
