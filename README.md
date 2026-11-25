# makefun-token-radar-03

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/SC0d3r/makefun-token-radar-03/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/SC0d3r/makefun-token-radar-03/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Ledger is a pre-token radar for make.fun's token-radar-01 bounty. It reads the sealed
DefiLlama snapshot and ranks pre-token protocols by an implied value built from a fitted size curve,
shrunk sector effects, seven-day growth, time with no token, and chain count. Every row carries a
costed farm plan with its ticket, gas, hours, expected value and net per hour. Live-token protocols
are set aside and shown with their real market cap, never mixed into the ranking.

The model is in `dashboard/model.js` so the page recomputes every number it shows. Two blind tests
(leave-one-out and an older-to-newer ladder) are printed in the dashboard and in `data.js`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
