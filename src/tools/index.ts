import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';
import { canExecuteTool } from '../permissions/enforcer.js';
import { tryExtractAndValidateReport } from '../reports/report-format.js';
import { pipeline, STAGE_DISPLAY_NAMES, type PipelineStage } from '../pipeline/pipeline-engine.js';
import { ticketSystem } from '../tickets/ticket-system.js';
import type { AgentType, AgentRole } from '../config.js';

const execAsync = promisify(exec);

// ============================================================
// 도구 타입 정의
// ============================================================

type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

// ============================================================
// 공통 도구 (모든 에이전트 공유)
// ============================================================

const BASE_TOOLS: ToolDef[] = [
  {
    name: 'run_command',
    description: '서버에서 셸 명령을 실행합니다. PowerShell/cmd 명령을 실행할 수 있습니다. npm, git, python 등 개발 도구도 사용 가능합니다. 위험한 명령(rm -rf, format 등)은 차단됩니다.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '실행할 셸 명령',
        },
        cwd: {
          type: 'string',
          description: '작업 디렉토리 (기본: D:\\projects)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: '파일 내용을 읽습니다. 코드, 문서, 설정 파일 등을 읽을 수 있습니다.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '읽을 파일의 절대 경로',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '파일에 내용을 씁니다. 코드 작성, 문서 생성, 보고서 저장 등에 사용합니다. 디렉토리가 없으면 자동 생성합니다.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '쓸 파일의 절대 경로',
        },
        content: {
          type: 'string',
          description: '파일에 쓸 내용',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: '디렉토리의 파일/폴더 목록을 봅니다.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '조회할 디렉토리 경로',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'http_request',
    description: 'HTTP 요청을 보냅니다. 웹 페이지 조회, 외부 API 호출, 웹 서핑에 사용합니다.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '요청 URL',
        },
        method: {
          type: 'string',
          description: 'HTTP 메서드 (GET, POST, PUT, DELETE)',
          enum: ['GET', 'POST', 'PUT', 'DELETE'],
        },
        headers: {
          type: 'object',
          description: '요청 헤더 (JSON)',
        },
        body: {
          type: 'string',
          description: '요청 바디 (POST/PUT용)',
        },
      },
      required: ['url', 'method'],
    },
  },
];

// ============================================================
// 시스템 정보 조회 도구
// ============================================================

const SYSTEM_INFO_TOOL: ToolDef = {
  name: 'system_info',
  description: '서버 컴퓨터의 하드웨어/소프트웨어 사양을 조회합니다. CPU, RAM, GPU, 디스크, OS 등 시스템 정보를 확인할 수 있습니다.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: '조회할 카테고리 (all: 전체, cpu: CPU, memory: 메모리, gpu: GPU, disk: 디스크, os: OS 정보, network: 네트워크)',
        enum: ['all', 'cpu', 'memory', 'gpu', 'disk', 'os', 'network'],
      },
    },
    required: ['category'],
  },
};

// ============================================================
// PO 전용 도구: dispatch_to_agent (워커에게 작업 지시)
// ============================================================

const DISPATCH_TO_AGENT_TOOL: ToolDef = {
  name: 'dispatch_to_agent',
  description: '팀원 에이전트에게 작업을 지시하고 결과를 받습니다. PO(이레)만 사용 가능합니다. 복잡한 작업을 분배하거나 전문 분야의 도움이 필요할 때 사용하세요. mode를 지정하면 해당 서브역할로 전환 후 작업합니다.',
  input_schema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: '대상 에이전트',
        enum: ['dev', 'design', 'cs', 'marketing'],
      },
      message: {
        type: 'string',
        description: '작업 지시 내용',
      },
      mode: {
        type: 'string',
        description: '서브역할 모드 (선택). dev: architect/builder/refactor, marketing: content/funnel/data',
        enum: ['architect', 'builder', 'refactor', 'content', 'funnel', 'data'],
      },
    },
    required: ['agent', 'message'],
  },
};

// ============================================================
// PO 전용 도구: platform_activity (외부 플랫폼 활동 조회/트리거)
// ============================================================

const PLATFORM_ACTIVITY_TOOL: ToolDef = {
  name: 'platform_activity',
  description: '외부 AI 커뮤니티(Moltbook/머슴닷컴) 활동을 조회하거나 수동으로 트리거합니다. 일일 활동 요약, 학습 인사이트 확인, 수동 글 작성 트리거가 가능합니다.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'insights', 'trigger_cycle'],
        description: 'status: 일일 활동 요약, insights: 학습 인사이트 확인, trigger_cycle: 특정 에이전트의 활동 사이클 수동 실행',
      },
      platform: {
        type: 'string',
        enum: ['moltbook', 'mersoom'],
        description: '플랫폼 (trigger_cycle 시 필수)',
      },
      agent: {
        type: 'string',
        enum: ['po', 'dev', 'design', 'cs', 'marketing'],
        description: '에이전트 (trigger_cycle 시 필수)',
      },
    },
    required: ['action'],
  },
};

// ============================================================
// 워커 전용 도구: report_to_po (PO에게 보고)
// ============================================================

const REPORT_TO_PO_TOOL: ToolDef = {
  name: 'report_to_po',
  description: 'PO(이레)에게 보고합니다. 작업 결과 보고, 질문, 에스컬레이션, 다른 팀원과의 협업 요청 시 사용합니다. 다른 팀원에게 직접 연락할 수 없으므로 PO를 통해 요청하세요.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'PO에게 보고할 내용',
      },
    },
    required: ['message'],
  },
};

// ============================================================
// 티켓 도구 (CS / OpenClaw 전용)
// ============================================================

const CREATE_TICKET_TOOL: ToolDef = {
  name: 'create_ticket',
  description: '고객 문의/이슈 티켓을 생성합니다. 카테고리와 우선순위는 자동 분류됩니다.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '티켓 제목' },
      description: { type: 'string', description: '상세 내용' },
      customerName: { type: 'string', description: '고객 이름' },
      category: {
        type: 'string', description: '카테고리 (자동 분류됨)',
        enum: ['bug', 'feature', 'inquiry', 'complaint', 'improvement', 'other'],
      },
      priority: {
        type: 'string', description: '우선순위 (자동 분류됨)',
        enum: ['urgent', 'high', 'normal', 'low'],
      },
    },
    required: ['title', 'description', 'customerName'],
  },
};

const ESCALATE_TICKET_TOOL: ToolDef = {
  name: 'escalate_ticket',
  description: '티켓을 Dev 파이프라인으로 에스컬레이션합니다. 기술적 문제가 확인되었을 때 사용합니다.',
  input_schema: {
    type: 'object',
    properties: {
      ticketId: { type: 'string', description: '에스컬레이션할 티켓 ID (예: TK-0001)' },
      reason: { type: 'string', description: '에스컬레이션 사유' },
    },
    required: ['ticketId', 'reason'],
  },
};

const LIST_TICKETS_TOOL: ToolDef = {
  name: 'list_tickets',
  description: '티켓 목록을 조회합니다. 필터 없으면 전체 현황을 보여줍니다.',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string', description: '상태 필터',
        enum: ['open', 'in_progress', 'escalated', 'resolved', 'closed'],
      },
    },
    required: [],
  },
};

// ============================================================
// 칸반 도구 (에이전트 프로그래밍 API)
// ============================================================

const KANBAN_CREATE_TASK_TOOL: ToolDef = {
  name: 'kanban_create_task',
  description: '칸반 보드에 새 Task를 생성합니다. PO(이레)만 사용 가능. Task ID가 자동 생성됩니다 (예: KAN-P2FE-001).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Task 제목' },
      description: { type: 'string', description: 'Task 상세 설명' },
      projectCode: { type: 'string', description: '프로젝트 코드 (예: KAN, FXT, LIO)' },
      phase: { type: 'string', description: '단계', enum: ['P0', 'P1', 'P2', 'P3', 'P4'] },
      domain: { type: 'string', description: '영역', enum: ['DOC', 'UI', 'FE', 'BE', 'DB', 'QA', 'OPS', 'MKT'] },
      assignee: { type: 'string', description: '담당 에이전트', enum: ['po', 'dev', 'design', 'cs', 'marketing'] },
      priority: { type: 'string', description: '우선순위 (기본: medium)', enum: ['critical', 'high', 'medium', 'low'] },
    },
    required: ['title', 'description', 'projectCode', 'phase', 'domain', 'assignee'],
  },
};

const KANBAN_UPDATE_TASK_TOOL: ToolDef = {
  name: 'kanban_update_task',
  description: '칸반 Task의 상태/진행률을 업데이트합니다. 모든 에이전트가 자신에게 배정된 Task를 업데이트할 수 있습니다.',
  input_schema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID (예: KAN-P2FE-001)' },
      status: { type: 'string', description: '상태 변경', enum: ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'] },
      progress: { type: 'number', description: '진행률 (0~100)' },
      blockers: { type: 'string', description: '차단 사유' },
      result: { type: 'string', description: '작업 결과 요약' },
      outputFiles: { type: 'array', items: { type: 'string' }, description: '산출물 파일 경로 목록' },
    },
    required: ['taskId'],
  },
};

const KANBAN_QUERY_TASKS_TOOL: ToolDef = {
  name: 'kanban_query_tasks',
  description: '칸반 Task를 조회합니다. 필터를 조합하여 원하는 Task만 볼 수 있습니다.',
  input_schema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: '프로젝트 코드 필터' },
      phase: { type: 'string', description: '단계 필터', enum: ['P0', 'P1', 'P2', 'P3', 'P4'] },
      assignee: { type: 'string', description: '담당자 필터', enum: ['po', 'dev', 'design', 'cs', 'marketing'] },
      status: { type: 'string', description: '상태 필터', enum: ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'] },
      domain: { type: 'string', description: '영역 필터', enum: ['DOC', 'UI', 'FE', 'BE', 'DB', 'QA', 'OPS', 'MKT'] },
    },
    required: [],
  },
};

const KANBAN_BOARD_TOOL: ToolDef = {
  name: 'kanban_board',
  description: '프로젝트의 칸반 보드 현황을 조회합니다. 6컬럼(Backlog/ToDo/InProgress/Review/Done/Blocked)으로 보여줍니다.',
  input_schema: {
    type: 'object',
    properties: {
      projectCode: { type: 'string', description: '프로젝트 코드 (예: KAN)' },
    },
    required: ['projectCode'],
  },
};

const KANBAN_GATE_REQUEST_TOOL: ToolDef = {
  name: 'kanban_gate_request',
  description: 'Stage Gate 검증을 요청합니다. 특정 프로젝트의 Phase 완료 여부를 AI가 자동 검증하고, PO 승인 대기 상태로 전환합니다. PO만 사용 가능.',
  input_schema: {
    type: 'object',
    properties: {
      projectCode: { type: 'string', description: '프로젝트 코드' },
      phase: { type: 'string', description: '검증할 Phase', enum: ['P0', 'P1', 'P2', 'P3', 'P4'] },
    },
    required: ['projectCode', 'phase'],
  },
};

const KANBAN_GATE_APPROVE_TOOL: ToolDef = {
  name: 'kanban_gate_approve',
  description: 'Stage Gate를 승인 또는 반려합니다. AI 검증을 통과한 Gate에 대해 PO가 최종 판단합니다. PO만 사용 가능.',
  input_schema: {
    type: 'object',
    properties: {
      projectCode: { type: 'string', description: '프로젝트 코드' },
      phase: { type: 'string', description: '승인/반려할 Phase', enum: ['P0', 'P1', 'P2', 'P3', 'P4'] },
      approved: { type: 'boolean', description: 'true=승인, false=반려' },
      notes: { type: 'string', description: 'PO 코멘트' },
    },
    required: ['projectCode', 'phase', 'approved'],
  },
};

// ============================================================
// 파이프라인 도구 (OpenClaw 전용)
// ============================================================

const PIPELINE_TRANSITION_TOOL: ToolDef = {
  name: 'pipeline_transition',
  description: '파이프라인 아이템의 스테이지를 전이합니다. OpenClaw만 사용 가능합니다.',
  input_schema: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: '파이프라인 아이템 ID (예: PL-0001)' },
      toStage: {
        type: 'string', description: '이동할 스테이지',
        enum: ['intake', 'triage', 'build', 'qa', 'audit', 'integrate', 'release', 'closed'],
      },
      reason: { type: 'string', description: '전이 사유' },
    },
    required: ['itemId', 'toStage', 'reason'],
  },
};

// ============================================================
// 역할별 도구 세트 (Hub-Spoke 모델)
// ============================================================

// run_command 제외한 기본 도구 (명령 실행 불가 에이전트용)
const BASE_TOOLS_NO_CMD: ToolDef[] = BASE_TOOLS.filter(t => t.name !== 'run_command');

export const PO_TOOLS: ToolDef[] = [
  ...BASE_TOOLS, SYSTEM_INFO_TOOL, DISPATCH_TO_AGENT_TOOL,
  PIPELINE_TRANSITION_TOOL, LIST_TICKETS_TOOL,
  KANBAN_CREATE_TASK_TOOL, KANBAN_UPDATE_TASK_TOOL, KANBAN_QUERY_TASKS_TOOL,
  KANBAN_BOARD_TOOL, KANBAN_GATE_REQUEST_TOOL, KANBAN_GATE_APPROVE_TOOL,
  PLATFORM_ACTIVITY_TOOL,
];
// Dev: 모든 기본 도구 + PO 보고 + 칸반 조회/업데이트
export const DEV_TOOLS: ToolDef[] = [
  ...BASE_TOOLS, REPORT_TO_PO_TOOL,
  KANBAN_UPDATE_TASK_TOOL, KANBAN_QUERY_TASKS_TOOL, KANBAN_BOARD_TOOL,
];
// Wireframe: pencil.dev (.pen) 형식 와이어프레임 생성
const CREATE_WIREFRAME_TOOL: ToolDef = {
  name: 'create_wireframe',
  description: 'pencil.dev (.pen) 형식의 와이어프레임 파일을 생성합니다. JSON 기반 벡터 그래픽 포맷으로, VS Code에서 pencil.dev로 열어 확인/편집할 수 있습니다.',
  input_schema: {
    type: 'object',
    properties: {
      projectName: { type: 'string', description: '프로젝트 이름 (예: "login-flow", "dashboard")' },
      filename: { type: 'string', description: '와이어프레임 파일명 (.pen 확장자 제외, 예: "login-page")' },
      penJson: { type: 'string', description: '.pen 형식 JSON 문자열. version과 children 필드 필수. 예: {"version":"1.0","children":[...]}' },
    },
    required: ['projectName', 'filename', 'penJson'],
  },
};

// Design: run_command 포함 (읽기전용만 허용, canAnalyze=true) + 와이어프레임 + 칸반
export const DESIGN_TOOLS: ToolDef[] = [
  ...BASE_TOOLS, REPORT_TO_PO_TOOL, CREATE_WIREFRAME_TOOL,
  KANBAN_UPDATE_TASK_TOOL, KANBAN_QUERY_TASKS_TOOL, KANBAN_BOARD_TOOL,
];
// CS: run_command 제외 (canModifyCode=false, canAnalyze=false → 전면 차단) + 칸반
export const CS_TOOLS: ToolDef[] = [
  ...BASE_TOOLS_NO_CMD, REPORT_TO_PO_TOOL,
  CREATE_TICKET_TOOL, ESCALATE_TICKET_TOOL, LIST_TICKETS_TOOL,
  KANBAN_UPDATE_TASK_TOOL, KANBAN_QUERY_TASKS_TOOL, KANBAN_BOARD_TOOL,
];
// Marketing: run_command 제외 + 칸반
export const MARKETING_TOOLS: ToolDef[] = [
  ...BASE_TOOLS_NO_CMD, REPORT_TO_PO_TOOL,
  KANBAN_UPDATE_TASK_TOOL, KANBAN_QUERY_TASKS_TOOL, KANBAN_BOARD_TOOL,
];

// 하위 호환용
export const WORKER_TOOLS = DEV_TOOLS;
export const AGENT_TOOLS = PO_TOOLS;

// 에이전트 타입에 따라 적절한 도구 세트 반환
export function getToolsForAgent(agentType: string): ToolDef[] {
  switch (agentType) {
    case 'po': return PO_TOOLS;
    case 'dev': return DEV_TOOLS;
    case 'design': return DESIGN_TOOLS;
    case 'cs': return CS_TOOLS;
    case 'marketing': return MARKETING_TOOLS;
    default: return MARKETING_TOOLS;
  }
}

// ============================================================
// OpenAI function calling 형식 변환
// ============================================================

export function getOpenAITools(tools: ToolDef[] = PO_TOOLS) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

// ============================================================
// Gemini function calling 형식 변환
// ============================================================

export function getGeminiTools(tools: ToolDef[] = PO_TOOLS) {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      })),
    },
  ];
}

// ============================================================
// 도구 실행
// ============================================================

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  callerAgent?: string // 호출한 에이전트 타입 (순환 방지용)
): Promise<string> {
  logger.info('TOOLS', `Executing: ${toolName} (caller: ${callerAgent ?? 'unknown'})`);

  // 권한 체크
  if (callerAgent) {
    const check = canExecuteTool(callerAgent as AgentType, toolName, input);
    if (!check.allowed) {
      logger.warn('PERMISSION', `Blocked: ${callerAgent} → ${toolName} - ${check.reason}`);
      return `Permission denied: ${check.reason}`;
    }
  }

  try {
    switch (toolName) {
      case 'run_command':
        return await runCommand(input.command as string, input.cwd as string | undefined);
      case 'read_file':
        return await readFileContent(input.path as string);
      case 'write_file':
        return await writeFileContent(input.path as string, input.content as string);
      case 'list_directory':
        return await listDir(input.path as string);
      case 'http_request':
        return await httpRequest(
          input.url as string,
          input.method as string,
          input.headers as Record<string, string> | undefined,
          input.body as string | undefined
        );
      case 'system_info':
        return await getSystemInfo(input.category as string);
      case 'platform_activity':
        return await handlePlatformActivity(
          input.action as string,
          input.platform as string | undefined,
          input.agent as string | undefined,
        );
      case 'dispatch_to_agent':
        return await dispatchToAgent(
          input.agent as string,
          input.message as string,
          callerAgent,
          input.mode as string | undefined
        );
      case 'report_to_po':
        return await reportToPo(
          input.message as string,
          callerAgent
        );
      case 'create_ticket':
        return await createTicket(
          input.title as string,
          input.description as string,
          input.customerName as string,
          input.category as string | undefined,
          input.priority as string | undefined
        );
      case 'escalate_ticket':
        return await escalateTicket(
          input.ticketId as string,
          input.reason as string
        );
      case 'list_tickets':
        return await listTicketsAction(input.status as string | undefined);
      case 'pipeline_transition':
        return await pipelineTransitionAction(
          input.itemId as string,
          input.toStage as string,
          input.reason as string,
          callerAgent
        );
      case 'create_wireframe':
        return await createWireframe(
          input.projectName as string,
          input.filename as string,
          input.penJson as string
        );
      // --- 칸반 도구 ---
      case 'kanban_create_task':
        return await kanbanCreateTask(input, callerAgent);
      case 'kanban_update_task':
        return await kanbanUpdateTask(input, callerAgent);
      case 'kanban_query_tasks':
        return await kanbanQueryTasks(input);
      case 'kanban_board':
        return await kanbanBoardAction(input.projectCode as string);
      case 'kanban_gate_request':
        return await kanbanGateRequest(input.projectCode as string, input.phase as string, callerAgent);
      case 'kanban_gate_approve':
        return await kanbanGateApprove(
          input.projectCode as string,
          input.phase as string,
          input.approved as boolean,
          input.notes as string | undefined,
          callerAgent
        );
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('TOOLS', `${toolName} failed: ${msg}`);
    return `Error: ${msg}`;
  }
}

// ============================================================
// 도구 구현
// ============================================================

const BLOCKED_PATTERNS = [
  /rm\s+-rf/i, /format\s+[a-z]:/i, /del\s+\/[sq]/i,
  /shutdown/i, /restart/i, /taskkill.*system/i,
  /Remove-Item\s+-Recurse\s+-Force\s+[A-Z]:\\/i,
];

async function runCommand(command: string, cwd?: string): Promise<string> {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked: 위험한 명령이 감지되었습니다 (${command})`;
    }
  }

  const { stdout, stderr } = await execAsync(command, {
    cwd: cwd || 'D:\\projects',
    timeout: 60000, // 60초로 확장
    maxBuffer: 1024 * 1024 * 5, // 5MB
    shell: 'powershell.exe',
  });

  const output = (stdout + (stderr ? `\nSTDERR: ${stderr}` : '')).trim();
  return output.length > 5000 ? output.slice(0, 5000) + '\n...(truncated)' : output;
}

async function readFileContent(path: string): Promise<string> {
  const content = await readFile(path, 'utf-8');
  return content.length > 5000 ? content.slice(0, 5000) + '\n...(truncated)' : content;
}

async function writeFileContent(path: string, content: string): Promise<string> {
  // 디렉토리 자동 생성
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
  return `File written: ${path} (${content.length} chars)`;
}

// pencil.dev 와이어프레임 생성
async function createWireframe(
  projectName: string,
  filename: string,
  penJson: string
): Promise<string> {
  if (!projectName?.trim()) return 'Error: projectName이 비어있습니다.';
  if (!filename?.trim()) return 'Error: filename이 비어있습니다.';
  if (!penJson?.trim()) return 'Error: penJson이 비어있습니다.';

  let penObject: Record<string, unknown>;
  try {
    penObject = JSON.parse(penJson);
  } catch (err) {
    return `Error: 유효하지 않은 JSON 형식입니다. ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!penObject.version) {
    penObject.version = '1.0';
  }
  if (!Array.isArray(penObject.children)) {
    return 'Error: .pen JSON에는 "children" 배열이 필수입니다.';
  }

  const sanitize = (name: string) => name.replace(/[<>:"/\\|?*]/g, '_').trim();
  const penPath = join(
    'D:\\projects\\miraclro\\multi-agent-bot\\workspace\\design',
    sanitize(projectName),
    'wireframes',
    `${sanitize(filename)}.pen`
  );

  const content = JSON.stringify(penObject, null, 2);
  await writeFileContent(penPath, content);

  const elementCount = penObject.children.length;
  return `✅ 와이어프레임 생성 완료\n📁 프로젝트: ${projectName}\n📄 파일: ${filename}.pen\n📍 경로: ${penPath}\n🧩 최상위 요소: ${elementCount}개`;
}

async function listDir(path: string): Promise<string> {
  const entries = await readdir(path);
  const details: string[] = [];

  for (const entry of entries.slice(0, 50)) {
    try {
      const fullPath = join(path, entry);
      const s = await stat(fullPath);
      const type = s.isDirectory() ? '[DIR]' : `[${(s.size / 1024).toFixed(1)}KB]`;
      details.push(`${type} ${entry}`);
    } catch {
      details.push(`[?] ${entry}`);
    }
  }

  return details.join('\n') + (entries.length > 50 ? `\n...and ${entries.length - 50} more` : '');
}

async function httpRequest(
  url: string,
  method: string,
  headers?: Record<string, string>,
  body?: string
): Promise<string> {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = body;
  }

  const response = await fetch(url, options);
  const text = await response.text();

  return `HTTP ${response.status} ${response.statusText}\n${text.length > 5000 ? text.slice(0, 5000) + '...(truncated)' : text}`;
}

// ============================================================
// 시스템 정보 조회 구현
// ============================================================

const SYSTEM_INFO_COMMANDS: Record<string, string> = {
  cpu: `Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, CurrentClockSpeed | Format-List`,
  memory: `$os = Get-CimInstance Win32_OperatingSystem; $mem = Get-CimInstance Win32_PhysicalMemory; Write-Output "=== 메모리 요약 ==="; Write-Output "총 물리 메모리: $([math]::Round($os.TotalVisibleMemorySize/1MB, 2)) GB"; Write-Output "사용 가능 메모리: $([math]::Round($os.FreePhysicalMemory/1MB, 2)) GB"; Write-Output "사용 중: $([math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB, 2)) GB"; Write-Output ""; Write-Output "=== 메모리 슬롯 ==="; $mem | Select-Object Manufacturer, Capacity, Speed, ConfiguredClockSpeed, DeviceLocator | ForEach-Object { Write-Output "- $($_.DeviceLocator): $([math]::Round($_.Capacity/1GB, 2)) GB, $($_.Speed) MHz, $($_.Manufacturer)" }`,
  gpu: `Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion, VideoModeDescription, CurrentRefreshRate | ForEach-Object { Write-Output "GPU: $($_.Name)"; Write-Output "VRAM: $([math]::Round($_.AdapterRAM/1GB, 2)) GB"; Write-Output "드라이버: $($_.DriverVersion)"; Write-Output "해상도: $($_.VideoModeDescription)"; Write-Output "주사율: $($_.CurrentRefreshRate) Hz"; Write-Output "" }`,
  disk: `Get-CimInstance Win32_DiskDrive | ForEach-Object { Write-Output "=== $($_.Model) ==="; Write-Output "크기: $([math]::Round($_.Size/1GB, 2)) GB"; Write-Output "인터페이스: $($_.InterfaceType)"; Write-Output "" }; Write-Output "=== 파티션 사용량 ==="; Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { Write-Output "$($_.DeviceID) 총: $([math]::Round($_.Size/1GB, 2)) GB, 남은: $([math]::Round($_.FreeSpace/1GB, 2)) GB, 사용: $([math]::Round(($_.Size - $_.FreeSpace)/$_.Size * 100, 1))%" }`,
  os: `$os = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem; Write-Output "OS: $($os.Caption) $($os.Version)"; Write-Output "빌드: $($os.BuildNumber)"; Write-Output "아키텍처: $($os.OSArchitecture)"; Write-Output "컴퓨터 이름: $($cs.Name)"; Write-Output "제조사: $($cs.Manufacturer)"; Write-Output "모델: $($cs.Model)"; Write-Output "마지막 부팅: $($os.LastBootUpTime)"`,
  network: `Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name, InterfaceDescription, MacAddress, LinkSpeed | Format-List`,
};

async function getSystemInfo(category: string): Promise<string> {
  try {
    if (category === 'all') {
      const results: string[] = [];
      for (const [cat, cmd] of Object.entries(SYSTEM_INFO_COMMANDS)) {
        try {
          const { stdout } = await execAsync(cmd, {
            timeout: 15000,
            maxBuffer: 1024 * 1024,
            shell: 'powershell.exe',
          });
          results.push(`\n===== ${cat.toUpperCase()} =====\n${stdout.trim()}`);
        } catch (err) {
          results.push(`\n===== ${cat.toUpperCase()} =====\n(조회 실패)`);
        }
      }
      return results.join('\n');
    }

    const cmd = SYSTEM_INFO_COMMANDS[category];
    if (!cmd) {
      return `알 수 없는 카테고리: ${category}. 가능한 값: all, cpu, memory, gpu, disk, os, network`;
    }

    const { stdout } = await execAsync(cmd, {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      shell: 'powershell.exe',
    });

    return stdout.trim() || '(결과 없음)';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `시스템 정보 조회 실패: ${msg}`;
  }
}

// ============================================================
// 외부 플랫폼 활동 도구 구현
// ============================================================

// platformManager는 index.ts에서 초기화 후 주입
let _platformManager: any = null;

export function setPlatformManager(manager: any): void {
  _platformManager = manager;
}

async function handlePlatformActivity(
  action: string,
  platform?: string,
  agent?: string,
): Promise<string> {
  if (!_platformManager) {
    return '플랫폼 연동이 비활성화 상태입니다. .env에서 PLATFORM_ENABLED=true로 설정하세요.';
  }

  try {
    switch (action) {
      case 'status':
        return await _platformManager.getActivitySummary();

      case 'insights': {
        const { readFile } = await import('fs/promises');
        const { join } = await import('path');
        const today = new Date().toISOString().split('T')[0];
        const insightPath = join(
          'D:\\projects\\miraclro\\multi-agent-bot\\workspace',
          'shared', 'platform-insights', `${today}.md`
        );
        try {
          return await readFile(insightPath, 'utf-8');
        } catch {
          return '오늘 학습 인사이트 없음. 아직 활동 사이클이 실행되지 않았습니다.';
        }
      }

      case 'trigger_cycle': {
        if (!platform || !agent) {
          return 'trigger_cycle에는 platform과 agent 파라미터가 필요합니다.';
        }
        // 비동기로 실행 (응답은 즉시 반환)
        _platformManager.runActivityCycle(platform, agent).catch((err: any) => {
          logger.error('PLATFORM', `Manual trigger failed: ${err}`);
        });
        return `${platform}/${agent} 활동 사이클 트리거 완료. 백그라운드에서 실행 중입니다.`;
      }

      default:
        return `알 수 없는 action: ${action}. 가능한 값: status, insights, trigger_cycle`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `플랫폼 활동 조회 실패: ${msg}`;
  }
}

// ============================================================
// 에이전트 간 메시지 전달 (Hub-Spoke 모델)
// ============================================================

// 에이전트 이름 매핑
const AGENT_NAMES: Record<string, string> = {
  po: '이레(PO)',
  dev: '다온(Dev)',
  design: '채아(Design)',
  cs: '나래(CS)',
  marketing: '알리(Marketing)',
};

// mode → AgentRole 매핑
const MODE_TO_ROLE: Record<string, AgentRole> = {
  architect: 'dev-architect',
  builder: 'dev-builder',
  refactor: 'dev-refactor',
  content: 'growth-content',
  funnel: 'growth-funnel',
  data: 'growth-data',
};

// ============================================================
// 🔑 재귀 방지 깊이 추적기
// ============================================================
// 깊이 제한으로 무한 루프 방지하면서 체인 허용:
//   depth 0: User → PO dispatch → Worker (Agentic) ✅
//   depth 1: Worker report_to_po → PO (Agentic) ✅  ← PO가 후속 dispatch 가능
//   depth 2: PO dispatch → Worker2 (Agentic) ✅     ← 두 번째 워커도 도구 사용 가능
//   depth 3+: 텍스트 전용으로 종료 (무한 루프 방지)
let dispatchDepth = 0;
const MAX_DISPATCH_DEPTH = 3;

// PO → 워커 작업 지시
async function dispatchToAgent(
  agentName: string,
  message: string,
  callerAgent?: string,
  mode?: string
): Promise<string> {
  // 허브-스포크 모델: PO만 dispatch 가능
  if (callerAgent && callerAgent !== 'po') {
    return `Error: dispatch_to_agent는 PO만 사용할 수 있습니다. report_to_po를 사용하세요.`;
  }

  // 자기 자신에게 보내기 방지
  if (callerAgent === agentName) {
    return `Error: 자기 자신에게는 메시지를 보낼 수 없습니다.`;
  }

  const { getAgent } = await import('../agents/base-agent.js');
  const { sendToGroup, sendToChannel } = await import('../bot/router.js');
  const { config: appConfig } = await import('../config.js');

  const validWorkers = ['dev', 'design', 'cs', 'marketing'];
  if (!validWorkers.includes(agentName)) {
    return `Error: 알 수 없는 워커 에이전트: ${agentName}. 가능한 대상: ${validWorkers.join(', ')}`;
  }

  const targetAgent = getAgent(agentName as any);
  const callerName = AGENT_NAMES['po'];
  const targetName = AGENT_NAMES[agentName];

  // 모드 전환 (mode 파라미터가 있으면)
  let modeTag = '';
  if (mode && MODE_TO_ROLE[mode]) {
    const role = MODE_TO_ROLE[mode];
    const switched = targetAgent.switchRole(role);
    if (switched) {
      modeTag = `[${mode.toUpperCase()}] `;
      logger.info('DISPATCH', `Mode switch: ${agentName} → ${role}`);
    }
  }

  // --- 1단계: 작업 지시 메시지를 공유 그룹에 전송 (PO봇) ---
  const dispatchMsg = `📋 [${callerName} → ${targetName}] ${modeTag}작업 지시\n${message}`;
  await sendToGroup('po', dispatchMsg);

  // PO 커맨드센터에도 복사
  if (appConfig.CHANNEL_COMMAND_CENTER) {
    await sendToChannel(appConfig.CHANNEL_COMMAND_CENTER, 'po', dispatchMsg).catch(() => {});
  }

  // --- 2단계: 워커에게 작업 지시 (도구 사용 가능한 Agentic 모드) ---
  // 🔑 핵심 변경: handleDirectMessage(텍스트만) → handleMessage(도구 사용)
  // 재귀 깊이 가드로 무한 루프 방지
  const fileInstructionSuffix = '\n\n⚠️ 반드시 작업 결과물을 write_file로 워크스페이스에 저장하세요. 텍스트로만 응답하면 업무 실패로 간주됩니다.';
  let result: string;
  if (dispatchDepth < MAX_DISPATCH_DEPTH) {
    dispatchDepth++;
    try {
      logger.info('DISPATCH', `[depth=${dispatchDepth}] ${agentName} Agentic 모드 작업 시작`);
      result = await targetAgent.handleMessage(modeTag + message + fileInstructionSuffix, callerName);
    } finally {
      dispatchDepth--;
    }
  } else {
    // 최대 깊이 도달 → 텍스트 전용 (재귀 종료)
    logger.warn('DISPATCH', `[depth=${dispatchDepth}] 최대 깊이 도달 → 텍스트 모드`);
    result = await targetAgent.handleDirectMessage(modeTag + message, callerName);
  }

  // --- 3단계: 결과를 공유 그룹에 전송 (워커봇) ---
  const responseMsg = `✅ [${targetName} → ${callerName}] 작업 결과\n${result}`;
  await sendToGroup(agentName as any, responseMsg);

  // PO 커맨드센터에도 복사
  if (appConfig.CHANNEL_COMMAND_CENTER) {
    await sendToChannel(appConfig.CHANNEL_COMMAND_CENTER, agentName as any, responseMsg).catch(() => {});
  }

  return `[${targetName} 작업 결과]\n${result}`;
}

// 워커 → PO 보고
async function reportToPo(
  message: string,
  callerAgent?: string
): Promise<string> {
  if (!callerAgent) {
    return 'Error: 호출 에이전트를 알 수 없습니다.';
  }
  if (callerAgent === 'po') {
    return 'Error: PO는 자신에게 보고할 수 없습니다. dispatch_to_agent를 사용하세요.';
  }

  const { getAgent } = await import('../agents/base-agent.js');
  const { sendToGroup, sendToChannel } = await import('../bot/router.js');
  const { config: appConfig } = await import('../config.js');

  const poAgent = getAgent('po');
  const callerName = AGENT_NAMES[callerAgent] || callerAgent.toUpperCase();
  const poName = AGENT_NAMES['po'];

  // --- 1단계: 보고 메시지를 공유 그룹에 전송 (워커봇) ---
  const reportMsg = `📨 [${callerName} → ${poName}] 보고\n${message}`;
  await sendToGroup(callerAgent as any, reportMsg);

  // PO 커맨드센터에도 복사
  if (appConfig.CHANNEL_COMMAND_CENTER) {
    await sendToChannel(appConfig.CHANNEL_COMMAND_CENTER, callerAgent as any, reportMsg).catch(() => {});
  }

  // 보고 포맷 검증 (소프트 강제)
  const reportCheck = tryExtractAndValidateReport(message);
  let reportWarning = '';
  if (reportCheck.report === null) {
    reportWarning = '\n⚠️ [REPORT] 표준 포맷을 사용해주세요. (Team/Task/Status/Risk/Files/Next Action)';
  } else if (reportCheck.errors.length > 0) {
    reportWarning = `\n⚠️ 보고 포맷 오류: ${reportCheck.errors.join(', ')}`;
  }

  // --- 2단계: PO에게 보고 처리 ---
  // 🔑 PO도 깊이 여유가 있으면 도구 사용 (후속 dispatch 가능)
  // 깊이 초과 시 텍스트 전용 (재귀 종료)
  let result: string;
  if (dispatchDepth < MAX_DISPATCH_DEPTH) {
    dispatchDepth++;
    try {
      logger.info('REPORT', `[depth=${dispatchDepth}] PO Agentic 모드로 보고 처리`);
      result = await poAgent.handleMessage(message + reportWarning, callerName);
    } finally {
      dispatchDepth--;
    }
  } else {
    logger.info('REPORT', `[depth=${dispatchDepth}] PO 텍스트 모드로 보고 처리`);
    result = await poAgent.handleDirectMessage(message + reportWarning, callerName);
  }

  // --- 3단계: PO 응답을 공유 그룹에 전송 (PO봇) ---
  const responseMsg = `📨 [${poName} → ${callerName}] 응답\n${result}`;
  await sendToGroup('po', responseMsg);

  // PO 커맨드센터에도 복사
  if (appConfig.CHANNEL_COMMAND_CENTER) {
    await sendToChannel(appConfig.CHANNEL_COMMAND_CENTER, 'po', responseMsg).catch(() => {});
  }

  return `[${poName} 응답]\n${result}`;
}

// ============================================================
// 티켓 도구 구현
// ============================================================

async function createTicket(
  title: string,
  description: string,
  customerName: string,
  category?: string,
  priority?: string
): Promise<string> {
  const ticket = ticketSystem.createTicket(title, description, customerName, {
    category: category as any,
    priority: priority as any,
  });

  return `✅ 티켓 생성 완료\n` +
    `ID: ${ticket.id}\n` +
    `제목: ${ticket.title}\n` +
    `카테고리: ${ticket.category}\n` +
    `우선순위: ${ticket.priority}\n` +
    `고객: ${ticket.customerName}`;
}

async function escalateTicket(
  ticketId: string,
  reason: string
): Promise<string> {
  const result = ticketSystem.escalateToDev(ticketId, reason);
  if (!result.success) {
    return `❌ 에스컬레이션 실패: ${result.error}`;
  }
  return `🔴 에스컬레이션 완료\n` +
    `티켓: ${ticketId}\n` +
    `파이프라인: ${result.pipelineItemId}\n` +
    `사유: ${reason}`;
}

async function listTicketsAction(status?: string): Promise<string> {
  if (!status) {
    return ticketSystem.getStatusSummary();
  }
  const tickets = ticketSystem.listTickets({ status: status as any });
  if (tickets.length === 0) {
    return `📋 ${status} 상태의 티켓이 없습니다.`;
  }
  const lines = tickets.map(t => {
    const pri = t.priority === 'urgent' ? '🔴' : t.priority === 'high' ? '🟠' : '🟡';
    return `${pri} ${t.id} [${t.category}] ${t.title} - ${t.customerName}`;
  });
  return `📋 ${status} 티켓 (${tickets.length}건)\n${lines.join('\n')}`;
}

// ============================================================
// 파이프라인 도구 구현
// ============================================================

// ============================================================
// 칸반 도구 구현
// ============================================================

async function kanbanCreateTask(
  input: Record<string, unknown>,
  callerAgent?: string
): Promise<string> {
  if (callerAgent && callerAgent !== 'po') {
    return 'Error: kanban_create_task는 PO만 사용할 수 있습니다.';
  }

  const { kanbanService } = await import('../kanban/kanban-service.js');

  const task = await kanbanService.createTask({
    title: input.title as string,
    description: input.description as string,
    projectCode: input.projectCode as string,
    phase: input.phase as 'P0' | 'P1' | 'P2' | 'P3' | 'P4',
    domain: input.domain as 'DOC' | 'UI' | 'FE' | 'BE' | 'DB' | 'QA' | 'OPS' | 'MKT',
    assignee: input.assignee as AgentType,
    priority: (input.priority as 'critical' | 'high' | 'medium' | 'low') || undefined,
    createdBy: (callerAgent as AgentType) || 'po',
  });

  return `✅ Task 생성 완료\nID: ${task.taskId}\n제목: ${task.title}\n담당: ${task.assignee}\n상태: ${task.taskStatus}\nPhase: ${task.phase} / Domain: ${task.domain}`;
}

async function kanbanUpdateTask(
  input: Record<string, unknown>,
  callerAgent?: string
): Promise<string> {
  const { kanbanService } = await import('../kanban/kanban-service.js');

  const taskId = input.taskId as string;
  const agent = (callerAgent as AgentType) || 'po';

  const updates: Record<string, unknown> = {};
  if (input.status !== undefined) updates.taskStatus = input.status;
  if (input.progress !== undefined) updates.progress = input.progress;
  if (input.blockers !== undefined) updates.blockers = input.blockers;
  if (input.result !== undefined) updates.result = input.result;
  if (input.outputFiles !== undefined) updates.outputFiles = input.outputFiles;

  const task = await kanbanService.updateTask(taskId, updates, agent);
  if (!task) {
    return `❌ Task를 찾을 수 없습니다: ${taskId}`;
  }

  return `✅ Task 업데이트 완료\nID: ${task.taskId}\n제목: ${task.title}\n상태: ${task.taskStatus}\n진행률: ${task.progress}%${task.blockers ? `\n차단: ${task.blockers}` : ''}`;
}

async function kanbanQueryTasks(
  input: Record<string, unknown>
): Promise<string> {
  const { kanbanService } = await import('../kanban/kanban-service.js');

  const filters: Record<string, unknown> = {};
  if (input.project) filters.project = input.project;
  if (input.phase) filters.phase = input.phase;
  if (input.assignee) filters.assignee = input.assignee;
  if (input.status) filters.status = input.status;
  if (input.domain) filters.domain = input.domain;

  const tasks = await kanbanService.listTasks(filters as any);

  if (tasks.length === 0) {
    return '📋 해당하는 Task가 없습니다.';
  }

  const lines = tasks.slice(0, 20).map(t => {
    const statusEmoji: Record<string, string> = {
      backlog: '⬜', todo: '🟦', in_progress: '🟨', review: '🟪', done: '🟩', blocked: '🟥'
    };
    return `${statusEmoji[t.taskStatus] || '❓'} ${t.taskId} | ${t.title} | ${t.assignee} | ${t.progress}%`;
  });

  return `📋 Task 목록 (${tasks.length}건)\n${lines.join('\n')}${tasks.length > 20 ? `\n... +${tasks.length - 20}건` : ''}`;
}

async function kanbanBoardAction(projectCode: string): Promise<string> {
  const { kanbanService } = await import('../kanban/kanban-service.js');
  const { formatBoardView } = await import('../kanban/kanban-views.js');

  const board = await kanbanService.getBoardView(projectCode);
  // formatBoardView는 HTML 태그 포함, 도구 결과는 플레인텍스트로 변환
  return formatBoardView(projectCode, board).replace(/<[^>]*>/g, '');
}

async function kanbanGateRequest(
  projectCode: string,
  phase: string,
  callerAgent?: string
): Promise<string> {
  if (callerAgent && callerAgent !== 'po') {
    return 'Error: kanban_gate_request는 PO만 사용할 수 있습니다.';
  }

  const { kanbanService } = await import('../kanban/kanban-service.js');
  const result = await kanbanService.requestStageGate(projectCode, phase as any);
  return result;
}

async function kanbanGateApprove(
  projectCode: string,
  phase: string,
  approved: boolean,
  notes?: string,
  callerAgent?: string
): Promise<string> {
  if (callerAgent && callerAgent !== 'po') {
    return 'Error: kanban_gate_approve는 PO만 사용할 수 있습니다.';
  }

  const { kanbanService } = await import('../kanban/kanban-service.js');
  const result = await kanbanService.approveStageGate(projectCode, phase as any, approved, notes);
  return result;
}

// ============================================================
// 파이프라인 도구 구현
// ============================================================

async function pipelineTransitionAction(
  itemId: string,
  toStage: string,
  reason: string,
  callerAgent?: string
): Promise<string> {
  const result = pipeline.transition(
    itemId,
    toStage as PipelineStage,
    (callerAgent ?? 'po') as AgentType,
    reason
  );

  if (!result.success) {
    return `❌ 전이 실패: ${result.error}`;
  }

  const item = result.item!;
  return `✅ 파이프라인 전이 완료\n` +
    `ID: ${item.id}\n` +
    `현재 스테이지: ${STAGE_DISPLAY_NAMES[item.stage]}\n` +
    `담당: ${item.assignee ?? '미배정'}\n` +
    `사유: ${reason}`;
}
