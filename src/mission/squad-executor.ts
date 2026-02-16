import { logger } from '../utils/logger.js';
import { callLLM } from '../providers/index.js';
import { BaseAgent } from '../agents/base-agent.js';
import { mercenary } from './mercenary.js';
import { SUBTASK_DECOMPOSITION_PROMPT } from './mission-prompts.js';
import type {
  Squad,
  SubTask,
  MissionBriefing,
  SquadReport,
  MercenaryType,
} from './types.js';

// ============================================================
// 분대 실행기 (Squad Executor) - 분대장 자율 실행 레이어
// ============================================================

// 에이전트 이름
const AGENT_NAMES: Record<string, string> = {
  dev: '다온(Dev)',
  design: '채아(Design)',
  cs: '나래(CS)',
  marketing: '알리(Marketing)',
};

class SquadExecutor {
  /**
   * 분대 미션 전체 실행
   * 1. 하위작업 분해
   * 2. 병렬 실행
   * 3. 결과 조립
   */
  async executeSquad(squad: Squad, briefing: MissionBriefing): Promise<SquadReport> {
    const agentName = AGENT_NAMES[squad.assignee] ?? squad.assignee;
    logger.info('SQUAD', `[${squad.callsign}] ${agentName} 분대 작전 개시: ${squad.objective}`);

    squad.status = 'in_progress';
    squad.startedAt = new Date();

    try {
      // Step 1: 하위작업 분해
      const subTasks = await this.decomposeIntoSubTasks(squad, briefing);
      squad.subTasks = subTasks;
      logger.info('SQUAD', `[${squad.callsign}] ${subTasks.length}개 하위작업 분해 완료`);

      // Step 2: 하위작업 병렬 실행
      const results = await this.executeSubTasksParallel(squad);
      logger.info('SQUAD', `[${squad.callsign}] 하위작업 실행 완료`);

      // Step 3: 결과 조립
      const result = await this.assembleSquadResult(squad, results);

      squad.status = 'completed';
      squad.result = result;
      squad.completedAt = new Date();

      const elapsed = squad.completedAt.getTime() - squad.startedAt.getTime();
      logger.info('SQUAD', `[${squad.callsign}] ${agentName} 분대 작전 완료 (${(elapsed / 1000).toFixed(1)}s)`);

      return {
        missionId: briefing.missionId,
        squadId: squad.id,
        callsign: squad.callsign,
        assignee: squad.assignee,
        status: 'completed',
        result,
        files: this.extractFilePaths(result),
        subTaskSummary: squad.subTasks.map(st => ({
          id: st.id,
          description: st.description,
          status: st.status,
          executor: st.executor,
        })),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('SQUAD', `[${squad.callsign}] 분대 작전 실패: ${errorMsg}`);

      squad.status = 'failed';
      squad.result = `Error: ${errorMsg}`;
      squad.completedAt = new Date();

      return {
        missionId: briefing.missionId,
        squadId: squad.id,
        callsign: squad.callsign,
        assignee: squad.assignee,
        status: 'failed',
        result: `분대 작전 실패: ${errorMsg}`,
        files: [],
        subTaskSummary: squad.subTasks.map(st => ({
          id: st.id,
          description: st.description,
          status: st.status,
          executor: st.executor,
        })),
      };
    }
  }

  /**
   * 분대장 LLM으로 목표를 하위작업으로 분해
   */
  private async decomposeIntoSubTasks(squad: Squad, briefing: MissionBriefing): Promise<SubTask[]> {
    const prompt = `${SUBTASK_DECOMPOSITION_PROMPT}

목표: ${squad.objective}
맥락: ${squad.context}
산출물: ${squad.deliverables.join(', ')}
${briefing.relatedSquads.length > 0
  ? `관련 분대: ${briefing.relatedSquads.map(s => `${s.callsign}(${s.assignee}): ${s.objective}`).join(', ')}`
  : ''}
사용 가능한 용병: ${mercenary.getAvailableMercenaries().join(', ') || '없음'}`;

    try {
      const response = await callLLM(
        squad.assignee,
        prompt,
        [{ role: 'user', content: squad.objective }]
      );

      const parsed = this.parseSubTasksJson(response);

      return parsed.map((st, idx) => ({
        id: `SUB-${String(idx + 1).padStart(3, '0')}`,
        squadId: squad.id,
        description: st.description,
        executor: this.validateExecutor(st.executor),
        status: 'pending' as const,
      }));
    } catch (err) {
      logger.warn('SQUAD', `[${squad.callsign}] 하위작업 분해 실패, 단일 작업으로 진행: ${err}`);
      // 분해 실패 시 전체 목표를 하나의 하위작업으로
      return [{
        id: 'SUB-001',
        squadId: squad.id,
        description: squad.objective,
        executor: 'self',
        status: 'pending',
      }];
    }
  }

  /**
   * 하위작업 병렬 실행 (Promise.allSettled)
   */
  private async executeSubTasksParallel(squad: Squad): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    const promises = squad.subTasks.map(async (st) => {
      st.status = 'in_progress';
      st.startedAt = new Date();

      try {
        let result: string;

        if (st.executor === 'self') {
          // 임시 BaseAgent 인스턴스 (정규병) - 독립 컨텍스트
          const tempAgent = new BaseAgent(squad.assignee);
          const taskPrompt = `[SQUAD ${squad.callsign} / ${st.id}]\n` +
            `분대 목표: ${squad.objective}\n` +
            `하위작업: ${st.description}\n` +
            `산출물 저장 경로: workspace/${squad.assignee}/\n` +
            `⚠️ 반드시 write_file로 결과를 저장하세요.`;

          result = await tempAgent.handleMessage(taskPrompt, 'SquadLeader');
        } else {
          // 용병 호출
          result = await mercenary.execute(st.executor, st.description);

          // 용병 미설치 시 agent LLM으로 fallback
          if (result.startsWith('[MERCENARY-UNAVAILABLE]') || result.startsWith('[MERCENARY-ERROR]')) {
            logger.warn('SQUAD', `[${squad.callsign}/${st.id}] 용병 실패, agent LLM fallback`);
            const tempAgent = new BaseAgent(squad.assignee);
            result = await tempAgent.handleMessage(
              `[MERCENARY-FALLBACK] ${st.description}\n⚠️ 반드시 write_file로 결과를 저장하세요.`,
              'SquadLeader'
            );
          }
        }

        st.result = result;
        st.status = 'completed';
        st.completedAt = new Date();
        results.set(st.id, result);

        logger.info('SQUAD', `[${squad.callsign}/${st.id}] 완료 (${st.executor})`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        st.status = 'failed';
        st.result = `Error: ${errorMsg}`;
        st.completedAt = new Date();
        results.set(st.id, `Error: ${errorMsg}`);

        logger.error('SQUAD', `[${squad.callsign}/${st.id}] 실패: ${errorMsg}`);
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * 모든 하위작업 결과를 종합하여 분대 보고서 작성
   */
  private async assembleSquadResult(squad: Squad, results: Map<string, string>): Promise<string> {
    const summaryParts: string[] = [];

    for (const st of squad.subTasks) {
      const statusEmoji = st.status === 'completed' ? '✅' : '❌';
      const result = results.get(st.id) ?? '(no result)';
      // 결과가 너무 길면 잘라내기
      const truncated = result.length > 2000
        ? result.slice(0, 2000) + '...(truncated)'
        : result;
      summaryParts.push(`${statusEmoji} ${st.id} [${st.executor}]: ${st.description}\n${truncated}`);
    }

    const completedCount = squad.subTasks.filter(st => st.status === 'completed').length;
    const totalCount = squad.subTasks.length;

    return `[분대 ${squad.callsign} 결과]\n` +
      `목표: ${squad.objective}\n` +
      `하위작업: ${completedCount}/${totalCount} 완료\n\n` +
      summaryParts.join('\n\n');
  }

  /**
   * JSON에서 subTasks 파싱
   */
  private parseSubTasksJson(response: string): Array<{ description: string; executor: string }> {
    // JSON 블록 추출
    const jsonMatch = response.match(/\{[\s\S]*"subTasks"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('subTasks JSON not found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subTasks || !Array.isArray(parsed.subTasks)) {
      throw new Error('Invalid subTasks format');
    }

    return parsed.subTasks;
  }

  /**
   * executor 유효성 검증
   */
  private validateExecutor(executor: string): 'self' | MercenaryType {
    if (executor === 'self' || executor === 'chatgpt' || executor === 'gemini-cli') {
      return executor;
    }
    return 'self'; // 알 수 없는 값은 self로
  }

  /**
   * 결과 텍스트에서 파일 경로 추출
   */
  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    // "File written: path" 패턴
    const writeFileMatches = text.matchAll(/File written:\s*(.+?)(?:\s*\(|$)/gm);
    for (const match of writeFileMatches) {
      paths.push(match[1].trim());
    }
    // workspace 경로 패턴
    const workspaceMatches = text.matchAll(/workspace[\\/][^\s)]+/g);
    for (const match of workspaceMatches) {
      if (!paths.includes(match[0])) {
        paths.push(match[0]);
      }
    }
    return paths;
  }
}

export const squadExecutor = new SquadExecutor();
