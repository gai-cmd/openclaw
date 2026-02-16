import { getAgent } from './base-agent.js';

export async function handleCsTask(description: string): Promise<string> {
  const agent = getAgent('cs');
  return agent.handleTask(description);
}
