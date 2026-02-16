import { getAgent } from './base-agent.js';

export async function handleDevTask(description: string): Promise<string> {
  const agent = getAgent('dev');
  return agent.handleTask(description);
}
