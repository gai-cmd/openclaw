import React, { useState } from 'react';
import type { Task } from '../api';
import { TaskDetailModal } from './TaskDetailModal';

const AGENT: Record<string, { name: string; emoji: string }> = {
  po: { name: '이레', emoji: '🧠' },
  dev: { name: '다온', emoji: '🔧' },
  design: { name: '채아', emoji: '🎨' },
  cs: { name: '나래', emoji: '💬' },
  marketing: { name: '알리', emoji: '📣' },
};

const PRIO_COLOR: Record<string, string> = {
  critical: '#e94560',
  high: '#f5a623',
  medium: '#f7dc6f',
  low: '#6c757d',
};

const PRIO_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
};

interface Props {
  task: Task;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onDelete?: (taskId: string) => void;
}

export function TaskCard({ task, onDragStart, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const agent = AGENT[task.assignee] || { name: task.assignee, emoji: '👤' };
  const borderColor = PRIO_COLOR[task.priority] || '#6c757d';

  return (
    <>
      <div
        className="task-card"
        style={{ borderLeftColor: borderColor }}
        draggable
        onDragStart={(e) => onDragStart(e, task)}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="task-header">
          <span className="task-prio">{PRIO_EMOJI[task.priority]}</span>
          <code className="task-id">{task.taskId}</code>
        </div>
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span>{agent.emoji} {agent.name}</span>
          <span className="task-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${task.progress}%` }} />
            </div>
            <span className="progress-text">{task.progress}%</span>
          </span>
        </div>
        {expanded && (
          <div className="task-detail">
            {task.description && <p>{task.description}</p>}
            <div className="task-tags">
              <span className="tag">{task.phase}</span>
              <span className="tag">{task.domain}</span>
            </div>
            {task.blockers && <div className="task-blocker">🚫 {task.blockers}</div>}
            <div className="task-card-actions">
              <button
                className="btn-detail"
                onClick={(e) => { e.stopPropagation(); setShowDetail(true); }}
              >
                상세 보기
              </button>
              {onDelete && (
                <button
                  className="btn-delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(task.taskId); }}
                >
                  삭제
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {showDetail && (
        <TaskDetailModal
          task={task}
          onClose={() => setShowDetail(false)}
          onUpdated={() => setShowDetail(false)}
        />
      )}
    </>
  );
}
