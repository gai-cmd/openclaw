import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config, type AgentType } from '../config.js';
import { logger } from '../utils/logger.js';

export type ProviderType = 'anthropic' | 'openai' | 'gemini';

export interface AgentModelConfig {
  provider: ProviderType;
  model: string;
}

// 에이전트별 모델 설정
export const AGENT_MODELS: Record<AgentType, AgentModelConfig> = {
  po: {
    provider: (config.PO_PROVIDER as ProviderType) || 'anthropic',
    model: config.PO_MODEL || 'claude-sonnet-4-5-20250929',
  },
  dev: {
    provider: (config.DEV_PROVIDER as ProviderType) || 'anthropic',
    model: config.DEV_MODEL || 'claude-sonnet-4-5-20250929',
  },
  design: {
    provider: (config.DESIGN_PROVIDER as ProviderType) || 'gemini',
    model: config.DESIGN_MODEL || 'gemini-2.0-flash',
  },
  cs: {
    provider: (config.CS_PROVIDER as ProviderType) || 'openai',
    model: config.CS_MODEL || 'gpt-4o',
  },
  marketing: {
    provider: (config.MARKETING_PROVIDER as ProviderType) || 'openai',
    model: config.MARKETING_MODEL || 'gpt-4o',
  },
};

// PO 빠른 응답 모델 (Haiku)
export const PO_FAST_MODEL = config.PO_FAST_MODEL || 'claude-haiku-4-5-20251001';

// ============================================================
// 토큰 사용량 추적 시스템
// ============================================================

interface TokenUsageEntry {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

interface DailyTokenUsage {
  date: string; // YYYY-MM-DD
  byProvider: Record<ProviderType, Record<string, TokenUsageEntry>>; // provider → model → usage
  byAgent: Record<string, TokenUsageEntry>; // agentType → usage
}

let dailyUsage: DailyTokenUsage = createEmptyDailyUsage();

function createEmptyDailyUsage(): DailyTokenUsage {
  return {
    date: new Date().toISOString().split('T')[0],
    byProvider: {
      anthropic: {},
      openai: {},
      gemini: {},
    },
    byAgent: {},
  };
}

function ensureCurrentDay() {
  const today = new Date().toISOString().split('T')[0];
  if (dailyUsage.date !== today) {
    // 날짜 변경 → 리셋
    dailyUsage = createEmptyDailyUsage();
  }
}

export function trackTokenUsage(
  provider: ProviderType,
  model: string,
  agentType: string,
  inputTokens: number,
  outputTokens: number
) {
  ensureCurrentDay();

  // 프로바이더별 모델별 추적
  if (!dailyUsage.byProvider[provider][model]) {
    dailyUsage.byProvider[provider][model] = { inputTokens: 0, outputTokens: 0, calls: 0 };
  }
  dailyUsage.byProvider[provider][model].inputTokens += inputTokens;
  dailyUsage.byProvider[provider][model].outputTokens += outputTokens;
  dailyUsage.byProvider[provider][model].calls += 1;

  // 에이전트별 추적
  if (!dailyUsage.byAgent[agentType]) {
    dailyUsage.byAgent[agentType] = { inputTokens: 0, outputTokens: 0, calls: 0 };
  }
  dailyUsage.byAgent[agentType].inputTokens += inputTokens;
  dailyUsage.byAgent[agentType].outputTokens += outputTokens;
  dailyUsage.byAgent[agentType].calls += 1;

  logger.info('TOKENS', `${provider}/${model} [${agentType}] in:${inputTokens} out:${outputTokens}`);
}

// 일일 토큰 사용량 리포트 생성 (PO가 호출)
export function getTokenUsageReport(): string {
  ensureCurrentDay();

  const lines: string[] = [];
  lines.push(`📊 <b>토큰 사용량 리포트</b> (${dailyUsage.date})`);
  lines.push('');

  // 프로바이더별
  lines.push('<b>▸ 프로바이더별 사용량</b>');
  for (const [provider, models] of Object.entries(dailyUsage.byProvider)) {
    const modelEntries = Object.entries(models);
    if (modelEntries.length === 0) continue;

    let providerTotal = { input: 0, output: 0, calls: 0 };
    for (const [model, usage] of modelEntries) {
      providerTotal.input += usage.inputTokens;
      providerTotal.output += usage.outputTokens;
      providerTotal.calls += usage.calls;
      lines.push(`  ${provider}/${model}: ${usage.calls}회, in:${usage.inputTokens.toLocaleString()} / out:${usage.outputTokens.toLocaleString()}`);
    }
    lines.push(`  <b>${provider} 소계</b>: ${providerTotal.calls}회, in:${providerTotal.input.toLocaleString()} / out:${providerTotal.output.toLocaleString()}`);
    lines.push('');
  }

  // 에이전트별
  lines.push('<b>▸ 에이전트별 사용량</b>');
  const agentNames: Record<string, string> = {
    po: '이레(PO)', dev: '다온(Dev)', design: '채아(Design)',
    cs: '나래(CS)', marketing: '알리(Marketing)',
  };
  let grandTotal = { input: 0, output: 0, calls: 0 };
  for (const [agent, usage] of Object.entries(dailyUsage.byAgent)) {
    const name = agentNames[agent] || agent;
    lines.push(`  ${name}: ${usage.calls}회, in:${usage.inputTokens.toLocaleString()} / out:${usage.outputTokens.toLocaleString()}`);
    grandTotal.input += usage.inputTokens;
    grandTotal.output += usage.outputTokens;
    grandTotal.calls += usage.calls;
  }
  lines.push('');
  lines.push(`<b>▸ 총합</b>: ${grandTotal.calls}회, in:${grandTotal.input.toLocaleString()} / out:${grandTotal.output.toLocaleString()}`);

  return lines.join('\n');
}

// 토큰 사용량 원본 데이터 반환 (JSON)
export function getTokenUsageData(): DailyTokenUsage {
  ensureCurrentDay();
  return { ...dailyUsage };
}

// ============================================================
// Rate Limit / Quota 자동 폴백 시스템 + 요청 큐
// ============================================================

const COOLDOWN_MS = 60_000; // 60초 쿨다운

// 프로바이더별 쿨다운 상태
const providerCooldowns = new Map<ProviderType, number>();

// 프로바이더별 폴백 순서
const FALLBACK_CHAIN: Record<ProviderType, ProviderType[]> = {
  gemini: ['openai', 'anthropic'],
  openai: ['anthropic', 'gemini'],
  anthropic: ['openai', 'gemini'],
};

// 프로바이더별 기본 모델 (폴백 시 사용)
const DEFAULT_MODELS: Record<ProviderType, string> = {
  anthropic: config.CLAUDE_MODEL,
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
};

// 프로바이더별 기본 모델 반환 (agentic 폴백 시 사용)
export function getDefaultModel(provider: ProviderType): string {
  return DEFAULT_MODELS[provider];
}

// --- 요청 큐 (프로바이더별 직렬화) ---
const providerQueues = new Map<ProviderType, Promise<unknown>>();

async function enqueue<T>(provider: ProviderType, fn: () => Promise<T>): Promise<T> {
  const prev = providerQueues.get(provider) ?? Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  providerQueues.set(provider, next);
  return next;
}

// --- 에러 분류 ---
export function isRateLimitError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  const status = getErrorStatus(err);
  return status === 429 || msg.includes('rate limit') || msg.includes('quota') || msg.includes('resource_exhausted');
}

function isBillingError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  const status = getErrorStatus(err);
  return status === 402 || msg.includes('billing') || msg.includes('credit') || msg.includes('payment')
    || msg.includes('insufficient') || msg.includes('exceeded');
}

function isAuthError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  const status = getErrorStatus(err);
  return status === 401 || status === 403 || msg.includes('auth') || msg.includes('api key')
    || msg.includes('permission') || msg.includes('forbidden');
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getErrorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status: number }).status;
  }
  // Anthropic SDK error
  if (err instanceof Error && 'status' in err) {
    return (err as any).status;
  }
  return 0;
}

// 사용자에게 보여줄 에러 요약
export function getErrorSummary(err: unknown): string {
  if (isRateLimitError(err)) return '⏳ API 사용량 초과 (Rate Limit)';
  if (isBillingError(err)) return '💳 결제/크레딧 문제';
  if (isAuthError(err)) return '🔑 API 키 인증 실패';
  const status = getErrorStatus(err);
  if (status >= 500) return `🔥 서버 오류 (${status})`;
  return `❌ ${getErrorMessage(err).slice(0, 100)}`;
}

function isProviderAvailable(provider: ProviderType): boolean {
  if (provider === 'openai' && !config.OPENAI_API_KEY) return false;
  if (provider === 'gemini' && !config.GEMINI_API_KEY) return false;

  const cooldownUntil = providerCooldowns.get(provider);
  if (cooldownUntil && Date.now() < cooldownUntil) return false;

  if (cooldownUntil) {
    providerCooldowns.delete(provider);
    logger.info('PROVIDER', `${provider} 쿨다운 해제 → 다시 사용 가능`);
  }
  return true;
}

function markProviderCooldown(provider: ProviderType) {
  const until = Date.now() + COOLDOWN_MS;
  providerCooldowns.set(provider, until);
  logger.warn('PROVIDER', `${provider} 쿨다운 설정 (${COOLDOWN_MS / 1000}s) → 폴백 시도`);
}

// --- 지수 백오프 재시도 ---
async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 3, baseDelay: number = 5000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isRateLimitError(err) && i < maxRetries) {
        const delay = baseDelay * Math.pow(2, i);
        logger.warn('RETRY', `Rate limit → ${delay / 1000}s 대기 후 재시도 (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ============================================================
// Provider clients (lazy init)
// ============================================================

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let geminiClient: GoogleGenerativeAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return openaiClient;
}

function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    if (!config.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    geminiClient = new GoogleGenerativeAI(config.GEMINI_API_KEY);
  }
  return geminiClient;
}

export { getOpenAIClient };

// ============================================================
// callLLM - 도구 없이 단순 텍스트 응답 (자동 폴백 + 큐)
// mode='fast' → PO가 Haiku 모델로 빠른 응답
// ============================================================

export async function callLLM(
  agentType: AgentType,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  mode?: 'fast' // PO 전용: Haiku 빠른 응답 모드
): Promise<string> {
  const mc = AGENT_MODELS[agentType];
  let primaryProvider = mc.provider;
  let primaryModel = mc.model;

  // PO fast 모드: Haiku 모델 사용 (Anthropic 한정)
  if (mode === 'fast' && agentType === 'po' && primaryProvider === 'anthropic') {
    primaryModel = PO_FAST_MODEL;
    logger.info('PO', `Fast mode → ${primaryModel}`);
  }

  const candidates: Array<{ provider: ProviderType; model: string }> = [];

  if (isProviderAvailable(primaryProvider)) {
    candidates.push({ provider: primaryProvider, model: primaryModel });
  }
  for (const fallback of FALLBACK_CHAIN[primaryProvider]) {
    if (isProviderAvailable(fallback)) {
      candidates.push({ provider: fallback, model: DEFAULT_MODELS[fallback] });
    }
  }

  if (candidates.length === 0) {
    const soonest = [...providerCooldowns.entries()].sort((a, b) => a[1] - b[1])[0];
    if (soonest) {
      const waitMs = Math.max(0, soonest[1] - Date.now());
      logger.warn(agentType.toUpperCase(), `모든 프로바이더 쿨다운 → ${Math.ceil(waitMs / 1000)}s 대기`);
      await new Promise(r => setTimeout(r, waitMs + 1000));
      providerCooldowns.delete(soonest[0]);
      candidates.push({ provider: soonest[0], model: DEFAULT_MODELS[soonest[0]] });
    } else {
      throw new Error(`사용 가능한 프로바이더가 없습니다`);
    }
  }

  let lastError: unknown;

  for (const { provider, model } of candidates) {
    const isFallback = provider !== primaryProvider;
    if (isFallback) {
      logger.warn(agentType.toUpperCase(), `폴백: ${primaryProvider} → ${provider}/${model}`);
    } else {
      logger.info(agentType.toUpperCase(), `Using ${provider}/${model}`);
    }

    try {
      return await enqueue(provider, () => callProviderDirect(provider, model, systemPrompt, messages, agentType));
    } catch (err) {
      lastError = err;
      const summary = getErrorSummary(err);
      logger.warn(agentType.toUpperCase(), `${provider}/${model} 실패 [${summary}] → 폴백 시도`);
      // Rate limit만 쿨다운 (다른 에러는 즉시 폴백)
      if (isRateLimitError(err)) {
        markProviderCooldown(provider);
      }
      continue;
    }
  }

  throw lastError;
}

// 프로바이더 직접 호출 (텍스트만)
async function callProviderDirect(
  provider: ProviderType,
  model: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  agentType?: string
): Promise<string> {
  switch (provider) {
    case 'anthropic':
      return callAnthropic(model, systemPrompt, messages, agentType);
    case 'openai':
      return callOpenAI(model, systemPrompt, messages, agentType);
    case 'gemini':
      return callGemini(model, systemPrompt, messages, agentType);
  }
}

// ============================================================
// Anthropic Tool Use agentic 호출
// ============================================================

export async function callAnthropicWithTools(
  model: string,
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  agentType?: string
): Promise<Anthropic.Message> {
  return enqueue('anthropic', () =>
    withRetry(async () => {
      const client = getAnthropicClient();
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        tools,
      });

      // 토큰 사용량 추적
      if (response.usage) {
        trackTokenUsage(
          'anthropic', model, agentType || 'unknown',
          response.usage.input_tokens, response.usage.output_tokens
        );
      }

      return response;
    }, 3, 5000)
  );
}

// ============================================================
// OpenAI Function Calling (도구 사용)
// ============================================================

export interface OpenAIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface OpenAIToolResponse {
  text: string | null;
  toolCalls: OpenAIToolCall[];
  finishReason: string;
}

export async function callOpenAIWithTools(
  model: string,
  systemPrompt: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.ChatCompletionTool[],
  agentType?: string,
  toolChoice?: 'auto' | 'required' | 'none'
): Promise<OpenAIToolResponse> {
  return enqueue('openai', () =>
    withRetry(async () => {
      const client = getOpenAIClient();
      const response = await client.chat.completions.create({
        model,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        tools,
        tool_choice: toolChoice ?? 'auto',
        parallel_tool_calls: false,  // 도구 호출 순차 실행 (안정성)
      });

      // 토큰 사용량 추적
      if (response.usage) {
        trackTokenUsage(
          'openai', model, agentType || 'unknown',
          response.usage.prompt_tokens, response.usage.completion_tokens
        );
      }

      const choice = response.choices[0];
      const message = choice?.message;

      const toolCalls: OpenAIToolCall[] = (message?.tool_calls ?? [])
        .filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } =>
          tc.type === 'function'
        )
        .map((tc) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch (e) {
            logger.warn('OPENAI', `Tool arguments JSON parse error for ${tc.function.name}: ${tc.function.arguments}`);
          }
          return { id: tc.id, name: tc.function.name, arguments: args };
        });

      return {
        text: message?.content ?? null,
        toolCalls,
        finishReason: choice?.finish_reason ?? 'stop',
      };
    }, 3, 5000)
  );
}

// ============================================================
// Gemini Function Calling (도구 사용)
// ============================================================

export interface GeminiToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface GeminiToolResponse {
  text: string | null;
  toolCalls: GeminiToolCall[];
}

export async function callGeminiWithTools(
  model: string,
  systemPrompt: string,
  chatHistory: Array<{ role: 'user' | 'model'; parts: any[] }>,
  lastMessage: string | any[],
  tools: any[],
  agentType?: string
): Promise<GeminiToolResponse> {
  return enqueue('gemini', () =>
    withRetry(async () => {
      const client = getGeminiClient();
      const genModel = client.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
        tools,
      });

      const chat = genModel.startChat({ history: chatHistory });
      const msgContent = typeof lastMessage === 'string' ? lastMessage : lastMessage;
      const result = await chat.sendMessage(msgContent);
      const response = result.response;

      // 토큰 사용량 추적 (Gemini)
      const usageMeta = response.usageMetadata;
      if (usageMeta) {
        trackTokenUsage(
          'gemini', model, agentType || 'unknown',
          usageMeta.promptTokenCount ?? 0, usageMeta.candidatesTokenCount ?? 0
        );
      }

      const toolCalls: GeminiToolCall[] = [];
      let text: string | null = null;

      for (const candidate of response.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if ('functionCall' in part && part.functionCall) {
            toolCalls.push({
              name: part.functionCall.name,
              arguments: (part.functionCall.args as Record<string, unknown>) ?? {},
            });
          }
          if ('text' in part && part.text) {
            text = (text ?? '') + part.text;
          }
        }
      }

      return { text, toolCalls };
    }, 3, 5000)
  );
}

// ============================================================
// TTS (OpenAI TTS-1)
// ============================================================

export async function generateTTS(text: string): Promise<Buffer> {
  const client = getOpenAIClient();
  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: 'nova',
    input: text,
    response_format: 'opus',
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ============================================================
// 프로바이더별 구현 (텍스트 전용 + 토큰 추적)
// ============================================================

async function callAnthropic(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  agentType?: string
): Promise<string> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  // 토큰 사용량 추적
  if (response.usage) {
    trackTokenUsage(
      'anthropic', model, agentType || 'unknown',
      response.usage.input_tokens, response.usage.output_tokens
    );
  }

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

async function callOpenAI(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  agentType?: string
): Promise<string> {
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  });

  // 토큰 사용량 추적
  if (response.usage) {
    trackTokenUsage(
      'openai', model, agentType || 'unknown',
      response.usage.prompt_tokens, response.usage.completion_tokens
    );
  }

  return response.choices[0]?.message?.content ?? '';
}

async function callGemini(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  agentType?: string
): Promise<string> {
  const client = getGeminiClient();
  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
  });

  const history = messages.slice(0, -1).map((msg) => ({
    role: msg.role === 'user' ? 'user' as const : 'model' as const,
    parts: [{ text: msg.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  const chat = genModel.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);

  // 토큰 사용량 추적 (Gemini)
  const usageMeta = result.response.usageMetadata;
  if (usageMeta) {
    trackTokenUsage(
      'gemini', model, agentType || 'unknown',
      usageMeta.promptTokenCount ?? 0, usageMeta.candidatesTokenCount ?? 0
    );
  }

  return result.response.text();
}
