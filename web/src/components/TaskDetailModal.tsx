import React, { useState } from 'react';
import { updateTask, type Task } from '../api';

const AGENT: Record<string, { name: string; role: string; emoji: string }> = {
  po: { name: '이레', role: 'PO (총괄)', emoji: '🧠' },
  dev: { name: '다온', role: 'Developer', emoji: '🔧' },
  design: { name: '채아', role: 'Designer', emoji: '🎨' },
  cs: { name: '나래', role: 'CS', emoji: '💬' },
  marketing: { name: '알리', role: 'Marketing', emoji: '📣' },
};

const STATUS_LABEL: Record<string, { label: string; emoji: string }> = {
  backlog: { label: 'Backlog', emoji: '⬜' },
  todo: { label: 'To Do', emoji: '🟦' },
  in_progress: { label: 'In Progress', emoji: '🟨' },
  review: { label: 'Review', emoji: '🟪' },
  done: { label: 'Done', emoji: '🟩' },
  blocked: { label: 'Blocked', emoji: '🟥' },
};

const PRIO_LABEL: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#e94560' },
  high: { label: 'High', color: '#f5a623' },
  medium: { label: 'Medium', color: '#f7dc6f' },
  low: { label: 'Low', color: '#6c757d' },
};

const PHASE_NAME: Record<string, string> = {
  P0: '기획', P1: '설계', P2: '개발', P3: '검증', P4: '운영',
};

interface Props {
  task: Task;
  onClose: () => void;
  onUpdated: () => void;
}

export function TaskDetailModal({ task, onClose, onUpdated }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [description, setDescription] = useState(task.description || '');
  const [result, setResult] = useState(task.result || '');
  const [progress, setProgress] = useState(task.progress);
  const [saving, setSaving] = useState(false);

  const agent = AGENT[task.assignee] || { name: task.assignee, role: 'Agent', emoji: '👤' };
  const status = STATUS_LABEL[task.taskStatus] || { label: task.taskStatus, emoji: '⬜' };
  const prio = PRIO_LABEL[task.priority] || { label: task.priority, color: '#6c757d' };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateTask(task.taskId, { description, result, progress });
      onUpdated();
      setEditMode(false);
    } catch (err) {
      alert('저장 실패: ' + err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="detail-title-row">
            <code className="task-id-lg">{task.taskId}</code>
            <h3>{task.title}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="detail-body">
          {/* 메타 정보 */}
          <div className="detail-meta-grid">
            <div className="detail-meta-item">
              <span className="detail-meta-label">상태</span>
              <span className="detail-meta-value">{status.emoji} {status.label}</span>
            </div>
            <div className="detail-meta-item">
              <span className="detail-meta-label">우선순위</span>
              <span className="detail-meta-value" style={{ color: prio.color }}>{prio.label}</span>
            </div>
            <div className="detail-meta-item">
              <span className="detail-meta-label">Phase</span>
              <span className="detail-meta-value">{task.phase} ({PHASE_NAME[task.phase] || ''})</span>
            </div>
            <div className="detail-meta-item">
              <span className="detail-meta-label">Domain</span>
              <span className="detail-meta-value">{task.domain}</span>
            </div>
            <div className="detail-meta-item">
              <span className="detail-meta-label">담당</span>
              <span className="detail-meta-value">{agent.emoji} {agent.name} ({agent.role})</span>
            </div>
            <div className="detail-meta-item">
              <span className="detail-meta-label">진행률</span>
              {editMode ? (
                <div className="progress-edit">
                  <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} />
                  <span>{progress}%</span>
                </div>
              ) : (
                <div className="detail-progress">
                  <div className="progress-bar-lg">
                    <div className="progress-fill-lg" style={{ width: `${task.progress}%` }} />
                  </div>
                  <span>{task.progress}%</span>
                </div>
              )}
            </div>
          </div>

          {/* 날짜 정보 */}
          <div className="detail-dates">
            <span>생성: {new Date(task.createdAt).toLocaleString('ko')}</span>
            <span>수정: {new Date(task.updatedAt).toLocaleString('ko')}</span>
            {task.dueDate && <span>마감: {new Date(task.dueDate).toLocaleDateString('ko')}</span>}
          </div>

          {/* Blocker */}
          {task.blockers && (
            <div className="detail-section blocker-section">
              <h4>Blockers</h4>
              <div className="blocker-content">{task.blockers}</div>
            </div>
          )}

          {/* 설명 */}
          <div className="detail-section">
            <h4>설명</h4>
            {editMode ? (
              <textarea
                className="detail-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Task 상세 설명..."
              />
            ) : (
              <div className="detail-content">
                {task.description || <span className="muted">설명 없음</span>}
              </div>
            )}
          </div>

          {/* 결과물 / 산출물 */}
          <div className="detail-section">
            <h4>결과물 / 산출물</h4>
            {editMode ? (
              <textarea
                className="detail-textarea"
                value={result}
                onChange={(e) => setResult(e.target.value)}
                rows={8}
                placeholder="작업 결과, 산출물, 코드 스니펫, 링크 등..."
              />
            ) : (
              <div className="detail-content result-content">
                {task.result ? (
                  <pre>{task.result}</pre>
                ) : (
                  <span className="muted">결과물 없음 - 편집 모드에서 추가하세요</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="detail-footer">
          {editMode ? (
            <>
              <button className="btn-cancel" onClick={() => { setEditMode(false); setDescription(task.description || ''); setResult(task.result || ''); setProgress(task.progress); }}>
                취소
              </button>
              <button className="btn-submit" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </>
          ) : (
            <button className="btn-edit" onClick={() => setEditMode(true)}>편집</button>
          )}
        </div>
      </div>
    </div>
  );
}
