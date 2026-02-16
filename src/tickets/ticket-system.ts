import { logger } from '../utils/logger.js';
import { pipeline } from '../pipeline/pipeline-engine.js';
import type { AgentType } from '../config.js';

// ============================================================
// 티켓 타입 정의
// ============================================================

export type TicketCategory = 'bug' | 'feature' | 'inquiry' | 'complaint' | 'improvement' | 'other';
export type TicketPriority = 'urgent' | 'high' | 'normal' | 'low';
export type TicketStatus = 'open' | 'in_progress' | 'escalated' | 'resolved' | 'closed';

export interface Ticket {
  id: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  customerName: string;
  assignee: AgentType;
  pipelineItemId?: string;    // 에스컬레이션 시 연결된 파이프라인 아이템
  resolution?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// 키워드 기반 자동 분류
// ============================================================

const CATEGORY_KEYWORDS: Record<TicketCategory, string[]> = {
  bug:         ['버그', '오류', '에러', 'bug', 'error', '안됨', '작동안', '크래시', '깨짐', '문제'],
  feature:     ['기능', '추가', '요청', 'feature', '신규', '만들어', '개발해'],
  inquiry:     ['문의', '질문', '어떻게', '방법', '안내', '확인'],
  complaint:   ['불만', '불편', '개선', '짜증', '화남', '최악'],
  improvement: ['개선', '향상', '최적화', '속도', '느림', '성능'],
  other:       [],
};

const PRIORITY_KEYWORDS: Record<TicketPriority, string[]> = {
  urgent: ['긴급', '급함', 'urgent', '즉시', '당장', '심각', '장애', '다운'],
  high:   ['빨리', '중요', '높음', '서비스'],
  normal: [],
  low:    ['나중에', '여유', '참고', '건의'],
};

// ============================================================
// 티켓 시스템 (인메모리)
// ============================================================

let nextTicketId = 1;

class TicketSystem {
  private tickets: Map<string, Ticket> = new Map();

  // 티켓 생성
  createTicket(
    title: string,
    description: string,
    customerName: string,
    options?: {
      category?: TicketCategory;
      priority?: TicketPriority;
      tags?: string[];
    }
  ): Ticket {
    const id = `TK-${String(nextTicketId++).padStart(4, '0')}`;

    // 자동 분류
    const category = options?.category ?? this.classifyCategory(title + ' ' + description);
    const priority = options?.priority ?? this.classifyPriority(title + ' ' + description);

    const ticket: Ticket = {
      id,
      title,
      description,
      category,
      priority,
      status: 'open',
      customerName,
      assignee: 'cs',
      tags: options?.tags ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tickets.set(id, ticket);
    logger.info('TICKET', `Created: ${id} [${category}/${priority}] "${title}" from ${customerName}`);
    return ticket;
  }

  // 키워드 기반 카테고리 분류
  private classifyCategory(text: string): TicketCategory {
    const lower = text.toLowerCase();
    let bestCategory: TicketCategory = 'other';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = keywords.filter(kw => lower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category as TicketCategory;
      }
    }

    return bestCategory;
  }

  // 키워드 기반 우선순위 분류
  private classifyPriority(text: string): TicketPriority {
    const lower = text.toLowerCase();

    for (const [priority, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        return priority as TicketPriority;
      }
    }

    return 'normal';
  }

  // Dev 에스컬레이션 → 파이프라인 아이템 생성
  escalateToDev(ticketId: string, reason: string): { success: boolean; error?: string; pipelineItemId?: string } {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      return { success: false, error: `티켓을 찾을 수 없습니다: ${ticketId}` };
    }

    // 파이프라인 아이템 생성 (triage 단계에서 시작)
    const pipelineItem = pipeline.createItem(
      `[에스컬레이션] ${ticket.title}`,
      `티켓 ${ticket.id}에서 에스컬레이션됨.\n원본: ${ticket.description}\n사유: ${reason}`,
      'cs',
      {
        priority: ticket.priority === 'urgent' ? 'critical' : ticket.priority === 'high' ? 'high' : 'medium',
        startStage: 'triage',
        ticketId: ticket.id,
      }
    );

    ticket.status = 'escalated';
    ticket.pipelineItemId = pipelineItem.id;
    ticket.updatedAt = new Date();

    logger.info('TICKET', `Escalated: ${ticketId} → Pipeline ${pipelineItem.id}`);
    return { success: true, pipelineItemId: pipelineItem.id };
  }

  // 티켓 해결
  resolveTicket(ticketId: string, resolution: string): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;

    ticket.status = 'resolved';
    ticket.resolution = resolution;
    ticket.updatedAt = new Date();
    logger.info('TICKET', `Resolved: ${ticketId}`);
    return true;
  }

  // 티켓 닫기
  closeTicket(ticketId: string): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;

    ticket.status = 'closed';
    ticket.updatedAt = new Date();
    return true;
  }

  // 티켓 조회
  getTicket(ticketId: string): Ticket | undefined {
    return this.tickets.get(ticketId);
  }

  // 상태별 티켓 목록
  listTickets(filter?: { status?: TicketStatus; category?: TicketCategory; assignee?: AgentType }): Ticket[] {
    let results = Array.from(this.tickets.values());

    if (filter?.status) results = results.filter(t => t.status === filter.status);
    if (filter?.category) results = results.filter(t => t.category === filter.category);
    if (filter?.assignee) results = results.filter(t => t.assignee === filter.assignee);

    return results.sort((a, b) => {
      const priOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      return priOrder[a.priority] - priOrder[b.priority];
    });
  }

  // 티켓 현황 문자열
  getStatusSummary(): string {
    const all = Array.from(this.tickets.values());
    if (all.length === 0) return '📋 티켓이 없습니다.';

    const open = all.filter(t => t.status === 'open').length;
    const inProgress = all.filter(t => t.status === 'in_progress').length;
    const escalated = all.filter(t => t.status === 'escalated').length;
    const resolved = all.filter(t => t.status === 'resolved').length;

    const lines: string[] = [
      '📋 <b>티켓 현황</b>',
      '',
      `  🟡 미처리: ${open}`,
      `  🔵 처리중: ${inProgress}`,
      `  🔴 에스컬레이션: ${escalated}`,
      `  ✅ 해결: ${resolved}`,
      '',
    ];

    // 미처리 티켓 상세
    const openTickets = all.filter(t => t.status === 'open' || t.status === 'in_progress');
    if (openTickets.length > 0) {
      lines.push('<b>미처리 상세:</b>');
      for (const t of openTickets.slice(0, 10)) {
        const pri = t.priority === 'urgent' ? '🔴' : t.priority === 'high' ? '🟠' : '🟡';
        lines.push(`  ${pri} ${t.id} [${t.category}] ${t.title}`);
      }
    }

    return lines.join('\n');
  }

  // 통계
  getStats(): { total: number; open: number; escalated: number; resolved: number; byCategory: Record<string, number> } {
    const all = Array.from(this.tickets.values());
    const byCategory: Record<string, number> = {};
    let open = 0, escalated = 0, resolved = 0;

    for (const t of all) {
      if (t.status === 'open' || t.status === 'in_progress') open++;
      if (t.status === 'escalated') escalated++;
      if (t.status === 'resolved' || t.status === 'closed') resolved++;
      byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    }

    return { total: all.length, open, escalated, resolved, byCategory };
  }
}

// 싱글톤 인스턴스
export const ticketSystem = new TicketSystem();
