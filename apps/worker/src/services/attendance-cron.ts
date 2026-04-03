/**
 * 勤怠打刻 Cron サービス
 * 5分間隔のcronから呼び出され、JSTの時刻に応じて以下を実行:
 *   9:00  → 出勤ボタン送信
 *  12:00  → 出勤未打刻者にリマインド
 *  20:00  → 退勤ボタン送信
 *  22:00  → 退勤未打刻者にリマインド
 *  月初   → 前月の稼働サマリー送信
 */

import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import {
  getAllEnabledAttendanceSettings,
  getShiftPattern,
  getGroupMembers,
  getUnclocked,
  insertClockReminder,
  calcMonthlySummary,
  upsertMonthlyConfirmation,
  getAttendanceSettings,
  isWorkDay,
} from '@line-crm/db';

/** JST の現在時刻を HH:MM 形式で返す */
function jstTimeNow(): { hour: number; minute: number; dateStr: string; monthStr: string; day: number } {
  const now = new Date(Date.now() + 9 * 60 * 60_000);
  return {
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
    dateStr: now.toISOString().slice(0, 10),
    monthStr: now.toISOString().slice(0, 7),
    day: now.getUTCDate(),
  };
}

/** 時刻が指定の HH:MM ウィンドウ内か（5分間隔cron用、±2分） */
function isTimeWindow(hour: number, minute: number, targetTime: string): boolean {
  const [tH, tM] = targetTime.split(':').map(Number);
  const nowMin = hour * 60 + minute;
  const targetMin = tH * 60 + tM;
  return Math.abs(nowMin - targetMin) <= 2;
}

/** 出勤ボタン Flex メッセージ */
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
          { type: 'text', text: `${dateStr}`, size: 'sm', color: '#64748b', margin: 'sm' },
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

/** 退勤ボタン Flex メッセージ */
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
          { type: 'text', text: `${dateStr}`, size: 'sm', color: '#64748b', margin: 'sm' },
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

/** 月次確認 Flex メッセージ */
function buildMonthlyConfirmMessage(
  targetMonth: string,
  totalDays: number,
  totalHours: number,
): Message {
  return {
    type: 'flex',
    altText: `${targetMonth} 稼働時間確認`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: '📊 月次稼働時間の確認', size: 'lg', weight: 'bold', color: '#1e293b' },
          { type: 'text', text: `${targetMonth}`, size: 'sm', color: '#64748b', margin: 'sm' },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'vertical', margin: 'lg', paddingAll: '16px', backgroundColor: '#f8fafc', cornerRadius: 'md',
            contents: [
              {
                type: 'box', layout: 'horizontal',
                contents: [
                  { type: 'text', text: '稼働日数', size: 'sm', color: '#64748b', flex: 1 },
                  { type: 'text', text: `${totalDays}日`, size: 'sm', weight: 'bold', color: '#1e293b', align: 'end', flex: 1 },
                ],
              },
              {
                type: 'box', layout: 'horizontal', margin: 'md',
                contents: [
                  { type: 'text', text: '合計稼働時間', size: 'sm', color: '#64748b', flex: 1 },
                  { type: 'text', text: `${totalHours}時間`, size: 'sm', weight: 'bold', color: '#1e293b', align: 'end', flex: 1 },
                ],
              },
            ],
          },
          { type: 'text', text: '内容に問題がなければ「確認OK」を押してください。修正が必要な場合は「修正依頼」を押してください。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
        ],
      },
      footer: {
        type: 'box', layout: 'horizontal', paddingAll: '12px', spacing: 'md',
        contents: [
          {
            type: 'button', flex: 1,
            action: { type: 'postback', label: '確認OK', data: `action=monthly_confirm&month=${targetMonth}`, displayText: '確認OKです' },
            style: 'primary', color: '#06C755', height: 'sm',
          },
          {
            type: 'button', flex: 1,
            action: { type: 'postback', label: '修正依頼', data: `action=monthly_revision&month=${targetMonth}`, displayText: '修正をお願いします' },
            style: 'secondary', height: 'sm',
          },
        ],
      },
    },
  };
}

/**
 * メイン: 勤怠打刻の定期処理
 */
export async function processAttendanceClock(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const { hour, minute, dateStr, monthStr, day } = jstTimeNow();
  const settings = await getAllEnabledAttendanceSettings(db);
  if (settings.length === 0) return;

  for (const setting of settings) {
    try {
      // このグループのLINE group IDを取得
      const group = await db.prepare('SELECT line_group_id FROM groups WHERE id = ? AND is_active = 1')
        .bind(setting.group_id).first<{ line_group_id: string }>();
      if (!group) continue;

      const lineGroupId = group.line_group_id;

      // グループメンバーを取得（Botを除外するためDB参照）
      const members = await getGroupMembers(db, setting.group_id);
      if (members.length === 0) continue;

      // ── 9:00 出勤ボタン ──
      if (isTimeWindow(hour, minute, setting.clock_in_time)) {
        // 勤務日のメンバーにのみ送信
        const workMembers = [];
        for (const m of members) {
          const shift = await getShiftPattern(db, setting.group_id, m.line_user_id);
          const workDays = shift?.work_days ?? '1,2,3,4,5';
          const excludeHolidays = shift?.exclude_holidays ?? 1;
          if (isWorkDay(dateStr, workDays, excludeHolidays === 1)) {
            workMembers.push(m);
          }
        }
        if (workMembers.length > 0) {
          await lineClient.pushMessage(lineGroupId, [buildClockInMessage(dateStr)]);
        }
      }

      // ── 12:00 出勤リマインド ──
      if (isTimeWindow(hour, minute, setting.clock_in_reminder_time)) {
        const unclockedMembers = await getUnclocked(db, setting.group_id, dateStr, 'clock_in');
        // 勤務日のメンバーのみ
        const workUnclockedMembers = [];
        for (const m of unclockedMembers) {
          const shift = await getShiftPattern(db, setting.group_id, m.line_user_id);
          const workDays = shift?.work_days ?? '1,2,3,4,5';
          const excludeHolidays = shift?.exclude_holidays ?? 1;
          if (isWorkDay(dateStr, workDays, excludeHolidays === 1)) {
            workUnclockedMembers.push(m);
          }
        }
        if (workUnclockedMembers.length > 0) {
          // グループにリマインドメッセージ（名前入り）
          const names = workUnclockedMembers.map(m => m.display_name || 'メンバー').join('さん、');
          await lineClient.pushMessage(lineGroupId, [{
            type: 'text',
            text: `${names}さん\n\n本日の出勤打刻がまだのようです。\n何時に出勤されましたか？（例: 9:00、9時）`,
          }]);
          // リマインド状態を記録
          for (const m of workUnclockedMembers) {
            await insertClockReminder(db, setting.group_id, m.line_user_id, 'clock_in', dateStr);
          }
        }
      }

      // ── 20:00 退勤ボタン ──
      if (isTimeWindow(hour, minute, setting.clock_out_time)) {
        // 出勤打刻済みのメンバーがいれば退勤ボタンを送信
        const unclockedOut = await getUnclocked(db, setting.group_id, dateStr, 'clock_out');
        // 出勤していて退勤していないメンバーのみ対象
        if (unclockedOut.length > 0) {
          // 出勤済みかつ退勤未打刻のメンバーのみ
          const clockedInMembers = await db.prepare(
            `SELECT line_user_id FROM clock_records WHERE group_id = ? AND target_date = ? AND clock_in IS NOT NULL AND clock_out IS NULL`
          ).bind(setting.group_id, dateStr).all<{ line_user_id: string }>();
          if (clockedInMembers.results.length > 0) {
            await lineClient.pushMessage(lineGroupId, [buildClockOutMessage(dateStr)]);
          }
        }
      }

      // ── 22:00 退勤リマインド ──
      if (isTimeWindow(hour, minute, setting.clock_out_reminder_time)) {
        // 出勤済みかつ退勤未打刻
        const clockedInNoOut = await db.prepare(
          `SELECT cr.line_user_id, gm.display_name
           FROM clock_records cr
           LEFT JOIN group_members gm ON gm.group_id = cr.group_id AND gm.line_user_id = cr.line_user_id
           WHERE cr.group_id = ? AND cr.target_date = ? AND cr.clock_in IS NOT NULL AND cr.clock_out IS NULL`
        ).bind(setting.group_id, dateStr).all<{ line_user_id: string; display_name: string | null }>();

        if (clockedInNoOut.results.length > 0) {
          const names = clockedInNoOut.results.map(m => m.display_name || 'メンバー').join('さん、');
          await lineClient.pushMessage(lineGroupId, [{
            type: 'text',
            text: `${names}さん\n\n本日の退勤打刻がまだのようです。\n何時に退勤されましたか？（例: 18:00、18時）`,
          }]);
          for (const m of clockedInNoOut.results) {
            await insertClockReminder(db, setting.group_id, m.line_user_id, 'clock_out', dateStr);
          }
        }
      }

      // ── 月初: 前月の稼働サマリー送信 ──
      if (day === setting.monthly_confirm_day && isTimeWindow(hour, minute, '10:00')) {
        // 前月を計算
        const now = new Date(Date.now() + 9 * 60 * 60_000);
        const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const prevMonthStr = `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}`;

        for (const member of members) {
          const summary = await calcMonthlySummary(db, setting.group_id, member.line_user_id, prevMonthStr);
          if (summary.totalDays > 0) {
            await upsertMonthlyConfirmation(
              db, setting.group_id, member.line_user_id, member.display_name,
              prevMonthStr, summary.totalDays, summary.totalHours
            );
          }
        }

        // グループに月次確認メッセージ送信（個人ごとではなくグループに1通）
        // ※各メンバーの個別サマリーはpostbackで返す
        const anyMember = members[0];
        if (anyMember) {
          const sampleSummary = await calcMonthlySummary(db, setting.group_id, anyMember.line_user_id, prevMonthStr);
          // 全メンバーにそれぞれ個別メッセージを送る方が良いが、
          // グループの場合は1通送って各自のボタンで確認
          await lineClient.pushMessage(lineGroupId, [{
            type: 'text',
            text: `📊 ${prevMonthStr} の稼働時間確認\n\n先月の稼働時間を確認してください。\n下のボタンから確認できます。`,
          }, buildMonthlyConfirmMessage(prevMonthStr, sampleSummary.totalDays, sampleSummary.totalHours)]);
        }
      }

    } catch (err) {
      console.error(`Attendance cron error for group ${setting.group_id}:`, err);
    }
  }
}
