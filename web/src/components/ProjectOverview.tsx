import React, { useEffect, useState } from 'react';
import { fetchDashboard, fetchProgress, fetchWorkload, type DashboardData, type PhaseProgress, type Workload } from '../api';

const TEAM = [
  { id: 'po', name: '이레', role: 'PO (총괄)', emoji: '🧠', model: 'Claude Sonnet 4.5', type: 'HUB',
    desc: '프로젝트 총괄. 업무 분배, 팀원 조율, Stage Gate 승인, 의사결정' },
  { id: 'dev', name: '다온', role: 'Developer', emoji: '🔧', model: 'Claude Opus 4.6', type: 'SPOKE',
    desc: '코드 구현, 아키텍처 설계, 기술 리뷰, 배포' },
  { id: 'design', name: '채아', role: 'Designer', emoji: '🎨', model: 'Gemini 2.0 Flash', type: 'SPOKE',
    desc: 'UI/UX 설계, 디자인 시스템, 프로토타입, 시각 자료' },
  { id: 'cs', name: '나래', role: 'CS', emoji: '💬', model: 'GPT-4o', type: 'SPOKE',
    desc: '요구사항 분석, 문서화, 고객 커뮤니케이션, QA' },
  { id: 'marketing', name: '알리', role: 'Marketing', emoji: '📣', model: 'GPT-4o', type: 'SPOKE',
    desc: '콘텐츠 기획, 마케팅 전략, 카피라이팅, 분석' },
];

const PHASES = [
  { id: 'P0', name: '기획', desc: '프로젝트 정의, 요구사항 수집, 범위 설정', color: '#58a6ff' },
  { id: 'P1', name: '설계', desc: '아키텍처, UI/UX, 데이터 스키마 설계', color: '#d29922' },
  { id: 'P2', name: '개발', desc: '구현, 코딩, 통합', color: '#3fb950' },
  { id: 'P3', name: '검증', desc: 'QA, 테스트, 리뷰, 버그 수정', color: '#f5a623' },
  { id: 'P4', name: '운영', desc: '배포, 모니터링, 유지보수', color: '#e94560' },
];

interface ProjectInfo {
  name: string;
  desc: string;
  goal: string;
  status: string;
  lead: string;
  teamMembers: string[];
  features: string[];
  techStack: string[];
  deliverables: string[];
  createdAt: string;
}

const PROJECTS_INFO: Record<string, ProjectInfo> = {
  KAN: {
    name: '칸반 보드 시스템',
    desc: '내부 프로젝트 관리 시스템. Phase × Domain × Gate 3축 프레임워크로 기획→배포까지 전체 프로젝트 라이프사이클 관리. 6열 칸반보드, AI 에이전트 네이티브, Stage-Gate 자동 검증 지원.',
    goal: '모든 에이전트의 Task를 시각화하고, Phase별 진행률 추적 및 Stage Gate 검증 자동화. 외부 SaaS 의존 없이 자체 시스템 구축.',
    status: '🟢 개발 중 (50%)',
    lead: 'cs',
    teamMembers: ['cs', 'dev', 'design'],
    features: [
      '6열 칸반보드 (Backlog→To Do→In Progress→Review→Done→Blocked)',
      'AI 에이전트가 직접 Task 생성/업데이트 (Telegram 연동)',
      'Stage-Gate 검증: AI 자동검증 → PO 승인',
      '8개 도메인: DOC, UI, FE, BE, DB, QA, OPS, MKT',
      'Task ID 체계: [프로젝트]-[Phase][Domain]-[번호]',
      '실시간 API/토큰 사용량 추적',
    ],
    techStack: ['React + TypeScript', 'Hono (REST API)', 'Drizzle ORM + PostgreSQL', 'Grammy (Telegram)', 'Vite', 'Vercel'],
    deliverables: [
      '✅ 요구사항 정의서 (CS)',
      '✅ 시스템 설계서 (CS)',
      '✅ 데이터 스키마 설계서 (CS)',
      '✅ DB 스키마 (Dev)',
      '✅ Task CRUD API (Dev)',
      '✅ 칸반 UI/UX 분석 (Design)',
      '✅ React 웹 대시보드 + 칸반보드',
      '✅ Vercel 배포 완료',
    ],
    createdAt: '2026-02-10',
  },
  FXT: {
    name: 'FX Trader',
    desc: '실시간 외환(FX) 트레이딩 시스템. 시장 데이터 수집, 분석, 전략 실행을 자동화하여 리스크 관리 기반의 외환 거래를 지원하는 플랫폼.',
    goal: '실시간 시세 수집 → 자동 분석 → 전략 기반 매매 실행. 리스크 관리와 보안을 갖춘 자동화 FX 트레이딩 시스템 구축.',
    status: '🔴 미착수 (아키텍처 설계 완료)',
    lead: 'dev',
    teamMembers: ['dev'],
    features: [
      '실시간 시장 데이터 수집 (외부 API 연동)',
      '뉴스 및 경제 이벤트 파서',
      '전략 실행 엔진 (사전 설정된 매매 전략)',
      '리스크 관리 모듈 (사전/사후 위험 평가)',
      '웹 대시보드 (실시간 데이터, 트레이딩 현황)',
      '모바일 앱 지원',
      'RESTful API (외부 시스템 연동)',
    ],
    techStack: ['PostgreSQL', 'RESTful API', 'WebSocket (실시간)', '웹/모바일 대시보드'],
    deliverables: [
      '✅ 아키텍처 다이어그램 문서 (Dev)',
      '✅ 기술 설계 문서 (Dev)',
      '✅ PO 감사 보고서',
      '⬜ 요구사항 정의 필요',
      '⬜ 보안/금융규제 요구사항 보강 필요',
    ],
    createdAt: '2026-02-10',
  },
  LIO: {
    name: 'LinkedIn 아웃리치 도구',
    desc: 'LinkedIn API 연계 B2B 마케팅 아웃리치 자동화 도구. 프리미엄 계정 기능을 활용한 네트워킹 확장, 맞춤형 메시지 캠페인, 헬스케어 특화 전략 포함.',
    goal: '자동화된 맞춤형 아웃리치로 6개월 내 활성 사용자 10,000명 달성. 팔로워/연결 30% 증가, 월간 문의 20% 증가, 네트워킹 이벤트 참여자 50% 증가.',
    status: '🔴 미착수 (마케팅 전략 완료, 개발 대기)',
    lead: 'marketing',
    teamMembers: ['marketing', 'dev'],
    features: [
      'LinkedIn API 연동 자동 아웃리치',
      '수신자 프로필 기반 맞춤형 메시지 생성',
      '웨비나/온라인 워크숍 기획',
      '전문 블로그/아티클 배포',
      'LinkedIn 광고 캠페인 관리',
      'LinkedIn 그룹 참여 및 인플루언서 협업',
      '헬스케어 특화 아웃리치 전략',
      '캠페인 성과 분석 대시보드',
    ],
    techStack: ['LinkedIn API', '사용자 인증 시스템', '메시지 템플릿 엔진', '캠페인 분석 도구'],
    deliverables: [
      '✅ LinkedIn 아웃리치 전략 문서 (Marketing)',
      '✅ 실행 계획서 + 타임라인 (Marketing)',
      '✅ 헬스케어 아웃리치 전략 (Marketing)',
      '✅ 맞춤형 콘텐츠 샘플 (Marketing)',
      '✅ 실행 계획 스프레드시트 (Marketing)',
      '⬜ LinkedIn API 연동 개발 (Dev 대기)',
    ],
    createdAt: '2026-02-10',
  },
  TRL: {
    name: 'Trylot 서비스 플랫폼',
    desc: '완전한 디자인 시스템과 와이어프레임이 설계된 웹 서비스 플랫폼. Purple(#6200EE) 테마, 12컬럼 그리드, Roboto 폰트 기반의 모던 UI/UX 설계 완료.',
    goal: '디자인 시스템 기반의 일관된 UI/UX를 갖춘 웹 서비스 플랫폼 구축. 접근성(4.5:1 명암비), 반응형 레이아웃 보장.',
    status: '🔴 미착수 (디자인 시스템 + 와이어프레임 완료)',
    lead: 'dev',
    teamMembers: ['dev', 'design'],
    features: [
      '홈페이지: 메인 배너, 서비스 섹션(3개 기능 카드), 리뷰 슬라이더',
      '로그인 페이지: 이메일/비밀번호, 비밀번호 찾기, 회원가입',
      '대시보드: 사이드바 내비게이션, 통계 그래프, 활동 로그',
      '서비스 페이지: 서비스 카드 목록, 필터/정렬',
      '문의 페이지: 연락 폼, FAQ 섹션',
    ],
    techStack: ['React 또는 Vue.js', '12컬럼 반응형 그리드', 'Roboto 폰트', 'SVG 아이콘 (24px)'],
    deliverables: [
      '✅ 디자인 시스템 문서 (Design) - 색상/타이포/버튼/인풋/레이아웃',
      '✅ 와이어프레임 스케치 - 5개 주요 페이지 (Design)',
      '✅ PO UI/UX 감사 보고서',
      '✅ PO 와이어프레임 감사 보고서',
      '⬜ 비즈니스 목표/범위 구체화 필요',
      '⬜ 기술 구현 착수 대기',
    ],
    createdAt: '2026-02-10',
  },
  CRM: {
    name: '고객 관계 관리 시스템',
    desc: '고객 상호작용, 영업 기회, 마케팅 캠페인, 지원 서비스를 통합 관리하는 CRM 시스템. 고객 생애주기 전체를 관리하여 영업 효율성과 고객 만족도 향상.',
    goal: '고객 정보 통합 관리, 영업 파이프라인 자동화, 마케팅 캠페인 최적화, 고객 서비스 추적으로 전체 고객 관계 관리 체계 구축.',
    status: '🔴 미착수 (요구사항 정의 완료)',
    lead: 'cs',
    teamMembers: ['cs', 'dev'],
    features: [
      '고객 정보 등록/수정/삭제 및 상호작용 이력 추적',
      '고객 세분화 및 그룹 관리',
      '잠재 고객 관리 및 영업 단계/일정 관리',
      '영업 성과 분석 도구',
      '마케팅 캠페인 기획/실행/성과 분석',
      '맞춤형 오퍼 및 보너스 제공',
      '고객 요청 접수/우선순위 설정/서비스 이력 추적',
      '고객 만족도 조사 및 피드백 수집',
      '외부 시스템 데이터 연동',
    ],
    techStack: ['PostgreSQL (예상)', 'REST API', '웹/모바일 지원', '외부 시스템 연동 레이어'],
    deliverables: [
      '✅ CRM 요구사항 정의서 (CS)',
      '✅ CRM 설계 제안서 (CS)',
      '⬜ 기술 아키텍처 설계 필요',
      '⬜ DB 스키마 설계 필요',
      '⬜ API 명세 작성 필요',
      '⬜ UI/UX 설계 필요',
    ],
    createdAt: '2026-02-10',
  },
};

interface Props {
  projectCode: string;
}

export function ProjectOverview({ projectCode }: Props) {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [progress, setProgress] = useState<PhaseProgress[]>([]);
  const [workload, setWorkload] = useState<Workload[]>([]);

  useEffect(() => {
    fetchDashboard().then(setDash).catch(() => {});
    fetchProgress(projectCode).then(setProgress).catch(() => {});
    fetchWorkload().then(setWorkload).catch(() => {});
  }, [projectCode]);

  const projInfo = PROJECTS_INFO[projectCode] || {
    name: projectCode, desc: '', goal: '', status: '미등록', lead: '',
    teamMembers: [], features: [], techStack: [], deliverables: [], createdAt: '',
  } as ProjectInfo;

  const leadMember = TEAM.find((t) => t.id === projInfo.lead);
  const teamDisplay = projInfo.teamMembers.map((id) => TEAM.find((t) => t.id === id)).filter(Boolean);

  // 현재 활성 Phase 판별
  const activePhase = progress.find((p) => p.percentage > 0 && p.percentage < 100)?.phase
    || progress.find((p) => p.total > 0)?.phase
    || 'P0';

  return (
    <div className="overview">
      {/* 프로젝트 정보 */}
      <div className="overview-project-card">
        <div className="overview-project-header">
          <h2>{projectCode}: {projInfo.name}</h2>
          <span className="overview-phase-badge">{activePhase} 진행 중</span>
        </div>
        <p className="overview-desc">{projInfo.desc}</p>
        <div className="overview-goal">
          <strong>목표:</strong> {projInfo.goal}
        </div>
        <div className="overview-meta-row">
          <span className="overview-status">{projInfo.status}</span>
          {leadMember && (
            <span className="overview-lead">{leadMember.emoji} 리드: {leadMember.name} ({leadMember.role})</span>
          )}
          {projInfo.createdAt && (
            <span className="overview-date">생성일: {projInfo.createdAt}</span>
          )}
        </div>
        {teamDisplay.length > 0 && (
          <div className="overview-team-chips">
            <strong>투입 팀원:</strong>
            {teamDisplay.map((m) => m && (
              <span key={m.id} className="team-chip">{m.emoji} {m.name}</span>
            ))}
          </div>
        )}
      </div>

      {/* 주요 기능 & 산출물 */}
      <div className="overview-section overview-details-grid">
        <div className="overview-detail-col">
          <h3>주요 기능</h3>
          <ul className="overview-feature-list">
            {projInfo.features.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          {projInfo.techStack.length > 0 && (
            <>
              <h4>기술 스택</h4>
              <div className="overview-tech-tags">
                {projInfo.techStack.map((t, i) => (
                  <span key={i} className="tech-tag">{t}</span>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="overview-detail-col">
          <h3>산출물 현황</h3>
          <ul className="overview-deliverable-list">
            {projInfo.deliverables.map((d, i) => (
              <li key={i} className={d.startsWith('✅') ? 'done' : 'pending'}>{d}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* 아키텍처: Hub & Spoke 구조 */}
      <div className="overview-section">
        <h3>팀 구조 (Hub & Spoke)</h3>
        <div className="team-architecture">
          {/* Hub - PO */}
          <div className="team-hub">
            <div className="hub-node">
              <span className="hub-emoji">🧠</span>
              <span className="hub-name">이레 (PO)</span>
              <span className="hub-type">HUB</span>
            </div>
            <div className="hub-desc">중앙 오케스트레이터 - 업무 분배 & 결과 조율</div>
          </div>

          {/* Spokes */}
          <div className="spoke-connections">
            <div className="spoke-line"></div>
          </div>

          <div className="team-spokes">
            {TEAM.filter((t) => t.type === 'SPOKE').map((member) => {
              const wl = workload.find((w) => w.assignee === member.id);
              return (
                <div key={member.id} className="spoke-card">
                  <div className="spoke-header">
                    <span className="spoke-emoji">{member.emoji}</span>
                    <div>
                      <div className="spoke-name">{member.name}</div>
                      <div className="spoke-role">{member.role}</div>
                    </div>
                  </div>
                  <div className="spoke-model">{member.model}</div>
                  <div className="spoke-desc">{member.desc}</div>
                  {wl && (
                    <div className="spoke-workload">
                      {wl.active}건 진행 / {wl.total}건 전체
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Phase 파이프라인 */}
      <div className="overview-section">
        <h3>Phase 파이프라인</h3>
        <div className="phase-pipeline">
          {PHASES.map((phase, idx) => {
            const prog = progress.find((p) => p.phase === phase.id);
            const isActive = phase.id === activePhase;
            return (
              <React.Fragment key={phase.id}>
                {idx > 0 && <div className="phase-arrow">→</div>}
                <div className={`phase-node ${isActive ? 'active' : ''}`} style={{ borderColor: phase.color }}>
                  <div className="phase-id" style={{ color: phase.color }}>{phase.id}</div>
                  <div className="phase-name">{phase.name}</div>
                  <div className="phase-desc">{phase.desc}</div>
                  {prog && (
                    <div className="phase-prog">
                      <div className="progress-bar-sm">
                        <div className="progress-fill-sm" style={{ width: `${prog.percentage}%`, background: phase.color }} />
                      </div>
                      <span>{prog.percentage}% ({prog.done}/{prog.total})</span>
                    </div>
                  )}
                  {isActive && <div className="phase-active-badge">현재</div>}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* 업무 배분 매트릭스 */}
      <div className="overview-section">
        <h3>업무 배분 현황</h3>
        {dash ? (
          <div className="overview-stats">
            <div className="stat-item">
              <span className="stat-value">{dash.totalTasks}</span>
              <span className="stat-label">전체 Task</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{dash.byStatus?.done || 0}</span>
              <span className="stat-label">완료</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{dash.byStatus?.in_progress || 0}</span>
              <span className="stat-label">진행 중</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{dash.byStatus?.blocked || 0}</span>
              <span className="stat-label">블로커</span>
            </div>
          </div>
        ) : (
          <p className="muted">데이터 로딩 중...</p>
        )}

        <div className="team-workload-table">
          <table>
            <thead>
              <tr>
                <th>팀원</th>
                <th>역할</th>
                <th>AI 모델</th>
                <th>진행</th>
                <th>전체</th>
              </tr>
            </thead>
            <tbody>
              {TEAM.map((member) => {
                const wl = workload.find((w) => w.assignee === member.id);
                return (
                  <tr key={member.id}>
                    <td>{member.emoji} {member.name}</td>
                    <td>{member.role}</td>
                    <td className="model-cell">{member.model}</td>
                    <td>{wl?.active || 0}건</td>
                    <td>{wl?.total || 0}건</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
