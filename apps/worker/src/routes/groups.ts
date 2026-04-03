import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  getGroups,
  getGroupById,
  updateGroup,
  deleteGroup,
  getGroupMembers,
  getGroupMessages,
  getAttendanceSchedules,
  getAttendanceScheduleById,
  createAttendanceSchedule,
  updateAttendanceSchedule,
  deleteAttendanceSchedule,
  getAttendanceRecords,
  getAttendanceSummary,
  upsertAttendanceRecord,
  logGroupMessage,
  jstNow,
  // 勤怠打刻
  getAttendanceSettings,
  upsertAttendanceSettings,
  getShiftPatterns,
  upsertShiftPattern,
  deleteShiftPattern,
  getClockRecordsByGroup,
  getClockRecordsByMonth,
  upsertClockIn,
  upsertClockOut,
  getMonthlyConfirmations,
  calcMonthlySummary,
} from '@line-crm/db';
import type { Env } from '../index.js';

const groups = new Hono<Env>();

// ─── Groups CRUD ──────────────────────────────────────────────────────────────

groups.get('/api/groups', async (c) => {
  const db = c.env.DB;
  const lineAccountId = c.req.query('lineAccountId');
  const items = await getGroups(db, lineAccountId || undefined);
  return c.json({
    success: true,
    data: items.map((g) => ({
      id: g.id,
      lineGroupId: g.line_group_id,
      lineAccountId: g.line_account_id,
      name: g.name,
      memberCount: g.member_count,
      isActive: !!g.is_active,
      createdAt: g.created_at,
      updatedAt: g.updated_at,
    })),
  });
});

groups.get('/api/groups/:id', async (c) => {
  const db = c.env.DB;
  const group = await getGroupById(db, c.req.param('id'));
  if (!group) return c.json({ success: false, error: 'Group not found' }, 404);

  const members = await getGroupMembers(db, group.id);
  return c.json({
    success: true,
    data: {
      id: group.id,
      lineGroupId: group.line_group_id,
      lineAccountId: group.line_account_id,
      name: group.name,
      memberCount: group.member_count,
      isActive: !!group.is_active,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
      members: members.map((m) => ({
        id: m.id,
        lineUserId: m.line_user_id,
        displayName: m.display_name,
        pictureUrl: m.picture_url,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    },
  });
});

groups.put('/api/groups/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; isActive?: boolean }>();
  await updateGroup(db, id, {
    name: body.name,
    is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
  });
  const group = await getGroupById(db, id);
  return c.json({ success: true, data: group });
});

groups.delete('/api/groups/:id', async (c) => {
  const db = c.env.DB;
  await deleteGroup(db, c.req.param('id'));
  return c.json({ success: true, data: null });
});

// ─── Group Messages ───────────────────────────────────────────────────────────

groups.get('/api/groups/:id/messages', async (c) => {
  const db = c.env.DB;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const messages = await getGroupMessages(db, c.req.param('id'), limit, offset);
  return c.json({ success: true, data: messages });
});

// ─── Send message to group ────────────────────────────────────────────────────

groups.post('/api/groups/:id/send', async (c) => {
  const db = c.env.DB;
  const group = await getGroupById(db, c.req.param('id'));
  if (!group) return c.json({ success: false, error: 'Group not found' }, 404);

  const body = await c.req.json<{ content: string; messageType?: string }>();
  const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);

  const messages = body.messageType === 'flex'
    ? [{ type: 'flex' as const, altText: '通知', contents: JSON.parse(body.content) }]
    : [{ type: 'text' as const, text: body.content }];

  await lineClient.pushMessage(group.line_group_id, messages);

  await logGroupMessage(db, {
    groupId: group.id,
    direction: 'outgoing',
    messageType: body.messageType || 'text',
    content: body.content,
  });

  return c.json({ success: true, data: { sent: true } });
});

// ─── Attendance Schedules ─────────────────────────────────────────────────────

groups.get('/api/groups/:id/attendance/schedules', async (c) => {
  const db = c.env.DB;
  const schedules = await getAttendanceSchedules(db, c.req.param('id'));
  return c.json({
    success: true,
    data: schedules.map((s) => ({
      id: s.id,
      groupId: s.group_id,
      name: s.name,
      message: s.message,
      cronExpression: s.cron_expression,
      isActive: !!s.is_active,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
  });
});

groups.post('/api/groups/:id/attendance/schedules', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ name: string; message?: string; cronExpression?: string }>();
  const schedule = await createAttendanceSchedule(db, {
    groupId: c.req.param('id'),
    name: body.name,
    message: body.message,
    cronExpression: body.cronExpression,
  });
  return c.json({ success: true, data: schedule }, 201);
});

groups.put('/api/attendance/schedules/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; message?: string; cronExpression?: string; isActive?: boolean }>();
  await updateAttendanceSchedule(db, id, {
    name: body.name,
    message: body.message,
    cronExpression: body.cronExpression,
    is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
  });
  const schedule = await getAttendanceScheduleById(db, id);
  return c.json({ success: true, data: schedule });
});

groups.delete('/api/attendance/schedules/:id', async (c) => {
  const db = c.env.DB;
  await deleteAttendanceSchedule(db, c.req.param('id'));
  return c.json({ success: true, data: null });
});

// ─── Attendance Records ───────────────────────────────────────────────────────

groups.get('/api/groups/:id/attendance/records', async (c) => {
  const db = c.env.DB;
  const groupId = c.req.param('id');
  const targetDate = c.req.query('date');
  const scheduleId = c.req.query('scheduleId');
  const status = c.req.query('status');

  const records = await getAttendanceRecords(db, {
    groupId,
    targetDate: targetDate || undefined,
    scheduleId: scheduleId || undefined,
    status: status || undefined,
  });

  return c.json({
    success: true,
    data: records.map((r) => ({
      id: r.id,
      scheduleId: r.schedule_id,
      groupId: r.group_id,
      lineUserId: r.line_user_id,
      displayName: r.display_name,
      targetDate: r.target_date,
      status: r.status,
      rawReply: r.raw_reply,
      repliedAt: r.replied_at,
      createdAt: r.created_at,
    })),
  });
});

// ─── Attendance Summary ───────────────────────────────────────────────────────

groups.get('/api/groups/:id/attendance/summary', async (c) => {
  const db = c.env.DB;
  const groupId = c.req.param('id');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const summary = await getAttendanceSummary(db, groupId, startDate || undefined, endDate || undefined);
  return c.json({ success: true, data: summary });
});

// ─── Send attendance message to group ─────────────────────────────────────────

groups.post('/api/groups/:id/attendance/send', async (c) => {
  const db = c.env.DB;
  const group = await getGroupById(db, c.req.param('id'));
  if (!group) return c.json({ success: false, error: 'Group not found' }, 404);

  const body = await c.req.json<{ scheduleId: string }>();
  const schedule = await getAttendanceScheduleById(db, body.scheduleId);
  if (!schedule) return c.json({ success: false, error: 'Schedule not found' }, 404);

  const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);

  // Send attendance message to group
  await lineClient.pushMessage(group.line_group_id, [{ type: 'text', text: schedule.message }]);

  // Log outgoing message
  await logGroupMessage(db, {
    groupId: group.id,
    direction: 'outgoing',
    messageType: 'text',
    content: schedule.message,
  });

  // Create pending records for all members
  const members = await getGroupMembers(db, group.id);
  const now = new Date(Date.now() + 9 * 60 * 60_000);
  const targetDate = now.toISOString().slice(0, 10);

  for (const member of members) {
    await upsertAttendanceRecord(db, {
      scheduleId: schedule.id,
      groupId: group.id,
      lineUserId: member.line_user_id,
      displayName: member.display_name,
      targetDate,
    });
  }

  return c.json({ success: true, data: { sent: true, memberCount: members.length, targetDate } });
});

// ─── 勤怠打刻 設定 ──────────────────────────────────────────────────────────

groups.get('/api/groups/:id/clock/settings', async (c) => {
  const db = c.env.DB;
  const settings = await getAttendanceSettings(db, c.req.param('id'));
  if (!settings) return c.json({ success: true, data: null });
  return c.json({
    success: true,
    data: {
      id: settings.id,
      groupId: settings.group_id,
      isEnabled: !!settings.is_enabled,
      clockInTime: settings.clock_in_time,
      clockInReminderTime: settings.clock_in_reminder_time,
      clockOutTime: settings.clock_out_time,
      clockOutReminderTime: settings.clock_out_reminder_time,
      monthlyConfirmDay: settings.monthly_confirm_day,
    },
  });
});

groups.put('/api/groups/:id/clock/settings', async (c) => {
  const db = c.env.DB;
  const groupId = c.req.param('id');
  const body = await c.req.json<{
    isEnabled?: boolean;
    clockInTime?: string;
    clockInReminderTime?: string;
    clockOutTime?: string;
    clockOutReminderTime?: string;
    monthlyConfirmDay?: number;
  }>();
  await upsertAttendanceSettings(db, groupId, {
    is_enabled: body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : undefined,
    clock_in_time: body.clockInTime,
    clock_in_reminder_time: body.clockInReminderTime,
    clock_out_time: body.clockOutTime,
    clock_out_reminder_time: body.clockOutReminderTime,
    monthly_confirm_day: body.monthlyConfirmDay,
  });
  const settings = await getAttendanceSettings(db, groupId);
  return c.json({ success: true, data: settings });
});

// ─── シフトパターン ──────────────────────────────────────────────────────────

groups.get('/api/groups/:id/clock/shifts', async (c) => {
  const db = c.env.DB;
  const shifts = await getShiftPatterns(db, c.req.param('id'));
  return c.json({
    success: true,
    data: shifts.map((s) => ({
      id: s.id,
      groupId: s.group_id,
      lineUserId: s.line_user_id,
      patternType: s.pattern_type,
      workDays: s.work_days,
      excludeHolidays: !!s.exclude_holidays,
    })),
  });
});

groups.put('/api/groups/:id/clock/shifts', async (c) => {
  const db = c.env.DB;
  const groupId = c.req.param('id');
  const body = await c.req.json<{
    lineUserId?: string | null;
    patternType?: string;
    workDays?: string;
    excludeHolidays?: boolean;
  }>();
  await upsertShiftPattern(db, groupId, body.lineUserId ?? null, {
    patternType: body.patternType,
    workDays: body.workDays,
    excludeHolidays: body.excludeHolidays !== undefined ? (body.excludeHolidays ? 1 : 0) : undefined,
  });
  const shifts = await getShiftPatterns(db, groupId);
  return c.json({ success: true, data: shifts });
});

groups.delete('/api/clock/shifts/:id', async (c) => {
  const db = c.env.DB;
  await deleteShiftPattern(db, c.req.param('id'));
  return c.json({ success: true, data: null });
});

// ─── 打刻記録 ────────────────────────────────────────────────────────────────

groups.get('/api/groups/:id/clock/records', async (c) => {
  const db = c.env.DB;
  const groupId = c.req.param('id');
  const date = c.req.query('date');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const records = await getClockRecordsByGroup(db, groupId, date || undefined, startDate || undefined, endDate || undefined);
  return c.json({
    success: true,
    data: records.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      lineUserId: r.line_user_id,
      displayName: r.display_name,
      targetDate: r.target_date,
      clockIn: r.clock_in,
      clockOut: r.clock_out,
      workHours: r.work_hours,
      clockInSource: r.clock_in_source,
      clockOutSource: r.clock_out_source,
    })),
  });
});

// 手動打刻（管理画面から）
groups.post('/api/groups/:id/clock/records', async (c) => {
  const db = c.env.DB;
  const groupId = c.req.param('id');
  const body = await c.req.json<{
    lineUserId: string;
    displayName?: string;
    targetDate: string;
    clockIn?: string;
    clockOut?: string;
  }>();
  if (body.clockIn) {
    await upsertClockIn(db, groupId, body.lineUserId, body.displayName || null, body.targetDate, body.clockIn, 'manual');
  }
  if (body.clockOut) {
    await upsertClockOut(db, groupId, body.lineUserId, body.displayName || null, body.targetDate, body.clockOut, 'manual');
  }
  return c.json({ success: true, data: { recorded: true } });
});

// ─── 月次確認 ────────────────────────────────────────────────────────────────

groups.get('/api/groups/:id/clock/monthly', async (c) => {
  const db = c.env.DB;
  const groupId = c.req.param('id');
  const month = c.req.query('month');
  if (!month) return c.json({ success: false, error: 'month query parameter required' }, 400);
  const confirmations = await getMonthlyConfirmations(db, groupId, month);
  return c.json({
    success: true,
    data: confirmations.map((mc) => ({
      id: mc.id,
      groupId: mc.group_id,
      lineUserId: mc.line_user_id,
      displayName: mc.display_name,
      targetMonth: mc.target_month,
      totalDays: mc.total_days,
      totalHours: mc.total_hours,
      status: mc.status,
      sentAt: mc.sent_at,
      confirmedAt: mc.confirmed_at,
      revisionNote: mc.revision_note,
    })),
  });
});

export { groups };
