/**
 * Kintone ミラー API
 * BPO企業マスタ / 稼働者参画情報の閲覧（D1ミラー由来）
 */

import { Hono } from 'hono';
import {
  getKintoneCompanies,
  getAllAssignments,
  countAssignmentsByCompany,
  countAssignmentsByAgency,
} from '@line-crm/db';
import { syncKintoneAssignmentsManual, syncKintoneCompaniesManual } from '../services/friend-attendance-cron.js';
import type { Env } from '../index.js';

const kintoneMirror = new Hono<Env>();

// 企業一覧
kintoneMirror.get('/api/kintone/companies', async (c) => {
  const companies = await getKintoneCompanies(c.env.DB);
  const workerCounts = await countAssignmentsByCompany(c.env.DB);
  const countByName = new Map(workerCounts.map(w => [w.company, w.count]));
  return c.json({
    success: true,
    data: companies.map(co => ({
      kintoneId: co.kintone_id,
      companyName: co.company_name,
      cases: [co.case_name_1, co.case_name_2, co.case_name_3].filter(Boolean),
      caseSummaries: [co.case_summary_1, co.case_summary_2, co.case_summary_3].filter(Boolean),
      contactPerson: co.contact_person,
      contactEmail: co.contact_email,
      contactPhone: co.contact_phone,
      csPerson: co.cs_person,
      salesPerson: co.sales_person,
      workLocation: co.work_location,
      workHours: co.work_hours,
      workEnvironment: co.work_environment,
      activeWorkerCount: countByName.get(co.company_name || '') ?? 0,
      syncedAt: co.synced_at,
    })),
  });
});

// 稼働者参画情報一覧
kintoneMirror.get('/api/kintone/assignments', async (c) => {
  const rows = await getAllAssignments(c.env.DB);
  return c.json({
    success: true,
    data: rows.map(r => ({
      friendId: r.friend_id,
      displayName: r.display_name,
      kintoneId: r.kintone_id,
      status: r.status,
      caseName: r.case_name,
      billingCompany: r.billing_company,
      agencyName: r.agency_name,
      referrer: r.referrer,
      assignmentStartDate: r.assignment_start_date,
    })),
  });
});

// 代理店別集計
kintoneMirror.get('/api/kintone/agencies', async (c) => {
  const rows = await countAssignmentsByAgency(c.env.DB);
  return c.json({
    success: true,
    data: rows.map(r => ({ agency: r.agency, count: r.count })),
  });
});

// 手動同期トリガー（管理者向け）
kintoneMirror.post('/api/kintone/sync', async (c) => {
  const { KINTONE_API_TOKEN, KINTONE_API_TOKEN_BPO } = c.env;
  const results: { companies?: string; assignments?: string } = {};

  if (KINTONE_API_TOKEN_BPO) {
    try {
      await syncKintoneCompaniesManual(c.env.DB, KINTONE_API_TOKEN_BPO);
      results.companies = 'ok';
    } catch (err) {
      results.companies = `error: ${(err as Error).message}`;
    }
  } else {
    results.companies = 'KINTONE_API_TOKEN_BPO not set';
  }

  if (KINTONE_API_TOKEN) {
    try {
      await syncKintoneAssignmentsManual(c.env.DB, KINTONE_API_TOKEN);
      results.assignments = 'ok';
    } catch (err) {
      results.assignments = `error: ${(err as Error).message}`;
    }
  } else {
    results.assignments = 'KINTONE_API_TOKEN not set';
  }

  return c.json({ success: true, data: results });
});

export { kintoneMirror };
