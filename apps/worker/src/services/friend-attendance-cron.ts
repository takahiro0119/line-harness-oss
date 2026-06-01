/**
 * 稼働記録 Cron v2: 1:1チャットベース
 * 友だち一人ずつにpushMessageで稼働開始/終了ボタンを送信
 */

import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import {
  getAllAttendanceConfigs,
  getAttendanceTargets,
  getFriendClockRecord,
  getFriendClockRecords,
  getUnclockedFriends,
  insertFriendClockReminder,
  calcFriendMonthlySummary,
  upsertFriendMonthlyConfirmation,
  isWorkDay,
  getFriendAbsence,
  getLastAbsenceAlert,
  insertAbsenceAlert,
  getKintoneLinkedFriends,
  updateFriendKintoneStatus,
  upsertFriendAssignment,
  upsertKintoneCompany,
  deleteKintoneCompaniesNotIn,
} from '@line-crm/db';
import type { AttendanceConfigRow, AttendanceTarget, FriendClockRecordRow } from '@line-crm/db';
import { fetchKintoneWorkerStatuses, fetchKintoneAssignments, fetchAllKintoneCompanies } from './kintone.js';

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
    altText: '稼働開始記録',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: '☀️ おはようございます', size: 'lg', weight: 'bold', color: '#1e293b' },
          { type: 'text', text: dateStr, size: 'sm', color: '#64748b', margin: 'sm' },
          { type: 'text', text: '本日の稼働を開始される方は下のボタンを押してください', size: 'sm', color: '#475569', wrap: true, margin: 'lg' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [
          {
            type: 'button',
            action: { type: 'postback', label: '稼働開始', data: `action=clock_in&date=${dateStr}`, displayText: '稼働を開始します' },
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
    altText: '稼働終了記録',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: '🌙 お疲れ様でした', size: 'lg', weight: 'bold', color: '#1e293b' },
          { type: 'text', text: dateStr, size: 'sm', color: '#64748b', margin: 'sm' },
          { type: 'text', text: '本日の稼働を終了される方は下のボタンを押してください', size: 'sm', color: '#475569', wrap: true, margin: 'lg' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [
          {
            type: 'button',
            action: { type: 'postback', label: '稼働終了', data: `action=clock_out&date=${dateStr}`, displayText: '稼働を終了します' },
            style: 'primary', color: '#334155', height: 'md',
          },
        ],
      },
    },
  };
}

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function dowJa(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return DOW[d.getUTCDay()];
}

function buildMonthlyConfirmMessage(targetMonth: string, totalDays: number, totalHours: number, records: FriendClockRecordRow[] = []): Message {
  const monthLabel = targetMonth.split('-')[1]?.replace(/^0/, '') + '月';

  // 古い順
  const sorted = [...records].sort((a, b) => a.target_date.localeCompare(b.target_date));

  const recordRows = sorted.map((r) => ({
    type: 'box' as const, layout: 'horizontal' as const, paddingTop: '6px', paddingBottom: '6px',
    contents: [
      { type: 'text', text: `${r.target_date.slice(5).replace('-', '/')} (${dowJa(r.target_date)})`, size: 'xs', color: '#1e293b', flex: 3 },
      { type: 'text', text: r.clock_in || '--:--', size: 'xs', color: '#475569', flex: 2, align: 'center' },
      { type: 'text', text: r.clock_out || '--:--', size: 'xs', color: '#475569', flex: 2, align: 'center' },
      { type: 'text', text: r.work_hours != null ? `${r.work_hours}h` : '-', size: 'xs', weight: 'bold', color: '#1e293b', flex: 2, align: 'end' },
    ],
  }));

  return {
    type: 'flex',
    altText: `${monthLabel}の稼働時間のご確認`,
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: `${monthLabel}の稼働状況のご確認`, size: 'lg', weight: 'bold', color: '#1e293b', wrap: true },
          { type: 'text', text: targetMonth, size: 'xs', color: '#94a3b8', margin: 'xs' },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: 'お疲れさまでした！\n先月の稼働時間をご確認ください。', size: 'sm', color: '#475569', wrap: true, margin: 'lg' },
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
          ...(recordRows.length > 0 ? [
            { type: 'text' as const, text: '稼働日の内訳', size: 'sm' as const, weight: 'bold' as const, color: '#475569', margin: 'lg' as const },
            {
              type: 'box' as const, layout: 'horizontal' as const, margin: 'sm' as const, paddingBottom: '4px',
              contents: [
                { type: 'text' as const, text: '日付', size: 'xxs' as const, color: '#94a3b8', flex: 3 },
                { type: 'text' as const, text: '開始', size: 'xxs' as const, color: '#94a3b8', flex: 2, align: 'center' as const },
                { type: 'text' as const, text: '終了', size: 'xxs' as const, color: '#94a3b8', flex: 2, align: 'center' as const },
                { type: 'text' as const, text: '時間', size: 'xxs' as const, color: '#94a3b8', flex: 2, align: 'end' as const },
              ],
            },
            { type: 'separator' as const, margin: 'xs' as const },
            ...recordRows,
          ] : []),
          { type: 'text', text: 'こちらの稼働時間でお間違いないでしょうか？\n間違いがあれば「修正依頼」を押してください。担当者よりご連絡いたします。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm',
        contents: [
          { type: 'button', action: { type: 'postback', label: '間違いありません', data: `action=monthly_confirm&month=${targetMonth}`, displayText: '間違いありません' }, style: 'primary', color: '#06C755', height: 'md' },
          { type: 'button', action: { type: 'postback', label: '修正依頼', data: `action=monthly_revision&month=${targetMonth}`, displayText: '修正をお願いします' }, style: 'secondary', height: 'md' },
        ],
      },
    },
  };
}

/**
 * 長期不在検知: 過去14日間で連続5稼働日以上打刻がない対象者をCSに通知
 */
async function checkLongAbsence(
  db: D1Database,
  lineClient: LineClient,
  targets: AttendanceTarget[],
  config: AttendanceConfigRow,
  todayStr: string,
): Promise<void> {
  if (!config.cs_notification_group_id) return;

  const today = new Date(todayStr + 'T00:00:00+09:00');
  const fourteenDaysAgo = new Date(today.getTime() - 14 * 86400_000);
  const startDate = fourteenDaysAgo.toISOString().slice(0, 10);

  for (const target of targets) {
    try {
      // 過去14日間の稼働日リスト
      const workDays: string[] = [];
      for (let i = 14; i > 0; i--) {
        const d = new Date(today.getTime() - i * 86400_000);
        const ds = d.toISOString().slice(0, 10);
        if (isWorkDay(ds, target.work_days, target.exclude_holidays === 1)) {
          // 休み報告も除外
          const absence = await getFriendAbsence(db, target.friend_id, ds);
          if (!absence) workDays.push(ds);
        }
      }

      if (workDays.length < 5) continue; // 過去14日に稼働日5日未満ならスキップ

      // 過去14日の打刻記録
      const records = await getFriendClockRecords(db, {
        friendId: target.friend_id, startDate, endDate: todayStr,
      });
      const clockedDates = new Set(records.filter(r => r.clock_in).map(r => r.target_date));

      // 連続未打刻の稼働日数
      let missedCount = 0;
      for (const wd of workDays.slice().reverse()) {
        if (clockedDates.has(wd)) break;
        missedCount++;
      }
      if (missedCount < 5) continue;

      // 重複通知チェック（過去7日以内に通知済みならスキップ）
      const lastAlert = await getLastAbsenceAlert(db, target.friend_id, 'long_absence');
      if (lastAlert) {
        const last = new Date(lastAlert.alerted_at + 'Z');
        if (today.getTime() - last.getTime() < 7 * 86400_000) continue;
      }

      // CS通知
      await lineClient.pushMessage(config.cs_notification_group_id, [{
        type: 'flex',
        altText: `${target.display_name || '稼働者'}さんが${missedCount}稼働日連続で未打刻`,
        contents: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', paddingAll: '20px',
            contents: [
              { type: 'text', text: '🚨 長期未打刻のアラート', size: 'lg', weight: 'bold', color: '#dc2626' },
              { type: 'separator', margin: 'lg' },
              {
                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
                contents: [
                  { type: 'box', layout: 'horizontal', contents: [
                    { type: 'text', text: '稼働者', size: 'sm', color: '#64748b', flex: 2 },
                    { type: 'text', text: target.display_name || '(不明)', size: 'sm', weight: 'bold', color: '#1e293b', flex: 3, wrap: true },
                  ]},
                  { type: 'box', layout: 'horizontal', contents: [
                    { type: 'text', text: '連続未打刻', size: 'sm', color: '#64748b', flex: 2 },
                    { type: 'text', text: `${missedCount}稼働日`, size: 'sm', weight: 'bold', color: '#dc2626', flex: 3 },
                  ]},
                ],
              },
              { type: 'text', text: '稼働者にご連絡し、状況を確認してください。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
            ],
          },
        },
      }]);

      await insertAbsenceAlert(db, target.friend_id, 'long_absence', `missed=${missedCount}`);
    } catch (err) {
      console.error(`Long absence check failed for ${target.line_user_id}:`, err);
    }
  }
}

/**
 * 朝の Kintone 同期 (8:40 + 8:45)
 * - 8:40: BPO企業マスタ全件取得 → kintone_companies 洗い替え
 * - 8:40: 紐付け済み友だちの参画情報 (状況/案件名/請求先企業/代理店/紹介者/参画決定日) を friend_shifts に同期
 */
export async function syncKintoneAssignmentsManual(db: D1Database, kintoneApiToken: string): Promise<void> {
  return syncKintoneAssignments(db, kintoneApiToken);
}

export async function syncKintoneCompaniesManual(db: D1Database, bpoApiToken: string): Promise<void> {
  return syncKintoneCompanies(db, bpoApiToken);
}

async function syncKintoneAssignments(db: D1Database, kintoneApiToken: string): Promise<void> {
  const linked = await getKintoneLinkedFriends(db);
  if (linked.length === 0) return;

  const recordIds = [...new Set(linked.map(f => f.kintone_id))];
  const assignments = await fetchKintoneAssignments(kintoneApiToken, recordIds);

  for (const f of linked) {
    const a = assignments.get(f.kintone_id);
    if (!a) continue;
    try {
      if (a.status) await updateFriendKintoneStatus(db, f.friend_id, a.status);
      await upsertFriendAssignment(db, f.friend_id, {
        current_case_name: a.caseName || null,
        current_billing_company: a.billingCompany || null,
        agency_name: a.agencyName || null,
        referrer: a.referrer || null,
        assignment_start_date: a.startDate || null,
      });
    } catch (err) {
      console.error(`Kintone assignment sync failed for friend ${f.friend_id}:`, err);
    }
  }
}

async function syncKintoneCompanies(db: D1Database, bpoApiToken: string): Promise<void> {
  const companies = await fetchAllKintoneCompanies(bpoApiToken);
  if (companies.length === 0) return;

  for (const c of companies) {
    try {
      await upsertKintoneCompany(db, {
        kintone_id: c.recordId,
        company_name: c.companyName || null,
        case_name_1: c.caseName1 || null,
        case_name_2: c.caseName2 || null,
        case_name_3: c.caseName3 || null,
        case_summary_1: c.caseSummary1 || null,
        case_summary_2: c.caseSummary2 || null,
        case_summary_3: c.caseSummary3 || null,
        contact_person: c.contactPerson || null,
        contact_email: c.contactEmail || null,
        contact_phone: c.contactPhone || null,
        cs_person: c.csPerson || null,
        sales_person: c.salesPerson || null,
        work_location: c.workLocation || null,
        work_hours: c.workHours || null,
        work_environment: c.workEnvironment || null,
        total_worker_count: c.totalWorkerCount || null,
      });
    } catch (err) {
      console.error(`Kintone company upsert failed for ${c.recordId}:`, err);
    }
  }
  // 削除分の掃除
  await deleteKintoneCompaniesNotIn(db, companies.map(c => c.recordId));
}

/**
 * 朝の Kintone 状況同期 (旧)
 * 後方互換のため残す
 */
async function syncKintoneStatuses(db: D1Database, kintoneApiToken: string): Promise<void> {
  const linked = await getKintoneLinkedFriends(db);
  if (linked.length === 0) return;

  const recordIds = [...new Set(linked.map(f => f.kintone_id))];
  const statusMap = await fetchKintoneWorkerStatuses(kintoneApiToken, recordIds);

  for (const f of linked) {
    const status = statusMap.get(f.kintone_id);
    if (status === undefined) continue;
    try {
      await updateFriendKintoneStatus(db, f.friend_id, status);
    } catch (err) {
      console.error(`Kintone status update failed for friend ${f.friend_id}:`, err);
    }
  }
}

/**
 * 未打刻者一覧を CS 通知グループに送信
 */
async function notifyUnclockedFriends(
  db: D1Database,
  lineClient: LineClient,
  config: AttendanceConfigRow,
  dateStr: string,
): Promise<void> {
  if (!config.cs_notification_group_id) return;

  const unclocked = await getUnclockedFriends(db, dateStr, 'clock_in', config.line_account_id);
  if (unclocked.length === 0) {
    await lineClient.pushMessage(config.cs_notification_group_id, [{
      type: 'text',
      text: `✅ ${dateStr} 全員が稼働開始打刻済みです。`,
    }]);
    return;
  }

  const nameLines = unclocked
    .map((f, i) => `${i + 1}. ${f.display_name || '(名前未設定)'}`)
    .join('\n');

  await lineClient.pushMessage(config.cs_notification_group_id, [{
    type: 'flex',
    altText: `${dateStr} 未打刻 ${unclocked.length}名`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: '⏰ 本日の未打刻者', size: 'lg', weight: 'bold', color: '#dc2626' },
          { type: 'text', text: dateStr, size: 'xs', color: '#94a3b8', margin: 'xs' },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'horizontal', margin: 'lg',
            contents: [
              { type: 'text', text: '未打刻人数', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: `${unclocked.length}名`, size: 'sm', weight: 'bold', color: '#dc2626', flex: 3 },
            ],
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: nameLines, size: 'sm', color: '#1e293b', wrap: true, margin: 'lg' },
          { type: 'text', text: '※ 参画中・本日が稼働日・休み報告なしの方のうち、稼働開始打刻がない方を表示しています。', size: 'xxs', color: '#94a3b8', wrap: true, margin: 'lg' },
        ],
      },
    },
  }]);
}

/**
 * メイン: 1:1チャット稼働記録の定期処理
 */
export async function processFriendAttendanceClock(
  db: D1Database,
  lineClient: LineClient,
  kintoneApiToken?: string,
  kintoneBpoApiToken?: string,
): Promise<void> {
  const { hour, minute, dateStr, monthStr, day } = jstTimeNow();
  const configs = await getAllAttendanceConfigs(db);
  if (configs.length === 0) return;

  // 朝の Kintone 同期（8:40）— 全アカウント共通で1日1回
  // - BPO企業マスタ全件洗い替え
  // - 紐付け済み稼働者の参画情報 (状況/案件/企業/代理店/紹介者/開始日) を同期
  if (isTimeWindow(hour, minute, '08:40')) {
    if (kintoneBpoApiToken) {
      try {
        await syncKintoneCompanies(db, kintoneBpoApiToken);
      } catch (err) {
        console.error('Kintone companies sync failed:', err);
      }
    }
    if (kintoneApiToken) {
      try {
        await syncKintoneAssignments(db, kintoneApiToken);
      } catch (err) {
        console.error('Kintone assignments sync failed:', err);
      }
    }
  }

  for (const config of configs) {
    try {
      const targets = await getAttendanceTargets(db, config.line_account_id);
      if (targets.length === 0) continue;

      for (const target of targets) {
        // 稼働日チェック
        if (!isWorkDay(dateStr, target.work_days, target.exclude_holidays === 1)) continue;

        // 休み報告チェック
        const absence = await getFriendAbsence(db, target.friend_id, dateStr);
        if (absence) continue;

        const clockInTime = getEffectiveTime(target, config, 'clock_in_time');
        const clockInReminderTime = getEffectiveTime(target, config, 'clock_in_reminder_time');
        const clockOutTime = getEffectiveTime(target, config, 'clock_out_time');
        const clockOutReminderTime = getEffectiveTime(target, config, 'clock_out_reminder_time');

        try {
          // ── 稼働開始ボタン ──
          if (isTimeWindow(hour, minute, clockInTime)) {
            await lineClient.pushMessage(target.line_user_id, [buildClockInMessage(dateStr)]);
          }

          // ── 稼働開始リマインド ──
          if (isTimeWindow(hour, minute, clockInReminderTime)) {
            const record = await getFriendClockRecord(db, target.friend_id, dateStr);
            if (!record?.clock_in) {
              await lineClient.pushMessage(target.line_user_id, [{
                type: 'text',
                text: `本日の稼働開始がまだ記録されていません。\n何時から稼働開始されましたか？（例: 9:00、9時）`,
              }]);
              await insertFriendClockReminder(db, target.friend_id, 'clock_in', dateStr);
            }
          }

          // ── 稼働終了ボタン ──
          if (isTimeWindow(hour, minute, clockOutTime)) {
            const record = await getFriendClockRecord(db, target.friend_id, dateStr);
            if (record?.clock_in && !record?.clock_out) {
              await lineClient.pushMessage(target.line_user_id, [buildClockOutMessage(dateStr)]);
            }
          }

          // ── 稼働終了リマインド ──
          if (isTimeWindow(hour, minute, clockOutReminderTime)) {
            const record = await getFriendClockRecord(db, target.friend_id, dateStr);
            if (record?.clock_in && !record?.clock_out) {
              await lineClient.pushMessage(target.line_user_id, [{
                type: 'text',
                text: `本日の稼働終了がまだ記録されていません。\n何時に稼働終了されましたか？（例: 18:00、18時）`,
              }]);
              await insertFriendClockReminder(db, target.friend_id, 'clock_out', dateStr);
            }
          }
        } catch (err) {
          // 個人へのpush失敗（ブロック等）は無視して次へ
          console.error(`Attendance push failed for ${target.line_user_id}:`, err);
        }
      }

      // ── 未打刻者一覧 (11:00 に CS グループへ) ──
      if (isTimeWindow(hour, minute, '11:00') && config.cs_notification_group_id) {
        try {
          await notifyUnclockedFriends(db, lineClient, config, dateStr);
        } catch (err) {
          console.error('Unclocked notify failed:', err);
        }
      }

      // ── 長期不在検知 (10:00に1日1回チェック) ──
      if (isTimeWindow(hour, minute, '10:00') && config.cs_notification_group_id) {
        await checkLongAbsence(db, lineClient, targets, config, dateStr);
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
              const records = await getFriendClockRecords(db, {
                friendId: target.friend_id,
                startDate: prevMonthStr + '-01',
                endDate: prevMonthStr + '-31',
              });
              await lineClient.pushMessage(target.line_user_id, [buildMonthlyConfirmMessage(prevMonthStr, summary.totalDays, summary.totalHours, records)]);
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
