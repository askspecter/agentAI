// Trading MCP client — the seam between the agent and Robinhood's execution.
//
// Robinhood's Agentic Trading works by pasting one MCP server URL into your
// agent's config; the agent then calls MCP tools that place real orders inside
// a dedicated, guardrailed "Agentic Account". This wrapper mirrors that shape:
//
//   - In simulation mode, orders settle instantly against the local chain sim.
//   - In live mode (config.robinhood.tradingMcpUrl set), placeOrder() is where
//     you dispatch the real MCP `place_order` tool call.
//
// Keeping every order behind this one method means the rest of the app never
// has to know whether it's talking to a simulator or to Robinhood.

export class TradingMcpClient {
  constructor({ mcpUrl, chain, market }) {
    this.mcpUrl = mcpUrl || "";
    this.live = Boolean(mcpUrl);
    this.chain = chain;
    this.market = market;
  }

  get status() {
    return this.live ? "live" : "simulation";
  }

  // Buy `usd` worth of a tokenized stock. Returns { ok, receipt, shares, price }.
  async buyTokenizedStock(ticker, usd) {
    const price = this.market.priceOf(ticker);
    if (!price) return { ok: false, error: `unknown ticker ${ticker}` };

    if (this.live) {
      // === REAL INTEGRATION SEAM ===================================
      // await mcpCall(this.mcpUrl, "place_order", {
      //   account: "agentic",
      //   symbol: ticker,
      //   side: "buy",
      //   notional: usd,
      //   type: "market",
      // });
      // The MCP tool call would return a broker order id; you'd then read the
      // on-chain settlement from Robinhood Chain rather than the local sim.
      // =============================================================
      throw new Error("live Trading MCP not wired yet — set mode=simulation");
    }

    const receipt = this.chain.settleBuy(ticker, usd, price);
    return { ok: true, receipt, shares: receipt.shares, price };
  }
}
