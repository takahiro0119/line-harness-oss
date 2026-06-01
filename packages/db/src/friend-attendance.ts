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
  cs_notification_group_id: string | null;
  form_bridge_url: string | null;
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
  kintone_status: string | null;
  kintone_status_synced_at: string | null;
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
    if (data.cs_notification_group_id !== undefined) { fields.push('cs_notification_group_id = ?'); values.push(data.cs_notification_group_id); }
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
      data.clock_in_time ?? '08:50',
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
  kintone_id: string | null;
  kintone_status: string | null;
  // shift (null = use default config)
  clock_in_time: string | null;
  clock_in_reminder_time: string | null;
  clock_out_time: string | null;
  clock_out_reminder_time: string | null;
  work_days: string;
  exclude_holidays: number;
}

/**
 * 稼働対象の友だち一覧（Kintone「参画中」のみ）
 * - friend_onboarding に kintone_id がある人だけが対象
 * - friend_shifts.kintone_status = '参画中' のみ送信対象
 */
export async function getAttendanceTargets(db: D1Database, lineAccountId?: string | null): Promise<AttendanceTarget[]> {
  let sql = `
    SELECT f.id as friend_id, f.line_user_id, f.display_name, f.line_account_id,
           fo.kintone_id,
           fs.kintone_status,
           fs.clock_in_time, fs.clock_in_reminder_time, fs.clock_out_time, fs.clock_out_reminder_time,
           COALESCE(fs.work_days, '1,2,3,4,5') as work_days,
           COALESCE(fs.exclude_holidays, 1) as exclude_holidays
    FROM friends f
    LEFT JOIN friend_shifts fs ON fs.friend_id = f.id
    LEFT JOIN friend_onboarding fo ON fo.friend_id = f.id
    WHERE f.is_following = 1
      AND (fs.is_excluded IS NULL OR fs.is_excluded = 0)
      AND fs.kintone_status = '参画中'`;
  const binds: unknown[] = [];
  if (lineAccountId) {
    sql += ` AND (f.line_account_id = ? OR f.line_account_id IS NULL)`;
    binds.push(lineAccountId);
  }
  const r = await db.prepare(sql).bind(...binds).all<AttendanceTarget>();
  return r.results;
}

/**
 * Kintone と紐付け済みの全友だち（状況フィルタなし）— 朝の状況同期で使う
 */
export async function getKintoneLinkedFriends(db: D1Database): Promise<Array<{
  friend_id: string;
  line_account_id: string | null;
  kintone_id: string;
}>> {
  const r = await db.prepare(`
    SELECT f.id as friend_id, f.line_account_id, fo.kintone_id
    FROM friends f
    JOIN friend_onboarding fo ON fo.friend_id = f.id
    WHERE f.is_following = 1 AND fo.kintone_id IS NOT NULL AND fo.kintone_id != ''
  `).all<{ friend_id: string; line_account_id: string | null; kintone_id: string }>();
  return r.results;
}

/**
 * Kintone「状況」フィールドを friend_shifts に保存
 * shift 行がなければデフォルト値で作成する
 */
export async function updateFriendKintoneStatus(
  db: D1Database, friendId: string, status: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO friend_shifts (friend_id, kintone_status, kintone_status_synced_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(friend_id) DO UPDATE SET
       kintone_status = excluded.kintone_status,
       kintone_status_synced_at = datetime('now'),
       updated_at = datetime('now')`
  ).bind(friendId, status).run();
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
    JOIN friend_shifts fs ON fs.friend_id = f.id
    WHERE f.is_following = 1
      AND fs.is_excluded = 0
      AND fs.kintone_status = '参画中'
      AND f.id NOT IN (
        SELECT friend_id FROM friend_clock_records
        WHERE target_date = ? AND ${column} IS NOT NULL
      )
      AND f.id NOT IN (
        SELECT friend_id FROM friend_absences WHERE target_date = ?
      )`;
  const binds: unknown[] = [targetDate, targetDate];
  if (lineAccountId) {
    sql += ` AND (f.line_account_id = ? OR f.line_account_id IS NULL)`;
    binds.push(lineAccountId);
  }
  sql += ' ORDER BY f.display_name ASC';
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

// ── Clock Record Edit ──────────────────────────────

export async function deleteFriendClockRecord(db: D1Database, friendId: string, targetDate: string): Promise<void> {
  await db.prepare('DELETE FROM friend_clock_records WHERE friend_id = ? AND target_date = ?')
    .bind(friendId, targetDate).run();
}

export async function updateFriendClockRecord(
  db: D1Database, friendId: string, targetDate: string,
  data: { clockIn?: string | null; clockOut?: string | null }
): Promise<void> {
  // 既存recordがあるか確認
  const existing = await getFriendClockRecord(db, friendId, targetDate);
  let workHours: number | null = null;
  const clockIn = data.clockIn !== undefined ? data.clockIn : existing?.clock_in ?? null;
  const clockOut = data.clockOut !== undefined ? data.clockOut : existing?.clock_out ?? null;
  if (clockIn && clockOut) {
    const [inH, inM] = clockIn.split(':').map(Number);
    const [outH, outM] = clockOut.split(':').map(Number);
    workHours = Math.round(((outH * 60 + outM) - (inH * 60 + inM)) / 60 * 100) / 100;
  }

  if (existing) {
    await db.prepare(
      `UPDATE friend_clock_records SET clock_in = ?, clock_out = ?, work_hours = ?,
       clock_in_source = COALESCE(clock_in_source, 'manual'),
       clock_out_source = CASE WHEN ? IS NOT NULL AND clock_out_source IS NULL THEN 'manual' ELSE clock_out_source END,
       updated_at = datetime('now')
       WHERE friend_id = ? AND target_date = ?`
    ).bind(clockIn, clockOut, workHours, clockOut, friendId, targetDate).run();
  } else {
    // 新規追加: friend情報取得
    const f = await db.prepare('SELECT line_user_id, display_name FROM friends WHERE id = ?').bind(friendId).first<{ line_user_id: string; display_name: string | null }>();
    if (!f) return;
    await db.prepare(
      `INSERT INTO friend_clock_records (friend_id, line_user_id, display_name, target_date, clock_in, clock_out, work_hours, clock_in_source, clock_out_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(friendId, f.line_user_id, f.display_name, targetDate, clockIn, clockOut, workHours, clockIn ? 'manual' : null, clockOut ? 'manual' : null).run();
  }
}

// ── Friend Absences ────────────────────────────────

export interface FriendAbsenceRow {
  id: string;
  friend_id: string;
  target_date: string;
  reason: string | null;
  source: 'text' | 'manual' | 'richmenu';
  created_at: string;
}

export async function getFriendAbsence(db: D1Database, friendId: string, targetDate: string): Promise<FriendAbsenceRow | null> {
  return db.prepare('SELECT * FROM friend_absences WHERE friend_id = ? AND target_date = ?')
    .bind(friendId, targetDate).first<FriendAbsenceRow>();
}

export async function getFriendAbsencesInRange(db: D1Database, friendId: string, startDate: string, endDate: string): Promise<FriendAbsenceRow[]> {
  const r = await db.prepare(
    'SELECT * FROM friend_absences WHERE friend_id = ? AND target_date >= ? AND target_date <= ? ORDER BY target_date ASC'
  ).bind(friendId, startDate, endDate).all<FriendAbsenceRow>();
  return r.results;
}

export async function upsertFriendAbsence(
  db: D1Database, friendId: string, targetDate: string,
  data: { reason?: string | null; source?: 'text' | 'manual' | 'richmenu' }
): Promise<void> {
  await db.prepare(
    `INSERT INTO friend_absences (friend_id, target_date, reason, source) VALUES (?, ?, ?, ?)
     ON CONFLICT(friend_id, target_date) DO UPDATE SET reason = excluded.reason, source = excluded.source`
  ).bind(friendId, targetDate, data.reason ?? null, data.source ?? 'text').run();
}

export async function deleteFriendAbsence(db: D1Database, friendId: string, targetDate: string): Promise<void> {
  await db.prepare('DELETE FROM friend_absences WHERE friend_id = ? AND target_date = ?')
    .bind(friendId, targetDate).run();
}

// ── Long Absence Alerts ───────────────────────────

export async function getLastAbsenceAlert(db: D1Database, friendId: string, alertType: 'long_absence'): Promise<{ alerted_at: string } | null> {
  return db.prepare(
    'SELECT alerted_at FROM friend_absence_alerts WHERE friend_id = ? AND alert_type = ? ORDER BY alerted_at DESC LIMIT 1'
  ).bind(friendId, alertType).first<{ alerted_at: string }>();
}

export async function insertAbsenceAlert(db: D1Database, friendId: string, alertType: 'long_absence', context: string): Promise<void> {
  await db.prepare(
    'INSERT INTO friend_absence_alerts (friend_id, alert_type, context) VALUES (?, ?, ?)'
  ).bind(friendId, alertType, context).run();
}

// ── Pending Revision Inputs ───────────────────────

export async function createPendingRevision(db: D1Database, friendId: string, targetMonth: string): Promise<void> {
  // 既存の未解決を解決済みにしてから新規作成
  await db.prepare('UPDATE pending_revision_inputs SET resolved = 1 WHERE friend_id = ? AND resolved = 0')
    .bind(friendId).run();
  await db.prepare(
    'INSERT INTO pending_revision_inputs (friend_id, target_month) VALUES (?, ?)'
  ).bind(friendId, targetMonth).run();
}

export async function getPendingRevision(db: D1Database, friendId: string): Promise<{ id: string; target_month: string; created_at: string } | null> {
  return db.prepare(
    `SELECT id, target_month, created_at FROM pending_revision_inputs
     WHERE friend_id = ? AND resolved = 0 ORDER BY created_at DESC LIMIT 1`
  ).bind(friendId).first<{ id: string; target_month: string; created_at: string }>();
}

export async function resolvePendingRevision(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE pending_revision_inputs SET resolved = 1 WHERE id = ?').bind(id).run();
}
