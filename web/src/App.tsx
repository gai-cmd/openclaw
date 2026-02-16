import React, { useState } from 'react';
import { KanbanBoard } from './components/KanbanBoard';
import { Dashboard } from './components/Dashboard';
import { ProjectOverview } from './components/ProjectOverview';

type Tab = 'overview' | 'board' | 'dashboard';

const PROJECTS = ['KAN', 'FXT', 'LIO', 'TRL', 'CRM'];

function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

export function App() {
  const [tab, setTab] = useState<Tab>('board');
  const [project, setProject] = useState('KAN');
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  // 초기 렌더 시 테마 적용
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

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
          <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? '라이트 모드' : '다크 모드'}>
            {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
          </button>
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
