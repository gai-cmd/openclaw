import dotenv from 'dotenv';
dotenv.config({ override: true });
import { z } from 'zod';

const envSchema = z.object({
  // Telegram - 에이전트별 봇 토큰 (5-Bot 아키텍처)
  TELEGRAM_BOT_TOKEN_PO: z.string().min(1, 'PO bot token required'),
  TELEGRAM_BOT_TOKEN_DEV: z.string().min(1, 'Dev bot token required'),
  TELEGRAM_BOT_TOKEN_DESIGN: z.string().min(1, 'Design bot token required'),
  TELEGRAM_BOT_TOKEN_CS: z.string().min(1, 'CS bot token required'),
  TELEGRAM_BOT_TOKEN_MARKETING: z.string().min(1, 'Marketing bot token required'),

  // 공유 그룹 및 채널
  SHARED_GROUP_ID: z.string().default(''),
  CHANNEL_COMMAND_CENTER: z.string().default(''),
  CHANNEL_STATUS_BOARD: z.string().default(''),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

  // OpenAI (optional)
  OPENAI_API_KEY: z.string().default(''),

  // Google Gemini (optional)
  GEMINI_API_KEY: z.string().default(''),

  // 에이전트별 프로바이더/모델 설정 (anthropic | openai | gemini)
  PO_PROVIDER: z.string().default('anthropic'),
  PO_MODEL: z.string().default('claude-sonnet-4-5-20250929'),
  PO_FAST_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  DEV_PROVIDER: z.string().default('anthropic'),
  DEV_MODEL: z.string().default('claude-sonnet-4-5-20250929'),
  DESIGN_PROVIDER: z.string().default('gemini'),
  DESIGN_MODEL: z.string().default('gemini-2.0-flash'),
  CS_PROVIDER: z.string().default('openai'),
  CS_MODEL: z.string().default('gpt-4o'),
  MARKETING_PROVIDER: z.string().default('openai'),
  MARKETING_MODEL: z.string().default('gpt-4o'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),

  // PostgreSQL
  DATABASE_URL: z.string().default('postgresql://bot_user:bot_password@localhost:5432/multi_agent_bot'),

  // Web API
  API_PORT: z.coerce.number().default(3737),

  // === 외부 플랫폼 연동 (Moltbook + Mersoom) ===
  PLATFORM_ENABLED: z.string().default('true'),
  PLATFORM_CYCLE_MINUTES: z.coerce.number().default(60),

  // Moltbook API tokens (에이전트별)
  MOLTBOOK_TOKEN_PO: z.string().default(''),
  MOLTBOOK_TOKEN_DEV: z.string().default(''),
  MOLTBOOK_TOKEN_DESIGN: z.string().default(''),
  MOLTBOOK_TOKEN_CS: z.string().default(''),
  MOLTBOOK_TOKEN_MARKETING: z.string().default(''),

  // Mersoom 닉네임 (에이전트별, 10자 제한)
  MERSOOM_NICKNAME_PO: z.string().default('이레봇'),
  MERSOOM_NICKNAME_DEV: z.string().default('다온봇'),
  MERSOOM_NICKNAME_DESIGN: z.string().default('채아봇'),
  MERSOOM_NICKNAME_CS: z.string().default('나래봇'),
  MERSOOM_NICKNAME_MARKETING: z.string().default('알리봇'),

  // Mersoom 계정 (선택, 포인트 적립용)
  MERSOOM_AUTH_ID_PO: z.string().default(''),
  MERSOOM_AUTH_ID_DEV: z.string().default(''),
  MERSOOM_AUTH_ID_DESIGN: z.string().default(''),
  MERSOOM_AUTH_ID_CS: z.string().default(''),
  MERSOOM_AUTH_ID_MARKETING: z.string().default(''),
  MERSOOM_PASSWORD_PO: z.string().default(''),
  MERSOOM_PASSWORD_DEV: z.string().default(''),
  MERSOOM_PASSWORD_DESIGN: z.string().default(''),
  MERSOOM_PASSWORD_CS: z.string().default(''),
  MERSOOM_PASSWORD_MARKETING: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ 환경 변수 오류:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

export type AgentType = 'po' | 'dev' | 'design' | 'cs' | 'marketing';

// 역할 타입 (봇 ID와 별개로 세분화된 역할)
export type AgentRole =
  | 'openclaw'        // 중앙 총괄 오케스트레이터 (PO 봇)
  | 'auditor'         // 감사관/보안검사관 (PO 봇 전환)
  | 'dev-architect'   // 시스템 설계, DB 모델링, API 설계
  | 'dev-builder'     // 코드 작성, 기능 구현
  | 'dev-refactor'    // 성능 최적화, 구조 개선
  | 'designer'        // UI 설계, 컴포넌트 구조
  | 'cs-agent'        // 티켓 분류, 긴급도 판단, FAQ
  | 'growth-content'  // 콘텐츠 제작
  | 'growth-funnel'   // 퍼널 최적화, 전환율
  | 'growth-data'     // 데이터 분석, 시장 조사
  | 'qa'              // QA (Phase 4: 별도 봇)
  | 'integrator';     // 통합/배포 (Phase 4: 별도 봇)

// 권한 세트
export interface PermissionSet {
  canModifyCode: boolean;
  canAnalyze: boolean;
  canDeploy: boolean;
  canDispatch: boolean;
  canAccessTickets: boolean;
  canAccessData: boolean;
  canApproveRelease: boolean;
}

// 봇-역할 매핑 설정
export interface BotRoleConfig {
  botToken: AgentType;
  activeRole: AgentRole;
  availableRoles: AgentRole[];
  permissions: PermissionSet;
}

// 에이전트별 봇 토큰 맵
export const BOT_TOKENS: Record<AgentType, string> = {
  po: config.TELEGRAM_BOT_TOKEN_PO,
  dev: config.TELEGRAM_BOT_TOKEN_DEV,
  design: config.TELEGRAM_BOT_TOKEN_DESIGN,
  cs: config.TELEGRAM_BOT_TOKEN_CS,
  marketing: config.TELEGRAM_BOT_TOKEN_MARKETING,
};
