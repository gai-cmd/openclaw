import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { fetchBoard, updateTask, deleteTask, type Task } from '../api';
import { TaskCard } from './TaskCard';
import { CreateTaskModal } from './CreateTaskModal';

const COLUMNS: { key: string; label: string; emoji: string }[] = [
  { key: 'backlog', label: 'Backlog', emoji: '⬜' },
  { key: 'todo', label: 'To Do', emoji: '🟦' },
  { key: 'in_progress', label: 'In Progress', emoji: '🟨' },
  { key: 'review', label: 'Review', emoji: '🟪' },
  { key: 'done', label: 'Done', emoji: '🟩' },
  { key: 'blocked', label: 'Blocked', emoji: '🟥' },
];

const PHASES = ['ALL', 'P0', 'P1', 'P2', 'P3', 'P4'];
const DOMAINS = ['ALL', 'DOC', 'UI', 'FE', 'BE', 'DB', 'QA', 'OPS', 'MKT'];
const ASSIGNEES = [
  { value: 'ALL', label: '전체' },
  { value: 'po', label: '이레' },
  { value: 'dev', label: '다온' },
  { value: 'design', label: '채아' },
  { value: 'cs', label: '나래' },
  { value: 'marketing', label: '알리' },
];

interface Props {
  projectCode: string;
}

export function KanbanBoard({ projectCode }: Props) {
  const [board, setBoard] = useState<Record<string, Task[]>>({});
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterPhase, setFilterPhase] = useState('ALL');
  const [filterDomain, setFilterDomain] = useState('ALL');
  const [filterAssignee, setFilterAssignee] = useState('ALL');

  const loadBoard = useCallback(async () => {
    try {
      const data = await fetchBoard(projectCode);
      setBoard(data);
    } catch {
      setBoard({});
    } finally {
      setLoading(false);
    }
  }, [projectCode]);

  useEffect(() => {
    loadBoard();
    const interval = setInterval(loadBoard, 10000);
    return () => clearInterval(interval);
  }, [loadBoard]);

  const filteredBoard = useMemo(() => {
    const result: Record<string, Task[]> = {};
    for (const [status, tasks] of Object.entries(board)) {
      result[status] = tasks.filter((t) => {
        if (filterPhase !== 'ALL' && t.phase !== filterPhase) return false;
        if (filterDomain !== 'ALL' && t.domain !== filterDomain) return false;
        if (filterAssignee !== 'ALL' && t.assignee !== filterAssignee) return false;
        return true;
      });
    }
    return result;
  }, [board, filterPhase, filterDomain, filterAssignee]);

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    e.dataTransfer.setData('taskId', task.taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(status);
  };

  const handleDragLeave = () => setDragOver(null);

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData('taskId');
    if (!taskId) return;

    try {
      await updateTask(taskId, { taskStatus: newStatus });
      await loadBoard();
    } catch (err) {
      console.error('Drop failed:', err);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm(`${taskId} 삭제하시겠습니까?`)) return;
    try {
      await deleteTask(taskId);
      await loadBoard();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  if (loading) {
    return <div className="loading">로딩 중...</div>;
  }

  const totalTasks = Object.values(board).reduce((s, t) => s + t.length, 0);
  const filteredTotal = Object.values(filteredBoard).reduce((s, t) => s + t.length, 0);
  const hasFilter = filterPhase !== 'ALL' || filterDomain !== 'ALL' || filterAssignee !== 'ALL';

  return (
    <div className="kanban">
      <div className="kanban-header">
        <h2>{projectCode} 프로젝트</h2>
        <div className="kanban-actions">
          <span className="task-count">
            {hasFilter ? `${filteredTotal} / ${totalTasks}건` : `전체 ${totalTasks}건`}
          </span>
          <button className="btn-new-task" onClick={() => setShowCreateModal(true)}>+ New Task</button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <select value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)}>
          {PHASES.map((p) => <option key={p} value={p}>{p === 'ALL' ? 'Phase 전체' : p}</option>)}
        </select>
        <select value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)}>
          {DOMAINS.map((d) => <option key={d} value={d}>{d === 'ALL' ? 'Domain 전체' : d}</option>)}
        </select>
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
          {ASSIGNEES.map((a) => <option key={a.value} value={a.value}>{a.value === 'ALL' ? '담당 전체' : a.label}</option>)}
        </select>
        {hasFilter && (
          <button className="btn-clear-filter" onClick={() => { setFilterPhase('ALL'); setFilterDomain('ALL'); setFilterAssignee('ALL'); }}>
            필터 초기화
          </button>
        )}
      </div>

      <div className="kanban-columns">
        {COLUMNS.map((col) => {
          const tasks = filteredBoard[col.key] || [];
          return (
            <div
              key={col.key}
              className={`kanban-column ${dragOver === col.key ? 'drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, col.key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.key)}
            >
              <div className="column-header">
                <span>{col.emoji} {col.label}</span>
                <span className="column-count">{tasks.length}</span>
              </div>
              <div className="column-body">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.taskId}
                    task={task}
                    onDragStart={handleDragStart}
                    onDelete={handleDelete}
                  />
                ))}
                {tasks.length === 0 && (
                  <div className="empty-col">비어 있음</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showCreateModal && (
        <CreateTaskModal
          projectCode={projectCode}
          onClose={() => setShowCreateModal(false)}
          onCreated={loadBoard}
        />
      )}
    </div>
  );
}
