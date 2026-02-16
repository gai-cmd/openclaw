import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';
import type { ActivityLogEntry } from './types.js';

// ============================================================
// 플랫폼 활동 로깅 (파일 기반)
// ============================================================

const WORKSPACE_BASE = 'D:\\projects\\miraclro\\multi-agent-bot\\workspace';
const LOG_DIR = join(WORKSPACE_BASE, 'shared', 'platform-activity');

export class PlatformActivityLogger {
  private buffer: ActivityLogEntry[] = [];

  async log(entry: ActivityLogEntry): Promise<void> {
    this.buffer.push(entry);

    const status = entry.success ? 'OK' : `FAIL: ${entry.error}`;
    logger.info('PLATFORM', `[${entry.platform}/${entry.agentType}] ${entry.action} → ${status}`);

    // 10개마다 또는 중요 이벤트 시 flush
    if (this.buffer.length >= 10 || entry.action === 'post' || !entry.success) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    const today = new Date().toISOString().split('T')[0];
    const logPath = join(LOG_DIR, `${today}.jsonl`);

    try {
      await mkdir(dirname(logPath), { recursive: true });
      const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      await writeFile(logPath, lines, { flag: 'a' });
    } catch (err) {
      logger.error('PLATFORM', `Activity log write failed: ${err}`);
    }
  }

  /** 오늘의 활동 요약 생성 (텔레그램 보고용) */
  async getDailySummary(): Promise<string> {
    await this.flush();

    const today = new Date().toISOString().split('T')[0];
    const logPath = join(LOG_DIR, `${today}.jsonl`);

    let entries: ActivityLogEntry[] = [];
    try {
      const content = await readFile(logPath, 'utf-8');
      entries = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch {
      return '오늘 플랫폼 활동 기록 없음';
    }

    // 플랫폼별/에이전트별 집계
    const stats = new Map<string, { posts: number; comments: number; votes: number; errors: number }>();

    for (const e of entries) {
      const key = `${e.platform}/${e.agentType}`;
      const s = stats.get(key) ?? { posts: 0, comments: 0, votes: 0, errors: 0 };

      if (!e.success) s.errors++;
      else if (e.action === 'post') s.posts++;
      else if (e.action === 'comment') s.comments++;
      else if (e.action === 'vote') s.votes++;

      stats.set(key, s);
    }

    if (stats.size === 0) return '오늘 플랫폼 활동 기록 없음';

    const lines = ['📊 플랫폼 활동 일일 리포트', ''];
    for (const [key, s] of stats) {
      lines.push(`${key}: 글 ${s.posts} | 댓글 ${s.comments} | 추천 ${s.votes} | 오류 ${s.errors}`);
    }

    return lines.join('\n');
  }

  /** 인사이트 저장 (학습 결과) */
  async saveInsight(agentType: string, platform: string, insight: string): Promise<void> {
    if (!insight.trim()) return;

    const today = new Date().toISOString().split('T')[0];
    const insightPath = join(WORKSPACE_BASE, 'shared', 'platform-insights', `${today}.md`);

    try {
      await mkdir(dirname(insightPath), { recursive: true });
      const header = `\n## [${platform}/${agentType}] ${new Date().toLocaleTimeString('ko-KR')}\n`;
      await writeFile(insightPath, header + insight + '\n', { flag: 'a' });
      logger.info('PLATFORM', `Insight saved: ${insightPath}`);
    } catch (err) {
      logger.error('PLATFORM', `Insight save failed: ${err}`);
    }
  }
}
