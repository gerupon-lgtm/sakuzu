// サクズ 試作α（SZ-0.1.0）
import { APP_VERSION } from "../version.js";
import { createDrawing, SCHEMA_VERSION } from "../model/document.js";
import { addPolar, addCircles, defaultRef, deletePoint, collectDependents } from "../model/edit.js";
import { solve, misclosure, suspectEdges, usable } from "../model/solver.js";
import { createHistory } from "../model/history.js";
import { formatLength, roundHalfUp } from "../shared/round.js";
import { dist } from "../shared/geometry.js";

// ---------- 保存（IndexedDB。使えなければメモリ） ----------
const store = (() => {
  const mem = { drawings: new Map(), prefs: {} };
  let dbp = null;
  try {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("sakuzu", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("drawings", { keyPath: "id" }); r.result.createObjectStore("prefs"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }).catch(() => null);
  } catch { dbp = Promise.resolve(null); }
  const tx = async (name, mode, fn) => {
    const db = await dbp; if (!db) return fn(null);
    return new Promise((res, rej) => { const t = db.transaction(name, mode); const r = fn(t.objectStore(name)); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); });
  };
  return {
    all: async () => (await tx("drawings", "readonly", (s) => s ? s.getAll() : null)) ?? [...mem.drawings.values()],
    put: async (d) => { mem.drawings.set(d.id, d); try { await tx("drawings", "readwrite", (s) => s?.put(d)); return true; } catch { return false; } },
    del: async (id) => { mem.drawings.delete(id); await tx("drawings", "readwrite", (s) => s?.delete(id)); },
    getPrefs: async () => (await tx("prefs", "readonly", (s) => s ? s.get("defaults") : null)) ?? mem.prefs,
    putPrefs: async (p) => { mem.prefs = p; await tx("prefs", "readwrite", (s) => s?.put(p, "defaults")); },
  };
})();

// ---------- 状態 ----------
const S = {
  view: "list", drawings: [], doc: null, pts: new Map(), prefs: { tolCm: 3, unit: "m" },
  tab: "add", mode: "polar", form: {}, active: "from", vt: { cx: 0, cy: 0, k: 60 },
  highlight: [], msg: null, lineDraft: null, panelMin: false,
};
const hist = createHistory(50);
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tol = () => S.prefs.tolCm / 100;
const labelOf = (id) => S.doc.steps.find((s) => s.id === id)?.label ?? "?";
const jst = (iso) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const MSG = {
  CIRCLE_NO_INTERSECTION: (g) => `円が交わりません（あと${roundHalfUp(g * 100, 1)}cm足りません）`,
  CIRCLE_SAME_CENTER: () => "2つの点が同じ位置です",
  POLAR_BAD_DISTANCE: () => "距離は0より大きい値を入れてください",
  POLAR_BAD_ANGLE: () => "角度は0〜180°で入れてください",
};
const msgOf = (p) => (MSG[p.code] ? MSG[p.code](p.gap) : p.code);

// 確認・入力ダイアログ（ブラウザ標準の confirm/prompt は使わない）
function modal(text, withInput = false, value = "") {
  return new Promise((res) => {
    const d = document.createElement("dialog");
    d.innerHTML = `<p>${esc(text)}</p>${withInput ? `<input type="text" value="${esc(value)}" style="width:100%;padding:6px">` : ""}<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" value="0">キャンセル</button><button class="btn primary" value="1">OK</button></div>`;
    document.body.appendChild(d);
    d.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const ok = b.value === "1"; const v = d.querySelector("input")?.value; d.close(); d.remove(); res(withInput ? (ok ? v : null) : ok); });
    d.showModal();
  });
}
let saveTimer = null;
function touch(pushHistory = true, before = null) {
  if (pushHistory && before) hist.push(before);
  S.doc.updatedAt = new Date().toISOString();
  S.pts = solve(S.doc, tol());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { if (!(await store.put(S.doc))) S.msg = { cls: "err", text: "端末への保存に失敗しました。作業ファイルを書き出してください" }; }, 500);
}
const snap = () => JSON.parse(JSON.stringify(S.doc));

// ---------- 図面の一覧 ----------
async function openList() {
  S.view = "list"; S.drawings = (await store.all()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); render();
}
function openDoc(doc) {
  S.doc = doc; S.view = "editor"; hist.clear(); S.highlight = []; S.msg = null; S.lineDraft = null;
  S.pts = solve(doc, tol()); resetForm(); render(); requestAnimationFrame(fit);
}
function resetForm() {
  const last = [...S.doc.steps].reverse().find((s) => usable(S.pts.get(s.id)));
  const from = last?.id ?? S.doc.steps[0]?.id;
  S.form = { from, ref: from ? defaultRef(S.doc, from) : null, turn: "S", angle: 90, d: "", closing: false, a: null, da: "", b: null, db: "" };
  if (S.form.ref) S.form.turn = "R";
  S.active = S.mode === "polar" ? "from" : "a";
}

// ---------- 描画 ----------
function render() {
  const head = `<header><div class="logo">サ</div><h1>サクズ</h1><span class="sp"></span>${S.view === "editor" ? `<button class="btn sm" data-act="back">一覧</button>` : ""}</header>`;
  const foot = `<footer>${APP_VERSION} ・ © 2026 SIKUMI LAB</footer>`;
  $app.innerHTML = head + `<main>${S.view === "list" ? listHtml() : editorHtml()}</main>` + foot;
  if (S.view === "editor") { drawSvg(); bindCanvas(); }
}
function listHtml() {
  const cards = S.drawings.map((d) => `<div class="card"><div class="t"><div class="n">${esc(d.name)}</div><div class="d">更新 ${jst(d.updatedAt)} ・ ${d.steps.length}点</div></div>
   <button class="btn sm primary" data-act="open" data-id="${d.id}">開く</button>
   <button class="btn sm" data-act="dup" data-id="${d.id}">複製</button>
   <button class="btn sm" data-act="rename" data-id="${d.id}">名前</button>
   <button class="btn sm" data-act="export" data-id="${d.id}">書出</button>
   <button class="btn sm danger" data-act="del" data-id="${d.id}">削除</button></div>`).join("");
  return `<div class="list"><div class="row"><button class="btn primary" data-act="new">＋ 新しい図面</button>
   <label class="btn">ファイルを読み込む<input type="file" accept=".json,application/json" data-act="import" hidden></label>
   <button class="btn" data-act="share">アプリを共有</button></div>
   ${S.msg ? `<div class="msg ${S.msg.cls || ""}">${esc(S.msg.text)}</div>` : ""}
   ${cards || `<p class="note">まだ図面がありません。「新しい図面」から始めてください。</p>`}</div>`;
}
function editorHtml() {
  return `<div class="editor"><div class="canvas" id="cv"><svg id="svg"></svg>
   <div class="float"><button class="btn sm" data-act="undo" ${hist.canUndo ? "" : "disabled"}>元に戻す</button><button class="btn sm" data-act="redo" ${hist.canRedo ? "" : "disabled"}>やり直す</button><button class="btn sm" data-act="fit">全体</button></div></div>
   <div class="panel ${S.panelMin ? "min" : ""}"><div class="grab" data-act="grab"></div>
   <div class="tabs">${[["add", "追加"], ["steps", "手順"], ["elems", "図面要素"]].map(([k, t]) => `<button class="${S.tab === k ? "on" : ""}" data-act="tab" data-tab="${k}">${t}</button>`).join("")}</div>
   <div class="pbody">${S.msg ? `<div class="msg ${S.msg.cls || ""}">${S.msg.html ?? esc(S.msg.text)}</div>` : ""}${S.tab === "add" ? addHtml() : S.tab === "steps" ? stepsHtml() : elemsHtml()}</div></div></div>`;
}
const pick = (field, id) => `<button class="pick ${S.active === field ? "active" : ""}" data-act="active" data-field="${field}">${id ? labelOf(id) : "未選択"}</button>`;
function addHtml() {
  const f = S.form;
  const pending = S.doc.steps.find((s) => s.type === "circles" && !s.side && S.pts.get(s.id)?.status === "pending");
  if (pending) return `<p><b>${pending.label}</b> の候補を選んでください（図の上の点をタップしても選べます）</p>
    <div class="row"><button class="btn" style="border-color:var(--candL)" data-act="side" data-side="L">左の候補</button><button class="btn" style="border-color:var(--candR)" data-act="side" data-side="R">右の候補</button><button class="btn danger" data-act="cancelPending">取り消す</button></div>`;
  const mode = `<div class="row"><div class="seg"><button class="${S.mode === "polar" ? "on" : ""}" data-act="mode" data-mode="polar">距離と方向</button><button class="${S.mode === "circles" ? "on" : ""}" data-act="mode" data-mode="circles">二円交点</button></div></div>`;
  if (S.mode === "polar") {
    const refTxt = f.ref ? `${labelOf(f.ref[0])}→${labelOf(f.ref[1])}` : "なし（右向きを0°）";
    return mode + `<p class="note">入力欄を選んでから、図の点をタップすると入ります。</p>
     <div class="row"><label>元の点</label>${pick("from", f.from)}</div>
     <div class="row"><label>基準の辺</label><span>${refTxt}</span><button class="btn sm ${S.active === "refA" || S.active === "refB" ? "on" : ""}" data-act="active" data-field="refA">辺を選ぶ</button><button class="btn sm" data-act="refClear">なし</button></div>
     <div class="row"><label>曲がる</label><div class="seg">${[["L", "左"], ["S", "直進"], ["R", "右"]].map(([k, t]) => `<button class="${f.turn === k ? "on" : ""}" data-act="turn" data-turn="${k}">${t}</button>`).join("")}</div></div>
     <div class="row"><label>角度</label><input type="number" inputmode="decimal" data-f="angle" value="${f.angle}" ${f.turn === "S" ? "disabled" : ""}>°<button class="btn sm" data-act="a90">90°</button></div>
     <div class="row"><label>距離</label><input type="number" inputmode="decimal" step="0.001" data-f="d" value="${f.d}" placeholder="m">m</div>
     <div class="row"><label></label><label style="min-width:0"><input type="checkbox" data-f="closing" ${f.closing ? "checked" : ""}> 最終点（この辺で最初の点に戻して閉じる）</label></div>
     <div class="row"><button class="btn primary" data-act="addPolar">追加</button><button class="btn" data-act="closeLine">ここで閉じる（測っていない）</button></div>`;
  }
  return mode + `<p class="note">入力欄を選んでから、図の点をタップすると入ります。</p>
   <div class="row"><label>点A</label>${pick("a", f.a)}<label style="min-width:0">距離a</label><input type="number" inputmode="decimal" step="0.001" data-f="da" value="${f.da}">m</div>
   <div class="row"><label>点B</label>${pick("b", f.b)}<label style="min-width:0">距離b</label><input type="number" inputmode="decimal" step="0.001" data-f="db" value="${f.db}">m</div>
   <div class="row"><button class="btn primary" data-act="addCircles">計算する</button><span class="note">許容値 ${S.prefs.tolCm}cm</span></div>`;
}
function stepsHtml() {
  return `<div class="steps">` + S.doc.steps.map((s) => {
    const p = S.pts.get(s.id) || {};
    const badge = p.status === "ok" ? "" : `<span class="badge ${p.status}">${{ warn: `接点扱い ${roundHalfUp((p.gap || 0) * 100, 1)}cm`, error: "エラー", blocked: "計算できない", pending: "候補を選ぶ" }[p.status] || ""}</span>`;
    let body = "";
    if (s.type === "base") body = `基準点`;
    if (s.type === "polar") body = `${labelOf(s.from)}から ${{ L: "左", R: "右", S: "直進" }[s.turn]} <input type="number" data-step="${s.id}" data-k="angleDeg" value="${s.angleDeg}" style="width:60px">° <input type="number" step="0.001" data-step="${s.id}" data-k="d" value="${s.d}" style="width:76px">m${s.isClosing ? "（閉合の確認）" : ""}`;
    if (s.type === "circles") body = `${labelOf(s.a)}から<input type="number" step="0.001" data-step="${s.id}" data-k="da" value="${s.da}" style="width:70px">m・${labelOf(s.b)}から<input type="number" step="0.001" data-step="${s.id}" data-k="db" value="${s.db}" style="width:70px">m ${s.side ? `<button class="btn sm" data-act="flip" data-id="${s.id}">${s.side === "L" ? "左" : "右"}⇄</button>` : ""}`;
    const err = p.status === "error" ? `<div class="msg err">${esc(msgOf(p))}</div>` : "";
    return `<div class="st"><div class="h"><span class="lb">${s.label}</span>${badge}<span class="sp" style="flex:1"></span>${s.type !== "base" ? `<button class="btn sm danger" data-act="delPt" data-id="${s.id}">削除</button>` : ""}</div><div class="note" style="color:var(--fg)">${body}</div>${err}</div>`;
  }).join("") + `</div>`;
}
function elemsHtml() {
  const lines = S.doc.lines.map((l, i) => {
    const m = misclosure(S.doc, S.pts, l);
    return `<div class="st"><div class="h"><span class="lb">線${i + 1}</span><span class="note">${l.points.map(labelOf).join("→")}${l.closed ? "→閉" : ""}</span></div>${m ? `<div class="note">閉合のずれ ${m.none ? "なし" : roundHalfUp(m.len * 100, 1) + "cm"}</div>` : ""}</div>`;
  }).join("") || `<p class="note">線はまだありません。「距離と方向」で点を追加すると、自動で線が引かれます。</p>`;
  return `<div class="row"><button class="btn ${S.lineDraft ? "on" : ""}" data-act="lineMode">${S.lineDraft ? "線を引いています（最初の点で閉じる）" : "点をつないで線を引く"}</button>${S.lineDraft ? `<button class="btn sm" data-act="lineDone">完了</button>` : ""}</div>${lines}
   <h4>設定</h4>
   <div class="row"><label>図面名</label><input type="text" data-set="name" value="${esc(S.doc.name)}" style="width:180px"></div>
   <div class="row"><label>表示単位</label><div class="seg">${[["m", "m"], ["mm", "mm"]].map(([k, t]) => `<button class="${S.doc.sheet.unit === k ? "on" : ""}" data-act="unit" data-unit="${k}">${t}</button>`).join("")}</div></div>
   <div class="row"><label>許容値</label><input type="number" step="0.1" min="0" max="10" data-set="tol" value="${S.prefs.tolCm}">cm（二円交点）</div>
   <p class="note">部屋・道路・文字・北の記号・図面の印刷は、次の版で追加します。</p>`;
}

// ---------- SVG ----------
const toScr = (p) => { const r = svgRect(); return { x: (p.x - S.vt.cx) * S.vt.k + r.width / 2, y: r.height / 2 - (p.y - S.vt.cy) * S.vt.k }; };
const toWorld = (x, y) => { const r = svgRect(); return { x: (x - r.width / 2) / S.vt.k + S.vt.cx, y: (r.height / 2 - y) / S.vt.k + S.vt.cy }; };
const svgRect = () => document.getElementById("svg")?.getBoundingClientRect() ?? { width: 300, height: 300, left: 0, top: 0 };
function fit() {
  const ps = [...S.pts.values()].filter(usable);
  if (!ps.length) return;
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y), r = svgRect();
  const w = Math.max(...xs) - Math.min(...xs) || 1, h = Math.max(...ys) - Math.min(...ys) || 1;
  S.vt.cx = (Math.max(...xs) + Math.min(...xs)) / 2; S.vt.cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  S.vt.k = Math.min(r.width / (w * 1.5), r.height / (h * 1.5), 400); drawSvg();
}
function ensureVisible() {
  const r = svgRect(); const m = 24;
  const out = [...S.pts.values()].filter(usable).some((p) => { const q = toScr(p); return q.x < m || q.y < m || q.x > r.width - m || q.y > r.height - m; });
  if (out) fit();
}
function drawSvg() {
  const svg = document.getElementById("svg"); if (!svg) return;
  const P = (id) => S.pts.get(id); let g = "";
  const unit = S.doc.sheet.unit;
  // 補助線（二円交点の距離。印刷しない）
  for (const s of S.doc.steps) if (s.type === "circles" && usable(P(s.id))) for (const k of ["a", "b"]) if (usable(P(s[k]))) { const a = toScr(P(s[k])), b = toScr(P(s.id)); g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#9aa" stroke-dasharray="4 4"/>`; }
  // 線
  for (const l of S.doc.lines) {
    const ps = l.points.map(P); if (ps.some((p) => !usable(p))) continue;
    const d = ps.map(toScr).map((p) => `${p.x},${p.y}`).join(" ");
    g += l.closed ? `<polygon points="${d}" fill="rgba(47,111,222,.06)" stroke="#1d2430" stroke-width="2"/>` : `<polyline points="${d}" fill="none" stroke="#1d2430" stroke-width="2"/>`;
  }
  for (const [a, b] of S.highlight) if (usable(P(a)) && usable(P(b))) { const p = toScr(P(a)), q = toScr(P(b)); g += `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="#c62828" stroke-width="6" opacity=".5"/>`; }
  // 寸法
  for (const dm of S.doc.dims) {
    const a = P(dm.a), b = P(dm.b); if (!usable(a) || !usable(b)) continue;
    const L = dist(a, b); if (L < 1e-9) continue;
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    const m = toScr({ x: (a.x + b.x) / 2 + nx * dm.offset * 0.5, y: (a.y + b.y) / 2 + ny * dm.offset * 0.5 });
    let ang = -Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    g += `<text x="${m.x}" y="${m.y}" font-size="12" text-anchor="middle" dominant-baseline="middle" transform="rotate(${ang} ${m.x} ${m.y})" fill="#2f6fde" stroke="#fff" stroke-width="3" paint-order="stroke">${formatLength(L, unit)}</text>`;
  }
  // 線を引いている途中
  if (S.lineDraft?.length) { const d = S.lineDraft.map(P).filter(usable).map(toScr).map((p) => `${p.x},${p.y}`).join(" "); g += `<polyline points="${d}" fill="none" stroke="#2f6fde" stroke-width="2" stroke-dasharray="6 4"/>`; }
  // 点
  for (const s of S.doc.steps) {
    const p = P(s.id);
    if (p?.status === "pending") for (const k of ["L", "R"]) { const q = toScr(p.candidates[k]); g += `<circle cx="${q.x}" cy="${q.y}" r="10" fill="${k === "L" ? "#e07a1f" : "#7b3fd0"}" opacity=".85"/><text x="${q.x}" y="${q.y - 14}" font-size="12" text-anchor="middle">${k === "L" ? "左" : "右"}</text>`; }
    if (!usable(p) || s.isClosing) continue;
    const q = toScr(p); const sel = [S.form.from, S.form.a, S.form.b].includes(s.id);
    g += `<circle cx="${q.x}" cy="${q.y}" r="${sel ? 7 : 5}" fill="${p.status === "warn" ? "#c27c0e" : sel ? "#2f6fde" : "#1d2430"}"/><text x="${q.x + 8}" y="${q.y - 8}" font-size="12" fill="#555">${s.label}</text>`;
  }
  svg.innerHTML = g;
}

// ---------- 図の操作（移動・拡大・タップ） ----------
function bindCanvas() {
  const el = document.getElementById("cv"); const ptrs = new Map(); let moved = false, pinch = null, start = null;
  el.addEventListener("pointerdown", (e) => { if (e.target.closest(".float")) return; el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; start = { x: e.clientX, y: e.clientY, cx: S.vt.cx, cy: S.vt.cy };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: S.vt.k }; } });
  el.addEventListener("pointermove", (e) => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; S.vt.k = Math.max(2, Math.min(2000, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); moved = true; drawSvg(); return; }
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) moved = true;
    if (moved && ptrs.size === 1) { S.vt.cx = start.cx - (e.clientX - start.x) / S.vt.k; S.vt.cy = start.cy + (e.clientY - start.y) / S.vt.k; drawSvg(); } });
  const up = (e) => { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!moved && ptrs.size === 0) { const r = svgRect(); onTap(e.clientX - r.left, e.clientY - r.top); } };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", (e) => ptrs.delete(e.pointerId));
  el.addEventListener("wheel", (e) => { e.preventDefault(); const r = svgRect(); const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    S.vt.k = Math.max(2, Math.min(2000, S.vt.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); const w2 = toWorld(e.clientX - r.left, e.clientY - r.top);
    S.vt.cx += w.x - w2.x; S.vt.cy += w.y - w2.y; drawSvg(); }, { passive: false });
}
function hitPoint(x, y) {
  let best = null, bd = 24;
  for (const s of S.doc.steps) { const p = S.pts.get(s.id); if (!usable(p) || s.isClosing) continue; const q = toScr(p); const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = s.id; } }
  return best;
}
function onTap(x, y) {
  const pend = S.doc.steps.find((s) => s.type === "circles" && !s.side && S.pts.get(s.id)?.status === "pending");
  if (pend) { const c = S.pts.get(pend.id).candidates; for (const k of ["L", "R"]) { const q = toScr(c[k]); if (Math.hypot(q.x - x, q.y - y) < 24) return chooseSide(pend, k); } }
  const id = hitPoint(x, y); if (!id) return;
  if (S.lineDraft) {
    if (S.lineDraft[0] === id && S.lineDraft.length >= 3) { const before = snap(); S.doc.lines.push({ id: crypto.randomUUID?.() ?? String(Date.now()), points: S.lineDraft, closed: true }); S.lineDraft = null; touch(true, before); return render(); }
    if (!S.lineDraft.includes(id)) S.lineDraft.push(id); return drawSvg();
  }
  if (S.tab !== "add") { S.tab = "add"; }
  const f = S.form;
  if (S.active === "refA") { f.refA = id; S.active = "refB"; S.msg = { text: "基準の辺の終点をタップしてください" }; return render(); }
  if (S.active === "refB") { f.ref = [f.refA, id]; S.active = "from"; S.msg = null; if (f.turn === "S") f.turn = "R"; return render(); }
  if (S.active === "from") { f.from = id; f.ref = defaultRef(S.doc, id); }
  else if (S.active === "a") { f.a = id; S.active = "b"; return render(); }
  else if (S.active === "b") { f.b = id; }
  render();
}
function chooseSide(step, side) {
  const before = snap(); const s = S.doc.steps.find((x) => x.id === step.id); s.side = side; touch(true, before);
  const p = S.pts.get(s.id); S.msg = p.status === "warn" ? { cls: "warn", text: `接する点として扱いました（隙間 ${roundHalfUp(p.gap * 100, 1)}cm）` } : null;
  S.mode = "polar"; resetForm(); S.form.from = s.id; S.form.ref = [s.a, s.id]; render(); ensureVisible();
}

// ---------- 操作 ----------
const num = (v) => (v === "" || v == null ? NaN : Number(String(v).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
$app.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]"); if (!t || t.tagName === "INPUT") return;
  const act = t.dataset.act, id = t.dataset.id, f = S.form;
  const find = (x) => S.drawings.find((d) => d.id === x);
  switch (act) {
    case "new": { const d = createDrawing(`図面 ${S.drawings.length + 1}`); await store.put(d); return openDoc(d); }
    case "open": return openDoc(structuredClone(find(id)));
    case "dup": { const d = structuredClone(find(id)); d.id = crypto.randomUUID?.() ?? String(Date.now()); d.name += "（コピー）"; d.updatedAt = new Date().toISOString(); await store.put(d); return openList(); }
    case "rename": { const n = await modal("図面の名前", true, find(id).name); if (n) { const d = find(id); d.name = n; await store.put(d); } return openList(); }
    case "del": if (await modal(`「${find(id).name}」を削除します。端末の中では元に戻せません。`)) { await store.del(id); } return openList();
    case "export": { const d = find(id); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: "application/json" })); a.download = `${d.name}.sakuzu.json`; a.click(); return; }
    case "share": { const url = location.origin + location.pathname; try { if (navigator.share) await navigator.share({ title: "サクズ", url }); else { await navigator.clipboard.writeText(url); S.msg = { text: "URLをコピーしました" }; render(); } } catch { S.msg = { text: url }; render(); } return; }
    case "back": clearTimeout(saveTimer); await store.put(S.doc); S.msg = null; return openList();
    case "tab": S.tab = t.dataset.tab; S.panelMin = false; return render();
    case "grab": S.panelMin = !S.panelMin; return render();
    case "mode": S.mode = t.dataset.mode; resetForm(); return render();
    case "active": S.active = t.dataset.field; if (S.active === "refA") S.msg = { text: "基準の辺の始点をタップしてください" }; return render();
    case "refClear": f.ref = null; return render();
    case "turn": f.turn = t.dataset.turn; return render();
    case "a90": f.angle = 90; if (f.turn === "S") f.turn = "R"; return render();
    case "fit": return fit();
    case "undo": case "redo": { const d = act === "undo" ? hist.undo(S.doc) : hist.redo(S.doc); if (d) { S.doc = d; touch(false); resetForm(); S.highlight = []; render(); } return; }
    case "addPolar": {
      const d = num(f.d), ang = f.turn === "S" ? 0 : num(f.angle);
      if (!f.from) { S.msg = { cls: "err", text: "元の点を選んでください" }; return render(); }
      if (!(d > 0)) { S.msg = { cls: "err", text: MSG.POLAR_BAD_DISTANCE() }; return render(); }
      if (!(ang >= 0 && ang <= 180)) { S.msg = { cls: "err", text: MSG.POLAR_BAD_ANGLE() }; return render(); }
      const before = snap(); const st = addPolar(S.doc, { from: f.from, ref: f.ref, turn: f.turn, angleDeg: ang, d: roundHalfUp(d, 3), closing: f.closing }); touch(true, before);
      S.msg = null; S.highlight = [];
      if (f.closing) { const line = S.doc.lines.find((l) => l.closure?.stepId === st.id); const m = misclosure(S.doc, S.pts, line);
        if (m && !m.none) { S.msg = { cls: "warn", html: `閉合のずれ <b>${roundHalfUp(m.len * 100, 1)}cm</b>（向き ${Math.round(Math.atan2(m.v.y, m.v.x) * 180 / Math.PI)}°）<div class="row" style="margin-top:6px"><button class="btn sm" data-act="clKeep" data-id="${line.id}">そのまま閉じる</button><button class="btn sm" data-act="clHint" data-id="${line.id}">測り直す箇所の目安</button><button class="btn sm danger" data-act="undo">取り消す</button></div>` }; }
        else { line.closure.choice = "keep"; S.msg = { text: "ずれなしで閉じました" }; } }
      resetForm(); render(); ensureVisible(); return;
    }
    case "clKeep": { const l = S.doc.lines.find((x) => x.id === id); l.closure.choice = "keep"; S.msg = { text: "そのまま閉じました" }; S.highlight = []; touch(false); return render(); }
    case "clHint": { const l = S.doc.lines.find((x) => x.id === id); const m = misclosure(S.doc, S.pts, l); S.highlight = suspectEdges(S.pts, l, m.v); S.msg = { ...S.msg }; drawSvg(); return; }
    case "closeLine": { const l = S.doc.lines.find((x) => !x.closed && x.points.at(-1) === f.from); if (!l || l.points.length < 3) { S.msg = { cls: "err", text: "閉じられる線がありません（3点以上の線の最後の点を選んでください）" }; return render(); } const before = snap(); l.closed = true; touch(true, before); S.msg = { text: "閉じました" }; return render(); }
    case "addCircles": {
      const da = num(f.da), db = num(f.db);
      if (!f.a || !f.b) { S.msg = { cls: "err", text: "点Aと点Bを選んでください" }; return render(); }
      if (!(da > 0 && db > 0)) { S.msg = { cls: "err", text: MSG.POLAR_BAD_DISTANCE() }; return render(); }
      const before = snap(); const st = addCircles(S.doc, { a: f.a, da: roundHalfUp(da, 3), b: f.b, db: roundHalfUp(db, 3) }); touch(true, before);
      const p = S.pts.get(st.id);
      if (p.status === "error") { S.doc.steps.pop(); touch(false); S.msg = { cls: "err", text: msgOf(p) }; }
      else S.msg = p.gap > 0 ? { cls: "warn", text: `接する点として扱います（隙間 ${roundHalfUp(p.gap * 100, 1)}cm）` } : null;
      render(); ensureVisible(); return;
    }
    case "side": { const s = S.doc.steps.find((x) => x.type === "circles" && !x.side); return chooseSide(s, t.dataset.side); }
    case "cancelPending": { S.doc.steps = S.doc.steps.filter((x) => !(x.type === "circles" && !x.side)); touch(false); return render(); }
    case "flip": { const before = snap(); const s = S.doc.steps.find((x) => x.id === id); s.side = s.side === "L" ? "R" : "L"; touch(true, before); return render(); }
    case "delPt": { const { points } = collectDependents(S.doc, id); if (!(await modal(points.size > 1 ? `この点を削除すると、ほかに ${points.size - 1} 個の点も削除されます。よろしいですか？` : "この点を削除します。よろしいですか？"))) return; const before = snap(); deletePoint(S.doc, id); touch(true, before); resetForm(); return render(); }
    case "lineMode": S.lineDraft = S.lineDraft ? null : []; return render();
    case "lineDone": { if (S.lineDraft?.length >= 2) { const before = snap(); S.doc.lines.push({ id: crypto.randomUUID?.() ?? String(Date.now()), points: S.lineDraft, closed: false }); touch(true, before); } S.lineDraft = null; return render(); }
    case "unit": { const before = snap(); S.doc.sheet.unit = t.dataset.unit; touch(true, before); return render(); }
  }
});
$app.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.act === "import") {
    const file = t.files[0]; if (!file) return;
    try { const d = JSON.parse(await file.text());
      if (d.appId !== "sakuzu") throw new Error("このファイルはサクズのものではありません");
      if (!(d.schemaVersion >= 1 && d.schemaVersion <= SCHEMA_VERSION)) throw new Error("このファイルは新しい版のアプリで作られています。アプリを更新してください");
      if (!Array.isArray(d.steps)) throw new Error("ファイルが壊れています");
      if (S.drawings.some((x) => x.id === d.id)) d.id = crypto.randomUUID?.() ?? String(Date.now());
      await store.put(d); S.msg = { text: `「${d.name}」を読み込みました` };
    } catch (err) { S.msg = { cls: "err", text: err instanceof SyntaxError ? "ファイルが壊れています" : err.message }; }
    return openList();
  }
  if (t.dataset.f) { S.form[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value; return; }
  if (t.dataset.step) {
    const v = num(t.value); const s = S.doc.steps.find((x) => x.id === t.dataset.step);
    if (!(v >= 0)) { S.msg = { cls: "err", text: "数値を入れてください" }; return render(); }
    const before = snap(); s[t.dataset.k] = t.dataset.k === "angleDeg" ? v : roundHalfUp(v, 3); touch(true, before); S.msg = null; return render();
  }
  if (t.dataset.set === "name") { const before = snap(); S.doc.name = t.value || S.doc.name; touch(true, before); return; }
  if (t.dataset.set === "tol") { const v = num(t.value); if (!(v >= 0 && v <= 10)) { S.msg = { cls: "err", text: "許容値は0〜10cmで入れてください" }; return render(); } S.prefs.tolCm = v; await store.putPrefs(S.prefs); S.pts = solve(S.doc, tol()); return render(); }
});
$app.addEventListener("input", (e) => { const t = e.target; if (t.dataset.f && t.type !== "checkbox") S.form[t.dataset.f] = t.value; });
window.addEventListener("resize", () => S.view === "editor" && drawSvg());

(async () => { const p = await store.getPrefs(); if (p && p.tolCm != null) S.prefs = { ...S.prefs, ...p }; openList(); })();
