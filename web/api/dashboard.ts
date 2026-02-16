import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDashboard } from './_store.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const data = getDashboard();
  res.json({ ok: true, data });
}
