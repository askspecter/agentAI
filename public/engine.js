// In-browser simulation engine for the Spend-to-Invest Flywheel.
//
// The whole flywheel runs client-side so it works on any static host (Vercel,
// GitHub Pages, file://) with no backend. The Node server under /server keeps
// the same shape for wiring the real Robinhood Trading MCP / Chain later, but
// the live demo you see in the browser is powered entirely by this module.

// ---- config --------------------------------------------------------------
export const CONFIG = {
  guardrails: {
    roundUpMultiplier: 5,
    perTradeCapUsd: 50,
    dailyInvestCapUsd: 200,
    manualApprovalAboveUsd: 100,
    minCardBufferUsd: 25,
  },
  basket: {
    name: "AI Megacap",
    weights: { NVDAx: 0.35, MSFTx: 0.25, GOOGLx: 0.2, AAPLx: 0.2 },
  },
  defi: { targetIdleYieldApy: 0.06 },
};

const SEED_PRICES = { NVDAx: 172.4, MSFTx: 512.1, GOOGLx: 205.7, AAPLx: 243.9 };

const MERCHANTS = [
  { name: "Blue Bottle Coffee", lo: 4.5, hi: 8.75, category: "coffee" },
  { name: "Whole Foods", lo: 18, hi: 96, category: "groceries" },
  { name: "Uber", lo: 9, hi: 41, category: "transport" },
  { name: "Steam", lo: 4.99, hi: 59.99, category: "entertainment" },
  { name: "Chipotle", lo: 11, hi: 27.5, category: "dining" },
  { name: "Amazon", lo: 6.25, hi: 140, category: "shopping" },
  { name: "Shell", lo: 30, hi: 78, category: "fuel" },
];

// ---- helpers -------------------------------------------------------------
function txHash() {
  const b = new Uint8Array(16);
  (self.crypto || crypto).getRandomValues(b);
  return "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const money = (lo, hi) => +(lo + Math.random() * (hi - lo)).toFixed(2);
const r2 = (n) => +Number(n).toFixed(2);

function roundUp(amount, multiplier = 1) {
  const change = +(Math.ceil(amount) - amount).toFixed(2);
  const base = change === 0 ? 1 : change;
  return +(base * multiplier).toFixed(2);
}

// ---- market --------------------------------------------------------------
class Market {
  constructor(tickers) {
    this.prices = {};
    this.momentum = {};
    for (const t of tickers) {
      this.prices[t] = SEED_PRICES[t] ?? 100;
      this.momentum[t] = 0;
    }
  }
  tick() {
    for (const t of Object.keys(this.prices)) {
      const shock = (Math.random() - 0.5) * 0.012;
      const ret = this.momentum[t] * 0.4 + shock;
      this.momentum[t] = this.momentum[t] * 0.85 + shock;
      this.prices[t] = +(this.prices[t] * (1 + ret)).toFixed(4);
    }
  }
  quote() {
    return { ...this.prices };
  }
  priceOf(t) {
    return this.prices[t];
  }
}

// ---- Robinhood Chain (tokenized positions + DeFi yield) ------------------
class Chain {
  constructor(apy) {
    this.positions = {};
    this.defiBalance = 0;
    this.defiApy = apy;
    this.yieldEarned = 0;
  }
  settleBuy(ticker, usd, price) {
    const shares = +(usd / price).toFixed(6);
    this.positions[ticker] = +((this.positions[ticker] ?? 0) + shares).toFixed(6);
    return { hash: txHash(), shares };
  }
  depositDefi(usd) {
    this.defiBalance = r2(this.defiBalance + usd);
    return { hash: txHash() };
  }
  withdrawDefi(usd) {
    const amount = Math.min(usd, this.defiBalance);
    this.defiBalance = r2(this.defiBalance - amount);
    return amount;
  }
  accrueYield(seconds) {
    if (this.defiBalance <= 0) return 0;
    const perSec = this.defiApy / (365 * 24 * 60 * 60);
    const earned = +(this.defiBalance * perSec * seconds).toFixed(6);
    this.defiBalance += earned;
    this.yieldEarned += earned;
    return earned;
  }
  portfolioValue(prices) {
    let v = 0;
    for (const [t, s] of Object.entries(this.positions)) v += s * (prices[t] ?? 0);
    return r2(v);
  }
  snapshot(prices) {
    return {
      positions: Object.entries(this.positions).map(([ticker, shares]) => ({
        ticker,
        shares,
        value: r2(shares * (prices[ticker] ?? 0)),
      })),
      portfolioValue: this.portfolioValue(prices),
      defiBalance: r2(this.defiBalance),
      defiApy: this.defiApy,
      yieldEarned: +this.yieldEarned.toFixed(4),
    };
  }
}

// ---- agent ---------------------------------------------------------------
class Agent {
  constructor(guardrails, basket) {
    this.g = guardrails;
    this.basket = basket;
    this.reserveRatio = 0.3;
    this.investedToday = 0;
    this.day = new Date().toDateString();
  }
  _roll() {
    const d = new Date().toDateString();
    if (d !== this.day) {
      this.day = d;
      this.investedToday = 0;
    }
  }
  chooseTicker(valueByTicker, totalInvested) {
    let best = null;
    let bestGap = -Infinity;
    for (const [t, target] of Object.entries(this.basket.weights)) {
      const cur = totalInvested > 0 ? (valueByTicker[t] ?? 0) / totalInvested : 0;
      const gap = target - cur;
      if (gap > bestGap) {
        bestGap = gap;
        best = t;
      }
    }
    return best;
  }
  planDeployment(roundUpAmt, valueByTicker, totalInvested) {
    this._roll();
    const g = this.g;
    if (this.investedToday >= g.dailyInvestCapUsd)
      return { action: "skip", reason: `daily invest cap $${g.dailyInvestCapUsd} reached, holding` };

    let investAmt = r2(roundUpAmt * (1 - this.reserveRatio));
    const reserveAmt = r2(roundUpAmt - investAmt);
    const remaining = g.dailyInvestCapUsd - this.investedToday;
    if (investAmt > remaining) investAmt = r2(remaining);
    if (investAmt > g.perTradeCapUsd) investAmt = g.perTradeCapUsd;

    if (investAmt > g.manualApprovalAboveUsd)
      return {
        action: "needs_approval",
        investAmt,
        reserveAmt,
        reason: `$${investAmt} exceeds manual-approval threshold $${g.manualApprovalAboveUsd}`,
      };

    const ticker = this.chooseTicker(valueByTicker, totalInvested);
    return {
      action: "invest",
      ticker,
      investAmt,
      reserveAmt,
      reason: `${ticker} most underweight, buying $${investAmt.toFixed(2)}, reserving $${reserveAmt.toFixed(2)}`,
    };
  }
  recordInvested(usd) {
    this.investedToday = r2(this.investedToday + usd);
  }
  planRepayment(cardBalance, reserveBalance) {
    const buf = this.g.minCardBufferUsd;
    if (cardBalance <= 0) return { action: "skip", reason: "no card balance due" };
    const payable = Math.max(0, r2(reserveBalance - buf));
    if (payable <= 0) return { action: "skip", reason: `reserve below $${buf} buffer, deferring` };
    const pay = Math.min(payable, cardBalance);
    return { action: "repay", amount: r2(pay), reason: `auto-repaying $${pay.toFixed(2)} from yield reserve` };
  }
}

// ---- flywheel ------------------------------------------------------------
export class Flywheel {
  constructor(config = CONFIG) {
    this.config = config;
    const tickers = Object.keys(config.basket.weights);
    this.market = new Market(tickers);
    this.chain = new Chain(config.defi.targetIdleYieldApy);
    this.agent = new Agent(config.guardrails, config.basket);

    this.cardBalance = 0;
    this.reserveBalance = 0;
    this.totalSpent = 0;
    this.totalCaptured = 0; // spare change pulled into the flywheel
    this.totalInvested = 0;
    this.totalRepaid = 0;

    this.log = [];
    this.pendingApprovals = [];
    this.txCount = 0;
    this._seq = 1;
  }

  _record(type, text, extra = {}) {
    this.log.push({ id: this._seq++, type, text, at: Date.now(), ...extra });
    if (this.log.length > 300) this.log.shift();
  }
  _valueByTicker() {
    const out = {};
    for (const p of this.chain.snapshot(this.market.quote()).positions) out[p.ticker] = p.value;
    return out;
  }

  simulatePurchase() {
    const m = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
    this.onPurchase({ merchant: m.name, category: m.category, amount: money(m.lo, m.hi) });
  }

  onPurchase(txn) {
    this.cardBalance = r2(this.cardBalance + txn.amount);
    this.totalSpent = r2(this.totalSpent + txn.amount);
    this._record("spend", `Card: $${txn.amount.toFixed(2)} at ${txn.merchant}`);
    const ru = roundUp(txn.amount, this.config.guardrails.roundUpMultiplier);
    this.totalCaptured = r2(this.totalCaptured + ru);
    this._deploy(ru);
  }

  _deploy(ru) {
    const plan = this.agent.planDeployment(ru, this._valueByTicker(), this.totalInvested);
    if (plan.action === "skip") return this._record("agent", plan.reason);
    if (plan.action === "needs_approval") {
      const item = { id: `apr_${Date.now()}_${this._seq}`, ...plan };
      this.pendingApprovals.push(item);
      return this._record("approval", `Needs approval, ${plan.reason}`, { approvalId: item.id });
    }
    this._execInvest(plan);
  }

  _execInvest(plan) {
    if (plan.reserveAmt > 0) {
      const r = this.chain.depositDefi(plan.reserveAmt);
      this.reserveBalance = r2(this.reserveBalance + plan.reserveAmt);
      this.txCount++;
      this._record("defi", `Reserved $${plan.reserveAmt.toFixed(2)} into DeFi pool`, { tx: r.hash });
    }
    if (plan.investAmt > 0 && plan.ticker) {
      const price = this.market.priceOf(plan.ticker);
      const rec = this.chain.settleBuy(plan.ticker, plan.investAmt, price);
      this.totalInvested = r2(this.totalInvested + plan.investAmt);
      this.agent.recordInvested(plan.investAmt);
      this.txCount++;
      this._record("invest", `Bought $${plan.investAmt.toFixed(2)} ${plan.ticker} @ $${price.toFixed(2)}`, {
        tx: rec.hash,
        ticker: plan.ticker,
      });
    }
  }

  resolveApproval(id, approve) {
    const i = this.pendingApprovals.findIndex((a) => a.id === id);
    if (i === -1) return;
    const [item] = this.pendingApprovals.splice(i, 1);
    if (approve) {
      this._execInvest({
        action: "invest",
        ticker: this.agent.chooseTicker(this._valueByTicker(), this.totalInvested),
        investAmt: item.investAmt,
        reserveAmt: item.reserveAmt,
      });
      this._record("approval", `Approved $${item.investAmt.toFixed(2)} deployment`);
    } else {
      this._record("approval", `Rejected $${item.investAmt.toFixed(2)} deployment`);
    }
  }

  runRepayment() {
    const plan = this.agent.planRepayment(this.cardBalance, this.reserveBalance);
    if (plan.action !== "repay") return this._record("agent", plan.reason);
    const amount = this.chain.withdrawDefi(plan.amount);
    this.reserveBalance = r2(this.reserveBalance - amount);
    this.cardBalance = r2(this.cardBalance - amount);
    this.totalRepaid = r2(this.totalRepaid + amount);
    this.txCount++;
    this._record("repay", plan.reason);
  }

  tick(seconds) {
    this.market.tick();
    const earned = this.chain.accrueYield(seconds);
    if (earned > 0) this.reserveBalance += earned;
  }

  snapshot() {
    const prices = this.market.quote();
    const chain = this.chain.snapshot(prices);
    const flywheelValue = r2(chain.portfolioValue + this.reserveBalance);
    const netContributed = r2(this.totalCaptured - this.totalRepaid);
    const returnUsd = r2(flywheelValue - netContributed);
    const returnPct = netContributed > 0 ? returnUsd / netContributed : 0;
    return {
      mode: "in-browser simulation",
      basket: this.config.basket.name,
      guardrails: this.config.guardrails,
      prices,
      chain,
      txCount: this.txCount,
      money: {
        flywheelValue,
        returnUsd,
        returnPct,
        totalCaptured: this.totalCaptured,
        totalInvested: this.totalInvested,
        totalRepaid: this.totalRepaid,
        totalSpent: this.totalSpent,
        reserveBalance: r2(this.reserveBalance),
        cardBalance: this.cardBalance,
        netContributed,
      },
      pendingApprovals: this.pendingApprovals,
      log: this.log.slice(-60).reverse(),
    };
  }
}
