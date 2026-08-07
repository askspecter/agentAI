// The agent brain.
//
// Given a round-up of new cash, the agent decides how to deploy it and enforces
// the user's guardrails. Its decisions are deliberately explainable — every
// action carries a human-readable `reason` so the dashboard can narrate what the
// agent is doing and why, which is exactly the transparency Robinhood's Agentic
// Accounts are built around.

export class Agent {
  constructor({ guardrails, basket }) {
    this.guardrails = guardrails;
    this.basket = basket;
    // Share of each round-up kept as yield-bearing reserve to auto-repay the
    // card; the rest is invested into the tokenized-stock basket.
    this.reserveRatio = 0.3;
    this.investedToday = 0;
    this.dayStamp = new Date().toDateString();
  }

  _rollDayIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.dayStamp) {
      this.dayStamp = today;
      this.investedToday = 0;
    }
  }

  // Pick the tokenized stock that is most *underweight* vs its target — the
  // drift-correcting choice, so every round-up nudges the basket toward target.
  chooseTicker(positionsValue, totalInvested) {
    const g = this.basket.weights;
    let best = null;
    let bestGap = -Infinity;
    for (const [ticker, target] of Object.entries(g)) {
      const current = totalInvested > 0 ? (positionsValue[ticker] ?? 0) / totalInvested : 0;
      const gap = target - current;
      if (gap > bestGap) {
        bestGap = gap;
        best = ticker;
      }
    }
    return best;
  }

  // Decide what to do with a fresh round-up. Returns a plan the flywheel executes.
  planDeployment({ roundUp, positionsValue, totalInvested }) {
    this._rollDayIfNeeded();
    const g = this.guardrails;

    if (this.investedToday >= g.dailyInvestCapUsd) {
      return { action: "skip", reason: `daily invest cap $${g.dailyInvestCapUsd} reached — holding` };
    }

    // Split into invest vs reserve.
    let investAmt = +(roundUp * (1 - this.reserveRatio)).toFixed(2);
    const reserveAmt = +(roundUp - investAmt).toFixed(2);

    // Respect the remaining daily budget.
    const remainingBudget = g.dailyInvestCapUsd - this.investedToday;
    if (investAmt > remainingBudget) investAmt = +remainingBudget.toFixed(2);

    // Per-trade cap.
    if (investAmt > g.perTradeCapUsd) investAmt = g.perTradeCapUsd;

    // Above the manual-approval line? Queue instead of executing.
    if (investAmt > g.manualApprovalAboveUsd) {
      return {
        action: "needs_approval",
        investAmt,
        reserveAmt,
        reason: `$${investAmt} exceeds manual-approval threshold $${g.manualApprovalAboveUsd}`,
      };
    }

    const ticker = this.chooseTicker(positionsValue, totalInvested);
    return {
      action: "invest",
      ticker,
      investAmt,
      reserveAmt,
      reason: `${ticker} most underweight vs target — buying $${investAmt}, reserving $${reserveAmt} for yield`,
    };
  }

  recordInvested(usd) {
    this.investedToday = +(this.investedToday + usd).toFixed(2);
  }

  // Decide how much of the card balance to auto-repay from reserve, keeping a
  // liquidity buffer so we never drain everything.
  planRepayment({ cardBalance, reserveBalance }) {
    const buffer = this.guardrails.minCardBufferUsd;
    if (cardBalance <= 0) return { action: "skip", reason: "no card balance due" };
    const payable = Math.max(0, +(reserveBalance - buffer).toFixed(2));
    if (payable <= 0) {
      return { action: "skip", reason: `reserve below $${buffer} buffer — deferring repayment` };
    }
    const pay = Math.min(payable, cardBalance);
    return {
      action: "repay",
      amount: +pay.toFixed(2),
      reason: `auto-repaying $${pay.toFixed(2)} of card from yield reserve (keeps $${buffer} buffer)`,
    };
  }
}
