import { getAgent } from './base-agent.js';

export async function handleDesignTask(description: string): Promise<string> {
  const agent = getAgent('design');
  return agent.handleTask(description);
}
