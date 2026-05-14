-- 勤怠打刻システム v2: LINE公式アカウント 1:1チャットベース
-- グループ方式から切り替え

-- グローバル勤怠設定（アカウント単位）
CREATE TABLE IF NOT EXISTS attendance_config (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  line_account_id TEXT,
  is_enabled INTEGER DEFAULT 1,
  clock_in_time TEXT DEFAULT '09:00',
  clock_in_reminder_time TEXT DEFAULT '12:00',
  clock_out_time TEXT DEFAULT '18:00',
  clock_out_reminder_time TEXT DEFAULT '21:00',
  monthly_confirm_day INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(line_account_id)
);

-- 友だち別シフト設定
CREATE TABLE IF NOT EXISTS friend_shifts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL,
  pattern_type TEXT DEFAULT 'default' CHECK (pattern_type IN ('default', 'custom')),
  work_days TEXT DEFAULT '1,2,3,4,5',
  exclude_holidays INTEGER DEFAULT 1,
  clock_in_time TEXT,
  clock_in_reminder_time TEXT,
  clock_out_time TEXT,
  clock_out_reminder_time TEXT,
  is_excluded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(friend_id),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);

-- 打刻記録（1:1ベース、group_id不要）
CREATE TABLE IF NOT EXISTS friend_clock_records (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  target_date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  work_hours REAL,
  clock_in_source TEXT CHECK (clock_in_source IN ('button', 'reminder', 'manual', 'richmenu')),
  clock_out_source TEXT CHECK (clock_out_source IN ('button', 'reminder', 'manual', 'richmenu')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(friend_id, target_date),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);

-- 月次確認（1:1ベース）
CREATE TABLE IF NOT EXISTS friend_monthly_confirmations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL,
  display_name TEXT,
  target_month TEXT NOT NULL,
  total_days INTEGER,
  total_hours REAL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'revision_requested')),
  sent_at TEXT,
  confirmed_at TEXT,
  revision_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(friend_id, target_month),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);

-- 打刻リマインド状態（1:1ベース）
CREATE TABLE IF NOT EXISTS friend_clock_reminders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  friend_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('clock_in', 'clock_out')),
  target_date TEXT NOT NULL,
  sent_at TEXT DEFAULT (datetime('now')),
  resolved INTEGER DEFAULT 0,
  UNIQUE(friend_id, reminder_type, target_date),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_friend_shifts_friend ON friend_shifts(friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_shifts_excluded ON friend_shifts(is_excluded);
CREATE INDEX IF NOT EXISTS idx_friend_clock_records_date ON friend_clock_records(target_date);
CREATE INDEX IF NOT EXISTS idx_friend_clock_records_friend_date ON friend_clock_records(friend_id, target_date);
CREATE INDEX IF NOT EXISTS idx_friend_monthly_conf_month ON friend_monthly_confirmations(target_month);
CREATE INDEX IF NOT EXISTS idx_friend_clock_reminders_pending ON friend_clock_reminders(friend_id, resolved);
