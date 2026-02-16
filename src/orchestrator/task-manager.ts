import { decomposeTask } from '../agents/po-agent.js';
import { createTaskGraph, getReadyTasks, isGraphComplete, getProgress, type TaskGraph } from './task-graph.js';
import { addTaskToQueue, isRedisAvailable } from '../queue/queues.js';
import { getAgent } from '../agents/base-agent.js';
import { sendToChannel, postToStatusBoard } from '../bot/router.js';
import { formatTaskDecomposition, formatTaskStatus, formatAgentMessage } from '../utils/message-formatter.js';
import { config, type AgentType } from '../config.js';
import { logger } from '../utils/logger.js';

class TaskManager {
  private activeGraphs = new Map<string, TaskGraph>();

  async createTaskFromCommand(command: string, requester: string): Promise<string> {
    // 1. PO봇이 작업 분해
    const decomposed = await decomposeTask(command);

    // 2. 작업 그래프 생성
    const graph = createTaskGraph(command, requester, decomposed);
    this.activeGraphs.set(graph.id, graph);

    logger.info('TASK-MGR', `Created graph ${graph.id} with ${graph.tasks.length} tasks`);

    // 3. 실행 가능한 작업들을 큐에 등록
    await this.dispatchReadyTasks(graph);

    // 4. 작업 분해 결과를 텔레그램 형식으로 반환
    const taskSummary = decomposed.map((t) => ({
      title: t.title,
      assignee: t.assignee,
      phase: t.phase,
    }));

    return formatTaskDecomposition(command, taskSummary);
  }

  private async dispatchReadyTasks(graph: TaskGraph) {
    const readyTasks = getReadyTasks(graph);

    for (const task of readyTasks) {
      task.status = 'in_progress';

      if (isRedisAvailable()) {
        // Redis가 있으면 큐에 등록 (워커가 처리)
        await addTaskToQueue({
          graphId: graph.id,
          taskId: task.id,
          title: task.title,
          description: task.description,
          assignee: task.assignee,
        });
      } else {
        // Redis 없으면 인라인으로 직접 실행
        this.executeTaskInline(graph.id, task.id, task.title, task.description, task.assignee);
      }

      // 해당 팀 채널에 작업 시작 알림
      const channelId = this.getChannelForAgent(task.assignee);
      if (channelId) {
        await sendToChannel(channelId, task.assignee, `📌 <b>새 작업 배정</b>\n\n<b>${task.title}</b>\n${task.description}`);
      }
    }

    logger.info('TASK-MGR', `Dispatched ${readyTasks.length} ready tasks for graph ${graph.id}`);
  }

  private async executeTaskInline(graphId: string, taskId: string, title: string, description: string, assignee: AgentType) {
    try {
      logger.info('TASK-MGR', `Inline executing: "${title}" by ${assignee}`);
      const agent = getAgent(assignee);
      const result = await agent.handleTask(description);
      await this.onTaskCompleted(graphId, taskId, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.onTaskFailed(graphId, taskId, msg);
    }
  }

  async onTaskCompleted(graphId: string, taskId: string, result: string) {
    const graph = this.activeGraphs.get(graphId);
    if (!graph) return;

    const task = graph.tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.status = 'completed';
    task.result = result;
    task.completedAt = new Date();

    logger.success('TASK-MGR', `Task completed: "${task.title}" in graph ${graphId}`);

    // 해당 팀 채널에 완료 결과 전송
    const channelId = this.getChannelForAgent(task.assignee);
    if (channelId) {
      await sendToChannel(channelId, task.assignee, `✅ <b>작업 완료: ${task.title}</b>\n\n${result}`);
    }

    // 상태 보드 업데이트
    const progress = getProgress(graph);
    await postToStatusBoard(
      `🔄 <b>진행률 ${progress.percent}%</b> (${progress.completed}/${progress.total})\n` +
        `작업: ${task.title} ✅`
    );

    // 모든 작업 완료 체크
    if (isGraphComplete(graph)) {
      await this.onGraphComplete(graph);
    } else {
      // 새로 실행 가능해진 작업 디스패치
      await this.dispatchReadyTasks(graph);
    }
  }

  async onTaskFailed(graphId: string, taskId: string, error: string) {
    const graph = this.activeGraphs.get(graphId);
    if (!graph) return;

    const task = graph.tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.status = 'failed';
    task.result = `ERROR: ${error}`;

    logger.error('TASK-MGR', `Task failed: "${task.title}" in graph ${graphId}`);

    await postToStatusBoard(`❌ <b>작업 실패: ${task.title}</b>\n원인: ${error}`);
  }

  private async onGraphComplete(graph: TaskGraph) {
    logger.success('TASK-MGR', `All tasks completed for graph ${graph.id}`);

    const results = graph.tasks
      .map((t) => {
        const statusIcon = t.status === 'completed' ? '✅' : '❌';
        return `${statusIcon} <b>${t.title}</b>\n${t.result ?? '결과 없음'}`;
      })
      .join('\n\n');

    const summary =
      `🎉 <b>모든 작업 완료!</b>\n\n` +
      `<i>원본 명령:</i> ${graph.command}\n` +
      `<i>요청자:</i> ${graph.requester}\n\n` +
      `<b>결과 요약:</b>\n\n${results}`;

    // command-center에 최종 보고
    if (config.CHANNEL_COMMAND_CENTER) {
      await sendToChannel(config.CHANNEL_COMMAND_CENTER, 'po', summary);
    }

    await postToStatusBoard(`🎉 <b>프로젝트 완료!</b>\n${graph.command}`);

    // 완료된 그래프 정리
    this.activeGraphs.delete(graph.id);
  }

  async getStatusReport(): Promise<string> {
    if (this.activeGraphs.size === 0) {
      return '📊 <b>현재 진행 중인 작업이 없습니다.</b>';
    }

    const reports: string[] = [];
    for (const graph of this.activeGraphs.values()) {
      const progress = getProgress(graph);
      const taskLines = graph.tasks.map((t) => ({
        title: t.title,
        assignee: t.assignee,
        status: t.status,
      }));

      reports.push(
        `📋 <b>${graph.command}</b> (${progress.percent}%)\n` +
          `요청자: ${graph.requester}\n\n` +
          formatTaskStatus(taskLines)
      );
    }

    return reports.join('\n\n---\n\n');
  }

  private getChannelForAgent(_agent: AgentType): string | undefined {
    // 5-Bot 아키텍처: 공유 그룹에 전송
    return config.SHARED_GROUP_ID || config.CHANNEL_COMMAND_CENTER || undefined;
  }
}

export const taskManager = new TaskManager();
