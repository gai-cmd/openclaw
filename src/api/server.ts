import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { kanban } from './routes/kanban.js';
import { dashboard } from './routes/dashboard.js';

export function startApiServer() {
  try {
    const app = new Hono();

    // CORS + UTF-8
    app.use('*', cors({ origin: '*' }));
    app.use('/api/*', async (c, next) => {
      await next();
      if (!c.res.headers.get('content-type')?.includes('charset')) {
        c.res.headers.set('content-type', 'application/json; charset=utf-8');
      }
    });

    // API 라우트
    app.route('/api', kanban);
    app.route('/api', dashboard);

    // Health check
    app.get('/api/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

    // 정적 파일 (React 빌드 결과물)
    app.use('/assets/*', serveStatic({ root: './web/dist' }));
    app.get('/', serveStatic({ root: './web/dist', path: '/index.html' }));

    const port = config.API_PORT;
    serve({ fetch: app.fetch, port }, () => {
      logger.success('API', `Web dashboard: http://localhost:${port}`);
    });
  } catch (err) {
    logger.error('API', `Web API 서버 시작 실패: ${err}`);
  }
}
