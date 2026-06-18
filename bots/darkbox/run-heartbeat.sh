#!/usr/bin/env bash
# Keep the DarkBox demo market alive with periodic trading bursts, conserving the
# limited ARC testnet gas. Each burst re-seeds a 2-sided quote (so the book stays
# tradeable) and moves the price; between bursts the maker's resting orders persist.
# Stops when the treasury (deployer gas) drops below a reserve so the demo can't
# brick itself.
#
#   ./run-heartbeat.sh [burstSecs=20] [restSecs=120] [bots=6] [tps=2] [reserveEth=0.6]
set +e
cd "$(dirname "$0")"

RPC=https://rpc.testnet.arc.network
TREASURY=0xCa1370C6226A867BE549A0aEB613f27BdD11370B
YESBOOK=0x8dF8bba836512dEFf4B3755EA0b0c5B81764a83D
LOG=/tmp/dbx-heartbeat.log

BURST=${1:-20}
REST=${2:-120}
BOTS=${3:-6}
TPS=${4:-2}
RESERVE=${5:-0.6}

echo "$(date) heartbeat start: burst=${BURST}s rest=${REST}s bots=$BOTS tps=$TPS reserve=${RESERVE}ETH" | tee -a "$LOG"

while true; do
  bal=$(cast balance "$TREASURY" --rpc-url "$RPC" 2>/dev/null)
  eth=$(python3 -c "print($bal/1e18)" 2>/dev/null || echo 0)
  ok=$(python3 -c "print(1 if float('$eth') > float('$RESERVE') else 0)" 2>/dev/null || echo 0)
  if [ "$ok" != "1" ]; then
    echo "$(date) treasury ${eth} ETH <= reserve ${RESERVE} ETH — stopping heartbeat to preserve gas" | tee -a "$LOG"
    break
  fi
  # continue the price from wherever it is (in-band), else recenter to 0.5
  ct=$(cast call "$YESBOOK" 'currentTick()(int24)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
  # continue from the live price, but mean-revert ~20% toward 0.5 so it doesn't run to the rails
  fair=$(python3 -c "p=1.0001**int('${ct:-0}'); p=p if 0.06<p<0.94 else 0.5; print(round(0.8*p+0.1,2))" 2>/dev/null || echo 0.5)
  echo "$(date) burst: fair=$fair treasury=${eth}ETH" | tee -a "$LOG"
  node dbx-swarm.mjs --live --bots "$BOTS" --tps "$TPS" --duration "$BURST" --fair "$fair" --gas-eth 0.12 >> "$LOG" 2>&1
  sleep "$REST"
done
