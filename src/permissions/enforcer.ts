import type { AgentType, PermissionSet } from '../config.js';
import { DEFAULT_BOT_ROLES } from '../config/roles.js';
import { logger } from '../utils/logger.js';

// ============================================================
// 도구 → 권한 매핑
// ============================================================

const TOOL_PERMISSION_MAP: Record<string, keyof PermissionSet> = {
  // write_file: 경로 기반으로 별도 체크 (아래 로직)
  dispatch_to_agent: 'canDispatch',
};

// ============================================================
// write_file 경로 기반 권한 체크
// ============================================================
// - 워크스페이스 경로 (workspace/) → 모든 에이전트 허용 (산출물 저장)
// - 소스코드 경로 (src/, *.ts, *.js 등) → canModifyCode 필요

const WORKSPACE_PATH_PATTERNS = [
  /[/\\]workspace[/\\]/i,
  /[/\\]workspace$/i,
];

const SOURCE_CODE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.sh', '.bat', '.ps1',
];

function isWorkspacePath(filePath: string): boolean {
  return WORKSPACE_PATH_PATTERNS.some(p => p.test(filePath));
}

function isSourceCodePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return SOURCE_CODE_EXTENSIONS.some(ext => lower.endsWith(ext)) ||
    /[/\\]src[/\\]/i.test(filePath);
}

// run_command는 특별 처리: canModifyCode가 없으면 읽기전용만 허용
const READ_ONLY_COMMAND_PATTERNS = [
  /^(cat|type|head|tail|less|more)\s/i,
  /^(ls|dir)\s/i,
  /^Get-ChildItem/i,
  /^Get-Content/i,
  /^git\s+(log|status|diff|show|blame|branch|remote|tag)/i,
  /^(find|rg|grep)\s/i,
  /^npm\s+(ls|list|audit|outdated|view|info)\s/i,
  /^(node|npx|tsx)\s+--version/i,
  /^(echo|Write-Output)/i,
  /^pwd/i,
  /^whoami/i,
  /^(wc|sort|uniq)\s/i,
];

function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  return READ_ONLY_COMMAND_PATTERNS.some(p => p.test(trimmed));
}

// ============================================================
// 권한 체크 함수
// ============================================================

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export function canExecuteTool(
  agentType: AgentType,
  toolName: string,
  toolInput?: Record<string, unknown>
): PermissionCheckResult {
  const roleConfig = DEFAULT_BOT_ROLES[agentType];
  if (!roleConfig) {
    return { allowed: false, reason: `알 수 없는 에이전트: ${agentType}` };
  }

  const permissions = roleConfig.permissions;

  // write_file: 경로 기반 권한 체크
  if (toolName === 'write_file') {
    const filePath = toolInput?.path as string | undefined;
    if (filePath) {
      // 워크스페이스 경로 → 항상 허용 (모든 에이전트가 산출물 저장)
      if (isWorkspacePath(filePath)) {
        return { allowed: true };
      }
      // 소스코드 경로 → canModifyCode 필요
      if (isSourceCodePath(filePath) && !permissions.canModifyCode) {
        return {
          allowed: false,
          reason: `${roleConfig.activeRole} 역할은 소스코드를 수정할 수 없습니다. 워크스페이스(workspace/)에만 저장 가능합니다. (시도한 경로: ${filePath.slice(-60)})`,
        };
      }
    }
    // 기타 경로 (txt, md, json, csv 등) → canModifyCode 없어도 허용
    return { allowed: true };
  }

  // run_command: 특별 처리
  if (toolName === 'run_command') {
    if (!permissions.canModifyCode) {
      // canAnalyze 또는 canAccessData → 읽기전용 명령만 허용
      if (permissions.canAnalyze || permissions.canAccessData) {
        const command = toolInput?.command as string | undefined;
        if (command && !isReadOnlyCommand(command)) {
          return {
            allowed: false,
            reason: `${roleConfig.activeRole} 역할은 읽기전용 명령만 실행할 수 있습니다. (차단된 명령: ${command.slice(0, 50)})`,
          };
        }
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `${roleConfig.activeRole} 역할은 명령 실행 권한이 없습니다.`,
      };
    }
    return { allowed: true };
  }

  // 일반 도구: 매핑된 권한 체크
  const requiredPermission = TOOL_PERMISSION_MAP[toolName];
  if (!requiredPermission) {
    // 매핑 없는 도구 (read_file, list_directory, http_request, system_info 등) → 허용
    return { allowed: true };
  }

  if (!permissions[requiredPermission]) {
    return {
      allowed: false,
      reason: `${roleConfig.activeRole} 역할은 ${toolName} 도구 사용 권한이 없습니다 (필요 권한: ${requiredPermission})`,
    };
  }

  return { allowed: true };
}
