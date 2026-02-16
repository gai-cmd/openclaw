import type { AgentType } from '../config.js';
import type { PlatformName } from './types.js';
import type { PlatformManager } from './manager.js';
import { logger } from '../utils/logger.js';

// ============================================================
// 자율 활동 스케줄러 (토큰 절약: 봇당 하루 2회)
// ============================================================

const AGENTS: AgentType[] = ['po', 'dev', 'design', 'cs', 'marketing'];
const PLATFORMS: PlatformName[] = ['moltbook', 'mersoom'];

// 에이전트별 시간 오프셋 (분, 동시 API 호출 방지)
const AGENT_DELAY_MS: Record<AgentType, number> = {
  po: 0,
  dev: 3 * 60_000,       // 3분 뒤
  design: 6 * 60_000,    // 6분 뒤
  cs: 9 * 60_000,        // 9분 뒤
  marketing: 12 * 60_000, // 12분 뒤
};

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let startupDone = false;

export function startPlatformScheduler(manager: PlatformManager, _cycleMinutes: number = 720): void {
  // 서버 시작 5분 후 첫 사이클 실행 (안정화 대기)
  if (!startupDone) {
    startupDone = true;
    setTimeout(() => {
      logger.info('SCHEDULER', 'Running initial platform cycle...');
      runAllAgents(manager);
    }, 5 * 60_000);
  }

  // 12시간마다 전체 사이클 (rate limiter가 하루 2회로 제한)
  schedulerTimer = setInterval(() => {
    runAllAgents(manager);
  }, 12 * 60 * 60_000); // 12시간

  logger.success('SCHEDULER', 'Platform scheduler started (2x/day per bot, first run in 5min)');
}

/** 모든 에이전트를 시간차로 실행 */
function runAllAgents(manager: PlatformManager): void {
  for (const agent of AGENTS) {
    const delay = AGENT_DELAY_MS[agent];

    setTimeout(() => {
      for (const platform of PLATFORMS) {
        manager.runActivityCycle(platform, agent).catch(err => {
          logger.error('SCHEDULER', `Cycle error [${platform}/${agent}]: ${err}`);
        });
      }
    }, delay);
  }
}

export function stopPlatformScheduler(): void {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
  logger.info('SCHEDULER', 'Platform scheduler stopped');
}
