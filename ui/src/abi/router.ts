export const routerAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_factory",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_lens",
        "type": "address",
        "internalType": "contract FrontierLens"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "SWEEP_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "buyExactIn",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract UniformFrontierBook"
      },
      {
        "name": "amount1In",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minOut0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "paid1",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "received0",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "factory",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IFrontierBookRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getAmountsOut",
    "inputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "path",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "outputs": [
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lens",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract FrontierLens"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewZapDepositMirror",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract UniformFrontierBook"
      },
      {
        "name": "amount0In",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1In",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "z",
        "type": "tuple",
        "internalType": "struct FrontierRouter.ZapResult",
        "components": [
          {
            "name": "amount0In",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount1In",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "swapped0For1",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "swapIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "swapOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount0Deposited",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount1Deposited",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "shares",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refund0",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refund1",
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
    "name": "sellExactIn",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract UniformFrontierBook"
      },
      {
        "name": "amount0In",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minOut1",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "paid0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "received1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swapExactTokensForTokens",
    "inputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amountOutMin",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "path",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "zapDepositMirror",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "internalType": "contract UniformFrontierBook"
      },
      {
        "name": "amount0In",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1In",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minSwapOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minSharesOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "z",
        "type": "tuple",
        "internalType": "struct FrontierRouter.ZapResult",
        "components": [
          {
            "name": "amount0In",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount1In",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "swapped0For1",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "swapIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "swapOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount0Deposited",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount1Deposited",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "shares",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refund0",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refund1",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "MirrorLiquidityZap",
    "inputs": [
      {
        "name": "book",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "swapped0For1",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "swapIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "swapOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount0Deposited",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1Deposited",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "shares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "refund0",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "refund1",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const;
