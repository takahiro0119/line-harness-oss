-- LIFF link 時に friend がまだ存在しない場合のref_code退避先
CREATE TABLE IF NOT EXISTS pending_friend_refs (
  line_user_id TEXT PRIMARY KEY,
  ref_code TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
