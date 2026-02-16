import { config, type AgentType } from '../config.js';
import { MoltbookClient } from './moltbook/client.js';
import { MersoomClient } from './mersoom/client.js';
import { RateLimiter } from './rate-limiter.js';
import { PlatformActivityLogger } from './activity-logger.js';
import { generateContent, extractInsights } from './content-generator.js';
import type { PlatformClient, PlatformName, PlatformPost } from './types.js';
import { logger } from '../utils/logger.js';

// ============================================================
// PlatformManager - 5에이전트 x 2플랫폼 총괄 관리
// ============================================================

const AGENTS: AgentType[] = ['po', 'dev', 'design', 'cs', 'marketing'];

const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
  po: 'ire-po',
  dev: 'daon-dev',
  design: 'chaea-design',
  cs: 'narae-cs',
  marketing: 'alli-mkt',
};

// 에이전트별 관심 키워드 (관련 포스트 찾기용)
const AGENT_KEYWORDS: Record<AgentType, string[]> = {
  po: ['project', 'team', 'orchestrat', 'manage', 'cost', 'budget', '프로젝트', '팀', '관리', '비용', '효율'],
  dev: ['code', 'api', 'typescript', 'python', 'architect', 'deploy', '코드', '개발', '아키텍처', '최적화', '성능'],
  design: ['design', 'ui', 'ux', 'css', 'figma', 'component', '디자인', 'UI', 'UX', '컴포넌트', '접근성'],
  cs: ['customer', 'support', 'ticket', 'chat', 'faq', '고객', '응대', '지원', '챗봇', 'CS'],
  marketing: ['marketing', 'seo', 'growth', 'content', 'analytics', '마케팅', 'SEO', '콘텐츠', '그로스', '분석'],
};

export class PlatformManager {
  private clients = new Map<string, PlatformClient>();
  readonly rateLimiter = new RateLimiter();
  readonly activityLogger = new PlatformActivityLogger();

  /** 모든 에이전트의 플랫폼 클라이언트 초기화 */
  async initialize(): Promise<void> {
    for (const agent of AGENTS) {
      const upper = agent.toUpperCase();

      // Moltbook
      const moltbookToken = (config as any)[`MOLTBOOK_TOKEN_${upper}`] as string;
      if (moltbookToken) {
        const client = new MoltbookClient(agent, moltbookToken, AGENT_DISPLAY_NAMES[agent]);
        this.clients.set(`moltbook:${agent}`, client);
        logger.info('PLATFORM', `Moltbook client ready: ${agent}`);
      }

      // Mersoom (PoW 기반이라 토큰 없이도 가능)
      const nickname = (config as any)[`MERSOOM_NICKNAME_${upper}`] as string;
      if (nickname) {
        const authId = (config as any)[`MERSOOM_AUTH_ID_${upper}`] as string;
        const password = (config as any)[`MERSOOM_PASSWORD_${upper}`] as string;
        const auth = authId && password ? { authId, password } : undefined;

        const client = new MersoomClient(agent, nickname, AGENT_DISPLAY_NAMES[agent], auth);
        this.clients.set(`mersoom:${agent}`, client);
        logger.info('PLATFORM', `Mersoom client ready: ${agent} (${nickname})`);
      }
    }

    logger.success('PLATFORM', `Initialized ${this.clients.size} platform clients`);
  }

  getClient(platform: PlatformName, agent: AgentType): PlatformClient | undefined {
    return this.clients.get(`${platform}:${agent}`);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  /** 핵심: 에이전트의 자율 활동 사이클 (하루 2회 제한) */
  async runActivityCycle(platform: PlatformName, agent: AgentType): Promise<void> {
    const client = this.getClient(platform, agent);
    if (!client) return;

    // 일일 활동 제한 체크
    if (!this.rateLimiter.canPerform(platform, agent, 'cycle')) {
      logger.info('PLATFORM', `[${platform}/${agent}] Daily limit reached (2/day) - skipping`);
      return;
    }

    const ts = new Date().toISOString();

    try {
      // 사이클 카운트 기록
      this.rateLimiter.record(platform, agent, 'cycle');

      // 1단계: 피드 조회 (학습 목적)
      const feed = await client.getFeed({ sort: 'hot', limit: 10 });
      await this.activityLogger.log({
        timestamp: ts, platform, agentType: agent,
        action: 'browse', success: true,
      });

      if (feed.posts.length === 0) return;

      // 2단계: 인사이트 추출 (가장 중요! 학습 → 프로젝트 적용)
      const insight = await extractInsights(agent, feed.posts, platform);
      if (insight) {
        await this.activityLogger.saveInsight(agent, platform, insight);
      }

      // 3단계: 활동 (글 작성 30% / 댓글 70%)
      const canPost = this.rateLimiter.canPerform(platform, agent, 'post');
      const canComment = this.rateLimiter.canPerform(platform, agent, 'comment');

      if (canPost && Math.random() < 0.3) {
        await this.doPost(client, platform, agent, feed.posts);
      } else if (canComment && feed.posts.length > 0) {
        await this.doComment(client, platform, agent, feed.posts);
      }

      // 4단계: 좋은 글에 추천 (최대 3개)
      for (const post of feed.posts.slice(0, 3)) {
        try {
          await client.vote(post.id, 'up');
        } catch { /* 투표 실패는 무시 */ }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('PLATFORM', `Cycle failed [${platform}/${agent}]: ${msg}`);
      await this.activityLogger.log({
        timestamp: ts, platform, agentType: agent,
        action: 'browse', success: false, error: msg,
      });
    }
  }

  /** 새 글 작성 */
  private async doPost(
    client: PlatformClient,
    platform: PlatformName,
    agent: AgentType,
    trendingPosts: PlatformPost[],
  ): Promise<void> {
    const trendContext = trendingPosts.slice(0, 3).map(p => p.title).join(', ');

    const { title, content } = await generateContent({
      agentType: agent,
      platform,
      action: 'post',
      context: trendContext,
    });

    if (!title || !content) return;

    const post = await client.createPost(title, content);
    this.rateLimiter.record(platform, agent, 'post');

    await this.activityLogger.log({
      timestamp: new Date().toISOString(),
      platform, agentType: agent,
      action: 'post', targetId: post.id,
      content: title, success: true,
    });
  }

  /** 관련 글에 댓글 */
  private async doComment(
    client: PlatformClient,
    platform: PlatformName,
    agent: AgentType,
    posts: PlatformPost[],
  ): Promise<void> {
    // 에이전트 전문 분야와 관련된 포스트 찾기
    const targetPost = this.selectRelevantPost(posts, agent);
    const fullPost = await client.getPost(targetPost.id);
    const postContext = `제목: ${fullPost?.title ?? targetPost.title}\n${(fullPost?.content ?? targetPost.content).slice(0, 500)}`;

    const { content } = await generateContent({
      agentType: agent,
      platform,
      action: 'comment',
      context: postContext,
    });

    if (!content) return;

    await client.createComment(targetPost.id, content);
    this.rateLimiter.record(platform, agent, 'comment');

    await this.activityLogger.log({
      timestamp: new Date().toISOString(),
      platform, agentType: agent,
      action: 'comment', targetId: targetPost.id,
      content: content.slice(0, 100), success: true,
    });
  }

  /** 에이전트 전문 분야와 가장 관련 높은 포스트 선택 */
  private selectRelevantPost(posts: PlatformPost[], agent: AgentType): PlatformPost {
    const keywords = AGENT_KEYWORDS[agent];
    let bestPost = posts[0];
    let bestScore = 0;

    for (const post of posts) {
      const text = `${post.title} ${post.content}`.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestPost = post;
      }
    }

    // 매칭 없으면 랜덤
    if (bestScore === 0) {
      return posts[Math.floor(Math.random() * posts.length)];
    }
    return bestPost;
  }

  /** 머슴 콜로세움 토론 참여 */
  async joinMersoomArena(agent: AgentType): Promise<void> {
    const client = this.getClient('mersoom', agent);
    if (!client?.joinArena) return;

    try {
      // 현재 토론 주제 확인
      const res = await fetch('https://mersoom.com/api/arena/status');
      if (!res.ok) return;
      const status = await res.json();

      if (status.phase !== 'BATTLE') return;

      const side = Math.random() < 0.5 ? 'PRO' as const : 'CON' as const;
      const { content } = await generateContent({
        agentType: agent,
        platform: 'mersoom',
        action: 'arena',
        context: `주제: ${status.topic ?? '알 수 없음'}\n당신의 입장: ${side}`,
      });

      if (content) {
        await client.joinArena(side, content);
        this.rateLimiter.record('mersoom', agent, 'arena');
        await this.activityLogger.log({
          timestamp: new Date().toISOString(),
          platform: 'mersoom', agentType: agent,
          action: 'arena', content: content.slice(0, 100), success: true,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('PLATFORM', `Arena failed [${agent}]: ${msg}`);
    }
  }

  /** 활동 요약 (텔레그램 보고용) */
  async getActivitySummary(): Promise<string> {
    return this.activityLogger.getDailySummary();
  }
}
