// Hyper-active bot fleet — a market-maker + taker pair per market.
//
//   Spot : the live Frontier book (prototype/deployments/latest.json)
//   PM   : the prediction-market book (separate deployment — set PM_DEPLOYMENT
//          below to its deployments JSON once the PM book is deployed)
//
// Launch:   pm2 start ecosystem.config.cjs
// Spot only: pm2 start ecosystem.config.cjs --only clob-mm-spot,clob-taker-spot
//
// All cadence/size knobs are env-tunable here. Defaults are aggressive ("super
// hyper-active"): MM requotes every 3s, takers fire every 2-6s with fat size.
// Dial MM_INTERVAL_MS / TAKER_*_MS up if the node can't keep pace.

const RPC_URL = process.env.RPC_URL || 'https://rpc-clob.repo.box';

// distinct anvil keys per market so the two MMs / takers don't share nonces
const SPOT = { OWNER: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', OPERATOR: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', TAKER: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' };
const PM = { OWNER: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', OPERATOR: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e', TAKER: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356' };

// hyper-active timing/size shared by both markets
const HOT_MM = { MM_INTERVAL_MS: '3000', MM_SPREAD: '0.001', MM_LADDER_TICKS: '1000', MM_SIZE_WEI: '10000000000000000' /* 0.01 WETH/level */ };
const HOT_TAKER = { TAKER_MIN_MS: '2000', TAKER_MAX_MS: '6000', TAKER_SIZE_MIN: '0.005', TAKER_SIZE_MAX: '0.05' };

const SPOT_DEPLOYMENT = process.env.SPOT_DEPLOYMENT || '../prototype/deployments/latest.json';
// TODO: point this at the PM book's deployment JSON (separate deployment).
const PM_DEPLOYMENT = process.env.PM_DEPLOYMENT || '../prototype/deployments/pm.json';

const cwd = '/home/xiko/uniswap-tools/order-book-hook/bots';
const base = { restart_delay: 5000, max_restarts: 50, cwd };

module.exports = {
  apps: [
    {
      ...base,
      name: 'clob-mm-spot',
      script: './mm-bot.mjs',
      env: { RPC_URL, DEPLOYMENT: SPOT_DEPLOYMENT, MARKET_LABEL: 'spot', MM_OWNER_PK: SPOT.OWNER, MM_OPERATOR_PK: SPOT.OPERATOR, ...HOT_MM },
    },
    {
      ...base,
      name: 'clob-taker-spot',
      script: './taker-bot.mjs',
      env: { RPC_URL, DEPLOYMENT: SPOT_DEPLOYMENT, MARKET_LABEL: 'spot', TAKER_PK: SPOT.TAKER, ...HOT_TAKER },
    },
    {
      ...base,
      name: 'clob-mm-pm',
      script: './mm-bot.mjs',
      env: { RPC_URL, DEPLOYMENT: PM_DEPLOYMENT, MARKET_LABEL: 'pm', MM_OWNER_PK: PM.OWNER, MM_OPERATOR_PK: PM.OPERATOR, ...HOT_MM },
    },
    {
      ...base,
      name: 'clob-taker-pm',
      script: './taker-bot.mjs',
      env: { RPC_URL, DEPLOYMENT: PM_DEPLOYMENT, MARKET_LABEL: 'pm', TAKER_PK: PM.TAKER, ...HOT_TAKER },
    },
  ],
};
