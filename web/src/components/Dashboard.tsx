import React, { useEffect, useState } from 'react';
import {
  fetchDashboard, fetchWorkload, fetchActivity, fetchProgress,
  type DashboardData, type Workload, type PhaseProgress,
} from '../api';

const AGENT: Record<string, { name: string; emoji: string }> = {
  po: { name: '이레', emoji: '🧠' },
  dev: { name: '다온', emoji: '🔧' },
  design: { name: '채아', emoji: '🎨' },
  cs: { name: '나래', emoji: '💬' },
  marketing: { name: '알리', emoji: '📣' },
};

const STATUS_EMOJI: Record<string, string> = {
  backlog: '⬜', todo: '🟦', in_progress: '🟨',
  review: '🟪', done: '🟩', blocked: '🟥',
};

const PHASE_NAME: Record<string, string> = {
  P0: '기획', P1: '설계', P2: '개발', P3: '검증', P4: '운영',
};

interface Props {
  projectCode: string;
}

export function Dashboard({ projectCode }: Props) {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [workload, setWorkload] = useState<Workload[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [progress, setProgress] = useState<PhaseProgress[]>([]);

  useEffect(() => {
    fetchDashboard().then(setDash).catch(() => {});
    fetchWorkload().then(setWorkload).catch(() => {});
    fetchActivity(15).then(setActivity).catch(() => {});
    fetchProgress(projectCode).then(setProgress).catch(() => {});
  }, [projectCode]);

  return (
    <div className="dashboard">
      {/* 요약 카드 */}
      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-card-value">{dash?.totalTasks ?? 0}</div>
          <div className="dash-card-label">전체 Task</div>
        </div>
        {dash && Object.entries(dash.byStatus).map(([status, cnt]) => (
          <div className="dash-card" key={status}>
            <div className="dash-card-value">{STATUS_EMOJI[status]} {cnt}</div>
            <div className="dash-card-label">{status.replace('_', ' ')}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        {/* Phase 진행률 */}
        <div className="dash-section">
          <h3>{projectCode} Phase 진행률</h3>
          {progress.length === 0 && <p className="muted">등록된 Task 없음</p>}
          {progress.map((p) => (
            <div key={p.phase} className="progress-row">
              <span className="progress-label">
                {p.phase} ({PHASE_NAME[p.phase]})
              </span>
              <div className="progress-bar-lg">
                <div
                  className="progress-fill-lg"
                  style={{ width: `${p.percentage}%` }}
                />
              </div>
              <span className="progress-pct">{p.percentage}% ({p.done}/{p.total})</span>
            </div>
          ))}
        </div>

        {/* 팀 워크로드 */}
        <div className="dash-section">
          <h3>팀 워크로드</h3>
          {workload.length === 0 && <p className="muted">데이터 없음</p>}
          {workload.map((w) => {
            const a = AGENT[w.assignee] || { name: w.assignee, emoji: '👤' };
            const pct = w.total > 0 ? Math.round((w.active / Math.max(w.total, 5)) * 100) : 0;
            return (
              <div key={w.assignee} className="workload-row">
                <span className="workload-agent">{a.emoji} {a.name}</span>
                <div className="progress-bar-lg">
                  <div className="progress-fill-lg accent" style={{ width: `${pct}%` }} />
                </div>
                <span className="workload-count">{w.active}건 진행</span>
              </div>
            );
          })}
        </div>

        {/* 프로젝트별 현황 */}
        <div className="dash-section">
          <h3>프로젝트 현황</h3>
          {dash?.byProject.map((p) => {
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            return (
              <div key={p.code} className="progress-row">
                <span className="progress-label">{p.code}</span>
                <div className="progress-bar-lg">
                  <div className="progress-fill-lg" style={{ width: `${pct}%` }} />
                </div>
                <span className="progress-pct">{pct}% ({p.done}/{p.total})</span>
              </div>
            );
          })}
        </div>

        {/* 최근 활동 */}
        <div className="dash-section">
          <h3>최근 활동</h3>
          {activity.length === 0 && <p className="muted">활동 기록 없음</p>}
          <div className="activity-list">
            {activity.map((a, i) => {
              const agent = AGENT[a.agent] || { emoji: '👤', name: a.agent };
              return (
                <div key={i} className="activity-item">
                  <span className="activity-agent">{agent.emoji}</span>
                  <span className="activity-action">{a.action}</span>
                  <span className="activity-time">
                    {new Date(a.createdAt).toLocaleString('ko')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
