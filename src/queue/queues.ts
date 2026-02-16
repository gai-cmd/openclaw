import { Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { AgentType } from '../config.js';

export interface TaskJobData {
  graphId: string;
  taskId: string;
  title: string;
  description: string;
  assignee: AgentType;
}

export interface TaskJobResult {
  taskId: string;
  result: string;
  success: boolean;
}

let connection: IORedis | null = null;
let redisAvailable = false;

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export async function initRedis(): Promise<boolean> {
  try {
    connection = new IORedis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      maxRetriesPerRequest: null,
      retryStrategy: () => null, // 재연결 시도 안 함
      connectTimeout: 3000,
      lazyConnect: true,
    });
    connection.on('error', () => {}); // ioredis 에러 로그 억제
    await connection.connect();
    redisAvailable = true;
    logger.success('REDIS', 'Redis connected');
    return true;
  } catch {
    logger.warn('REDIS', 'Redis not available - task queue disabled, basic chat still works');
    if (connection) {
      connection.disconnect();
    }
    connection = null;
    redisAvailable = false;
    return false;
  }
}

export function getRedisConnection(): IORedis {
  if (!connection) {
    throw new Error('Redis not connected');
  }
  return connection;
}

let taskQueue: Queue<TaskJobData, TaskJobResult>;

export function getTaskQueue(): Queue<TaskJobData, TaskJobResult> {
  if (!taskQueue) {
    taskQueue = new Queue<TaskJobData, TaskJobResult>('agent-tasks', {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return taskQueue;
}

export async function addTaskToQueue(data: TaskJobData): Promise<Job<TaskJobData, TaskJobResult>> {
  const queue = getTaskQueue();
  const job = await queue.add(`task-${data.assignee}`, data);
  logger.info('QUEUE', `Added task "${data.title}" for ${data.assignee} (job ${job.id})`);
  return job;
}

export async function closeQueue() {
  if (taskQueue) await taskQueue.close();
  if (connection) await connection.quit();
}
