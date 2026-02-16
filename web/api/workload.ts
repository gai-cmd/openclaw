import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getWorkload } from './_store.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const data = getWorkload();
  res.json({ ok: true, data });
}
