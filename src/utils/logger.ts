const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
} as const;

function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

export const logger = {
  info(tag: string, message: string) {
    console.log(`${COLORS.cyan}[${timestamp()}]${COLORS.reset} ${COLORS.blue}[${tag}]${COLORS.reset} ${message}`);
  },
  success(tag: string, message: string) {
    console.log(`${COLORS.cyan}[${timestamp()}]${COLORS.reset} ${COLORS.green}[${tag}]${COLORS.reset} ${message}`);
  },
  warn(tag: string, message: string) {
    console.warn(`${COLORS.cyan}[${timestamp()}]${COLORS.reset} ${COLORS.yellow}[${tag}]${COLORS.reset} ${message}`);
  },
  error(tag: string, message: string, err?: unknown) {
    console.error(`${COLORS.cyan}[${timestamp()}]${COLORS.reset} ${COLORS.red}[${tag}]${COLORS.reset} ${message}`);
    if (err instanceof Error) console.error(`  ${err.message}`);
  },
};
