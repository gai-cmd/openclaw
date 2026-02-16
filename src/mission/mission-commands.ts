import { Bot } from 'grammy';
import { missionManager } from './mission-manager.js';
import { mercenary } from './mercenary.js';
import { logger } from '../utils/logger.js';

// ============================================================
// 미션 텔레그램 커맨드 (/mission, /mstatus, /sstatus)
// PO 봇에만 등록
// ============================================================

export function registerMissionCommands(bot: Bot): void {

  // ============================================================
  // /mission <설명> - 병렬 작전 시작
  // ============================================================
  bot.command('mission', async (ctx) => {
    const description = ctx.match?.trim();
    if (!description) {
      const available = mercenary.getAvailableMercenaries();
      await ctx.reply(
        '🎖 <b>작전 명령 (Platoon Formation)</b>\n\n' +
        '사용법: <code>/mission [작전 설명]</code>\n\n' +
        '예시:\n' +
        '<code>/mission 칸반보드 서비스 구축 - 백엔드 API, 프론트 디자인, 마케팅 랜딩페이지</code>\n\n' +
        '모든 팀원이 동시에 병렬로 작업을 수행합니다.\n\n' +
        `🔫 용병(CLI): ${available.length > 0 ? available.join(', ') : '없음 (자체 LLM 사용)'}`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const chatId = String(ctx.chat.id);
    const requester = ctx.from?.first_name ?? 'Unknown';

    await ctx.reply(
      '🎖 <b>작전 개시</b>\n\n' +
      '미션을 분석하고 분대를 편성합니다...',
      { parse_mode: 'HTML' }
    );

    try {
      // Phase 1: 미션 분해 + 분대 편성
      const mission = await missionManager.createMission(description, requester, chatId);

      // 분대 편성 결과 표시
      const agentEmojis: Record<string, string> = {
        dev: '🔧', design: '🎨', cs: '💬', marketing: '📣',
      };
      const agentNames: Record<string, string> = {
        dev: '다온(Dev)', design: '채아(Design)',
        cs: '나래(CS)', marketing: '알리(Marketing)',
      };

      const squadTable = mission.squads.map(s => {
        const emoji = agentEmojis[s.assignee] ?? '🔧';
        const name = agentNames[s.assignee] ?? s.assignee;
        return `| ${s.callsign} | ${emoji} ${name} | ${s.objective.slice(0, 30)} | ⚡${s.priority} |`;
      }).join('\n');

      await ctx.reply(
        `🎖 <b>소대 편성 완료</b> (${mission.id})\n\n` +
        `<b>미션:</b> ${description}\n` +
        `<b>분대:</b> ${mission.squads.length}개\n\n` +
        `<pre>| 분대 | 분대장 | 목표 | 우선순위 |\n` +
        `|------|--------|------|----------|\n` +
        `${squadTable}</pre>\n\n` +
        `⚡ 모든 분대 동시 투입 중...`,
        { parse_mode: 'HTML' }
      );

      // Phase 2: 병렬 실행 (비동기 - 백그라운드)
      missionManager.executeMission(mission.id).catch(err => {
        logger.error('MISSION', `Mission ${mission.id} execution failed: ${err}`);
        ctx.reply(`❌ 작전 실행 실패 (${mission.id}): ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('MISSION', `Mission creation failed: ${msg}`);
      await ctx.reply(`❌ 작전 편성 실패: ${msg}`);
    }
  });

  // ============================================================
  // /mstatus [ID] - 작전 현황 조회
  // ============================================================
  bot.command('mstatus', async (ctx) => {
    const missionId = ctx.match?.trim();

    try {
      const status = missionManager.getMissionStatus(missionId || undefined);
      await ctx.reply(status, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 현황 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ============================================================
  // /sstatus <ID> - 분대별 상세 현황
  // ============================================================
  bot.command('sstatus', async (ctx) => {
    const missionId = ctx.match?.trim();

    if (!missionId) {
      await ctx.reply(
        '사용법: <code>/sstatus MSN-0001</code>\n' +
        '특정 미션의 분대별 상세 현황을 보여줍니다.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    try {
      const status = missionManager.getSquadStatus(missionId);
      await ctx.reply(status, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 분대 현황 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
