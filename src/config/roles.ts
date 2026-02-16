import type { AgentType, AgentRole, PermissionSet, BotRoleConfig } from '../config.js';

// ============================================================
// 역할별 권한 매트릭스
// ============================================================

export const ROLE_PERMISSIONS: Record<AgentRole, PermissionSet> = {
  // 중앙 총괄 - 분석/조율/승인 권한
  openclaw: {
    canModifyCode: false,
    canAnalyze: true,
    canDeploy: false,
    canDispatch: true,
    canAccessTickets: true,
    canAccessData: true,
    canApproveRelease: true,
  },
  // 감사관 - 분석만, 수정 불가
  auditor: {
    canModifyCode: false,
    canAnalyze: true,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: true,
    canApproveRelease: false,
  },
  // Dev Architect - 설계/분석만
  'dev-architect': {
    canModifyCode: false,
    canAnalyze: true,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: false,
    canApproveRelease: false,
  },
  // Dev Builder - 코드 작성
  'dev-builder': {
    canModifyCode: true,
    canAnalyze: false,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: false,
    canApproveRelease: false,
  },
  // Dev Refactor - 코드 수정 + 분석
  'dev-refactor': {
    canModifyCode: true,
    canAnalyze: true,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: false,
    canApproveRelease: false,
  },
  // Designer - 분석만, 코드 수정 금지
  designer: {
    canModifyCode: false,
    canAnalyze: true,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: false,
    canApproveRelease: false,
  },
  // CS Agent - 티켓 접근
  'cs-agent': {
    canModifyCode: false,
    canAnalyze: false,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: true,
    canAccessData: false,
    canApproveRelease: false,
  },
  // Growth Content
  'growth-content': {
    canModifyCode: false,
    canAnalyze: false,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: true,
    canApproveRelease: false,
  },
  // Growth Funnel
  'growth-funnel': {
    canModifyCode: false,
    canAnalyze: false,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: true,
    canApproveRelease: false,
  },
  // Growth Data
  'growth-data': {
    canModifyCode: false,
    canAnalyze: false,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: true,
    canApproveRelease: false,
  },
  // QA (Phase 4)
  qa: {
    canModifyCode: false,
    canAnalyze: true,
    canDeploy: false,
    canDispatch: false,
    canAccessTickets: false,
    canAccessData: false,
    canApproveRelease: false,
  },
  // Integrator (Phase 4)
  integrator: {
    canModifyCode: true,
    canAnalyze: true,
    canDeploy: true,
    canDispatch: true,
    canAccessTickets: false,
    canAccessData: false,
    canApproveRelease: true,
  },
};

// ============================================================
// 봇 → 역할 기본 매핑 (5봇 체제)
// ============================================================

export const DEFAULT_BOT_ROLES: Record<AgentType, BotRoleConfig> = {
  po: {
    botToken: 'po',
    activeRole: 'openclaw',
    availableRoles: ['openclaw', 'auditor'],
    permissions: ROLE_PERMISSIONS['openclaw'],
  },
  dev: {
    botToken: 'dev',
    activeRole: 'dev-builder',
    availableRoles: ['dev-architect', 'dev-builder', 'dev-refactor'],
    permissions: ROLE_PERMISSIONS['dev-builder'],
  },
  design: {
    botToken: 'design',
    activeRole: 'designer',
    availableRoles: ['designer'],
    permissions: ROLE_PERMISSIONS['designer'],
  },
  cs: {
    botToken: 'cs',
    activeRole: 'cs-agent',
    availableRoles: ['cs-agent'],
    permissions: ROLE_PERMISSIONS['cs-agent'],
  },
  marketing: {
    botToken: 'marketing',
    activeRole: 'growth-content',
    availableRoles: ['growth-content', 'growth-funnel', 'growth-data'],
    permissions: ROLE_PERMISSIONS['growth-content'],
  },
};

// ============================================================
// 역할 전환 유틸리티
// ============================================================

export function switchBotRole(agentType: AgentType, newRole: AgentRole): boolean {
  const config = DEFAULT_BOT_ROLES[agentType];
  if (!config.availableRoles.includes(newRole)) {
    return false;
  }
  config.activeRole = newRole;
  config.permissions = ROLE_PERMISSIONS[newRole];
  return true;
}

export function getActiveRole(agentType: AgentType): AgentRole {
  return DEFAULT_BOT_ROLES[agentType].activeRole;
}

export function getPermissions(agentType: AgentType): PermissionSet {
  return DEFAULT_BOT_ROLES[agentType].permissions;
}

// 역할의 한국어 표시명
export const ROLE_DISPLAY_NAMES: Record<AgentRole, string> = {
  openclaw: 'OpenClaw (총괄)',
  auditor: '이레 (감사관)',
  'dev-architect': '다온 (아키텍트)',
  'dev-builder': '다온 (빌더)',
  'dev-refactor': '다온 (리팩터)',
  designer: '채아 (디자이너)',
  'cs-agent': '나래 (CS)',
  'growth-content': '알리 (콘텐츠)',
  'growth-funnel': '알리 (퍼널)',
  'growth-data': '알리 (데이터)',
  qa: 'QA Bot',
  integrator: 'Integrator Bot',
};
