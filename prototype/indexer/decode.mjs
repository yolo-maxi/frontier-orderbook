// Minimal, dependency-free ABI log decoding for Frontier book events.
//
// We decode logs the same way any indexer does off `eth_getLogs`: match
// topics[0] against the event signature hash, then split topics/data into the
// declared fields. All Frontier event fields are static (int24, int256,
// uint*, address), so a 32-byte-word walk is enough — no dynamic types.
//
// topic0 values are keccak256 of the canonical event signature. They are
// hardcoded here (verified against the generated fixtures) so the indexer has
// zero runtime dependencies.

export const TOPIC0 = {
  BookCreated: "0xea07c21a5d3c4b71d71e4e953925afcfe61ebc079c5da27e0842aaf7a45d6955",
  // Deposit gained `bool isBid` (additive). Pre-fix topic was 0xa5c48a3a...
  Deposit: "0x81c0559c61444a4f42ffcfcad999feedc62173c7c694f28cc61a96e1e2c1e357",
  RunFilled: "0x3c360ec3b48efbd3cc757be37680d8974b7f3b3cf87022d926c57c38f358a91a",
  // Swept: new per-sweep summary (taker, tickBefore, tickAfter, amountIn, amountOut, takerFee)
  Swept: "0x876203bb92002ade302ebd5873f9c4e4184301c0489b13e92029540cc3dcf8cf",
  Claim: "0x022e3d29644ead4083349ca84d24bcac368b2461819b70f5921fea15de4dec4d",
  Cancel: "0xa4aca9007c86a624501bba301728138d278ce7540db0983aa22c279a10e2b348",
  Requote: "0x27525d856e05ae09633b438c8dec50a60a26fff6f6eeae4289f746905ffee006",
  PositionTransferred: "0x771a93a0ebcea83223a3544a30cd0c3471725bdc02f38c51de2fd707625c71d4",
  MakerFee: "0xc39368a3b96fe5be086d152900c8d6987b979958c0d2a19395804c024a2b51ef",
  TakerFee: "0x6a07dc450650dbe679c11bca05d6acd51931a933b0eac73de16faed3e0bc136c",
};

const BY_TOPIC = Object.fromEntries(Object.entries(TOPIC0).map(([k, v]) => [v.toLowerCase(), k]));

const TWO256 = 1n << 256n;

// read 32-byte word #i (0-based) from a 0x data string
function word(data, i) {
  const start = 2 + i * 64;
  return data.slice(start, start + 64);
}
function uintWord(data, i) {
  return BigInt("0x" + word(data, i));
}
function intWord(data, i) {
  let v = BigInt("0x" + word(data, i));
  if (v >= TWO256 >> 1n) v -= TWO256;
  return v;
}
function addrWord(data, i) {
  return "0x" + word(data, i).slice(24);
}
function addrTopic(topic) {
  return "0x" + topic.slice(26);
}
function uintTopic(topic) {
  return BigInt(topic);
}
function intTopic(topic) {
  let v = BigInt(topic);
  if (v >= TWO256 >> 1n) v -= TWO256;
  return v;
}

export function decodeLog(log) {
  const name = BY_TOPIC[log.topics[0].toLowerCase()];
  if (!name) return null;
  const t = log.topics;
  const d = log.data;
  let args;
  switch (name) {
    case "BookCreated":
      args = {
        book: addrTopic(t[1]),
        token0: addrTopic(t[2]),
        token1: addrTopic(t[3]),
        tickSpacing: Number(intWord(d, 0)),
        startTick: Number(intWord(d, 1)),
        creator: addrWord(d, 2),
        hooks: addrWord(d, 3),
        feeRecipient: addrWord(d, 4),
        makerFeeBps: Number(uintWord(d, 5)),
        takerFeeBps: Number(uintWord(d, 6)),
      };
      break;
    case "Deposit":
      args = {
        positionId: uintTopic(t[1]),
        owner: addrTopic(t[2]),
        lower: Number(intWord(d, 0)),
        upper: Number(intWord(d, 1)),
        liquidity: uintWord(d, 2),
        isBid: uintWord(d, 3) !== 0n,
      };
      break;
    case "Swept":
      args = {
        taker: addrTopic(t[1]),
        tickBefore: Number(intWord(d, 0)),
        tickAfter: Number(intWord(d, 1)),
        amountIn: uintWord(d, 2),
        amountOut: uintWord(d, 3),
        takerFee: uintWord(d, 4),
      };
      break;
    case "RunFilled":
      args = {
        fromLevel: Number(intTopic(t[1])),
        toBoundary: Number(intWord(d, 0)),
        startSize: uintWord(d, 1),
        slopePerLevel: intWord(d, 2),
        clock: uintWord(d, 3),
      };
      break;
    case "Claim":
      args = { positionId: uintTopic(t[1]), proceeds: uintWord(d, 0) };
      break;
    case "Cancel":
      args = { positionId: uintTopic(t[1]), proceeds: uintWord(d, 0), principal: uintWord(d, 1) };
      break;
    case "Requote":
      args = {
        positionId: uintTopic(t[1]),
        lower: Number(intWord(d, 0)),
        upper: Number(intWord(d, 1)),
        liquidity: uintWord(d, 2),
      };
      break;
    case "PositionTransferred":
      args = { positionId: uintTopic(t[1]), from: addrTopic(t[2]), to: addrTopic(t[3]) };
      break;
    case "MakerFee":
      args = {
        positionId: uintTopic(t[1]),
        token: addrTopic(t[2]),
        grossProceeds: uintWord(d, 0),
        fee: uintWord(d, 1),
        netProceeds: uintWord(d, 2),
        recipient: addrWord(d, 3),
      };
      break;
    case "TakerFee":
      args = {
        payer: addrTopic(t[1]),
        token: addrTopic(t[2]),
        grossInput: uintWord(d, 0),
        fee: uintWord(d, 1),
        totalPaid: uintWord(d, 2),
        recipient: addrWord(d, 3),
      };
      break;
    default:
      return null;
  }
  return { name, args, log };
}
