import { Hono } from 'hono';
import { kanbanService } from '../../kanban/kanban-service.js';

const dashboard = new Hono();

// GET /api/dashboard - 대시보드 데이터
dashboard.get('/dashboard', async (c) => {
  try {
    const data = await kanbanService.getDashboard();
    return c.json({ ok: true, data });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// GET /api/workload - 팀 워크로드
dashboard.get('/workload', async (c) => {
  try {
    const data = await kanbanService.getWorkload();
    return c.json({ ok: true, data });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// GET /api/activity - 최근 활동
dashboard.get('/activity', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');
    const data = await kanbanService.getRecentActivity(limit);
    return c.json({ ok: true, data });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// POST /api/gate/request - Stage Gate 검증 요청
dashboard.post('/gate/request', async (c) => {
  try {
    const { projectCode, phase } = await c.req.json();
    const result = await kanbanService.requestStageGate(projectCode, phase);
    return c.json({ ok: true, message: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

// POST /api/gate/approve - Stage Gate 승인/반려
dashboard.post('/gate/approve', async (c) => {
  try {
    const { projectCode, phase, approved, notes } = await c.req.json();
    const result = await kanbanService.approveStageGate(projectCode, phase, approved, notes);
    return c.json({ ok: true, message: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

export { dashboard };
