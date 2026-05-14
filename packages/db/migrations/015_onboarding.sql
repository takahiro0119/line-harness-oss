-- 流入経路にオンボーディングフロータイプを追加
ALTER TABLE entry_routes ADD COLUMN onboarding_flow TEXT DEFAULT NULL;
-- onboarding_flow: NULL = 通常, 'bpo_worker' = 名前・生年月日ヒアリング, etc.

-- 友だちのオンボーディング情報を保存
CREATE TABLE IF NOT EXISTS friend_onboarding (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL UNIQUE,
  flow_type TEXT NOT NULL,
  step TEXT DEFAULT 'start',
  full_name TEXT,
  birthday TEXT,
  phone TEXT,
  kintone_id TEXT,
  extra JSONB DEFAULT '{}',
  completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_friend_onboarding_friend ON friend_onboarding(friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_onboarding_step ON friend_onboarding(completed);
