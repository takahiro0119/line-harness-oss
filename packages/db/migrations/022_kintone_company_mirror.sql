-- BPO企業マスタ (Kintone appId=22) のミラー
CREATE TABLE IF NOT EXISTS kintone_companies (
  kintone_id TEXT PRIMARY KEY,
  company_name TEXT,
  case_name_1 TEXT,
  case_name_2 TEXT,
  case_name_3 TEXT,
  case_summary_1 TEXT,
  case_summary_2 TEXT,
  case_summary_3 TEXT,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  cs_person TEXT,
  sales_person TEXT,
  work_location TEXT,
  work_hours TEXT,
  work_environment TEXT,
  total_worker_count TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kintone_companies_name ON kintone_companies(company_name);

-- 稼働者の参画情報を friend_shifts に追加（Kintone 稼働者マスタからの同期先）
ALTER TABLE friend_shifts ADD COLUMN current_case_name TEXT;
ALTER TABLE friend_shifts ADD COLUMN current_billing_company TEXT;
ALTER TABLE friend_shifts ADD COLUMN agency_name TEXT;
ALTER TABLE friend_shifts ADD COLUMN referrer TEXT;
ALTER TABLE friend_shifts ADD COLUMN assignment_start_date TEXT;

CREATE INDEX IF NOT EXISTS idx_friend_shifts_billing_company ON friend_shifts(current_billing_company);
CREATE INDEX IF NOT EXISTS idx_friend_shifts_agency ON friend_shifts(agency_name);
