// Shared in-memory store for Vercel serverless functions
// Data persists across warm invocations but resets on cold start
import { v4 as uuidv4 } from 'uuid';

export interface Task {
  id: string;
  taskId: string;
  title: string;
  description: string;
  result?: string;
  project: string;
  phase: string;
  domain: string;
  assignee: string;
  taskStatus: string;
  priority: string;
  progress: number;
  blockers?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

interface ActivityEntry {
  agent: string;
  action: string;
  taskId?: string;
  createdAt: string;
}

// Module-level state (persists in warm lambda instances)
const tasks = new Map<string, Task>();
const activities: ActivityEntry[] = [];
let taskCounters = new Map<string, number>();

// Seed some sample data on first load
function ensureSeeded() {
  if (tasks.size > 0) return;
  const samples: Partial<Task>[] = [
    { title: 'DB 스키마 설계', project: 'KAN', phase: 'P1', domain: 'DB', assignee: 'dev', taskStatus: 'done', priority: 'high', progress: 100 },
    { title: 'REST API 엔드포인트 구현', project: 'KAN', phase: 'P2', domain: 'BE', assignee: 'dev', taskStatus: 'in_progress', priority: 'high', progress: 70 },
    { title: 'UI 컴포넌트 설계', project: 'KAN', phase: 'P1', domain: 'UI', assignee: 'design', taskStatus: 'done', priority: 'medium', progress: 100 },
    { title: '칸반 보드 프론트엔드', project: 'KAN', phase: 'P2', domain: 'FE', assignee: 'dev', taskStatus: 'in_progress', priority: 'high', progress: 85 },
    { title: '사용자 가이드 작성', project: 'KAN', phase: 'P3', domain: 'DOC', assignee: 'cs', taskStatus: 'todo', priority: 'medium', progress: 0 },
    { title: '프로젝트 홍보 콘텐츠', project: 'KAN', phase: 'P4', domain: 'MKT', assignee: 'marketing', taskStatus: 'backlog', priority: 'low', progress: 0 },
  ];
  samples.forEach((s) => {
    const key = `${s.project}-${s.phase}${s.domain}`;
    const cnt = (taskCounters.get(key) || 0) + 1;
    taskCounters.set(key, cnt);
    const taskId = `${key}-${String(cnt).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      taskId,
      title: s.title!,
      description: s.description || '',
      project: s.project!,
      phase: s.phase!,
      domain: s.domain!,
      assignee: s.assignee!,
      taskStatus: s.taskStatus!,
      priority: s.priority!,
      progress: s.progress!,
      createdAt: now,
      updatedAt: now,
    };
    tasks.set(taskId, task);
  });
}

export function listTasks(filters?: { project?: string; phase?: string; domain?: string; assignee?: string; status?: string }): Task[] {
  ensureSeeded();
  let result = Array.from(tasks.values());
  if (filters?.project) result = result.filter((t) => t.project === filters.project);
  if (filters?.phase) result = result.filter((t) => t.phase === filters.phase);
  if (filters?.domain) result = result.filter((t) => t.domain === filters.domain);
  if (filters?.assignee) result = result.filter((t) => t.assignee === filters.assignee);
  if (filters?.status) result = result.filter((t) => t.taskStatus === filters.status);
  return result;
}

export function getTask(taskId: string): Task | undefined {
  ensureSeeded();
  return tasks.get(taskId);
}

export function createTask(data: { title: string; description?: string; projectCode: string; phase: string; domain: string; assignee: string; priority: string }): Task {
  ensureSeeded();
  const key = `${data.projectCode}-${data.phase}${data.domain}`;
  const cnt = (taskCounters.get(key) || 0) + 1;
  taskCounters.set(key, cnt);
  const taskId = `${key}-${String(cnt).padStart(3, '0')}`;
  const now = new Date().toISOString();
  const task: Task = {
    id: uuidv4(),
    taskId,
    title: data.title,
    description: data.description || '',
    project: data.projectCode,
    phase: data.phase,
    domain: data.domain,
    assignee: data.assignee,
    taskStatus: 'backlog',
    priority: data.priority,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(taskId, task);
  logActivity(data.assignee, `Task 생성: ${task.title}`, taskId);
  return task;
}

export function updateTask(taskId: string, updates: Partial<Task>): Task | null {
  ensureSeeded();
  const task = tasks.get(taskId);
  if (!task) return null;
  if (updates.taskStatus !== undefined) task.taskStatus = updates.taskStatus;
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.progress !== undefined) task.progress = updates.progress;
  if (updates.assignee !== undefined) task.assignee = updates.assignee;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.result !== undefined) task.result = updates.result;
  if (updates.blockers !== undefined) task.blockers = updates.blockers;
  task.updatedAt = new Date().toISOString();
  logActivity(task.assignee, `Task 업데이트: ${task.title}`, taskId);
  return task;
}

export function deleteTask(taskId: string): boolean {
  ensureSeeded();
  return tasks.delete(taskId);
}

export function getBoard(projectCode: string): Record<string, Task[]> {
  const all = listTasks({ project: projectCode });
  const board: Record<string, Task[]> = {};
  const statuses = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'];
  statuses.forEach((s) => { board[s] = []; });
  all.forEach((t) => {
    if (!board[t.taskStatus]) board[t.taskStatus] = [];
    board[t.taskStatus].push(t);
  });
  return board;
}

export function getProgress(projectCode: string) {
  const all = listTasks({ project: projectCode });
  const phases = ['P0', 'P1', 'P2', 'P3', 'P4'];
  return phases.map((phase) => {
    const phaseTasks = all.filter((t) => t.phase === phase);
    const done = phaseTasks.filter((t) => t.taskStatus === 'done').length;
    const total = phaseTasks.length;
    return { phase, total, done, percentage: total > 0 ? Math.round((done / total) * 100) : 0 };
  }).filter((p) => p.total > 0);
}

export function getDashboard() {
  ensureSeeded();
  const all = Array.from(tasks.values());
  const byStatus: Record<string, number> = {};
  all.forEach((t) => { byStatus[t.taskStatus] = (byStatus[t.taskStatus] || 0) + 1; });

  const projectMap = new Map<string, { total: number; done: number }>();
  all.forEach((t) => {
    const p = projectMap.get(t.project) || { total: 0, done: 0 };
    p.total++;
    if (t.taskStatus === 'done') p.done++;
    projectMap.set(t.project, p);
  });

  return {
    totalTasks: all.length,
    byStatus,
    byProject: Array.from(projectMap.entries()).map(([code, v]) => ({ code, ...v })),
  };
}

export function getWorkload() {
  ensureSeeded();
  const all = Array.from(tasks.values());
  const map = new Map<string, { active: number; total: number }>();
  all.forEach((t) => {
    const w = map.get(t.assignee) || { active: 0, total: 0 };
    w.total++;
    if (t.taskStatus === 'in_progress' || t.taskStatus === 'review') w.active++;
    map.set(t.assignee, w);
  });
  return Array.from(map.entries()).map(([assignee, v]) => ({ assignee, ...v }));
}

function logActivity(agent: string, action: string, taskId?: string) {
  activities.unshift({ agent, action, taskId, createdAt: new Date().toISOString() });
  if (activities.length > 100) activities.length = 100;
}

export function getActivity(limit = 20) {
  ensureSeeded();
  return activities.slice(0, limit);
}
