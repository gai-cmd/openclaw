import { Worker, Job } from 'bullmq';
import { getRedisConnection, isRedisAvailable, type TaskJobData, type TaskJobResult } from './queues.js';
import { getAgent } from '../agents/base-agent.js';
import { logger } from '../utils/logger.js';
import { taskManager } from '../orchestrator/task-manager.js';

let worker: Worker<TaskJobData, TaskJobResult>;

export function startWorker() {
  if (!isRedisAvailable()) {
    logger.warn('WORKER', 'Redis not available - worker not started. /task commands will run inline.');
    return;
  }

  worker = new Worker<TaskJobData, TaskJobResult>(
    'agent-tasks',
    async (job: Job<TaskJobData, TaskJobResult>) => {
      const { taskId, title, description, assignee, graphId } = job.data;
      logger.info('WORKER', `Processing: "${title}" by ${assignee}`);

      const agent = getAgent(assignee);
      const result = await agent.handleTask(description);

      logger.success('WORKER', `Completed: "${title}" by ${assignee}`);

      await taskManager.onTaskCompleted(graphId, taskId, result);

      return { taskId, result, success: true };
    },
    {
      connection: getRedisConnection(),
      concurrency: 4,
    }
  );

  worker.on('failed', (job, err) => {
    if (job) {
      logger.error('WORKER', `Failed: "${job.data.title}" by ${job.data.assignee}`, err);
      taskManager.onTaskFailed(job.data.graphId, job.data.taskId, err.message).catch(() => {});
    }
  });

  logger.success('WORKER', 'Task worker started (concurrency: 4)');
}

export async function stopWorker() {
  if (worker) await worker.close();
}
