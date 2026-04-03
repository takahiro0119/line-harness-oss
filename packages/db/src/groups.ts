import { jstNow } from './utils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Group {
  id: string;
  line_group_id: string;
  line_account_id: string | null;
  name: string | null;
  member_count: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  friend_id: string | null;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface GroupMessageLog {
  id: string;
  group_id: string;
  line_user_id: string | null;
  direction: 'incoming' | 'outgoing';
  message_type: string;
  content: string;
  created_at: string;
}

export interface AttendanceSchedule {
  id: string;
  group_id: string;
  name: string;
  message: string;
  cron_expression: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  schedule_id: string;
  group_id: string;
  line_user_id: string;
  display_name: string | null;
  target_date: string;
  status: 'pending' | 'present' | 'absent' | 'late' | 'other';
  raw_reply: string | null;
  replied_at: string | null;
  created_at: string;
}

// ─── Groups CRUD ──────────────────────────────────────────────────────────────

export async function getGroups(db: D1Database, lineAccountId?: string): Promise<Group[]> {
  if (lineAccountId) {
    const result = await db
      .prepare('SELECT * FROM groups WHERE line_account_id = ? ORDER BY created_at DESC')
      .bind(lineAccountId)
      .all<Group>();
    return result.results;
  }
  const result = await db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all<Group>();
  return result.results;
}

export async function getGroupById(db: D1Database, id: string): Promise<Group | null> {
  return db.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<Group>();
}

export async function getGroupByLineGroupId(db: D1Database, lineGroupId: string): Promise<Group | null> {
  return db.prepare('SELECT * FROM groups WHERE line_group_id = ?').bind(lineGroupId).first<Group>();
}

export async function upsertGroup(
  db: D1Database,
  input: { lineGroupId: string; name?: string | null; lineAccountId?: string | null },
): Promise<Group> {
  const now = jstNow();
  const existing = await getGroupByLineGroupId(db, input.lineGroupId);

  if (existing) {
    await db
      .prepare('UPDATE groups SET name = COALESCE(?, name), updated_at = ? WHERE id = ?')
      .bind(input.name ?? null, now, existing.id)
      .run();
    return (await getGroupById(db, existing.id))!;
  }

  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO groups (id, line_group_id, line_account_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, input.lineGroupId, input.lineAccountId ?? null, input.name ?? null, now, now)
    .run();
  return (await getGroupById(db, id))!;
}

export async function updateGroup(
  db: D1Database,
  id: string,
  data: { name?: string; is_active?: number },
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
  if (data.is_active !== undefined) { sets.push('is_active = ?'); values.push(data.is_active); }
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteGroup(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
}

// ─── Group Members ────────────────────────────────────────────────────────────

export async function getGroupMembers(db: D1Database, groupId: string): Promise<GroupMember[]> {
  const result = await db
    .prepare('SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at ASC')
    .bind(groupId)
    .all<GroupMember>();
  return result.results;
}

export async function upsertGroupMember(
  db: D1Database,
  input: { groupId: string; lineUserId: string; displayName?: string | null; pictureUrl?: string | null; friendId?: string | null },
): Promise<GroupMember> {
  const existing = await db
    .prepare('SELECT * FROM group_members WHERE group_id = ? AND line_user_id = ?')
    .bind(input.groupId, input.lineUserId)
    .first<GroupMember>();

  if (existing) {
    const sets: string[] = [];
    const vals: (string | null)[] = [];
    if (input.displayName) { sets.push('display_name = ?'); vals.push(input.displayName); }
    if (input.pictureUrl !== undefined) { sets.push('picture_url = ?'); vals.push(input.pictureUrl ?? null); }
    if (sets.length > 0) {
      vals.push(existing.id);
      await db.prepare(`UPDATE group_members SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    }
    return (await db.prepare('SELECT * FROM group_members WHERE id = ?').bind(existing.id).first<GroupMember>())!;
  }

  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO group_members (id, group_id, friend_id, line_user_id, display_name, picture_url, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, input.groupId, input.friendId ?? null, input.lineUserId, input.displayName ?? null, input.pictureUrl ?? null, now)
    .run();

  // Update member count
  await db.prepare('UPDATE groups SET member_count = (SELECT COUNT(*) FROM group_members WHERE group_id = ?), updated_at = ? WHERE id = ?')
    .bind(input.groupId, now, input.groupId).run();

  return (await db.prepare('SELECT * FROM group_members WHERE id = ?').bind(id).first<GroupMember>())!;
}

export async function removeGroupMember(db: D1Database, groupId: string, lineUserId: string): Promise<void> {
  await db.prepare('DELETE FROM group_members WHERE group_id = ? AND line_user_id = ?').bind(groupId, lineUserId).run();
  const now = jstNow();
  await db.prepare('UPDATE groups SET member_count = (SELECT COUNT(*) FROM group_members WHERE group_id = ?), updated_at = ? WHERE id = ?')
    .bind(groupId, now, groupId).run();
}

// ─── Group Messages Log ──────────────────────────────────────────────────────

export async function logGroupMessage(
  db: D1Database,
  input: { groupId: string; lineUserId?: string | null; direction: 'incoming' | 'outgoing'; messageType: string; content: string },
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO group_messages_log (id, group_id, line_user_id, direction, message_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, input.groupId, input.lineUserId ?? null, input.direction, input.messageType, input.content, jstNow())
    .run();
}

export async function getGroupMessages(
  db: D1Database,
  groupId: string,
  limit = 50,
  offset = 0,
): Promise<GroupMessageLog[]> {
  const result = await db
    .prepare('SELECT * FROM group_messages_log WHERE group_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(groupId, limit, offset)
    .all<GroupMessageLog>();
  return result.results;
}

// ─── Attendance Schedules ─────────────────────────────────────────────────────

export async function getAttendanceSchedules(db: D1Database, groupId?: string): Promise<AttendanceSchedule[]> {
  if (groupId) {
    const result = await db
      .prepare('SELECT * FROM attendance_schedules WHERE group_id = ? ORDER BY created_at DESC')
      .bind(groupId)
      .all<AttendanceSchedule>();
    return result.results;
  }
  const result = await db.prepare('SELECT * FROM attendance_schedules ORDER BY created_at DESC').all<AttendanceSchedule>();
  return result.results;
}

export async function getAttendanceScheduleById(db: D1Database, id: string): Promise<AttendanceSchedule | null> {
  return db.prepare('SELECT * FROM attendance_schedules WHERE id = ?').bind(id).first<AttendanceSchedule>();
}

export async function createAttendanceSchedule(
  db: D1Database,
  input: { groupId: string; name: string; message?: string; cronExpression?: string },
): Promise<AttendanceSchedule> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO attendance_schedules (id, group_id, name, message, cron_expression, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      input.groupId,
      input.name,
      input.message ?? '本日の出勤予定を返信してください。\n出勤 / 休み / 遅刻 のいずれかで回答してください。',
      input.cronExpression ?? '0 9 * * 1-5',
      now,
      now,
    )
    .run();
  return (await getAttendanceScheduleById(db, id))!;
}

export async function updateAttendanceSchedule(
  db: D1Database,
  id: string,
  data: { name?: string; message?: string; cronExpression?: string; is_active?: number },
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
  if (data.message !== undefined) { sets.push('message = ?'); values.push(data.message); }
  if (data.cronExpression !== undefined) { sets.push('cron_expression = ?'); values.push(data.cronExpression); }
  if (data.is_active !== undefined) { sets.push('is_active = ?'); values.push(data.is_active); }
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE attendance_schedules SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteAttendanceSchedule(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM attendance_schedules WHERE id = ?').bind(id).run();
}

// ─── Attendance Records ───────────────────────────────────────────────────────

export async function getAttendanceRecords(
  db: D1Database,
  filters: { scheduleId?: string; groupId?: string; targetDate?: string; status?: string },
): Promise<AttendanceRecord[]> {
  const conditions: string[] = [];
  const values: string[] = [];

  if (filters.scheduleId) { conditions.push('schedule_id = ?'); values.push(filters.scheduleId); }
  if (filters.groupId) { conditions.push('group_id = ?'); values.push(filters.groupId); }
  if (filters.targetDate) { conditions.push('target_date = ?'); values.push(filters.targetDate); }
  if (filters.status) { conditions.push('status = ?'); values.push(filters.status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db
    .prepare(`SELECT * FROM attendance_records ${where} ORDER BY created_at DESC`)
    .bind(...values)
    .all<AttendanceRecord>();
  return result.results;
}

export async function upsertAttendanceRecord(
  db: D1Database,
  input: {
    scheduleId: string;
    groupId: string;
    lineUserId: string;
    displayName?: string | null;
    targetDate: string;
    status?: string;
    rawReply?: string | null;
  },
): Promise<AttendanceRecord> {
  const existing = await db
    .prepare('SELECT * FROM attendance_records WHERE schedule_id = ? AND line_user_id = ? AND target_date = ?')
    .bind(input.scheduleId, input.lineUserId, input.targetDate)
    .first<AttendanceRecord>();

  if (existing) {
    const now = jstNow();
    await db
      .prepare('UPDATE attendance_records SET status = ?, raw_reply = ?, replied_at = ?, display_name = COALESCE(?, display_name) WHERE id = ?')
      .bind(input.status ?? existing.status, input.rawReply ?? existing.raw_reply, now, input.displayName ?? null, existing.id)
      .run();
    return (await db.prepare('SELECT * FROM attendance_records WHERE id = ?').bind(existing.id).first<AttendanceRecord>())!;
  }

  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO attendance_records (id, schedule_id, group_id, line_user_id, display_name, target_date, status, raw_reply, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, input.scheduleId, input.groupId, input.lineUserId, input.displayName ?? null, input.targetDate, input.status ?? 'pending', input.rawReply ?? null, now)
    .run();
  return (await db.prepare('SELECT * FROM attendance_records WHERE id = ?').bind(id).first<AttendanceRecord>())!;
}

// ─── Attendance Summary ───────────────────────────────────────────────────────

export interface AttendanceSummary {
  targetDate: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  pending: number;
  other: number;
}

export async function getAttendanceSummary(
  db: D1Database,
  groupId: string,
  startDate?: string,
  endDate?: string,
): Promise<AttendanceSummary[]> {
  let query = `
    SELECT
      target_date,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
      SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
      SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'other' THEN 1 ELSE 0 END) as other
    FROM attendance_records
    WHERE group_id = ?
  `;
  const values: string[] = [groupId];

  if (startDate) { query += ' AND target_date >= ?'; values.push(startDate); }
  if (endDate) { query += ' AND target_date <= ?'; values.push(endDate); }

  query += ' GROUP BY target_date ORDER BY target_date DESC';

  const result = await db.prepare(query).bind(...values).all<{
    target_date: string; total: number; present: number; absent: number; late: number; pending: number; other: number;
  }>();

  return result.results.map(r => ({
    targetDate: r.target_date,
    total: r.total,
    present: r.present,
    absent: r.absent,
    late: r.late,
    pending: r.pending,
    other: r.other,
  }));
}

// ─── Parse attendance reply ───────────────────────────────────────────────────

export function parseAttendanceReply(text: string): 'present' | 'absent' | 'late' | 'other' {
  const normalized = text.trim().toLowerCase();
  if (/^(出勤|出社|行きます|出ます|ok|○|⭕|🙆)/.test(normalized)) return 'present';
  if (/^(休み|欠勤|休みます|休む|お休み|×|❌|🙅)/.test(normalized)) return 'absent';
  if (/^(遅刻|遅れ|遅れます|遅延|△)/.test(normalized)) return 'late';
  return 'other';
}
