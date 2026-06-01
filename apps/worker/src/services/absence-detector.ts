/**
 * 休み報告テキスト検知
 *
 * 検知パターン:
 *   - 「今日休みます」「本日休みです」「今日お休み」
 *   - 「明日休みます」「明日休みです」
 *   - 「○月○日休みます」
 *   - 「○/○休みます」
 */

function jstToday(): Date {
  return new Date(Date.now() + 9 * 60 * 60_000);
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function labelDate(d: Date): string {
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

const ABSENCE_KEYWORDS = /(休み|お休み|休む|休ませて|休暇|欠勤)/;
const TODAY_KEYWORDS = /(今日|本日|きょう)/;
const TOMORROW_KEYWORDS = /(明日|あした|あす)/;
const DAY_AFTER_TOMORROW_KEYWORDS = /(明後日|あさって)/;
const MD_PATTERN = /(\d{1,2})\s*[月/-]\s*(\d{1,2})/;

export function detectAbsenceText(text: string): { date: string; dateLabel: string } | null {
  if (!ABSENCE_KEYWORDS.test(text)) return null;

  const today = jstToday();

  // 明後日
  if (DAY_AFTER_TOMORROW_KEYWORDS.test(text)) {
    const d = new Date(today.getTime() + 2 * 86400_000);
    return { date: formatDate(d), dateLabel: '明後日 (' + labelDate(d) + ')' };
  }

  // 明日
  if (TOMORROW_KEYWORDS.test(text)) {
    const d = new Date(today.getTime() + 86400_000);
    return { date: formatDate(d), dateLabel: '明日 (' + labelDate(d) + ')' };
  }

  // 今日/本日
  if (TODAY_KEYWORDS.test(text)) {
    return { date: formatDate(today), dateLabel: '本日 (' + labelDate(today) + ')' };
  }

  // ○月○日 or ○/○
  const m = text.match(MD_PATTERN);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // 過去の日付なら来年扱い
      const year = today.getUTCFullYear();
      const candidate = new Date(Date.UTC(year, month - 1, day));
      if (candidate.getTime() < today.getTime() - 30 * 86400_000) {
        // 30日以上過去なら来年と判定
        candidate.setUTCFullYear(year + 1);
      }
      return { date: formatDate(candidate), dateLabel: labelDate(candidate) };
    }
  }

  // 日付指定なし＋休みキーワードのみ → 今日扱い
  return { date: formatDate(today), dateLabel: '本日 (' + labelDate(today) + ')' };
}
