// Dashboard controller. Runs the flywheel entirely in the browser (works on any
// static host) and renders it. No backend required.

import { Flywheel, CONFIG } from "./engine.js";

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money4 = (n) => "$" + Number(n).toFixed(4);
const pct = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const fw = new Flywheel(CONFIG);
const history = [];
const ALLOC_COLORS = ["#00c805", "#4d8dff", "#e3b341", "#a371f7", "#ff8a5c", "#4dd0e1"];

let autopilot = null;
let lastLogId = 0;

// ---- controls ------------------------------------------------------------
$("spendBtn").onclick = () => {
  fw.simulatePurchase();
  render();
};
$("repayBtn").onclick = () => {
  fw.runRepayment();
  render();
};
$("autopilotBtn").onclick = () => {
  const b = $("autopilotBtn");
  if (autopilot) {
    clearInterval(autopilot);
    autopilot = null;
    b.classList.remove("on");
    b.querySelector(".lbl").textContent = "Autopilot";
  } else {
    autopilot = setInterval(() => {
      fw.simulatePurchase();
      render();
    }, 2000);
    b.classList.add("on");
    b.querySelector(".lbl").textContent = "Autopilot on";
  }
};

window.__approve = (id, ok) => {
  fw.resolveApproval(id, ok);
  render();
};

// ---- heartbeat: move prices + accrue yield -------------------------------
setInterval(() => {
  fw.tick(1);
  render();
}, 1000);

// ---- charts --------------------------------------------------------------
function drawLine(canvas, series) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, pad = 30;
  ctx.clearRect(0, 0, W, H);
  if (series[0].data.length < 2) return;
  const all = series.flatMap((s) => s.data);
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const x = (i, n) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);

  ctx.strokeStyle = css("--line"); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.stroke();

  for (const s of series) {
    const n = s.data.length;
    // soft fill under the primary line
    if (s.fill) {
      const g = ctx.createLinearGradient(0, pad, 0, H - pad);
      g.addColorStop(0, s.color + "33");
      g.addColorStop(1, s.color + "00");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x(0, n), H - pad);
      s.data.forEach((v, i) => ctx.lineTo(x(i, n), y(v)));
      ctx.lineTo(x(n - 1, n), H - pad); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    s.data.forEach((v, i) => (i ? ctx.lineTo(x(i, n), y(v)) : ctx.moveTo(x(i, n), y(v))));
    ctx.stroke();
  }
  ctx.font = "600 11px system-ui"; ctx.textAlign = "right";
  for (const s of series) {
    const v = s.data[s.data.length - 1];
    ctx.fillStyle = s.color;
    ctx.fillText(money(v), W - pad - 2, Math.min(H - pad - 4, Math.max(12, y(v) - 6)));
  }
}

function drawAlloc(canvas, positions) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) / 2 - 14, r0 = r * 0.6;
  ctx.clearRect(0, 0, W, H);
  const total = positions.reduce((a, p) => a + p.value, 0);
  const legend = $("allocLegend");
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
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a2); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    a = a2;
    legend.innerHTML += `<span><i class="sw" style="background:${col}"></i>${p.ticker} ${(frac * 100).toFixed(0)}%</span>`;
  });
  ctx.fillStyle = css("--panel-2"); ctx.beginPath(); ctx.arc(cx, cy, r0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css("--text"); ctx.textAlign = "center"; ctx.font = "700 15px system-ui";
  ctx.fillText(money(total), cx, cy + 5);
}

// ---- render --------------------------------------------------------------
function flash(node) {
  const el = document.querySelector(`.node[data-node="${node}"]`);
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 650);
}

function render() {
  const s = fw.snapshot();
  $("mode").textContent = s.mode;

  const gain = s.money.returnUsd >= 0;
  $("flywheelValue").textContent = money(s.money.flywheelValue);
  $("return").textContent = (gain ? "+" : "−") + money(Math.abs(s.money.returnUsd)).slice(0);
  $("return").className = "kpi-value " + (gain ? "up" : "down");
  $("returnPct").textContent = pct(s.money.returnPct);
  $("returnPct").className = "kpi-sub " + (gain ? "up" : "down");
  $("captured").textContent = money(s.money.totalCaptured);
  $("yield").textContent = money4(s.chain.yieldEarned);
  $("apy").textContent = (s.chain.defiApy * 100).toFixed(1) + "% APY";
  $("offset").textContent = money(s.money.totalRepaid);

  $("fSpent").textContent = money(s.money.totalSpent);
  $("fMult").textContent = "×" + s.guardrails.roundUpMultiplier;
  $("fInvested").textContent = money(s.money.totalInvested);
  $("fApy").textContent = (s.chain.defiApy * 100).toFixed(1) + "% APY";
  $("fRepaid").textContent = money(s.money.totalRepaid);
  $("txCount").textContent = s.txCount + " tx";

  const g = s.guardrails;
  $("guardrails").innerHTML = `
    <li><span>Round-up multiplier</span><b>×${g.roundUpMultiplier}</b></li>
    <li><span>Per-trade cap</span><b>${money(g.perTradeCapUsd)}</b></li>
    <li><span>Daily invest cap</span><b>${money(g.dailyInvestCapUsd)}</b></li>
    <li><span>Manual approval above</span><b>${money(g.manualApprovalAboveUsd)}</b></li>
    <li><span>Min card buffer</span><b>${money(g.minCardBufferUsd)}</b></li>`;

  $("basketName").textContent = s.basket;
  $("holdings").innerHTML = Object.keys(s.prices)
    .map((tk) => {
      const p = s.chain.positions.find((x) => x.ticker === tk);
      return `<tr><td class="tk">${tk}</td><td>${money(s.prices[tk])}</td><td>${p ? p.shares.toFixed(4) : "0.0000"}</td><td>${money(p ? p.value : 0)}</td></tr>`;
    })
    .join("");

  const ap = $("approvals");
  ap.innerHTML = s.pendingApprovals.length
    ? s.pendingApprovals
        .map(
          (a) => `<div class="approval"><p>${a.reason}</p><div class="row">
            <button class="btn btn-primary sm" onclick="__approve('${a.id}',true)">Approve</button>
            <button class="btn sm" onclick="__approve('${a.id}',false)">Reject</button></div></div>`,
        )
        .join("")
    : `<p class="empty">Nothing waiting.</p>`;

  history.push({ v: s.money.flywheelValue, c: s.money.netContributed });
  if (history.length > 140) history.shift();
  drawLine($("lineChart"), [
    { color: "#4d8dff", data: history.map((h) => h.c) },
    { color: "#00c805", data: history.map((h) => h.v), fill: true },
  ]);
  drawAlloc($("allocChart"), s.chain.positions);

  const newest = s.log[0];
  if (newest && newest.id !== lastLogId) {
    lastLogId = newest.id;
    if (newest.type === "spend") { flash("spend"); flash("roundup"); }
    if (newest.type === "invest") flash("invest");
    if (newest.type === "defi") flash("yield");
    if (newest.type === "repay") flash("repay");
  }
  $("log").innerHTML = s.log
    .map((e) => {
      const t = new Date(e.at).toLocaleTimeString();
      const tx = e.tx ? `<span class="tx">${e.tx.slice(0, 12)}…</span>` : "";
      return `<li class="${e.type}"><span class="ldot"></span><span class="ltext">${e.text} ${tx}</span><span class="t">${t}</span></li>`;
    })
    .join("");
}

render();
