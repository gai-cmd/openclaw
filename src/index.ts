import { config } from './config.js';
import { createBots, startBots, stopBots, startDailyReport } from './bot/gateway.js';
import { startWorker, stopWorker } from './queue/worker.js';
import { initRedis, closeQueue } from './queue/queues.js';
import { initDatabase, closeDatabase } from './db/client.js';
import { getAllAgents } from './agents/base-agent.js';
import { mercenary } from './mission/mercenary.js';
import { logger } from './utils/logger.js';
import { startApiServer } from './api/server.js';

// ============================================================
// 프로세스 크래시 방지 - 절대 죽지 않는 서버
// ============================================================

process.on('uncaughtException', (err) => {
  logger.error('SYSTEM', `⚠ Uncaught Exception (서버 계속 실행): ${err.message}`);
  logger.error('SYSTEM', err.stack ?? '');
});

process.on('unhandledRejection', (reason) => {
  logger.error('SYSTEM', `⚠ Unhandled Rejection (서버 계속 실행): ${reason}`);
});

// ============================================================
// 메인 시작 (자동 재시작 포함)
// ============================================================

const RESTART_DELAY_MS = 5_000;
let isShuttingDown = false;

async function main() {
  logger.info('SYSTEM', '=== Multi-Agent Bot System (5-Bot Architecture) ===');
  logger.info('SYSTEM', `Model: ${config.CLAUDE_MODEL}`);

  // 1. 데이터베이스 초기화 (실패해도 계속 진행)
  await initDatabase();

  // 2. Redis 초기화 (실패해도 계속 진행 - 기본 채팅은 동작)
  await initRedis();

  // 3. 에이전트 초기화
  getAllAgents();
  logger.success('SYSTEM', 'All agents initialized (PO, Dev, Design, CS, Marketing)');

  // 4. 작업 워커 시작 (Redis가 있을 때만 동작)
  startWorker();

  // 4.5. 용병(외부 AI CLI) 초기화
  await mercenary.initialize();

  // 5. 5개 텔레그램 봇 생성
  await createBots();

  // 6. 5개 봇 시작
  await startBots();

  // 7. 일일 토큰 리포트 스케줄러 시작
  startDailyReport();

  // 8. 웹 API 서버 시작 (칸반 대시보드)
  startApiServer();

  // 9. 외부 플랫폼 연동 (Moltbook + 머슴닷컴)
  if (config.PLATFORM_ENABLED === 'true') {
    try {
      const { PlatformManager } = await import('./platforms/manager.js');
      const { startPlatformScheduler } = await import('./platforms/scheduler.js');
      const { setPlatformManager } = await import('./tools/index.js');

      const platformManager = new PlatformManager();
      await platformManager.initialize();
      setPlatformManager(platformManager);

      if (platformManager.getClientCount() > 0) {
        startPlatformScheduler(platformManager, config.PLATFORM_CYCLE_MINUTES);
      } else {
        logger.warn('PLATFORM', 'No platform credentials configured - scheduler not started');
      }
    } catch (err) {
      logger.warn('PLATFORM', `Platform integration failed (bot continues): ${err}`);
    }
  }

  logger.success('SYSTEM', '서버 정상 가동 - 강제 종료 전까지 계속 실행됩니다.');
}

// 종료 처리 (SIGINT/SIGTERM만)
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('SYSTEM', 'Shutting down...');
  await stopBots();
  await stopWorker();
  await closeQueue();
  await closeDatabase();
  logger.info('SYSTEM', 'Goodbye!');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 자동 재시작 루프
async function startWithAutoRestart() {
  while (!isShuttingDown) {
    try {
      await main();
      // main이 정상 완료되면 프로세스를 살려둠 (봇은 polling으로 계속 실행)
      break;
    } catch (err) {
      logger.error('SYSTEM', `서버 시작 실패: ${err}`);
      logger.info('SYSTEM', `${RESTART_DELAY_MS / 1000}초 후 자동 재시작...`);
      await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
    }
  }
}

startWithAutoRestart();
