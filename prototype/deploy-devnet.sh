#!/bin/bash
# Deploy the Frontier demo stack to the clob devnet via forge create + cast.
set -e
export PATH="$PATH:/home/xiko/.foundry/bin"
RPC=${RPC:-http://127.0.0.1:8547}
K=${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}
DEPLOYER=$(cast wallet address $K)
CR="forge create --rpc-url $RPC --private-key $K --broadcast"
dep() { $CR "$@" 2>&1 | grep "Deployed to:" | awk '{print $3}'; }

WETH=$(dep src/MockERC20.sol:MockERC20 --constructor-args "Wrapped Ether (demo)" "WETH")
USDC=$(dep src/MockERC20.sol:MockERC20 --constructor-args "USD Coin (demo)" "USDC")
REGISTRY=$(dep src/permissions/PermissionRegistry.sol:PermissionRegistry)
# factory now takes the four book/ops deployer helpers (two-level bitmap + geometric refactor)
BOOK_DEP=$(dep src/FrontierDeployers.sol:RollingBookDeployer)
OPS_DEP=$(dep src/FrontierDeployers.sol:MakerOpsDeployer)
GEO_BOOK_DEP=$(dep src/FrontierDeployers.sol:GeometricBookDeployer)
GEO_OPS_DEP=$(dep src/FrontierDeployers.sol:GeometricOpsDeployer)
FACTORY=$(dep src/FrontierBookFactory.sol:FrontierBookFactory --constructor-args $REGISTRY $BOOK_DEP $OPS_DEP $GEO_BOOK_DEP $GEO_OPS_DEP)
LENS=$(dep src/periphery/FrontierLens.sol:FrontierLens)
ROUTER=$(dep src/periphery/FrontierRouter.sol:FrontierRouter --constructor-args $FACTORY $LENS)
LPF=$(dep src/periphery/RangeLP.sol:RangeLPFactory)
YV=$(dep src/MockYieldVault.sol:MockYieldVault --constructor-args $WETH "Yield-bearing demo WETH" "ywWETH")
echo "tokens/infra deployed"

# seed at the LIVE ETH price so the book opens on-market
PRICE=$(curl -s --max-time 8 https://api.coinbase.com/v2/prices/ETH-USD/spot | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['amount'])" 2>/dev/null || echo 4000)
START_TICK=$(python3 -c "print(round((float('$PRICE')-1)*1000))")
echo "seeding at \$$PRICE (tick $START_TICK)" 
cast send $FACTORY "createBook(address,address,int24,int24)" $WETH $USDC 1 $START_TICK --rpc-url $RPC --private-key $K > /dev/null
BOOK=$(cast call $FACTORY "defaultBook(address,address)(address)" $WETH $USDC --rpc-url $RPC)
echo "book: $BOOK"

# seed a two-sided market around \$4,000
cast send $WETH "mint(address,uint256)" $DEPLOYER 1000000ether --rpc-url $RPC --private-key $K > /dev/null
cast send $USDC "mint(address,uint256)" $DEPLOYER 1000000000ether --rpc-url $RPC --private-key $K > /dev/null
cast send $WETH "approve(address,uint256)" $BOOK $(cast max-uint) --rpc-url $RPC --private-key $K > /dev/null
cast send $USDC "approve(address,uint256)" $BOOK $(cast max-uint) --rpc-url $RPC --private-key $K > /dev/null
cast send $BOOK "deposit(int24,int24,uint128)" $((START_TICK+1000)) $((START_TICK+3000)) 1000000000000000 --rpc-url $RPC --private-key $K > /dev/null
cast send $BOOK "depositBid(int24,int24,uint128)" $((START_TICK-3000)) $((START_TICK-1000)) 1000000000000000 --rpc-url $RPC --private-key $K > /dev/null
echo "seeded"

CHAIN=$(cast chain-id --rpc-url $RPC)
cat > deployments/latest.json <<JSON
{
  "name": "Frontier Devnet",
  "chainId": $CHAIN,
  "rpcUrl": "https://rpc-clob.repo.box",
  "startTick": $START_TICK,
  "faucetKey": "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "contracts": {
    "book": "$BOOK",
    "factory": "$FACTORY",
    "router": "$ROUTER",
    "lens": "$LENS",
    "registry": "$REGISTRY",
    "lpFactory": "$LPF",
    "yieldVault": "$YV",
    "weth": "$WETH",
    "usdc": "$USDC"
  }
}
JSON
echo "deployment.json written"
cat deployments/latest.json
