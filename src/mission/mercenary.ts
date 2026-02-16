import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import type { MercenaryType } from './types.js';

const execAsync = promisify(exec);

// ============================================================
// 용병(Mercenary) - 외부 AI CLI Headless 통합
// ============================================================

interface MercenaryConfig {
  command: string;
  buildCommand: (task: string) => string;
  timeout: number;
  specialties: string[];
  available: boolean;
}

const MERCENARY_CONFIGS: Record<MercenaryType, MercenaryConfig> = {
  'chatgpt': {
    command: 'chatgpt',
    buildCommand: (task) => `chatgpt -p "${task.replace(/"/g, '\\"')}"`,
    timeout: 120_000, // 2분
    specialties: ['코드', '구현', 'api', '함수', '리팩토링', 'debug', '범용'],
    available: false,
  },
  'gemini-cli': {
    command: 'gemini',
    buildCommand: (task) => `gemini -p "${task.replace(/"/g, '\\"')}"`,
    timeout: 90_000, // 1.5분
    specialties: ['조사', '분석', '시장', '트렌드', '문서화', '콘텐츠', '요약'],
    available: false,
  },
};

class MercenaryManager {
  /** 시작 시 CLI 가용성 체크 */
  async initialize(): Promise<void> {
    for (const [name, config] of Object.entries(MERCENARY_CONFIGS) as [MercenaryType, MercenaryConfig][]) {
      try {
        // --version 또는 --help로 CLI 존재 확인
        await execAsync(`${config.command} --version`, {
          timeout: 10_000,
          shell: 'powershell.exe',
        });
        config.available = true;
        logger.info('MERCENARY', `${name} CLI available`);
      } catch {
        // --version이 없는 CLI도 있으므로 --help 시도
        try {
          await execAsync(`${config.command} --help`, {
            timeout: 10_000,
            shell: 'powershell.exe',
          });
          config.available = true;
          logger.info('MERCENARY', `${name} CLI available (via --help)`);
        } catch {
          config.available = false;
          logger.warn('MERCENARY', `${name} CLI not found - will use agent LLM as fallback`);
        }
      }
    }

    const available = this.getAvailableMercenaries();
    logger.info('MERCENARY', `Available mercenaries: ${available.length > 0 ? available.join(', ') : 'none (all fallback to agent LLM)'}`);
  }

  /** 용병 CLI로 작업 실행 */
  async execute(type: MercenaryType, task: string): Promise<string> {
    const config = MERCENARY_CONFIGS[type];

    if (!config.available) {
      logger.warn('MERCENARY', `${type} not available, returning fallback marker`);
      return `[MERCENARY-UNAVAILABLE] ${type} CLI is not installed. Task: ${task}`;
    }

    const fullCommand = config.buildCommand(task);
    logger.info('MERCENARY', `Executing ${type}: ${fullCommand.slice(0, 100)}...`);

    try {
      const { stdout, stderr } = await execAsync(fullCommand, {
        timeout: config.timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        cwd: 'D:\\projects',
        shell: 'powershell.exe',
      });

      const output = (stdout + (stderr ? `\nSTDERR: ${stderr}` : '')).trim();
      logger.info('MERCENARY', `${type} completed (${output.length} chars)`);

      // 출력이 너무 길면 잘라내기
      return output.length > 10000
        ? output.slice(0, 10000) + '\n...(truncated)'
        : output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('MERCENARY', `${type} failed: ${msg}`);
      return `[MERCENARY-ERROR] ${type} execution failed: ${msg.slice(0, 200)}`;
    }
  }

  /** 작업 설명 기반으로 최적 용병 선택 */
  selectMercenary(taskDescription: string): MercenaryType | null {
    const lower = taskDescription.toLowerCase();

    // ChatGPT: 코드/구현 관련
    if (/코드|구현|api|함수|클래스|리팩토링|debug|빌드|테스트|작성/.test(lower)) {
      return MERCENARY_CONFIGS['chatgpt'].available ? 'chatgpt' : null;
    }

    // Gemini CLI: 조사/분석 관련
    if (/조사|분석|시장|트렌드|경쟁사|문서화|요약|콘텐츠|리서치/.test(lower)) {
      return MERCENARY_CONFIGS['gemini-cli'].available ? 'gemini-cli' : null;
    }

    return null;
  }

  /** 사용 가능한 용병 목록 */
  getAvailableMercenaries(): MercenaryType[] {
    return (Object.entries(MERCENARY_CONFIGS) as [MercenaryType, MercenaryConfig][])
      .filter(([_, config]) => config.available)
      .map(([name]) => name);
  }

  /** 용병 가용 여부 */
  isAvailable(type: MercenaryType): boolean {
    return MERCENARY_CONFIGS[type]?.available ?? false;
  }
}

export const mercenary = new MercenaryManager();
