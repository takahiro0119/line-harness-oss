/**
 * Kintone 稼働者マスタ検索（閲覧のみ）
 * 氏名 + 生年月日 で名寄せ
 */

const KINTONE_SUBDOMAIN = '52vgnlmalqud';
const KINTONE_APP_ID = '57';

interface KintoneRecord {
  レコード番号: { value: string };
  氏名: { value: string };
  生年月日: { value: string };
  電話番号: { value: string };
  フリガナ: { value: string };
  メールアドレス: { value: string };
  状況?: { value: string };
  [key: string]: { value: string | unknown } | undefined;
}

interface KintoneSearchResult {
  records: KintoneRecord[];
  totalCount: string | null;
}

export interface KintoneWorker {
  recordId: string;
  name: string;
  birthday: string;
  phone: string;
  furigana: string;
  email: string;
  status: string;
}

const COMMON_FIELDS =
  'fields[0]=レコード番号&fields[1]=氏名&fields[2]=生年月日&fields[3]=電話番号&fields[4]=フリガナ&fields[5]=メールアドレス&fields[6]=状況';

function toWorker(r: KintoneRecord): KintoneWorker {
  return {
    recordId: r['レコード番号'].value as string,
    name: r['氏名'].value as string,
    birthday: r['生年月日'].value as string,
    phone: r['電話番号'].value as string,
    furigana: r['フリガナ'].value as string,
    email: r['メールアドレス'].value as string,
    status: (r['状況']?.value as string) || '',
  };
}

/**
 * レコード番号から「状況」だけ引く（日次同期用）
 */
export async function fetchKintoneWorkerStatuses(
  apiToken: string,
  recordIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (recordIds.length === 0) return result;

  // Kintone のクエリは長くなるので 100 件ずつ分割
  const chunkSize = 100;
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize);
    const query = `レコード番号 in (${chunk.join(',')})`;
    const url = `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?app=${KINTONE_APP_ID}&query=${encodeURIComponent(query)}&fields[0]=レコード番号&fields[1]=状況`;

    try {
      const res = await fetch(url, { headers: { 'X-Cybozu-API-Token': apiToken } });
      if (!res.ok) {
        console.error('Kintone status fetch error:', res.status, await res.text());
        continue;
      }
      const data = await res.json() as KintoneSearchResult;
      for (const r of data.records) {
        const id = r['レコード番号'].value as string;
        const status = (r['状況']?.value as string) || '';
        result.set(id, status);
      }
    } catch (err) {
      console.error('Kintone status fetch failed:', err);
    }
  }
  return result;
}

/**
 * 氏名 + 生年月日で稼働者マスタを検索
 */
export async function searchKintoneWorker(
  apiToken: string,
  name: string,
  birthday: string,
): Promise<KintoneWorker | null> {
  // クエリ: 氏名に一致 AND 生年月日に一致
  const query = `氏名 = "${escapeKintoneQuery(name)}" and 生年月日 = "${birthday}"`;

  const url = `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?app=${KINTONE_APP_ID}&query=${encodeURIComponent(query)}&${COMMON_FIELDS}`;

  try {
    const res = await fetch(url, {
      headers: { 'X-Cybozu-API-Token': apiToken },
    });

    if (!res.ok) {
      console.error('Kintone API error:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as KintoneSearchResult;
    if (data.records.length === 0) {
      // 部分一致でもう一度試す（姓だけ or 名だけ）
      return searchKintoneWorkerPartial(apiToken, name, birthday);
    }

    return toWorker(data.records[0]);
  } catch (err) {
    console.error('Kintone search failed:', err);
    return null;
  }
}

/**
 * 部分一致検索（名前のスペースや表記ゆれ対応）
 */
async function searchKintoneWorkerPartial(
  apiToken: string,
  name: string,
  birthday: string,
): Promise<KintoneWorker | null> {
  // スペースを除去して like 検索
  const nameNoSpace = name.replace(/[\s　]/g, '');
  const query = `氏名 like "${escapeKintoneQuery(nameNoSpace)}" and 生年月日 = "${birthday}"`;

  const url = `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?app=${KINTONE_APP_ID}&query=${encodeURIComponent(query)}&${COMMON_FIELDS}`;

  try {
    const res = await fetch(url, {
      headers: { 'X-Cybozu-API-Token': apiToken },
    });

    if (!res.ok) return null;

    const data = await res.json() as KintoneSearchResult;
    if (data.records.length === 0) {
      // 生年月日だけで検索して候補を返す
      return searchByBirthdayOnly(apiToken, birthday, name);
    }

    return toWorker(data.records[0]);
  } catch {
    return null;
  }
}

/**
 * 生年月日のみで検索し、名前の類似度で最も近いレコードを返す
 */
async function searchByBirthdayOnly(
  apiToken: string,
  birthday: string,
  inputName: string,
): Promise<KintoneWorker | null> {
  const query = `生年月日 = "${birthday}"`;
  const url = `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?app=${KINTONE_APP_ID}&query=${encodeURIComponent(query)}&${COMMON_FIELDS}`;

  try {
    const res = await fetch(url, {
      headers: { 'X-Cybozu-API-Token': apiToken },
    });

    if (!res.ok) return null;

    const data = await res.json() as KintoneSearchResult;
    if (data.records.length === 0) return null;

    // 入力名と最も近い名前を探す
    const inputNorm = inputName.replace(/[\s　]/g, '');
    let bestMatch: KintoneRecord | null = null;
    let bestScore = 0;

    for (const r of data.records) {
      const kName = (r['氏名'].value as string).replace(/[\s　]/g, '');
      // 部分一致スコア
      let score = 0;
      if (kName === inputNorm) score = 100;
      else if (kName.includes(inputNorm) || inputNorm.includes(kName)) score = 80;
      else {
        // 文字の一致率
        const common = [...inputNorm].filter(c => kName.includes(c)).length;
        score = Math.round(common / Math.max(inputNorm.length, kName.length) * 60);
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = r;
      }
    }

    // スコアが50以上なら返す
    if (bestMatch && bestScore >= 50) {
      return toWorker(bestMatch);
    }

    return null;
  } catch {
    return null;
  }
}

function escapeKintoneQuery(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
