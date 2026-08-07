// The flywheel engine — orchestrates the closed money loop:
//
//   card spend  →  round-up  →  invest (tokenized stocks)  →  DeFi yield
//        ↑                                                        │
//        └──────────────  auto-repay from reserve  ◄─────────────┘
//
// It ties together the market, the chain, the Trading MCP client, the card feed
// and the agent, and emits an event on every state change so the web layer can
// stream a live view.

import { EventEmitter } from "node:events";
import { Market } from "./robinhood/market.js";
import { RobinhoodChain } from "./robinhood/chain.js";
import { TradingMcpClient } from "./robinhood/mcpClient.js";
import { Agent } from "./agent.js";
import { simulatePurchase, roundUp } from "./robinhood/cardFeed.js";

export class Flywheel extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    const tickers = Object.keys(config.basket.weights);

    this.market = new Market(tickers);
    this.chain = new RobinhoodChain({ defiApy: config.defi.targetIdleYieldApy });
    this.mcp = new TradingMcpClient({
      mcpUrl: config.robinhood.tradingMcpUrl,
      chain: this.chain,
      market: this.market,
    });
    this.agent = new Agent({ guardrails: config.guardrails, basket: config.basket });

    // Flywheel-level money state.
    this.cardBalance = 0; // what the card owes
    this.reserveBalance = 0; // yield-bearing cash held to repay the card
    this.totalSpent = 0;
    this.totalInvested = 0;
    this.totalRepaid = 0;

    this.log = []; // human-readable activity feed
    this.pendingApprovals = [];
    this.lastTick = Date.now();
  }

  _emit() {
    this.emit("update", this.snapshot());
  }

  _record(type, text, extra = {}) {
    const entry = { id: this.log.length + 1, type, text, at: Date.now(), ...extra };
    this.log.push(entry);
    if (this.log.length > 300) this.log.shift();
    return entry;
  }

  // Per-ticker mark-to-market, keyed by ticker, used by the agent for drift.
  _positionsValueByTicker() {
    const prices = this.market.quote();
    const out = {};
    for (const p of this.chain.snapshot(prices).positions) out[p.ticker] = p.value;
    return out;
  }

  // ---- Phase 1: a card purchase arrives ----------------------------------
  async onPurchase(txn) {
    this.cardBalance = +(this.cardBalance + txn.amount).toFixed(2);
    this.totalSpent = +(this.totalSpent + txn.amount).toFixed(2);
    this._record("spend", `Card: $${txn.amount.toFixed(2)} at ${txn.merchant}`, { txn });

    const ru = roundUp(txn.amount, this.config.guardrails.roundUpMultiplier);
    await this.deployRoundUp(ru, txn);
    this._emit();
  }

  // ---- Phases 2–4: round-up → invest + reserve ---------------------------
  async deployRoundUp(ru, txn) {
    const plan = this.agent.planDeployment({
      roundUp: ru,
      positionsValue: this._positionsValueByTicker(),
      totalInvested: this.totalInvested,
    });

    if (plan.action === "skip") {
      this._record("agent", `⏸ ${plan.reason}`);
      return;
    }

    if (plan.action === "needs_approval") {
      const item = { id: `apr_${Date.now()}`, ...plan, ru, txn };
      this.pendingApprovals.push(item);
      this._record("approval", `🔐 Needs approval: ${plan.reason}`, { approvalId: item.id });
      return;
    }

    await this._executeInvest(plan);
  }

  async _executeInvest(plan) {
    // Reserve slice → DeFi pool (earns yield until it repays the card).
    if (plan.reserveAmt > 0) {
      const r = this.chain.depositDefi(plan.reserveAmt);
      this.reserveBalance = +(this.reserveBalance + plan.reserveAmt).toFixed(2);
      this._record("defi", `🪙 Reserved $${plan.reserveAmt.toFixed(2)} into DeFi pool`, { tx: r.hash });
    }

    // Invest slice → tokenized-stock buy via Trading MCP.
    if (plan.investAmt > 0 && plan.ticker) {
      const res = await this.mcp.buyTokenizedStock(plan.ticker, plan.investAmt);
      if (res.ok) {
        this.totalInvested = +(this.totalInvested + plan.investAmt).toFixed(2);
        this.agent.recordInvested(plan.investAmt);
        this._record(
          "invest",
          `📈 Bought $${plan.investAmt.toFixed(2)} ${plan.ticker} @ $${res.price} — ${plan.reason}`,
          { tx: res.receipt.hash, ticker: plan.ticker },
        );
      } else {
        this._record("error", `⚠ Buy failed: ${res.error}`);
      }
    }
  }

  // Approve or reject a queued high-value deployment.
  async resolveApproval(id, approve) {
    const idx = this.pendingApprovals.findIndex((a) => a.id === id);
    if (idx === -1) return { ok: false, error: "approval not found" };
    const [item] = this.pendingApprovals.splice(idx, 1);
    if (approve) {
      await this._executeInvest({
        action: "invest",
        ticker: this.agent.chooseTicker(this._positionsValueByTicker(), this.totalInvested),
        investAmt: item.investAmt,
        reserveAmt: item.reserveAmt,
        reason: "manually approved",
      });
      this._record("approval", `✅ Approved $${item.investAmt.toFixed(2)} deployment`);
    } else {
      this._record("approval", `❌ Rejected $${item.investAmt.toFixed(2)} deployment`);
    }
    this._emit();
    return { ok: true };
  }

  // ---- Phase 5: auto-repay the card from the yield reserve ---------------
  async runRepayment() {
    const plan = this.agent.planRepayment({
      cardBalance: this.cardBalance,
      reserveBalance: this.reserveBalance,
    });
    if (plan.action !== "repay") {
      this._record("agent", `⏸ ${plan.reason}`);
      this._emit();
      return { ok: true, plan };
    }
    const { amount } = this.chain.withdrawDefi(plan.amount);
    this.reserveBalance = +(this.reserveBalance - amount).toFixed(2);
    this.cardBalance = +(this.cardBalance - amount).toFixed(2);
    this.totalRepaid = +(this.totalRepaid + amount).toFixed(2);
    this._record("repay", `💳 ${plan.reason}`);
    this._emit();
    return { ok: true, plan };
  }

  // ---- Background heartbeat: move prices + accrue DeFi yield --------------
  tick() {
    const now = Date.now();
    const seconds = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.market.tick();
    const earned = this.chain.accrueYield(seconds);
    if (earned > 0) this.reserveBalance = +(this.reserveBalance + earned).toFixed(2);
    this._emit();
  }

  snapshot() {
    const prices = this.market.quote();
    const chain = this.chain.snapshot(prices);
    const netWorth = +(chain.portfolioValue + this.reserveBalance - this.cardBalance).toFixed(2);
    return {
      mode: this.mcp.status,
      basket: this.config.basket.name,
      guardrails: this.config.guardrails,
      prices,
      chain,
      money: {
        cardBalance: this.cardBalance,
        reserveBalance: +this.reserveBalance.toFixed(2),
        totalSpent: this.totalSpent,
        totalInvested: this.totalInvested,
        totalRepaid: this.totalRepaid,
        netWorth,
      },
      pendingApprovals: this.pendingApprovals,
      log: this.log.slice(-60).reverse(),
    };
  }

  // Convenience for the demo button / autopilot.
  async simulateSpend() {
    await this.onPurchase(simulatePurchase());
  }
}
