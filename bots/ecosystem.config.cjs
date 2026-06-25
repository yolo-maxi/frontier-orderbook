const cwd = '/home/xiko/frontier-worktrees/mirror-bots/bots';
const secrets = '/home/xiko/clawd/secrets/frontier-bots';

module.exports = {
  apps: [
    {
      name: 'frontier-heartbeat',
      script: './heartbeat.mjs',
      cwd,
      env: {
        PORT: '3392',
        HOST: '127.0.0.1',
        HEARTBEAT_ALLOWED_ORIGINS: 'https://frontier-pm.repo.box,http://localhost:5173,http://localhost:5106',
      },
      restart_delay: 5000,
      max_restarts: 50,
    },
    {
      name: 'frontier-bots-tunnel',
      script: '/usr/bin/ssh',
      args:
        '-i /home/xiko/.ssh/id_ed25519 -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -N -R 3392:127.0.0.1:3392 fran@204.168.190.248',
      cwd,
      restart_delay: 5000,
      max_restarts: 50,
    },
    {
      name: 'frontier-mm-bot',
      script: './mm-bot.mjs',
      cwd,
      env: {
        RPC_URL: 'https://sepolia.base.org',
        HEARTBEAT_STATUS_URL: 'http://127.0.0.1:3392/status',
        MM_OWNER_PK_FILE: `${secrets}/mm-owner.txt`,
        MM_OPERATOR_PK_FILE: `${secrets}/mm-operator.txt`,
      },
      restart_delay: 5000,
      max_restarts: 50,
    },
    {
      name: 'frontier-taker-bot',
      script: './taker-bot.mjs',
      cwd,
      env: {
        RPC_URL: 'https://sepolia.base.org',
        HEARTBEAT_STATUS_URL: 'http://127.0.0.1:3392/status',
        TAKER_PK_FILE: `${secrets}/taker.txt`,
      },
      restart_delay: 5000,
      max_restarts: 50,
    },
  ],
};
