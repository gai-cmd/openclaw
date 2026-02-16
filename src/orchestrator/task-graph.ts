import { v4 as uuid } from 'uuid';
import type { AgentType } from '../config.js';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  assignee: AgentType;
  phase: number;
  dependencies: string[]; // 선행 작업 ID
  status: TaskStatus;
  result?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface TaskGraph {
  id: string;
  command: string;
  requester: string;
  tasks: TaskNode[];
  createdAt: Date;
}

export function createTaskGraph(
  command: string,
  requester: string,
  decomposed: Array<{
    title: string;
    description: string;
    assignee: AgentType;
    phase: number;
    dependencies: string[];
  }>
): TaskGraph {
  // 먼저 모든 태스크에 ID 부여
  const titleToId = new Map<string, string>();
  const tasks: TaskNode[] = decomposed.map((t) => {
    const id = uuid();
    titleToId.set(t.title, id);
    return {
      id,
      title: t.title,
      description: t.description,
      assignee: t.assignee,
      phase: t.phase,
      dependencies: [], // 아래에서 매핑
      status: 'pending' as TaskStatus,
      createdAt: new Date(),
    };
  });

  // 의존성을 title → id로 매핑
  for (let i = 0; i < tasks.length; i++) {
    tasks[i].dependencies = decomposed[i].dependencies
      .map((depTitle) => titleToId.get(depTitle))
      .filter((id): id is string => id !== undefined);
  }

  return {
    id: uuid(),
    command,
    requester,
    tasks,
    createdAt: new Date(),
  };
}

// 현재 실행 가능한 작업들 (의존성이 모두 완료된 pending 작업)
export function getReadyTasks(graph: TaskGraph): TaskNode[] {
  const completedIds = new Set(graph.tasks.filter((t) => t.status === 'completed').map((t) => t.id));

  return graph.tasks.filter((t) => {
    if (t.status !== 'pending') return false;
    return t.dependencies.every((depId) => completedIds.has(depId));
  });
}

// 모든 작업이 완료되었는지
export function isGraphComplete(graph: TaskGraph): boolean {
  return graph.tasks.every((t) => t.status === 'completed' || t.status === 'failed');
}

// 진행률 계산
export function getProgress(graph: TaskGraph): { completed: number; total: number; percent: number } {
  const total = graph.tasks.length;
  const completed = graph.tasks.filter((t) => t.status === 'completed').length;
  return { completed, total, percent: Math.round((completed / total) * 100) };
}
