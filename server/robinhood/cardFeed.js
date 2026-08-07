// Card feed — the "spend" side of the Spend-to-Invest flywheel.
//
// Robinhood's agentic surface also lets agents see card activity and make
// payments via MCP. This module is the source of purchase events that kick the
// flywheel. In simulation mode it invents realistic merchant transactions; in
// live mode `parseWebhook` verifies and normalizes a real inbound card webhook.

const MERCHANTS = [
  { name: "Blue Bottle Coffee", lo: 4.5, hi: 8.75, category: "coffee" },
  { name: "Whole Foods", lo: 18, hi: 96, category: "groceries" },
  { name: "Uber", lo: 9, hi: 41, category: "transport" },
  { name: "Steam", lo: 4.99, hi: 59.99, category: "entertainment" },
  { name: "Chipotle", lo: 11, hi: 27.5, category: "dining" },
  { name: "Amazon", lo: 6.25, hi: 140, category: "shopping" },
  { name: "Shell", lo: 30, hi: 78, category: "fuel" },
];

let seq = 1;

function money(lo, hi) {
  return +(lo + Math.random() * (hi - lo)).toFixed(2);
}

// Produce one simulated card purchase.
export function simulatePurchase() {
  const m = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
  const amount = money(m.lo, m.hi);
  return {
    id: `txn_${seq++}`,
    merchant: m.name,
    category: m.category,
    amount,
    at: Date.now(),
  };
}

// Round-up: the change to the next whole dollar, times the multiplier.
// e.g. $23.40 with multiplier 5 -> ceil(23.40)-23.40 = 0.60 -> 3.00
export function roundUp(amount, multiplier = 1) {
  const change = +(Math.ceil(amount) - amount).toFixed(2);
  const base = change === 0 ? 1 : change; // whole-dollar buys still contribute $1
  return +(base * multiplier).toFixed(2);
}

// Live seam: verify + normalize a real Robinhood card webhook payload.
export function parseWebhook(body, secret) {
  if (secret && body?.secret !== secret) {
    throw new Error("card webhook signature mismatch");
  }
  return {
    id: body.id ?? `txn_${seq++}`,
    merchant: body.merchant ?? "Unknown",
    category: body.category ?? "uncategorized",
    amount: Number(body.amount),
    at: body.at ?? Date.now(),
  };
}
