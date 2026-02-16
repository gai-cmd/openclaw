import { Bot } from 'grammy';
import { type AgentType } from '../config.js';

// ============================================================
// Bot Registry: gateway.ts와 router.ts 간 순환 의존성 해결
// ============================================================

export interface BotInfo {
  bot: Bot;
  agentType: AgentType;
  username: string;
  botId: number;
}

const bots = new Map<AgentType, BotInfo>();
const allBotIds = new Set<number>();

export function registerBot(info: BotInfo) {
  bots.set(info.agentType, info);
  allBotIds.add(info.botId);
}

export function getBot(agentType: AgentType): Bot {
  const info = bots.get(agentType);
  if (!info) throw new Error(`Bot not found for agent: ${agentType}`);
  return info.bot;
}

export function getBotInfo(agentType: AgentType): BotInfo | undefined {
  return bots.get(agentType);
}

export function getAllBotIds(): Set<number> {
  return allBotIds;
}

export function getAllBots(): Map<AgentType, BotInfo> {
  return bots;
}

export function getAgentByBotId(botId: number): AgentType | null {
  for (const [agentType, info] of bots) {
    if (info.botId === botId) return agentType;
  }
  return null;
}
