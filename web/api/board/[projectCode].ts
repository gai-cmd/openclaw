import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBoard } from '../_store.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { projectCode } = req.query;
  if (!projectCode || typeof projectCode !== 'string') {
    return res.status(400).json({ ok: false, error: 'projectCode required' });
  }
  const board = getBoard(projectCode);
  res.json({ ok: true, data: board });
}
