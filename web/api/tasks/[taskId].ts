import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTask, updateTask, deleteTask } from '../_store.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { taskId } = req.query;
  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ ok: false, error: 'taskId required' });
  }

  if (req.method === 'GET') {
    const task = getTask(taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, data: task });
  }

  if (req.method === 'PATCH') {
    const task = updateTask(taskId, req.body);
    if (!task) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, data: task });
  }

  if (req.method === 'DELETE') {
    const ok = deleteTask(taskId);
    if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true });
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
}
