/**
 * 1:1稼働管理 APIルート + リッチメニュー作成
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
  updateFriendClockRecord,
  deleteFriendClockRecord,
  getFriendMonthlyConfirmations,
  getAttendanceTargets,
  getFriendAbsencesInRange,
  upsertFriendAbsence,
  deleteFriendAbsence,
} from '@line-crm/db';
import type { Env } from '../index.js';

const friendAttendance = new Hono<Env>();

// ─── グローバル稼働設定 ──────────────────────────────────────────────────

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
      csNotificationGroupId: config.cs_notification_group_id,
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
    csNotificationGroupId?: string | null;
  }>();
  await upsertAttendanceConfig(db, body.lineAccountId ?? null, {
    is_enabled: body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : undefined,
    clock_in_time: body.clockInTime,
    clock_in_reminder_time: body.clockInReminderTime,
    clock_out_time: body.clockOutTime,
    clock_out_reminder_time: body.clockOutReminderTime,
    monthly_confirm_day: body.monthlyConfirmDay,
    cs_notification_group_id: body.csNotificationGroupId,
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

// ─── 稼働対象者一覧 ─────────────────────────────────────────────────────

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

// ─── 稼働記録 ────────────────────────────────────────────────────────────

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

// 手動記録（新規追加）
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

// 既存記録の編集（時刻更新）
friendAttendance.put('/api/attendance/records/:friendId/:targetDate', async (c) => {
  const db = c.env.DB;
  const friendId = c.req.param('friendId');
  const targetDate = c.req.param('targetDate');
  const body = await c.req.json<{ clockIn?: string | null; clockOut?: string | null }>();
  await updateFriendClockRecord(db, friendId, targetDate, body);
  return c.json({ success: true });
});

// 記録削除
friendAttendance.delete('/api/attendance/records/:friendId/:targetDate', async (c) => {
  const db = c.env.DB;
  const friendId = c.req.param('friendId');
  const targetDate = c.req.param('targetDate');
  await deleteFriendClockRecord(db, friendId, targetDate);
  return c.json({ success: true });
});

// ─── 休み報告 ────────────────────────────────────────────────────────────

friendAttendance.get('/api/attendance/absences', async (c) => {
  const db = c.env.DB;
  const friendId = c.req.query('friendId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  if (!friendId || !startDate || !endDate) {
    return c.json({ success: false, error: 'friendId, startDate, endDate required' }, 400);
  }
  const list = await getFriendAbsencesInRange(db, friendId, startDate, endDate);
  return c.json({
    success: true,
    data: list.map(a => ({ id: a.id, friendId: a.friend_id, targetDate: a.target_date, reason: a.reason, source: a.source, createdAt: a.created_at })),
  });
});

friendAttendance.post('/api/attendance/absences', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ friendId: string; targetDate: string; reason?: string | null }>();
  if (!body.friendId || !body.targetDate) return c.json({ success: false, error: 'friendId, targetDate required' }, 400);
  await upsertFriendAbsence(db, body.friendId, body.targetDate, { reason: body.reason, source: 'manual' });
  return c.json({ success: true });
});

friendAttendance.delete('/api/attendance/absences/:friendId/:targetDate', async (c) => {
  const db = c.env.DB;
  await deleteFriendAbsence(c.env.DB, c.req.param('friendId'), c.req.param('targetDate'));
  return c.json({ success: true });
});

// ─── 月次CSVエクスポート ─────────────────────────────────────────────────

friendAttendance.get('/api/attendance/export', async (c) => {
  const db = c.env.DB;
  const month = c.req.query('month');
  if (!month) return c.json({ success: false, error: 'month required' }, 400);

  const startDate = month + '-01';
  const endDate = month + '-31';
  const records = await getFriendClockRecords(db, { startDate, endDate });

  // CSV生成（UTF-8 BOM付きでExcel互換）
  const header = '友だちID,LINE User ID,名前,日付,開始,終了,稼働時間,開始記録方法,終了記録方法\n';
  const rows = records.map(r => [
    r.friend_id,
    r.line_user_id,
    r.display_name || '',
    r.target_date,
    r.clock_in || '',
    r.clock_out || '',
    r.work_hours != null ? String(r.work_hours) : '',
    r.clock_in_source || '',
    r.clock_out_source || '',
  ].map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n');

  const csv = '﻿' + header + rows;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="attendance_${month}.csv"`,
    },
  });
});

// ─── 月次確認 ────────────────────────────────────────────────────────────

friendAttendance.get('/api/attendance/monthly', async (c) => {
  const db = c.env.DB;
  const month = c.req.query('month');
  if (!month) return c.json({ success: false, error: 'month required' }, 400);

  // 月内の全打刻記録を取得して友だち別に集計
  const records = await getFriendClockRecords(db, { startDate: month + '-01', endDate: month + '-31' });
  const aggregateByFriend = new Map<string, { friendId: string; displayName: string | null; totalDays: number; totalHours: number }>();
  for (const r of records) {
    if (!r.clock_in) continue;
    const agg = aggregateByFriend.get(r.friend_id) ?? { friendId: r.friend_id, displayName: r.display_name, totalDays: 0, totalHours: 0 };
    agg.totalDays += 1;
    if (r.work_hours) agg.totalHours += r.work_hours;
    aggregateByFriend.set(r.friend_id, agg);
  }

  // 月次確認状況（既に送信済み or 確認/修正依頼）
  const confirmations = await getFriendMonthlyConfirmations(db, month);
  const confirmByFriend = new Map(confirmations.map(c => [c.friend_id, c]));

  // 友だち一覧（集計と確認状況の両方をマージ）
  const friendIds = new Set([...aggregateByFriend.keys(), ...confirmByFriend.keys()]);
  const result = Array.from(friendIds).map(fid => {
    const agg = aggregateByFriend.get(fid);
    const mc = confirmByFriend.get(fid);
    return {
      id: mc?.id ?? fid,
      friendId: fid,
      displayName: agg?.displayName ?? mc?.display_name ?? null,
      targetMonth: month,
      totalDays: agg?.totalDays ?? mc?.total_days ?? 0,
      totalHours: agg ? Math.round(agg.totalHours * 100) / 100 : (mc?.total_hours ?? 0),
      status: mc?.status ?? 'pending',
      sentAt: mc?.sent_at ?? null,
      confirmedAt: mc?.confirmed_at ?? null,
      revisionNote: mc?.revision_note ?? null,
    };
  }).sort((a, b) => (b.totalHours ?? 0) - (a.totalHours ?? 0));

  return c.json({ success: true, data: result });
});

// ─── リッチメニュー作成（稼働開始・終了ボタン） ─────────────────────────────

friendAttendance.post('/api/attendance/richmenu/setup', async (c) => {
  const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);

  // リッチメニュー定義: 3分割（稼働開始 / 稼働確認 / 稼働終了）
  const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: '稼働記録メニュー',
    chatBarText: '稼働記録',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'postback' as const, data: 'action=richmenu_clock_in', label: '稼働開始' },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'postback' as const, data: 'action=richmenu_check_hours', label: '稼働確認' },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'postback' as const, data: 'action=richmenu_clock_out', label: '稼働終了' },
      },
    ],
  };

  try {
    const result = await lineClient.createRichMenu(richMenu);
    // デフォルト設定は画像アップロード後に行う（画像なしではLINE APIが拒否する）
    return c.json({
      success: true,
      data: {
        richMenuId: result.richMenuId,
        message: 'リッチメニューを作成しました。続けて画像をアップロードしてください（アップロード成功時に自動でデフォルトに設定されます）。',
      },
    });
  } catch (err) {
    console.error('Rich menu creation failed:', err);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// リッチメニュー画像アップロード（アップロード成功時に自動でデフォルト設定）
friendAttendance.post('/api/attendance/richmenu/:richMenuId/image', async (c) => {
  const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const richMenuId = c.req.param('richMenuId');
  const body = await c.req.arrayBuffer();
  const contentType = c.req.header('Content-Type') || 'image/png';

  try {
    await lineClient.uploadRichMenuImage(richMenuId, body, contentType);
    // アップロード完了後にデフォルトリッチメニューに設定
    await lineClient.setDefaultRichMenu(richMenuId);
    return c.json({ success: true, data: { defaultSet: true } });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

export { friendAttendance };
