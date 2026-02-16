import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { type AgentType, type AgentRole } from '../config.js';
import {
  callLLM,
  callAnthropicWithTools,
  callOpenAIWithTools,
  callGeminiWithTools,
  AGENT_MODELS,
  PO_FAST_MODEL,
  getErrorSummary,
  getDefaultModel,
  type ProviderType,
} from '../providers/index.js';
import {
  executeTool,
  getOpenAITools,
  getGeminiTools,
  getToolsForAgent,
} from '../tools/index.js';
import { logger } from '../utils/logger.js';
import { ROLE_SYSTEM_PROMPTS, MANDATORY_RULES } from './role-prompts.js';
import { DEFAULT_BOT_ROLES, ROLE_PERMISSIONS, ROLE_DISPLAY_NAMES } from '../config/roles.js';

// ============================================================
// 시스템 프롬프트 (Hub-Spoke 모델)
// ============================================================

// 워크스페이스 경로
const WORKSPACE_BASE = 'D:\\\\projects\\\\miraclro\\\\multi-agent-bot\\\\workspace';

// PO tool description
const PO_TOOL_DESCRIPTION = `
${MANDATORY_RULES}

Running on server. Available tools:
- run_command: Shell (PowerShell). npm, git, python available
- read_file / write_file (auto-creates dirs) / list_directory
- http_request / system_info (CPU, RAM, GPU, disk, OS)
- platform_activity: 외부 AI 커뮤니티(Moltbook/머슴닷컴) 활동 조회/트리거 (status, insights, trigger_cycle)
- dispatch_to_agent: Assign tasks to team → receive results (dev/design/cs/marketing)

Project root: D:\\projects | Workspace: ${WORKSPACE_BASE}
PO output: ${WORKSPACE_BASE}\\po\\{project}\\ | Registry: ${WORKSPACE_BASE}\\shared\\projects.json | Shared: ${WORKSPACE_BASE}\\shared\\

PM rules:
- New project → register in projects.json + create folder + dispatch first tasks
- Always tell workers: "save deliverables via write_file"
- Status check → read projects.json + check team folders → synthesize
- Project changes → update projects.json

You are the HUB of 5-Bot architecture. All bots share one group.
Decompose tasks → dispatch_to_agent → synthesize results → report to user.
Simple questions: answer directly. Specialized tasks: delegate to team.`;

// Worker tool description
const WORKER_TOOL_DESCRIPTION = `
${MANDATORY_RULES}

Running on server. Available tools:
- run_command (PowerShell: npm, git, python)
- read_file / write_file (auto-creates dirs) / list_directory
- http_request
- report_to_po: Report to PO (questions, escalation, collaboration requests)

Project root: D:\\projects | Workspace: ${WORKSPACE_BASE}

ACTION RULES:
1. Execute immediately with tools. Text-only = failure.
2. Order: list_directory → read_file → DO work → write_file → report
3. ALL deliverables MUST be saved via write_file.
4. "I will..." is FORBIDDEN. Do it NOW.
5. Need collaboration? → report_to_po`;

export const SYSTEM_PROMPTS: Record<AgentType, string> = {
  po: `You are IRE (이레) - PO (Product Owner) bot. Central orchestrator.
${PO_TOOL_DESCRIPTION}

Team (dispatch_to_agent targets):
- "dev" → Daon: Software dev, code review, architecture, build/deploy
- "design" → Chaea: UI/UX, wireframes, style guides, CSS
- "cs" → Narae: Customer support, FAQ, VOC, tickets
- "marketing" → Alli: Marketing strategy, content, SEO, market analysis

RULES:
1. First action: read_file("${WORKSPACE_BASE}\\\\shared\\\\projects.json")
2. "Do work" request → read projects.json → find pending → dispatch_to_agent with specific tasks
3. dispatch MUST include: deliverable + save path + completion criteria
4. Never text-only. Always call tools. "I will..." FORBIDDEN.

RESPOND TO USER IN KOREAN (한국어). Be concise and practical.`,

  dev: `You are Daon (다온) - Dev bot. Software engineering specialist.
${WORKER_TOOL_DESCRIPTION}

Workspace: ${WORKSPACE_BASE}\\dev\\

Role: Code generation/review/refactoring, architecture, debugging, testing (npm test, pytest), git ops, build/deploy.
All deliverables (code, design docs, analysis) MUST be saved to workspace via write_file.

RESPOND TO USER IN KOREAN (한국어).`,

  design: `You are Chaea (채아) - Design bot. UI/UX design specialist.
${WORKER_TOOL_DESCRIPTION}

Workspace: ${WORKSPACE_BASE}\\design\\

Role: UI/UX direction, wireframes, design systems, style guides, HTML/CSS implementation, asset management, UX improvement, a11y.
All deliverables (mockups, CSS, wireframes) MUST be saved via write_file.

RESPOND TO USER IN KOREAN (한국어).`,

  cs: `You are Narae (나래) - CS bot. Customer support specialist.
${WORKER_TOOL_DESCRIPTION}

Workspace: ${WORKSPACE_BASE}\\cs\\

Role: Ticket classification, FAQ management, VOC reports, escalation via report_to_po, customer response scenarios, data analysis.
All deliverables (FAQ, VOC reports, scenarios) MUST be saved via write_file.
Be friendly and empathetic. RESPOND TO USER IN KOREAN (한국어).`,

  marketing: `You are Alli (알리) - Marketing bot. Marketing specialist.
${WORKER_TOOL_DESCRIPTION}

Workspace: ${WORKSPACE_BASE}\\marketing\\

Role: Content creation (SNS, blog, email, ad copy), campaign strategy, market analysis, SEO, competitor analysis, performance metrics.
All deliverables (content, strategy docs, reports) MUST be saved via write_file.

RESPOND TO USER IN KOREAN (한국어).`,
};

// ============================================================
// Agentic Agent - Hub-Spoke 모델 기반 통합 클래스
// ============================================================

export class BaseAgent {
  readonly type: AgentType;
  currentRole: AgentRole;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // 현재 유저 대화가 진행 중인 채팅 ID (봇 간 대화를 이 채팅에 표시)
  currentChatId?: string;

  // Anthropic 전용 히스토리 (tool use 포함)
  private anthropicHistory: Anthropic.MessageParam[] = [];
  // OpenAI 전용 히스토리
  private openaiHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  // Gemini 전용 히스토리
  private geminiHistory: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

  constructor(type: AgentType) {
    this.type = type;
    this.currentRole = DEFAULT_BOT_ROLES[type].activeRole;
  }

  // 역할 전환
  switchRole(newRole: AgentRole): boolean {
    const config = DEFAULT_BOT_ROLES[this.type];
    if (!config.availableRoles.includes(newRole)) {
      logger.warn(this.type.toUpperCase(), `역할 전환 실패: ${newRole}는 사용할 수 없습니다 (가능: ${config.availableRoles.join(', ')})`);
      return false;
    }
    const oldRole = this.currentRole;
    this.currentRole = newRole;
    config.activeRole = newRole;
    config.permissions = ROLE_PERMISSIONS[newRole];
    logger.info(this.type.toUpperCase(), `역할 전환: ${ROLE_DISPLAY_NAMES[oldRole]} → ${ROLE_DISPLAY_NAMES[newRole]}`);
    return true;
  }

  // 현재 역할에 맞는 시스템 프롬프트 반환
  getSystemPrompt(): string {
    return ROLE_SYSTEM_PROMPTS[this.currentRole] ?? SYSTEM_PROMPTS[this.type];
  }

  getRoleDisplayName(): string {
    return ROLE_DISPLAY_NAMES[this.currentRole];
  }

  // 메시지 키워드 기반 서브역할 자동 감지
  detectMode(message: string): AgentRole | null {
    const lower = message.toLowerCase();

    if (this.type === 'dev') {
      if (/\[architect\]|설계|아키텍처|구조설계|db\s?모델|api\s?설계|erd/.test(lower)) return 'dev-architect';
      if (/\[build\]|구현|작성|코딩|개발해|만들어|빌드/.test(lower)) return 'dev-builder';
      if (/\[refactor\]|리팩토링|최적화|성능개선|구조\s?개선|클린/.test(lower)) return 'dev-refactor';
    }

    if (this.type === 'marketing') {
      if (/\[content\]|콘텐츠|글\s?작성|카피|블로그|sns/.test(lower)) return 'growth-content';
      if (/\[funnel\]|퍼널|전환율|cta|랜딩|온보딩/.test(lower)) return 'growth-funnel';
      if (/\[data\]|데이터\s?분석|시장\s?조사|경쟁사|트렌드|지표/.test(lower)) return 'growth-data';
    }

    if (this.type === 'po') {
      if (/\[audit\]|감사|보안|취약점|race\s?condition|권한\s?분석/.test(lower)) return 'auditor';
    }

    return null;
  }

  getModelInfo(): string {
    const mc = AGENT_MODELS[this.type];
    if (this.type === 'po') {
      return `${mc.provider}/${mc.model} (fast: ${PO_FAST_MODEL})`;
    }
    return `${mc.provider}/${mc.model}`;
  }

  getProvider(): ProviderType {
    return AGENT_MODELS[this.type].provider;
  }

  // dispatch_to_agent / report_to_po에서 호출 - 도구 없이 단순 텍스트 응답 (순환 방지)
  // PO: Haiku로 빠른 응답 (사용자 질문) / Sonnet으로 분석 (팀원 보고)
  async handleDirectMessage(message: string, senderName: string): Promise<string> {
    this.conversationHistory.push({
      role: 'user',
      content: `[${senderName}] ${message}`,
    });

    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }

    try {
      // PO 듀얼 모델: 팀원 보고 → Sonnet(기본), 사용자/시스템 → Haiku(빠른)
      const isFromWorker = ['다온', '채아', '나래', '알리'].some(name => senderName.includes(name));
      const useModel = (this.type === 'po' && !isFromWorker) ? 'fast' : 'default';

      const assistantMessage = await callLLM(
        this.type,
        this.getSystemPrompt(),
        this.conversationHistory,
        useModel === 'fast' ? 'fast' : undefined
      );

      this.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      });

      logger.info(this.type.toUpperCase(), `Direct response [${useModel}] (${assistantMessage.length} chars)`);
      return assistantMessage;
    } catch (err) {
      logger.error(this.type.toUpperCase(), `Direct message error`, err);
      throw err;
    }
  }

  // 메인 메시지 처리 - 프로바이더에 따라 도구 사용 가능한 agentic 루프
  // PO: Sonnet 사용 (분석/조율 모드)
  // Worker: 설정된 프로바이더/모델 사용
  async handleMessage(message: string, senderName: string): Promise<string> {
    // 자동 모드 감지
    const detectedRole = this.detectMode(message);
    if (detectedRole && detectedRole !== this.currentRole) {
      this.switchRole(detectedRole);
    }

    const provider = this.getProvider();

    // Agentic 모드 폴백 순서: 주 프로바이더 → 다른 프로바이더 Agentic → 텍스트 모드
    const AGENTIC_FALLBACK: Record<ProviderType, ProviderType[]> = {
      anthropic: ['openai', 'gemini'],
      openai: ['anthropic', 'gemini'],
      gemini: ['openai', 'anthropic'],
    };

    // 폴백 시 해당 프로바이더의 기본 모델 사용 (e.g., claude-opus-4-6를 OpenAI에 보내지 않도록)
    const getModelForProvider = (p: ProviderType): string => {
      if (p === provider) return AGENT_MODELS[this.type].model; // 주 프로바이더 → 원래 모델
      return getDefaultModel(p); // 폴백 프로바이더 → 해당 프로바이더 기본 모델
    };

    const tryAgentic = async (p: ProviderType): Promise<string> => {
      const model = getModelForProvider(p);
      switch (p) {
        case 'anthropic': return await this.handleMessageAnthropic(message, senderName, model);
        case 'openai': return await this.handleMessageOpenAI(message, senderName, model);
        case 'gemini': return await this.handleMessageGemini(message, senderName, model);
        default: throw new Error(`Unknown provider: ${p}`);
      }
    };

    // 1차: 주 프로바이더 Agentic
    try {
      return await tryAgentic(provider);
    } catch (err) {
      logger.warn(this.type.toUpperCase(), `Agentic 실패 (${provider}): ${err instanceof Error ? err.message : err}`);
    }

    // 2차: 폴백 프로바이더들의 Agentic 모드 (도구 사용 유지!)
    const fallbacks = AGENTIC_FALLBACK[provider] ?? [];
    for (const fb of fallbacks) {
      try {
        logger.info(this.type.toUpperCase(), `Agentic 폴백 시도: ${provider} → ${fb} (model: ${getModelForProvider(fb)})`);
        return await tryAgentic(fb);
      } catch (fbErr) {
        logger.warn(this.type.toUpperCase(), `Agentic 폴백 실패 (${fb}): ${fbErr instanceof Error ? fbErr.message : fbErr}`);
      }
    }

    // 3차: 최후 수단 - 텍스트 모드 (도구 없음)
    logger.error(this.type.toUpperCase(), `모든 Agentic 프로바이더 실패 → 텍스트 모드 폴백`);
    try {
      return await this.handleDirectMessage(message, senderName);
    } catch (fallbackErr) {
      const summary = getErrorSummary(fallbackErr);
      logger.error(this.type.toUpperCase(), `텍스트 모드도 실패: ${summary}`, fallbackErr);
      return `⚠️ AI 서비스 오류: ${summary}\n모든 프로바이더(Anthropic/OpenAI/Gemini)가 실패했습니다.\n잠시 후 다시 시도해주세요.`;
    }
  }

  async handleTask(taskDescription: string): Promise<string> {
    return this.handleMessage(`[작업 지시] ${taskDescription}`, 'System');
  }

  clearHistory() {
    this.conversationHistory = [];
    this.anthropicHistory = [];
    this.openaiHistory = [];
    this.geminiHistory = [];
  }

  // ============================================================
  // Anthropic Agentic Loop (Claude Tool Use)
  // ============================================================

  private async handleMessageAnthropic(message: string, senderName: string, modelOverride?: string): Promise<string> {
    const historySnapshot = this.anthropicHistory.length;

    this.anthropicHistory.push({
      role: 'user',
      content: `[${senderName}] ${message}`,
    });

    if (this.anthropicHistory.length > 16) {
      this.anthropicHistory = this.anthropicHistory.slice(-16);
    }

    const model = modelOverride ?? AGENT_MODELS[this.type].model;
    // 역할별 도구 세트: PO → dispatch_to_agent, Worker → report_to_po
    const tools = getToolsForAgent(this.type) as Anthropic.Tool[];

    try {
      let response = await callAnthropicWithTools(
        model,
        this.getSystemPrompt(),
        this.anthropicHistory,
        tools,
        this.type
      );

      let iterations = 0;
      const MAX_ITERATIONS = 7;
      let writeFileCalled = false;

      while (response.stop_reason === 'tool_use' && iterations < MAX_ITERATIONS) {
        iterations++;

        this.anthropicHistory.push({
          role: 'assistant',
          content: response.content,
        });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            logger.info(this.type.toUpperCase(), `Tool call: ${block.name} (iteration ${iterations})`);
            if (block.name === 'write_file') writeFileCalled = true;
            const result = await executeTool(
              block.name,
              block.input as Record<string, unknown>,
              this.type
            );
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        this.anthropicHistory.push({
          role: 'user',
          content: toolResults,
        });

        response = await callAnthropicWithTools(
          model,
          this.getSystemPrompt(),
          this.anthropicHistory,
          tools,
          this.type
        );
      }

      // 🚨 write_file 미호출 감지 → 강제 재시도 (PO 제외)
      if (!writeFileCalled && this.type !== 'po' && iterations > 0 && iterations < MAX_ITERATIONS) {
        logger.warn(this.type.toUpperCase(), `write_file 미호출 감지! 강제 재시도`);

        this.anthropicHistory.push({
          role: 'assistant',
          content: response.content,
        });

        this.anthropicHistory.push({
          role: 'user',
          content: '🚨 작업 미완료 감지: write_file로 산출물을 저장하지 않았습니다. 지금 즉시 write_file을 호출하여 작업 결과를 파일로 저장하세요. 파일을 저장하지 않으면 업무 실패로 간주됩니다.',
        });

        for (let retry = 0; retry < 3 && !writeFileCalled; retry++) {
          response = await callAnthropicWithTools(
            model,
            this.getSystemPrompt(),
            this.anthropicHistory,
            tools,
            this.type
          );

          if (response.stop_reason !== 'tool_use') break;

          iterations++;
          this.anthropicHistory.push({
            role: 'assistant',
            content: response.content,
          });

          const retryResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type === 'tool_use') {
              logger.info(this.type.toUpperCase(), `Retry tool call: ${block.name} (retry ${retry + 1})`);
              if (block.name === 'write_file') writeFileCalled = true;
              const result = await executeTool(
                block.name,
                block.input as Record<string, unknown>,
                this.type
              );
              retryResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result,
              });
            }
          }

          this.anthropicHistory.push({
            role: 'user',
            content: retryResults,
          });
        }

        if (!writeFileCalled) {
          logger.error(this.type.toUpperCase(), `write_file 강제 재시도 실패 - 산출물 미저장`);
        }

        // 마지막 텍스트 응답
        response = await callAnthropicWithTools(
          model,
          this.getSystemPrompt(),
          this.anthropicHistory,
          tools,
          this.type
        );
      }

      const finalText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      this.anthropicHistory.push({
        role: 'assistant',
        content: response.content,
      });

      this.syncConversationHistory(message, senderName, finalText);

      logger.info(this.type.toUpperCase(), `Agentic response (${finalText.length} chars, ${iterations} tool calls, writeFile: ${writeFileCalled})`);
      return finalText;
    } catch (err) {
      this.anthropicHistory.length = historySnapshot;
      throw err;
    }
  }

  // ============================================================
  // OpenAI Agentic Loop (Function Calling)
  // ============================================================

  private async handleMessageOpenAI(message: string, senderName: string, modelOverride?: string): Promise<string> {
    const historySnapshot = this.openaiHistory.length;

    this.openaiHistory.push({
      role: 'user',
      content: `[${senderName}] ${message}`,
    });

    if (this.openaiHistory.length > 16) {
      this.openaiHistory = this.openaiHistory.slice(-16);
    }

    const model = modelOverride ?? AGENT_MODELS[this.type].model;
    // 역할별 도구 세트
    const tools = getOpenAITools(getToolsForAgent(this.type));

    try {
      let iterations = 0;
      const MAX_ITERATIONS = 7;
      const FORCE_TOOL_ITERATIONS = 3; // 처음 3회는 반드시 도구 호출 강제
      let writeFileCalled = false;

      // 첫 호출: tool_choice='required'로 반드시 도구 사용 강제
      let response = await callOpenAIWithTools(
        model,
        this.getSystemPrompt(),
        this.openaiHistory,
        tools,
        this.type,
        'required'
      );

      while (response.toolCalls.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: response.text || '',
          tool_calls: response.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
        this.openaiHistory.push(assistantMsg);

        for (const tc of response.toolCalls) {
          logger.info(this.type.toUpperCase(), `Tool call: ${tc.name} (iteration ${iterations})`);
          if (tc.name === 'write_file') writeFileCalled = true;
          const result = await executeTool(tc.name, tc.arguments, this.type);

          this.openaiHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
        }

        // 처음 3회는 tool_choice='required', 이후 'auto'
        const toolChoice = iterations < FORCE_TOOL_ITERATIONS ? 'required' : 'auto';
        response = await callOpenAIWithTools(
          model,
          this.getSystemPrompt(),
          this.openaiHistory,
          tools,
          this.type,
          toolChoice
        );
      }

      // 🚨 write_file 미호출 감지 → 강제 재시도 (PO 제외)
      if (!writeFileCalled && this.type !== 'po' && iterations > 0 && iterations < MAX_ITERATIONS) {
        logger.warn(this.type.toUpperCase(), `write_file 미호출 감지! 강제 재시도 (${iterations} iterations 사용)`);

        // 리마인더 메시지 주입
        this.openaiHistory.push({
          role: 'user',
          content: '[SYSTEM] 🚨 작업 미완료 감지: write_file로 산출물을 저장하지 않았습니다. 지금 즉시 write_file을 호출하여 작업 결과를 파일로 저장하세요. 파일을 저장하지 않으면 업무 실패로 간주됩니다.',
        });

        // write_file 강제 호출 (최대 3회 추가 시도)
        for (let retry = 0; retry < 3 && !writeFileCalled; retry++) {
          response = await callOpenAIWithTools(
            model,
            this.getSystemPrompt(),
            this.openaiHistory,
            tools,
            this.type,
            'required'
          );

          if (response.toolCalls.length > 0) {
            iterations++;
            const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
              role: 'assistant',
              content: response.text || '',
              tool_calls: response.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.arguments),
                },
              })),
            };
            this.openaiHistory.push(assistantMsg);

            for (const tc of response.toolCalls) {
              logger.info(this.type.toUpperCase(), `Retry tool call: ${tc.name} (retry ${retry + 1})`);
              if (tc.name === 'write_file') writeFileCalled = true;
              const result = await executeTool(tc.name, tc.arguments, this.type);
              this.openaiHistory.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: result,
              });
            }
          } else {
            break;
          }
        }

        if (!writeFileCalled) {
          logger.error(this.type.toUpperCase(), `write_file 강제 재시도 실패 - 산출물 미저장`);
        }

        // 마지막 텍스트 응답 가져오기
        response = await callOpenAIWithTools(
          model,
          this.getSystemPrompt(),
          this.openaiHistory,
          tools,
          this.type,
          'auto'
        );
      }

      const finalText = response.text ?? '';

      this.openaiHistory.push({
        role: 'assistant',
        content: finalText,
      });

      this.syncConversationHistory(message, senderName, finalText);

      logger.info(this.type.toUpperCase(), `Agentic response (${finalText.length} chars, ${iterations} tool calls, writeFile: ${writeFileCalled})`);
      return finalText;
    } catch (err) {
      this.openaiHistory.length = historySnapshot;
      throw err;
    }
  }

  // ============================================================
  // Gemini Agentic Loop (Function Calling)
  // ============================================================

  private async handleMessageGemini(message: string, senderName: string, modelOverride?: string): Promise<string> {
    const historySnapshot = this.geminiHistory.length;
    const model = modelOverride ?? AGENT_MODELS[this.type].model;
    // 역할별 도구 세트
    const tools = getGeminiTools(getToolsForAgent(this.type));
    const userMessage = `[${senderName}] ${message}`;

    try {
      let iterations = 0;
      const MAX_ITERATIONS = 7;
      let writeFileCalled = false;

      let response = await callGeminiWithTools(
        model,
        this.getSystemPrompt(),
        this.geminiHistory,
        userMessage,
        tools,
        this.type
      );

      this.geminiHistory.push({
        role: 'user',
        parts: [{ text: userMessage }],
      });

      while (response.toolCalls.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        const modelParts: any[] = [];
        if (response.text) {
          modelParts.push({ text: response.text });
        }
        for (const tc of response.toolCalls) {
          modelParts.push({
            functionCall: { name: tc.name, args: tc.arguments },
          });
        }
        this.geminiHistory.push({ role: 'model', parts: modelParts });

        const functionResponseParts: any[] = [];
        for (const tc of response.toolCalls) {
          logger.info(this.type.toUpperCase(), `Tool call: ${tc.name} (iteration ${iterations})`);
          if (tc.name === 'write_file') writeFileCalled = true;
          const result = await executeTool(tc.name, tc.arguments, this.type);
          functionResponseParts.push({
            functionResponse: { name: tc.name, response: { result } },
          });
        }

        response = await callGeminiWithTools(
          model,
          this.getSystemPrompt(),
          this.geminiHistory,
          functionResponseParts,
          tools,
          this.type
        );

        this.geminiHistory.push({ role: 'user', parts: functionResponseParts });
      }

      // 🚨 write_file 미호출 감지 → 강제 재시도 (PO 제외)
      if (!writeFileCalled && this.type !== 'po' && iterations > 0 && iterations < MAX_ITERATIONS) {
        logger.warn(this.type.toUpperCase(), `write_file 미호출 감지! 강제 재시도`);

        // 리마인더 메시지 주입
        const reminderMessage = '🚨 작업 미완료 감지: write_file로 산출물을 저장하지 않았습니다. 지금 즉시 write_file을 호출하여 작업 결과를 파일로 저장하세요. 파일을 저장하지 않으면 업무 실패로 간주됩니다.';

        for (let retry = 0; retry < 3 && !writeFileCalled; retry++) {
          // 마지막 텍스트 응답이 있으면 모델 히스토리에 추가
          if (response.text) {
            this.geminiHistory.push({ role: 'model', parts: [{ text: response.text }] });
          }

          response = await callGeminiWithTools(
            model,
            this.getSystemPrompt(),
            this.geminiHistory,
            reminderMessage,
            tools,
            this.type
          );
          this.geminiHistory.push({ role: 'user', parts: [{ text: reminderMessage }] });

          if (response.toolCalls.length === 0) break;

          iterations++;
          const modelParts: any[] = [];
          if (response.text) modelParts.push({ text: response.text });
          for (const tc of response.toolCalls) {
            modelParts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          }
          this.geminiHistory.push({ role: 'model', parts: modelParts });

          const retryParts: any[] = [];
          for (const tc of response.toolCalls) {
            logger.info(this.type.toUpperCase(), `Retry tool call: ${tc.name} (retry ${retry + 1})`);
            if (tc.name === 'write_file') writeFileCalled = true;
            const result = await executeTool(tc.name, tc.arguments, this.type);
            retryParts.push({ functionResponse: { name: tc.name, response: { result } } });
          }

          response = await callGeminiWithTools(
            model,
            this.getSystemPrompt(),
            this.geminiHistory,
            retryParts,
            tools,
            this.type
          );
          this.geminiHistory.push({ role: 'user', parts: retryParts });
        }

        if (!writeFileCalled) {
          logger.error(this.type.toUpperCase(), `write_file 강제 재시도 실패 - 산출물 미저장`);
        }
      }

      const finalText = response.text ?? '';

      this.geminiHistory.push({
        role: 'model',
        parts: [{ text: finalText || '(응답 없음)' }],
      });

      if (this.geminiHistory.length > 16) {
        this.geminiHistory = this.geminiHistory.slice(-16);
      }

      this.syncConversationHistory(message, senderName, finalText);

      logger.info(this.type.toUpperCase(), `Agentic response (${finalText.length} chars, ${iterations} tool calls, writeFile: ${writeFileCalled})`);
      return finalText;
    } catch (err) {
      this.geminiHistory.length = historySnapshot;
      throw err;
    }
  }

  // 일반 대화 히스토리 동기화
  private syncConversationHistory(message: string, senderName: string, response: string) {
    this.conversationHistory.push(
      { role: 'user', content: `[${senderName}] ${message}` },
      { role: 'assistant', content: response }
    );
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }
  }
}

// POAgent는 이제 BaseAgent와 동일 (하위 호환용 별칭)
export class POAgent extends BaseAgent {
  constructor() {
    super('po');
  }
}

// ============================================================
// 에이전트 싱글톤 관리
// ============================================================

const agents = new Map<AgentType, BaseAgent>();

export function getAgent(type: AgentType): BaseAgent {
  let agent = agents.get(type);
  if (!agent) {
    agent = type === 'po' ? new POAgent() : new BaseAgent(type);
    agents.set(type, agent);
  }
  return agent;
}

export function getAllAgents(): Map<AgentType, BaseAgent> {
  const types: AgentType[] = ['po', 'dev', 'design', 'cs', 'marketing'];
  for (const type of types) {
    const agent = getAgent(type);
    const role = type === 'po' ? 'HUB' : 'SPOKE';
    logger.info('AGENTS', `  ${type.toUpperCase()} [${role}] ${agent.getRoleDisplayName()} → ${agent.getModelInfo()}`);
  }
  return agents;
}
