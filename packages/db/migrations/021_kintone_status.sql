-- Kintone 稼働者マスタの状況フィールドを同期するための列
ALTER TABLE friend_shifts ADD COLUMN kintone_status TEXT;
ALTER TABLE friend_shifts ADD COLUMN kintone_status_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_friend_shifts_kintone_status ON friend_shifts(kintone_status);

-- 毎朝の稼働開始連絡は 8:50 に統一
UPDATE attendance_config SET clock_in_time = '08:50' WHERE clock_in_time = '09:00';
