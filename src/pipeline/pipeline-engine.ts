import { logger } from '../utils/logger.js';
import type { AgentType } from '../config.js';

// ============================================================
// 파이프라인 스테이지 정의
// ============================================================

export type PipelineStage =
  | 'intake'      // CS 접수
  | 'triage'      // OpenClaw 판단/분류
  | 'build'       // Dev(Builder) 구현
  | 'qa'          // QA 검증 (현재: Dev-Architect 대행)
  | 'audit'       // Auditor 감사
  | 'integrate'   // 통합 (현재: OpenClaw 대행)
  | 'release'     // 릴리즈 승인
  | 'closed';     // 완료

export type PipelinePriority = 'critical' | 'high' | 'medium' | 'low';
export type PipelineStatus = 'active' | 'paused' | 'blocked' | 'completed' | 'cancelled';

// ============================================================
// 파이프라인 아이템
// ============================================================

export interface PipelineItem {
  id: string;
  title: string;
  description: string;
  stage: PipelineStage;
  status: PipelineStatus;
  priority: PipelinePriority;
  assignee: AgentType | null;
  createdBy: AgentType;
  ticketId?: string;          // 연결된 티켓 ID
  history: PipelineTransition[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineTransition {
  from: PipelineStage;
  to: PipelineStage;
  triggeredBy: AgentType;
  reason: string;
  timestamp: Date;
}

// ============================================================
// 스테이지 전이 규칙
// ============================================================

const STAGE_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  intake:    ['triage', 'closed'],
  triage:    ['build', 'closed'],
  build:     ['qa', 'triage'],            // qa로 진행 or triage로 반려
  qa:        ['audit', 'build'],           // audit로 진행 or build로 반려
  audit:     ['integrate', 'build'],       // integrate로 진행 or build로 수정요청
  integrate: ['release', 'audit'],         // release로 진행 or audit 재검
  release:   ['closed'],
  closed:    [],                           // 종료 상태
};

// 스테이지별 기본 담당자 (5봇 체제)
const STAGE_DEFAULT_ASSIGNEE: Record<PipelineStage, AgentType | null> = {
  intake:    'cs',         // CS가 접수
  triage:    'po',         // OpenClaw가 판단
  build:     'dev',        // Dev(Builder)가 구현
  qa:        'po',         // Phase 4 전까지 OpenClaw(architect모드)가 대행
  audit:     'po',         // PO(auditor모드)가 감사
  integrate: 'po',         // Phase 4 전까지 OpenClaw가 대행
  release:   'po',         // OpenClaw가 릴리즈 승인
  closed:    null,
};

// 스테이지 한국어 표시명
export const STAGE_DISPLAY_NAMES: Record<PipelineStage, string> = {
  intake:    '📥 접수',
  triage:    '🔍 분류',
  build:     '🔨 구현',
  qa:        '🧪 QA',
  audit:     '🔍 감사',
  integrate: '🔗 통합',
  release:   '🚀 릴리즈',
  closed:    '✅ 완료',
};

// ============================================================
// 파이프라인 엔진 (인메모리)
// ============================================================

let nextId = 1;

class PipelineEngine {
  private items: Map<string, PipelineItem> = new Map();

  // 새 파이프라인 아이템 생성
  createItem(
    title: string,
    description: string,
    createdBy: AgentType,
    options?: {
      priority?: PipelinePriority;
      startStage?: PipelineStage;
      ticketId?: string;
    }
  ): PipelineItem {
    const id = `PL-${String(nextId++).padStart(4, '0')}`;
    const stage = options?.startStage ?? 'intake';
    const assignee = STAGE_DEFAULT_ASSIGNEE[stage];

    const item: PipelineItem = {
      id,
      title,
      description,
      stage,
      status: 'active',
      priority: options?.priority ?? 'medium',
      assignee,
      createdBy,
      ticketId: options?.ticketId,
      history: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.items.set(id, item);
    logger.info('PIPELINE', `Created: ${id} "${title}" [${stage}] → ${assignee ?? 'unassigned'}`);
    return item;
  }

  // 스테이지 전이
  transition(
    itemId: string,
    toStage: PipelineStage,
    triggeredBy: AgentType,
    reason: string
  ): { success: boolean; error?: string; item?: PipelineItem } {
    const item = this.items.get(itemId);
    if (!item) {
      return { success: false, error: `아이템을 찾을 수 없습니다: ${itemId}` };
    }

    const allowedNext = STAGE_TRANSITIONS[item.stage];
    if (!allowedNext.includes(toStage)) {
      return {
        success: false,
        error: `${STAGE_DISPLAY_NAMES[item.stage]} → ${STAGE_DISPLAY_NAMES[toStage]} 전이는 허용되지 않습니다. 가능: ${allowedNext.map(s => STAGE_DISPLAY_NAMES[s]).join(', ')}`,
      };
    }

    const transition: PipelineTransition = {
      from: item.stage,
      to: toStage,
      triggeredBy,
      reason,
      timestamp: new Date(),
    };

    item.history.push(transition);
    item.stage = toStage;
    item.assignee = STAGE_DEFAULT_ASSIGNEE[toStage];
    item.updatedAt = new Date();

    if (toStage === 'closed') {
      item.status = 'completed';
    }

    logger.info('PIPELINE', `Transition: ${itemId} ${STAGE_DISPLAY_NAMES[transition.from]} → ${STAGE_DISPLAY_NAMES[toStage]} by ${triggeredBy} (${reason})`);
    return { success: true, item };
  }

  // 아이템 조회
  getItem(itemId: string): PipelineItem | undefined {
    return this.items.get(itemId);
  }

  // 전체 파이프라인 현황
  getStatus(): string {
    if (this.items.size === 0) {
      return '📊 파이프라인이 비어있습니다.';
    }

    const lines: string[] = ['📊 <b>파이프라인 현황</b>\n'];

    // 스테이지별 그룹핑
    const byStage = new Map<PipelineStage, PipelineItem[]>();
    for (const item of this.items.values()) {
      if (item.status === 'completed' || item.status === 'cancelled') continue;
      const list = byStage.get(item.stage) ?? [];
      list.push(item);
      byStage.set(item.stage, list);
    }

    const stages: PipelineStage[] = ['intake', 'triage', 'build', 'qa', 'audit', 'integrate', 'release'];
    for (const stage of stages) {
      const items = byStage.get(stage);
      if (!items || items.length === 0) continue;
      lines.push(`${STAGE_DISPLAY_NAMES[stage]} (${items.length})`);
      for (const item of items) {
        const pri = item.priority === 'critical' ? '🔴' : item.priority === 'high' ? '🟠' : item.priority === 'medium' ? '🟡' : '🟢';
        lines.push(`  ${pri} ${item.id}: ${item.title}`);
      }
      lines.push('');
    }

    // 최근 완료
    const completed = Array.from(this.items.values())
      .filter(i => i.status === 'completed')
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 5);

    if (completed.length > 0) {
      lines.push('✅ 최근 완료');
      for (const item of completed) {
        lines.push(`  ${item.id}: ${item.title}`);
      }
    }

    return lines.join('\n');
  }

  // 에이전트별 담당 아이템 조회
  getItemsByAssignee(agentType: AgentType): PipelineItem[] {
    return Array.from(this.items.values())
      .filter(i => i.assignee === agentType && i.status === 'active');
  }

  // 아이템 우선순위 변경
  setPriority(itemId: string, priority: PipelinePriority): boolean {
    const item = this.items.get(itemId);
    if (!item) return false;
    item.priority = priority;
    item.updatedAt = new Date();
    return true;
  }

  // 아이템 상태 변경
  setStatus(itemId: string, status: PipelineStatus): boolean {
    const item = this.items.get(itemId);
    if (!item) return false;
    item.status = status;
    item.updatedAt = new Date();
    return true;
  }

  // 전체 카운트
  getStats(): { total: number; active: number; completed: number; byStage: Record<string, number> } {
    let total = 0, active = 0, completed = 0;
    const byStage: Record<string, number> = {};

    for (const item of this.items.values()) {
      total++;
      if (item.status === 'active') active++;
      if (item.status === 'completed') completed++;
      byStage[item.stage] = (byStage[item.stage] ?? 0) + 1;
    }

    return { total, active, completed, byStage };
  }
}

// 싱글톤 인스턴스
export const pipeline = new PipelineEngine();
