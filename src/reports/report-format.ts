// ============================================================
// 표준 보고 포맷 - 모든 에이전트 공통
// ============================================================

export type ReportStatus = 'InProgress' | 'Complete' | 'Failed' | 'Blocked' | 'NeedsReview';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export interface StandardReport {
  team: string;
  task: string;
  status: ReportStatus;
  risk: RiskLevel;
  files: string[];
  nextAction: string;
  details?: string;
}

export function formatReport(report: StandardReport): string {
  const lines = [
    '[REPORT]',
    `Team: ${report.team}`,
    `Task: ${report.task}`,
    `Status: ${report.status}`,
    `Risk: ${report.risk}`,
    `Files: ${report.files.join(', ') || 'None'}`,
    `Next Action: ${report.nextAction}`,
  ];
  if (report.details) {
    lines.push(`Details: ${report.details}`);
  }
  return lines.join('\n');
}

export function parseReport(text: string): StandardReport | null {
  const reportMatch = text.match(/\[REPORT\]([\s\S]*?)(?=\[REPORT\]|$)/);
  if (!reportMatch) return null;

  const block = reportMatch[1];
  const extract = (key: string): string => {
    const m = block.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : '';
  };

  const status = extract('Status');
  const risk = extract('Risk');

  return {
    team: extract('Team'),
    task: extract('Task'),
    status: (status || 'InProgress') as ReportStatus,
    risk: (risk || 'Medium') as RiskLevel,
    files: extract('Files')
      .split(',')
      .map(f => f.trim())
      .filter(f => f && f !== 'None'),
    nextAction: extract('Next Action'),
    details: extract('Details') || undefined,
  };
}

const VALID_STATUSES: ReportStatus[] = ['InProgress', 'Complete', 'Failed', 'Blocked', 'NeedsReview'];
const VALID_RISKS: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];

export function validateReport(report: StandardReport): string[] {
  const errors: string[] = [];
  if (!report.team) errors.push('Missing Team');
  if (!report.task) errors.push('Missing Task');
  if (!VALID_STATUSES.includes(report.status)) {
    errors.push(`Invalid Status: "${report.status}" (valid: ${VALID_STATUSES.join(', ')})`);
  }
  if (!VALID_RISKS.includes(report.risk)) {
    errors.push(`Invalid Risk: "${report.risk}" (valid: ${VALID_RISKS.join(', ')})`);
  }
  if (!report.nextAction) errors.push('Missing Next Action');
  return errors;
}

export function tryExtractAndValidateReport(text: string): {
  report: StandardReport | null;
  errors: string[];
} {
  const report = parseReport(text);
  if (!report) {
    return { report: null, errors: ['[REPORT] 형식을 찾을 수 없습니다.'] };
  }
  const errors = validateReport(report);
  return { report, errors };
}
