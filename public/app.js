// Live dashboard: subscribes to the server's SSE stream and renders the flywheel.

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money4 = (n) => "$" + Number(n).toFixed(4);

let lastLogId = 0;
let autopilotOn = false;
const history = []; // { netWorth, invested } samples for the line chart
const ALLOC_COLORS = ["#00c805", "#6ea8fe", "#f3c14b", "#b58cff", "#ff8a5c", "#4dd0e1"];

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

// ---- charts (pure canvas, zero-dep) --------------------------------------
function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawLineChart(canvas, series) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, pad = 28;
  ctx.clearRect(0, 0, W, H);
  if (series[0].data.length < 2) return;

  const all = series.flatMap((s) => s.data);
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const pk = min < 0 && max > 0 ? 0 : null; // zero line if range straddles it

  const x = (i, n) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);

  // gridlines
  ctx.strokeStyle = css("--line"); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.stroke();
  if (pk !== null) {
    ctx.setLineDash([4, 4]); ctx.strokeStyle = css("--muted");
    ctx.beginPath(); ctx.moveTo(pad, y(0)); ctx.lineTo(W - pad, y(0)); ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const s of series) {
    const n = s.data.length;
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    s.data.forEach((v, i) => (i ? ctx.lineTo(x(i, n), y(v)) : ctx.moveTo(x(i, n), y(v))));
    ctx.stroke();
  }
  // last-value labels
  ctx.font = "11px system-ui"; ctx.textAlign = "right";
  for (const s of series) {
    const v = s.data[s.data.length - 1];
    ctx.fillStyle = s.color;
    ctx.fillText("$" + v.toFixed(0), W - pad - 2, y(v) - 4);
  }
}

function drawAllocation(canvas, positions) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) / 2 - 16, r0 = r * 0.58;
  ctx.clearRect(0, 0, W, H);
  const total = positions.reduce((a, p) => a + p.value, 0);
  const legend = document.getElementById("allocLegend");

  if (total <= 0) {
    ctx.strokeStyle = css("--line"); ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(cx, cy, (r + r0) / 2, 0, Math.PI * 2); ctx.stroke();
    legend.innerHTML = `<span class="empty">No positions yet.</span>`;
    return;
  }
  let a = -Math.PI / 2;
  legend.innerHTML = "";
  positions.forEach((p, i) => {
    const frac = p.value / total, col = ALLOC_COLORS[i % ALLOC_COLORS.length];
    const a2 = a + frac * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a, a2); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    a = a2;
    legend.innerHTML += `<span><i class="sw" style="background:${col}"></i>${p.ticker} ${(frac * 100).toFixed(0)}%</span>`;
  });
  // donut hole
  ctx.fillStyle = css("--panel-2");
  ctx.beginPath(); ctx.arc(cx, cy, r0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css("--text"); ctx.textAlign = "center"; ctx.font = "600 15px system-ui";
  ctx.fillText("$" + total.toFixed(0), cx, cy + 5);
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

  // Charts
  history.push({ netWorth: s.money.netWorth, invested: s.money.totalInvested });
  if (history.length > 120) history.shift();
  drawLineChart($("lineChart"), [
    { color: "#00c805", data: history.map((h) => h.netWorth) },
    { color: "#6ea8fe", data: history.map((h) => h.invested) },
  ]);
  drawAllocation($("allocChart"), s.chain.positions);

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
