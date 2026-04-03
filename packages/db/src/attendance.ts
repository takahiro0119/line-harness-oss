/**
 * 勤怠打刻システム DB層
 */

// ── Types ──────────────────────────────────────────

export interface AttendanceSettingsRow {
  id: string;
  group_id: string;
  is_enabled: number;
  clock_in_time: string;
  clock_in_reminder_time: string;
  clock_out_time: string;
  clock_out_reminder_time: string;
  monthly_confirm_day: number;
  created_at: string;
  updated_at: string;
}

export interface ShiftPatternRow {
  id: string;
  group_id: string;
  line_user_id: string | null;
  pattern_type: 'weekday' | 'custom';
  work_days: string;
  exclude_holidays: number;
  created_at: string;
  updated_at: string;
}

export interface ClockRecordRow {
  id: string;
  group_id: string;
  line_user_id: string;
  display_name: string | null;
  target_date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: number | null;
  clock_in_source: 'button' | 'reminder' | 'manual' | null;
  clock_out_source: 'button' | 'reminder' | 'manual' | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyConfirmationRow {
  id: string;
  group_id: string;
  line_user_id: string;
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

export interface ClockReminderRow {
  id: string;
  group_id: string;
  line_user_id: string;
  reminder_type: 'clock_in' | 'clock_out';
  target_date: string;
  sent_at: string;
  resolved: number;
}

// ── Attendance Settings ────────────────────────────

export async function getAttendanceSettings(db: D1Database, groupId: string): Promise<AttendanceSettingsRow | null> {
  return db.prepare('SELECT * FROM attendance_settings WHERE group_id = ?').bind(groupId).first<AttendanceSettingsRow>();
}

export async function getAllEnabledAttendanceSettings(db: D1Database): Promise<AttendanceSettingsRow[]> {
  const r = await db.prepare('SELECT * FROM attendance_settings WHERE is_enabled = 1').all<AttendanceSettingsRow>();
  return r.results;
}

export async function upsertAttendanceSettings(
  db: D1Database,
  groupId: string,
  data: Partial<Omit<AttendanceSettingsRow, 'id' | 'group_id' | 'created_at' | 'updated_at'>>
): Promise<void> {
  const existing = await getAttendanceSettings(db, groupId);
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
      values.push(groupId);
      await db.prepare(`UPDATE attendance_settings SET ${fields.join(', ')} WHERE group_id = ?`).bind(...values).run();
    }
  } else {
    await db.prepare(
      `INSERT INTO attendance_settings (group_id, is_enabled, clock_in_time, clock_in_reminder_time, clock_out_time, clock_out_reminder_time, monthly_confirm_day)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      groupId,
      data.is_enabled ?? 1,
      data.clock_in_time ?? '09:00',
      data.clock_in_reminder_time ?? '12:00',
      data.clock_out_time ?? '20:00',
      data.clock_out_reminder_time ?? '22:00',
      data.monthly_confirm_day ?? 1
    ).run();
  }
}

// ── Shift Patterns ─────────────────────────────────

export async function getShiftPattern(db: D1Database, groupId: string, lineUserId?: string): Promise<ShiftPatternRow | null> {
  // 個人のシフトがあればそれを、なければグループデフォルトを返す
  if (lineUserId) {
    const personal = await db.prepare(
      'SELECT * FROM shift_patterns WHERE group_id = ? AND line_user_id = ?'
    ).bind(groupId, lineUserId).first<ShiftPatternRow>();
    if (personal) return personal;
  }
  return db.prepare(
    'SELECT * FROM shift_patterns WHERE group_id = ? AND line_user_id IS NULL'
  ).bind(groupId).first<ShiftPatternRow>();
}

export async function getShiftPatterns(db: D1Database, groupId: string): Promise<ShiftPatternRow[]> {
  const r = await db.prepare('SELECT * FROM shift_patterns WHERE group_id = ?').bind(groupId).all<ShiftPatternRow>();
  return r.results;
}

export async function upsertShiftPattern(
  db: D1Database,
  groupId: string,
  lineUserId: string | null,
  data: { patternType?: string; workDays?: string; excludeHolidays?: number }
): Promise<void> {
  if (lineUserId) {
    await db.prepare(
      `INSERT INTO shift_patterns (group_id, line_user_id, pattern_type, work_days, exclude_holidays)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id, line_user_id) DO UPDATE SET
         pattern_type = excluded.pattern_type,
         work_days = excluded.work_days,
         exclude_holidays = excluded.exclude_holidays,
         updated_at = datetime('now')`
    ).bind(
      groupId, lineUserId,
      data.patternType ?? 'weekday',
      data.workDays ?? '1,2,3,4,5',
      data.excludeHolidays ?? 1
    ).run();
  } else {
    // グループデフォルト: line_user_id IS NULL の UNIQUE制約
    const existing = await db.prepare(
      'SELECT id FROM shift_patterns WHERE group_id = ? AND line_user_id IS NULL'
    ).bind(groupId).first();
    if (existing) {
      await db.prepare(
        `UPDATE shift_patterns SET pattern_type = ?, work_days = ?, exclude_holidays = ?, updated_at = datetime('now')
         WHERE group_id = ? AND line_user_id IS NULL`
      ).bind(data.patternType ?? 'weekday', data.workDays ?? '1,2,3,4,5', data.excludeHolidays ?? 1, groupId).run();
    } else {
      await db.prepare(
        `INSERT INTO shift_patterns (group_id, line_user_id, pattern_type, work_days, exclude_holidays)
         VALUES (?, NULL, ?, ?, ?)`
      ).bind(groupId, data.patternType ?? 'weekday', data.workDays ?? '1,2,3,4,5', data.excludeHolidays ?? 1).run();
    }
  }
}

export async function deleteShiftPattern(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM shift_patterns WHERE id = ?').bind(id).run();
}

// ── Clock Records ──────────────────────────────────

export async function getClockRecord(db: D1Database, groupId: string, lineUserId: string, targetDate: string): Promise<ClockRecordRow | null> {
  return db.prepare(
    'SELECT * FROM clock_records WHERE group_id = ? AND line_user_id = ? AND target_date = ?'
  ).bind(groupId, lineUserId, targetDate).first<ClockRecordRow>();
}

export async function getClockRecordsByGroup(db: D1Database, groupId: string, targetDate?: string, startDate?: string, endDate?: string): Promise<ClockRecordRow[]> {
  let sql = 'SELECT * FROM clock_records WHERE group_id = ?';
  const binds: unknown[] = [groupId];
  if (targetDate) {
    sql += ' AND target_date = ?';
    binds.push(targetDate);
  }
  if (startDate) {
    sql += ' AND target_date >= ?';
    binds.push(startDate);
  }
  if (endDate) {
    sql += ' AND target_date <= ?';
    binds.push(endDate);
  }
  sql += ' ORDER BY target_date DESC, display_name ASC';
  const r = await db.prepare(sql).bind(...binds).all<ClockRecordRow>();
  return r.results;
}

export async function getClockRecordsByMonth(db: D1Database, groupId: string, lineUserId: string, targetMonth: string): Promise<ClockRecordRow[]> {
  const r = await db.prepare(
    `SELECT * FROM clock_records WHERE group_id = ? AND line_user_id = ? AND target_date LIKE ? ORDER BY target_date ASC`
  ).bind(groupId, lineUserId, targetMonth + '%').all<ClockRecordRow>();
  return r.results;
}

export async function upsertClockIn(
  db: D1Database,
  groupId: string,
  lineUserId: string,
  displayName: string | null,
  targetDate: string,
  clockInTime: string,
  source: 'button' | 'reminder' | 'manual'
): Promise<void> {
  await db.prepare(
    `INSERT INTO clock_records (group_id, line_user_id, display_name, target_date, clock_in, clock_in_source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id, line_user_id, target_date) DO UPDATE SET
       clock_in = excluded.clock_in,
       clock_in_source = excluded.clock_in_source,
       display_name = COALESCE(excluded.display_name, display_name),
       updated_at = datetime('now')`
  ).bind(groupId, lineUserId, displayName, targetDate, clockInTime, source).run();
}

export async function upsertClockOut(
  db: D1Database,
  groupId: string,
  lineUserId: string,
  displayName: string | null,
  targetDate: string,
  clockOutTime: string,
  source: 'button' | 'reminder' | 'manual'
): Promise<void> {
  // まず既存レコードを取得して稼働時間を計算
  const existing = await getClockRecord(db, groupId, lineUserId, targetDate);
  let workHours: number | null = null;
  if (existing?.clock_in) {
    const [inH, inM] = existing.clock_in.split(':').map(Number);
    const [outH, outM] = clockOutTime.split(':').map(Number);
    workHours = Math.round(((outH * 60 + outM) - (inH * 60 + inM)) / 60 * 100) / 100;
    if (workHours < 0) workHours = null; // invalid
  }

  await db.prepare(
    `INSERT INTO clock_records (group_id, line_user_id, display_name, target_date, clock_out, clock_out_source, work_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id, line_user_id, target_date) DO UPDATE SET
       clock_out = excluded.clock_out,
       clock_out_source = excluded.clock_out_source,
       work_hours = ?,
       display_name = COALESCE(excluded.display_name, display_name),
       updated_at = datetime('now')`
  ).bind(groupId, lineUserId, displayName, targetDate, clockOutTime, source, workHours, workHours).run();
}

// ── Clock Reminders ────────────────────────────────

export async function getPendingReminder(
  db: D1Database,
  groupId: string,
  lineUserId: string
): Promise<ClockReminderRow | null> {
  return db.prepare(
    'SELECT * FROM clock_reminders WHERE group_id = ? AND line_user_id = ? AND resolved = 0 ORDER BY sent_at DESC LIMIT 1'
  ).bind(groupId, lineUserId).first<ClockReminderRow>();
}

export async function insertClockReminder(
  db: D1Database,
  groupId: string,
  lineUserId: string,
  reminderType: 'clock_in' | 'clock_out',
  targetDate: string
): Promise<void> {
  await db.prepare(
    `INSERT INTO clock_reminders (group_id, line_user_id, reminder_type, target_date)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(group_id, line_user_id, reminder_type, target_date) DO UPDATE SET
       resolved = 0, sent_at = datetime('now')`
  ).bind(groupId, lineUserId, reminderType, targetDate).run();
}

export async function resolveClockReminder(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE clock_reminders SET resolved = 1 WHERE id = ?').bind(id).run();
}

// ── Monthly Confirmations ──────────────────────────

export async function getMonthlyConfirmation(
  db: D1Database,
  groupId: string,
  lineUserId: string,
  targetMonth: string
): Promise<MonthlyConfirmationRow | null> {
  return db.prepare(
    'SELECT * FROM monthly_confirmations WHERE group_id = ? AND line_user_id = ? AND target_month = ?'
  ).bind(groupId, lineUserId, targetMonth).first<MonthlyConfirmationRow>();
}

export async function getMonthlyConfirmations(
  db: D1Database,
  groupId: string,
  targetMonth: string
): Promise<MonthlyConfirmationRow[]> {
  const r = await db.prepare(
    'SELECT * FROM monthly_confirmations WHERE group_id = ? AND target_month = ? ORDER BY display_name ASC'
  ).bind(groupId, targetMonth).all<MonthlyConfirmationRow>();
  return r.results;
}

export async function upsertMonthlyConfirmation(
  db: D1Database,
  groupId: string,
  lineUserId: string,
  displayName: string | null,
  targetMonth: string,
  totalDays: number,
  totalHours: number
): Promise<void> {
  await db.prepare(
    `INSERT INTO monthly_confirmations (group_id, line_user_id, display_name, target_month, total_days, total_hours, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(group_id, line_user_id, target_month) DO UPDATE SET
       total_days = excluded.total_days,
       total_hours = excluded.total_hours,
       sent_at = datetime('now'),
       status = 'pending',
       confirmed_at = NULL`
  ).bind(groupId, lineUserId, displayName, targetMonth, totalDays, totalHours).run();
}

export async function confirmMonthly(db: D1Database, groupId: string, lineUserId: string, targetMonth: string): Promise<void> {
  await db.prepare(
    `UPDATE monthly_confirmations SET status = 'confirmed', confirmed_at = datetime('now')
     WHERE group_id = ? AND line_user_id = ? AND target_month = ?`
  ).bind(groupId, lineUserId, targetMonth).run();
}

export async function requestMonthlyRevision(db: D1Database, groupId: string, lineUserId: string, targetMonth: string, note?: string): Promise<void> {
  await db.prepare(
    `UPDATE monthly_confirmations SET status = 'revision_requested', revision_note = ?
     WHERE group_id = ? AND line_user_id = ? AND target_month = ?`
  ).bind(note ?? null, groupId, lineUserId, targetMonth).run();
}

// ── Helpers ────────────────────────────────────────

/**
 * グループの未打刻メンバーを取得
 */
export async function getUnclocked(
  db: D1Database,
  groupId: string,
  targetDate: string,
  type: 'clock_in' | 'clock_out'
): Promise<Array<{ line_user_id: string; display_name: string | null }>> {
  const column = type === 'clock_in' ? 'clock_in' : 'clock_out';
  const r = await db.prepare(
    `SELECT gm.line_user_id, gm.display_name
     FROM group_members gm
     WHERE gm.group_id = ?
       AND gm.line_user_id NOT IN (
         SELECT line_user_id FROM clock_records
         WHERE group_id = ? AND target_date = ? AND ${column} IS NOT NULL
       )`
  ).bind(groupId, groupId, targetDate).all<{ line_user_id: string; display_name: string | null }>();
  return r.results;
}

/**
 * テキストから時刻をパース
 * "9時" → "09:00", "9:30" → "09:30", "14時半" → "14:30", "9" → "09:00"
 */
export function parseTimeText(text: string): string | null {
  const trimmed = text.trim();

  // HH:MM or H:MM format
  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1]);
    const m = parseInt(colonMatch[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  // "9時30分" or "9時半"
  const jpFullMatch = trimmed.match(/^(\d{1,2})時((\d{1,2})分|半)?$/);
  if (jpFullMatch) {
    const h = parseInt(jpFullMatch[1]);
    let m = 0;
    if (jpFullMatch[2] === '半') m = 30;
    else if (jpFullMatch[3]) m = parseInt(jpFullMatch[3]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  // Just a number "9" or "09" → treat as hour
  const numMatch = trimmed.match(/^(\d{1,2})$/);
  if (numMatch) {
    const h = parseInt(numMatch[1]);
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, '0')}:00`;
    }
  }

  // "0930" or "930" four/three digit format
  const fourDigitMatch = trimmed.match(/^(\d{3,4})$/);
  if (fourDigitMatch) {
    const s = fourDigitMatch[1].padStart(4, '0');
    const h = parseInt(s.slice(0, 2));
    const m = parseInt(s.slice(2));
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * 月の稼働サマリーを計算
 */
export async function calcMonthlySummary(
  db: D1Database,
  groupId: string,
  lineUserId: string,
  targetMonth: string
): Promise<{ totalDays: number; totalHours: number }> {
  const records = await getClockRecordsByMonth(db, groupId, lineUserId, targetMonth);
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
