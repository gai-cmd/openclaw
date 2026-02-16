const BASE = '/api';

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json.data ?? json;
}

export interface Task {
  id: string;
  taskId: string;
  title: string;
  description: string;
  result?: string;
  project: string;
  phase: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
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

export interface DashboardData {
  totalTasks: number;
  byStatus: Record<string, number>;
  byProject: { code: string; total: number; done: number }[];
  workload: { assignee: string; active: number }[];
}

export interface Workload {
  assignee: string;
  active: number;
  total: number;
}

export interface PhaseProgress {
  phase: string;
  total: number;
  done: number;
  percentage: number;
}

// Tasks
export const fetchTasks = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<Task[]>(`/tasks${qs}`);
};

export const fetchBoard = (code: string) =>
  request<Record<string, Task[]>>(`/board/${code}`);

export const createTask = (body: Record<string, unknown>) =>
  request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) });

export const updateTask = (taskId: string, body: Record<string, unknown>) =>
  request<Task>(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteTask = (taskId: string) =>
  request<void>(`/tasks/${taskId}`, { method: 'DELETE' });

// Dashboard
export const fetchDashboard = () => request<DashboardData>('/dashboard');
export const fetchWorkload = () => request<Workload[]>('/workload');
export const fetchActivity = (limit = 20) => request<any[]>(`/activity?limit=${limit}`);
export const fetchProgress = (code: string) => request<PhaseProgress[]>(`/progress/${code}`);
