-- フォーム送信状況の追跡
CREATE TABLE IF NOT EXISTS friend_form_submissions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL UNIQUE,
  form_type TEXT NOT NULL DEFAULT 'bpo_new_worker',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'notified')),
  kintone_record_id TEXT,
  matched_name TEXT,
  matched_birthday TEXT,
  url_sent_at TEXT,
  submitted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_friend_form_submissions_status ON friend_form_submissions(status);

-- attendance_config にフォームブリッジURL追加
ALTER TABLE attendance_config ADD COLUMN form_bridge_url TEXT;
