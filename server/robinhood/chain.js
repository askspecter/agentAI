// Robinhood Chain — the on-chain settlement + DeFi layer of the flywheel.
//
// Robinhood Chain is an Arbitrum Orbit L2 (mainnet July 2026, ~100ms blocks,
// Uniswap + Chainlink integrated from day one). This module models the two
// on-chain things the flywheel needs:
//
//   1. Tokenized-stock positions (settled trades leave you holding *x tokens).
//   2. A DeFi pool where idle USDx earns yield between invests.
//
// Every mutation returns a synthetic "receipt" with a tx hash so the UI can
// show real-looking on-chain provenance. Swap the bodies for real RPC calls
// (config.robinhood.chainRpcUrl) to go live.

import { randomBytes } from "node:crypto";

function txHash() {
  return "0x" + randomBytes(16).toString("hex");
}

export class RobinhoodChain {
  constructor({ defiApy }) {
    this.positions = {}; // ticker -> shares (fractional)
    this.defiBalance = 0; // USDx sitting in the DeFi pool
    this.defiApy = defiApy;
    this.yieldEarned = 0; // lifetime yield harvested into the flywheel
    this.receipts = [];
  }

  // Settle a buy of a tokenized stock. Returns an on-chain receipt.
  settleBuy(ticker, usd, price) {
    const shares = +(usd / price).toFixed(6);
    this.positions[ticker] = +((this.positions[ticker] ?? 0) + shares).toFixed(6);
    return this._receipt("BUY", { ticker, usd, price, shares });
  }

  // Park idle cash into the DeFi pool.
  depositDefi(usd) {
    this.defiBalance = +(this.defiBalance + usd).toFixed(2);
    return this._receipt("DEFI_DEPOSIT", { usd, pool: "idle-yield" });
  }

  // Pull cash back out of the DeFi pool (e.g. to auto-repay the card).
  withdrawDefi(usd) {
    const amount = Math.min(usd, this.defiBalance);
    this.defiBalance = +(this.defiBalance - amount).toFixed(2);
    return { receipt: this._receipt("DEFI_WITHDRAW", { usd: amount }), amount };
  }

  // Accrue yield on the DeFi balance for `seconds` of elapsed time.
  accrueYield(seconds) {
    if (this.defiBalance <= 0) return 0;
    const perSecond = this.defiApy / (365 * 24 * 60 * 60);
    const earned = +(this.defiBalance * perSecond * seconds).toFixed(6);
    this.defiBalance = +(this.defiBalance + earned).toFixed(6);
    this.yieldEarned = +(this.yieldEarned + earned).toFixed(6);
    return earned;
  }

  // Mark-to-market value of all tokenized-stock positions.
  portfolioValue(prices) {
    let v = 0;
    for (const [ticker, shares] of Object.entries(this.positions)) {
      v += shares * (prices[ticker] ?? 0);
    }
    return +v.toFixed(2);
  }

  snapshot(prices) {
    return {
      positions: Object.entries(this.positions).map(([ticker, shares]) => ({
        ticker,
        shares,
        value: +(shares * (prices[ticker] ?? 0)).toFixed(2),
      })),
      portfolioValue: this.portfolioValue(prices),
      defiBalance: +this.defiBalance.toFixed(2),
      defiApy: this.defiApy,
      yieldEarned: +this.yieldEarned.toFixed(4),
    };
  }

  _receipt(kind, data) {
    const r = { hash: txHash(), kind, ...data, at: Date.now() };
    this.receipts.push(r);
    if (this.receipts.length > 200) this.receipts.shift();
    return r;
  }
}
