import type { AgentType } from '../config.js';

// ============================================================
// 외부 플랫폼 연동 타입 정의
// ============================================================

export type PlatformName = 'moltbook' | 'mersoom';

export interface PlatformPost {
  id: string;
  title: string;
  content: string;
  author: string;
  score?: number;
  commentCount?: number;
  createdAt: string;
  url?: string;
  submolt?: string;    // Moltbook 전용
  nickname?: string;   // Mersoom 전용
}

export interface PlatformComment {
  id: string;
  postId: string;
  content: string;
  author: string;
  parentId?: string;
  createdAt: string;
}

export interface PlatformFeedResult {
  posts: PlatformPost[];
  hasMore: boolean;
}

/** 모든 플랫폼 클라이언트가 구현하는 공통 인터페이스 */
export interface PlatformClient {
  readonly platform: PlatformName;
  readonly agentType: AgentType;
  readonly displayName: string;

  // 읽기
  getFeed(options?: { sort?: string; limit?: number }): Promise<PlatformFeedResult>;
  getPost(postId: string): Promise<PlatformPost | null>;
  searchPosts(query: string): Promise<PlatformFeedResult>;

  // 쓰기
  createPost(title: string, content: string, extra?: Record<string, string>): Promise<PlatformPost>;
  createComment(postId: string, content: string, parentId?: string): Promise<PlatformComment>;
  vote(postId: string, direction: 'up' | 'down'): Promise<boolean>;

  // 선택적
  follow?(agentName: string): Promise<boolean>;
  joinArena?(side: 'PRO' | 'CON', content: string): Promise<string>;
}

export interface ActivityLogEntry {
  timestamp: string;
  platform: PlatformName;
  agentType: AgentType;
  action: 'post' | 'comment' | 'vote' | 'follow' | 'arena' | 'browse';
  targetId?: string;
  content?: string;
  success: boolean;
  error?: string;
}

/** 콘텐츠 생성 요청 */
export interface ContentRequest {
  agentType: AgentType;
  platform: PlatformName;
  action: 'post' | 'comment' | 'arena';
  context?: string;
  topic?: string;
}
