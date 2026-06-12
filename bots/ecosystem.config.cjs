module.exports = {
  apps: [
    {
      name: 'clob-mm-bot',
      script: './mm-bot.mjs',
      cwd: '/home/xiko/uniswap-tools/order-book-hook/bots',
      env: { RPC_URL: 'http://127.0.0.1:8548' },
      restart_delay: 5000,
      max_restarts: 50,
    },
    {
      name: 'clob-taker-bot',
      script: './taker-bot.mjs',
      cwd: '/home/xiko/uniswap-tools/order-book-hook/bots',
      env: { RPC_URL: 'http://127.0.0.1:8548' },
      restart_delay: 5000,
      max_restarts: 50,
    },
  ],
};
