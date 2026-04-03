/**
 * 日本の祝日判定ユーティリティ
 * 国民の祝日に関する法律に基づく
 */

// 春分・秋分の日の近似計算
function vernalEquinox(year: number): number {
  if (year <= 2099) return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return Math.floor(21.851 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinox(year: number): number {
  if (year <= 2099) return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return Math.floor(24.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// 第N月曜日を計算
function nthMonday(year: number, month: number, n: number): number {
  const first = new Date(year, month - 1, 1).getDay();
  const firstMonday = first <= 1 ? 2 - first : 9 - first;
  return firstMonday + (n - 1) * 7;
}

/**
 * 指定年の日本の祝日一覧を返す
 * @returns Set of 'YYYY-MM-DD' strings
 */
export function getJapaneseHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => {
    holidays.add(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  };

  // 固定祝日
  add(1, 1);   // 元日
  add(2, 11);  // 建国記念の日
  add(2, 23);  // 天皇誕生日
  add(4, 29);  // 昭和の日
  add(5, 3);   // 憲法記念日
  add(5, 4);   // みどりの日
  add(5, 5);   // こどもの日
  add(8, 11);  // 山の日
  add(11, 3);  // 文化の日
  add(11, 23); // 勤労感謝の日

  // ハッピーマンデー
  add(1, nthMonday(year, 1, 2));   // 成人の日（1月第2月曜）
  add(7, nthMonday(year, 7, 3));   // 海の日（7月第3月曜）
  add(9, nthMonday(year, 9, 3));   // 敬老の日（9月第3月曜）
  add(10, nthMonday(year, 10, 2)); // スポーツの日（10月第2月曜）

  // 春分・秋分
  add(3, vernalEquinox(year));
  add(9, autumnalEquinox(year));

  // 振替休日: 祝日が日曜日の場合、翌月曜日
  const baseHolidays = [...holidays];
  for (const h of baseHolidays) {
    const d = new Date(h + 'T00:00:00+09:00');
    if (d.getUTCDay() === 0) { // Sunday in JST (UTC day for +09:00 dates)
      const next = new Date(d.getTime() + 86400000);
      const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
      // 翌日も祝日なら更にその翌日
      let substitute = next;
      let subStr = nextStr;
      while (holidays.has(subStr)) {
        substitute = new Date(substitute.getTime() + 86400000);
        subStr = `${substitute.getUTCFullYear()}-${String(substitute.getUTCMonth() + 1).padStart(2, '0')}-${String(substitute.getUTCDate()).padStart(2, '0')}`;
      }
      holidays.add(subStr);
    }
  }

  // 国民の休日: 祝日に挟まれた平日
  const sortedDates = [...holidays].sort();
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const curr = new Date(sortedDates[i] + 'T00:00:00+09:00');
    const next = new Date(sortedDates[i + 1] + 'T00:00:00+09:00');
    const diff = (next.getTime() - curr.getTime()) / 86400000;
    if (diff === 2) {
      const between = new Date(curr.getTime() + 86400000);
      const betweenDay = between.getUTCDay();
      if (betweenDay !== 0) { // not Sunday
        const betweenStr = `${between.getUTCFullYear()}-${String(between.getUTCMonth() + 1).padStart(2, '0')}-${String(between.getUTCDate()).padStart(2, '0')}`;
        holidays.add(betweenStr);
      }
    }
  }

  return holidays;
}

/**
 * 指定日が日本の祝日かどうか
 * @param dateStr 'YYYY-MM-DD' format
 */
export function isJapaneseHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.slice(0, 4));
  return getJapaneseHolidays(year).has(dateStr);
}

/**
 * 指定日が勤務日かどうかを判定
 * @param dateStr 'YYYY-MM-DD' format
 * @param workDays comma-separated day numbers (0=Sun, 6=Sat)
 * @param excludeHolidays whether to exclude Japanese holidays
 */
export function isWorkDay(dateStr: string, workDays = '1,2,3,4,5', excludeHolidays = true): boolean {
  const date = new Date(dateStr + 'T00:00:00+09:00');
  const dayOfWeek = date.getUTCDay(); // 0=Sun in JST
  const workDaySet = new Set(workDays.split(',').map(Number));

  if (!workDaySet.has(dayOfWeek)) return false;
  if (excludeHolidays && isJapaneseHoliday(dateStr)) return false;
  return true;
}
