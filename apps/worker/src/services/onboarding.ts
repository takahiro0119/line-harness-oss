/**
 * オンボーディング会話フローハンドラ
 * 流入経路に応じた登録時ヒアリングを処理
 */

import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import {
  getFriendOnboarding,
  createFriendOnboarding,
  updateOnboardingStep,
  getEntryRouteOnboardingFlow,
  upsertFriendShift,
  updateFriendKintoneStatus,
} from '@line-crm/db';
import { searchKintoneWorkerByPhone } from './kintone.js';
import type { KintoneAssignment } from './kintone.js';
import { upsertFriendAssignment } from '@line-crm/db';

/**
 * follow時に呼ばれる: 流入経路に応じてオンボーディングを開始
 * @returns true if onboarding started (replyToken used)
 */
export async function startOnboardingIfNeeded(
  db: D1Database,
  lineClient: LineClient,
  friendId: string,
  refCode: string | null,
  replyToken: string,
  liffId?: string,
): Promise<boolean> {
  return triggerOnboardingFlow(db, lineClient, friendId, refCode, { replyToken, liffId });
}

/**
 * 既存友達がリンクを踏んだ時: pushMessageでオンボーディングを再開（または別フロー起動）
 */
export async function pushOnboardingForRef(
  db: D1Database,
  lineClient: LineClient,
  friendId: string,
  lineUserId: string,
  refCode: string | null,
  liffId?: string,
): Promise<boolean> {
  return triggerOnboardingFlow(db, lineClient, friendId, refCode, { pushToLineUserId: lineUserId, liffId });
}

async function triggerOnboardingFlow(
  db: D1Database,
  lineClient: LineClient,
  friendId: string,
  refCode: string | null,
  opts: { replyToken?: string; pushToLineUserId?: string; liffId?: string },
): Promise<boolean> {
  if (!refCode) return false;

  const flowType = await getEntryRouteOnboardingFlow(db, refCode);
  if (!flowType) return false;

  const existing = await getFriendOnboarding(db, friendId);
  if (existing && existing.flow_type === flowType && existing.completed) {
    return false;
  }
  if (!existing || existing.flow_type !== flowType) {
    await createFriendOnboarding(db, friendId, flowType);
  }

  const { replyToken, pushToLineUserId, liffId } = opts;
  const sendMessage = async (messages: Message[]): Promise<void> => {
    if (replyToken) {
      await lineClient.replyMessage(replyToken, messages);
    } else if (pushToLineUserId) {
      await lineClient.pushMessage(pushToLineUserId, messages);
    }
  };

  if (flowType === 'bpo_worker') {
    await sendMessage([
      {
        type: 'text',
        text: '稼働状況の記録のため、ご本人確認をさせてください。\n\nまず、お名前をフルネームで教えてください。\n（例: 山田太郎）',
      },
    ]);
    return true;
  }

  if (flowType === 'bpo_new_worker') {
    const formUrl = liffId
      ? `https://liff.line.me/${liffId}?page=form&id=skill_sheet`
      : '';
    await sendMessage([
      {
        type: 'flex',
        altText: 'スキルシートのご記入をお願いします',
        contents: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', paddingAll: '20px',
            contents: [
              { type: 'text', text: '🎉 ご登録ありがとうございます！', size: 'md', weight: 'bold', color: '#1e293b', wrap: true },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '案件参画にあたり、以下のスキルシートにご記入をお願いいたします。', size: 'sm', color: '#475569', wrap: true, margin: 'lg' },
              { type: 'text', text: '・基本情報\n・スキル評価\n・職務経歴', size: 'xs', color: '#64748b', wrap: true, margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'lg', paddingAll: '10px', backgroundColor: '#eff6ff', cornerRadius: 'md',
                contents: [
                  { type: 'text', text: '※ 入力した内容は弊社で稼働者情報として管理させていただきます', size: 'xxs', color: '#1e40af', wrap: true },
                ],
              },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
            contents: [
              formUrl
                ? { type: 'button', action: { type: 'uri', label: 'スキルシートを記入する', uri: formUrl }, style: 'primary', color: '#06C755', height: 'md' }
                : { type: 'text', text: 'フォームURLを担当者にお問い合わせください', size: 'xs', color: '#64748b' },
            ],
          },
        },
      },
    ]);
    return true;
  }

  return false;
}

/**
 * メッセージ受信時に呼ばれる: オンボーディング中なら会話を処理
 * @returns true if handled (replyToken used)
 */
export async function handleOnboardingMessage(
  db: D1Database,
  lineClient: LineClient,
  friendId: string,
  text: string,
  replyToken: string,
  kintoneApiToken?: string,
): Promise<boolean> {
  const onboarding = await getFriendOnboarding(db, friendId);
  if (!onboarding || onboarding.completed) return false;

  if (onboarding.flow_type === 'bpo_worker') {
    return handleBpoWorkerFlow(db, lineClient, friendId, text, replyToken, onboarding.step, kintoneApiToken);
  }

  return false;
}

async function handleBpoWorkerFlow(
  db: D1Database,
  lineClient: LineClient,
  friendId: string,
  text: string,
  replyToken: string,
  currentStep: string,
  kintoneApiToken?: string,
): Promise<boolean> {
  const trimmed = text.trim();

  switch (currentStep) {
    case 'ask_name': {
      // 名前を受け取る
      if (trimmed.length < 2 || trimmed.length > 30) {
        await lineClient.replyMessage(replyToken, [{
          type: 'text',
          text: 'お名前をフルネームで入力してください。\n（例: 山田太郎）',
        }]);
        return true;
      }

      await updateOnboardingStep(db, friendId, 'ask_phone', { fullName: trimmed });
      await lineClient.replyMessage(replyToken, [{
        type: 'text',
        text: `${trimmed}さん、ありがとうございます。\n\n次に、ご登録のお電話番号を教えてください。\n（例: 090-1234-5678）`,
      }]);
      return true;
    }

    case 'ask_phone': {
      // 電話番号を数字のみ正規化して検証
      const phoneDigits = trimmed.replace(/[^0-9]/g, '');
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        await lineClient.replyMessage(replyToken, [{
          type: 'text',
          text: '電話番号の形式が正しくありません。\n10桁か11桁の数字でご入力ください。\n（例: 09012345678 または 090-1234-5678）',
        }]);
        return true;
      }

      const onboarding = await getFriendOnboarding(db, friendId);
      const fullName = onboarding?.full_name || '';
      let kintoneAssignment: KintoneAssignment | null = null;

      if (kintoneApiToken) {
        try {
          kintoneAssignment = await searchKintoneWorkerByPhone(kintoneApiToken, fullName, trimmed);
        } catch (err) {
          console.error('Kintone phone search error:', err);
        }
      }

      if (kintoneAssignment) {
        // 認証成功
        await updateOnboardingStep(db, friendId, 'complete', {
          phone: phoneDigits,
          kintoneId: kintoneAssignment.recordId,
        });
        await upsertFriendShift(db, friendId, { pattern_type: 'default', work_days: '1,2,3,4,5', exclude_holidays: 1, is_excluded: 0 });
        if (kintoneAssignment.status) {
          await updateFriendKintoneStatus(db, friendId, kintoneAssignment.status);
        }
        // 参画情報を即時保存
        await upsertFriendAssignment(db, friendId, {
          current_case_name: kintoneAssignment.caseName,
          current_billing_company: kintoneAssignment.billingCompany,
          agency_name: kintoneAssignment.agencyName,
          referrer: kintoneAssignment.referrer,
          assignment_start_date: kintoneAssignment.startDate,
        });

        const detailRows: Array<{ label: string; value: string }> = [
          { label: 'お名前', value: kintoneAssignment.name },
          { label: '状況', value: kintoneAssignment.status || '-' },
        ];
        if (kintoneAssignment.billingCompany) detailRows.push({ label: '参画先', value: kintoneAssignment.billingCompany });
        if (kintoneAssignment.caseName) detailRows.push({ label: '案件名', value: kintoneAssignment.caseName });
        if (kintoneAssignment.agencyName) detailRows.push({ label: '代理店', value: kintoneAssignment.agencyName });
        if (kintoneAssignment.startDate) detailRows.push({ label: '参画開始', value: kintoneAssignment.startDate });

        await lineClient.replyMessage(replyToken, [{
          type: 'flex',
          altText: '本人確認が完了しました',
          contents: {
            type: 'bubble',
            body: {
              type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: '✅ 本人確認が完了しました', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'separator', margin: 'lg' },
                {
                  type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
                  contents: detailRows.map(row => ({
                    type: 'box' as const, layout: 'horizontal' as const,
                    contents: [
                      { type: 'text' as const, text: row.label, size: 'sm' as const, color: '#64748b', flex: 2 },
                      { type: 'text' as const, text: row.value, size: 'sm' as const, color: '#1e293b', flex: 3, wrap: true },
                    ],
                  })),
                },
                { type: 'text', text: '下のメニューから稼働開始・終了の記録ができます。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
              ],
            },
          },
        }]);
      } else {
        // 認証失敗
        await updateOnboardingStep(db, friendId, 'complete', { phone: phoneDigits });
        await upsertFriendShift(db, friendId, { pattern_type: 'default', work_days: '1,2,3,4,5', exclude_holidays: 1, is_excluded: 0 });

        await lineClient.replyMessage(replyToken, [{
          type: 'flex',
          altText: '情報を受け付けました',
          contents: {
            type: 'bubble',
            body: {
              type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: '📝 情報を受け付けました', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'separator', margin: 'lg' },
                {
                  type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
                  contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                      { type: 'text', text: 'お名前', size: 'sm', color: '#64748b', flex: 2 },
                      { type: 'text', text: fullName, size: 'sm', color: '#1e293b', flex: 3 },
                    ]},
                    { type: 'box', layout: 'horizontal', contents: [
                      { type: 'text', text: '電話番号', size: 'sm', color: '#64748b', flex: 2 },
                      { type: 'text', text: trimmed, size: 'sm', color: '#1e293b', flex: 3 },
                    ]},
                  ],
                },
                {
                  type: 'box', layout: 'vertical', margin: 'lg', paddingAll: '12px', backgroundColor: '#fef3c7', cornerRadius: 'md',
                  contents: [
                    { type: 'text', text: '⚠️ 稼働者情報との自動紐付けができませんでした。担当者が確認いたします。', size: 'xs', color: '#92400e', wrap: true },
                  ],
                },
              ],
            },
          },
        }]);
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * 生年月日パーサー
 * 対応フォーマット: YYYY-MM-DD, YYYY/M/D, YYYYMMDD, 平成X年M月D日, etc.
 */
function parseBirthday(text: string): string | null {
  // YYYY-MM-DD or YYYY/M/D
  const slashMatch = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    return formatDate(parseInt(y), parseInt(m), parseInt(d));
  }

  // YYYYMMDD
  const numMatch = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (numMatch) {
    const [, y, m, d] = numMatch;
    return formatDate(parseInt(y), parseInt(m), parseInt(d));
  }

  // 和暦: 平成X年M月D日, 昭和X年M月D日, 令和X年M月D日
  const warekiMatch = text.match(/^(明治|大正|昭和|平成|令和)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/);
  if (warekiMatch) {
    const [, era, ey, m, d] = warekiMatch;
    const eraOffsets: Record<string, number> = { '明治': 1867, '大正': 1911, '昭和': 1925, '平成': 1988, '令和': 2018 };
    const year = parseInt(ey) + (eraOffsets[era] || 0);
    return formatDate(year, parseInt(m), parseInt(d));
  }

  // M月D日生まれ (年なし) — 受け付けない
  return null;
}

function formatDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2010 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
