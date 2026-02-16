import { Bot, Context } from 'grammy';
import { config, BOT_TOKENS, type AgentType, type AgentRole } from '../config.js';
import { logger } from '../utils/logger.js';
import { routeGroupMessage, setVoiceMode, isVoiceMode, sendToChannel } from './router.js';
import { registerBot, getAllBots, getAllBotIds, getBot, getBotInfo, type BotInfo } from './registry.js';
import { getTokenUsageReport, AGENT_MODELS, PO_FAST_MODEL } from '../providers/index.js';
import { getAgent } from '../agents/base-agent.js';
import { DEFAULT_BOT_ROLES, ROLE_DISPLAY_NAMES } from '../config/roles.js';
import { pipeline, STAGE_DISPLAY_NAMES } from '../pipeline/pipeline-engine.js';
import { ticketSystem } from '../tickets/ticket-system.js';
import { registerMissionCommands } from '../mission/mission-commands.js';
import { registerKanbanCommands } from '../kanban/kanban-commands.js';

export { getBot, getBotInfo, getAllBotIds, getAllBots } from './registry.js';

// ============================================================
// 봇 생성 (5개 Bot 인스턴스)
// ============================================================

export async function createBots(): Promise<void> {
  const agentTypes: AgentType[] = ['po', 'dev', 'design', 'cs', 'marketing'];

  for (const agentType of agentTypes) {
    const token = BOT_TOKENS[agentType];
    const bot = new Bot(token);

    // 봇 identity 확인
    const me = await bot.api.getMe();
    const info: BotInfo = {
      bot,
      agentType,
      username: me.username ?? '',
      botId: me.id,
    };
    registerBot(info);

    // 핸들러 등록
    registerHandlers(bot, agentType);

    logger.info('BOT', `Created @${info.username} (${agentType.toUpperCase()}, id:${me.id})`);
  }
}

// ============================================================
// 핸들러 등록 (봇별)
// ============================================================

function registerHandlers(bot: Bot, agentType: AgentType) {
  // PO 봇에만 관리 커맨드 등록
  if (agentType === 'po') {
    registerPOCommands(bot);
  }

  // 모든 봇: /chatid
  bot.command('chatid', async (ctx) => {
    const chatId = ctx.chat.id;
    const chatTitle = ctx.chat.type !== 'private' ? (ctx.chat as { title?: string }).title : 'DM';
    await ctx.reply(`📍 채팅 ID: <code>${chatId}</code>\n채팅 이름: ${chatTitle}`, { parse_mode: 'HTML' });
  });

  // 모든 봇: /switch - 서브역할 전환
  bot.command('switch', async (ctx) => {
    const targetMode = ctx.match?.trim();
    const agent = getAgent(agentType);
    const roleConfig = DEFAULT_BOT_ROLES[agentType];

    if (!targetMode) {
      const roleList = roleConfig.availableRoles
        .map(r => `  ${r === agent.currentRole ? '▸' : '  '} ${r} (${ROLE_DISPLAY_NAMES[r]})`)
        .join('\n');
      await ctx.reply(
        `🔄 <b>역할 전환</b>\n\n` +
        `현재: <b>${ROLE_DISPLAY_NAMES[agent.currentRole]}</b>\n\n` +
        `전환 가능:\n${roleList}\n\n` +
        `사용법: <code>/switch ${roleConfig.availableRoles[0]}</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const success = agent.switchRole(targetMode as AgentRole);
    if (success) {
      await ctx.reply(`✅ 역할 전환: <b>${ROLE_DISPLAY_NAMES[agent.currentRole]}</b>`, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(
        `❌ 전환 실패: "${targetMode}"는 사용할 수 없는 모드입니다.\n` +
        `가능: ${roleConfig.availableRoles.join(', ')}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // 음성 메시지 처리
  bot.on('message:voice', async (ctx) => {
    // Anti-loop: 봇 메시지 무시
    if (getAllBotIds().has(ctx.from?.id ?? 0)) return;

    await handleVoiceMessage(ctx, agentType);
  });

  // 일반 텍스트 메시지
  bot.on('message:text', async (ctx) => {
    const fromId = ctx.from?.id ?? 0;

    if (getAllBotIds().has(fromId)) {
      // 자기 자신의 메시지는 무시 (self-loop 방지)
      const myInfo = getBotInfo(agentType);
      if (myInfo && fromId === myInfo.botId) return;

      // 다른 봇의 메시지 → fromBot 플래그로 라우팅 (멘션만 허용)
      await routeGroupMessage(ctx, agentType, ctx.message.text, true);
      return;
    }

    await routeGroupMessage(ctx, agentType, ctx.message.text);
  });

  // 에러 핸들링 - 절대 크래시하지 않도록
  bot.catch((err) => {
    logger.error(`BOT-${agentType.toUpperCase()}`, `Handler error (계속 실행): ${err.message ?? err.error}`);
    try {
      const errStr = String(err.error ?? err.message ?? '');
      logger.error(`BOT-${agentType.toUpperCase()}`, errStr);
    } catch { /* 로깅 실패도 무시 */ }
  });
}

// ============================================================
// PO 전용 커맨드
// ============================================================

function registerPOCommands(bot: Bot) {
  // 미션(소대 편제) 커맨드 등록
  registerMissionCommands(bot);

  // 칸반 보드 커맨드 등록
  registerKanbanCommands(bot);

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🧠 <b>AI Development Organization v2</b>\n\n' +
        '<b>🎖 작전 (Platoon Formation):</b>\n' +
        '/mission [설명] - 병렬 작전 시작\n' +
        '/mstatus [ID] - 작전 진행 현황\n' +
        '/sstatus [ID] - 분대별 상세 현황\n\n' +
        '<b>📋 파이프라인:</b>\n' +
        '/build [기능] - 빌드 파이프라인 시작\n' +
        '/audit [모듈] - 보안 감사 실행\n' +
        '/release [버전] - 릴리즈 프로세스\n' +
        '/pipeline [상태|ID] - 파이프라인 현황\n' +
        '/tickets - 티켓 현황\n\n' +
        '<b>📊 칸반 보드:</b>\n' +
        '/kanban - 칸반 명령어 도움말\n' +
        '/board [프로젝트] - 칸반 보드 조회\n' +
        '/dashboard - 전체 대시보드\n' +
        '/progress [프로젝트] - Phase 진행률\n\n' +
        '<b>🔧 관리:</b>\n' +
        '/task [내용] - 새 작업 지시\n' +
        '/status - 현재 작업 현황\n' +
        '/mode [openclaw|auditor] - PO 모드 전환\n' +
        '/switch [역할] - 서브역할 전환\n' +
        '/voice - 음성 응답 모드 토글\n' +
        '/report - 토큰 사용량 리포트\n' +
        '/health - 시스템 상태 확인\n' +
        '/chatid - 채팅 ID 확인\n' +
        '/help - 도움말',
      { parse_mode: 'HTML' }
    );
  });

  bot.command('voice', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const currentlyOn = isVoiceMode(chatId);
    setVoiceMode(chatId, !currentlyOn);
    const status = !currentlyOn ? '🔊 ON' : '🔇 OFF';
    await ctx.reply(
      `음성 응답 모드: <b>${status}</b>\n${!currentlyOn ? '이제 텍스트 + 음성으로 응답합니다.' : '텍스트로만 응답합니다.'}`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('help', async (ctx) => {
    // 봇 유저네임 목록 생성
    const botList = Array.from(getAllBots().values())
      .map((b) => {
        const names: Record<AgentType, string> = {
          po: '이레(PO)', dev: '다온(Dev)', design: '채아(Design)',
          cs: '나래(CS)', marketing: '알리(Marketing)',
        };
        return `• @${b.username} → ${names[b.agentType]}`;
      })
      .join('\n');

    await ctx.reply(
      '📖 <b>도움말</b>\n\n' +
        '<b>명령어 (PO봇):</b>\n' +
        '/task [내용] - PO봇에게 작업 지시\n' +
        '/status - 진행 중인 모든 작업 현황\n' +
        '/report - 오늘 토큰 사용량 리포트\n' +
        '/health - 시스템 상태 확인\n' +
        '/voice - 음성 응답 모드 토글\n' +
        '/chatid - 이 채팅의 ID 확인\n\n' +
        '<b>공유 그룹 사용법:</b>\n' +
        '• 일반 메시지 → 관련 분야 봇이 자동 응답\n' +
        '• @멘션 또는 이름 호출 → 해당 봇이 응답\n' +
        '• 예: "@다온 코드 리뷰해줘" 또는 "다온아 버그 확인해"\n\n' +
        '<b>봇 목록:</b>\n' + botList + '\n\n' +
        '🎙 음성 메시지를 보내면 자동으로 텍스트 변환 후 처리합니다.',
      { parse_mode: 'HTML' }
    );
  });

  // /mode - PO 전용 역할 전환 (openclaw ↔ auditor)
  bot.command('mode', async (ctx) => {
    const targetMode = ctx.match?.trim();
    const agent = getAgent('po');

    if (!targetMode) {
      await ctx.reply(
        `🔄 <b>PO 모드</b>\n\n` +
        `현재: <b>${ROLE_DISPLAY_NAMES[agent.currentRole]}</b>\n\n` +
        `사용법:\n` +
        `<code>/mode openclaw</code> - 총괄 모드\n` +
        `<code>/mode auditor</code> - 감사관 모드`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const success = agent.switchRole(targetMode as AgentRole);
    if (success) {
      await ctx.reply(`✅ PO 모드 전환: <b>${ROLE_DISPLAY_NAMES[agent.currentRole]}</b>`, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(`❌ 전환 실패: "${targetMode}"는 사용할 수 없습니다. (openclaw 또는 auditor)`);
    }
  });

  // /build <feature> - 파이프라인에 빌드 아이템 생성 → Dev에게 dispatch
  bot.command('build', async (ctx) => {
    const feature = ctx.match?.trim();
    if (!feature) {
      await ctx.reply('❗ 빌드할 기능을 입력하세요.\n예: <code>/build auth-module</code>', { parse_mode: 'HTML' });
      return;
    }

    // 파이프라인 아이템 생성 (build 스테이지에서 시작)
    const item = pipeline.createItem(
      feature,
      `사용자 요청: ${feature} 빌드`,
      'po',
      { startStage: 'build', priority: 'medium' }
    );

    await ctx.reply(
      `🔨 <b>빌드 파이프라인 시작</b>\n\n` +
      `ID: <code>${item.id}</code>\n` +
      `기능: ${feature}\n` +
      `스테이지: ${STAGE_DISPLAY_NAMES[item.stage]}\n` +
      `담당: Dev(빌더)\n\n` +
      `Dev에게 작업을 전달합니다...`,
      { parse_mode: 'HTML' }
    );

    // Dev에게 작업 지시 (라우터를 통해)
    await routeGroupMessage(ctx, 'po', `[BUILD ${item.id}] ${feature} 기능을 구현해주세요. 완료 후 [REPORT] 포맷으로 보고해주세요.`);
  });

  // /audit <module> - PO를 auditor 모드로 전환 후 감사 수행
  bot.command('audit', async (ctx) => {
    const target = ctx.match?.trim();
    if (!target) {
      await ctx.reply('❗ 감사 대상을 입력하세요.\n예: <code>/audit auth-module</code>', { parse_mode: 'HTML' });
      return;
    }

    const agent = getAgent('po');
    const prevRole = agent.currentRole;
    agent.switchRole('auditor' as AgentRole);

    await ctx.reply(
      `🔍 <b>감사 모드 활성화</b>\n\n` +
      `대상: ${target}\n` +
      `모드: ${ROLE_DISPLAY_NAMES[agent.currentRole]}\n\n` +
      `감사를 시작합니다...`,
      { parse_mode: 'HTML' }
    );

    // auditor 모드로 메시지 처리
    await routeGroupMessage(ctx, 'po', `[AUDIT] ${target} 모듈에 대한 보안 감사를 수행해주세요. race condition, 권한 취약점, 에러 핸들링을 중점 검사하세요.`);

    // 감사 후 원래 역할로 복귀
    agent.switchRole(prevRole);
  });

  // /release <version> - 릴리즈 프로세스
  bot.command('release', async (ctx) => {
    const version = ctx.match?.trim();
    if (!version) {
      await ctx.reply('❗ 버전을 입력하세요.\n예: <code>/release v1.2.0</code>', { parse_mode: 'HTML' });
      return;
    }

    const item = pipeline.createItem(
      `릴리즈 ${version}`,
      `버전 ${version} 릴리즈 프로세스`,
      'po',
      { startStage: 'integrate', priority: 'high' }
    );

    await ctx.reply(
      `🚀 <b>릴리즈 프로세스 시작</b>\n\n` +
      `버전: ${version}\n` +
      `ID: <code>${item.id}</code>\n` +
      `스테이지: ${STAGE_DISPLAY_NAMES[item.stage]}\n\n` +
      `통합 → 릴리즈 승인 과정을 진행합니다.`,
      { parse_mode: 'HTML' }
    );

    await routeGroupMessage(ctx, 'po', `[RELEASE ${item.id}] 버전 ${version} 릴리즈를 준비합니다. 현재 파이프라인 상태를 확인하고 릴리즈 가능 여부를 판단하세요.`);
  });

  // /pipeline [status] - 파이프라인 현황 조회
  bot.command('pipeline', async (ctx) => {
    const sub = ctx.match?.trim();

    if (!sub || sub === 'status') {
      const status = pipeline.getStatus();
      await ctx.reply(status, { parse_mode: 'HTML' });
      return;
    }

    // /pipeline <item-id> - 특정 아이템 상세
    const item = pipeline.getItem(sub.toUpperCase());
    if (item) {
      const historyLines = item.history.map(h =>
        `  ${STAGE_DISPLAY_NAMES[h.from]} → ${STAGE_DISPLAY_NAMES[h.to]} (${h.triggeredBy}, ${h.reason})`
      );
      await ctx.reply(
        `📊 <b>파이프라인 아이템 상세</b>\n\n` +
        `ID: <code>${item.id}</code>\n` +
        `제목: ${item.title}\n` +
        `스테이지: ${STAGE_DISPLAY_NAMES[item.stage]}\n` +
        `상태: ${item.status}\n` +
        `우선순위: ${item.priority}\n` +
        `담당: ${item.assignee ?? '미배정'}\n` +
        (item.ticketId ? `티켓: ${item.ticketId}\n` : '') +
        `\n` +
        (historyLines.length > 0 ? `<b>이력:</b>\n${historyLines.join('\n')}` : '(이력 없음)'),
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ 파이프라인 아이템을 찾을 수 없습니다: ${sub}`);
    }
  });

  // /tickets - 티켓 현황 조회 (PO용)
  bot.command('tickets', async (ctx) => {
    const summary = ticketSystem.getStatusSummary();
    await ctx.reply(summary, { parse_mode: 'HTML' });
  });

  bot.command('task', async (ctx) => {
    const taskContent = ctx.match;
    if (!taskContent) {
      await ctx.reply('❗ 작업 내용을 입력해주세요.\n예: /task 로그인 페이지 UI 개선');
      return;
    }
    await routeGroupMessage(ctx, 'po', `/task ${taskContent}`);
  });

  bot.command('status', async (ctx) => {
    await routeGroupMessage(ctx, 'po', '/status');
  });

  bot.command('report', async (ctx) => {
    const report = getTokenUsageReport();
    await ctx.reply(report, { parse_mode: 'HTML' });
  });

  bot.command('health', async (ctx) => {
    const lines: string[] = [];
    lines.push('🏥 <b>시스템 상태 (AI Dev Org v2)</b>');
    lines.push('');
    lines.push('<b>▸ 봇 상태 & 역할</b>');
    for (const [agent, info] of getAllBots()) {
      const agentInstance = getAgent(agent);
      const roleName = ROLE_DISPLAY_NAMES[agentInstance.currentRole];
      const role = agent === 'po' ? '🔵HUB' : '🟢SPOKE';
      lines.push(`  ${role} ${roleName}: @${info.username} ✅`);
    }
    lines.push('');
    lines.push('<b>▸ 에이전트별 모델</b>');
    for (const [agent, mc] of Object.entries(AGENT_MODELS)) {
      const names: Record<string, string> = {
          po: 'OpenClaw', dev: '다온(Dev)', design: '채아(Design)',
          cs: '나래(CS)', marketing: '알리(Marketing)',
        };
      const name = names[agent] || agent;
      lines.push(`  ${name}: ${mc.provider}/${mc.model}`);
    }
    lines.push(`  PO Fast: anthropic/${PO_FAST_MODEL}`);
    lines.push('');
    lines.push('<b>▸ 안전장치</b>');
    lines.push('  ✅ 3중 프로바이더 폴백 (Anthropic↔OpenAI↔Gemini)');
    lines.push('  ✅ 지수 백오프 재시도 (3회)');
    lines.push('  ✅ Agentic → 텍스트 모드 자동 폴백');
    lines.push('  ✅ Rate Limit 감지 + 쿨다운');
    lines.push('  ✅ Anti-Loop 봇 ID 필터');
    lines.push('  ✅ 일일 토큰 사용량 자동 리포트 (23:50)');
    lines.push('');
    const uptimeMs = process.uptime() * 1000;
    const hours = Math.floor(uptimeMs / 3_600_000);
    const mins = Math.floor((uptimeMs % 3_600_000) / 60_000);
    lines.push(`<b>▸ 업타임:</b> ${hours}h ${mins}m`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
}

// ============================================================
// 음성 메시지 처리
// ============================================================

async function handleVoiceMessage(ctx: Context, agentType: AgentType) {
  try {
    const token = BOT_TOKENS[agentType];
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

    const file_blob = new File([buffer], 'voice.ogg', { type: 'audio/ogg' });
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: file_blob,
      language: 'ko',
    });

    const text = transcription.text;
    logger.info('STT', `음성 → 텍스트: "${text}"`);

    await ctx.reply(`🎙 <i>"${text}"</i>`, { parse_mode: 'HTML' });

    await routeGroupMessage(ctx, agentType, text);
  } catch (err) {
    logger.error('STT', '음성 메시지 처리 실패', err);
    await ctx.reply('⚠️ 음성 메시지를 처리할 수 없습니다. 텍스트로 다시 보내주세요.');
  }
}

// ============================================================
// 봇 시작/종료
// ============================================================

export async function startBots() {
  logger.info('BOT', 'Starting all 5 bots...');

  for (const [agentType, info] of getAllBots()) {
    info.bot.start({
      drop_pending_updates: true,
      onStart: () => {
        logger.success(`BOT-${agentType.toUpperCase()}`, `@${info.username} is running!`);
      },
    });
  }

  // PO 시작 메시지 전송
  await new Promise((r) => setTimeout(r, 2000)); // 봇 초기화 대기

  if (config.CHANNEL_COMMAND_CENTER) {
    try {
      const startupMsg =
        '✅ <b>서비스가 안정화되었습니다</b>\n\n' +
        '🏗 <b>5-Bot Architecture</b> 정상 가동\n' +
        Array.from(getAllBots().values())
          .map((b) => {
            const icon = b.agentType === 'po' ? '🔵' : '🟢';
            return `${icon} @${b.username} (${b.agentType.toUpperCase()})`;
          })
          .join('\n') +
        '\n\n🛡 3중 프로바이더 폴백 활성화\n' +
        '📊 일일 토큰 리포트 예약 (23:50)';
      await sendToChannel(config.CHANNEL_COMMAND_CENTER, 'po', startupMsg);
      logger.info('BOT', 'PO 시작 메시지 전송 완료');
    } catch (err) {
      logger.warn('BOT', `PO 시작 메시지 전송 실패: ${err}`);
    }
  }

  // 공유 그룹에 PO만 인사 (한 번)
  if (config.SHARED_GROUP_ID) {
    try {
      await sendToChannel(config.SHARED_GROUP_ID, 'po', '팀 다시 들어왔습니다. 필요한 거 있으면 말씀해주세요.');
    } catch (err) {
      logger.warn('BOT', `시작 인사 전송 실패: ${err}`);
    }
  }

  logger.info('BOT', '모든 봇 시작 완료');
}

export async function stopBots() {
  if (dailyReportTimer) {
    clearInterval(dailyReportTimer);
    dailyReportTimer = null;
  }
  for (const [agentType, info] of getAllBots()) {
    try {
      await info.bot.stop();
      logger.info(`BOT-${agentType.toUpperCase()}`, 'Stopped.');
    } catch {
      // ignore
    }
  }
}

// ============================================================
// 일일 토큰 사용량 자동 리포트 (매일 23:50)
// ============================================================

let dailyReportTimer: ReturnType<typeof setInterval> | null = null;
let lastReportDate = '';

export function startDailyReport() {
  dailyReportTimer = setInterval(async () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const today = now.toISOString().split('T')[0];

    if (hour === 23 && minute === 50 && lastReportDate !== today) {
      lastReportDate = today;
      try {
        const report = getTokenUsageReport();
        if (config.CHANNEL_COMMAND_CENTER) {
          await sendToChannel(config.CHANNEL_COMMAND_CENTER, 'po', report);
          logger.info('REPORT', '일일 토큰 사용량 리포트 전송 완료');
        }
      } catch (err) {
        logger.error('REPORT', '일일 리포트 전송 실패', err);
      }
    }
  }, 60_000);

  logger.info('REPORT', '일일 토큰 리포트 스케줄러 시작 (매일 23:50)');
}
