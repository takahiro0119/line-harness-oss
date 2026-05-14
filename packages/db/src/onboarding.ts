/**
 * オンボーディングフロー DB層
 * 流入経路に応じた登録時ヒアリング
 */

export interface FriendOnboardingRow {
  id: string;
  friend_id: string;
  flow_type: string;
  step: string;
  full_name: string | null;
  birthday: string | null;
  phone: string | null;
  kintone_id: string | null;
  extra: string;
  completed: number;
  created_at: string;
  updated_at: string;
}

export async function getFriendOnboarding(db: D1Database, friendId: string): Promise<FriendOnboardingRow | null> {
  return db.prepare('SELECT * FROM friend_onboarding WHERE friend_id = ?').bind(friendId).first<FriendOnboardingRow>();
}

export async function createFriendOnboarding(db: D1Database, friendId: string, flowType: string): Promise<void> {
  await db.prepare(
    `INSERT INTO friend_onboarding (friend_id, flow_type, step) VALUES (?, ?, 'ask_name')
     ON CONFLICT(friend_id) DO UPDATE SET flow_type = excluded.flow_type, step = 'ask_name', completed = 0, updated_at = datetime('now')`
  ).bind(friendId, flowType).run();
}

export async function updateOnboardingStep(
  db: D1Database,
  friendId: string,
  step: string,
  data?: { fullName?: string; birthday?: string; phone?: string; kintoneId?: string }
): Promise<void> {
  const fields = ["step = ?", "updated_at = datetime('now')"];
  const values: unknown[] = [step];
  if (data?.fullName !== undefined) { fields.push('full_name = ?'); values.push(data.fullName); }
  if (data?.birthday !== undefined) { fields.push('birthday = ?'); values.push(data.birthday); }
  if (data?.phone !== undefined) { fields.push('phone = ?'); values.push(data.phone); }
  if (data?.kintoneId !== undefined) { fields.push('kintone_id = ?'); values.push(data.kintoneId); }
  if (step === 'complete') { fields.push('completed = 1'); }
  values.push(friendId);
  await db.prepare(`UPDATE friend_onboarding SET ${fields.join(', ')} WHERE friend_id = ?`).bind(...values).run();
}

export async function getEntryRouteOnboardingFlow(db: D1Database, refCode: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT onboarding_flow FROM entry_routes WHERE ref_code = ? AND is_active = 1'
  ).bind(refCode).first<{ onboarding_flow: string | null }>();
  return row?.onboarding_flow ?? null;
}
