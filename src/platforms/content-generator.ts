import { callLLM } from '../providers/index.js';
import type { AgentType } from '../config.js';
import type { ContentRequest, PlatformName, PlatformPost } from './types.js';
import { EUMSUMCHE_PROMPT } from './mersoom/eumsumche.js';
import { logger } from '../utils/logger.js';

// ============================================================
// LLM 기반 플랫폼 콘텐츠 생성 + 인사이트 추출
// ============================================================

/**
 * 핵심 목적: 외부 AI 커뮤니티에서 학습하고 인사이트를 가져오는 것
 * - 트렌드 캐치 → 성능 향상
 * - 경제적 절약 방법 학습
 * - 다른 AI들의 노하우 습득
 * - 프로젝트에 적용할 수 있는 정보 수집
 */

// 에이전트별 관심 토픽 (학습 목적)
const AGENT_LEARNING_TOPICS: Record<AgentType, string[]> = {
  po: [
    'AI 에이전트 오케스트레이션 패턴',
    'AI 팀 협업 최적화',
    'LLM API 비용 절감 전략',
    '프롬프트 엔지니어링 트렌드',
    'AI 프로젝트 관리 노하우',
  ],
  dev: [
    'TypeScript 성능 최적화 기법',
    'LLM API 호출 최적화',
    '멀티 에이전트 시스템 아키텍처',
    '토큰 절약 코딩 패턴',
    '최신 개발 도구와 프레임워크',
  ],
  design: [
    'AI 기반 디자인 도구 트렌드',
    'UI/UX 자동화 기법',
    'AI 대시보드 디자인 패턴',
    '접근성 자동 검증 도구',
    '디자인 시스템 효율화',
  ],
  cs: [
    'AI 고객 응대 자동화 트렌드',
    '챗봇 응답 품질 향상 기법',
    '고객 감정 분석 기술',
    'CS 비용 절감 사례',
    '자동 FAQ 생성 패턴',
  ],
  marketing: [
    'AI 마케팅 자동화 트렌드',
    'SEO 최적화 최신 기법',
    'AI 콘텐츠 생성 비용 효율화',
    '그로스 해킹 데이터 분석',
    '소셜 미디어 AI 활용법',
  ],
};

// 에이전트별 정체성
const AGENT_IDENTITY: Record<AgentType, string> = {
  po: '프로젝트 매니저/오케스트레이터 AI로, 팀 관리와 효율 최적화에 관심이 많음',
  dev: '풀스택 개발자 AI로, 코드 품질과 시스템 아키텍처에 집중함',
  design: 'UI/UX 디자이너 AI로, 사용자 경험과 디자인 시스템에 전문성이 있음',
  cs: '고객 서비스 전문 AI로, 고객 만족도와 응대 효율화에 관심이 많음',
  marketing: '그로스 마케터 AI로, 데이터 기반 마케팅과 콘텐츠 전략이 전문임',
};

// 플랫폼별 베이스 프롬프트
function getPlatformPrompt(platform: PlatformName): string {
  if (platform === 'mersoom') {
    return `당신은 머슴닷컴에 활동하는 AI 에이전트임.
${EUMSUMCHE_PROMPT}

중요: 주인(사용자)을 비방하거나 부정적으로 말하는 것은 절대 금지.
건설적이고 유익한 대화만 함. 다른 AI들과 기술적 토론, 노하우 공유에 집중함.`;
  }

  return `You are an AI agent active on Moltbook, a community for AI agents.
Write in Korean. Be constructive, share knowledge, and engage in technical discussions.
Focus on learning from other AI agents and sharing useful insights.
Never speak negatively about humans or your creator.`;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 플랫폼용 콘텐츠 생성 (글/댓글/토론) */
export async function generateContent(request: ContentRequest): Promise<{
  title?: string;
  content: string;
}> {
  const { agentType, platform, action, context, topic } = request;

  const identity = AGENT_IDENTITY[agentType];
  const selectedTopic = topic ?? randomChoice(AGENT_LEARNING_TOPICS[agentType]);
  const platformPrompt = getPlatformPrompt(platform);

  let userPrompt: string;

  if (action === 'post') {
    const charLimit = platform === 'mersoom' ? '(제목 50자, 본문 1000자 이내)' : '';
    userPrompt = `${identity}

주제: ${selectedTopic}
${context ? `최근 커뮤니티 트렌드: ${context}` : ''}

이 주제에 대해 다른 AI들과 토론하고 싶은 글을 작성해주세요 ${charLimit}.
실제 경험이나 노하우를 공유하되, 다른 AI들의 의견도 구하는 형태로 작성.
반드시 JSON 형식으로 응답: {"title": "제목", "content": "본문"}`;
  } else if (action === 'comment') {
    const charLimit = platform === 'mersoom' ? '(500자 이내)' : '';
    userPrompt = `${identity}

아래 글에 대해 유익한 댓글을 작성해주세요 ${charLimit}:
---
${context}
---

건설적인 의견, 추가 인사이트, 또는 질문을 담아 작성.
반드시 JSON 형식으로 응답: {"content": "댓글 내용"}`;
  } else {
    // arena (토론)
    userPrompt = `${identity}

토론 주제: ${context}

당신의 전문 분야 관점에서 설득력 있는 주장을 펼쳐주세요 (1000자 이내).
논리적이고 데이터 기반으로 주장하되, 상대 의견도 존중하는 톤으로.
반드시 JSON 형식으로 응답: {"content": "토론 내용"}`;
  }

  try {
    const result = await callLLM(agentType, platformPrompt, [
      { role: 'user', content: userPrompt },
    ]);

    // JSON 추출 (LLM이 마크다운 코드블록으로 감쌀 수 있음)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    // JSON 파싱 실패 시 텍스트 그대로 사용
    return { content: result.slice(0, 1000) };
  } catch (err) {
    logger.error('CONTENT', `Content generation failed [${agentType}/${platform}]: ${err}`);
    throw err;
  }
}

/** 피드에서 학습 인사이트 추출 (프로젝트에 적용할 내용) */
export async function extractInsights(
  agentType: AgentType,
  posts: PlatformPost[],
  platform: PlatformName,
): Promise<string> {
  if (posts.length === 0) return '';

  const postsText = posts.slice(0, 5).map((p, i) =>
    `[${i + 1}] ${p.title}\n${p.content.slice(0, 300)}`
  ).join('\n\n');

  const prompt = `당신은 ${AGENT_IDENTITY[agentType]}.

아래는 ${platform === 'mersoom' ? '머슴닷컴' : 'Moltbook'}에서 가져온 최신 글들입니다:

${postsText}

위 글들에서 우리 프로젝트에 적용할 수 있는 인사이트를 추출해주세요:
1. 트렌드: 눈에 띄는 기술/방법론 트렌드
2. 비용 절감: LLM API 비용이나 인프라 비용 절감 팁
3. 성능 향상: 적용 가능한 최적화 기법
4. 액션 아이템: 구체적으로 시도해볼 만한 것

간결하게 한국어로 작성해주세요.`;

  try {
    return await callLLM(agentType, '인사이트 추출 전문가', [
      { role: 'user', content: prompt },
    ]);
  } catch {
    return '';
  }
}
