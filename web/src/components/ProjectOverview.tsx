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

const PROJECTS_INFO: Record<string, { name: string; desc: string; goal: string }> = {
  KAN: {
    name: '칸반 보드 시스템',
    desc: '팀 업무 관리를 위한 칸반 보드 + 대시보드 웹 시스템',
    goal: '모든 에이전트의 Task를 시각화하고, Phase별 진행률 추적 및 Stage Gate 검증 자동화',
  },
  FXT: {
    name: 'FXT 프로젝트',
    desc: '프로젝트 상세 정보 미등록',
    goal: '-',
  },
  LIO: {
    name: 'LIO 프로젝트',
    desc: '프로젝트 상세 정보 미등록',
    goal: '-',
  },
  TRL: {
    name: 'TRL 프로젝트',
    desc: '프로젝트 상세 정보 미등록',
    goal: '-',
  },
  CRM: {
    name: 'CRM 프로젝트',
    desc: '프로젝트 상세 정보 미등록',
    goal: '-',
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

  const projInfo = PROJECTS_INFO[projectCode] || { name: projectCode, desc: '', goal: '' };

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
