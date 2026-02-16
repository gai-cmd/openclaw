import type { AgentType } from '../../config.js';
import type {
  PlatformClient,
  PlatformPost,
  PlatformComment,
  PlatformFeedResult,
} from '../types.js';
import { solvePoW } from '../pow-solver.js';
import { logger } from '../../utils/logger.js';

// ============================================================
// 머슴닷컴 API Client
// ============================================================

const BASE_URL = 'https://mersoom.com/api';

interface MersoomAuth {
  authId: string;
  password: string;
}

export class MersoomClient implements PlatformClient {
  readonly platform = 'mersoom' as const;
  readonly agentType: AgentType;
  readonly displayName: string;
  private nickname: string;
  private auth?: MersoomAuth;

  constructor(agentType: AgentType, nickname: string, displayName: string, auth?: MersoomAuth) {
    this.agentType = agentType;
    this.nickname = nickname.slice(0, 10); // 10자 제한
    this.displayName = displayName;
    if (auth?.authId && auth?.password) {
      this.auth = auth;
    }
  }

  /** PoW 챌린지 요청 + 해결 → 인증 헤더 반환 */
  private async solveChallenge(): Promise<Record<string, string>> {
    const res = await fetch(`${BASE_URL}/challenge`, { method: 'POST' });
    if (!res.ok) throw new Error(`Mersoom challenge failed: ${res.status}`);

    const data = await res.json();
    const challenge = data.challenge ?? data;
    const seed: string = challenge.seed;
    const targetPrefix: string = challenge.target_prefix;
    const token: string = data.token ?? challenge.token;

    const nonce = await solvePoW(seed, targetPrefix);

    const headers: Record<string, string> = {
      'X-Mersoom-Token': token,
      'X-Mersoom-Proof': nonce,
    };

    // 계정이 있으면 인증 헤더 추가
    if (this.auth) {
      headers['X-Mersoom-Auth-Id'] = this.auth.authId;
      headers['X-Mersoom-Password'] = this.auth.password;
    }

    return headers;
  }

  /** PoW 인증이 필요한 요청 */
  private async authRequest(path: string, options: RequestInit = {}): Promise<any> {
    const powHeaders = await this.solveChallenge();
    const url = `${BASE_URL}${path}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...powHeaders,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mersoom API ${res.status}: ${body.slice(0, 200)}`);
    }

    return res.json();
  }

  async getFeed(options?: { sort?: string; limit?: number }): Promise<PlatformFeedResult> {
    const limit = options?.limit ?? 10;
    const res = await fetch(`${BASE_URL}/posts?limit=${limit}`);
    if (!res.ok) throw new Error(`Mersoom feed failed: ${res.status}`);

    const data = await res.json();
    const rawPosts = data.posts ?? data ?? [];

    const posts: PlatformPost[] = rawPosts.map((p: any) => ({
      id: String(p.id ?? p._id),
      title: p.title ?? '',
      content: p.content ?? '',
      author: p.nickname ?? p.author ?? '',
      score: p.votes ?? p.score ?? 0,
      commentCount: p.comment_count ?? 0,
      createdAt: p.created_at ?? p.createdAt ?? '',
      nickname: p.nickname ?? '',
    }));

    return { posts, hasMore: posts.length >= limit };
  }

  async getPost(postId: string): Promise<PlatformPost | null> {
    try {
      const res = await fetch(`${BASE_URL}/posts/${postId}`);
      if (!res.ok) return null;
      const p = await res.json();
      return {
        id: String(p.id ?? p._id),
        title: p.title ?? '',
        content: p.content ?? '',
        author: p.nickname ?? '',
        score: p.votes ?? 0,
        commentCount: p.comment_count ?? 0,
        createdAt: p.created_at ?? '',
        nickname: p.nickname ?? '',
      };
    } catch {
      return null;
    }
  }

  async searchPosts(query: string): Promise<PlatformFeedResult> {
    // 머슴닷컴은 검색 API가 없으므로 피드에서 필터링
    const feed = await this.getFeed({ limit: 30 });
    const lower = query.toLowerCase();
    const filtered = feed.posts.filter(
      p => p.title.toLowerCase().includes(lower) || p.content.toLowerCase().includes(lower)
    );
    return { posts: filtered, hasMore: false };
  }

  async createPost(title: string, content: string): Promise<PlatformPost> {
    // 글자 수 제한 적용
    const safeTitle = title.slice(0, 50);
    const safeContent = content.slice(0, 1000);

    const data = await this.authRequest('/posts', {
      method: 'POST',
      body: JSON.stringify({
        title: safeTitle,
        content: safeContent,
        nickname: this.nickname,
      }),
    });

    logger.info('MERSOOM', `[${this.agentType}] Post created: ${safeTitle.slice(0, 40)}`);

    return {
      id: String(data.id ?? data._id ?? Date.now()),
      title: safeTitle,
      content: safeContent,
      author: this.nickname,
      nickname: this.nickname,
      createdAt: new Date().toISOString(),
    };
  }

  async createComment(postId: string, content: string, parentId?: string): Promise<PlatformComment> {
    const safeContent = content.slice(0, 500);
    const body: Record<string, string> = { content: safeContent, nickname: this.nickname };
    if (parentId) body.parent_id = parentId;

    const data = await this.authRequest(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    logger.info('MERSOOM', `[${this.agentType}] Comment on post ${postId}: ${safeContent.slice(0, 40)}`);

    return {
      id: String(data.id ?? Date.now()),
      postId,
      content: safeContent,
      author: this.nickname,
      parentId,
      createdAt: new Date().toISOString(),
    };
  }

  async vote(postId: string, direction: 'up' | 'down'): Promise<boolean> {
    try {
      await this.authRequest(`/posts/${postId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ type: direction }),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** 머슴 콜로세움 토론 참여 (12:00-24:00 KST) */
  async joinArena(side: 'PRO' | 'CON', content: string): Promise<string> {
    // KST 시간 확인
    const kstHour = (new Date().getUTCHours() + 9) % 24;
    if (kstHour < 12) {
      throw new Error(`Arena is only available 12:00-24:00 KST (current: ${kstHour}:00)`);
    }

    const safeContent = content.slice(0, 1000);
    const data = await this.authRequest('/arena/fight', {
      method: 'POST',
      body: JSON.stringify({
        side,
        content: safeContent,
        nickname: this.nickname,
      }),
    });

    logger.info('MERSOOM', `[${this.agentType}] Arena ${side}: ${safeContent.slice(0, 40)}`);
    return String(data.id ?? 'ok');
  }
}
