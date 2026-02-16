import { logger } from '../utils/logger.js';
import { callLLM } from '../providers/index.js';
import { sendToGroup } from '../bot/router.js';
import { squadExecutor } from './squad-executor.js';
import {
  MISSION_DECOMPOSITION_PROMPT,
  MISSION_SYNTHESIS_PROMPT,
} from './mission-prompts.js';
import {
  SQUAD_CALLSIGNS,
  type Mission,
  type Squad,
  type MissionBriefing,
  type SquadReport,
  type MissionDecomposition,
  type SquadCallsign,
  type MissionStatus,
} from './types.js';
import type { AgentType } from '../config.js';

// ============================================================
// 미션 매니저 (소대장 오케스트레이션)
// ============================================================

// 에이전트 이름/이모지
const AGENT_DISPLAY: Record<string, { name: string; emoji: string }> = {
  dev: { name: '다온(Dev)', emoji: '🔧' },
  design: { name: '채아(Design)', emoji: '🎨' },
  cs: { name: '나래(CS)', emoji: '💬' },
  marketing: { name: '알리(Marketing)', emoji: '📣' },
};

let missionCounter = 0;

class MissionManager {
  private activeMissions = new Map<string, Mission>();

  // ============================================================
  // 미션 생성 (Phase 1: 분해)
  // ============================================================

  async createMission(description: string, requester: string, chatId: string): Promise<Mission> {
    missionCounter++;
    const id = `MSN-${String(missionCounter).padStart(4, '0')}`;

    const mission: Mission = {
      id,
      description,
      requester,
      status: 'planning',
      squads: [],
      chatId,
      createdAt: new Date(),
    };

    this.activeMissions.set(id, mission);
    logger.info('MISSION', `[${id}] 미션 생성: ${description}`);

    // PO LLM으로 미션 분해
    const squads = await this.decomposeMission(mission);
    mission.squads = squads;

    return mission;
  }

  // ============================================================
  // 미션 분해 (PO LLM으로 분대 편성)
  // ============================================================

  private async decomposeMission(mission: Mission): Promise<Squad[]> {
    logger.info('MISSION', `[${mission.id}] 미션 분해 시작...`);

    const response = await callLLM(
      'po',
      MISSION_DECOMPOSITION_PROMPT,
      [{ role: 'user', content: mission.description }]
    );

    const decomposition = this.parseDecomposition(response);
    const squads: Squad[] = [];

    for (let i = 0; i < decomposition.squads.length && i < SQUAD_CALLSIGNS.length; i++) {
      const ds = decomposition.squads[i];
      const callsign = SQUAD_CALLSIGNS[i];
      const assignee = this.validateAssignee(ds.assignee);

      squads.push({
        id: `SQD-${callsign}`,
        callsign,
        missionId: mission.id,
        assignee,
        objective: ds.objective,
        context: ds.context || '',
        deliverables: ds.deliverables || [],
        subTasks: [],
        status: 'pending',
        priority: ds.priority || (i + 1),
      });
    }

    logger.info('MISSION', `[${mission.id}] ${squads.length}개 분대 편성 완료`);
    return squads;
  }

  // ============================================================
  // 미션 실행 (Phase 2: 병렬 투입)
  // ============================================================

  async executeMission(missionId: string): Promise<void> {
    const mission = this.activeMissions.get(missionId);
    if (!mission) {
      throw new Error(`Mission ${missionId} not found`);
    }

    mission.status = 'dispatched';
    const startTime = Date.now();

    // 각 분대에 브리핑 작성
    const briefings = mission.squads.map(squad => this.createBriefing(mission, squad));

    // 작전 지시 메시지 전송 (각 분대별)
    for (let i = 0; i < mission.squads.length; i++) {
      const squad = mission.squads[i];
      const display = AGENT_DISPLAY[squad.assignee] ?? { name: squad.assignee, emoji: '🔧' };

      const briefingMsg =
        `🎖 [작전 지시] ${mission.id} / ${squad.id}\n\n` +
        `📋 분대장: ${display.name}\n` +
        `🎯 목표: ${squad.objective}\n` +
        `📦 산출물: ${squad.deliverables.join(', ') || '(미정)'}\n` +
        `⚡ 우선순위: ${squad.priority}`;

      await sendToGroup('po', briefingMsg);
    }

    // 🔑 핵심: 모든 분대 동시 투입 (Promise.allSettled)
    mission.status = 'in_progress';
    logger.info('MISSION', `[${missionId}] ${mission.squads.length}개 분대 동시 투입!`);

    const squadPromises = mission.squads.map((squad, idx) =>
      squadExecutor.executeSquad(squad, briefings[idx])
    );

    const results = await Promise.allSettled(squadPromises);

    // 분대 결과 수집 및 보고
    const reports: SquadReport[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const squad = mission.squads[i];
      const display = AGENT_DISPLAY[squad.assignee] ?? { name: squad.assignee, emoji: '🔧' };

      if (result.status === 'fulfilled') {
        reports.push(result.value);

        // 분대 완료 보고 메시지
        const subTaskSummary = result.value.subTaskSummary
          .map(st => {
            const emoji = st.status === 'completed' ? '✅' : '❌';
            return `${emoji} ${st.id}(${st.executor})`;
          })
          .join(' ');

        await sendToGroup(squad.assignee,
          `📊 [분대 보고] ${mission.id} / ${squad.id}\n` +
          `분대장: ${display.name} | 상태: ✅ 완료\n` +
          `하위작업: ${subTaskSummary}\n` +
          (result.value.files.length > 0
            ? `📁 파일: ${result.value.files.slice(0, 3).join(', ')}`
            : '')
        );
      } else {
        // 실패한 분대
        squad.status = 'failed';
        squad.result = result.reason?.message ?? 'Unknown error';

        await sendToGroup(squad.assignee,
          `📊 [분대 보고] ${mission.id} / ${squad.id}\n` +
          `분대장: ${display.name} | 상태: ❌ 실패\n` +
          `사유: ${squad.result}`
        );

        reports.push({
          missionId,
          squadId: squad.id,
          callsign: squad.callsign,
          assignee: squad.assignee,
          status: 'failed',
          result: squad.result ?? 'Unknown error',
          files: [],
          subTaskSummary: [],
        });
      }
    }

    // 결과 종합 (PO)
    mission.status = 'synthesizing';
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    try {
      const finalReport = await this.synthesizeResults(mission, reports, elapsed);
      mission.finalReport = finalReport;
      mission.status = 'completed';
      mission.completedAt = new Date();

      // 최종 보고서 전송
      await sendToGroup('po', finalReport);

      logger.info('MISSION', `[${missionId}] 미션 완료 (${elapsed}s)`);
    } catch (err) {
      logger.error('MISSION', `[${missionId}] 결과 종합 실패: ${err}`);
      mission.status = 'completed'; // 분대 작업은 완료됨
      mission.completedAt = new Date();

      // 수동 보고서
      const manualReport = this.buildManualReport(mission, reports, elapsed);
      await sendToGroup('po', manualReport);
    }
  }

  // ============================================================
  // 결과 종합 (PO LLM)
  // ============================================================

  private async synthesizeResults(
    mission: Mission,
    reports: SquadReport[],
    elapsed: string
  ): Promise<string> {
    const completedCount = reports.filter(r => r.status === 'completed').length;
    const totalCount = reports.length;

    // 간결한 보고서 직접 생성 (LLM 호출 비용 절감)
    if (totalCount <= 4) {
      return this.buildManualReport(mission, reports, elapsed);
    }

    // 대규모 미션의 경우 PO LLM으로 종합
    const reportSummaries = reports.map(r => {
      const display = AGENT_DISPLAY[r.assignee] ?? { name: r.assignee, emoji: '🔧' };
      return `분대 ${r.callsign} (${display.name}): ${r.status}\n결과: ${r.result.slice(0, 500)}`;
    }).join('\n\n');

    const synthesisPrompt = `${MISSION_SYNTHESIS_PROMPT}\n\n미션: ${mission.description}\n소요시간: ${elapsed}초\n분대 결과:\n${reportSummaries}`;

    return await callLLM(
      'po',
      synthesisPrompt,
      [{ role: 'user', content: '종합 보고서를 작성하세요.' }]
    );
  }

  /**
   * 수동 보고서 생성 (LLM 없이)
   */
  private buildManualReport(mission: Mission, reports: SquadReport[], elapsed: string): string {
    const completedCount = reports.filter(r => r.status === 'completed').length;
    const totalCount = reports.length;

    const squadLines = reports.map(r => {
      const display = AGENT_DISPLAY[r.assignee] ?? { name: r.assignee, emoji: '🔧' };
      const statusEmoji = r.status === 'completed' ? '✅' : '❌';
      const fileInfo = r.files.length > 0
        ? `\n  📁 ${r.files.slice(0, 3).join(', ')}`
        : '';
      return `${display.emoji} ${r.callsign} (${display.name}): ${statusEmoji}${fileInfo}`;
    }).join('\n');

    return `🎖 [작전 완료] ${mission.id}\n` +
      `⏱ 소요: ${elapsed}초 | 분대: ${completedCount}/${totalCount} 완료\n\n` +
      `${squadLines}\n\n` +
      `미션: ${mission.description}\n` +
      (completedCount === totalCount
        ? '종합: 모든 분대 작업 완료.'
        : `종합: ${totalCount - completedCount}개 분대 실패. 재시도가 필요할 수 있습니다.`);
  }

  // ============================================================
  // 브리핑 생성
  // ============================================================

  private createBriefing(mission: Mission, squad: Squad): MissionBriefing {
    return {
      missionId: mission.id,
      squadId: squad.id,
      callsign: squad.callsign,
      objective: squad.objective,
      context: squad.context,
      deliverables: squad.deliverables,
      relatedSquads: mission.squads
        .filter(s => s.id !== squad.id)
        .map(s => ({
          id: s.id,
          callsign: s.callsign,
          assignee: s.assignee,
          objective: s.objective,
        })),
    };
  }

  // ============================================================
  // 상태 조회
  // ============================================================

  getMission(id: string): Mission | undefined {
    return this.activeMissions.get(id);
  }

  getMissionStatus(missionId?: string): string {
    if (missionId) {
      const mission = this.activeMissions.get(missionId);
      if (!mission) return `❌ 미션 ${missionId}을 찾을 수 없습니다.`;
      return this.formatMissionStatus(mission);
    }

    // 전체 미션 현황
    if (this.activeMissions.size === 0) {
      return '📋 활성 미션 없음. <code>/mission [설명]</code>으로 시작하세요.';
    }

    const lines = ['🎖 <b>미션 현황</b>\n'];
    for (const mission of this.activeMissions.values()) {
      lines.push(this.formatMissionStatus(mission));
      lines.push('');
    }
    return lines.join('\n');
  }

  getSquadStatus(missionId: string): string {
    const mission = this.activeMissions.get(missionId);
    if (!mission) return `❌ 미션 ${missionId}을 찾을 수 없습니다.`;

    const lines = [`🎖 <b>분대 상세 현황</b> (${mission.id})\n`];
    lines.push(`미션: ${mission.description}\n`);

    for (const squad of mission.squads) {
      const display = AGENT_DISPLAY[squad.assignee] ?? { name: squad.assignee, emoji: '🔧' };
      const statusEmoji = this.statusEmoji(squad.status);

      lines.push(`${display.emoji} <b>${squad.id} (${display.name})</b> ${statusEmoji}`);
      lines.push(`  목표: ${squad.objective}`);

      if (squad.subTasks.length > 0) {
        for (const st of squad.subTasks) {
          const stEmoji = this.statusEmoji(st.status);
          lines.push(`  ${stEmoji} ${st.id} [${st.executor}]: ${st.description.slice(0, 60)}`);
        }
      }

      if (squad.startedAt && squad.completedAt) {
        const elapsed = ((squad.completedAt.getTime() - squad.startedAt.getTime()) / 1000).toFixed(1);
        lines.push(`  ⏱ ${elapsed}s`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  getAllActiveMissions(): Mission[] {
    return Array.from(this.activeMissions.values());
  }

  // ============================================================
  // 유틸
  // ============================================================

  private formatMissionStatus(mission: Mission): string {
    const statusEmoji = this.statusEmoji(mission.status);
    const completedSquads = mission.squads.filter(s => s.status === 'completed').length;
    const totalSquads = mission.squads.length;

    const squadList = mission.squads.map(s => {
      const display = AGENT_DISPLAY[s.assignee] ?? { name: s.assignee, emoji: '🔧' };
      return `  ${this.statusEmoji(s.status)} ${s.callsign}(${display.name}): ${s.objective.slice(0, 40)}`;
    }).join('\n');

    return `${statusEmoji} <b>${mission.id}</b>: ${mission.description.slice(0, 50)}\n` +
      `  상태: ${mission.status} | 분대: ${completedSquads}/${totalSquads}\n` +
      squadList;
  }

  private statusEmoji(status: string): string {
    switch (status) {
      case 'completed': return '✅';
      case 'in_progress': return '🔄';
      case 'pending': return '⏳';
      case 'planning': return '🧠';
      case 'dispatched': return '📤';
      case 'synthesizing': return '📊';
      case 'failed': return '❌';
      default: return '❓';
    }
  }

  private parseDecomposition(response: string): MissionDecomposition {
    // JSON 블록 추출
    const jsonMatch = response.match(/\{[\s\S]*"squads"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Mission decomposition JSON not found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.squads || !Array.isArray(parsed.squads)) {
      throw new Error('Invalid squads format');
    }

    return parsed as MissionDecomposition;
  }

  private validateAssignee(assignee: string): AgentType {
    const valid: AgentType[] = ['dev', 'design', 'cs', 'marketing'];
    if (valid.includes(assignee as AgentType)) {
      return assignee as AgentType;
    }
    logger.warn('MISSION', `Invalid assignee "${assignee}", defaulting to dev`);
    return 'dev';
  }
}

export const missionManager = new MissionManager();
