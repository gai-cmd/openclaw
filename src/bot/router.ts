import { Context, InputFile } from 'grammy';
import { config, type AgentType } from '../config.js';
import { logger } from '../utils/logger.js';
import { formatAgentMessage } from '../utils/message-formatter.js';
import { getAgent } from '../agents/base-agent.js';
import { taskManager } from '../orchestrator/task-manager.js';
import { generateTTS, isRateLimitError } from '../providers/index.js';
import { getAllBots, getBot, getAgentByBotId } from './registry.js';

// ============================================================
// 음성 응답 모드
// ============================================================

const voiceMode = new Set<string>();

export function setVoiceMode(chatId: string, enabled: boolean) {
  if (enabled) voiceMode.add(chatId);
  else voiceMode.delete(chatId);
}

export function isVoiceMode(chatId: string): boolean {
  return voiceMode.has(chatId);
}

// ============================================================
// 에러 메시지 도배 방지
// ============================================================

const errorCooldowns = new Map<string, number>();
const ERROR_COOLDOWN_MS = 30_000;

function canSendError(chatId: string): boolean {
  const lastSent = errorCooldowns.get(chatId);
  if (lastSent && Date.now() - lastSent < ERROR_COOLDOWN_MS) return false;
  errorCooldowns.set(chatId, Date.now());
  return true;
}

// ============================================================
// 중복 처리 방지
// ============================================================

const processingChats = new Map<string, Promise<void>>();

// ============================================================
// 멘션 감지 (@username 또는 한국어 이름)
// ============================================================

const AGENT_NAMES_KO: Record<string, AgentType> = {
  '이레': 'po', '오픈클로': 'po', '다온': 'dev', '채아': 'design',
  '나래': 'cs', '알리': 'marketing',
};

function detectMention(text: string, ctx: Context): AgentType | null {
  // 1. @username 멘션 체크 (Telegram entities)
  const entities = ctx.message?.entities ?? [];
  for (const entity of entities) {
    if (entity.type === 'mention') {
      const mentionText = text.substring(entity.offset, entity.offset + entity.length);
      const username = mentionText.replace('@', '').toLowerCase();

      // 런타임에 봇 유저네임과 매칭
      for (const [agentType, info] of getAllBots()) {
        if (info.username.toLowerCase() === username) {
          return agentType;
        }
      }
    }
  }

  // 2. 한국어 이름 멘션 체크 (이레, 다온, 채아, 나래, 알리)
  for (const [name, agent] of Object.entries(AGENT_NAMES_KO)) {
    if (text.includes(name)) return agent;
  }

  return null;
}

// ============================================================
// 봇-봇 멘션 감지 (모든 멘션 반환)
// ============================================================

function detectAllMentions(text: string, ctx: Context): AgentType[] {
  const mentioned = new Set<AgentType>();

  const entities = ctx.message?.entities ?? [];
  for (const entity of entities) {
    if (entity.type === 'mention') {
      const mentionText = text.substring(entity.offset, entity.offset + entity.length);
      const username = mentionText.replace('@', '').toLowerCase();
      for (const [agentType, info] of getAllBots()) {
        if (info.username.toLowerCase() === username) {
          mentioned.add(agentType);
        }
      }
    }
  }

  for (const [name, agent] of Object.entries(AGENT_NAMES_KO)) {
    if (text.includes(name)) mentioned.add(agent);
  }

  return Array.from(mentioned);
}

// ============================================================
// 봇-봇 응답 빈도 제한 (무한 루프 방지)
// ============================================================

const botResponseTracker = new Map<string, number[]>();
const BOT_RESPONSE_MAX = 5;       // 30초 내 최대 봇-봇 응답 수
const BOT_RESPONSE_WINDOW = 30_000;

function canBotRespond(chatId: string): boolean {
  const now = Date.now();
  const timestamps = botResponseTracker.get(chatId) ?? [];
  const recent = timestamps.filter(t => now - t < BOT_RESPONSE_WINDOW);
  botResponseTracker.set(chatId, recent);
  return recent.length < BOT_RESPONSE_MAX;
}

function trackBotResponse(chatId: string): void {
  const timestamps = botResponseTracker.get(chatId) ?? [];
  timestamps.push(Date.now());
  botResponseTracker.set(chatId, timestamps);
}

// ============================================================
// 키워드 기반 관련성 점수
// ============================================================

const KEYWORDS: Record<AgentType, string[]> = {
  po: ['프로젝트', '계획', '일정', '전체', '팀', '조율', '관리', '보고', '회의', '진행', '상태',
    '파이프라인', '릴리즈', '배포', '통합', '감사', '승인', '결재', '오픈클로'],
  dev: ['코드', '개발', '버그', 'api', '서버', '배포', 'git', 'npm', 'typescript',
    'react', 'node', '데이터베이스', 'db', '빌드', '테스트', 'debug', '함수', '에러',
    '로직', '구현', '리팩토링', '프로그래밍', '알고리즘', '백엔드', '프론트엔드'],
  design: ['디자인', 'ui', 'ux', '와이어프레임', '색상', '폰트', 'css', '레이아웃',
    '스타일', '아이콘', 'figma', '목업', '프로토타입', '인터페이스', '사용성',
    '반응형', '컴포넌트', '비주얼', '그래픽'],
  cs: ['고객', '문의', '불만', '환불', '응대', 'faq', '피드백', 'voc', '서비스',
    '지원', '클레임', '답변', '상담', '접수', '처리', '요청'],
  marketing: ['마케팅', '광고', 'seo', '콘텐츠', '캠페인', 'sns', '브랜딩', '분석',
    '트렌드', '타겟', '프로모션', '이벤트', '홍보', '소셜', '블로그', '채널'],
};

function scoreRelevance(agentType: AgentType, content: string): number {
  const lower = content.toLowerCase();
  let score = 0;

  const agentKeywords = KEYWORDS[agentType] || [];
  for (const kw of agentKeywords) {
    if (lower.includes(kw)) score += 10;
  }

  // PO는 기본 점수 (매칭 없으면 PO가 응답)
  if (agentType === 'po') score += 1;

  return score;
}

// ============================================================
// MessageClaimer: 5개 봇이 동시 수신 → 1개만 응답
// ============================================================

type ClaimResolver = (shouldRespond: boolean) => void;

interface PendingClaim {
  candidates: Map<AgentType, { score: number; resolve: ClaimResolver }>;
  timer: ReturnType<typeof setTimeout>;
}

const claims = new Map<number, AgentType>(); // messageId → winner (resolved)
const pending = new Map<number, PendingClaim>(); // messageId → pending

function claimMessage(messageId: number, agentType: AgentType, content: string): Promise<boolean> {
  // 이미 확정된 claim
  if (claims.has(messageId)) {
    return Promise.resolve(claims.get(messageId) === agentType);
  }

  const score = scoreRelevance(agentType, content);

  return new Promise<boolean>((resolve) => {
    let entry = pending.get(messageId);
    if (!entry) {
      entry = {
        candidates: new Map(),
        timer: setTimeout(() => resolveClaim(messageId), 150), // 150ms 윈도우
      };
      pending.set(messageId, entry);
    }

    entry.candidates.set(agentType, { score, resolve });

    // 5개 봇 모두 등록되면 즉시 resolve
    if (entry.candidates.size >= 5) {
      clearTimeout(entry.timer);
      resolveClaim(messageId);
    }
  });
}

function resolveClaim(messageId: number) {
  const entry = pending.get(messageId);
  if (!entry) return;

  // 가장 높은 점수의 에이전트 선택 (동점 시 PO 우선)
  let winner: AgentType = 'po';
  let bestScore = -1;
  for (const [agent, { score }] of entry.candidates) {
    if (score > bestScore || (score === bestScore && agent === 'po')) {
      bestScore = score;
      winner = agent;
    }
  }

  claims.set(messageId, winner);
  pending.delete(messageId);

  // 각 봇에게 결과 알림
  for (const [agent, { resolve }] of entry.candidates) {
    resolve(agent === winner);
  }

  // 60초 후 정리
  setTimeout(() => claims.delete(messageId), 60_000);
}

// ============================================================
// 핵심: 그룹 메시지 라우팅
// ============================================================

export async function routeGroupMessage(ctx: Context, thisAgent: AgentType, content: string, fromBot: boolean = false): Promise<void> {
  const chatId = String(ctx.chat?.id ?? '');
  const senderName = ctx.from?.first_name ?? 'Unknown';
  const messageId = ctx.message?.message_id ?? 0;

  // --- 봇 메시지: 명시적 멘션만 허용 (무한 루프 방지) ---
  if (fromBot) {
    if (!canBotRespond(chatId)) {
      logger.warn('ROUTER', `Bot-to-bot rate limit reached in ${chatId}`);
      return;
    }

    // 발신 봇 제외하고 멘션된 에이전트 확인
    const senderAgent = getAgentByBotId(ctx.from?.id ?? 0);
    const allMentioned = detectAllMentions(content, ctx);
    const targetMentions = allMentioned.filter(a => a !== senderAgent);

    if (targetMentions.includes(thisAgent)) {
      trackBotResponse(chatId);
      logger.info('ROUTER', `Bot-to-bot: ${senderAgent} → ${thisAgent} for "${content.slice(0, 50)}"`);
      return await handleAgentMessage(ctx, thisAgent, content, senderName);
    }
    return; // 멘션되지 않았으면 무시
  }

  // --- 커맨드 처리 (PO 전용) ---
  if (content.startsWith('/task ') && thisAgent === 'po') {
    const taskContent = content.replace('/task ', '');
    const dedupeKey = `${chatId}:po:task`;
    const prev = processingChats.get(dedupeKey);
    if (prev) await prev.catch(() => {});

    const processPromise = (async () => {
      try {
        await ctx.reply('📋 작업을 분석하고 있습니다...', { parse_mode: 'HTML' });
        const result = await taskManager.createTaskFromCommand(taskContent, senderName);
        await ctx.reply(result, { parse_mode: 'HTML' });
      } catch (err) {
        logger.error('ROUTER', `Task 처리 실패`, err);
        if (canSendError(chatId)) {
          await ctx.reply('⚠️ 작업 처리 중 오류가 발생했습니다.').catch(() => {});
        }
      }
    })();
    processingChats.set(dedupeKey, processPromise);
    await processPromise;
    processingChats.delete(dedupeKey);
    return;
  }

  if (content === '/status' && thisAgent === 'po') {
    const statusMsg = await taskManager.getStatusReport();
    await ctx.reply(statusMsg, { parse_mode: 'HTML' });
    return;
  }

  // --- PO 커맨드센터 (PO만 처리) ---
  if (chatId === config.CHANNEL_COMMAND_CENTER) {
    if (thisAgent === 'po') {
      return await handleAgentMessage(ctx, 'po', content, senderName);
    }
    return; // 다른 봇은 커맨드센터 무시
  }

  // --- @멘션 감지 ---
  const mentionedAgent = detectMention(content, ctx);
  if (mentionedAgent !== null) {
    if (mentionedAgent === thisAgent) {
      // 이 봇이 멘션됨 → 응답
      logger.info('ROUTER', `@mention → ${thisAgent} responds to "${content.slice(0, 50)}"`);
      return await handleAgentMessage(ctx, thisAgent, content, senderName);
    }
    // 다른 봇이 멘션됨 → 무시
    return;
  }

  // --- 키워드 기반 claim (멘션 없는 일반 메시지) ---
  const shouldRespond = await claimMessage(messageId, thisAgent, content);
  if (shouldRespond) {
    logger.info('ROUTER', `Claim won by ${thisAgent} for "${content.slice(0, 50)}"`);
    return await handleAgentMessage(ctx, thisAgent, content, senderName);
  }
}

// ============================================================
// 에이전트 메시지 처리 (LLM 호출)
// ============================================================

async function handleAgentMessage(
  ctx: Context,
  agentType: AgentType,
  content: string,
  senderName: string
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? '');
  const dedupeKey = `${chatId}:${agentType}`;

  const prevProcess = processingChats.get(dedupeKey);
  if (prevProcess) {
    await prevProcess.catch(() => {});
  }

  const processPromise = (async () => {
    try {
      const agent = getAgent(agentType);
      agent.currentChatId = chatId;
      const response = await agent.handleMessage(content, senderName);
      await replyWithVoice(ctx, response, agentType);
    } catch (err) {
      if (isRateLimitError(err)) {
        logger.warn('ROUTER', `Rate limit - 자동 재시도 중 (${agentType})`);
        if (canSendError(chatId)) {
          await ctx.reply('⏳ API 사용량 초과로 잠시 대기 중입니다...').catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 15_000));
        try {
          const agent = getAgent(agentType);
          const response = await agent.handleMessage(content, senderName);
          await replyWithVoice(ctx, response, agentType);
          return;
        } catch {
          if (canSendError(chatId)) {
            await ctx.reply('⚠️ API 사용량이 초과되었습니다. 1분 후에 다시 시도해주세요.').catch(() => {});
          }
          return;
        }
      }

      logger.error('ROUTER', `Error handling message (${agentType})`, err);
      if (canSendError(chatId)) {
        await ctx.reply('⚠️ 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.').catch(() => {});
      }
    }
  })();

  processingChats.set(dedupeKey, processPromise);
  await processPromise;
  processingChats.delete(dedupeKey);
}

// ============================================================
// 텍스트 + 음성 응답
// ============================================================

async function replyWithVoice(ctx: Context, text: string, agentType: AgentType) {
  const formatted = formatAgentMessage(agentType, text);
  await ctx.reply(formatted, { parse_mode: 'HTML' });

  const chatId = String(ctx.chat?.id ?? '');
  if (isVoiceMode(chatId)) {
    try {
      const cleanText = text.replace(/<[^>]*>/g, '').slice(0, 3000);
      if (cleanText.length > 0) {
        const audioBuffer = await generateTTS(cleanText);
        await ctx.replyWithVoice(new InputFile(audioBuffer, 'response.ogg'));
      }
    } catch (err) {
      logger.warn('ROUTER', `TTS 실패: ${err}`);
    }
  }
}

// ============================================================
// 채널/그룹 메시지 전송 (에이전트별 봇 사용)
// ============================================================

export async function sendToChannel(channelId: string, agentType: AgentType, message: string) {
  try {
    const bot = getBot(agentType);
    const formatted = formatAgentMessage(agentType, message);
    await bot.api.sendMessage(channelId, formatted, { parse_mode: 'HTML' });
  } catch (err) {
    logger.warn('ROUTER', `sendToChannel 실패 (${channelId}, ${agentType}): ${err}`);
  }
}

export async function sendToGroup(agentType: AgentType, message: string) {
  if (!config.SHARED_GROUP_ID) return;
  await sendToChannel(config.SHARED_GROUP_ID, agentType, message);
}

export async function postToStatusBoard(message: string) {
  if (!config.CHANNEL_STATUS_BOARD) return;
  try {
    const bot = getBot('po');
    await bot.api.sendMessage(config.CHANNEL_STATUS_BOARD, message, { parse_mode: 'HTML' });
  } catch (err) {
    logger.warn('ROUTER', `상태 보드 전송 실패: ${err}`);
  }
}
