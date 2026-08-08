// Pixel dashboard controller. Runs the flywheel simulation in the browser
// (public/engine.js) and renders it in an 8-bit / arcade skin. No backend.

import { Flywheel, CONFIG } from "./engine.js";

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => "$" + Math.round(Number(n)).toLocaleString("en-US");
const money4 = (n) => "$" + Number(n).toFixed(4);
const pct = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";

const fw = new Flywheel(CONFIG);
const history = [];
const ALLOC = ["#7f9158", "#cdb46a", "#c07a55", "#8a9b6a", "#5f7048"];
let autopilot = null;
let lastLogId = 0;

// ---- controls ----
$("btnSpend").onclick = () => { fw.simulatePurchase(); render(); };
$("btnRepay").onclick = () => { fw.runRepayment(); render(); };
$("btnAuto").onclick = () => {
  const b = $("btnAuto");
  if (autopilot) {
    clearInterval(autopilot); autopilot = null;
    b.classList.remove("on"); b.textContent = "▸ AUTOPILOT";
  } else {
    autopilot = setInterval(() => { fw.simulatePurchase(); render(); }, 1800);
    b.classList.add("on"); b.textContent = "❚❚ AUTO ON";
  }
};
window.__approve = (id, ok) => { fw.resolveApproval(id, ok); render(); };

// heartbeat: prices + yield
setInterval(() => { fw.tick(1); render(); }, 1000);

// ---- pixel bar chart ----
function drawBars(cv, data) {
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height, pad = 6;
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) return;
  const n = Math.min(data.length, 48);
  const slice = data.slice(-n);
  let min = Math.min(...slice), max = Math.max(...slice);
  if (min === max) { min -= 1; max += 1; }
  const bw = Math.max(4, Math.floor((W - pad * 2) / n));
  const gap = Math.max(1, Math.floor(bw * 0.18));
  slice.forEach((v, i) => {
    const h = Math.round(((v - min) / (max - min)) * (H - pad * 2 - 6)) + 6;
    const x = pad + i * bw;
    const y = H - pad - h;
    ctx.fillStyle = "#55663a";
    ctx.fillRect(x, y, bw - gap, h);
    ctx.fillStyle = "#9fb374"; // bright pixel cap
    ctx.fillRect(x, y, bw - gap, 4);
  });
}

// ---- render ----
function flash(node) {
  const el = document.querySelector(`.tile[data-node="${node}"]`);
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 500);
}

function render() {
  const s = fw.snapshot();
  $("mode").textContent = s.mode.toUpperCase();

  const gain = s.money.returnUsd >= 0;
  $("kFlywheel").textContent = money(s.money.flywheelValue);
  $("kReturn").textContent = (gain ? "+" : "−") + money(Math.abs(s.money.returnUsd)).replace("$", "$");
  $("kReturn").className = "kval " + (gain ? "green" : "pink");
  $("kReturnSub").textContent = pct(s.money.returnPct);
  $("kCaptured").textContent = money(s.money.totalCaptured);
  $("kYield").textContent = money4(s.chain.yieldEarned);
  $("kApy").textContent = (s.chain.defiApy * 100).toFixed(1) + "% APY";
  $("kOffset").textContent = money(s.money.totalRepaid);

  $("bigVal").textContent = money(s.money.flywheelValue);
  $("bigDelta").textContent = `▲ ${money(s.money.returnUsd)} · ${pct(s.money.returnPct)} THIS SESSION`;
  $("bigDelta").className = "up " + (gain ? "green" : "pink");

  $("lSpend").textContent = money0(s.money.totalSpent);
  $("lMult").textContent = "×" + s.guardrails.roundUpMultiplier;
  $("lInvest").textContent = money0(s.money.totalInvested);
  $("lApy").textContent = (s.chain.defiApy * 100).toFixed(0) + "% APY";
  $("lRepay").textContent = money0(s.money.totalRepaid);
  $("txCount").textContent = s.txCount + " TX";

  const g = s.guardrails;
  $("guard").innerHTML = `
    <li><span>ROUND-UP</span><b>×${g.roundUpMultiplier}</b></li>
    <li><span>PER-TRADE CAP</span><b>${money(g.perTradeCapUsd)}</b></li>
    <li><span>DAILY CAP</span><b>${money(g.dailyInvestCapUsd)}</b></li>
    <li><span>APPROVAL ABOVE</span><b>${money(g.manualApprovalAboveUsd)}</b></li>
    <li><span>CARD BUFFER</span><b>${money(g.minCardBufferUsd)}</b></li>`;

  $("basketName").textContent = s.basket.toUpperCase();
  $("holdings").innerHTML = Object.keys(s.prices).map((tk) => {
    const p = s.chain.positions.find((x) => x.ticker === tk);
    return `<tr><td class="tk">${tk}</td><td>${money(s.prices[tk])}</td><td>${p ? p.shares.toFixed(3) : "0.000"}</td><td>${money(p ? p.value : 0)}</td></tr>`;
  }).join("");

  // allocation pixel bars
  const total = s.chain.portfolioValue || 1;
  $("alloc").innerHTML = s.chain.positions.map((p, i) => {
    const w = Math.max(0, (p.value / total) * 100);
    return `<div class="arow"><div class="t"><span class="tk">${p.ticker}</span><span>${w.toFixed(0)}%</span></div>
      <div class="abar"><span style="width:${w}%;background:${ALLOC[i % ALLOC.length]}"></span></div></div>`;
  }).join("") || `<p class="empty" style="color:var(--mut)">NO POSITIONS YET.</p>`;

  // approvals
  $("approvals").innerHTML = s.pendingApprovals.length
    ? s.pendingApprovals.map((a) => `<div class="appr"><p>${a.reason.toUpperCase()}</p>
        <div class="row"><button class="btn" onclick="__approve('${a.id}',true)">OK</button>
        <button class="btn alt" onclick="__approve('${a.id}',false)">NO</button></div></div>`).join("")
    : `<p class="empty">NOTHING WAITING.</p>`;

  // chart
  history.push(s.money.flywheelValue);
  if (history.length > 240) history.shift();
  drawBars($("barCanvas"), history);

  // flash loop tiles on new events
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
    const tx = e.tx ? `<span class="tx">${e.tx.slice(0, 10)}…</span>` : "";
    return `<li class="${e.type}"><span class="d"></span><span>${e.text} ${tx}</span><span class="t">${t}</span></li>`;
  }).join("");
}

render();
