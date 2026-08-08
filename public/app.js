// Olea dashboard controller. Runs the flywheel simulation in the browser
// (public/engine.js) and renders it in the modern theme. No backend.

import { Flywheel, CONFIG } from "./engine.js";

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => "$" + Math.round(Number(n)).toLocaleString("en-US");
const money4 = (n) => "$" + Number(n).toFixed(4);
const pct = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const fw = new Flywheel(CONFIG);
const history = [];
const ALLOC = ["#a4b56e", "#d8b26a", "#7fa0d0", "#b79bd6", "#8fbf9a"];
let autopilot = null;
let lastLogId = 0;

$("btnSpend").onclick = () => { fw.simulatePurchase(); render(); };
$("btnRepay").onclick = () => { fw.runRepayment(); render(); };
$("btnAuto").onclick = () => {
  const b = $("btnAuto");
  if (autopilot) { clearInterval(autopilot); autopilot = null; b.classList.remove("on"); b.textContent = "▶ Autopilot"; }
  else { autopilot = setInterval(() => { fw.simulatePurchase(); render(); }, 1800); b.classList.add("on"); b.textContent = "❚❚ Autopilot on"; }
};
window.__approve = (id, ok) => { fw.resolveApproval(id, ok); render(); };
setInterval(() => { fw.tick(1); render(); }, 1000);

// ---- charts ----
function drawLine(cv, data) {
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height, pad = 8;
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) return;
  let min = Math.min(...data), max = Math.max(...data);
  if (min === max) { min -= 1; max += 1; }
  const n = data.length;
  const X = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const Y = (v) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  const olive = css("--olive") || "#a4b56e";
  // gridlines
  ctx.strokeStyle = css("--line") || "rgba(255,255,255,.08)"; ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) { const y = pad + (g / 4) * (H - pad * 2); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); }
  // area fill
  const grad = ctx.createLinearGradient(0, pad, 0, H - pad);
  grad.addColorStop(0, "rgba(164,181,110,.32)"); grad.addColorStop(1, "rgba(164,181,110,0)");
  ctx.beginPath(); ctx.moveTo(X(0), H - pad);
  data.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
  ctx.lineTo(X(n - 1), H - pad); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  // line
  ctx.beginPath(); data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = olive; ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.stroke();
  // last dot
  ctx.beginPath(); ctx.arc(X(n - 1), Y(data[n - 1]), 3.2, 0, Math.PI * 2); ctx.fillStyle = olive; ctx.fill();
}

function drawDonut(cv, positions) {
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 6, r0 = r * 0.62;
  ctx.clearRect(0, 0, W, H);
  const total = positions.reduce((a, p) => a + p.value, 0);
  const legend = $("allocLegend");
  if (total <= 0) {
    ctx.lineWidth = r - r0; ctx.strokeStyle = css("--line-2") || "#333";
    ctx.beginPath(); ctx.arc(cx, cy, (r + r0) / 2, 0, Math.PI * 2); ctx.stroke();
    legend.innerHTML = `<span class="empty">No positions yet.</span>`;
    return;
  }
  let a = -Math.PI / 2; legend.innerHTML = "";
  positions.forEach((p, i) => {
    const frac = p.value / total, col = ALLOC[i % ALLOC.length], a2 = a + frac * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a2); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    a = a2;
    legend.innerHTML += `<div class="r"><span><span class="sw" style="background:${col}"></span>${p.ticker}</span><span>${(frac * 100).toFixed(0)}%</span></div>`;
  });
  ctx.fillStyle = css("--surface") || "#12150e"; ctx.beginPath(); ctx.arc(cx, cy, r0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css("--text") || "#fff"; ctx.textAlign = "center"; ctx.font = "700 16px " + css("--sans");
  ctx.fillText(money0(total), cx, cy + 5);
}

// ---- render ----
function flash(node) {
  const el = document.querySelector(`.tile[data-node="${node}"]`);
  if (!el) return; el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 480);
}

function render() {
  const s = fw.snapshot();
  $("mode").textContent = "Simulation";
  const gain = s.money.returnUsd >= 0;

  $("kFlywheel").textContent = money(s.money.flywheelValue);
  $("kReturn").textContent = (gain ? "+" : "−") + money(Math.abs(s.money.returnUsd));
  $("kReturn").className = "v num " + (gain ? "accent" : "down");
  $("kReturnSub").textContent = pct(s.money.returnPct);
  $("kReturnSub").className = "s " + (gain ? "accent" : "down");
  $("kCaptured").textContent = money(s.money.totalCaptured);
  $("kYield").textContent = money4(s.chain.yieldEarned);
  $("kApy").textContent = (s.chain.defiApy * 100).toFixed(1) + "% APY";
  $("kOffset").textContent = money(s.money.totalRepaid);

  $("bigVal").textContent = money(s.money.flywheelValue);
  $("bigDelta").textContent = `▲ ${money(s.money.returnUsd)} · ${pct(s.money.returnPct)} this session`;
  $("bigDelta").className = "ov-delta num " + (gain ? "accent" : "down");

  $("lSpend").textContent = money0(s.money.totalSpent);
  $("lMult").textContent = "×" + s.guardrails.roundUpMultiplier;
  $("lInvest").textContent = money0(s.money.totalInvested);
  $("lApy").textContent = (s.chain.defiApy * 100).toFixed(0) + "% APY";
  $("lRepay").textContent = money0(s.money.totalRepaid);
  $("txCount").textContent = s.txCount + " tx";

  const g = s.guardrails;
  $("guard").innerHTML = `
    <li><span>Round-up multiplier</span><b>×${g.roundUpMultiplier}</b></li>
    <li><span>Per-trade cap</span><b class="num">${money(g.perTradeCapUsd)}</b></li>
    <li><span>Daily invest cap</span><b class="num">${money(g.dailyInvestCapUsd)}</b></li>
    <li><span>Manual approval above</span><b class="num">${money(g.manualApprovalAboveUsd)}</b></li>
    <li><span>Min card buffer</span><b class="num">${money(g.minCardBufferUsd)}</b></li>`;

  const bn = s.basket; if ($("basketName")) $("basketName").textContent = bn; if ($("basketName2")) $("basketName2").textContent = bn;
  $("holdings").innerHTML = Object.keys(s.prices).map((tk) => {
    const p = s.chain.positions.find((x) => x.ticker === tk);
    return `<tr><td class="tk">${tk}</td><td>${money(s.prices[tk])}</td><td>${p ? p.shares.toFixed(3) : "0.000"}</td><td>${money(p ? p.value : 0)}</td></tr>`;
  }).join("");

  $("approvals").innerHTML = s.pendingApprovals.length
    ? s.pendingApprovals.map((a) => `<div class="appr"><p>${a.reason}</p><div class="r"><button class="btn btn-primary btn-sm" onclick="__approve('${a.id}',true)">Approve</button><button class="btn btn-sm" onclick="__approve('${a.id}',false)">Reject</button></div></div>`).join("")
    : `<p class="empty">Nothing waiting.</p>`;

  history.push(s.money.flywheelValue); if (history.length > 160) history.shift();
  drawLine($("lineCanvas"), history);
  drawDonut($("allocCanvas"), s.chain.positions);

  const newest = s.log[0];
  if (newest && newest.id !== lastLogId) {
    lastLogId = newest.id;
    if (newest.type === "spend") { flash("spend"); flash("roundup"); }
    if (newest.type === "invest") flash("invest");
    if (newest.type === "defi") flash("yield");
    if (newest.type === "repay") flash("repay");
  }
  $("log").innerHTML = s.log.map((e) => {
    const t = new Date(e.at).toLocaleTimeString();
    const tx = e.tx ? `<span class="tx">${e.tx.slice(0, 12)}…</span>` : "";
    return `<li class="${e.type}"><span class="d"></span><span>${e.text} ${tx}</span><span class="t">${t}</span></li>`;
  }).join("");
}

render();
