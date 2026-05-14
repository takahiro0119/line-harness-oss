/**
 * 1:1勤怠管理 APIルート + リッチメニュー作成
 */

import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  getAttendanceConfig,
  upsertAttendanceConfig,
  getAllFriendShifts,
  getFriendShift,
  upsertFriendShift,
  deleteFriendShift,
  getFriendClockRecords,
  upsertFriendClockIn,
  upsertFriendClockOut,
  getFriendMonthlyConfirmations,
  getAttendanceTargets,
} from '@line-crm/db';
import type { Env } from '../index.js';

const friendAttendance = new Hono<Env>();

// ─── グローバル勤怠設定 ──────────────────────────────────────────────────

friendAttendance.get('/api/attendance/config', async (c) => {
  const db = c.env.DB;
  const lineAccountId = c.req.query('lineAccountId') || null;
  const config = await getAttendanceConfig(db, lineAccountId);
  if (!config) return c.json({ success: true, data: null });
  return c.json({
    success: true,
    data: {
      id: config.id,
      lineAccountId: config.line_account_id,
      isEnabled: !!config.is_enabled,
      clockInTime: config.clock_in_time,
      clockInReminderTime: config.clock_in_reminder_time,
      clockOutTime: config.clock_out_time,
      clockOutReminderTime: config.clock_out_reminder_time,
      monthlyConfirmDay: config.monthly_confirm_day,
    },
  });
});

friendAttendance.put('/api/attendance/config', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    lineAccountId?: string | null;
    isEnabled?: boolean;
    clockInTime?: string;
    clockInReminderTime?: string;
    clockOutTime?: string;
    clockOutReminderTime?: string;
    monthlyConfirmDay?: number;
  }>();
  await upsertAttendanceConfig(db, body.lineAccountId ?? null, {
    is_enabled: body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : undefined,
    clock_in_time: body.clockInTime,
    clock_in_reminder_time: body.clockInReminderTime,
    clock_out_time: body.clockOutTime,
    clock_out_reminder_time: body.clockOutReminderTime,
    monthly_confirm_day: body.monthlyConfirmDay,
  });
  return c.json({ success: true });
});

// ─── 友だちシフト管理 ────────────────────────────────────────────────────

friendAttendance.get('/api/attendance/shifts', async (c) => {
  const db = c.env.DB;
  const shifts = await getAllFriendShifts(db);
  return c.json({
    success: true,
    data: shifts.map(s => ({
      id: s.id,
      friendId: s.friend_id,
      patternType: s.pattern_type,
      workDays: s.work_days,
      excludeHolidays: !!s.exclude_holidays,
      clockInTime: s.clock_in_time,
      clockInReminderTime: s.clock_in_reminder_time,
      clockOutTime: s.clock_out_time,
      clockOutReminderTime: s.clock_out_reminder_time,
      isExcluded: !!s.is_excluded,
    })),
  });
});

friendAttendance.put('/api/attendance/shifts/:friendId', async (c) => {
  const db = c.env.DB;
  const friendId = c.req.param('friendId');
  const body = await c.req.json<{
    patternType?: string;
    workDays?: string;
    excludeHolidays?: boolean;
    clockInTime?: string | null;
    clockInReminderTime?: string | null;
    clockOutTime?: string | null;
    clockOutReminderTime?: string | null;
    isExcluded?: boolean;
  }>();
  await upsertFriendShift(db, friendId, {
    pattern_type: body.patternType as 'default' | 'custom' | undefined,
    work_days: body.workDays,
    exclude_holidays: body.excludeHolidays !== undefined ? (body.excludeHolidays ? 1 : 0) : undefined,
    clock_in_time: body.clockInTime,
    clock_in_reminder_time: body.clockInReminderTime,
    clock_out_time: body.clockOutTime,
    clock_out_reminder_time: body.clockOutReminderTime,
    is_excluded: body.isExcluded !== undefined ? (body.isExcluded ? 1 : 0) : undefined,
  });
  return c.json({ success: true });
});

friendAttendance.delete('/api/attendance/shifts/:friendId', async (c) => {
  const db = c.env.DB;
  await deleteFriendShift(db, c.req.param('friendId'));
  return c.json({ success: true });
});

// ─── 勤怠対象者一覧 ─────────────────────────────────────────────────────

friendAttendance.get('/api/attendance/targets', async (c) => {
  const db = c.env.DB;
  const lineAccountId = c.req.query('lineAccountId') || null;
  const targets = await getAttendanceTargets(db, lineAccountId);
  return c.json({
    success: true,
    data: targets.map(t => ({
      friendId: t.friend_id,
      lineUserId: t.line_user_id,
      displayName: t.display_name,
      clockInTime: t.clock_in_time,
      clockOutTime: t.clock_out_time,
      workDays: t.work_days,
      excludeHolidays: t.exclude_holidays,
    })),
  });
});

// ─── 打刻記録 ────────────────────────────────────────────────────────────

friendAttendance.get('/api/attendance/records', async (c) => {
  const db = c.env.DB;
  const friendId = c.req.query('friendId') || undefined;
  const date = c.req.query('date') || undefined;
  const startDate = c.req.query('startDate') || undefined;
  const endDate = c.req.query('endDate') || undefined;
  const records = await getFriendClockRecords(db, { friendId, targetDate: date, startDate, endDate });
  return c.json({
    success: true,
    data: records.map(r => ({
      id: r.id,
      friendId: r.friend_id,
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

// 手動打刻
friendAttendance.post('/api/attendance/records', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    friendId: string;
    lineUserId: string;
    displayName?: string;
    targetDate: string;
    clockIn?: string;
    clockOut?: string;
  }>();
  if (body.clockIn) {
    await upsertFriendClockIn(db, body.friendId, body.lineUserId, body.displayName || null, body.targetDate, body.clockIn, 'manual');
  }
  if (body.clockOut) {
    await upsertFriendClockOut(db, body.friendId, body.lineUserId, body.displayName || null, body.targetDate, body.clockOut, 'manual');
  }
  return c.json({ success: true });
});

// ─── 月次確認 ────────────────────────────────────────────────────────────

friendAttendance.get('/api/attendance/monthly', async (c) => {
  const db = c.env.DB;
  const month = c.req.query('month');
  if (!month) return c.json({ success: false, error: 'month required' }, 400);
  const confirmations = await getFriendMonthlyConfirmations(db, month);
  return c.json({
    success: true,
    data: confirmations.map(mc => ({
      id: mc.id,
      friendId: mc.friend_id,
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

// ─── リッチメニュー作成（出勤・退勤ボタン） ─────────────────────────────

friendAttendance.post('/api/attendance/richmenu/setup', async (c) => {
  const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);

  // リッチメニュー定義: 3分割（出勤 / 退勤 / 稼働確認）
  const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: '勤怠打刻メニュー',
    chatBarText: '勤怠打刻',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'postback' as const, data: 'action=richmenu_clock_in', label: '出勤' },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'postback' as const, data: 'action=richmenu_clock_out', label: '退勤' },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'postback' as const, data: 'action=richmenu_check_hours', label: '稼働確認' },
      },
    ],
  };

  try {
    const result = await lineClient.createRichMenu(richMenu);
    // デフォルトリッチメニューに設定
    await lineClient.setDefaultRichMenu(result.richMenuId);

    return c.json({
      success: true,
      data: {
        richMenuId: result.richMenuId,
        message: 'リッチメニューを作成しデフォルトに設定しました。画像のアップロードが必要です。',
      },
    });
  } catch (err) {
    console.error('Rich menu creation failed:', err);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// リッチメニュー画像アップロード
friendAttendance.post('/api/attendance/richmenu/:richMenuId/image', async (c) => {
  const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const richMenuId = c.req.param('richMenuId');
  const body = await c.req.arrayBuffer();
  const contentType = c.req.header('Content-Type') || 'image/png';

  try {
    await lineClient.uploadRichMenuImage(richMenuId, body, contentType);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

export { friendAttendance };
