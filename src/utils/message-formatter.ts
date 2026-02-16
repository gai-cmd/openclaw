import type { AgentType } from '../config.js';
import { getActiveRole, ROLE_DISPLAY_NAMES } from '../config/roles.js';

const AGENT_LABELS: Record<AgentType, { emoji: string; name: string }> = {
  po: { emoji: '📋', name: '이레(PO)' },
  dev: { emoji: '🔧', name: '다온(Dev)' },
  design: { emoji: '🎨', name: '채아(Design)' },
  cs: { emoji: '💬', name: '나래(CS)' },
  marketing: { emoji: '📣', name: '알리(Marketing)' },
};

// 역할별 이모지 오버라이드
const ROLE_EMOJI: Record<string, string> = {
  openclaw: '🧠',
  auditor: '🔍',
  'dev-architect': '🏗',
  'dev-builder': '🔨',
  'dev-refactor': '🔧',
  'growth-content': '📝',
  'growth-funnel': '📈',
  'growth-data': '📊',
};

export function formatAgentMessage(agent: AgentType, content: string): string {
  const activeRole = getActiveRole(agent);
  const roleEmoji = ROLE_EMOJI[activeRole];
  const roleName = ROLE_DISPLAY_NAMES[activeRole];

  // 역할 기반 표시 (역할이 있으면 역할명 사용)
  if (roleEmoji && roleName) {
    return `${roleEmoji} <b>[${roleName}]</b>\n\n${content}`;
  }

  const label = AGENT_LABELS[agent];
  return `${label.emoji} <b>[${label.name}]</b>\n\n${content}`;
}

export function formatTaskStatus(tasks: Array<{ title: string; assignee: AgentType; status: string }>): string {
  const lines = tasks.map((t) => {
    const label = AGENT_LABELS[t.assignee];
    const statusIcon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳';
    return `${statusIcon} ${label.emoji} ${t.title} → ${label.name}`;
  });
  return `📊 <b>작업 현황</b>\n\n${lines.join('\n')}`;
}

export function formatTaskDecomposition(
  originalCommand: string,
  tasks: Array<{ title: string; assignee: AgentType; phase: number }>
): string {
  const grouped = new Map<number, typeof tasks>();
  for (const t of tasks) {
    const list = grouped.get(t.phase) ?? [];
    list.push(t);
    grouped.set(t.phase, list);
  }

  let result = `📋 <b>작업 분해 완료</b>\n\n<i>원본 명령:</i> ${originalCommand}\n\n`;

  for (const [phase, phaseTasks] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    result += `<b>Phase ${phase}</b> ${phase > 1 ? '(이전 단계 완료 후)' : '(즉시 병렬 실행)'}:\n`;
    for (const t of phaseTasks) {
      const label = AGENT_LABELS[t.assignee];
      result += `  ${label.emoji} ${t.title} → ${label.name}\n`;
    }
    result += '\n';
  }

  return result;
}
