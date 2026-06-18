export const frontierLensAbi = [
  {
    "type": "function",
    "name": "bestPrices",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      },
      {
        "name": "scanWindow",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "outputs": [
      {
        "name": "out",
        "type": "tuple",
        "internalType": "struct FrontierLens.TopOfBook",
        "components": [
          {
            "name": "currentTick",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "bestAsk",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "bestAskSize",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "bestAskRate",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bestBid",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "bestBidSize",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "bestBidRate",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "spreadTicks",
            "type": "int24",
            "internalType": "int24"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "curveOf",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      }
    ],
    "outputs": [
      {
        "name": "c",
        "type": "tuple",
        "internalType": "struct FrontierLens.Curve",
        "components": [
          {
            "name": "geo",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "d",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "depth",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      },
      {
        "name": "fromTick",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "toTick",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "maxLevels",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "levels",
        "type": "tuple[]",
        "internalType": "struct FrontierLens.Level[]",
        "components": [
          {
            "name": "tick",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "askSize",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "bidSize",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionView",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      },
      {
        "name": "positionId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "v",
        "type": "tuple",
        "internalType": "struct FrontierLens.PositionView",
        "components": [
          {
            "name": "positionId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "lower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "upper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidity",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "claimedUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "live",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "isBid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "frontier",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "claimable",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "unfilled",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionViews",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      },
      {
        "name": "positionIds",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "views",
        "type": "tuple[]",
        "internalType": "struct FrontierLens.PositionView[]",
        "components": [
          {
            "name": "positionId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "lower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "upper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidity",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "claimedUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "live",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "isBid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "frontier",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "claimable",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "unfilled",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionsOf",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "fromId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "toId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "views",
        "type": "tuple[]",
        "internalType": "struct FrontierLens.PositionView[]",
        "components": [
          {
            "name": "positionId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "lower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "upper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidity",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "claimedUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "live",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "isBid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "frontier",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "claimable",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "unfilled",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteBuy",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      },
      {
        "name": "amount1In",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amount0Out",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1Spent",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "endTick",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteSell",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      },
      {
        "name": "amount0In",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxRuns",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amount1Out",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount0Spent",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "endTick",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "summary",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract FrontierBookBase"
      },
      {
        "name": "scanWindow",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "outputs": [
      {
        "name": "out",
        "type": "tuple",
        "internalType": "struct FrontierLens.BookSummary",
        "components": [
          {
            "name": "currentTick",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "token0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "token1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "bestAsk",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "bestBid",
            "type": "int24",
            "internalType": "int24"
          }
        ]
      }
    ],
    "stateMutability": "view"
  }
] as const;
