// "기록" view: game results per song, best score, how it changed over time.

import { records, rankOf } from "./records.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const day = (t) => new Date(t).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
const TARGET = { beat: "코드 박마다", change: "코드 바뀔 때", pattern: "스트럼 패턴", melody: "멜로디" };
const MODE = { easy: "쉬움", std: "보통", pro: "어려움" };

export class Dashboard {
  constructor(root, { onLogin, onLogout }) {
    this.root = root;
    this.onLogin = onLogin;
    this.onLogout = onLogout;
    this.sel = null;
    root.addEventListener("click", (e) => {
      const row = e.target.closest("[data-song]");
      if (row) { this.sel = row.dataset.song; this.draw(); return; }
      const b = e.target.closest("[data-db]");
      if (!b) return;
      if (b.dataset.db === "login") this.onLogin();
      if (b.dataset.db === "logout") this.onLogout();
      if (b.dataset.db === "back") { this.sel = null; this.draw(); }
    });
  }

  async show(on) {
    this.root.hidden = !on;
    if (!on) return;
    this.root.innerHTML = `<p class="dr-desc">불러오는 중…</p>`;
    const d = await records.all();
    this.data = d;
    this.draw();
  }

  draw() {
    const { results, source, error } = this.data || { results: [] };
    const s = records.session();
    const who = s
      ? `<b>${esc(s.id)}</b> 계정에 저장 중 <button type="button" data-db="logout">로그아웃</button>`
      : `이 브라우저에만 저장 중 ${records.available() ? `<button type="button" class="primary" data-db="login">로그인하고 계정에 저장</button>` : ""}`;
    const head = `<div class="dr-head"><h2>게임 기록</h2><span class="sub">${who}</span></div>${error ? `<p class="hint">${esc(error)}</p>` : ""}`;
    if (!results.length) {
      this.root.innerHTML = `${head}<p class="dr-desc">아직 기록이 없음. 게임 모드로 한 곡을 끝까지 치면 여기에 쌓임.</p>`;
      return;
    }
    const songs = new Map();
    for (const r of results) {
      if (!songs.has(r.song)) songs.set(r.song, { song: r.song, title: r.title || r.song, artist: r.artist || "", plays: [] });
      songs.get(r.song).plays.push(r);
    }
    if (this.sel && songs.has(this.sel)) { this.root.innerHTML = head + this.detail(songs.get(this.sel)); this.hookChart(); return; }
    const weekAgo = Date.now() - 7 * 86400000;
    const best = Math.max(...results.map((r) => r.acc));
    const tiles = [
      ["플레이", `${results.length}번`], ["곡", `${songs.size}곡`],
      ["최근 7일", `${results.filter((r) => r.time >= weekAgo).length}번`], ["가장 높은 정확도", `${best}% (${rankOf(best)})`],
    ].map(([k, v]) => `<div class="db-tile"><small>${k}</small><b>${v}</b></div>`).join("");
    const rows = [...songs.values()].sort((a, b) => b.plays[b.plays.length - 1].time - a.plays[a.plays.length - 1].time).map((g) => {
      const p = g.plays;
      const top = p.reduce((a, b) => (b.score > a.score ? b : a));
      const first = p[0], last = p[p.length - 1];
      const delta = top.acc - first.acc;
      return `<tr data-song="${esc(g.song)}" tabindex="0">
        <td><b>${esc(g.title)}</b><small>${esc(g.artist)}</small></td>
        <td class="num">${p.length}</td>
        <td class="num"><span class="rk ${rankOf(top.acc)}">${rankOf(top.acc)}</span> ${top.score}점 · ${top.acc}%</td>
        <td class="num">${p.length > 1 ? `${first.acc}% → ${top.acc}% <span class="${delta > 0 ? "up" : ""}">${delta > 0 ? "+" : ""}${Math.round(delta * 10) / 10}</span>` : "한 번"}</td>
        <td class="num">${day(last.time)}</td>
        <td>${this.spark(p.map((x) => x.acc))}</td></tr>`;
    }).join("");
    this.root.innerHTML = `${head}<div class="db-tiles">${tiles}</div>
      <table class="db-table"><thead><tr><th>곡</th><th class="num">플레이</th><th class="num">최고</th><th class="num">처음 → 최고 정확도</th><th class="num">마지막</th><th>정확도 변화</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  spark(vals) {
    const W = 120, H = 28;
    if (vals.length < 2) return `<svg class="spark" width="${W}" height="${H}" aria-hidden="true"></svg>`;
    const x = (i) => 2 + (i / (vals.length - 1)) * (W - 4);
    const y = (v) => H - 3 - (v / 100) * (H - 6);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return `<svg class="spark" width="${W}" height="${H}" aria-label="정확도 ${vals.join(", ")}%"><polyline points="${pts}"/><circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="3"/></svg>`;
  }

  detail(g) {
    const p = g.plays;
    const W = 640, H = 220, L = 36, R = 12, T = 12, B = 28;
    const x = (i) => L + (p.length === 1 ? (W - L - R) / 2 : (i / (p.length - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / 100) * (H - T - B);
    const bands = [[95, "S"], [85, "A"], [70, "B"], [50, "C"]].map(([v, k]) =>
      `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="gt" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${k}</text>`).join("");
    const line = p.length > 1 ? `<polyline class="ln" points="${p.map((r, i) => `${x(i)},${y(r.acc)}`).join(" ")}"/>` : "";
    const dots = p.map((r, i) => `<circle class="pt" cx="${x(i)}" cy="${y(r.acc)}" r="5" data-i="${i}"/>`).join("");
    const axis = `<text class="gt" x="${L}" y="${H - 8}">${day(p[0].time)}</text><text class="gt" x="${W - R}" y="${H - 8}" text-anchor="end">${day(p[p.length - 1].time)}</text>`;
    const table = p.slice().reverse().map((r) => `<tr><td>${new Date(r.time).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</td>
      <td>${esc(TARGET[r.target] || r.target)} · ${esc(MODE[r.mode] || r.mode)}${r.rate && r.rate !== 1 ? ` · ${Math.round(r.rate * 100)}%` : ""}</td>
      <td class="num"><span class="rk ${rankOf(r.acc)}">${rankOf(r.acc)}</span> ${r.acc}%</td><td class="num">${r.score}</td><td class="num">${r.maxCombo}</td>
      <td class="num">${r.perfect}/${r.ok}/${r.bad}/${r.miss}</td></tr>`).join("");
    this.plays = p;
    return `<div class="dr-row"><button type="button" data-db="back">◀ 모든 곡</button><b>${esc(g.title)}</b> <span class="hint">${esc(g.artist)}</span></div>
      <div class="db-chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(g.title)} 정확도 변화">${bands}${line}${dots}${axis}</svg><div class="db-tip" hidden></div></div>
      <table class="db-table"><thead><tr><th>날짜</th><th>판정</th><th class="num">정확도</th><th class="num">점수</th><th class="num">최대 콤보</th><th class="num">P/O/B/M</th></tr></thead><tbody>${table}</tbody></table>`;
  }

  hookChart() {
    const wrap = this.root.querySelector(".db-chart");
    if (!wrap) return;
    const tip = wrap.querySelector(".db-tip");
    wrap.addEventListener("mousemove", (e) => {
      const c = e.target.closest(".pt");
      if (!c) { tip.hidden = true; return; }
      const r = this.plays[+c.dataset.i];
      tip.hidden = false;
      tip.innerHTML = `<b>${r.acc}%</b> ${r.score}점<br><small>${new Date(r.time).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small>`;
      const box = wrap.getBoundingClientRect();
      tip.style.left = `${e.clientX - box.left + 12}px`;
      tip.style.top = `${e.clientY - box.top - 10}px`;
    });
    wrap.addEventListener("mouseleave", () => { tip.hidden = true; });
  }
}
