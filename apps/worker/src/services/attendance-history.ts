/**
 * 稼働履歴クエリ ハンドラ
 * 友だちが「稼働履歴」「打刻履歴」等を尋ねた時に、その月の稼働記録を集計して返信
 */

import { LineClient } from '@line-crm/line-sdk';
import { getFriendClockRecords } from '@line-crm/db';

const QUERY_PATTERN = /(打刻|勤怠|稼働|勤務)(履歴|時間|記録|状況|状態)|(自分|私).{0,3}(打刻|勤怠|稼働)/;
const LAST_MONTH_PATTERN = /(先月|前月)/;
const SPECIFIC_MONTH_PATTERN = /(\d{4})[/-]?(\d{1,2})月?/;

const DAYS_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function isAttendanceHistoryQuery(text: string): boolean {
  return QUERY_PATTERN.test(text);
}

function getJstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60_000);
}

function resolveTargetMonth(text: string): { year: number; month: number } {
  const specific = text.match(SPECIFIC_MONTH_PATTERN);
  if (specific) {
    return { year: parseInt(specific[1], 10), month: parseInt(specific[2], 10) };
  }
  const now = getJstNow();
  if (LAST_MONTH_PATTERN.test(text)) {
    const m = now.getUTCMonth(); // 0-11
    const lastMonth = m === 0 ? 12 : m;
    const year = m === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    return { year, month: lastMonth };
  }
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function dayOfWeekJa(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return DAYS_OF_WEEK[d.getUTCDay()];
}

export async function handleAttendanceHistoryQuery(
  db: D1Database,
  lineClient: LineClient,
  friendId: string,
  text: string,
  replyToken: string,
): Promise<void> {
  const { year, month } = resolveTargetMonth(text);
  const monthStr = `${year}-${pad2(month)}`;

  const lastDay = new Date(year, month, 0).getDate();
  const startDate = formatDate(year, month, 1);
  const endDate = formatDate(year, month, lastDay);

  const records = await getFriendClockRecords(db, { friendId, startDate, endDate });

  if (records.length === 0) {
    await lineClient.replyMessage(replyToken, [{
      type: 'text',
      text: `${year}年${month}月 の稼働記録はまだありません。`,
    }]);
    return;
  }

  // 集計
  let totalHours = 0;
  let workedDays = 0;
  for (const r of records) {
    if (r.work_hours != null) totalHours += r.work_hours;
    if (r.clock_in) workedDays += 1;
  }
  totalHours = Math.round(totalHours * 100) / 100;

  // 一覧（古い順に並び替え）
  const sorted = [...records].sort((a, b) => a.target_date.localeCompare(b.target_date));
  const lines = sorted.map((r) => {
    const md = r.target_date.slice(5).replace('-', '/');
    const dow = dayOfWeekJa(r.target_date);
    const ci = r.clock_in || '--:--';
    const co = r.clock_out || '--:--';
    const hours = r.work_hours != null ? ` (${r.work_hours}h)` : (r.clock_in && !r.clock_out ? ' (稼働中)' : '');
    return `${md} (${dow}) ${ci} 〜 ${co}${hours}`;
  });

  const body = [
    `📋 ${year}年${month}月の稼働履歴`,
    '',
    ...lines,
    '',
    `📊 月計: ${workedDays}日 / ${totalHours}h`,
  ].join('\n');

  await lineClient.replyMessage(replyToken, [{ type: 'text', text: body }]);
}
