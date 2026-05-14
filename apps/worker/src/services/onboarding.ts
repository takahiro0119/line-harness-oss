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
} from '@line-crm/db';

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
): Promise<boolean> {
  if (!refCode) return false;

  const flowType = await getEntryRouteOnboardingFlow(db, refCode);
  if (!flowType) return false;

  // オンボーディング開始
  await createFriendOnboarding(db, friendId, flowType);

  if (flowType === 'bpo_worker') {
    await lineClient.replyMessage(replyToken, [
      {
        type: 'text',
        text: '友だち登録ありがとうございます！\n\n勤怠管理のため、いくつか確認させてください。\n\nまず、お名前をフルネームで教えてください。\n（例: 山田太郎）',
      },
    ]);
    return true;
  }

  // 他のフロータイプは今後追加
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
): Promise<boolean> {
  const onboarding = await getFriendOnboarding(db, friendId);
  if (!onboarding || onboarding.completed) return false;

  if (onboarding.flow_type === 'bpo_worker') {
    return handleBpoWorkerFlow(db, lineClient, friendId, text, replyToken, onboarding.step);
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

      await updateOnboardingStep(db, friendId, 'ask_birthday', { fullName: trimmed });
      await lineClient.replyMessage(replyToken, [{
        type: 'text',
        text: `${trimmed}さん、ありがとうございます。\n\n次に、生年月日を教えてください。\n（例: 1990-01-15 または 1990/1/15）`,
      }]);
      return true;
    }

    case 'ask_birthday': {
      // 生年月日をパース
      const birthday = parseBirthday(trimmed);
      if (!birthday) {
        await lineClient.replyMessage(replyToken, [{
          type: 'text',
          text: '生年月日の形式が正しくありません。\n以下のいずれかの形式で入力してください。\n\n・1990-01-15\n・1990/1/15\n・19900115\n・平成2年1月15日',
        }]);
        return true;
      }

      await updateOnboardingStep(db, friendId, 'complete', { birthday });

      // 完了メッセージ
      const onboarding = await getFriendOnboarding(db, friendId);
      await lineClient.replyMessage(replyToken, [{
        type: 'flex',
        altText: '登録完了',
        contents: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', paddingAll: '20px',
            contents: [
              { type: 'text', text: '✅ 登録が完了しました', size: 'lg', weight: 'bold', color: '#1e293b' },
              { type: 'separator', margin: 'lg' },
              {
                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
                contents: [
                  {
                    type: 'box', layout: 'horizontal',
                    contents: [
                      { type: 'text', text: 'お名前', size: 'sm', color: '#64748b', flex: 2 },
                      { type: 'text', text: onboarding?.full_name || '-', size: 'sm', color: '#1e293b', flex: 3 },
                    ],
                  },
                  {
                    type: 'box', layout: 'horizontal',
                    contents: [
                      { type: 'text', text: '生年月日', size: 'sm', color: '#64748b', flex: 2 },
                      { type: 'text', text: birthday, size: 'sm', color: '#1e293b', flex: 3 },
                    ],
                  },
                ],
              },
              { type: 'text', text: '勤怠管理の準備ができました。\n下のメニューから出勤・退勤の打刻ができます。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
            ],
          },
        },
      }]);
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
