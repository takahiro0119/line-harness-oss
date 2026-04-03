-- ============================================================
-- Groups — LINE グループ管理
-- ============================================================
CREATE TABLE IF NOT EXISTS groups (
  id               TEXT PRIMARY KEY,
  line_group_id    TEXT UNIQUE NOT NULL,
  line_account_id  TEXT,
  name             TEXT,
  member_count     INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_groups_line_group_id ON groups (line_group_id);
CREATE INDEX IF NOT EXISTS idx_groups_line_account_id ON groups (line_account_id);

-- ============================================================
-- Group Members — グループメンバー
-- ============================================================
CREATE TABLE IF NOT EXISTS group_members (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  friend_id   TEXT REFERENCES friends (id) ON DELETE SET NULL,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (group_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_friend_id ON group_members (friend_id);

-- ============================================================
-- Group Messages Log — グループメッセージログ
-- ============================================================
CREATE TABLE IF NOT EXISTS group_messages_log (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  line_user_id   TEXT,
  direction      TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type   TEXT NOT NULL,
  content        TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages_log (group_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_created_at ON group_messages_log (created_at);

-- ============================================================
-- Attendance Schedules — 勤怠回収スケジュール
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_schedules (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  message        TEXT NOT NULL DEFAULT '本日の出勤予定を返信してください。\n出勤 / 休み / 遅刻 のいずれかで回答してください。',
  cron_expression TEXT NOT NULL DEFAULT '0 9 * * 1-5',
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_schedules_group ON attendance_schedules (group_id);

-- ============================================================
-- Attendance Records — 勤怠レコード
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_records (
  id               TEXT PRIMARY KEY,
  schedule_id      TEXT NOT NULL REFERENCES attendance_schedules (id) ON DELETE CASCADE,
  group_id         TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  line_user_id     TEXT NOT NULL,
  display_name     TEXT,
  target_date      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'present', 'absent', 'late', 'other')),
  raw_reply        TEXT,
  replied_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_schedule ON attendance_records (schedule_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_group ON attendance_records (group_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records (target_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status ON attendance_records (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON attendance_records (schedule_id, line_user_id, target_date);
