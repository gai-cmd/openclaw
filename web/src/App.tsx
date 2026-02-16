import React, { useState } from 'react';
import { KanbanBoard } from './components/KanbanBoard';
import { Dashboard } from './components/Dashboard';
import { ProjectOverview } from './components/ProjectOverview';

type Tab = 'overview' | 'board' | 'dashboard';

const PROJECTS = ['KAN', 'FXT', 'LIO', 'TRL', 'CRM'];

export function App() {
  const [tab, setTab] = useState<Tab>('board');
  const [project, setProject] = useState('KAN');

  return (
    <div className="app">
      <header className="header">
        <h1>AI Team 칸반 보드</h1>
        <nav className="nav">
          <button
            className={`nav-btn ${tab === 'overview' ? 'active' : ''}`}
            onClick={() => setTab('overview')}
          >
            개요
          </button>
          <button
            className={`nav-btn ${tab === 'board' ? 'active' : ''}`}
            onClick={() => setTab('board')}
          >
            보드
          </button>
          <button
            className={`nav-btn ${tab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setTab('dashboard')}
          >
            대시보드
          </button>
          <select
            className="project-select"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            {PROJECTS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </nav>
      </header>
      <main className="main">
        {tab === 'overview' && <ProjectOverview projectCode={project} />}
        {tab === 'board' && <KanbanBoard projectCode={project} />}
        {tab === 'dashboard' && <Dashboard projectCode={project} />}
      </main>
    </div>
  );
}
