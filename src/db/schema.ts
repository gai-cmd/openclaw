import {
  pgTable, pgEnum, uuid, text, timestamp, jsonb, integer, varchar, index, unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================
// Kanban Enums (8개) - 칸반차트 데이터 스키마 설계서 기반
// ============================================================

export const phaseEnum = pgEnum('phase', ['P0', 'P1', 'P2', 'P3', 'P4']);
export const domainEnum = pgEnum('domain', ['DOC', 'UI', 'FE', 'BE', 'DB', 'QA', 'OPS', 'MKT']);
export const agentEnum = pgEnum('agent', ['po', 'dev', 'design', 'cs', 'marketing']);
export const taskStatusEnum = pgEnum('task_status', ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked']);
export const priorityEnum = pgEnum('priority', ['critical', 'high', 'medium', 'low']);
export const verificationEnum = pgEnum('verification_status', ['not_verified', 'passed', 'failed']);
export const gateStatusEnum = pgEnum('gate_status', ['not_started', 'ai_verified', 'po_approved', 'rejected']);
export const activityActionEnum = pgEnum('activity_action', [
  'created', 'status_changed', 'assigned', 'commented',
  'progress_updated', 'file_added',
  'gate_requested', 'gate_verified', 'gate_approved', 'gate_rejected',
]);

// ============================================================
// projects (프로젝트) - 칸반 확장
// ============================================================

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  // === 칸반 확장 필드 ===
  code: text('code').unique(),                               // KAN, FXT, TRL, CRM, LIO
  currentPhase: phaseEnum('current_phase').default('P0'),
  status: text('project_status').default('active'),           // active / archived / paused
  leadAgent: agentEnum('lead_agent').default('po'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================
// tasks (작업) - 칸반 확장
// ============================================================

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),

  // 기존 필드 (호환성 유지)
  graphId: text('graph_id'),                                   // DAG 시스템용 (nullable)
  result: text('result'),

  // === 칸반 필드 ===
  taskId: text('task_id').unique(),                            // KAN-P2FE-001 형식
  phase: phaseEnum('phase').default('P0').notNull(),
  domain: domainEnum('domain').default('DOC').notNull(),
  project: text('project'),                                    // 프로젝트 코드 (역정규화)
  assignee: agentEnum('assignee').default('po').notNull(),
  taskStatus: taskStatusEnum('task_status').default('backlog').notNull(),
  priority: priorityEnum('priority').default('medium'),
  progress: integer('progress').default(0),                    // 0~100
  dependencies: jsonb('dependencies').$type<string[]>().default([]),
  dueDate: timestamp('due_date'),

  // 검증 정보
  verificationStatus: verificationEnum('verification_status').default('not_verified'),
  testResult: text('test_result'),
  reviewNotes: text('review_notes'),
  blockers: text('blockers'),

  // 추적 정보
  createdBy: agentEnum('created_by').default('po'),
  outputFiles: jsonb('output_files').$type<string[]>().default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('tasks_task_id_idx').on(table.taskId),
  index('tasks_status_idx').on(table.taskStatus),
  index('tasks_project_phase_idx').on(table.project, table.phase),
  index('tasks_assignee_idx').on(table.assignee),
]);

// ============================================================
// stage_gates (단계 관문) - 신규
// ============================================================

export const stageGates = pgTable('stage_gates', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  phase: phaseEnum('phase').notNull(),
  gateStatus: gateStatusEnum('gate_status').default('not_started').notNull(),
  aiResult: jsonb('ai_result').$type<{
    totalTasks: number;
    completedTasks: number;
    passRate: number;
    issues: string[];
    recommendation: 'pass' | 'fail' | 'conditional';
  }>(),
  poNotes: text('po_notes'),
  verifiedAt: timestamp('verified_at'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  unique('stage_gates_project_phase_unique').on(table.projectId, table.phase),
]);

// ============================================================
// activity_log (활동 로그) - 신규
// ============================================================

export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id),
  agent: agentEnum('agent').notNull(),
  action: activityActionEnum('action').notNull(),
  details: jsonb('details').$type<{
    from?: string;
    to?: string;
    comment?: string;
    files?: string[];
    metadata?: Record<string, unknown>;
  }>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('activity_log_task_idx').on(table.taskId),
  index('activity_log_created_idx').on(table.createdAt),
]);

// ============================================================
// api_usage (API 사용량 추적) - 신규
// ============================================================

export const apiUsage = pgTable('api_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent: agentEnum('agent').notNull(),
  provider: text('provider').notNull(),       // openai / anthropic / gemini
  model: text('model').notNull(),
  tokensInput: integer('tokens_input').default(0),
  tokensOutput: integer('tokens_output').default(0),
  costEstimate: integer('cost_estimate').default(0),  // 센트 단위
  taskId: uuid('task_id').references(() => tasks.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('api_usage_agent_idx').on(table.agent),
  index('api_usage_created_idx').on(table.createdAt),
]);

// ============================================================
// messages (메시지) - 기존 유지
// ============================================================

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id),
  channelId: text('channel_id').notNull(),
  sender: text('sender').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================
// agent_contexts (에이전트 컨텍스트) - 기존 유지
// ============================================================

export const agentContexts = pgTable('agent_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentType: text('agent_type').notNull(),
  projectId: uuid('project_id').references(() => projects.id),
  contextData: jsonb('context_data').$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================
// 파이프라인 테이블 - 기존 유지
// ============================================================

export const pipelineItems = pgTable('pipeline_items', {
  id: varchar('id', { length: 20 }).primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  stage: varchar('stage', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  priority: varchar('priority', { length: 20 }).notNull().default('medium'),
  assignee: varchar('assignee', { length: 20 }),
  createdBy: varchar('created_by', { length: 20 }).notNull(),
  ticketId: varchar('ticket_id', { length: 20 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const pipelineTransitions = pgTable('pipeline_transitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineItemId: varchar('pipeline_item_id', { length: 20 }).references(() => pipelineItems.id).notNull(),
  fromStage: varchar('from_stage', { length: 20 }).notNull(),
  toStage: varchar('to_stage', { length: 20 }).notNull(),
  triggeredBy: varchar('triggered_by', { length: 20 }).notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================
// 티켓 테이블 - 기존 유지
// ============================================================

export const tickets = pgTable('tickets', {
  id: varchar('id', { length: 20 }).primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: varchar('category', { length: 20 }).notNull(),
  priority: varchar('priority', { length: 20 }).notNull().default('normal'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  customerName: text('customer_name').notNull(),
  assignee: varchar('assignee', { length: 20 }).notNull().default('cs'),
  pipelineItemId: varchar('pipeline_item_id', { length: 20 }).references(() => pipelineItems.id),
  resolution: text('resolution'),
  tags: jsonb('tags').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================
// Relations 정의
// ============================================================

export const projectsRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
  stageGates: many(stageGates),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  activities: many(activityLog),
  apiUsages: many(apiUsage),
}));

export const stageGatesRelations = relations(stageGates, ({ one }) => ({
  project: one(projects, {
    fields: [stageGates.projectId],
    references: [projects.id],
  }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  task: one(tasks, {
    fields: [activityLog.taskId],
    references: [tasks.id],
  }),
}));

export const apiUsageRelations = relations(apiUsage, ({ one }) => ({
  task: one(tasks, {
    fields: [apiUsage.taskId],
    references: [tasks.id],
  }),
}));
