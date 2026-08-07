// Market data for tokenized stocks on Robinhood Chain.
//
// In simulation mode we generate a plausible random walk per ticker so the
// dashboard has something living to show. In live mode the same interface is
// meant to be backed by Robinhood's Trading MCP market-data tools (which as of
// mid-2026 expose quotes plus 18 technical indicators) and Chainlink price
// feeds on Robinhood Chain.

const SEED_PRICES = {
  NVDAx: 172.4,
  MSFTx: 512.1,
  GOOGLx: 205.7,
  AAPLx: 243.9,
};

export class Market {
  constructor(tickers) {
    this.prices = {};
    for (const t of tickers) {
      this.prices[t] = SEED_PRICES[t] ?? 100;
    }
    // Per-ticker momentum so a "strategy" has something to lean on.
    this.momentum = Object.fromEntries(tickers.map((t) => [t, 0]));
  }

  // Advance every price one tick along a mean-reverting random walk.
  tick() {
    for (const t of Object.keys(this.prices)) {
      const drift = this.momentum[t] * 0.4;
      const shock = (Math.random() - 0.5) * 0.012; // ±0.6% per tick
      const ret = drift + shock;
      this.momentum[t] = this.momentum[t] * 0.85 + shock; // decaying memory
      this.prices[t] = +(this.prices[t] * (1 + ret)).toFixed(4);
    }
    return this.quote();
  }

  quote() {
    // Shallow copy so callers can't mutate internal state.
    return { ...this.prices };
  }

  priceOf(ticker) {
    return this.prices[ticker];
  }
}
