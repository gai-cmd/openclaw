const path = require('path');

module.exports = {
  apps: [{
    name: 'multi-agent-bot',
    script: path.resolve(__dirname, 'node_modules/tsx/dist/cli.mjs'),
    args: 'src/index.ts',
    cwd: __dirname,
    node_args: '--import tsx',
    interpreter: 'node',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '512M',
    restart_delay: 3000,
    max_restarts: 10,
  }],
};
