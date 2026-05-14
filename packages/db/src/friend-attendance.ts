/**
 * 勤怠打刻システム v2: 1:1チャットベース DB層
 */

// ── Types ──────────────────────────────────────────

export interface AttendanceConfigRow {
  id: string;
  line_account_id: string | null;
  is_enabled: number;
  clock_in_time: string;
  clock_in_reminder_time: string;
  clock_out_time: string;
  clock_out_reminder_time: string;
  monthly_confirm_day: number;
  created_at: string;
  updated_at: string;
}

export interface FriendShiftRow {
  id: string;
  friend_id: string;
  pattern_type: 'default' | 'custom';
  work_days: string;
  exclude_holidays: number;
  clock_in_time: string | null;
  clock_in_reminder_time: string | null;
  clock_out_time: string | null;
  clock_out_reminder_time: string | null;
  is_excluded: number;
  created_at: string;
  updated_at: string;
}

export interface FriendClockRecordRow {
  id: string;
  friend_id: string;
  line_user_id: string;
  display_name: string | null;
  target_date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: number | null;
  clock_in_source: 'button' | 'reminder' | 'manual' | 'richmenu' | null;
  clock_out_source: 'button' | 'reminder' | 'manual' | 'richmenu' | null;
  created_at: string;
  updated_at: string;
}

export interface FriendMonthlyConfirmationRow {
  id: string;
  friend_id: string;
  display_name: string | null;
  target_month: string;
  total_days: number | null;
  total_hours: number | null;
  status: 'pending' | 'confirmed' | 'revision_requested';
  sent_at: string | null;
  confirmed_at: string | null;
  revision_note: string | null;
  created_at: string;
}

export interface FriendClockReminderRow {
  id: string;
  friend_id: string;
  reminder_type: 'clock_in' | 'clock_out';
  target_date: string;
  sent_at: string;
  resolved: number;
}

// ── Attendance Config ──────────────────────────────

export async function getAttendanceConfig(db: D1Database, lineAccountId?: string | null): Promise<AttendanceConfigRow | null> {
  if (lineAccountId) {
    const r = await db.prepare('SELECT * FROM attendance_config WHERE line_account_id = ?').bind(lineAccountId).first<AttendanceConfigRow>();
    if (r) return r;
  }
  // フォールバック: line_account_id IS NULL（デフォルト設定）
  return db.prepare('SELECT * FROM attendance_config WHERE line_account_id IS NULL').first<AttendanceConfigRow>();
}

export async function getAllAttendanceConfigs(db: D1Database): Promise<AttendanceConfigRow[]> {
  const r = await db.prepare('SELECT * FROM attendance_config WHERE is_enabled = 1').all<AttendanceConfigRow>();
  return r.results;
}

export async function upsertAttendanceConfig(
  db: D1Database,
  lineAccountId: string | null,
  data: Partial<Omit<AttendanceConfigRow, 'id' | 'line_account_id' | 'created_at' | 'updated_at'>>
): Promise<void> {
  const existing = lineAccountId
    ? await db.prepare('SELECT id FROM attendance_config WHERE line_account_id = ?').bind(lineAccountId).first()
    : await db.prepare('SELECT id FROM attendance_config WHERE line_account_id IS NULL').first();

  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (data.is_enabled !== undefined) { fields.push('is_enabled = ?'); values.push(data.is_enabled); }
    if (data.clock_in_time !== undefined) { fields.push('clock_in_time = ?'); values.push(data.clock_in_time); }
    if (data.clock_in_reminder_time !== undefined) { fields.push('clock_in_reminder_time = ?'); values.push(data.clock_in_reminder_time); }
    if (data.clock_out_time !== undefined) { fields.push('clock_out_time = ?'); values.push(data.clock_out_time); }
    if (data.clock_out_reminder_time !== undefined) { fields.push('clock_out_reminder_time = ?'); values.push(data.clock_out_reminder_time); }
    if (data.monthly_confirm_day !== undefined) { fields.push('monthly_confirm_day = ?'); values.push(data.monthly_confirm_day); }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      if (lineAccountId) {
        values.push(lineAccountId);
        await db.prepare(`UPDATE attendance_config SET ${fields.join(', ')} WHERE line_account_id = ?`).bind(...values).run();
      } else {
        await db.prepare(`UPDATE attendance_config SET ${fields.join(', ')} WHERE line_account_id IS NULL`).bind(...values).run();
      }
    }
  } else {
    await db.prepare(
      `INSERT INTO attendance_config (line_account_id, is_enabled, clock_in_time, clock_in_reminder_time, clock_out_time, clock_out_reminder_time, monthly_confirm_day)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      lineAccountId,
      data.is_enabled ?? 1,
      data.clock_in_time ?? '09:00',
      data.clock_in_reminder_time ?? '12:00',
      data.clock_out_time ?? '18:00',
      data.clock_out_reminder_time ?? '21:00',
      data.monthly_confirm_day ?? 1
    ).run();
  }
}

// ── Friend Shifts ──────────────────────────────────

export async function getFriendShift(db: D1Database, friendId: string): Promise<FriendShiftRow | null> {
  return db.prepare('SELECT * FROM friend_shifts WHERE friend_id = ?').bind(friendId).first<FriendShiftRow>();
}

export async function getAllFriendShifts(db: D1Database): Promise<FriendShiftRow[]> {
  const r = await db.prepare('SELECT * FROM friend_shifts').all<FriendShiftRow>();
  return r.results;
}

export async function upsertFriendShift(
  db: D1Database,
  friendId: string,
  data: Partial<Omit<FriendShiftRow, 'id' | 'friend_id' | 'created_at' | 'updated_at'>>
): Promise<void> {
  await db.prepare(
    `INSERT INTO friend_shifts (friend_id, pattern_type, work_days, exclude_holidays, clock_in_time, clock_in_reminder_time, clock_out_time, clock_out_reminder_time, is_excluded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(friend_id) DO UPDATE SET
       pattern_type = COALESCE(excluded.pattern_type, pattern_type),
       work_days = COALESCE(excluded.work_days, work_days),
       exclude_holidays = COALESCE(excluded.exclude_holidays, exclude_holidays),
       clock_in_time = excluded.clock_in_time,
       clock_in_reminder_time = excluded.clock_in_reminder_time,
       clock_out_time = excluded.clock_out_time,
       clock_out_reminder_time = excluded.clock_out_reminder_time,
       is_excluded = COALESCE(excluded.is_excluded, is_excluded),
       updated_at = datetime('now')`
  ).bind(
    friendId,
    data.pattern_type ?? 'default',
    data.work_days ?? '1,2,3,4,5',
    data.exclude_holidays ?? 1,
    data.clock_in_time ?? null,
    data.clock_in_reminder_time ?? null,
    data.clock_out_time ?? null,
    data.clock_out_reminder_time ?? null,
    data.is_excluded ?? 0
  ).run();
}

export async function deleteFriendShift(db: D1Database, friendId: string): Promise<void> {
  await db.prepare('DELETE FROM friend_shifts WHERE friend_id = ?').bind(friendId).run();
}

// ── 勤怠対象の友だち一覧取得 ──────────────────────

export interface AttendanceTarget {
  friend_id: string;
  line_user_id: string;
  display_name: string | null;
  line_account_id: string | null;
  // shift (null = use default config)
  clock_in_time: string | null;
  clock_in_reminder_time: string | null;
  clock_out_time: string | null;
  clock_out_reminder_time: string | null;
  work_days: string;
  exclude_holidays: number;
}

export async function getAttendanceTargets(db: D1Database, lineAccountId?: string | null): Promise<AttendanceTarget[]> {
  let sql = `
    SELECT f.id as friend_id, f.line_user_id, f.display_name, f.line_account_id,
           fs.clock_in_time, fs.clock_in_reminder_time, fs.clock_out_time, fs.clock_out_reminder_time,
           COALESCE(fs.work_days, '1,2,3,4,5') as work_days,
           COALESCE(fs.exclude_holidays, 1) as exclude_holidays
    FROM friends f
    LEFT JOIN friend_shifts fs ON fs.friend_id = f.id
    WHERE f.is_following = 1
      AND (fs.is_excluded IS NULL OR fs.is_excluded = 0)`;
  const binds: unknown[] = [];
  if (lineAccountId) {
    sql += ` AND (f.line_account_id = ? OR f.line_account_id IS NULL)`;
    binds.push(lineAccountId);
  }
  const r = await db.prepare(sql).bind(...binds).all<AttendanceTarget>();
  return r.results;
}

// ── Friend Clock Records ───────────────────────────

export async function getFriendClockRecord(db: D1Database, friendId: string, targetDate: string): Promise<FriendClockRecordRow | null> {
  return db.prepare(
    'SELECT * FROM friend_clock_records WHERE friend_id = ? AND target_date = ?'
  ).bind(friendId, targetDate).first<FriendClockRecordRow>();
}

export async function getFriendClockRecords(db: D1Database, params: {
  friendId?: string; targetDate?: string; startDate?: string; endDate?: string;
}): Promise<FriendClockRecordRow[]> {
  let sql = 'SELECT * FROM friend_clock_records WHERE 1=1';
  const binds: unknown[] = [];
  if (params.friendId) { sql += ' AND friend_id = ?'; binds.push(params.friendId); }
  if (params.targetDate) { sql += ' AND target_date = ?'; binds.push(params.targetDate); }
  if (params.startDate) { sql += ' AND target_date >= ?'; binds.push(params.startDate); }
  if (params.endDate) { sql += ' AND target_date <= ?'; binds.push(params.endDate); }
  sql += ' ORDER BY target_date DESC, display_name ASC';
  const r = await db.prepare(sql).bind(...binds).all<FriendClockRecordRow>();
  return r.results;
}

export async function upsertFriendClockIn(
  db: D1Database,
  friendId: string,
  lineUserId: string,
  displayName: string | null,
  targetDate: string,
  clockInTime: string,
  source: 'button' | 'reminder' | 'manual' | 'richmenu'
): Promise<void> {
  await db.prepare(
    `INSERT INTO friend_clock_records (friend_id, line_user_id, display_name, target_date, clock_in, clock_in_source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(friend_id, target_date) DO UPDATE SET
       clock_in = excluded.clock_in,
       clock_in_source = excluded.clock_in_source,
       display_name = COALESCE(excluded.display_name, display_name),
       updated_at = datetime('now')`
  ).bind(friendId, lineUserId, displayName, targetDate, clockInTime, source).run();
}

export async function upsertFriendClockOut(
  db: D1Database,
  friendId: string,
  lineUserId: string,
  displayName: string | null,
  targetDate: string,
  clockOutTime: string,
  source: 'button' | 'reminder' | 'manual' | 'richmenu'
): Promise<void> {
  const existing = await getFriendClockRecord(db, friendId, targetDate);
  let workHours: number | null = null;
  if (existing?.clock_in) {
    const [inH, inM] = existing.clock_in.split(':').map(Number);
    const [outH, outM] = clockOutTime.split(':').map(Number);
    workHours = Math.round(((outH * 60 + outM) - (inH * 60 + inM)) / 60 * 100) / 100;
    if (workHours < 0) workHours = null;
  }

  await db.prepare(
    `INSERT INTO friend_clock_records (friend_id, line_user_id, display_name, target_date, clock_out, clock_out_source, work_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(friend_id, target_date) DO UPDATE SET
       clock_out = excluded.clock_out,
       clock_out_source = excluded.clock_out_source,
       work_hours = ?,
       display_name = COALESCE(excluded.display_name, display_name),
       updated_at = datetime('now')`
  ).bind(friendId, lineUserId, displayName, targetDate, clockOutTime, source, workHours, workHours).run();
}

// ── Friend Clock Reminders ─────────────────────────

export async function getFriendPendingReminder(db: D1Database, friendId: string): Promise<FriendClockReminderRow | null> {
  return db.prepare(
    'SELECT * FROM friend_clock_reminders WHERE friend_id = ? AND resolved = 0 ORDER BY sent_at DESC LIMIT 1'
  ).bind(friendId).first<FriendClockReminderRow>();
}

export async function insertFriendClockReminder(
  db: D1Database, friendId: string, reminderType: 'clock_in' | 'clock_out', targetDate: string
): Promise<void> {
  await db.prepare(
    `INSERT INTO friend_clock_reminders (friend_id, reminder_type, target_date)
     VALUES (?, ?, ?)
     ON CONFLICT(friend_id, reminder_type, target_date) DO UPDATE SET resolved = 0, sent_at = datetime('now')`
  ).bind(friendId, reminderType, targetDate).run();
}

export async function resolveFriendClockReminder(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE friend_clock_reminders SET resolved = 1 WHERE id = ?').bind(id).run();
}

// ── Monthly Confirmations ──────────────────────────

export async function getFriendMonthlyConfirmation(db: D1Database, friendId: string, targetMonth: string): Promise<FriendMonthlyConfirmationRow | null> {
  return db.prepare(
    'SELECT * FROM friend_monthly_confirmations WHERE friend_id = ? AND target_month = ?'
  ).bind(friendId, targetMonth).first<FriendMonthlyConfirmationRow>();
}

export async function getFriendMonthlyConfirmations(db: D1Database, targetMonth: string): Promise<FriendMonthlyConfirmationRow[]> {
  const r = await db.prepare(
    'SELECT * FROM friend_monthly_confirmations WHERE target_month = ? ORDER BY display_name ASC'
  ).bind(targetMonth).all<FriendMonthlyConfirmationRow>();
  return r.results;
}

export async function upsertFriendMonthlyConfirmation(
  db: D1Database, friendId: string, displayName: string | null, targetMonth: string, totalDays: number, totalHours: number
): Promise<void> {
  await db.prepare(
    `INSERT INTO friend_monthly_confirmations (friend_id, display_name, target_month, total_days, total_hours, sent_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(friend_id, target_month) DO UPDATE SET
       total_days = excluded.total_days, total_hours = excluded.total_hours,
       sent_at = datetime('now'), status = 'pending', confirmed_at = NULL`
  ).bind(friendId, displayName, targetMonth, totalDays, totalHours).run();
}

export async function confirmFriendMonthly(db: D1Database, friendId: string, targetMonth: string): Promise<void> {
  await db.prepare(
    `UPDATE friend_monthly_confirmations SET status = 'confirmed', confirmed_at = datetime('now')
     WHERE friend_id = ? AND target_month = ?`
  ).bind(friendId, targetMonth).run();
}

export async function requestFriendMonthlyRevision(db: D1Database, friendId: string, targetMonth: string, note?: string): Promise<void> {
  await db.prepare(
    `UPDATE friend_monthly_confirmations SET status = 'revision_requested', revision_note = ?
     WHERE friend_id = ? AND target_month = ?`
  ).bind(note ?? null, friendId, targetMonth).run();
}

// ── Helpers ────────────────────────────────────────

export async function getUnclockedFriends(
  db: D1Database,
  targetDate: string,
  type: 'clock_in' | 'clock_out',
  lineAccountId?: string | null,
): Promise<Array<{ friend_id: string; line_user_id: string; display_name: string | null }>> {
  const column = type === 'clock_in' ? 'clock_in' : 'clock_out';
  let sql = `
    SELECT f.id as friend_id, f.line_user_id, f.display_name
    FROM friends f
    LEFT JOIN friend_shifts fs ON fs.friend_id = f.id
    WHERE f.is_following = 1
      AND (fs.is_excluded IS NULL OR fs.is_excluded = 0)
      AND f.id NOT IN (
        SELECT friend_id FROM friend_clock_records
        WHERE target_date = ? AND ${column} IS NOT NULL
      )`;
  const binds: unknown[] = [targetDate];
  if (lineAccountId) {
    sql += ` AND (f.line_account_id = ? OR f.line_account_id IS NULL)`;
    binds.push(lineAccountId);
  }
  const r = await db.prepare(sql).bind(...binds).all<{ friend_id: string; line_user_id: string; display_name: string | null }>();
  return r.results;
}

export async function calcFriendMonthlySummary(
  db: D1Database, friendId: string, targetMonth: string
): Promise<{ totalDays: number; totalHours: number }> {
  const records = await getFriendClockRecords(db, { friendId, startDate: targetMonth + '-01', endDate: targetMonth + '-31' });
  let totalDays = 0;
  let totalHours = 0;
  for (const r of records) {
    if (r.clock_in) {
      totalDays++;
      if (r.work_hours) totalHours += r.work_hours;
    }
  }
  return { totalDays, totalHours: Math.round(totalHours * 100) / 100 };
}
