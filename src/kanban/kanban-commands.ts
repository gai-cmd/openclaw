import { Bot } from 'grammy';
import { kanbanService } from './kanban-service.js';
import {
  formatBoardView,
  formatTaskCard,
  formatTaskList,
  formatDashboard,
  formatPhaseProgress,
} from './kanban-views.js';
import { logger } from '../utils/logger.js';
import type { AgentType } from '../config.js';

// ============================================================
// 도메인 매핑
// ============================================================

const DOMAIN_MAP: Record<string, string> = {
  '문서': 'DOC', 'doc': 'DOC', '기획': 'DOC',
  'ui': 'UI', 'ux': 'UI', '디자인': 'UI',
  'fe': 'FE', '프론트': 'FE', '프론트엔드': 'FE',
  'be': 'BE', '백엔드': 'BE', '서버': 'BE', 'api': 'BE',
  'db': 'DB', '데이터베이스': 'DB',
  'qa': 'QA', '테스트': 'QA', '검증': 'QA',
  'ops': 'OPS', '배포': 'OPS', 'devops': 'OPS',
  'mkt': 'MKT', '마케팅': 'MKT', '콘텐츠': 'MKT',
};

const ASSIGNEE_MAP: Record<string, AgentType> = {
  '이레': 'po', 'po': 'po',
  '다온': 'dev', 'dev': 'dev',
  '채아': 'design', 'design': 'design',
  '나래': 'cs', 'cs': 'cs',
  '알리': 'marketing', 'marketing': 'marketing',
};

const STATUS_MAP: Record<string, string> = {
  'backlog': 'backlog', '백로그': 'backlog',
  'todo': 'todo', '할일': 'todo',
  'in_progress': 'in_progress', '진행중': 'in_progress', '진행': 'in_progress',
  'review': 'review', '리뷰': 'review', '검토': 'review',
  'done': 'done', '완료': 'done',
  'blocked': 'blocked', '차단': 'blocked', '블록': 'blocked',
};

// ============================================================
// 칸반 명령어 등록
// ============================================================

export function registerKanbanCommands(bot: Bot) {
  // /kanban create <프로젝트> <Phase> <Domain> <담당자> <제목>
  // 예: /kanban create KAN P2 FE 다온 로그인 API 구현
  bot.command('kanban', async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply(
        '📋 <b>칸반 명령어</b>\n\n' +
        '<b>Task 관리:</b>\n' +
        '<code>/kanban create [프로젝트] [Phase] [Domain] [담당자] [제목]</code>\n' +
        '  예: <code>/kanban create KAN P2 FE 다온 로그인 API 구현</code>\n\n' +
        '<code>/kanban update [TaskID] [상태] [진행률%]</code>\n' +
        '  예: <code>/kanban update KAN-P2FE-001 진행중 30</code>\n\n' +
        '<code>/kanban view [TaskID]</code>\n' +
        '  예: <code>/kanban view KAN-P2FE-001</code>\n\n' +
        '<code>/kanban list [프로젝트] [--phase P2] [--status 진행중] [--assignee 다온]</code>\n' +
        '  예: <code>/kanban list KAN --phase P2</code>\n\n' +
        '<b>보드 & 대시보드:</b>\n' +
        '<code>/board [프로젝트]</code> - 칸반 보드\n' +
        '<code>/dashboard</code> - 전체 대시보드\n' +
        '<code>/progress [프로젝트]</code> - Phase별 진행률',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const parts = args.split(/\s+/);
    const subCommand = parts[0].toLowerCase();

    try {
      switch (subCommand) {
        case 'create':
          await handleCreate(ctx, parts.slice(1));
          break;
        case 'update':
          await handleUpdate(ctx, parts.slice(1));
          break;
        case 'view':
          await handleView(ctx, parts.slice(1));
          break;
        case 'list':
          await handleList(ctx, parts.slice(1));
          break;
        case 'delete':
          await handleDelete(ctx, parts.slice(1));
          break;
        default:
          await ctx.reply(`❌ 알 수 없는 명령: "${subCommand}"\n/kanban 을 입력하면 도움말을 볼 수 있습니다.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('KANBAN-CMD', `명령 처리 오류: ${msg}`);
      await ctx.reply(`❌ 오류: ${msg}`);
    }
  });

  // /board [프로젝트코드] - 칸반 보드 표시
  bot.command('board', async (ctx) => {
    const projectCode = ctx.match?.trim()?.toUpperCase() || 'KAN';

    try {
      const board = await kanbanService.getBoardView(projectCode);
      const view = formatBoardView(projectCode, board as any);
      await ctx.reply(view, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 보드 조회 실패: ${err}`);
    }
  });

  // /dashboard - 전체 대시보드
  bot.command('dashboard', async (ctx) => {
    try {
      const data = await kanbanService.getDashboard();
      const view = formatDashboard(data);
      await ctx.reply(view, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 대시보드 조회 실패: ${err}`);
    }
  });

  // /progress [프로젝트] - Phase 진행률
  bot.command('progress', async (ctx) => {
    const projectCode = ctx.match?.trim()?.toUpperCase() || 'KAN';

    try {
      const phases = await kanbanService.getPhaseProgress(projectCode);
      const view = formatPhaseProgress(projectCode, phases);
      await ctx.reply(view, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 진행률 조회 실패: ${err}`);
    }
  });

  logger.info('KANBAN', '칸반 명령어 등록 완료: /kanban, /board, /dashboard, /progress');
}

// ============================================================
// 서브 핸들러
// ============================================================

async function handleCreate(ctx: any, args: string[]) {
  // /kanban create KAN P2 FE 다온 로그인 API 구현
  if (args.length < 5) {
    await ctx.reply(
      '❗ 형식: <code>/kanban create [프로젝트] [Phase] [Domain] [담당자] [제목...]</code>\n' +
      '예: <code>/kanban create KAN P2 FE 다온 로그인 API 구현</code>\n\n' +
      '<b>Phase:</b> P0(기획) P1(설계) P2(개발) P3(검증) P4(운영)\n' +
      '<b>Domain:</b> DOC UI FE BE DB QA OPS MKT\n' +
      '<b>담당:</b> 이레 다온 채아 나래 알리',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const projectCode = args[0].toUpperCase();
  const phase = args[1].toUpperCase();
  const domainInput = args[2].toLowerCase();
  const assigneeInput = args[3].toLowerCase();
  const title = args.slice(4).join(' ');

  // 유효성 검사
  const validPhases = ['P0', 'P1', 'P2', 'P3', 'P4'];
  if (!validPhases.includes(phase)) {
    await ctx.reply(`❌ 잘못된 Phase: "${phase}". 가능: ${validPhases.join(', ')}`);
    return;
  }

  const domain = DOMAIN_MAP[domainInput] || domainInput.toUpperCase();
  const validDomains = ['DOC', 'UI', 'FE', 'BE', 'DB', 'QA', 'OPS', 'MKT'];
  if (!validDomains.includes(domain)) {
    await ctx.reply(`❌ 잘못된 Domain: "${domainInput}". 가능: ${validDomains.join(', ')}`);
    return;
  }

  const assignee = ASSIGNEE_MAP[assigneeInput] || assigneeInput as AgentType;
  const validAssignees: AgentType[] = ['po', 'dev', 'design', 'cs', 'marketing'];
  if (!validAssignees.includes(assignee)) {
    await ctx.reply(`❌ 잘못된 담당자: "${assigneeInput}". 가능: 이레 다온 채아 나래 알리`);
    return;
  }

  const task = await kanbanService.createTask({
    title,
    description: title,
    projectCode,
    phase: phase as any,
    domain: domain as any,
    assignee,
  });

  await ctx.reply(
    `✅ Task 생성 완료\n\n` +
    `<code>${task.taskId}</code>\n` +
    `📌 ${task.title}\n` +
    `📊 ${task.phase}/${task.domain} → ${assignee}`,
    { parse_mode: 'HTML' }
  );
}

async function handleUpdate(ctx: any, args: string[]) {
  // /kanban update KAN-P2FE-001 진행중 30
  if (args.length < 2) {
    await ctx.reply(
      '❗ 형식: <code>/kanban update [TaskID] [상태] [진행률%]</code>\n' +
      '예: <code>/kanban update KAN-P2FE-001 진행중 30</code>\n\n' +
      '<b>상태:</b> backlog todo 진행중 리뷰 완료 차단',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const taskId = args[0].toUpperCase();
  const statusInput = args[1].toLowerCase();
  const progress = args[2] ? parseInt(args[2]) : undefined;

  const status = STATUS_MAP[statusInput] || statusInput;
  const validStatuses = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'];
  if (!validStatuses.includes(status)) {
    await ctx.reply(`❌ 잘못된 상태: "${statusInput}". 가능: ${Object.keys(STATUS_MAP).join(', ')}`);
    return;
  }

  const task = await kanbanService.updateTask(
    taskId,
    {
      taskStatus: status as any,
      ...(progress !== undefined ? { progress: Math.min(100, Math.max(0, progress)) } : {}),
    },
    'po'
  );

  if (!task) {
    await ctx.reply(`❌ Task를 찾을 수 없습니다: ${taskId}`);
    return;
  }

  await ctx.reply(
    `✅ Task 업데이트\n\n` +
    `<code>${task.taskId}</code> ${task.title}\n` +
    `상태: ${status} | 진행률: ${task.progress}%`,
    { parse_mode: 'HTML' }
  );
}

async function handleView(ctx: any, args: string[]) {
  if (args.length === 0) {
    await ctx.reply('❗ TaskID를 입력하세요.\n예: <code>/kanban view KAN-P2FE-001</code>', { parse_mode: 'HTML' });
    return;
  }

  const taskId = args[0].toUpperCase();
  const task = await kanbanService.getTask(taskId);

  if (!task) {
    await ctx.reply(`❌ Task를 찾을 수 없습니다: ${taskId}`);
    return;
  }

  const view = formatTaskCard(task as any);
  await ctx.reply(view, { parse_mode: 'HTML' });
}

async function handleList(ctx: any, args: string[]) {
  const filters: Record<string, string> = {};
  let projectCode: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).toLowerCase();
      const value = args[i + 1];
      if (value) {
        filters[key] = value;
        i++;
      }
    } else if (!projectCode) {
      projectCode = arg.toUpperCase();
    }
  }

  const phase = filters.phase?.toUpperCase();
  const statusInput = filters.status?.toLowerCase();
  const assigneeInput = filters.assignee?.toLowerCase();
  const domainInput = filters.domain?.toLowerCase();

  const tasks = await kanbanService.listTasks({
    project: projectCode,
    phase: phase as any,
    status: statusInput ? (STATUS_MAP[statusInput] || statusInput) as any : undefined,
    assignee: assigneeInput ? (ASSIGNEE_MAP[assigneeInput] || assigneeInput) as any : undefined,
    domain: domainInput ? (DOMAIN_MAP[domainInput] || domainInput.toUpperCase()) as any : undefined,
  });

  const title = projectCode ? `${projectCode} Task 목록` : '전체 Task 목록';
  const view = formatTaskList(tasks as any, title);
  await ctx.reply(view, { parse_mode: 'HTML' });
}

async function handleDelete(ctx: any, args: string[]) {
  if (args.length === 0) {
    await ctx.reply('❗ TaskID를 입력하세요.\n예: <code>/kanban delete KAN-P2FE-001</code>', { parse_mode: 'HTML' });
    return;
  }

  const taskId = args[0].toUpperCase();
  const success = await kanbanService.deleteTask(taskId);

  if (success) {
    await ctx.reply(`🗑 Task 삭제: <code>${taskId}</code>`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply(`❌ Task를 찾을 수 없습니다: ${taskId}`);
  }
}
