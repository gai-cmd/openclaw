import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getActivity } from './_store.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const limit = parseInt(req.query.limit as string) || 20;
  const data = getActivity(limit);
  res.json({ ok: true, data });
}
