/**
 * Kintone ライブ参照 + ミラー API
 * - 稼働者マスタ(57) + 参画離脱マスタ(165) + BPO企業マスタ(22) を統合
 * - 朝の同期は friend_shifts.kintone_status 更新用に存続
 */

import { Hono } from 'hono';
import { getKintoneIdToFriendMap } from '@line-crm/db';
import {
  fetchAllKintoneCompanies,
  fetchAllKintoneWorkers,
  fetchAllSanRiRecords,
  computeCurrentAssignmentsByName,
} from '../services/kintone.js';
import { syncKintoneAssignmentsManual, syncKintoneCompaniesManual } from '../services/friend-attendance-cron.js';
import type { Env } from '../index.js';

const kintoneMirror = new Hono<Env>();

function normalizeName(s: string): string {
  return (s || '').replace(/[\s　]/g, '');
}

// 企業一覧 + 各企業の参画中稼働者リスト
kintoneMirror.get('/api/kintone/companies', async (c) => {
  const { KINTONE_API_TOKEN, KINTONE_API_TOKEN_BPO, KINTONE_API_TOKEN_SANRI } = c.env;
  if (!KINTONE_API_TOKEN_BPO) return c.json({ success: false, error: 'KINTONE_API_TOKEN_BPO not set' }, 500);

  const [companies, workers, sanRiRecords] = await Promise.all([
    fetchAllKintoneCompanies(KINTONE_API_TOKEN_BPO),
    KINTONE_API_TOKEN ? fetchAllKintoneWorkers(KINTONE_API_TOKEN) : Promise.resolve([]),
    KINTONE_API_TOKEN_SANRI ? fetchAllSanRiRecords(KINTONE_API_TOKEN_SANRI) : Promise.resolve([]),
  ]);

  const linkMap = await getKintoneIdToFriendMap(c.env.DB);
  // 氏名 → 稼働者マスタのレコード情報
  const workerByName = new Map<string, typeof workers[number]>();
  for (const w of workers) workerByName.set(normalizeName(w.name), w);

  // 参画離脱マスタから「現在の参画」を計算
  const currentByName = computeCurrentAssignmentsByName(sanRiRecords);

  // 企業ごとの参画中稼働者
  const workersByCompany = new Map<string, Array<{
    name: string; caseName: string; startDate: string; referrer: string;
    salesPerson: string; isLinked: boolean; friendId: string | null;
    lineDisplayName: string | null; kintoneId: string | null;
  }>>();

  // 1) 参画離脱マスタに参画レコードがある稼働者を企業ごとに振り分け
  const namesCovered = new Set<string>();
  for (const [nameKey, current] of currentByName) {
    const compKey = normalizeName(current.company);
    if (!compKey) continue;
    const worker = workerByName.get(nameKey);
    const link = worker ? linkMap.get(worker.recordId) : undefined;
    namesCovered.add(nameKey);
    const entry = {
      name: current.name,
      caseName: current.caseName,
      startDate: current.startDate,
      referrer: current.referrer,
      salesPerson: current.salesPerson,
      isLinked: !!link,
      friendId: link?.friend_id ?? null,
      lineDisplayName: link?.display_name ?? null,
      kintoneId: worker?.recordId ?? null,
      source: '参画離脱マスタ' as const,
    };
    if (!workersByCompany.has(compKey)) workersByCompany.set(compKey, []);
    workersByCompany.get(compKey)!.push(entry);
  }

  // 2) 参画離脱マスタに記録がない 状況=参画中 の稼働者は稼働者マスタの 請求先企業 でフォールバック
  for (const w of workers) {
    if (w.status !== '参画中') continue;
    const nameKey = normalizeName(w.name);
    if (namesCovered.has(nameKey)) continue;
    const compKey = normalizeName(w.billingCompany);
    if (!compKey) continue;
    const link = linkMap.get(w.recordId);
    const entry = {
      name: w.name,
      caseName: w.caseName,
      startDate: w.startDate,
      referrer: w.referrer,
      salesPerson: '',
      isLinked: !!link,
      friendId: link?.friend_id ?? null,
      lineDisplayName: link?.display_name ?? null,
      kintoneId: w.recordId,
      source: '稼働者マスタ' as const,
    };
    if (!workersByCompany.has(compKey)) workersByCompany.set(compKey, []);
    workersByCompany.get(compKey)!.push(entry);
  }

  return c.json({
    success: true,
    data: companies.map(co => {
      const active = workersByCompany.get(normalizeName(co.companyName)) || [];
      return {
        kintoneId: co.recordId,
        companyName: co.companyName,
        cases: [co.caseName1, co.caseName2, co.caseName3].filter(Boolean),
        caseSummaries: [co.caseSummary1, co.caseSummary2, co.caseSummary3].filter(Boolean),
        contactPerson: co.contactPerson,
        contactEmail: co.contactEmail,
        contactPhone: co.contactPhone,
        csPerson: co.csPerson,
        salesPerson: co.salesPerson,
        workLocation: co.workLocation,
        workHours: co.workHours,
        workEnvironment: co.workEnvironment,
        activeWorkerCount: active.length,
        activeWorkers: active,
      };
    }),
  });
});

// 参画者一覧（稼働者マスタ + 参画離脱マスタの現在参画 + LINE連携状態）
kintoneMirror.get('/api/kintone/assignments', async (c) => {
  const { KINTONE_API_TOKEN, KINTONE_API_TOKEN_SANRI } = c.env;
  if (!KINTONE_API_TOKEN) return c.json({ success: false, error: 'KINTONE_API_TOKEN not set' }, 500);

  const [workers, sanRiRecords, linkMap] = await Promise.all([
    fetchAllKintoneWorkers(KINTONE_API_TOKEN),
    KINTONE_API_TOKEN_SANRI ? fetchAllSanRiRecords(KINTONE_API_TOKEN_SANRI) : Promise.resolve([]),
    getKintoneIdToFriendMap(c.env.DB),
  ]);

  const currentByName = computeCurrentAssignmentsByName(sanRiRecords);

  return c.json({
    success: true,
    data: workers.map(w => {
      const link = linkMap.get(w.recordId);
      const current = currentByName.get(normalizeName(w.name));
      return {
        kintoneId: w.recordId,
        name: w.name,
        status: w.status,
        // 参画離脱マスタ由来の最新参画情報（あれば優先）
        caseName: current?.caseName || w.caseName,
        billingCompany: current?.company || w.billingCompany,
        agencyName: w.agencyName,
        referrer: current?.referrer || w.referrer,
        salesPerson: current?.salesPerson || '',
        assignmentStartDate: current?.startDate || w.startDate,
        isLinked: !!link,
        friendId: link?.friend_id ?? null,
        lineDisplayName: link?.display_name ?? null,
        isFollowing: link?.is_following === 1,
      };
    }),
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
