import type { TaskGraph, TaskNode } from './task-graph.js';
import { logger } from '../utils/logger.js';

// Phase 기반 스케줄링: 같은 phase의 작업은 병렬, 다른 phase는 순차
export function getExecutionPlan(graph: TaskGraph): Map<number, TaskNode[]> {
  const phases = new Map<number, TaskNode[]>();

  for (const task of graph.tasks) {
    const phase = task.phase;
    const list = phases.get(phase) ?? [];
    list.push(task);
    phases.set(phase, list);
  }

  logger.info('SCHEDULER', `Execution plan: ${phases.size} phases`);
  for (const [phase, tasks] of [...phases.entries()].sort((a, b) => a[0] - b[0])) {
    logger.info('SCHEDULER', `  Phase ${phase}: ${tasks.map((t) => `${t.title}(${t.assignee})`).join(', ')}`);
  }

  return phases;
}

// 토폴로지 정렬 (의존성 기반)
export function topologicalSort(graph: TaskGraph): TaskNode[] {
  const sorted: TaskNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const taskMap = new Map(graph.tasks.map((t) => [t.id, t]));

  function visit(task: TaskNode) {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) {
      logger.warn('SCHEDULER', `Circular dependency detected at "${task.title}"`);
      return;
    }

    visiting.add(task.id);
    for (const depId of task.dependencies) {
      const dep = taskMap.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(task.id);
    visited.add(task.id);
    sorted.push(task);
  }

  for (const task of graph.tasks) {
    visit(task);
  }

  return sorted;
}
