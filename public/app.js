// Live dashboard: subscribes to the server's SSE stream and renders the flywheel.

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money4 = (n) => "$" + Number(n).toFixed(4);

let lastLogId = 0;
let autopilotOn = false;

// ---- controls ------------------------------------------------------------
$("spendBtn").onclick = () => fetch("/api/spend", { method: "POST" });
$("repayBtn").onclick = () => fetch("/api/repay", { method: "POST" });
$("autopilotBtn").onclick = async () => {
  autopilotOn = !autopilotOn;
  await fetch("/api/autopilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ on: autopilotOn, intervalMs: 2200 }),
  });
  const b = $("autopilotBtn");
  b.textContent = autopilotOn ? "⏸ Autopilot on" : "▶ Autopilot";
  b.classList.toggle("on", autopilotOn);
};

function approve(id, ok) {
  fetch("/api/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, approve: ok }),
  });
}

// ---- rendering -----------------------------------------------------------
function flash(node) {
  const el = document.querySelector(`.node[data-node="${node}"]`);
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 700);
}

function render(s) {
  $("mode").textContent = s.mode;

  // KPIs
  $("netWorth").textContent = money(s.money.netWorth);
  $("netWorth").className = "kpi-value " + (s.money.netWorth >= 0 ? "up" : "down");
  $("portfolio").textContent = money(s.chain.portfolioValue);
  $("reserve").textContent = money(s.money.reserveBalance);
  $("yield").textContent = money4(s.chain.yieldEarned);
  $("card").textContent = money(s.money.cardBalance);

  // Flywheel nodes
  $("fSpent").textContent = money(s.money.totalSpent);
  $("fMult").textContent = "×" + s.guardrails.roundUpMultiplier;
  $("fInvested").textContent = money(s.money.totalInvested);
  $("fApy").textContent = (s.chain.defiApy * 100).toFixed(1) + "% APY";
  $("fRepaid").textContent = money(s.money.totalRepaid);

  // Guardrails
  const g = s.guardrails;
  $("guardrails").innerHTML = `
    <li><span>Round-up multiplier</span><b>×${g.roundUpMultiplier}</b></li>
    <li><span>Per-trade cap</span><b>${money(g.perTradeCapUsd)}</b></li>
    <li><span>Daily invest cap</span><b>${money(g.dailyInvestCapUsd)}</b></li>
    <li><span>Manual approval above</span><b>${money(g.manualApprovalAboveUsd)}</b></li>
    <li><span>Min card buffer</span><b>${money(g.minCardBufferUsd)}</b></li>`;

  // Basket / holdings
  $("basketName").textContent = s.basket;
  $("holdings").innerHTML = Object.keys(s.prices)
    .map((tk) => {
      const pos = s.chain.positions.find((p) => p.ticker === tk);
      return `<tr>
        <td class="tk">${tk}</td>
        <td>${money(s.prices[tk])}</td>
        <td>${pos ? pos.shares.toFixed(4) : "0.0000"}</td>
        <td>${money(pos ? pos.value : 0)}</td>
      </tr>`;
    })
    .join("");

  // Approvals
  const ap = $("approvals");
  if (!s.pendingApprovals.length) {
    ap.innerHTML = `<p class="empty">Nothing waiting.</p>`;
  } else {
    ap.innerHTML = s.pendingApprovals
      .map(
        (a) => `<div class="approval">
          <p>🔐 ${a.reason}</p>
          <div class="row">
            <button class="btn btn-primary" onclick="__approve('${a.id}',true)">Approve</button>
            <button class="btn" onclick="__approve('${a.id}',false)">Reject</button>
          </div>
        </div>`,
      )
      .join("");
  }

  // Activity log — flash flywheel nodes on new events
  const newest = s.log[0];
  if (newest && newest.id !== lastLogId) {
    lastLogId = newest.id;
    if (newest.type === "spend") flash("spend"), flash("roundup");
    if (newest.type === "invest") flash("invest");
    if (newest.type === "defi") flash("yield");
    if (newest.type === "repay") flash("repay");
  }
  $("log").innerHTML = s.log
    .map((e) => {
      const t = new Date(e.at).toLocaleTimeString();
      const tx = e.tx ? `<span class="tx">${e.tx.slice(0, 14)}…</span>` : "";
      return `<li class="${e.type}"><span>${e.text} ${tx}</span><span class="t">${t}</span></li>`;
    })
    .join("");
}

window.__approve = approve;

// ---- live stream ---------------------------------------------------------
function connect() {
  const es = new EventSource("/api/stream");
  es.onmessage = (ev) => render(JSON.parse(ev.data));
  es.onerror = () => {
    es.close();
    setTimeout(connect, 1500); // auto-reconnect
  };
}
connect();
