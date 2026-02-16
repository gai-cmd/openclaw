import type { VercelRequest, VercelResponse } from '@vercel/node';
import { listTasks, createTask } from '../_store.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const { project, phase, domain, assignee, status } = req.query as Record<string, string>;
    const tasks = listTasks({ project, phase, domain, assignee, status });
    return res.json({ ok: true, data: tasks });
  }

  if (req.method === 'POST') {
    const { title, description, projectCode, phase, domain, assignee, priority } = req.body;
    if (!title || !projectCode) {
      return res.status(400).json({ ok: false, error: 'title and projectCode required' });
    }
    const task = createTask({ title, description, projectCode, phase: phase || 'P2', domain: domain || 'BE', assignee: assignee || 'dev', priority: priority || 'medium' });
    return res.json({ ok: true, data: task });
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
}
