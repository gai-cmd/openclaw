import { type AgentType } from '../config.js';
import { callLLM } from '../providers/index.js';
import { logger } from '../utils/logger.js';

export interface DecomposedTask {
  title: string;
  description: string;
  assignee: AgentType;
  phase: number;
  dependencies: string[];
}

const TASK_DECOMPOSITION_PROMPT = `당신은 PO(Product Owner) AI입니다.
사용자의 명령을 분석하여 구체적인 하위 작업으로 분해해야 합니다.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트를 포함하지 마세요.

{
  "tasks": [
    {
      "title": "작업 제목",
      "description": "구체적인 작업 설명",
      "assignee": "dev | design | cs | marketing",
      "phase": 1,
      "dependencies": []
    }
  ]
}

규칙:
- assignee는 반드시 "dev", "design", "cs", "marketing" 중 하나
- phase는 실행 순서 (1이 가장 먼저, 같은 phase는 병렬 실행)
- dependencies는 선행 작업의 title 배열 (없으면 빈 배열)
- 작업은 최소 2개, 최대 8개로 분해
- 각 작업은 실행 가능한 수준으로 구체적이어야 함
`;

export async function decomposeTask(command: string): Promise<DecomposedTask[]> {
  logger.info('PO-AGENT', `Decomposing task: ${command}`);

  // PO 에이전트의 프로바이더/모델로 호출
  const text = await callLLM(
    'po',
    TASK_DECOMPOSITION_PROMPT,
    [{ role: 'user', content: command }]
  );

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);
    const tasks: DecomposedTask[] = parsed.tasks;

    logger.success('PO-AGENT', `Decomposed into ${tasks.length} tasks`);
    return tasks;
  } catch (err) {
    logger.error('PO-AGENT', 'Failed to parse task decomposition', err);
    return [
      {
        title: command,
        description: command,
        assignee: 'dev',
        phase: 1,
        dependencies: [],
      },
    ];
  }
}
