import { getAgent } from './base-agent.js';

export async function handleMarketingTask(description: string): Promise<string> {
  const agent = getAgent('marketing');
  return agent.handleTask(description);
}
