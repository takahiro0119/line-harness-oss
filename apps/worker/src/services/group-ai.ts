/**
 * グループAIアシスタント
 * CSからの勤怠照会リクエストをClaude API (tool use) で処理
 */

import {
  getClockRecordsByGroup,
  getClockRecordsByMonth,
  getGroupMembers,
  getMonthlyConfirmations,
} from '@line-crm/db';
import type { ClockRecordRow } from '@line-crm/db';

// ── Tool definitions ────────────────────────────────

const TOOLS = [
  {
    name: 'get_member_attendance',
    description: '指定メンバーの指定月の出勤データを取得する。名前で検索し、打刻記録(出勤時刻・退勤時刻・稼働時間)を返す。',
    input_schema: {
      type: 'object' as const,
      properties: {
        member_name: { type: 'string', description: 'メンバーの名前（部分一致で検索）' },
        month: { type: 'string', description: '対象月 (YYYY-MM形式、例: 2026-03)' },
      },
      required: ['member_name', 'month'],
    },
  },
  {
    name: 'get_group_attendance_summary',
    description: '指定日または期間のグループ全体の出勤サマリーを取得する。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '特定日 (YYYY-MM-DD形式)。dateかstart_date/end_dateのどちらかを指定' },
        start_date: { type: 'string', description: '期間開始日 (YYYY-MM-DD形式)' },
        end_date: { type: 'string', description: '期間終了日 (YYYY-MM-DD形式)' },
      },
    },
  },
  {
    name: 'get_monthly_confirmation_status',
    description: '指定月の月次確認ステータス（誰が確認済み/未確認/修正依頼）を取得する。',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: '対象月 (YYYY-MM形式)' },
      },
      required: ['month'],
    },
  },
];

// ── Tool execution ──────────────────────────────────

async function executeTool(
  db: D1Database,
  groupId: string,
  toolName: string,
  input: Record<string, string>,
): Promise<string> {
  switch (toolName) {
    case 'get_member_attendance': {
      const { member_name, month } = input;
      // メンバー検索
      const members = await getGroupMembers(db, groupId);
      const matched = members.filter(m =>
        m.display_name?.includes(member_name)
      );
      if (matched.length === 0) {
        return JSON.stringify({ error: `「${member_name}」に一致するメンバーが見つかりません。登録メンバー: ${members.map(m => m.display_name).filter(Boolean).join(', ')}` });
      }

      const results = [];
      for (const member of matched) {
        const records = await getClockRecordsByMonth(db, groupId, member.line_user_id, month);
        const totalDays = records.filter(r => r.clock_in).length;
        const totalHours = records.reduce((sum, r) => sum + (r.work_hours || 0), 0);
        results.push({
          name: member.display_name,
          month,
          totalDays,
          totalHours: Math.round(totalHours * 100) / 100,
          records: records.map(r => ({
            date: r.target_date,
            clockIn: r.clock_in,
            clockOut: r.clock_out,
            workHours: r.work_hours,
          })),
        });
      }
      return JSON.stringify(results);
    }

    case 'get_group_attendance_summary': {
      const { date, start_date, end_date } = input;
      const records = await getClockRecordsByGroup(
        db, groupId,
        date || undefined,
        start_date || undefined,
        end_date || undefined,
      );

      // 日付ごとに集計
      const byDate = new Map<string, { total: number; clockedIn: number; clockedOut: number; totalHours: number }>();
      for (const r of records) {
        const entry = byDate.get(r.target_date) || { total: 0, clockedIn: 0, clockedOut: 0, totalHours: 0 };
        entry.total++;
        if (r.clock_in) entry.clockedIn++;
        if (r.clock_out) entry.clockedOut++;
        if (r.work_hours) entry.totalHours += r.work_hours;
        byDate.set(r.target_date, entry);
      }

      const summary = [...byDate.entries()].map(([d, v]) => ({
        date: d,
        ...v,
        totalHours: Math.round(v.totalHours * 100) / 100,
      }));

      return JSON.stringify({ summary, totalRecords: records.length });
    }

    case 'get_monthly_confirmation_status': {
      const { month } = input;
      const confirmations = await getMonthlyConfirmations(db, groupId, month);
      return JSON.stringify(confirmations.map(c => ({
        name: c.display_name,
        status: c.status,
        totalDays: c.total_days,
        totalHours: c.total_hours,
        confirmedAt: c.confirmed_at,
        revisionNote: c.revision_note,
      })));
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ── Main handler ────────────────────────────────────

export async function handleGroupAIMessage(
  db: D1Database,
  groupId: string,
  message: string,
  apiKey: string,
): Promise<string | null> {
  const now = new Date(Date.now() + 9 * 60 * 60_000);
  const todayStr = now.toISOString().slice(0, 10);
  const currentMonth = now.toISOString().slice(0, 7);

  const systemPrompt = `あなたはLINEグループの勤怠管理アシスタントです。
CSスタッフからの勤怠に関する質問に答えます。

今日の日付: ${todayStr}
今月: ${currentMonth}

ツールを使ってデータベースから勤怠データを取得し、わかりやすく回答してください。
回答はLINEメッセージとして送られるため、簡潔にまとめてください。
表形式が見やすい場合は等幅テキストで整形してください。`;

  // First API call
  let response = await callClaude(apiKey, systemPrompt, message, TOOLS);
  if (!response) return null;

  // Tool use loop (max 3 iterations)
  let toolMessages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: message },
    { role: 'assistant', content: response.content },
  ];

  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < 3) {
    iterations++;
    const toolResults = [];

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = await executeTool(db, groupId, block.name, block.input as Record<string, string>);
        toolResults.push({
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    // Continue conversation with tool results
    toolMessages.push({ role: 'user', content: toolResults });

    response = await callClaudeWithHistory(apiKey, systemPrompt, toolMessages, TOOLS);
    if (!response) return null;

    toolMessages.push({ role: 'assistant', content: response.content });
  }

  // Extract text response
  const textBlocks = response.content.filter((b: { type: string }) => b.type === 'text');
  if (textBlocks.length === 0) return null;

  return textBlocks.map((b: { text: string }) => b.text).join('\n');
}

// ── Claude API calls ────────────────────────────────

interface ClaudeResponse {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason: string;
}

async function callClaude(
  apiKey: string,
  system: string,
  userMessage: string,
  tools: typeof TOOLS,
): Promise<ClaudeResponse | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system,
        tools,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      console.error('Claude API error:', res.status, await res.text());
      return null;
    }

    return await res.json() as ClaudeResponse;
  } catch (err) {
    console.error('Claude API call failed:', err);
    return null;
  }
}

async function callClaudeWithHistory(
  apiKey: string,
  system: string,
  messages: Array<{ role: string; content: unknown }>,
  tools: typeof TOOLS,
): Promise<ClaudeResponse | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system,
        tools,
        messages,
      }),
    });

    if (!res.ok) {
      console.error('Claude API error:', res.status, await res.text());
      return null;
    }

    return await res.json() as ClaudeResponse;
  } catch (err) {
    console.error('Claude API call failed:', err);
    return null;
  }
}
