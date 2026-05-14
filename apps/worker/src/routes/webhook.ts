import { Hono } from 'hono';
import { verifySignature, LineClient } from '@line-crm/line-sdk';
import type { WebhookRequestBody, WebhookEvent, TextEventMessage } from '@line-crm/line-sdk';
import {
  upsertFriend,
  updateFriendFollowStatus,
  getFriendByLineUserId,
  getScenarios,
  enrollFriendInScenario,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  upsertChatOnMessage,
  getLineAccounts,
  jstNow,
  upsertGroup,
  upsertGroupMember,
  removeGroupMember,
  logGroupMessage,
  getGroupByLineGroupId,
  getAttendanceSchedules,
  getGroupMembers,
  upsertAttendanceRecord,
  parseAttendanceReply,
  // グループ勤怠（レガシー）
  getAttendanceSettings,
  upsertClockIn,
  upsertClockOut,
  getPendingReminder,
  resolveClockReminder,
  parseTimeText,
  calcMonthlySummary,
  confirmMonthly,
  requestMonthlyRevision,
  getClockRecord,
  getClockRecordsByMonth,
  upsertMonthlyConfirmation,
  // 1:1勤怠
  getAttendanceConfig,
  getFriendClockRecord,
  upsertFriendClockIn,
  upsertFriendClockOut,
  getFriendPendingReminder,
  resolveFriendClockReminder,
  calcFriendMonthlySummary,
  upsertFriendMonthlyConfirmation,
  confirmFriendMonthly,
  requestFriendMonthlyRevision,
  getFriendShift,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { buildMessage, expandVariables } from '../services/step-delivery.js';
import { handleGroupAIMessage } from '../services/group-ai.js';
import type { Env } from '../index.js';

const webhook = new Hono<Env>();

webhook.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  // Multi-account: resolve credentials from DB by destination (channel user ID)
  // or fall back to environment variables (default account)
  let channelSecret = c.env.LINE_CHANNEL_SECRET;
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;

  if ((body as { destination?: string }).destination) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelSecret = account.channel_secret;
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        break;
      }
    }
  }

  // Verify with resolved secret
  const valid = await verifySignature(channelSecret, rawBody, signature);
  if (!valid) {
    console.error('Invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = (async () => {
    for (const event of body.events) {
      try {
        await handleEvent(db, lineClient, event, channelAccessToken, matchedAccountId, c.env.WORKER_URL || new URL(c.req.url).origin, c.env.ANTHROPIC_API_KEY);
      } catch (err) {
        console.error('Error handling webhook event:', err);
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
});

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  anthropicApiKey?: string,
): Promise<void> {
  if (event.type === 'follow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    // プロフィール取得 & 友だち登録/更新
    let profile;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      console.error('Failed to get profile for', userId, err);
    }

    const friend = await upsertFriend(db, {
      lineUserId: userId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });

    // Set line_account_id for multi-account tracking
    if (lineAccountId) {
      await db.prepare('UPDATE friends SET line_account_id = ? WHERE id = ? AND line_account_id IS NULL')
        .bind(lineAccountId, friend.id).run();
    }

    // friend_add シナリオに登録（このアカウントのシナリオのみ）
    const scenarios = await getScenarios(db);
    for (const scenario of scenarios) {
      // Only trigger scenarios belonging to this account (or unassigned for backward compat)
      const scenarioAccountMatch = !scenario.line_account_id || !lineAccountId || scenario.line_account_id === lineAccountId;
      if (scenario.trigger_type === 'friend_add' && scenario.is_active && scenarioAccountMatch) {
        try {
          const existing = await db
            .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
            .bind(friend.id, scenario.id)
            .first<{ id: string }>();
          if (!existing) {
            const friendScenario = await enrollFriendInScenario(db, friend.id, scenario.id);

            // Immediate delivery: if the first step has delay=0, send it now via replyMessage (free)
            const steps = await getScenarioSteps(db, scenario.id);
            const firstStep = steps[0];
            if (firstStep && firstStep.delay_minutes === 0 && friendScenario.status === 'active') {
              try {
                const expandedContent = expandVariables(firstStep.message_content, friend as { id: string; display_name: string | null; user_id: string | null });
                const message = buildMessage(firstStep.message_type, expandedContent);
                await lineClient.replyMessage(event.replyToken, [message]);
                console.log(`Immediate delivery: sent step ${firstStep.id} to ${userId}`);

                // Log outgoing message (replyMessage = 無料)
                const logId = crypto.randomUUID();
                await db
                  .prepare(
                    `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
                     VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'reply', ?)`,
                  )
                  .bind(logId, friend.id, firstStep.message_type, firstStep.message_content, firstStep.id, jstNow())
                  .run();

                // Advance or complete the friend_scenario
                const secondStep = steps[1] ?? null;
                if (secondStep) {
                  const nextDeliveryDate = new Date(Date.now() + 9 * 60 * 60_000);
                  nextDeliveryDate.setMinutes(nextDeliveryDate.getMinutes() + secondStep.delay_minutes);
                  // Enforce 9:00-21:00 JST delivery window
                  const h = nextDeliveryDate.getUTCHours();
                  if (h < 9 || h >= 21) {
                    if (h >= 21) nextDeliveryDate.setUTCDate(nextDeliveryDate.getUTCDate() + 1);
                    nextDeliveryDate.setUTCHours(9, 0, 0, 0);
                  }
                  await advanceFriendScenario(db, friendScenario.id, firstStep.step_order, nextDeliveryDate.toISOString().slice(0, -1) + '+09:00');
                } else {
                  await completeFriendScenario(db, friendScenario.id);
                }
              } catch (err) {
                console.error('Failed immediate delivery for scenario', scenario.id, err);
              }
            }
          }
        } catch (err) {
          console.error('Failed to enroll friend in scenario', scenario.id, err);
        }
      }
    }

    // イベントバス発火: friend_add
    await fireEvent(db, 'friend_add', { friendId: friend.id, eventData: { displayName: friend.display_name } }, lineAccessToken, lineAccountId);
    return;
  }

  if (event.type === 'unfollow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    await updateFriendFollowStatus(db, userId, false);
    return;
  }

  if (event.type === 'message' && event.message.type === 'text' && event.source.type === 'user') {
    const textMessage = event.message as TextEventMessage;
    const userId = event.source.userId;
    if (!userId) return;

    const friend = await getFriendByLineUserId(db, userId);
    if (!friend) return;

    const incomingText = textMessage.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // 受信メッセージをログに記録
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, ?)`,
      )
      .bind(logId, friend.id, incomingText, now)
      .run();

    // ─── 1:1 勤怠リマインド応答チェック ─────────────────────────────
    const attendanceConfig = await getAttendanceConfig(db, lineAccountId);
    if (attendanceConfig?.is_enabled) {
      const pendingReminder = await getFriendPendingReminder(db, friend.id);
      if (pendingReminder) {
        const parsedTime = parseTimeText(incomingText);
        if (parsedTime) {
          if (pendingReminder.reminder_type === 'clock_in') {
            await upsertFriendClockIn(db, friend.id, userId, friend.display_name, pendingReminder.target_date, parsedTime, 'reminder');
            await lineClient.replyMessage(event.replyToken, [{
              type: 'text', text: `出勤を${parsedTime}で記録しました`,
            }]);
          } else {
            await upsertFriendClockOut(db, friend.id, userId, friend.display_name, pendingReminder.target_date, parsedTime, 'reminder');
            const record = await getFriendClockRecord(db, friend.id, pendingReminder.target_date);
            const hoursText = record?.work_hours ? `（稼働: ${record.work_hours}時間）` : '';
            await lineClient.replyMessage(event.replyToken, [{
              type: 'text', text: `退勤を${parsedTime}で記録しました${hoursText}`,
            }]);
          }
          await resolveFriendClockReminder(db, pendingReminder.id);
          return;
        }
      }
    }

    // チャットを作成/更新（ユーザーの自発的メッセージのみ unread にする）
    // ボタンタップ等の自動応答キーワードは除外
    const autoKeywords = ['料金', '機能', 'API', 'フォーム', 'ヘルプ', 'UUID', 'UUID連携について教えて', 'UUID連携を確認', '配信時間', '導入支援を希望します', 'アカウント連携を見る', '体験を完了する', 'BAN対策を見る', '連携確認', '出勤します', '退勤します'];
    const isAutoKeyword = autoKeywords.some(k => incomingText === k);
    const isTimeCommand = /(?:配信時間|配信|届けて|通知)[はを]?\s*\d{1,2}\s*時/.test(incomingText);
    if (!isAutoKeyword && !isTimeCommand) {
      await upsertChatOnMessage(db, friend.id);
    }

    // 配信時間設定: 「配信時間は○時」「○時に届けて」等のパターンを検出
    const timeMatch = incomingText.match(/(?:配信時間|配信|届けて|通知)[はを]?\s*(\d{1,2})\s*時/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      if (hour >= 6 && hour <= 22) {
        // Save preferred_hour to friend metadata
        const existing = await db.prepare('SELECT metadata FROM friends WHERE id = ?').bind(friend.id).first<{ metadata: string }>();
        const meta = JSON.parse(existing?.metadata || '{}');
        meta.preferred_hour = hour;
        await db.prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
          .bind(JSON.stringify(meta), jstNow(), friend.id).run();

        // Reply with confirmation
        try {
          const period = hour < 12 ? '午前' : '午後';
          const displayHour = hour <= 12 ? hour : hour - 12;
          await lineClient.replyMessage(event.replyToken, [
            buildMessage('flex', JSON.stringify({
              type: 'bubble',
              body: { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '配信時間を設定しました', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: `${period} ${displayHour}:00`, size: 'xxl', weight: 'bold', color: '#f59e0b', align: 'center' },
                  { type: 'text', text: `（${hour}:00〜）`, size: 'sm', color: '#64748b', align: 'center', margin: 'sm' },
                ], backgroundColor: '#fffbeb', cornerRadius: 'md', paddingAll: '20px', margin: 'lg' },
                { type: 'text', text: '今後のステップ配信はこの時間以降にお届けします。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
              ], paddingAll: '20px' },
            })),
          ]);
        } catch (err) {
          console.error('Failed to reply for time setting', err);
        }
        return;
      }
    }

    // Cross-account trigger: send message from another account via UUID
    if (incomingText === '体験を完了する' && lineAccountId) {
      try {
        const friendRecord = await db.prepare('SELECT user_id FROM friends WHERE id = ?').bind(friend.id).first<{ user_id: string | null }>();
        if (friendRecord?.user_id) {
          // Find the same user on other accounts
          const otherFriends = await db.prepare(
            'SELECT f.line_user_id, la.channel_access_token FROM friends f INNER JOIN line_accounts la ON la.id = f.line_account_id WHERE f.user_id = ? AND f.line_account_id != ? AND f.is_following = 1'
          ).bind(friendRecord.user_id, lineAccountId).all<{ line_user_id: string; channel_access_token: string }>();

          for (const other of otherFriends.results) {
            const otherClient = new LineClient(other.channel_access_token);
            const { buildMessage: bm } = await import('../services/step-delivery.js');
            await otherClient.pushMessage(other.line_user_id, [bm('flex', JSON.stringify({
              type: 'bubble', size: 'giga',
              header: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#fffbeb',
                contents: [{ type: 'text', text: `${friend.display_name || ''}さんへ`, size: 'lg', weight: 'bold', color: '#1e293b' }],
              },
              body: { type: 'box', layout: 'vertical', paddingAll: '20px',
                contents: [
                  { type: 'text', text: '別アカウントからのアクションを検知しました。', size: 'sm', color: '#06C755', weight: 'bold', wrap: true },
                  { type: 'text', text: 'アカウント連携が正常に動作しています。体験ありがとうございました。', size: 'sm', color: '#1e293b', wrap: true, margin: 'md' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'text', text: 'ステップ配信・フォーム即返信・アカウント連携・リッチメニュー・自動返信 — 全て無料、全てOSS。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
                ],
              },
              footer: { type: 'box', layout: 'vertical', paddingAll: '16px',
                contents: [
                  { type: 'button', action: { type: 'message', label: '導入について相談する', text: '導入支援を希望します' }, style: 'primary', color: '#06C755' },
                  { type: 'button', action: { type: 'uri', label: 'フィードバックを送る', uri: 'https://liff.line.me/2009554425-4IMBmLQ9?page=form&id=0c81910a-fe27-41a7-bf8c-1411a9240155' }, style: 'secondary', margin: 'sm' },
                ],
              },
            }))]);
          }

          // Reply on Account ② confirming
          await lineClient.replyMessage(event.replyToken, [buildMessage('flex', JSON.stringify({
            type: 'bubble',
            body: { type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: 'Account ① にメッセージを送りました', size: 'sm', color: '#06C755', weight: 'bold', align: 'center' },
                { type: 'text', text: 'Account ① のトーク画面を確認してください', size: 'xs', color: '#64748b', align: 'center', margin: 'md' },
              ],
            },
          }))]);
          return;
        }
      } catch (err) {
        console.error('Cross-account trigger error:', err);
      }
    }

    // 自動返信チェック（このアカウントのルール + グローバルルールのみ）
    // NOTE: Auto-replies use replyMessage (free, no quota) instead of pushMessage
    // The replyToken is only valid for ~1 minute after the message event
    const autoReplies = await db
      .prepare(`SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL${lineAccountId ? ` OR line_account_id = '${lineAccountId}'` : ''}) ORDER BY created_at ASC`)
      .all<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains';
        response_type: string;
        response_content: string;
        is_active: number;
        created_at: string;
      }>();

    let matched = false;
    for (const rule of autoReplies.results) {
      const isMatch =
        rule.match_type === 'exact'
          ? incomingText === rule.keyword
          : incomingText.includes(rule.keyword);

      if (isMatch) {
        try {
          // Expand template variables ({{name}}, {{uid}}, {{auth_url:CHANNEL_ID}})
          const expandedContent = expandVariables(rule.response_content, friend as { id: string; display_name: string | null; user_id: string | null }, workerUrl);
          const replyMsg = buildMessage(rule.response_type, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);

          // 送信ログ（replyMessage = 無料）
          const outLogId = crypto.randomUUID();
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', ?)`,
            )
            .bind(outLogId, friend.id, rule.response_type, rule.response_content, jstNow())
            .run();
        } catch (err) {
          console.error('Failed to send auto-reply', err);
        }

        matched = true;
        break;
      }
    }

    // イベントバス発火: message_received
    await fireEvent(db, 'message_received', {
      friendId: friend.id,
      eventData: { text: incomingText, matched },
    }, lineAccessToken, lineAccountId);

    return;
  }

  // ─── グループ参加イベント ─────────────────────────────────────────────────
  if (event.type === 'join' && event.source.type === 'group') {
    const groupId = event.source.groupId;
    console.log(`Bot joined group: ${groupId}`);

    // グループ情報取得 & DB登録
    let groupName: string | null = null;
    try {
      const summary = await lineClient.getGroupSummary(groupId);
      groupName = summary.groupName;
    } catch (err) {
      console.error('Failed to get group summary:', err);
    }

    await upsertGroup(db, {
      lineGroupId: groupId,
      name: groupName,
      lineAccountId,
    });

    // メンバー一覧取得 & 登録
    try {
      const group = await getGroupByLineGroupId(db, groupId);
      if (group) {
        const memberResult = await lineClient.getGroupMemberIds(groupId);
        for (const memberId of memberResult.memberIds) {
          let memberName: string | null = null;
          try {
            const profile = await lineClient.getGroupMemberProfile(groupId, memberId);
            memberName = profile.displayName;
          } catch { /* some members may not be fetchable */ }
          await upsertGroupMember(db, {
            groupId: group.id,
            lineUserId: memberId,
            displayName: memberName,
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch group members:', err);
    }

    return;
  }

  // ─── グループ退出イベント ─────────────────────────────────────────────────
  if (event.type === 'leave' && event.source.type === 'group') {
    const groupId = event.source.groupId;
    console.log(`Bot left group: ${groupId}`);
    const group = await getGroupByLineGroupId(db, groupId);
    if (group) {
      await db.prepare('UPDATE groups SET is_active = 0, updated_at = ? WHERE id = ?')
        .bind(jstNow(), group.id).run();
    }
    return;
  }

  // ─── メンバー参加イベント ─────────────────────────────────────────────────
  if (event.type === 'memberJoined' && event.source.type === 'group') {
    const groupId = event.source.groupId;
    const group = await getGroupByLineGroupId(db, groupId);
    if (!group) return;

    for (const member of event.joined.members) {
      let memberName: string | null = null;
      try {
        const profile = await lineClient.getGroupMemberProfile(groupId, member.userId);
        memberName = profile.displayName;
      } catch { /* ignore */ }
      await upsertGroupMember(db, {
        groupId: group.id,
        lineUserId: member.userId,
        displayName: memberName,
      });
    }
    return;
  }

  // ─── メンバー退出イベント ─────────────────────────────────────────────────
  if (event.type === 'memberLeft' && event.source.type === 'group') {
    const groupId = event.source.groupId;
    const group = await getGroupByLineGroupId(db, groupId);
    if (!group) return;

    for (const member of event.left.members) {
      await removeGroupMember(db, group.id, member.userId);
    }
    return;
  }

  // ─── Postback イベント（勤怠打刻ボタン・月次確認） ─────────────────────────
  if (event.type === 'postback') {
    const userId = event.source.type === 'user' ? event.source.userId
      : event.source.type === 'group' ? event.source.userId
      : undefined;
    if (!userId) return;

    const data = new URLSearchParams(event.postback.data);
    const action = data.get('action');

    // グループ内のpostback
    if (event.source.type === 'group') {
      const lineGroupId = event.source.groupId;
      const group = await getGroupByLineGroupId(db, lineGroupId);
      if (!group) return;

      // メンバー名取得
      let displayName: string | null = null;
      try {
        const profile = await lineClient.getGroupMemberProfile(lineGroupId, userId);
        displayName = profile.displayName;
      } catch { /* ignore */ }

      if (action === 'clock_in') {
        const date = data.get('date');
        if (!date) return;
        const now = new Date(Date.now() + 9 * 60 * 60_000);
        const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
        await upsertClockIn(db, group.id, userId, displayName, date, currentTime, 'button');
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `${displayName || ''}さんの出勤を記録しました（${currentTime}）`,
        }]);
        return;
      }

      if (action === 'clock_out') {
        const date = data.get('date');
        if (!date) return;
        const now = new Date(Date.now() + 9 * 60 * 60_000);
        const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
        await upsertClockOut(db, group.id, userId, displayName, date, currentTime, 'button');
        const record = await getClockRecord(db, group.id, userId, date);
        const hoursText = record?.work_hours ? `（稼働: ${record.work_hours}時間）` : '';
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `${displayName || ''}さんの退勤を記録しました（${currentTime}）${hoursText}`,
        }]);
        return;
      }

      if (action === 'monthly_confirm') {
        const month = data.get('month');
        if (!month) return;
        // 個人のサマリーを計算して確認
        const summary = await calcMonthlySummary(db, group.id, userId, month);
        await upsertMonthlyConfirmation(db, group.id, userId, displayName, month, summary.totalDays, summary.totalHours);
        await confirmMonthly(db, group.id, userId, month);
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `${displayName || ''}さんの${month}の稼働（${summary.totalDays}日 / ${summary.totalHours}時間）を確認しました。ありがとうございます！`,
        }]);
        return;
      }

      if (action === 'monthly_revision') {
        const month = data.get('month');
        if (!month) return;
        await requestMonthlyRevision(db, group.id, userId, month);
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `${displayName || ''}さんの修正依頼を受け付けました。担当者より連絡いたします。`,
        }]);
        return;
      }
    }

    // ─── 1:1チャットのpostback（勤怠打刻） ────────────────────────────
    if (event.source.type === 'user') {
      const friend = await getFriendByLineUserId(db, userId);
      if (!friend) return;

      const now = new Date(Date.now() + 9 * 60 * 60_000);
      const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

      if (action === 'clock_in') {
        const date = data.get('date') || now.toISOString().slice(0, 10);
        await upsertFriendClockIn(db, friend.id, userId, friend.display_name, date, currentTime, 'button');
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `出勤を記録しました（${currentTime}）`,
        }]);
        return;
      }

      if (action === 'clock_out') {
        const date = data.get('date') || now.toISOString().slice(0, 10);
        await upsertFriendClockOut(db, friend.id, userId, friend.display_name, date, currentTime, 'button');
        const record = await getFriendClockRecord(db, friend.id, date);
        const hoursText = record?.work_hours ? `（稼働: ${record.work_hours}時間）` : '';
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `退勤を記録しました（${currentTime}）${hoursText}`,
        }]);
        return;
      }

      if (action === 'monthly_confirm') {
        const month = data.get('month');
        if (!month) return;
        const summary = await calcFriendMonthlySummary(db, friend.id, month);
        await upsertFriendMonthlyConfirmation(db, friend.id, friend.display_name, month, summary.totalDays, summary.totalHours);
        await confirmFriendMonthly(db, friend.id, month);
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `${month}の稼働（${summary.totalDays}日 / ${summary.totalHours}時間）を確認しました。ありがとうございます！`,
        }]);
        return;
      }

      if (action === 'monthly_revision') {
        const month = data.get('month');
        if (!month) return;
        await requestFriendMonthlyRevision(db, friend.id, month);
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `修正依頼を受け付けました。担当者より連絡いたします。`,
        }]);
        return;
      }

      // リッチメニューからの打刻
      if (action === 'richmenu_clock_in') {
        const date = now.toISOString().slice(0, 10);
        await upsertFriendClockIn(db, friend.id, userId, friend.display_name, date, currentTime, 'richmenu');
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `出勤を記録しました（${currentTime}）`,
        }]);
        return;
      }

      if (action === 'richmenu_clock_out') {
        const date = now.toISOString().slice(0, 10);
        await upsertFriendClockOut(db, friend.id, userId, friend.display_name, date, currentTime, 'richmenu');
        const record = await getFriendClockRecord(db, friend.id, date);
        const hoursText = record?.work_hours ? `（稼働: ${record.work_hours}時間）` : '';
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: `退勤を記録しました（${currentTime}）${hoursText}`,
        }]);
        return;
      }

      if (action === 'richmenu_check_hours') {
        const currentMonth = now.toISOString().slice(0, 7);
        const summary = await calcFriendMonthlySummary(db, friend.id, currentMonth);
        const { getFriendClockRecords } = await import('@line-crm/db');
        const records = await getFriendClockRecords(db, {
          friendId: friend.id,
          startDate: currentMonth + '-01',
          endDate: now.toISOString().slice(0, 10),
        });

        // 直近の打刻一覧（最大10件）
        const recentRecords = records.slice(0, 10);
        const recordLines = recentRecords.map(r => {
          const clockIn = r.clock_in || '--:--';
          const clockOut = r.clock_out || '--:--';
          const hours = r.work_hours != null ? `${r.work_hours}h` : '-';
          return { date: r.target_date.slice(5), clockIn, clockOut, hours };
        });

        const flexMessage = {
          type: 'flex' as const,
          altText: `${currentMonth} 稼働状況`,
          contents: {
            type: 'bubble',
            body: {
              type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: '📊 今月の稼働状況', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'text', text: currentMonth, size: 'sm', color: '#64748b', margin: 'sm' },
                { type: 'separator', margin: 'lg' },
                {
                  type: 'box', layout: 'horizontal', margin: 'lg', paddingAll: '12px', backgroundColor: '#f0fdf4', cornerRadius: 'md',
                  contents: [
                    { type: 'box', layout: 'vertical', flex: 1, contents: [
                      { type: 'text', text: '稼働日数', size: 'xs', color: '#64748b', align: 'center' },
                      { type: 'text', text: `${summary.totalDays}日`, size: 'xl', weight: 'bold', color: '#1e293b', align: 'center', margin: 'sm' },
                    ]},
                    { type: 'separator' },
                    { type: 'box', layout: 'vertical', flex: 1, contents: [
                      { type: 'text', text: '合計時間', size: 'xs', color: '#64748b', align: 'center' },
                      { type: 'text', text: `${summary.totalHours}h`, size: 'xl', weight: 'bold', color: '#1e293b', align: 'center', margin: 'sm' },
                    ]},
                  ],
                },
                // 打刻一覧ヘッダー
                ...(recordLines.length > 0 ? [
                  { type: 'text', text: '直近の打刻', size: 'sm', weight: 'bold', color: '#475569', margin: 'lg' },
                  {
                    type: 'box', layout: 'horizontal', margin: 'sm', paddingBottom: '4px',
                    contents: [
                      { type: 'text', text: '日付', size: 'xxs', color: '#94a3b8', flex: 2 },
                      { type: 'text', text: '出勤', size: 'xxs', color: '#94a3b8', flex: 2, align: 'center' },
                      { type: 'text', text: '退勤', size: 'xxs', color: '#94a3b8', flex: 2, align: 'center' },
                      { type: 'text', text: '時間', size: 'xxs', color: '#94a3b8', flex: 1, align: 'end' },
                    ],
                  },
                  ...recordLines.map(r => ({
                    type: 'box', layout: 'horizontal', paddingTop: '4px', paddingBottom: '4px',
                    contents: [
                      { type: 'text', text: r.date, size: 'xs', color: '#1e293b', flex: 2 },
                      { type: 'text', text: r.clockIn, size: 'xs', color: '#475569', flex: 2, align: 'center' },
                      { type: 'text', text: r.clockOut, size: 'xs', color: '#475569', flex: 2, align: 'center' },
                      { type: 'text', text: r.hours, size: 'xs', color: '#1e293b', weight: 'bold', flex: 1, align: 'end' },
                    ],
                  })),
                ] : [
                  { type: 'text', text: '今月の打刻記録はまだありません', size: 'sm', color: '#94a3b8', margin: 'lg', align: 'center' },
                ]),
              ],
            },
          },
        };

        await lineClient.replyMessage(event.replyToken, [flexMessage]);
        return;
      }
    }

    return;
  }

  // ─── グループ内メッセージ ─────────────────────────────────────────────────
  if (event.type === 'message' && event.message.type === 'text' && event.source.type === 'group') {
    const groupId = event.source.groupId;
    const userId = event.source.userId;
    if (!userId) return;

    const group = await getGroupByLineGroupId(db, groupId);
    if (!group) return;

    const textMessage = event.message as TextEventMessage;
    const incomingText = textMessage.text;

    // メンバープロフィール取得 & 更新
    let memberProfile: { displayName: string; pictureUrl?: string } | null = null;
    try {
      const profile = await lineClient.getGroupMemberProfile(groupId, userId);
      memberProfile = profile;
      await upsertGroupMember(db, {
        groupId: group.id,
        lineUserId: userId,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl ?? null,
      });
    } catch { /* ignore — profile fetch can fail */ }

    // メッセージログ記録
    await logGroupMessage(db, {
      groupId: group.id,
      lineUserId: userId,
      direction: 'incoming',
      messageType: 'text',
      content: incomingText,
    });

    // ─── 勤怠リマインド応答チェック（会話形式の時刻パース） ──────────────
    const attendanceSettings = await getAttendanceSettings(db, group.id);
    if (attendanceSettings?.is_enabled) {
      const pendingReminder = await getPendingReminder(db, group.id, userId);
      if (pendingReminder) {
        const parsedTime = parseTimeText(incomingText);
        if (parsedTime) {
          const displayName = memberProfile?.displayName ?? null;
          if (pendingReminder.reminder_type === 'clock_in') {
            await upsertClockIn(db, group.id, userId, displayName, pendingReminder.target_date, parsedTime, 'reminder');
            await lineClient.replyMessage(event.replyToken, [{
              type: 'text',
              text: `${displayName || ''}さんの出勤を${parsedTime}で記録しました`,
            }]);
          } else {
            await upsertClockOut(db, group.id, userId, displayName, pendingReminder.target_date, parsedTime, 'reminder');
            const record = await getClockRecord(db, group.id, userId, pendingReminder.target_date);
            const hoursText = record?.work_hours ? `（稼働: ${record.work_hours}時間）` : '';
            await lineClient.replyMessage(event.replyToken, [{
              type: 'text',
              text: `${displayName || ''}さんの退勤を${parsedTime}で記録しました${hoursText}`,
            }]);
          }
          await resolveClockReminder(db, pendingReminder.id);
          return;
        }
      }
    }

    // 勤怠回答チェック: このグループにアクティブなスケジュールがあるか（既存の出欠確認）
    const schedules = await getAttendanceSchedules(db, group.id);
    const activeSchedules = schedules.filter(s => s.is_active);

    if (activeSchedules.length > 0) {
      const status = parseAttendanceReply(incomingText);
      if (status !== 'other' || /^(出勤|休み|欠勤|遅刻|出社|お休み)/.test(incomingText.trim())) {
        // 今日の日付 (JST)
        const now = new Date(Date.now() + 9 * 60 * 60_000);
        const targetDate = now.toISOString().slice(0, 10);

        // メンバーの表示名取得
        const displayName = memberProfile?.displayName ?? null;

        // 最初のアクティブスケジュールに対して記録
        const schedule = activeSchedules[0];
        await upsertAttendanceRecord(db, {
          scheduleId: schedule.id,
          groupId: group.id,
          lineUserId: userId,
          displayName,
          targetDate,
          status,
          rawReply: incomingText,
        });

        // メンバー情報も更新
        if (displayName) {
          await upsertGroupMember(db, {
            groupId: group.id,
            lineUserId: userId,
            displayName,
          });
        }
        return;
      }
    }

    // ─── AI勤怠アシスタント（勤怠照会等） ──────────────────────────────
    if (anthropicApiKey && attendanceSettings?.is_enabled) {
      // 勤怠関連のキーワードを含むメッセージのみAIに渡す
      const attendanceKeywords = ['出勤', '退勤', '勤怠', '稼働', '打刻', '月次', '確認', 'データ', '一覧', '時間', '何日', '何時間'];
      const isAttendanceQuery = attendanceKeywords.some(k => incomingText.includes(k));

      if (isAttendanceQuery) {
        try {
          const aiResponse = await handleGroupAIMessage(db, group.id, incomingText, anthropicApiKey);
          if (aiResponse) {
            await lineClient.pushMessage(groupId, [{ type: 'text', text: aiResponse }]);
          }
        } catch (err) {
          console.error('Group AI error:', err);
        }
      }
    }

    return;
  }
}

export { webhook };
