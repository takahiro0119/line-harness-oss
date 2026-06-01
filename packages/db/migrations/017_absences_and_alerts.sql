-- 休み報告
CREATE TABLE IF NOT EXISTS friend_absences (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  reason TEXT,
  source TEXT CHECK (source IN ('text', 'manual', 'richmenu')) DEFAULT 'text',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(friend_id, target_date),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_friend_absences_date ON friend_absences(target_date);
CREATE INDEX IF NOT EXISTS idx_friend_absences_friend ON friend_absences(friend_id);

-- 長期不在アラート履歴（重複通知防止）
CREATE TABLE IF NOT EXISTS friend_absence_alerts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('long_absence')),
  alerted_at TEXT DEFAULT (datetime('now')),
  context TEXT,
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_friend_absence_alerts ON friend_absence_alerts(friend_id, alert_type, alerted_at DESC);

-- 修正依頼の理由待ち受け状態
CREATE TABLE IF NOT EXISTS pending_revision_inputs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL,
  target_month TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  resolved INTEGER DEFAULT 0,
  UNIQUE(friend_id, target_month, resolved),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pending_revision ON pending_revision_inputs(friend_id, resolved);
