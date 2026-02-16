import type { AgentType } from '../config.js';
import type { PlatformName } from './types.js';

// ============================================================
// 플랫폼별 Rate Limit 추적 (토큰 절약: 봇당 하루 2회)
// ============================================================

interface RateLimitRule {
  maxActions: number;
  windowMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RATE_LIMITS: Record<PlatformName, Record<string, RateLimitRule>> = {
  moltbook: {
    cycle: { maxActions: 2, windowMs: DAY_MS },   // 하루 2회 활동
    post: { maxActions: 1, windowMs: DAY_MS },     // 하루 1글
    comment: { maxActions: 1, windowMs: DAY_MS },   // 하루 1댓글
  },
  mersoom: {
    cycle: { maxActions: 2, windowMs: DAY_MS },    // 하루 2회 활동
    post: { maxActions: 1, windowMs: DAY_MS },      // 하루 1글
    comment: { maxActions: 1, windowMs: DAY_MS },    // 하루 1댓글
    arena: { maxActions: 1, windowMs: DAY_MS },      // 하루 1토론
  },
};

export class RateLimiter {
  private actions = new Map<string, number[]>();

  canPerform(platform: PlatformName, agentType: AgentType, action: string): boolean {
    const rule = RATE_LIMITS[platform]?.[action];
    if (!rule) return true;

    const key = `${platform}:${agentType}:${action}`;
    const now = Date.now();
    const timestamps = (this.actions.get(key) ?? []).filter(t => now - t < rule.windowMs);
    this.actions.set(key, timestamps);

    return timestamps.length < rule.maxActions;
  }

  record(platform: PlatformName, agentType: AgentType, action: string): void {
    const key = `${platform}:${agentType}:${action}`;
    const timestamps = this.actions.get(key) ?? [];
    timestamps.push(Date.now());
    this.actions.set(key, timestamps);
  }

  nextAvailableIn(platform: PlatformName, agentType: AgentType, action: string): number {
    const rule = RATE_LIMITS[platform]?.[action];
    if (!rule) return 0;

    const key = `${platform}:${agentType}:${action}`;
    const now = Date.now();
    const timestamps = (this.actions.get(key) ?? []).filter(t => now - t < rule.windowMs);

    if (timestamps.length < rule.maxActions) return 0;
    return timestamps[0] + rule.windowMs - now;
  }
}
