import { Hono } from 'hono';
import {
  getEntryRoutes,
  createEntryRoute,
  updateEntryRoute,
  deleteEntryRoute,
} from '@line-crm/db';
import type { EntryRoute } from '@line-crm/db';
import type { Env } from '../index.js';

const entryRoutes = new Hono<Env>();

function serialize(row: EntryRoute) {
  return {
    id: row.id,
    refCode: row.ref_code,
    name: row.name,
    tagId: row.tag_id,
    scenarioId: row.scenario_id,
    redirectUrl: row.redirect_url,
    onboardingFlow: row.onboarding_flow,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/entry-routes
entryRoutes.get('/api/entry-routes', async (c) => {
  try {
    const rows = await getEntryRoutes(c.env.DB);
    return c.json({ success: true, data: rows.map(serialize) });
  } catch (err) {
    console.error('GET /api/entry-routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 紛らわしい文字 (0/O, 1/l/I) を除いた8桁ランダム
function generateRefCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

// POST /api/entry-routes
entryRoutes.post('/api/entry-routes', async (c) => {
  try {
    const body = await c.req.json<{
      refCode?: string;
      name: string;
      tagId?: string | null;
      scenarioId?: string | null;
      redirectUrl?: string | null;
      onboardingFlow?: string | null;
      isActive?: boolean;
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    // refCode が指定されていれば検証、なければ自動生成（衝突時は再試行）
    const provided = body.refCode?.trim();
    if (provided && !/^[a-zA-Z0-9_-]+$/.test(provided)) {
      return c.json({ success: false, error: 'refCode must be alphanumeric (with _ or -)' }, 400);
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const refCode = provided || generateRefCode();
      try {
        const route = await createEntryRoute(c.env.DB, {
          refCode,
          name: body.name,
          tagId: body.tagId ?? null,
          scenarioId: body.scenarioId ?? null,
          redirectUrl: body.redirectUrl ?? null,
          onboardingFlow: body.onboardingFlow ?? null,
          isActive: body.isActive,
        });
        return c.json({ success: true, data: serialize(route) }, 201);
      } catch (err) {
        lastErr = err;
        // 自動生成時のみ衝突再試行
        const isUnique = err instanceof Error && /UNIQUE/i.test(err.message);
        if (provided || !isUnique) break;
      }
    }

    const msg = lastErr instanceof Error && /UNIQUE/i.test(lastErr.message)
      ? 'refCode already exists'
      : 'Internal server error';
    const status = msg === 'refCode already exists' ? 409 : 500;
    console.error('POST /api/entry-routes error:', lastErr);
    return c.json({ success: false, error: msg }, status);
  } catch (err) {
    console.error('POST /api/entry-routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/entry-routes/:id
entryRoutes.put('/api/entry-routes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      refCode?: string;
      name?: string;
      tagId?: string | null;
      scenarioId?: string | null;
      redirectUrl?: string | null;
      onboardingFlow?: string | null;
      isActive?: boolean;
    }>();

    const route = await updateEntryRoute(c.env.DB, id, body);
    if (!route) return c.json({ success: false, error: 'Not found' }, 404);

    return c.json({ success: true, data: serialize(route) });
  } catch (err) {
    console.error('PUT /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/entry-routes/:id
entryRoutes.delete('/api/entry-routes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteEntryRoute(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { entryRoutes };
