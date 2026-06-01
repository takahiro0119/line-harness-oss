/**
 * Kintone ミラー (BPO企業マスタ)
 * Kintone を正としつつ、ダッシュボード表示用に D1 にキャッシュ
 */

export interface KintoneCompanyRow {
  kintone_id: string;
  company_name: string | null;
  case_name_1: string | null;
  case_name_2: string | null;
  case_name_3: string | null;
  case_summary_1: string | null;
  case_summary_2: string | null;
  case_summary_3: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  cs_person: string | null;
  sales_person: string | null;
  work_location: string | null;
  work_hours: string | null;
  work_environment: string | null;
  total_worker_count: string | null;
  synced_at: string;
}

export async function upsertKintoneCompany(
  db: D1Database,
  c: Omit<KintoneCompanyRow, 'synced_at'>,
): Promise<void> {
  await db.prepare(
    `INSERT INTO kintone_companies (
      kintone_id, company_name, case_name_1, case_name_2, case_name_3,
      case_summary_1, case_summary_2, case_summary_3,
      contact_person, contact_email, contact_phone,
      cs_person, sales_person,
      work_location, work_hours, work_environment, total_worker_count,
      synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(kintone_id) DO UPDATE SET
      company_name = excluded.company_name,
      case_name_1 = excluded.case_name_1,
      case_name_2 = excluded.case_name_2,
      case_name_3 = excluded.case_name_3,
      case_summary_1 = excluded.case_summary_1,
      case_summary_2 = excluded.case_summary_2,
      case_summary_3 = excluded.case_summary_3,
      contact_person = excluded.contact_person,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      cs_person = excluded.cs_person,
      sales_person = excluded.sales_person,
      work_location = excluded.work_location,
      work_hours = excluded.work_hours,
      work_environment = excluded.work_environment,
      total_worker_count = excluded.total_worker_count,
      synced_at = datetime('now')`
  ).bind(
    c.kintone_id, c.company_name, c.case_name_1, c.case_name_2, c.case_name_3,
    c.case_summary_1, c.case_summary_2, c.case_summary_3,
    c.contact_person, c.contact_email, c.contact_phone,
    c.cs_person, c.sales_person,
    c.work_location, c.work_hours, c.work_environment, c.total_worker_count,
  ).run();
}

export async function deleteKintoneCompaniesNotIn(db: D1Database, kintoneIds: string[]): Promise<void> {
  if (kintoneIds.length === 0) {
    await db.prepare('DELETE FROM kintone_companies').run();
    return;
  }
  const placeholders = kintoneIds.map(() => '?').join(',');
  await db.prepare(`DELETE FROM kintone_companies WHERE kintone_id NOT IN (${placeholders})`)
    .bind(...kintoneIds).run();
}

export async function getKintoneCompanies(db: D1Database): Promise<KintoneCompanyRow[]> {
  const r = await db.prepare('SELECT * FROM kintone_companies ORDER BY company_name ASC').all<KintoneCompanyRow>();
  return r.results;
}

export async function getKintoneCompanyByName(db: D1Database, companyName: string): Promise<KintoneCompanyRow | null> {
  return db.prepare('SELECT * FROM kintone_companies WHERE company_name = ?')
    .bind(companyName).first<KintoneCompanyRow>();
}

// ── 稼働者×企業 JOIN ───────────────────────────

export interface AssignmentSummary {
  friend_id: string;
  display_name: string | null;
  kintone_id: string | null;
  status: string | null;
  case_name: string | null;
  billing_company: string | null;
  agency_name: string | null;
  referrer: string | null;
  assignment_start_date: string | null;
}

/**
 * 全稼働者の参画情報一覧（kintone_id がある人のみ＝Kintone登録済み）
 */
export async function getAllAssignments(db: D1Database): Promise<AssignmentSummary[]> {
  const r = await db.prepare(`
    SELECT
      f.id as friend_id,
      f.display_name,
      fo.kintone_id,
      fs.kintone_status as status,
      fs.current_case_name as case_name,
      fs.current_billing_company as billing_company,
      fs.agency_name,
      fs.referrer,
      fs.assignment_start_date
    FROM friends f
    LEFT JOIN friend_shifts fs ON fs.friend_id = f.id
    LEFT JOIN friend_onboarding fo ON fo.friend_id = f.id
    WHERE f.is_following = 1
      AND fo.kintone_id IS NOT NULL
      AND fo.kintone_id != ''
    ORDER BY fs.kintone_status DESC, f.display_name ASC
  `).all<AssignmentSummary>();
  return r.results;
}

/**
 * 企業別の参画稼働者数（請求先企業でグループ化）
 */
export async function countAssignmentsByCompany(db: D1Database): Promise<Array<{ company: string; count: number }>> {
  const r = await db.prepare(`
    SELECT current_billing_company as company, COUNT(*) as count
    FROM friend_shifts
    WHERE current_billing_company IS NOT NULL
      AND current_billing_company != ''
      AND kintone_status = '参画中'
    GROUP BY current_billing_company
    ORDER BY count DESC
  `).all<{ company: string; count: number }>();
  return r.results;
}

/**
 * Kintone レコードID → LINE 紐付け情報 (友だちID + 表示名) のマップ
 * ダッシュボードで「LINE連携済み」判定に使う
 */
export interface KintoneLinkInfo {
  friend_id: string;
  display_name: string | null;
  is_following: number;
}

export async function getKintoneIdToFriendMap(db: D1Database): Promise<Map<string, KintoneLinkInfo>> {
  const r = await db.prepare(`
    SELECT fo.kintone_id, f.id as friend_id, f.display_name, f.is_following
    FROM friend_onboarding fo
    JOIN friends f ON f.id = fo.friend_id
    WHERE fo.kintone_id IS NOT NULL AND fo.kintone_id != ''
  `).all<{ kintone_id: string; friend_id: string; display_name: string | null; is_following: number }>();
  const map = new Map<string, KintoneLinkInfo>();
  for (const row of r.results) {
    map.set(row.kintone_id, {
      friend_id: row.friend_id,
      display_name: row.display_name,
      is_following: row.is_following,
    });
  }
  return map;
}

/**
 * 代理店別の参画稼働者数
 */
export async function countAssignmentsByAgency(db: D1Database): Promise<Array<{ agency: string; count: number }>> {
  const r = await db.prepare(`
    SELECT agency_name as agency, COUNT(*) as count
    FROM friend_shifts
    WHERE agency_name IS NOT NULL
      AND agency_name != ''
      AND kintone_status = '参画中'
    GROUP BY agency_name
    ORDER BY count DESC
  `).all<{ agency: string; count: number }>();
  return r.results;
}
