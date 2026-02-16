import type { AgentType } from '../config.js';

// ============================================================
// Mission (소대 편제) 타입 정의
// ============================================================

export type MissionStatus =
  | 'planning'      // PO가 미션 분해 중
  | 'dispatched'    // 분대에 지시 완료
  | 'in_progress'   // 분대들 작업 중
  | 'synthesizing'  // PO가 결과 종합 중
  | 'completed'     // 완료
  | 'failed';       // 실패

export type SquadStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type SubTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// 사용 가능한 용병 CLI
export type MercenaryType = 'chatgpt' | 'gemini-cli';

// NATO 분대 호출부호
export const SQUAD_CALLSIGNS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'] as const;
export type SquadCallsign = typeof SQUAD_CALLSIGNS[number];

// ============================================================
// Mission: 소대장이 관리하는 전체 작전
// ============================================================

export interface Mission {
  id: string;                  // MSN-0001
  description: string;         // 원본 사용자 요청
  requester: string;           // 요청자 이름
  status: MissionStatus;
  squads: Squad[];
  finalReport?: string;        // PO 종합 보고서
  chatId: string;              // 보고할 텔레그램 채팅 ID
  createdAt: Date;
  completedAt?: Date;
}

// ============================================================
// Squad: 분대장이 이끄는 작업 단위
// ============================================================

export interface Squad {
  id: string;                  // SQD-ALPHA, SQD-BRAVO, etc.
  callsign: SquadCallsign;
  missionId: string;
  assignee: AgentType;         // dev | design | cs | marketing
  objective: string;           // 분대 목표
  context: string;             // 추가 맥락/제약조건
  deliverables: string[];      // 예상 산출물
  subTasks: SubTask[];         // 하위작업 목록
  status: SquadStatus;
  result?: string;             // 최종 분대 결과
  priority: number;            // 1 = 최우선
  startedAt?: Date;
  completedAt?: Date;
}

// ============================================================
// SubTask: 분대 내 하위작업 (정규병/용병)
// ============================================================

export interface SubTask {
  id: string;                  // SUB-001
  squadId: string;
  description: string;
  executor: 'self' | MercenaryType; // self=자기 LLM, chatgpt/gemini-cli=용병
  status: SubTaskStatus;
  result?: string;
  startedAt?: Date;
  completedAt?: Date;
}

// ============================================================
// 통신 프로토콜 타입
// ============================================================

/** PO → Worker 작전 지시 */
export interface MissionBriefing {
  missionId: string;
  squadId: string;
  callsign: SquadCallsign;
  objective: string;
  context: string;
  deliverables: string[];
  relatedSquads: Array<{
    id: string;
    callsign: SquadCallsign;
    assignee: AgentType;
    objective: string;
  }>;
}

/** Worker → PO 분대 보고 */
export interface SquadReport {
  missionId: string;
  squadId: string;
  callsign: SquadCallsign;
  assignee: AgentType;
  status: SquadStatus;
  result: string;
  files: string[];
  subTaskSummary: Array<{
    id: string;
    description: string;
    status: SubTaskStatus;
    executor: string;
  }>;
}

// ============================================================
// LLM 미션 분해 응답 형식
// ============================================================

export interface DecomposedSquad {
  assignee: string;            // 'dev' | 'design' | 'cs' | 'marketing'
  objective: string;
  context: string;
  deliverables: string[];
  priority: number;
  suggestedSubTasks: string[];
  mercenaryHint: MercenaryType | null;
}

export interface MissionDecomposition {
  squads: DecomposedSquad[];
}
