import React, { useState } from 'react';
import { createTask } from '../api';

const PHASES = ['P0', 'P1', 'P2', 'P3', 'P4'];
const DOMAINS = ['DOC', 'UI', 'FE', 'BE', 'DB', 'QA', 'OPS', 'MKT'];
const AGENTS = [
  { value: 'po', label: '이레 (PO)' },
  { value: 'dev', label: '다온 (Dev)' },
  { value: 'design', label: '채아 (Design)' },
  { value: 'cs', label: '나래 (CS)' },
  { value: 'marketing', label: '알리 (Marketing)' },
];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

interface Props {
  projectCode: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTaskModal({ projectCode, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState('P2');
  const [domain, setDomain] = useState('BE');
  const [assignee, setAssignee] = useState('dev');
  const [priority, setPriority] = useState('medium');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      await createTask({ title, description, projectCode, phase, domain, assignee, priority });
      onCreated();
      onClose();
    } catch (err) {
      alert('Task 생성 실패: ' + err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>새 Task 생성</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>제목 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task 제목" autoFocus />
          </div>
          <div className="form-group">
            <label>설명</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="상세 설명" rows={3} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Phase</label>
              <select value={phase} onChange={(e) => setPhase(e.target.value)}>
                {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Domain</label>
              <select value={domain} onChange={(e) => setDomain(e.target.value)}>
                {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>담당</label>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {AGENTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>우선순위</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>취소</button>
            <button type="submit" className="btn-submit" disabled={loading || !title.trim()}>
              {loading ? '생성 중...' : 'Task 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
