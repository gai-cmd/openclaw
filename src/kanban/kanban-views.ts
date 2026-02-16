import type { AgentType } from '../config.js';

// ============================================================
// 에이전트 표시 정보
// ============================================================

const AGENT_DISPLAY: Record<AgentType, { name: string; emoji: string }> = {
  po: { name: '이레', emoji: '🧠' },
  dev: { name: '다온', emoji: '🔧' },
  design: { name: '채아', emoji: '🎨' },
  cs: { name: '나래', emoji: '💬' },
  marketing: { name: '알리', emoji: '📣' },
};

const STATUS_DISPLAY: Record<string, { label: string; emoji: string }> = {
  backlog: { label: 'Backlog', emoji: '⬜' },
  todo: { label: 'To Do', emoji: '🟦' },
  in_progress: { label: 'In Progress', emoji: '🟨' },
  review: { label: 'Review', emoji: '🟪' },
  done: { label: 'Done', emoji: '🟩' },
  blocked: { label: 'Blocked', emoji: '🟥' },
};

const PRIORITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
};

const PHASE_NAMES: Record<string, string> = {
  P0: '기획',
  P1: '설계',
  P2: '개발',
  P3: '검증',
  P4: '운영',
};

// ============================================================
// Task 인터페이스 (서비스의 InMemoryTask 호환)
// ============================================================

interface TaskView {
  taskId: string;
  title: string;
  project: string;
  phase: string;
  domain: string;
  assignee: AgentType;
  taskStatus: string;
  priority: string;
  progress: number;
  blockers?: string;
  dueDate?: Date;
  createdAt: Date;
}

// ============================================================
// 칸반 보드 텍스트 뷰
// ============================================================

export function formatBoardView(
  projectCode: string,
  board: Map<string, TaskView[]>
): string {
  const lines: string[] = [];
  lines.push(`📋 <b>칸반 보드 — ${projectCode}</b>`);
  lines.push('');

  const statuses = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'];

  for (const status of statuses) {
    const tasks = board.get(status) || [];
    const display = STATUS_DISPLAY[status] || { label: status, emoji: '❓' };

    lines.push(`${display.emoji} <b>${display.label}</b> (${tasks.length})`);

    if (tasks.length === 0) {
      lines.push('  <i>(비어 있음)</i>');
    } else {
      for (const task of tasks.slice(0, 5)) {
        const agent = AGENT_DISPLAY[task.assignee] || { name: task.assignee, emoji: '👤' };
        const prioEmoji = PRIORITY_EMOJI[task.priority] || '⚪';
        const progressBar = formatProgressBar(task.progress);
        lines.push(
          `  ${prioEmoji} <code>${task.taskId}</code> ${task.title}` +
          `\n     ${agent.emoji}${agent.name} ${progressBar} ${task.progress}%`
        );
      }
      if (tasks.length > 5) {
        lines.push(`  ... +${tasks.length - 5}개`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// Task 카드 상세 뷰
// ============================================================

export function formatTaskCard(task: TaskView): string {
  const agent = AGENT_DISPLAY[task.assignee] || { name: task.assignee, emoji: '👤' };
  const statusDisplay = STATUS_DISPLAY[task.taskStatus] || { label: task.taskStatus, emoji: '❓' };
  const prioEmoji = PRIORITY_EMOJI[task.priority] || '⚪';
  const phaseName = PHASE_NAMES[task.phase] || task.phase;
  const progressBar = formatProgressBar(task.progress);

  const lines: string[] = [];
  lines.push(`📌 <b>${task.taskId}</b>`);
  lines.push(`<b>${task.title}</b>`);
  lines.push('');
  lines.push(`${statusDisplay.emoji} 상태: <b>${statusDisplay.label}</b>`);
  lines.push(`${agent.emoji} 담당: <b>${agent.name}</b>`);
  lines.push(`${prioEmoji} 우선순위: ${task.priority}`);
  lines.push(`📊 Phase: ${task.phase} (${phaseName}) / Domain: ${task.domain}`);
  lines.push(`${progressBar} <b>${task.progress}%</b>`);

  if (task.dueDate) {
    const dateStr = task.dueDate.toISOString().split('T')[0];
    lines.push(`📅 마감: ${dateStr}`);
  }
  if (task.blockers) {
    lines.push(`🚫 차단: ${task.blockers}`);
  }

  lines.push(`\n🕐 생성: ${task.createdAt.toISOString().split('T')[0]}`);

  return lines.join('\n');
}

// ============================================================
// Task 목록 뷰
// ============================================================

export function formatTaskList(tasks: TaskView[], title?: string): string {
  const lines: string[] = [];
  lines.push(`📋 <b>${title || 'Task 목록'}</b> (${tasks.length}건)`);
  lines.push('');

  if (tasks.length === 0) {
    lines.push('<i>해당하는 Task가 없습니다.</i>');
    return lines.join('\n');
  }

  for (const task of tasks.slice(0, 15)) {
    const statusDisplay = STATUS_DISPLAY[task.taskStatus] || { emoji: '❓' };
    const agent = AGENT_DISPLAY[task.assignee] || { emoji: '👤' };
    lines.push(
      `${statusDisplay.emoji} <code>${task.taskId}</code> ${task.title} ${agent.emoji} ${task.progress}%`
    );
  }

  if (tasks.length > 15) {
    lines.push(`\n... +${tasks.length - 15}개`);
  }

  return lines.join('\n');
}

// ============================================================
// 대시보드 뷰
// ============================================================

export function formatDashboard(data: {
  totalTasks: number;
  byStatus: Record<string, number>;
  byProject: Array<{ code: string; total: number; done: number }>;
  workload: Array<{ assignee: AgentType; active: number }>;
}): string {
  const lines: string[] = [];
  lines.push('📊 <b>프로젝트 대시보드</b>');
  lines.push('');

  // 전체 현황
  lines.push(`<b>전체 Task:</b> ${data.totalTasks}건`);
  const statusLine = Object.entries(data.byStatus)
    .map(([status, cnt]) => {
      const d = STATUS_DISPLAY[status] || { emoji: '❓', label: status };
      return `${d.emoji}${cnt}`;
    })
    .join(' ');
  lines.push(statusLine);
  lines.push('');

  // 프로젝트별 진행률
  if (data.byProject.length > 0) {
    lines.push('<b>프로젝트 진행률:</b>');
    for (const p of data.byProject) {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      const bar = formatProgressBar(pct);
      lines.push(`  ${p.code}: ${bar} ${pct}% (${p.done}/${p.total})`);
    }
    lines.push('');
  }

  // 팀원 워크로드
  if (data.workload.length > 0) {
    lines.push('<b>팀원 워크로드:</b>');
    for (const w of data.workload) {
      const agent = AGENT_DISPLAY[w.assignee] || { name: w.assignee, emoji: '👤' };
      lines.push(`  ${agent.emoji} ${agent.name}: ${w.active}건 진행 중`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Phase 진행률 뷰
// ============================================================

export function formatPhaseProgress(
  projectCode: string,
  phases: Array<{ phase: string; total: number; done: number; percentage: number }>
): string {
  const lines: string[] = [];
  lines.push(`📈 <b>${projectCode} Phase 진행률</b>`);
  lines.push('');

  for (const p of phases) {
    const phaseName = PHASE_NAMES[p.phase] || p.phase;
    const bar = formatProgressBar(p.percentage);
    lines.push(`<b>${p.phase} (${phaseName})</b>: ${bar} ${p.percentage}% (${p.done}/${p.total})`);
  }

  if (phases.length === 0) {
    lines.push('<i>등록된 Task가 없습니다.</i>');
  }

  return lines.join('\n');
}

// ============================================================
// 유틸
// ============================================================

function formatProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}
