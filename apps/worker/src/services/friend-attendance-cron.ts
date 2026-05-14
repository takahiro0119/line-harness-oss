/**
 * 勤怠打刻 Cron v2: 1:1チャットベース
 * 友だち一人ずつにpushMessageで出勤/退勤ボタンを送信
 */

import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import {
  getAllAttendanceConfigs,
  getAttendanceTargets,
  getFriendClockRecord,
  getUnclockedFriends,
  insertFriendClockReminder,
  calcFriendMonthlySummary,
  upsertFriendMonthlyConfirmation,
  isWorkDay,
} from '@line-crm/db';
import type { AttendanceConfigRow, AttendanceTarget } from '@line-crm/db';

function jstTimeNow() {
  const now = new Date(Date.now() + 9 * 60 * 60_000);
  return {
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
    dateStr: now.toISOString().slice(0, 10),
    monthStr: now.toISOString().slice(0, 7),
    day: now.getUTCDate(),
  };
}

function isTimeWindow(hour: number, minute: number, targetTime: string): boolean {
  const [tH, tM] = targetTime.split(':').map(Number);
  const nowMin = hour * 60 + minute;
  const targetMin = tH * 60 + tM;
  return Math.abs(nowMin - targetMin) <= 2;
}

/** 個人の有効な時刻を取得（個人設定 > グローバル設定） */
function getEffectiveTime(target: AttendanceTarget, config: AttendanceConfigRow, field: 'clock_in_time' | 'clock_in_reminder_time' | 'clock_out_time' | 'clock_out_reminder_time'): string {
  const personalField = field as keyof AttendanceTarget;
  return (target[personalField] as string | null) ?? config[field];
}

function buildClockInMessage(dateStr: string): Message {
  return {
    type: 'flex',
    altText: '出勤打刻',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: '☀️ おはようございます', size: 'lg', weight: 'bold', color: '#1e293b' },
          { type: 'text', text: dateStr, size: 'sm', color: '#64748b', margin: 'sm' },
          { type: 'text', text: '出勤される方は下のボタンを押してください', size: 'sm', color: '#475569', wrap: true, margin: 'lg' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [
          {
            type: 'button',
            action: { type: 'postback', label: '出勤', data: `action=clock_in&date=${dateStr}`, displayText: '出勤します' },
            style: 'primary', color: '#06C755', height: 'md',
          },
        ],
      },
    },
  };
}

function buildClockOutMessage(dateStr: string): Message {
  return {
    type: 'flex',
    altText: '退勤打刻',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: '🌙 お疲れ様でした', size: 'lg', weight: 'bold', color: '#1e293b' },
          { type: 'text', text: dateStr, size: 'sm', color: '#64748b', margin: 'sm' },
          { type: 'text', text: '退勤される方は下のボタンを押してください', size: 'sm', color: '#475569', wrap: true, margin: 'lg' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [
          {
            type: 'button',
            action: { type: 'postback', label: '退勤', data: `action=clock_out&date=${dateStr}`, displayText: '退勤します' },
            style: 'primary', color: '#334155', height: 'md',
          },
        ],
      },
    },
  };
}

function buildMonthlyConfirmMessage(targetMonth: string, totalDays: number, totalHours: number): Message {
  return {
    type: 'flex',
    altText: `${targetMonth} 稼働時間確認`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: '📊 月次稼働時間の確認', size: 'lg', weight: 'bold', color: '#1e293b' },
          { type: 'text', text: targetMonth, size: 'sm', color: '#64748b', margin: 'sm' },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'vertical', margin: 'lg', paddingAll: '16px', backgroundColor: '#f8fafc', cornerRadius: 'md',
            contents: [
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '稼働日数', size: 'sm', color: '#64748b', flex: 1 },
                { type: 'text', text: `${totalDays}日`, size: 'sm', weight: 'bold', color: '#1e293b', align: 'end', flex: 1 },
              ]},
              { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                { type: 'text', text: '合計稼働時間', size: 'sm', color: '#64748b', flex: 1 },
                { type: 'text', text: `${totalHours}時間`, size: 'sm', weight: 'bold', color: '#1e293b', align: 'end', flex: 1 },
              ]},
            ],
          },
          { type: 'text', text: '内容に問題がなければ「確認OK」を押してください。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
        ],
      },
      footer: {
        type: 'box', layout: 'horizontal', paddingAll: '12px', spacing: 'md',
        contents: [
          { type: 'button', flex: 1, action: { type: 'postback', label: '確認OK', data: `action=monthly_confirm&month=${targetMonth}`, displayText: '確認OKです' }, style: 'primary', color: '#06C755', height: 'sm' },
          { type: 'button', flex: 1, action: { type: 'postback', label: '修正依頼', data: `action=monthly_revision&month=${targetMonth}`, displayText: '修正をお願いします' }, style: 'secondary', height: 'sm' },
        ],
      },
    },
  };
}

/**
 * メイン: 1:1チャット勤怠の定期処理
 */
export async function processFriendAttendanceClock(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const { hour, minute, dateStr, monthStr, day } = jstTimeNow();
  const configs = await getAllAttendanceConfigs(db);
  if (configs.length === 0) return;

  for (const config of configs) {
    try {
      const targets = await getAttendanceTargets(db, config.line_account_id);
      if (targets.length === 0) continue;

      for (const target of targets) {
        // 勤務日チェック
        if (!isWorkDay(dateStr, target.work_days, target.exclude_holidays === 1)) continue;

        const clockInTime = getEffectiveTime(target, config, 'clock_in_time');
        const clockInReminderTime = getEffectiveTime(target, config, 'clock_in_reminder_time');
        const clockOutTime = getEffectiveTime(target, config, 'clock_out_time');
        const clockOutReminderTime = getEffectiveTime(target, config, 'clock_out_reminder_time');

        try {
          // ── 出勤ボタン ──
          if (isTimeWindow(hour, minute, clockInTime)) {
            await lineClient.pushMessage(target.line_user_id, [buildClockInMessage(dateStr)]);
          }

          // ── 出勤リマインド ──
          if (isTimeWindow(hour, minute, clockInReminderTime)) {
            const record = await getFriendClockRecord(db, target.friend_id, dateStr);
            if (!record?.clock_in) {
              await lineClient.pushMessage(target.line_user_id, [{
                type: 'text',
                text: `本日の出勤打刻がまだのようです。\n何時に出勤されましたか？（例: 9:00、9時）`,
              }]);
              await insertFriendClockReminder(db, target.friend_id, 'clock_in', dateStr);
            }
          }

          // ── 退勤ボタン ──
          if (isTimeWindow(hour, minute, clockOutTime)) {
            const record = await getFriendClockRecord(db, target.friend_id, dateStr);
            if (record?.clock_in && !record?.clock_out) {
              await lineClient.pushMessage(target.line_user_id, [buildClockOutMessage(dateStr)]);
            }
          }

          // ── 退勤リマインド ──
          if (isTimeWindow(hour, minute, clockOutReminderTime)) {
            const record = await getFriendClockRecord(db, target.friend_id, dateStr);
            if (record?.clock_in && !record?.clock_out) {
              await lineClient.pushMessage(target.line_user_id, [{
                type: 'text',
                text: `本日の退勤打刻がまだのようです。\n何時に退勤されましたか？（例: 18:00、18時）`,
              }]);
              await insertFriendClockReminder(db, target.friend_id, 'clock_out', dateStr);
            }
          }
        } catch (err) {
          // 個人へのpush失敗（ブロック等）は無視して次へ
          console.error(`Attendance push failed for ${target.line_user_id}:`, err);
        }
      }

      // ── 月初: 前月サマリー送信 ──
      if (day === config.monthly_confirm_day && isTimeWindow(hour, minute, '10:00')) {
        const now = new Date(Date.now() + 9 * 60 * 60_000);
        const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const prevMonthStr = `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}`;

        for (const target of targets) {
          try {
            const summary = await calcFriendMonthlySummary(db, target.friend_id, prevMonthStr);
            if (summary.totalDays > 0) {
              await upsertFriendMonthlyConfirmation(db, target.friend_id, target.display_name, prevMonthStr, summary.totalDays, summary.totalHours);
              await lineClient.pushMessage(target.line_user_id, [buildMonthlyConfirmMessage(prevMonthStr, summary.totalDays, summary.totalHours)]);
            }
          } catch (err) {
            console.error(`Monthly confirm failed for ${target.line_user_id}:`, err);
          }
        }
      }

    } catch (err) {
      console.error('Friend attendance cron error:', err);
    }
  }
}
