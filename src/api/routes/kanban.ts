import { Hono } from 'hono';
import { kanbanService } from '../../kanban/kanban-service.js';
import type { AgentType } from '../../config.js';

const kanban = new Hono();

// GET /api/tasks - 목록 조회 (필터)
kanban.get('/tasks', async (c) => {
  try {
    const filters: Record<string, string> = {};
    const { project, phase, assignee, status, domain } = c.req.query();
    if (project) filters.project = project;
    if (phase) filters.phase = phase;
    if (assignee) filters.assignee = assignee;
    if (status) filters.status = status;
    if (domain) filters.domain = domain;

    const tasks = await kanbanService.listTasks(filters as any);
    return c.json({ ok: true, data: tasks, count: tasks.length });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// GET /api/tasks/:taskId - 단건 조회
kanban.get('/tasks/:taskId', async (c) => {
  try {
    const task = await kanbanService.getTask(c.req.param('taskId'));
    if (!task) return c.json({ ok: false, error: 'Task not found' }, 404);
    return c.json({ ok: true, data: task });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// POST /api/tasks - 생성
kanban.post('/tasks', async (c) => {
  try {
    const body = await c.req.json();
    const task = await kanbanService.createTask({
      title: body.title,
      description: body.description || '',
      projectCode: body.projectCode,
      phase: body.phase,
      domain: body.domain,
      assignee: body.assignee,
      priority: body.priority,
      createdBy: body.createdBy || 'po',
    });
    return c.json({ ok: true, data: task }, 201);
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

// PATCH /api/tasks/:taskId - 업데이트
kanban.patch('/tasks/:taskId', async (c) => {
  try {
    const body = await c.req.json();
    const taskId = c.req.param('taskId');
    const agent = (body.agent as AgentType) || 'po';
    delete body.agent;

    const task = await kanbanService.updateTask(taskId, body, agent);
    if (!task) return c.json({ ok: false, error: 'Task not found' }, 404);
    return c.json({ ok: true, data: task });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

// DELETE /api/tasks/:taskId - 삭제
kanban.delete('/tasks/:taskId', async (c) => {
  try {
    const deleted = await kanbanService.deleteTask(c.req.param('taskId'));
    if (!deleted) return c.json({ ok: false, error: 'Task not found' }, 404);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// GET /api/board/:projectCode - 칸반 보드
kanban.get('/board/:projectCode', async (c) => {
  try {
    const board = await kanbanService.getBoardView(c.req.param('projectCode'));
    // Map → plain object
    const obj: Record<string, unknown[]> = {};
    for (const [status, tasks] of board.entries()) {
      obj[status] = tasks;
    }
    return c.json({ ok: true, data: obj });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// GET /api/progress/:projectCode - Phase 진행률
kanban.get('/progress/:projectCode', async (c) => {
  try {
    const progress = await kanbanService.getPhaseProgress(c.req.param('projectCode'));
    return c.json({ ok: true, data: progress });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { kanban };
