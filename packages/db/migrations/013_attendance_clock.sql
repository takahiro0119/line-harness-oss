-- 勤怠打刻システム
-- 出勤/退勤の時刻管理、シフトパターン、月次確認

-- 勤怠設定（グループ単位で有効化）
CREATE TABLE IF NOT EXISTS attendance_settings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id TEXT NOT NULL UNIQUE,
  is_enabled INTEGER DEFAULT 1,
  clock_in_time TEXT DEFAULT '09:00',
  clock_in_reminder_time TEXT DEFAULT '12:00',
  clock_out_time TEXT DEFAULT '20:00',
  clock_out_reminder_time TEXT DEFAULT '22:00',
  monthly_confirm_day INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- シフトパターン（グループデフォルト or メンバー個別）
CREATE TABLE IF NOT EXISTS shift_patterns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id TEXT NOT NULL,
  line_user_id TEXT,
  pattern_type TEXT DEFAULT 'weekday' CHECK (pattern_type IN ('weekday', 'custom')),
  work_days TEXT DEFAULT '1,2,3,4,5',
  exclude_holidays INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  UNIQUE(group_id, line_user_id)
);

-- 打刻記録
CREATE TABLE IF NOT EXISTS clock_records (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  target_date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  work_hours REAL,
  clock_in_source TEXT CHECK (clock_in_source IN ('button', 'reminder', 'manual')),
  clock_out_source TEXT CHECK (clock_out_source IN ('button', 'reminder', 'manual')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(group_id, line_user_id, target_date),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- 月次確認
CREATE TABLE IF NOT EXISTS monthly_confirmations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  target_month TEXT NOT NULL,
  total_days INTEGER,
  total_hours REAL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'revision_requested')),
  sent_at TEXT,
  confirmed_at TEXT,
  revision_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(group_id, line_user_id, target_month),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- 打刻リマインド状態（会話形式の時刻確認用）
CREATE TABLE IF NOT EXISTS clock_reminders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('clock_in', 'clock_out')),
  target_date TEXT NOT NULL,
  sent_at TEXT DEFAULT (datetime('now')),
  resolved INTEGER DEFAULT 0,
  UNIQUE(group_id, line_user_id, reminder_type, target_date),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_settings_group ON attendance_settings(group_id);
CREATE INDEX IF NOT EXISTS idx_shift_patterns_group ON shift_patterns(group_id);
CREATE INDEX IF NOT EXISTS idx_shift_patterns_user ON shift_patterns(group_id, line_user_id);
CREATE INDEX IF NOT EXISTS idx_clock_records_date ON clock_records(target_date);
CREATE INDEX IF NOT EXISTS idx_clock_records_group_date ON clock_records(group_id, target_date);
CREATE INDEX IF NOT EXISTS idx_clock_records_user_date ON clock_records(group_id, line_user_id, target_date);
CREATE INDEX IF NOT EXISTS idx_monthly_confirmations_month ON monthly_confirmations(target_month);
CREATE INDEX IF NOT EXISTS idx_clock_reminders_pending ON clock_reminders(group_id, line_user_id, resolved);
