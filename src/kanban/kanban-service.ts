import { eq, desc, like, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tasks, projects, activityLog, stageGates } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import type { AgentType } from '../config.js';

type Phase = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
type Domain = 'DOC' | 'UI' | 'FE' | 'BE' | 'DB' | 'QA' | 'OPS' | 'MKT';
type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
type Priority = 'critical' | 'high' | 'medium' | 'low';
type GateStatus = 'not_started' | 'ai_verified' | 'po_approved' | 'rejected';

// ============================================================
// 타입 정의
// ============================================================

export interface CreateTaskInput {
  title: string;
  description: string;
  projectCode: string;
  phase: Phase;
  domain: Domain;
  assignee: AgentType;
  priority?: Priority;
  dueDate?: Date;
  dependencies?: string[];
  createdBy?: AgentType;
}

export interface UpdateTaskInput {
  taskStatus?: TaskStatus;
  progress?: number;
  assignee?: AgentType;
  priority?: Priority;
  blockers?: string;
  result?: string;
  outputFiles?: string[];
  reviewNotes?: string;
  verificationStatus?: 'not_verified' | 'passed' | 'failed';
}

// 인메모리 폴백 (DB 없을 때)
interface InMemoryTask {
  id: string;
  taskId: string;
  title: string;
  description: string;
  project: string;
  phase: Phase;
  domain: Domain;
  assignee: AgentType;
  taskStatus: TaskStatus;
  priority: Priority;
  progress: number;
  dependencies: string[];
  dueDate?: Date;
  blockers?: string;
  result?: string;
  outputFiles: string[];
  reviewNotes?: string;
  verificationStatus: 'not_verified' | 'passed' | 'failed';
  createdBy: AgentType;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ============================================================
// 칸반 서비스
// ============================================================

class KanbanService {
  // 인메모리 저장소 (DB 없을 때 사용)
  private memoryTasks = new Map<string, InMemoryTask>();
  private taskCounter = new Map<string, number>();  // prefix → counter

  // ============================================================
  // Task ID 자동 생성
  // ============================================================

  async generateTaskId(projectCode: string, phase: Phase, domain: Domain): Promise<string> {
    const prefix = `${projectCode}-${phase}${domain}`;
    const db = getDb();

    if (db) {
      const lastTask = await db.select({ taskId: tasks.taskId })
        .from(tasks)
        .where(like(tasks.taskId, `${prefix}-%`))
        .orderBy(desc(tasks.taskId))
        .limit(1);

      let nextNum = 1;
      if (lastTask.length > 0 && lastTask[0].taskId) {
        const lastNum = parseInt(lastTask[0].taskId.split('-').pop() || '0');
        nextNum = lastNum + 1;
      }
      return `${prefix}-${String(nextNum).padStart(3, '0')}`;
    }

    // 인메모리 폴백
    const current = this.taskCounter.get(prefix) || 0;
    const nextNum = current + 1;
    this.taskCounter.set(prefix, nextNum);
    return `${prefix}-${String(nextNum).padStart(3, '0')}`;
  }

  // ============================================================
  // Task CRUD
  // ============================================================

  async createTask(input: CreateTaskInput): Promise<InMemoryTask> {
    const taskId = await this.generateTaskId(input.projectCode, input.phase, input.domain);
    const now = new Date();
    const db = getDb();

    const task: InMemoryTask = {
      id: crypto.randomUUID(),
      taskId,
      title: input.title,
      description: input.description,
      project: input.projectCode,
      phase: input.phase,
      domain: input.domain,
      assignee: input.assignee,
      taskStatus: 'backlog',
      priority: input.priority || 'medium',
      progress: 0,
      dependencies: input.dependencies || [],
      dueDate: input.dueDate,
      outputFiles: [],
      verificationStatus: 'not_verified',
      createdBy: input.createdBy || 'po',
      createdAt: now,
      updatedAt: now,
    };

    if (db) {
      await db.insert(tasks).values({
        id: task.id,
        taskId: task.taskId,
        title: task.title,
        description: task.description,
        project: task.project,
        phase: task.phase,
        domain: task.domain,
        assignee: task.assignee,
        taskStatus: task.taskStatus,
        priority: task.priority,
        progress: task.progress,
        dependencies: task.dependencies,
        dueDate: task.dueDate,
        createdBy: task.createdBy,
        outputFiles: task.outputFiles,
      });

      // 활동 로그
      await db.insert(activityLog).values({
        taskId: task.id,
        agent: task.createdBy,
        action: 'created',
        details: { comment: `Task ${task.taskId} 생성` },
      });
    }

    this.memoryTasks.set(taskId, task);
    logger.info('KANBAN', `Task 생성: ${taskId} - ${task.title}`);
    return task;
  }

  async getTask(taskId: string): Promise<InMemoryTask | null> {
    // 인메모리 먼저 확인
    const memTask = this.memoryTasks.get(taskId);
    if (memTask) return memTask;

    const db = getDb();
    if (!db) return null;

    const result = await db.select().from(tasks)
      .where(eq(tasks.taskId, taskId))
      .limit(1);

    if (result.length === 0) return null;

    const row = result[0];
    return {
      id: row.id,
      taskId: row.taskId || taskId,
      title: row.title,
      description: row.description,
      project: row.project || '',
      phase: (row.phase || 'P0') as Phase,
      domain: (row.domain || 'DOC') as Domain,
      assignee: (row.assignee || 'po') as AgentType,
      taskStatus: (row.taskStatus || 'backlog') as TaskStatus,
      priority: (row.priority || 'medium') as Priority,
      progress: row.progress || 0,
      dependencies: (row.dependencies as string[]) || [],
      dueDate: row.dueDate || undefined,
      blockers: row.blockers || undefined,
      result: row.result || undefined,
      outputFiles: (row.outputFiles as string[]) || [],
      reviewNotes: row.reviewNotes || undefined,
      verificationStatus: (row.verificationStatus || 'not_verified') as 'not_verified' | 'passed' | 'failed',
      createdBy: (row.createdBy || 'po') as AgentType,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt || undefined,
    };
  }

  async updateTask(taskId: string, updates: UpdateTaskInput, agent: AgentType): Promise<InMemoryTask | null> {
    const task = await this.getTask(taskId);
    if (!task) return null;

    const db = getDb();
    const now = new Date();
    const oldStatus = task.taskStatus;

    // 인메모리 업데이트
    if (updates.taskStatus !== undefined) task.taskStatus = updates.taskStatus;
    if (updates.progress !== undefined) task.progress = updates.progress;
    if (updates.assignee !== undefined) task.assignee = updates.assignee;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.blockers !== undefined) task.blockers = updates.blockers;
    if (updates.result !== undefined) task.result = updates.result;
    if (updates.outputFiles !== undefined) task.outputFiles = updates.outputFiles;
    if (updates.reviewNotes !== undefined) task.reviewNotes = updates.reviewNotes;
    if (updates.verificationStatus !== undefined) task.verificationStatus = updates.verificationStatus;
    task.updatedAt = now;

    if (task.taskStatus === 'done' && !task.completedAt) {
      task.completedAt = now;
    }

    this.memoryTasks.set(taskId, task);

    if (db) {
      const dbUpdates: Record<string, unknown> = { updatedAt: now };
      if (updates.taskStatus !== undefined) dbUpdates.taskStatus = updates.taskStatus;
      if (updates.progress !== undefined) dbUpdates.progress = updates.progress;
      if (updates.assignee !== undefined) dbUpdates.assignee = updates.assignee;
      if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
      if (updates.blockers !== undefined) dbUpdates.blockers = updates.blockers;
      if (updates.result !== undefined) dbUpdates.result = updates.result;
      if (updates.outputFiles !== undefined) dbUpdates.outputFiles = updates.outputFiles;
      if (updates.reviewNotes !== undefined) dbUpdates.reviewNotes = updates.reviewNotes;
      if (updates.verificationStatus !== undefined) dbUpdates.verificationStatus = updates.verificationStatus;
      if (task.taskStatus === 'done' && task.completedAt) dbUpdates.completedAt = task.completedAt;

      await db.update(tasks)
        .set(dbUpdates)
        .where(eq(tasks.taskId, taskId));

      // 상태 변경 로그
      if (updates.taskStatus && updates.taskStatus !== oldStatus) {
        await db.insert(activityLog).values({
          taskId: task.id,
          agent,
          action: 'status_changed',
          details: { from: oldStatus, to: updates.taskStatus },
        });
      }
    }

    logger.info('KANBAN', `Task 업데이트: ${taskId} (${agent})`);
    return task;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const task = this.memoryTasks.get(taskId);
    this.memoryTasks.delete(taskId);

    const db = getDb();
    if (db) {
      await db.delete(tasks)
        .where(eq(tasks.taskId, taskId));
      return true;
    }

    return !!task;
  }

  // ============================================================
  // 조회
  // ============================================================

  async listTasks(filters?: {
    project?: string;
    phase?: Phase;
    assignee?: AgentType;
    status?: TaskStatus;
    domain?: Domain;
  }): Promise<InMemoryTask[]> {
    const db = getDb();

    if (db) {
      const conditions = [];
      if (filters?.project) conditions.push(eq(tasks.project, filters.project));
      if (filters?.phase) conditions.push(eq(tasks.phase, filters.phase));
      if (filters?.assignee) conditions.push(eq(tasks.assignee, filters.assignee));
      if (filters?.status) conditions.push(eq(tasks.taskStatus, filters.status));
      if (filters?.domain) conditions.push(eq(tasks.domain, filters.domain));

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const rows = await db.select().from(tasks)
        .where(where)
        .orderBy(tasks.priority, tasks.createdAt);

      return rows.map(row => ({
        id: row.id,
        taskId: row.taskId || '',
        title: row.title,
        description: row.description,
        project: row.project || '',
        phase: (row.phase || 'P0') as Phase,
        domain: (row.domain || 'DOC') as Domain,
        assignee: (row.assignee || 'po') as AgentType,
        taskStatus: (row.taskStatus || 'backlog') as TaskStatus,
        priority: (row.priority || 'medium') as Priority,
        progress: row.progress || 0,
        dependencies: (row.dependencies as string[]) || [],
        dueDate: row.dueDate || undefined,
        blockers: row.blockers || undefined,
        result: row.result || undefined,
        outputFiles: (row.outputFiles as string[]) || [],
        reviewNotes: row.reviewNotes || undefined,
        verificationStatus: (row.verificationStatus || 'not_verified') as 'not_verified' | 'passed' | 'failed',
        createdBy: (row.createdBy || 'po') as AgentType,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        completedAt: row.completedAt || undefined,
      }));
    }

    // 인메모리 폴백
    let result = Array.from(this.memoryTasks.values());
    if (filters?.project) result = result.filter(t => t.project === filters.project);
    if (filters?.phase) result = result.filter(t => t.phase === filters.phase);
    if (filters?.assignee) result = result.filter(t => t.assignee === filters.assignee);
    if (filters?.status) result = result.filter(t => t.taskStatus === filters.status);
    if (filters?.domain) result = result.filter(t => t.domain === filters.domain);
    return result;
  }

  async getBoardView(projectCode: string): Promise<Map<TaskStatus, InMemoryTask[]>> {
    const allTasks = await this.listTasks({ project: projectCode });
    const board = new Map<TaskStatus, InMemoryTask[]>();

    const statuses: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'];
    for (const status of statuses) {
      board.set(status, allTasks.filter(t => t.taskStatus === status));
    }

    return board;
  }

  async getPhaseProgress(projectCode: string): Promise<Array<{
    phase: Phase;
    total: number;
    done: number;
    percentage: number;
  }>> {
    const allTasks = await this.listTasks({ project: projectCode });
    const phases: Phase[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

    return phases.map(phase => {
      const phaseTasks = allTasks.filter(t => t.phase === phase);
      const doneTasks = phaseTasks.filter(t => t.taskStatus === 'done');
      return {
        phase,
        total: phaseTasks.length,
        done: doneTasks.length,
        percentage: phaseTasks.length > 0 ? Math.round((doneTasks.length / phaseTasks.length) * 100) : 0,
      };
    }).filter(p => p.total > 0);
  }

  async getWorkload(): Promise<Array<{
    assignee: AgentType;
    active: number;
    total: number;
  }>> {
    const allTasks = await this.listTasks();
    const agents: AgentType[] = ['po', 'dev', 'design', 'cs', 'marketing'];

    return agents.map(agent => {
      const agentTasks = allTasks.filter(t => t.assignee === agent);
      const activeTasks = agentTasks.filter(t =>
        ['todo', 'in_progress', 'review'].includes(t.taskStatus)
      );
      return {
        assignee: agent,
        active: activeTasks.length,
        total: agentTasks.length,
      };
    }).filter(w => w.total > 0);
  }

  // ============================================================
  // Stage Gate 검증
  // ============================================================

  // 인메모리 Gate 저장소
  private memoryGates = new Map<string, {
    projectCode: string;
    phase: Phase;
    gateStatus: GateStatus;
    aiResult?: {
      totalTasks: number;
      completedTasks: number;
      passRate: number;
      issues: string[];
      recommendation: 'pass' | 'fail' | 'conditional';
    };
    poNotes?: string;
    verifiedAt?: Date;
    approvedAt?: Date;
  }>();

  async requestStageGate(projectCode: string, phase: Phase): Promise<string> {
    // 해당 Phase의 모든 Task 조회
    const phaseTasks = await this.listTasks({ project: projectCode, phase });
    const totalTasks = phaseTasks.length;

    if (totalTasks === 0) {
      return `❌ ${projectCode} ${phase} Phase에 등록된 Task가 없습니다. Gate 검증 불가.`;
    }

    const completedTasks = phaseTasks.filter(t => t.taskStatus === 'done').length;
    const blockedTasks = phaseTasks.filter(t => t.taskStatus === 'blocked').length;
    const passRate = Math.round((completedTasks / totalTasks) * 100);

    // 이슈 목록 생성
    const issues: string[] = [];
    const incompleteTasks = phaseTasks.filter(t => t.taskStatus !== 'done');
    for (const t of incompleteTasks) {
      issues.push(`${t.taskId}: ${t.title} (${t.taskStatus}${t.blockers ? ` - 차단: ${t.blockers}` : ''})`);
    }

    // AI 검증 판정
    let recommendation: 'pass' | 'fail' | 'conditional';
    if (passRate >= 100) {
      recommendation = 'pass';
    } else if (passRate >= 80 && blockedTasks === 0) {
      recommendation = 'conditional';
    } else {
      recommendation = 'fail';
    }

    const aiResult = { totalTasks, completedTasks, passRate, issues, recommendation };
    const gateKey = `${projectCode}-${phase}`;

    // DB 저장
    const db = getDb();
    if (db) {
      // 프로젝트 ID 조회
      const projectRows = await db.select({ id: projects.id })
        .from(projects)
        .where(eq(projects.code, projectCode))
        .limit(1);

      if (projectRows.length > 0) {
        const projectId = projectRows[0].id;

        // upsert (기존 gate 있으면 업데이트, 없으면 삽입)
        const existing = await db.select()
          .from(stageGates)
          .where(and(eq(stageGates.projectId, projectId), eq(stageGates.phase, phase)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(stageGates)
            .set({ gateStatus: 'ai_verified', aiResult, verifiedAt: new Date() })
            .where(eq(stageGates.id, existing[0].id));
        } else {
          await db.insert(stageGates).values({
            projectId,
            phase,
            gateStatus: 'ai_verified',
            aiResult,
            verifiedAt: new Date(),
          });
        }
      }

      // 활동 로그
      await db.insert(activityLog).values({
        agent: 'po',
        action: 'gate_requested',
        details: { metadata: { projectCode, phase, ...aiResult } },
      });
    }

    // 인메모리 저장
    this.memoryGates.set(gateKey, {
      projectCode, phase,
      gateStatus: 'ai_verified',
      aiResult,
      verifiedAt: new Date(),
    });

    const recEmoji = recommendation === 'pass' ? '✅' : recommendation === 'conditional' ? '⚠️' : '❌';
    const lines = [
      `🔍 Stage Gate 검증 — ${projectCode} ${phase}`,
      '',
      `전체 Task: ${totalTasks}건`,
      `완료: ${completedTasks}건 / 미완료: ${totalTasks - completedTasks}건`,
      `완료율: ${passRate}%`,
      `차단됨: ${blockedTasks}건`,
      '',
      `${recEmoji} AI 판정: ${recommendation.toUpperCase()}`,
    ];

    if (issues.length > 0) {
      lines.push('', '미완료 Task:');
      for (const issue of issues.slice(0, 10)) {
        lines.push(`  - ${issue}`);
      }
      if (issues.length > 10) {
        lines.push(`  ... +${issues.length - 10}건`);
      }
    }

    if (recommendation === 'pass') {
      lines.push('', 'PO 승인 대기 중. kanban_gate_approve로 최종 승인하세요.');
    } else if (recommendation === 'conditional') {
      lines.push('', '조건부 통과. 미완료 Task 검토 후 kanban_gate_approve로 판단하세요.');
    } else {
      lines.push('', '미달. 미완료 Task를 처리한 후 다시 검증하세요.');
    }

    logger.info('KANBAN', `Stage Gate 검증: ${projectCode} ${phase} → ${recommendation}`);
    return lines.join('\n');
  }

  async approveStageGate(
    projectCode: string,
    phase: Phase,
    approved: boolean,
    notes?: string
  ): Promise<string> {
    const gateKey = `${projectCode}-${phase}`;
    const gate = this.memoryGates.get(gateKey);

    if (!gate || gate.gateStatus !== 'ai_verified') {
      return `❌ ${projectCode} ${phase}에 대한 AI 검증이 완료되지 않았습니다. 먼저 kanban_gate_request를 실행하세요.`;
    }

    const now = new Date();
    const newStatus: GateStatus = approved ? 'po_approved' : 'rejected';

    // 인메모리 업데이트
    gate.gateStatus = newStatus;
    gate.poNotes = notes;
    if (approved) gate.approvedAt = now;

    // DB 업데이트
    const db = getDb();
    if (db) {
      const projectRows = await db.select({ id: projects.id })
        .from(projects)
        .where(eq(projects.code, projectCode))
        .limit(1);

      if (projectRows.length > 0) {
        const projectId = projectRows[0].id;

        await db.update(stageGates)
          .set({
            gateStatus: newStatus,
            poNotes: notes || null,
            approvedAt: approved ? now : null,
          })
          .where(and(eq(stageGates.projectId, projectId), eq(stageGates.phase, phase)));

        // 승인 시 프로젝트 Phase 자동 진급
        if (approved) {
          const nextPhase = this.getNextPhase(phase);
          if (nextPhase) {
            await db.update(projects)
              .set({ currentPhase: nextPhase, updatedAt: now })
              .where(eq(projects.id, projectId));
          }
        }

        // 활동 로그
        await db.insert(activityLog).values({
          agent: 'po',
          action: approved ? 'gate_approved' : 'gate_rejected',
          details: { metadata: { projectCode, phase, approved, notes } },
        });
      }
    }

    if (approved) {
      const nextPhase = this.getNextPhase(phase);
      const lines = [
        `✅ Stage Gate 승인 — ${projectCode} ${phase}`,
        `PO 승인 완료.`,
      ];
      if (notes) lines.push(`코멘트: ${notes}`);
      if (nextPhase) lines.push(`프로젝트가 ${nextPhase} Phase로 진급합니다.`);
      else lines.push(`최종 Phase(P4) 완료! 프로젝트 운영 단계입니다.`);

      logger.info('KANBAN', `Stage Gate 승인: ${projectCode} ${phase} → ${nextPhase || 'COMPLETE'}`);
      return lines.join('\n');
    } else {
      const lines = [
        `❌ Stage Gate 반려 — ${projectCode} ${phase}`,
        `PO가 반려했습니다.`,
      ];
      if (notes) lines.push(`사유: ${notes}`);
      lines.push(`미완료 Task를 처리한 후 다시 kanban_gate_request를 실행하세요.`);

      logger.info('KANBAN', `Stage Gate 반려: ${projectCode} ${phase}`);
      return lines.join('\n');
    }
  }

  private getNextPhase(phase: Phase): Phase | null {
    const order: Phase[] = ['P0', 'P1', 'P2', 'P3', 'P4'];
    const idx = order.indexOf(phase);
    return idx < order.length - 1 ? order[idx + 1] : null;
  }

  // ============================================================
  // 향상된 활동 로그
  // ============================================================

  async logActivity(
    agent: AgentType,
    action: string,
    taskId?: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    const db = getDb();
    if (!db) return;

    try {
      await db.insert(activityLog).values({
        taskId: taskId || null,
        agent,
        action: action as any,
        details: details || {},
      });
    } catch (err) {
      logger.warn('KANBAN', `활동 로그 기록 실패: ${err}`);
    }
  }

  async getRecentActivity(limit: number = 20): Promise<Array<{
    agent: string;
    action: string;
    details: Record<string, unknown>;
    createdAt: Date;
  }>> {
    const db = getDb();
    if (!db) return [];

    const rows = await db.select()
      .from(activityLog)
      .orderBy(desc(activityLog.createdAt))
      .limit(limit);

    return rows.map(r => ({
      agent: r.agent,
      action: r.action,
      details: (r.details || {}) as Record<string, unknown>,
      createdAt: r.createdAt,
    }));
  }

  // ============================================================
  // 대시보드
  // ============================================================

  async getDashboard(): Promise<{
    totalTasks: number;
    byStatus: Record<string, number>;
    byProject: Array<{ code: string; total: number; done: number }>;
    workload: Array<{ assignee: AgentType; active: number }>;
  }> {
    const allTasks = await this.listTasks();

    const byStatus: Record<string, number> = {};
    for (const t of allTasks) {
      byStatus[t.taskStatus] = (byStatus[t.taskStatus] || 0) + 1;
    }

    const projectMap = new Map<string, { total: number; done: number }>();
    for (const t of allTasks) {
      if (!t.project) continue;
      const p = projectMap.get(t.project) || { total: 0, done: 0 };
      p.total++;
      if (t.taskStatus === 'done') p.done++;
      projectMap.set(t.project, p);
    }

    const workload = await this.getWorkload();

    return {
      totalTasks: allTasks.length,
      byStatus,
      byProject: Array.from(projectMap.entries()).map(([code, v]) => ({ code, ...v })),
      workload: workload.map(w => ({ assignee: w.assignee, active: w.active })),
    };
  }
}

export const kanbanService = new KanbanService();
