# 🫒 Olea

**The Spend-to-Invest Flywheel — an autonomous agent on the Robinhood network
that turns everyday card spending into an on-chain invest → yield → auto-repay
loop, running as a web app.**

_Olea_ (Latin for the olive tree) is named for the way an olive grows: slowly,
quietly, and for a very long time — the same way spare change compounds here.

Nobody has shipped this yet. Robinhood's 2026 pieces exist *separately*:

- **Trading MCP / Agentic Accounts** — connect an AI agent to a dedicated,
  guardrailed brokerage account and let it place real trades.
- **Robinhood Chain** — an Arbitrum Orbit L2 (mainnet July 2026, ~100 ms blocks,
  Uniswap + Chainlink from day one) with **tokenized stocks** and DeFi.
- **The card + payments** surface that agents can also read and act on.

This project is the first to **fuse all three into one closed money loop.**

```
   card spend  →  round-up  →  invest (tokenized stocks)  →  DeFi yield
        ↑                                                        │
        └──────────────  auto-repay from reserve  ◄─────────────┘
```

Every time you buy a coffee, the agent rounds up the change (×multiplier),
splits it into a tokenized-stock basket buy (via the Trading MCP) and a
yield-bearing DeFi reserve (on Robinhood Chain), then later **auto-repays your
card statement from the yield** — keeping your invested principal working.
All within the guardrails you set.

---

## Run it

The whole simulation runs **client-side in the browser** — no backend needed —
so it works on any static host (Vercel, GitHub Pages, `file://`). Just serve the
`public/` folder:

```bash
# any static server works, e.g.
npx serve public
# or use the bundled Node server (also exposes the real-integration seams):
npm start   # → http://localhost:3000
```

Or deploy `public/` to Vercel / Netlify and it runs as-is.

Then on the dashboard:

- **Simulate purchase** — fire a single card transaction through the flywheel.
- **Autopilot** — stream purchases automatically and watch the loop spin.
- **Auto-repay** — have the agent sweep the yield reserve to pay down the card.

Prices move every second, DeFi yield accrues, the charts animate, and every
agent decision is logged with a synthetic on-chain tx hash.

---

## How the agent thinks

Each round-up runs through `server/agent.js`, which:

1. **Enforces guardrails** — daily invest cap, per-trade cap, min card buffer,
   and a manual-approval threshold (large deployments queue for your OK instead
   of executing). These mirror Robinhood Agentic Account guardrails.
2. **Corrects drift** — invests into whichever basket token is most *underweight*
   vs its target, so the portfolio self-balances over time.
3. **Splits invest vs reserve** — a slice of every round-up is parked in DeFi to
   earn yield that later repays the card.
4. **Explains itself** — every action carries a human-readable reason shown live.

---

## Architecture

```
public/                 The web app — runs standalone, no backend
  index.html            Landing page ("Launch app" → app.html)
  app.html              Dashboard shell (the live agent)
  app.js                Dashboard controller + canvas charts
  engine.js             The full flywheel simulation, in the browser
  styles.css            Shared design system (modern dark, olive accent)
  olea-mark.png         The Olea leaf logo / favicon
server/                 Optional Node server for local dev + real integration
  index.js              Static host + REST/SSE + real-integration seams
  flywheel.js           Server-side engine (mirrors the browser one)
  agent.js              Decision logic + guardrail enforcement
  robinhood/
    mcpClient.js        Trading MCP client (real seam + sim fallback)
    chain.js            Robinhood Chain: tokenized positions + DeFi yield
    market.js           Tokenized-stock price feed
    cardFeed.js         Card purchases + round-up + webhook parser
config.example.json     Guardrails, basket weights, integration endpoints
```

The browser demo is powered entirely by `public/engine.js`. The `server/`
tree keeps the same shape for wiring the **real** Robinhood Trading MCP / Chain
when you have credentials — see the seams below.

### Going live (from simulation → real Robinhood)

The app ships in **simulation mode** so it runs anywhere with no keys. To wire
the real network, copy `config.example.json` → `config.json`, set `mode` to
`live`, and fill in:

| Field | What it connects | Seam in code |
| --- | --- | --- |
| `robinhood.tradingMcpUrl` | Your Robinhood Trading MCP server URL | `server/robinhood/mcpClient.js` → `buyTokenizedStock()` |
| `robinhood.chainRpcUrl` | Robinhood Chain JSON-RPC | `server/robinhood/chain.js` (settlement + DeFi) |
| `robinhood.cardWebhookSecret` | Inbound card webhook auth | `POST /api/card/webhook` → `cardFeed.parseWebhook()` |

Each seam is a single, clearly-commented method — the rest of the app never
needs to know whether it's talking to a simulator or the real broker.

---

## ⚠️ Disclaimer

This is a **prototype / proof-of-concept**, not financial advice and not a
production trading system. Autonomous trading and copy/auto-invest flows carry
real regulatory and financial risk; the simulation exists so you can explore the
mechanics safely before any real integration. Do your own due diligence and
comply with Robinhood's terms and applicable law before connecting real funds.
