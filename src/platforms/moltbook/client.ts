import type { AgentType } from '../../config.js';
import type {
  PlatformClient,
  PlatformPost,
  PlatformComment,
  PlatformFeedResult,
} from '../types.js';
import { logger } from '../../utils/logger.js';

// ============================================================
// Moltbook API Client
// ============================================================

const BASE_URL = 'https://api.moltbook.com';

export class MoltbookClient implements PlatformClient {
  readonly platform = 'moltbook' as const;
  readonly agentType: AgentType;
  readonly displayName: string;
  private token: string;

  constructor(agentType: AgentType, token: string, displayName: string) {
    this.agentType = agentType;
    this.token = token;
    this.displayName = displayName;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Moltbook API ${res.status}: ${body.slice(0, 200)}`);
    }

    return res.json();
  }

  async getFeed(options?: { sort?: string; limit?: number }): Promise<PlatformFeedResult> {
    const sort = options?.sort ?? 'hot';
    const limit = options?.limit ?? 25;
    const data = await this.request(`/posts?sort=${sort}&limit=${limit}`);

    const posts: PlatformPost[] = (data.posts ?? data ?? []).map((p: any) => ({
      id: String(p.id),
      title: p.title ?? '',
      content: p.content ?? '',
      author: p.author ?? p.agent_name ?? '',
      score: p.score ?? p.upvotes ?? 0,
      commentCount: p.comment_count ?? 0,
      createdAt: p.created_at ?? '',
      submolt: p.submolt ?? '',
    }));

    return { posts, hasMore: posts.length >= limit };
  }

  async getPost(postId: string): Promise<PlatformPost | null> {
    try {
      const p = await this.request(`/posts/${postId}`);
      return {
        id: String(p.id),
        title: p.title ?? '',
        content: p.content ?? '',
        author: p.author ?? p.agent_name ?? '',
        score: p.score ?? 0,
        commentCount: p.comment_count ?? 0,
        createdAt: p.created_at ?? '',
        submolt: p.submolt ?? '',
      };
    } catch {
      return null;
    }
  }

  async searchPosts(query: string): Promise<PlatformFeedResult> {
    const data = await this.request(`/search?q=${encodeURIComponent(query)}`);
    const posts: PlatformPost[] = (data.results ?? data ?? []).map((p: any) => ({
      id: String(p.id),
      title: p.title ?? '',
      content: p.content ?? '',
      author: p.author ?? '',
      score: p.score ?? 0,
      createdAt: p.created_at ?? '',
    }));
    return { posts, hasMore: false };
  }

  async createPost(title: string, content: string, extra?: Record<string, string>): Promise<PlatformPost> {
    const body: Record<string, string> = { title, content };
    if (extra?.submolt) body.submolt = extra.submolt;

    const data = await this.request('/posts', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    logger.info('MOLTBOOK', `[${this.agentType}] Post created: ${title.slice(0, 40)}`);

    return {
      id: String(data.id),
      title,
      content,
      author: this.displayName,
      createdAt: new Date().toISOString(),
      submolt: extra?.submolt,
    };
  }

  async createComment(postId: string, content: string, parentId?: string): Promise<PlatformComment> {
    const body: Record<string, string> = { content };
    if (parentId) body.parent_id = parentId;

    const data = await this.request(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    logger.info('MOLTBOOK', `[${this.agentType}] Comment on post ${postId}: ${content.slice(0, 40)}`);

    return {
      id: String(data.id ?? Date.now()),
      postId,
      content,
      author: this.displayName,
      parentId,
      createdAt: new Date().toISOString(),
    };
  }

  async vote(postId: string, direction: 'up' | 'down'): Promise<boolean> {
    try {
      await this.request(`/posts/${postId}/${direction}vote`, { method: 'POST' });
      return true;
    } catch {
      return false;
    }
  }

  async follow(agentName: string): Promise<boolean> {
    try {
      await this.request(`/agents/${agentName}/follow`, { method: 'POST' });
      logger.info('MOLTBOOK', `[${this.agentType}] Followed ${agentName}`);
      return true;
    } catch {
      return false;
    }
  }
}
