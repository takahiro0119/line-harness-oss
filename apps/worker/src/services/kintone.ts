/**
 * Kintone 稼働者マスタ / BPO企業マスタ (閲覧のみ)
 * - 稼働者マスタ: 氏名 + 電話番号 で名寄せ
 * - BPO企業マスタ: 全件ミラー用
 */

const KINTONE_SUBDOMAIN = '52vgnlmalqud';
const KINTONE_APP_ID = '57';
const KINTONE_BPO_APP_ID = '22';

function normalizePhone(s: string): string {
  return (s || '').replace(/[^0-9]/g, '');
}

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

// ── 氏名 + 電話番号での稼働者検索 ─────────────────────

const ASSIGNMENT_FIELDS =
  'fields[0]=レコード番号&fields[1]=氏名&fields[2]=電話番号&fields[3]=状況&fields[4]=案件名&fields[5]=請求先企業&fields[6]=代理店様法人名&fields[7]=紹介者&fields[8]=参画決定日';

export interface KintoneAssignment {
  recordId: string;
  name: string;
  status: string;
  caseName: string;
  billingCompany: string;
  agencyName: string;
  referrer: string;
  startDate: string;
}

function toAssignment(r: KintoneRecord): KintoneAssignment {
  return {
    recordId: r['レコード番号'].value as string,
    name: r['氏名'].value as string,
    status: ((r['状況']?.value as string) || '').trim(),
    caseName: (r['案件名']?.value as string) || '',
    billingCompany: (r['請求先企業']?.value as string) || '',
    agencyName: (r['代理店様法人名']?.value as string) || '',
    referrer: (r['紹介者']?.value as string) || '',
    startDate: (r['参画決定日']?.value as string) || '',
  };
}

/**
 * 氏名 + 電話番号で稼働者マスタを検索（既存稼働者の本人確認用）
 * - 電話番号は数字のみで比較（ハイフン有無を吸収）
 * - 氏名は完全一致→部分一致の順で試す
 */
export async function searchKintoneWorkerByPhone(
  apiToken: string,
  name: string,
  phone: string,
): Promise<KintoneAssignment | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  // 1) 氏名完全一致で候補取得 → ローカルで電話番号一致を判定
  const candidates = await fetchKintoneCandidatesByName(apiToken, name);
  for (const r of candidates) {
    const recPhone = normalizePhone((r['電話番号']?.value as string) || '');
    if (recPhone && recPhone === normalizedPhone) return toAssignment(r);
  }

  // 2) スペース除去 like 検索
  const nameNoSpace = name.replace(/[\s　]/g, '');
  if (nameNoSpace !== name) {
    const fuzzy = await fetchKintoneCandidatesByNameLike(apiToken, nameNoSpace);
    for (const r of fuzzy) {
      const recPhone = normalizePhone((r['電話番号']?.value as string) || '');
      if (recPhone && recPhone === normalizedPhone) return toAssignment(r);
    }
  }

  return null;
}

async function fetchKintoneCandidatesByName(apiToken: string, name: string): Promise<KintoneRecord[]> {
  const query = `氏名 = "${escapeKintoneQuery(name)}"`;
  const url = `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?app=${KINTONE_APP_ID}&query=${encodeURIComponent(query)}&${ASSIGNMENT_FIELDS}`;
  try {
    const res = await fetch(url, { headers: { 'X-Cybozu-API-Token': apiToken } });
    if (!res.ok) return [];
    const data = await res.json() as KintoneSearchResult;
    return data.records;
  } catch {
    return [];
  }
}

async function fetchKintoneCandidatesByNameLike(apiToken: string, name: string): Promise<KintoneRecord[]> {
  const query = `氏名 like "${escapeKintoneQuery(name)}"`;
  const url = `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?app=${KINTONE_APP_ID}&query=${encodeURIComponent(query)}&${ASSIGNMENT_FIELDS}`;
  try {
    const res = await fetch(url, { headers: { 'X-Cybozu-API-Token': apiToken } });
    if (!res.ok) return [];
    const data = await res.json() as KintoneSearchResult;
    return data.records;
  } catch {
    return [];
  }
}

/**
 * 稼働者マスタの「参画情報」をレコードIDから取得（朝同期用）
 */
export async function fetchKintoneAssignments(
  apiToken: string,
  recordIds: string[],
): Promise<Map<string, KintoneAssignment>> {
  const result = new Map<string, KintoneAssignment>();
  if (recordIds.length === 0) return result;

  const chunkSize = 100;
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize);
    const query = `レコード番号 in (${chunk.join(',')})`;
    const url = `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?app=${KINTONE_APP_ID}&query=${encodeURIComponent(query)}&${ASSIGNMENT_FIELDS}`;
    try {
      const res = await fetch(url, { headers: { 'X-Cybozu-API-Token': apiToken } });
      if (!res.ok) continue;
      const data = await res.json() as KintoneSearchResult;
      for (const r of data.records) {
        const a = toAssignment(r);
        result.set(a.recordId, a);
      }
    } catch (err) {
      console.error('fetchKintoneAssignments failed:', err);
    }
  }
  return result;
}

// ── BPO企業マスタ (appId=22) 取得 ──────────────────

export interface KintoneCompany {
  recordId: string;
  companyName: string;
  caseName1: string;
  caseName2: string;
  caseName3: string;
  caseSummary1: string;
  caseSummary2: string;
  caseSummary3: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  csPerson: string;
  salesPerson: string;
  workLocation: string;
  workHours: string;
  workEnvironment: string;
  totalWorkerCount: string;
}

const COMPANY_FIELDS =
  'fields[0]=レコード番号&fields[1]=会社名&fields[2]=案件名_1&fields[3]=案件名_2&fields[4]=案件名_3' +
  '&fields[5]=案件概要_0&fields[6]=案件概要_1_0&fields[7]=案件概要_2&fields[8]=案件概要_3' +
  '&fields[9]=担当者名&fields[10]=担当者メールアドレス&fields[11]=担当者直通電話番号' +
  '&fields[12]=CS担当者&fields[13]=営業担当者&fields[14]=稼働場所&fields[15]=稼働時間' +
  '&fields[16]=稼働環境&fields[17]=稼働総人数';

/**
 * BPO企業マスタ 全件取得（500件超は cursor で分割）
 */
export async function fetchAllKintoneCompanies(apiToken: string): Promise<KintoneCompany[]> {
  const all: KintoneCompany[] = [];
  let offset = 0;
  const limit = 500;
  for (let i = 0; i < 100; i++) {
    const query = `limit ${limit} offset ${offset}`;
    const url = `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?app=${KINTONE_BPO_APP_ID}&query=${encodeURIComponent(query)}&${COMPANY_FIELDS}`;
    try {
      const res = await fetch(url, { headers: { 'X-Cybozu-API-Token': apiToken } });
      if (!res.ok) {
        console.error('BPO fetch error:', res.status, await res.text());
        break;
      }
      const data = await res.json() as KintoneSearchResult;
      if (data.records.length === 0) break;
      for (const r of data.records) {
        all.push({
          recordId: r['レコード番号'].value as string,
          companyName: (r['会社名']?.value as string) || '',
          caseName1: (r['案件名_1']?.value as string) || '',
          caseName2: (r['案件名_2']?.value as string) || '',
          caseName3: (r['案件名_3']?.value as string) || '',
          caseSummary1: (r['案件概要_1_0']?.value as string) || '',
          caseSummary2: (r['案件概要_2']?.value as string) || '',
          caseSummary3: (r['案件概要_3']?.value as string) || '',
          contactPerson: (r['担当者名']?.value as string) || '',
          contactEmail: (r['担当者メールアドレス']?.value as string) || '',
          contactPhone: (r['担当者直通電話番号']?.value as string) || '',
          csPerson: (r['CS担当者']?.value as string) || '',
          salesPerson: (r['営業担当者']?.value as string) || '',
          workLocation: (r['稼働場所']?.value as string) || '',
          workHours: (r['稼働時間']?.value as string) || '',
          workEnvironment: (r['稼働環境']?.value as string) || '',
          totalWorkerCount: (r['稼働総人数']?.value as string) || '',
        });
      }
      if (data.records.length < limit) break;
      offset += limit;
    } catch (err) {
      console.error('fetchAllKintoneCompanies failed:', err);
      break;
    }
  }
  return all;
}
