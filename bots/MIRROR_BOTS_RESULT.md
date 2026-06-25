# Mirror Bots Result

## Deployment

- Market: Base Sepolia `84532`
- Book: `0x8FA29E8c17cE1eEA9c5f7c95975ca269F806e869`
- Deployment file used: `prototype/deployments/base-sepolia-pm.json`
- Price model: geometric, `price = 1.0001^tick`
- Bot band: ticks `-8100..-5640`
- Fair-value center: initialized from live `currentTick` around `-6780`

## Wallets

Private keys are in `/home/xiko/clawd/secrets/frontier-bots/` and are not committed.

- `mm-owner`: `0xea1124B3FDCc1c2528c45316D16c9b9a99dc52D4`
- `mm-operator`: `0x00AfE7635783Addf57E98f77E16593C47c8d0Bc3`
- `taker`: `0xa9aeaeFfA6F0EBae8687338f361979Fd637841C0`

Each wallet was funded with `0.05` Base Sepolia ETH from `0xF053A15C36f1FbCC2A281095e6f1507ea1EFc931`.

## Heartbeat

- Port: `3392`
- Public URL: `https://frontier-bots.repo.box`
- Endpoints:
  - `GET /status`
  - `POST /heartbeat`
- CORS allows `https://frontier-pm.repo.box`.
- Caddy block on repo.box:

```caddy
frontier-bots.repo.box {
	reverse_proxy localhost:3392
}
```

repo.box is a separate host, so `frontier-bots-tunnel` keeps an SSH reverse tunnel from this bot host to repo.box localhost port `3392`.

## PM2

- `frontier-heartbeat`
- `frontier-bots-tunnel`
- `frontier-mm-bot`
- `frontier-taker-bot`

`pm2 save` completed.

## Presence Gate

- Before heartbeat: `GET https://frontier-bots.repo.box/status` returned `active:false`.
- Before heartbeat: bot wallet nonces were `0, 0, 0`, confirming no bot txs while idle.
- Logs showed:
  - `[mm] idle/sleeping: no heartbeat yet`
  - `[taker] idle/sleeping: no heartbeat yet`
- After heartbeat expiry: status returned `active:false` with `lastSeenSecsAgo > 60`, and both bot logs returned to `idle/sleeping`.

## Activity Evidence

Heartbeat was simulated with:

```bash
curl -X POST -H 'Origin: https://frontier-pm.repo.box' https://frontier-bots.repo.box/heartbeat
```

Sampled `book.currentTick()` readings:

| Time UTC | currentTick | Price |
|---|---:|---:|
| 2026-06-25T02:55:18Z | `-6780` | `50.76c` |
| 2026-06-25T02:55:49Z | `-6780` | `50.76c` |
| 2026-06-25T02:56:19Z | `-6840` | `50.46c` |
| 2026-06-25T02:56:50Z | `-6840` | `50.46c` |
| 2026-06-25T02:57:20Z | `-6900` | `50.16c` |

Bot wallet nonces after activity:

- `mm-owner`: `48`
- `mm-operator`: `0` (generated and funded; MM uses single-key owner requotes/posting)
- `taker`: `10`

Observed taker txs:

- `0xb6832eec027ae3ddc798327df55cae096c104baa7e5ff2e9ca28d7474b40a900`
- `0xc9bd4292c2b1194fec4eba7b8a9f85af4b619bdb207afc334145f0f04dc4838c`

Observed maker txs include:

- `0x58998e757b045b81032e25e07ba3913aceb36669f337c772fb2b1b6e9745a868`
- `0x88864f241fedb50970704a412b20f7231a179df6e93505e46cb97cdd4315ecf9`
- `0x6a6beee2e4a3b7fe715a12f8f1965e78651f344b6ebb216199a76b2d0c1c723e`

## Notes

- Contracts were not redeployed.
- UI was rebuilt with `CI=true npx vite build` and published with `repo-box-publish.sh static ui/dist frontier-pm`.
- The maker uses owner-signed requotes/reposts rather than delegated operator requotes, because bid requotes can require token1 differentials to be paid by `msg.sender`.
- Partially filled bid positions can reject fast `requoteBid`; the bot catches this and falls back to cancel/repost behavior.
