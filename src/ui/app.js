// サクズ MVP（SZ-0.2.0）
import { APP_VERSION } from "../version.js";
import { createDrawing, SCHEMA_VERSION } from "../model/document.js";
import { addPolar, addCircles, defaultRef, deletePoint, collectDependents, closeLineAt, addManualLine, addManualDim, addRoom, addRoad, addText, normalize } from "../model/edit.js";
import { solve, misclosure, suspectEdges, usable } from "../model/solver.js";
import { closedAreas, roomTable, roadGeometry, polygonArea } from "../model/elements.js";
import { createHistory } from "../model/history.js";
import { formatLength, formatArea, roundHalfUp } from "../shared/round.js";
import { dist } from "../shared/geometry.js";
import { rotate, alignAngle, normDeg, readableDeg } from "../shared/rotate.js";
import { todayJst, formatTyping, parseDateInput, formatYmd } from "../shared/date.js";
import { MSG, msgOf, COMPUTED_SUFFIX, AREA_LABEL } from "./messages.js";
import { buildSheet, northSvg } from "./sheet.js";
import { addRect, addFreeLine, addFreeDim, addLeader, setWitness, shapeAnchor, moveShape, rectCorners, leaderTarget, witnessRows } from "../model/annot.js";
import { annotDefs, annotSvg, hatchFill, textSvg } from "./annot-svg.js";

// ---------- 保存（IndexedDB。使えなければメモリ） ----------
const store = (() => {
  const mem = { drawings: new Map(), prefs: {} };
  let dbp;
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
  view: "list", drawings: [], doc: null, pts: new Map(), prefs: { tolCm: 3, unit: "m", author: "" },
  tab: "add", mode: "polar", form: {}, active: "from", vt: { cx: 0, cy: 0, k: 60 },
  highlight: [], msg: null, panelMin: false, tool: null, pick: [], measure: null, pickXY: [], textVertical: false, wDraft: null, moveSel: null,
};
const hist = createHistory(50);
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tol = () => S.prefs.tolCm / 100;
const labelOf = (id) => S.doc.steps.find((s) => s.id === id)?.label ?? "?";
const jst = (iso) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const newUid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
const num = (v) => (v === "" || v == null ? NaN : Number(String(v).replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
const rot = () => S.doc?.sheet.rotationDeg || 0;

// 確認・入力ダイアログ（ブラウザ標準の confirm/prompt は使わない）
function modal(text, withInput = false, value = "", type = "text") {
  return new Promise((res) => {
    const d = document.createElement("dialog");
    d.innerHTML = `<p>${esc(text)}</p>${withInput ? `<input type="${type}" ${type === "number" ? 'inputmode="decimal" step="0.001"' : ""} value="${esc(value)}" style="width:100%;padding:6px">` : ""}<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" value="0">キャンセル</button><button class="btn primary" value="1">OK</button></div>`;
    document.body.appendChild(d);
    const done = (ok) => { const v = d.querySelector("input")?.value; d.close(); d.remove(); res(withInput ? (ok ? v : null) : ok); };
    d.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) done(b.value === "1"); });
    d.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(true); } });
    d.showModal(); d.querySelector("input")?.focus();
  });
}

let saveTimer = null;
function touch(pushHistory = true, before = null) {
  if (pushHistory && before) hist.push(before);
  S.doc.updatedAt = new Date().toISOString();
  S.pts = solve(S.doc, tol());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { if (!(await store.put(S.doc))) { S.msg = { cls: "err", text: "端末への保存に失敗しました。作業ファイルを書き出してください" }; render(); } }, 500);
}
const snap = () => JSON.parse(JSON.stringify(S.doc));

// ---------- 図面の一覧 ----------
async function openList() {
  S.view = "list"; S.drawings = (await store.all()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); render();
}
function openDoc(doc) {
  S.doc = normalize(doc); S.view = "editor"; hist.clear(); S.highlight = []; S.msg = null; S.tool = null; S.pick = []; S.measure = null;
  S.pts = solve(S.doc, tol()); resetForm(); render(); requestAnimationFrame(fit);
}
function resetForm() {
  const last = [...S.doc.steps].reverse().find((s) => usable(S.pts.get(s.id)) && !s.isClosing);
  const from = last?.id ?? S.doc.steps[0]?.id;
  S.form = { from, ref: from ? defaultRef(S.doc, from) : null, turn: "S", angle: 90, d: "", closing: false, a: null, da: "", b: null, db: "" };
  if (S.form.ref) S.form.turn = "R";
  S.active = S.mode === "polar" ? "from" : "a";
}

// ---------- 描画 ----------
function render() {
  const back = S.view === "editor" ? `<button class="btn sm" data-act="back">一覧</button>` : S.view === "preview" ? `<button class="btn sm" data-act="closePreview">作図に戻る</button>` : "";
  const head = `<header class="noprint"><div class="logo">サ</div><h1>サクズ</h1><span class="sp"></span>${back}</header>`;
  const foot = `<footer class="noprint">${APP_VERSION} ・ © 2026 SIKUMI LAB</footer>`;
  const body = S.view === "list" ? listHtml() : S.view === "preview" ? previewHtml() : editorHtml();
  $app.innerHTML = head + `<main>${body}</main>` + foot;
  if (S.view === "editor") { drawSvg(); bindCanvas(); }
  if (S.view === "preview") bindDateInput();
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
   ${S.msg ? `<div class="msg ${S.msg.cls || ""}">${S.msg.html ?? esc(S.msg.text)}</div>` : ""}
   ${cards || `<p class="note">まだ図面がありません。「新しい図面」から始めてください。</p>`}</div>`;
}
function editorHtml() {
  return `<div class="editor"><div class="canvas" id="cv"><svg id="svg"></svg>
   <div class="float"><button class="btn sm" data-act="undo" ${hist.canUndo ? "" : "disabled"}>元に戻す</button><button class="btn sm" data-act="redo" ${hist.canRedo ? "" : "disabled"}>やり直す</button><button class="btn sm" data-act="fit">全体</button><button class="btn sm primary" data-act="preview">図面</button></div>
   ${S.measure ? `<div class="measure">${esc(S.measure)}</div>` : ""}</div>
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
    return `<div class="st"><div class="h"><span class="lb">${s.label}</span>${badge}<span style="flex:1"></span>${s.type !== "base" ? `<button class="btn sm danger" data-act="delPt" data-id="${s.id}">削除</button>` : ""}</div><div class="note" style="color:var(--fg)">${body}</div>${err}</div>`;
  }).join("") + closingRows() + `</div>`;
}
/** 閉じた辺の長さ（計算値）を手順の一覧にも出す（F-030） */
function closingRows() {
  return S.doc.lines.filter((l) => l.closed).map((l) => {
    const a = S.pts.get(l.points.at(-1)), b = S.pts.get(l.points[0]);
    const len = usable(a) && usable(b) ? formatLength(dist(a, b), S.doc.sheet.unit) + COMPUTED_SUFFIX : "—";
    return `<div class="st"><div class="h"><span class="lb">閉</span><span class="note" style="color:var(--fg)">${labelOf(l.points.at(-1))}→${labelOf(l.points[0])}（閉じる辺） ${len}</span></div></div>`;
  }).join("");
}
const TOOLS = [["line", "線"], ["room", "部屋"], ["road", "道路"], ["dim", "寸法"], ["measure", "計測"], ["rotate", "回転"]];
const TOOLS2 = [["rect", "四角"], ["fline", "直線"], ["fdim", "寸法線"], ["text", "文字"], ["leader", "引き出し線"], ["north", "北"], ["witness", "引照点"], ["move", "移動"]];
const TOOL_HELP = {
  line: "点を順にタップ。最初の点をタップすると閉じます。「完了」で開いた線にします。",
  room: "部屋の角の点を順にタップし、最初の点をタップすると名前の入力に進みます。",
  road: "敷地の辺の両端の点を、順に2つタップしてください。",
  dim: "寸法を入れる2点をタップしてください。",
  text: "文字を置く場所をタップしてください。",
  north: "北の記号を置く場所をタップしてください。",
  measure: "距離を測る2点をタップしてください（図面には残りません）。",
  rotate: "そろえたい辺の両端の点を、順に2つタップしてください。",
  rect: "四角の対角の2か所をタップしてください（点の近くは点に吸い付きます）。",
  fline: "直線の始点と終点をタップしてください（点の近くは点に吸い付きます）。",
  fdim: "寸法線の両端をタップしてください。",
  leader: "指す点（または位置）をタップし、次に文字を置く場所をタップしてください。",
  witness: "引照点にする点をタップしてください。続けて対象の点（基準点など）をタップし、「完了」を押します。",
  move: "動かしたい図形・文字をタップし、次に移動先をタップしてください。",
};
function elemsHtml() {
  const d = S.doc, unit = d.sheet.unit;
  const tb = (list) => list.map(([k, t]) => `<button class="btn sm ${S.tool === k ? "on" : ""}" data-act="tool" data-tool="${k}">${t}</button>`).join("");
  const tools = `<div class="row" style="gap:4px"><span class="note">作図</span>${tb(TOOLS)}</div><div class="row" style="gap:4px"><span class="note">記載</span>${tb(TOOLS2)}</div>`;
  const help = S.tool ? `<div class="msg">${TOOL_HELP[S.tool]}${S.pick.length ? `（選択: ${S.pick.map(labelOf).join("→")}）` : ""}${["line", "room"].includes(S.tool) && S.pick.length ? ` <button class="btn sm" data-act="pickDone">完了</button>` : ""}${S.tool === "witness" && S.wDraft ? `（${esc(S.wDraft.name)} → ${S.wDraft.targets.map(labelOf).join("・") || "対象未選択"}） <button class="btn sm" data-act="witnessDone">完了</button>` : ""}${S.tool === "text" ? ` <label style="min-width:0"><input type="checkbox" data-set="textVertical" ${S.textVertical ? "checked" : ""}> 縦書き</label>` : ""}${S.tool === "move" && S.moveSel ? "（選択中）" : ""} <button class="btn sm" data-act="tool" data-tool="">やめる</button></div>` : "";
  let extra = "";
  if (S.tool === "rotate") extra = `<div class="row"><label>回転</label><input type="number" inputmode="decimal" data-set="rot" value="${roundHalfUp(rot(), 2)}">° <button class="btn sm" data-act="rot0">0°に戻す</button></div>
     <div class="row"><label>辺を</label><div class="seg"><button class="${(S.rotMode || "h") === "h" ? "on" : ""}" data-act="rotMode" data-m="h">水平に</button><button class="${S.rotMode === "v" ? "on" : ""}" data-act="rotMode" data-m="v">垂直に</button></div></div>`;
  if (S.tool === "north") extra = `<div class="row"><label>北の向き</label><input type="number" inputmode="decimal" data-set="northAng" value="${d.north?.angleDeg ?? 0}">°（上が0°・反時計回り）${d.north ? ` <button class="btn sm danger" data-act="northDel">消す</button>` : ""}</div>`;
  const hatchBtn = (kind, id, on) => `<button class="btn sm ${on ? "on" : ""}" data-act="hatch" data-kind="${kind}" data-id="${id}">斜線</button>`;
  const areas = closedAreas(d, S.pts).map((a, i) => `<li>図形${i + 1}: ${a.area != null ? `${AREA_LABEL} ${formatArea(a.area)}㎡` : esc(MSG[a.code]?.() ?? a.code)} ${hatchBtn("line", a.lineId, d.lines.find((l) => l.id === a.lineId)?.hatch)}</li>`).join("");
  const rt = roomTable(d, S.pts);
  const rooms = d.rooms.map((r, i) => `<li>${esc(r.name)} ${rt.rows[i].area != null ? formatArea(rt.rows[i].area) + "㎡" : "—"} ${hatchBtn("room", r.id, r.hatch)} <button class="btn sm" data-act="roomRename" data-id="${r.id}">名前</button> <button class="btn sm danger" data-act="roomDel" data-id="${r.id}">削除</button></li>`).join("");
  const roads = d.roads.map((r) => `<li>${esc(r.name || "道路")} 幅${formatLength(r.width, unit)} <button class="btn sm" data-act="roadFlip" data-id="${r.id}">向き⇄</button> <button class="btn sm" data-act="roadWidth" data-id="${r.id}">幅</button> <button class="btn sm danger" data-act="roadDel" data-id="${r.id}">削除</button></li>`).join("");
  const texts = d.texts.map((t) => `<li>${esc(t.text)} <button class="btn sm" data-act="textVert" data-id="${t.id}">${t.vertical ? "横書きに" : "縦書きに"}</button> <button class="btn sm danger" data-act="textDel" data-id="${t.id}">削除</button></li>`).join("");
  const SHN = { rect: "四角", line: "直線", dim: "寸法線", leader: "引き出し線" };
  const shapes = d.shapes.map((x) => `<li>${SHN[x.type]}${x.text || x.label ? "「" + esc(x.text || x.label) + "」" : ""}${x.type === "rect" ? ` ${formatLength(x.w, "m")}×${formatLength(x.h, "m")}m <button class="btn sm" data-act="rectSize" data-id="${x.id}">大きさ</button> <button class="btn sm" data-act="shapeText" data-id="${x.id}">文字</button>` : ""}${x.type === "dim" || x.type === "leader" ? ` <button class="btn sm" data-act="shapeText" data-id="${x.id}">文字</button>` : ""} <button class="btn sm danger" data-act="shapeDel" data-id="${x.id}">削除</button></li>`).join("");
  const wit = d.witnesses.map((w) => `<li>${esc(w.name)}（${labelOf(w.pointId)}）→ ${w.targets.map(labelOf).join("・")} <button class="btn sm danger" data-act="witnessDel" data-id="${w.id}">削除</button></li>`).join("");
  const mdims = d.dims.filter((x) => !x.stepId && x.manual).map((x) => `<li>${labelOf(x.a)}–${labelOf(x.b)} <button class="btn sm danger" data-act="dimDel" data-id="${x.id}">削除</button></li>`).join("");
  return tools + help + extra +
    (areas ? `<h4>閉じた図形</h4><ul class="ul">${areas}</ul>` : "") +
    (rooms ? `<h4>部屋（合計 ${formatArea(rt.total)}㎡）</h4><ul class="ul">${rooms}</ul>` : "") +
    (roads ? `<h4>道路</h4><ul class="ul">${roads}</ul>` : "") +
    (texts ? `<h4>文字</h4><ul class="ul">${texts}</ul>` : "") +
    (shapes ? `<h4>自由図形</h4><ul class="ul">${shapes}</ul>` : "") +
    (wit ? `<h4>引照点</h4><ul class="ul">${wit}</ul>` : "") +
    (mdims ? `<h4>手動の寸法</h4><ul class="ul">${mdims}</ul>` : "") +
    `<h4>設定</h4>
   <div class="row"><label>図面名</label><input type="text" data-set="name" value="${esc(d.name)}" style="width:180px"></div>
   <div class="row"><label>表示単位</label><div class="seg">${[["m", "m"], ["mm", "mm"]].map(([k, t]) => `<button class="${unit === k ? "on" : ""}" data-act="unit" data-unit="${k}">${t}</button>`).join("")}</div></div>
   <div class="row"><label>許容値</label><input type="number" step="0.1" min="0" max="10" data-set="tol" value="${S.prefs.tolCm}">cm（二円交点）</div>`;
}

// ---------- 図面のプレビュー（S-003） ----------
function previewHtml() {
  const d = S.doc, sh = d.sheet;
  const r = buildSheet(d, S.pts);
  const seg = (key, opts) => `<div class="seg">${opts.map(([k, t]) => `<button class="${sh[key] === k ? "on" : ""}" data-act="sheet" data-k="${key}" data-v="${k}">${t}</button>`).join("")}</div>`;
  return `<div class="preview"><div class="pctrl noprint">
    <div class="row"><label>用紙</label>${seg("paper", [["A4", "A4"], ["A3", "A3"]])}${seg("orientation", [["landscape", "横"], ["portrait", "縦"]])}</div>
    <div class="row"><label>単位</label>${seg("unit", [["m", "m"], ["mm", "mm"]])}<label style="min-width:0"><input type="checkbox" data-set="showArea" ${sh.showArea ? "checked" : ""}> 概算面積を載せる</label><label style="min-width:0"><input type="checkbox" data-set="showWitnessTable" ${sh.showWitnessTable ? "checked" : ""}> 引照点の一覧を載せる</label></div>
    <div class="row"><label>題名</label><input type="text" data-set="title" value="${esc(sh.title)}" placeholder="${esc(d.name)}" style="width:200px"></div>
    <div class="row"><label>作成日</label><span class="dateIn"><input type="text" inputmode="numeric" id="dateText" value="${esc(formatYmd(sh.createdDate))}" placeholder="yyyy/MM/dd" style="width:120px"><button class="btn sm" data-act="cal" aria-label="カレンダー">📅</button><input type="date" id="datePick" value="${esc(sh.createdDate)}" style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"></span><span class="note" id="dateErr"></span></div>
    <div class="row"><label>作成者</label><input type="text" data-set="author" value="${esc(sh.author)}" style="width:160px"></div>
    <div class="row"><button class="btn primary" data-act="print">印刷／PDFに保存</button>${r.scale ? `<span class="note">縮尺 ${r.scale.fixed ? "1/" + r.scale.denominator : "任意"}</span>` : ""}</div></div>
    <div class="sheetWrap">${r.empty ? `<p class="note">図がありません。作図に戻って点や線を追加してください。</p>` : `<div class="sheet" style="aspect-ratio:${r.W}/${r.H}">${r.svg}</div>`}</div></div>`;
}
function bindDateInput() {
  const t = document.getElementById("dateText"), p = document.getElementById("datePick"); if (!t) return;
  let first = true;
  t.addEventListener("focus", () => { if (first) { first = false; setTimeout(() => t.select(), 50); } });
  t.addEventListener("input", () => { const v = formatTyping(t.value); if (v !== t.value) t.value = v; });
  t.addEventListener("change", () => {
    const err = document.getElementById("dateErr");
    if (!t.value.trim()) { setSheet("createdDate", ""); err.textContent = ""; return; }
    const r = parseDateInput(t.value);
    if (r.code) { err.textContent = MSG.DATE_INVALID(); err.style.color = "var(--err)"; return; }
    err.textContent = ""; t.value = formatYmd(r.ymd); p.value = r.ymd; setSheet("createdDate", r.ymd, false);
  });
  p.addEventListener("change", () => { if (p.value) { t.value = formatYmd(p.value); setSheet("createdDate", p.value); } });
}
function setSheet(k, v, rerender = true) {
  const before = snap(); S.doc.sheet[k] = v; touch(true, before);
  if (k === "author") { S.prefs.author = v; store.putPrefs(S.prefs); }
  if (rerender) render(); else updateSheetSvg();
}
function updateSheetSvg() { const w = document.querySelector(".sheet"); if (w) { const r = buildSheet(S.doc, S.pts); w.innerHTML = r.svg; } }
function setPageSize() {
  let st = document.getElementById("pageSize"); if (!st) { st = document.createElement("style"); st.id = "pageSize"; document.head.appendChild(st); }
  st.textContent = `@page { size: ${S.doc.sheet.paper} ${S.doc.sheet.orientation}; margin: 0 }`;
}

// ---------- 作図画面のSVG（回転は見た目だけ。F-029） ----------
const svgRect = () => document.getElementById("svg")?.getBoundingClientRect() ?? { width: 300, height: 300, left: 0, top: 0 };
const toScr = (p) => { const q = rotate(p, rot()), r = svgRect(); return { x: (q.x - S.vt.cx) * S.vt.k + r.width / 2, y: r.height / 2 - (q.y - S.vt.cy) * S.vt.k }; };
const toWorld = (x, y) => { const r = svgRect(); return rotate({ x: (x - r.width / 2) / S.vt.k + S.vt.cx, y: (r.height / 2 - y) / S.vt.k + S.vt.cy }, -rot()); };
function fit() {
  const ps = [...S.pts.values()].filter(usable).map((p) => rotate(p, rot()));
  for (const t of S.doc.texts) ps.push(rotate(t, rot()));
  for (const sh of S.doc.shapes) ps.push(rotate(shapeAnchor(sh), rot()));
  if (!ps.length) return;
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y), r = svgRect();
  const w = Math.max(...xs) - Math.min(...xs) || 1, h = Math.max(...ys) - Math.min(...ys) || 1;
  S.vt.cx = (Math.max(...xs) + Math.min(...xs)) / 2; S.vt.cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  S.vt.k = Math.min(r.width / (w * 1.5), r.height / (h * 1.5), 400); drawSvg();
}
function ensureVisible() {
  const r = svgRect(), m = 24;
  if ([...S.pts.values()].filter(usable).some((p) => { const q = toScr(p); return q.x < m || q.y < m || q.x > r.width - m || q.y > r.height - m; })) fit();
}
const AO = { id: "sc", lw: 1.2, fs: 13, sym: 6, arrow: 10, hatch: 8 };
function dimText(a, b, label, cls = "") {
  const L = dist(a, b); if (L < 1e-9) return "";
  const A = toScr(a), B = toScr(b);
  let ang = readableDeg(Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI);
  const nx = -(B.y - A.y) / Math.hypot(B.x - A.x, B.y - A.y), ny = (B.x - A.x) / Math.hypot(B.x - A.x, B.y - A.y);
  const m = { x: (A.x + B.x) / 2 + nx * 10, y: (A.y + B.y) / 2 + ny * 10 };
  return `<text class="${cls}" x="${m.x}" y="${m.y}" font-size="12" text-anchor="middle" dominant-baseline="middle" transform="rotate(${ang} ${m.x} ${m.y})" fill="#2f6fde" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(label)}</text>`;
}
function drawSvg() {
  const svg = document.getElementById("svg"); if (!svg) return;
  const P = (id) => S.pts.get(id); let g = annotDefs(AO);
  const unit = S.doc.sheet.unit;
  for (const s of S.doc.steps) if (s.type === "circles" && usable(P(s.id))) for (const k of ["a", "b"]) if (usable(P(s[k]))) { const a = toScr(P(s[k])), b = toScr(P(s.id)); g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#9aa" stroke-dasharray="4 4"/>`; }
  // 道路
  for (const road of S.doc.roads) { const r = roadGeometry(S.doc, S.pts, road); if (!r) continue;
    const a = toScr(r.far[0]), b = toScr(r.far[1]), c = toScr(r.near[0]), d = toScr(r.near[1]);
    g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#555" stroke-width="2"/><line x1="${c.x}" y1="${c.y}" x2="${d.x}" y2="${d.y}" stroke="#555" stroke-dasharray="6 4"/>`;
    g += dimText(r.dim[0], r.dim[1], `${road.name ? road.name + " " : ""}幅 ${formatLength(road.width, unit)}`); }
  // 部屋
  for (const room of S.doc.rooms) { const ps = room.points.map(P); if (ps.some((p) => !usable(p))) continue;
    g += `<polygon points="${ps.map(toScr).map((p) => `${p.x},${p.y}`).join(" ")}" fill="${room.hatch ? hatchFill(AO) : "rgba(46,160,90,.08)"}" stroke="#2e7d32" stroke-width="1.5"/>`;
    const pa = polygonArea(S.pts, room.points); if (pa.centroid) { const c = toScr(pa.centroid); g += `<text x="${c.x}" y="${c.y}" font-size="13" text-anchor="middle" fill="#2e7d32">${esc(room.name)} ${formatArea(pa.area)}㎡</text>`; } }
  // 線
  for (const l of S.doc.lines) { const ps = l.points.map(P); if (ps.some((p) => !usable(p))) continue;
    const d = ps.map(toScr).map((p) => `${p.x},${p.y}`).join(" ");
    g += l.closed ? `<polygon points="${d}" fill="${l.hatch ? hatchFill(AO) : "rgba(47,111,222,.06)"}" stroke="#1d2430" stroke-width="2"/>` : `<polyline points="${d}" fill="none" stroke="#1d2430" stroke-width="2"/>`; }
  for (const [a, b] of S.highlight) if (usable(P(a)) && usable(P(b))) { const p = toScr(P(a)), q = toScr(P(b)); g += `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="#c62828" stroke-width="6" opacity=".5"/>`; }
  // 寸法（計算値の表記。F-030）
  for (const dm of S.doc.dims) { const a = P(dm.a), b = P(dm.b); if (!usable(a) || !usable(b)) continue; g += dimText(a, b, formatLength(dist(a, b), unit) + (dm.computed ? COMPUTED_SUFFIX : "")); }
  // 概算面積（F-032）
  for (const ca of closedAreas(S.doc, S.pts)) { const l = S.doc.lines.find((x) => x.id === ca.lineId);
    const c = ca.centroid ? toScr(ca.centroid) : toScr(P(l.points[0]) ?? { x: 0, y: 0 });
    const t = ca.area != null ? `${AREA_LABEL} ${formatArea(ca.area)}㎡` : MSG[ca.code]?.() ?? ca.code;
    if (ca.centroid || ca.code === "POLY_SELF_INTERSECT") g += `<text x="${c.x}" y="${c.y + 18}" font-size="13" font-weight="700" text-anchor="middle" fill="${ca.area != null ? "#1d2430" : "#c62828"}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(t)}</text>`; }
  // 文字・北
  for (const t of S.doc.texts) { const c = toScr(t); g += textSvg(c.x, c.y, t.text, 14, !!t.vertical, `fill="#333"`); }
  g += annotSvg(S.doc, S.pts, toScr, AO);
  if (S.pickXY.length) { const q = toScr(S.pickXY[0]); g += `<circle cx="${q.x}" cy="${q.y}" r="6" fill="none" stroke="#2f6fde" stroke-width="2"/>`; }
  if (S.moveSel) { const q = toScr(S.moveSel.anchor); g += `<circle cx="${q.x}" cy="${q.y}" r="16" fill="none" stroke="#2f6fde" stroke-width="2" stroke-dasharray="4 3"/>`; }
  if (S.doc.north) { const c = toScr(S.doc.north); g += northSvg(c.x, c.y, (S.doc.north.angleDeg || 0) + rot(), 34); }
  // 選択中の点の列
  if (S.pick.length) { const d = S.pick.map(P).filter(usable).map(toScr).map((p) => `${p.x},${p.y}`).join(" "); g += `<polyline points="${d}" fill="none" stroke="#2f6fde" stroke-width="2" stroke-dasharray="6 4"/>`; }
  // 点
  for (const s of S.doc.steps) {
    const p = P(s.id);
    if (p?.status === "pending") for (const k of ["L", "R"]) { const q = toScr(p.candidates[k]); g += `<circle cx="${q.x}" cy="${q.y}" r="10" fill="${k === "L" ? "#e07a1f" : "#7b3fd0"}" opacity=".85"/><text x="${q.x}" y="${q.y - 14}" font-size="12" text-anchor="middle">${k === "L" ? "左" : "右"}</text>`; }
    if (!usable(p) || s.isClosing) continue;
    const q = toScr(p); const sel = [S.form.from, S.form.a, S.form.b, ...S.pick].includes(s.id);
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
  el.addEventListener("wheel", (e) => { e.preventDefault(); const r = svgRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const before = { x: (sx - r.width / 2) / S.vt.k + S.vt.cx, y: (r.height / 2 - sy) / S.vt.k + S.vt.cy };
    S.vt.k = Math.max(2, Math.min(2000, S.vt.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const after = { x: (sx - r.width / 2) / S.vt.k + S.vt.cx, y: (r.height / 2 - sy) / S.vt.k + S.vt.cy };
    S.vt.cx += before.x - after.x; S.vt.cy += before.y - after.y; drawSvg(); }, { passive: false });
}
function hitPoint(x, y) {
  let best = null, bd = 24;
  for (const s of S.doc.steps) { const p = S.pts.get(s.id); if (!usable(p) || s.isClosing) continue; const q = toScr(p); const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = s.id; } }
  return best;
}
async function onTap(x, y) {
  const pend = S.doc.steps.find((s) => s.type === "circles" && !s.side && S.pts.get(s.id)?.status === "pending");
  if (pend) { const c = S.pts.get(pend.id).candidates; for (const k of ["L", "R"]) { const q = toScr(c[k]); if (Math.hypot(q.x - x, q.y - y) < 24) return chooseSide(pend, k); } }
  if (S.tool) return onToolTap(x, y);
  const id = hitPoint(x, y); if (!id) return;
  if (S.tab !== "add") S.tab = "add";
  const f = S.form;
  if (S.active === "refA") { f.refA = id; S.active = "refB"; S.msg = { text: "基準の辺の終点をタップしてください" }; return render(); }
  if (S.active === "refB") { f.ref = [f.refA, id]; S.active = "from"; S.msg = null; if (f.turn === "S") f.turn = "R"; return render(); }
  if (S.active === "from") { f.from = id; f.ref = defaultRef(S.doc, id); }
  else if (S.active === "a") { f.a = id; S.active = "b"; return render(); }
  else if (S.active === "b") { f.b = id; }
  render();
}
/** 点の近くなら点に吸い付く位置 */
function snapAt(x, y) { const id = hitPoint(x, y); if (id) { const p = S.pts.get(id); return { x: p.x, y: p.y, pointId: id }; } return { ...toWorld(x, y), pointId: null }; }
async function onToolTap(x, y) {
  const t = S.tool, d = S.doc;
  if (["rect", "fline", "fdim", "leader"].includes(t)) {
    const p = snapAt(x, y); S.pickXY.push(p);
    if (S.pickXY.length < 2) return drawSvg();
    const [a, b] = S.pickXY; S.pickXY = [];
    if (t === "leader") { const txt = await modal("引き出し線の文字", true); if (!txt) return render(); const before = snap(); addLeader(d, a.pointId ? { pointId: a.pointId } : { x: a.x, y: a.y }, b, txt); touch(true, before); return render(); }
    if (dist(a, b) < 1e-6) { S.msg = { cls: "err", text: "同じ位置です。別の場所をタップしてください" }; return render(); }
    if (t === "rect") { const txt = (await modal("四角の中の文字（なくてもよい）", true)) ?? ""; const before = snap(); addRect(d, a, b, rot(), txt); touch(true, before); return render(); }
    if (t === "fline") { const before = snap(); addFreeLine(d, a, b); touch(true, before); return render(); }
    if (t === "fdim") { const lab = (await modal("寸法の文字（空なら長さを自動で表示）", true)) ?? ""; const before = snap(); addFreeDim(d, a, b, lab); touch(true, before); return render(); }
  }
  if (t === "move") {
    if (!S.moveSel) {
      let best = null, bd = 30;
      for (const sh of d.shapes) { const q = toScr(shapeAnchor(sh)); const dd = Math.hypot(q.x - x, q.y - y); if (dd < bd) { bd = dd; best = { kind: "shape", id: sh.id, anchor: shapeAnchor(sh) }; } }
      for (const tx of d.texts) { const q = toScr(tx); const dd = Math.hypot(q.x - x, q.y - y); if (dd < bd) { bd = dd; best = { kind: "text", id: tx.id, anchor: { x: tx.x, y: tx.y } }; } }
      if (d.north) { const q = toScr(d.north); const dd = Math.hypot(q.x - x, q.y - y); if (dd < bd) { bd = dd; best = { kind: "north", anchor: { x: d.north.x, y: d.north.y } }; } }
      S.moveSel = best; return render();
    }
    const w = toWorld(x, y), sel = S.moveSel; S.moveSel = null; const dx = w.x - sel.anchor.x, dy = w.y - sel.anchor.y; const before = snap();
    if (sel.kind === "shape") moveShape(d.shapes.find((s2) => s2.id === sel.id), dx, dy);
    else if (sel.kind === "text") { const tx = d.texts.find((s2) => s2.id === sel.id); tx.x += dx; tx.y += dy; }
    else { d.north.x += dx; d.north.y += dy; }
    touch(true, before); return render();
  }
  if (t === "witness") {
    const id = hitPoint(x, y); if (!id) return;
    if (!S.wDraft) { const ex = d.witnesses.find((w) => w.pointId === id); const name = await modal("引照点の名前（例: 電柱 No.12）", true, ex?.name ?? ""); if (!name) return render(); S.wDraft = { pointId: id, name, targets: ex ? [...ex.targets] : [] }; return render(); }
    if (id !== S.wDraft.pointId && !S.wDraft.targets.includes(id)) S.wDraft.targets.push(id);
    return render();
  }
  if (t === "text") { const w = toWorld(x, y); const s = await modal("文字を入れてください", true); if (s) { const before = snap(); const tx = addText(d, w.x, w.y, s); tx.vertical = S.textVertical; touch(true, before); } return render(); }
  if (t === "north") { const w = toWorld(x, y); const before = snap(); d.north = { x: w.x, y: w.y, angleDeg: d.north?.angleDeg ?? 0 }; touch(true, before); return render(); }
  const id = hitPoint(x, y); if (!id) return;
  if ((t === "line" || t === "room") && S.pick[0] === id && S.pick.length >= 3) return finishPick(true);
  if (S.pick.includes(id)) return;
  S.pick.push(id);
  if (S.pick.length === 2 && ["road", "dim", "measure", "rotate"].includes(t)) {
    const [a, b] = S.pick; S.pick = [];
    if (t === "measure") { const A = S.pts.get(a), B = S.pts.get(b); S.measure = `${labelOf(a)}–${labelOf(b)}: ${formatLength(dist(A, B), d.sheet.unit)}${d.sheet.unit === "m" ? "m" : "mm"}`; return render(); }
    if (t === "dim") { const before = snap(); const dm = addManualDim(d, a, b); if (dm) dm.manual = true; touch(true, before); return render(); }
    if (t === "rotate") { const before = snap(); d.sheet.rotationDeg = alignAngle(S.pts.get(a), S.pts.get(b), S.rotMode || "h"); touch(true, before); render(); return fit(); }
    if (t === "road") { const w = num(await modal("道路の幅（m）", true, "", "number")); if (!(w > 0)) { S.msg = { cls: "err", text: "幅は0より大きい値を入れてください" }; return render(); }
      const name = (await modal("道路の名前（なくてもよい）", true)) ?? ""; const before = snap(); addRoad(d, [a, b], roundHalfUp(w, 3), name); touch(true, before); return render(); }
  }
  render();
}
async function finishPick(closed) {
  const t = S.tool, ids = [...S.pick]; S.pick = [];
  if (t === "line" && ids.length >= 2) { const before = snap(); addManualLine(S.doc, ids, closed && ids.length >= 3); touch(true, before); }
  if (t === "room" && ids.length >= 3) { const name = await modal("部屋の名前", true, `部屋${S.doc.rooms.length + 1}`); if (name) { const before = snap(); addRoom(S.doc, name, ids); touch(true, before);
    const pa = polygonArea(S.pts, ids); if (pa.code) S.msg = { cls: "err", text: MSG[pa.code]?.() ?? pa.code }; } }
  render();
}
function chooseSide(step, side) {
  const before = snap(); const s = S.doc.steps.find((x) => x.id === step.id); s.side = side; touch(true, before);
  const p = S.pts.get(s.id); S.msg = p.status === "warn" ? { cls: "warn", text: `接する点として扱いました（隙間 ${roundHalfUp(p.gap * 100, 1)}cm）` } : null;
  S.mode = "polar"; resetForm(); S.form.from = s.id; S.form.ref = [s.a, s.id]; render(); ensureVisible();
}

// ---------- 操作 ----------
$app.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]"); if (!t || t.tagName === "INPUT") return;
  const act = t.dataset.act, id = t.dataset.id, f = S.form, d = S.doc;
  const find = (x) => S.drawings.find((dd) => dd.id === x);
  const edit = (fn) => { const before = snap(); fn(); touch(true, before); render(); };
  switch (act) {
    case "new": { const nd = createDrawing(`図面 ${S.drawings.length + 1}`); nd.sheet.author = S.prefs.author || ""; nd.sheet.createdDate = todayJst(); await store.put(nd); return openDoc(nd); }
    case "open": return openDoc(structuredClone(find(id)));
    case "dup": { const nd = structuredClone(find(id)); nd.id = newUid(); nd.name += "（コピー）"; nd.updatedAt = new Date().toISOString(); await store.put(nd); return openList(); }
    case "rename": { const n = await modal("図面の名前", true, find(id).name); if (n) { const dd = find(id); dd.name = n; await store.put(dd); } return openList(); }
    case "del": if (await modal(`「${find(id).name}」を削除します。端末の中では元に戻せません。`)) await store.del(id); return openList();
    case "export": { const dd = find(id); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(dd)], { type: "application/json" })); a.download = `${dd.name}.sakuzu.json`; a.click(); return; }
    case "share": { const url = location.origin + location.pathname; try { if (navigator.share) await navigator.share({ title: "サクズ", url }); else { await navigator.clipboard.writeText(url); S.msg = { text: "URLをコピーしました" }; render(); } } catch { S.msg = { text: url }; render(); } return; }
    case "back": clearTimeout(saveTimer); await store.put(d); S.msg = null; return openList();
    case "preview": S.view = "preview"; if (!d.sheet.createdDate) d.sheet.createdDate = todayJst(); return render();
    case "closePreview": S.view = "editor"; render(); return requestAnimationFrame(fit);
    case "print": setPageSize(); return window.print();
    case "sheet": return setSheet(t.dataset.k, t.dataset.v);
    case "cal": { const p = document.getElementById("datePick"); try { p.showPicker(); } catch { p.click(); } return; }
    case "tab": S.tab = t.dataset.tab; S.panelMin = false; return render();
    case "grab": S.panelMin = !S.panelMin; return render();
    case "mode": S.mode = t.dataset.mode; resetForm(); return render();
    case "active": S.active = t.dataset.field; if (S.active === "refA") S.msg = { text: "基準の辺の始点をタップしてください" }; return render();
    case "refClear": f.ref = null; return render();
    case "turn": f.turn = t.dataset.turn; return render();
    case "a90": f.angle = 90; if (f.turn === "S") f.turn = "R"; return render();
    case "fit": return fit();
    case "tool": S.tool = t.dataset.tool || null; S.pick = []; S.pickXY = []; S.wDraft = null; S.moveSel = null; S.measure = null; S.msg = null; return render();
    case "witnessDone": { const w = S.wDraft; S.wDraft = null; if (!w || !w.targets.length) { S.msg = { cls: "err", text: "対象の点を1つ以上タップしてください" }; return render(); } return edit(() => setWitness(d, w.pointId, w.name, w.targets)); }
    case "witnessDel": return edit(() => { d.witnesses = d.witnesses.filter((w) => w.id !== id); });
    case "hatch": return edit(() => { const o = (t.dataset.kind === "room" ? d.rooms : d.lines).find((x) => x.id === id); o.hatch = !o.hatch; });
    case "textVert": return edit(() => { const tx = d.texts.find((x) => x.id === id); tx.vertical = !tx.vertical; });
    case "shapeDel": return edit(() => { d.shapes = d.shapes.filter((x) => x.id !== id); });
    case "shapeText": { const sh = d.shapes.find((x) => x.id === id); const key = sh.type === "dim" ? "label" : "text"; const v = await modal(sh.type === "dim" ? "寸法の文字（空なら長さを自動で表示）" : "文字", true, sh[key] ?? ""); if (v != null) edit(() => { sh[key] = v; }); return; }
    case "rectSize": { const sh = d.shapes.find((x) => x.id === id); const w = num(await modal("幅（m）", true, roundHalfUp(sh.w, 3), "number")); if (!(w > 0)) return; const h = num(await modal("高さ（m）", true, roundHalfUp(sh.h, 3), "number")); if (!(h > 0)) return; return edit(() => { sh.w = w; sh.h = h; }); }
    case "pickDone": return finishPick(false);
    case "rotMode": S.rotMode = t.dataset.m; return render();
    case "rot0": edit(() => { d.sheet.rotationDeg = 0; }); return fit();
    case "northDel": return edit(() => { d.north = null; });
    case "roomDel": return edit(() => { d.rooms = d.rooms.filter((r) => r.id !== id); });
    case "roomRename": { const r = d.rooms.find((x) => x.id === id); const n = await modal("部屋の名前", true, r.name); if (n) edit(() => { r.name = n; }); return; }
    case "roadDel": return edit(() => { d.roads = d.roads.filter((r) => r.id !== id); });
    case "roadFlip": return edit(() => { const r = d.roads.find((x) => x.id === id); r.flip = !r.flip; });
    case "roadWidth": { const r = d.roads.find((x) => x.id === id); const w = num(await modal("道路の幅（m）", true, r.width, "number")); if (w > 0) edit(() => { r.width = roundHalfUp(w, 3); }); return; }
    case "textDel": return edit(() => { d.texts = d.texts.filter((x) => x.id !== id); });
    case "dimDel": return edit(() => { d.dims = d.dims.filter((x) => x.id !== id); });
    case "undo": case "redo": { const nd = act === "undo" ? hist.undo(d) : hist.redo(d); if (nd) { S.doc = normalize(nd); touch(false); resetForm(); S.highlight = []; render(); } return; }
    case "addPolar": {
      const dd = num(f.d), ang = f.turn === "S" ? 0 : num(f.angle);
      if (!f.from) { S.msg = { cls: "err", text: "元の点を選んでください" }; return render(); }
      if (!(dd > 0)) { S.msg = { cls: "err", text: MSG.POLAR_BAD_DISTANCE() }; return render(); }
      if (!(ang >= 0 && ang <= 180)) { S.msg = { cls: "err", text: MSG.POLAR_BAD_ANGLE() }; return render(); }
      const before = snap(); const st = addPolar(d, { from: f.from, ref: f.ref, turn: f.turn, angleDeg: ang, d: roundHalfUp(dd, 3), closing: f.closing }); touch(true, before);
      S.msg = null; S.highlight = [];
      if (f.closing) { const line = d.lines.find((l) => l.closure?.stepId === st.id); const m = misclosure(d, S.pts, line);
        if (m && !m.none) S.msg = { cls: "warn", html: `閉合のずれ <b>${roundHalfUp(m.len * 100, 1)}cm</b>（向き ${Math.round(Math.atan2(m.v.y, m.v.x) * 180 / Math.PI)}°）<div class="row" style="margin-top:6px"><button class="btn sm" data-act="clKeep" data-id="${line.id}">そのまま閉じる</button><button class="btn sm" data-act="clHint" data-id="${line.id}">測り直す箇所の目安</button><button class="btn sm danger" data-act="undo">取り消す</button></div>` };
        else { line.closure.choice = "keep"; S.msg = { text: "ずれなしで閉じました" }; } }
      resetForm(); render(); ensureVisible(); return;
    }
    case "clKeep": { const l = d.lines.find((x) => x.id === id); l.closure.choice = "keep"; S.msg = { text: "そのまま閉じました" }; S.highlight = []; touch(false); return render(); }
    case "clHint": { const l = d.lines.find((x) => x.id === id); const m = misclosure(d, S.pts, l); S.highlight = suspectEdges(S.pts, l, m.v); drawSvg(); return; }
    case "closeLine": { const before = snap(); const l = closeLineAt(d, f.from); if (!l) { S.msg = { cls: "err", text: "閉じられる線がありません（3点以上の線の最後の点を選んでください）" }; return render(); } touch(true, before); S.msg = { text: "閉じました（閉じる辺は計算値）" }; return render(); }
    case "addCircles": {
      const da = num(f.da), db = num(f.db);
      if (!f.a || !f.b) { S.msg = { cls: "err", text: "点Aと点Bを選んでください" }; return render(); }
      if (!(da > 0 && db > 0)) { S.msg = { cls: "err", text: MSG.POLAR_BAD_DISTANCE() }; return render(); }
      const before = snap(); const st = addCircles(d, { a: f.a, da: roundHalfUp(da, 3), b: f.b, db: roundHalfUp(db, 3) }); touch(true, before);
      const p = S.pts.get(st.id);
      if (p.status === "error") { d.steps.pop(); touch(false); S.msg = { cls: "err", text: msgOf(p) }; }
      else S.msg = p.gap > 0 ? { cls: "warn", text: `接する点として扱います（隙間 ${roundHalfUp(p.gap * 100, 1)}cm）` } : null;
      render(); ensureVisible(); return;
    }
    case "side": { const s = d.steps.find((x) => x.type === "circles" && !x.side); return chooseSide(s, t.dataset.side); }
    case "cancelPending": { d.steps = d.steps.filter((x) => !(x.type === "circles" && !x.side)); touch(false); return render(); }
    case "flip": return edit(() => { const s = d.steps.find((x) => x.id === id); s.side = s.side === "L" ? "R" : "L"; });
    case "delPt": { const { points } = collectDependents(d, id); if (!(await modal(points.size > 1 ? `この点を削除すると、ほかに ${points.size - 1} 個の点も削除されます。よろしいですか？` : "この点を削除します。よろしいですか？"))) return; edit(() => deletePoint(d, id)); return resetForm(); }
    case "unit": return edit(() => { d.sheet.unit = t.dataset.unit; });
  }
});
$app.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.act === "import") {
    const file = t.files[0]; if (!file) return;
    try { const dd = JSON.parse(await file.text());
      if (dd.appId !== "sakuzu") throw new Error("このファイルはサクズのものではありません");
      if (!(dd.schemaVersion >= 1 && dd.schemaVersion <= SCHEMA_VERSION)) throw new Error("このファイルは新しい版のアプリで作られています。アプリを更新してください");
      if (!Array.isArray(dd.steps)) throw new Error("ファイルが壊れています");
      if (S.drawings.some((x) => x.id === dd.id)) dd.id = newUid();
      await store.put(normalize(dd)); S.msg = { text: `「${dd.name}」を読み込みました` };
    } catch (err) { S.msg = { cls: "err", text: err instanceof SyntaxError ? "ファイルが壊れています" : err.message }; }
    return openList();
  }
  if (t.dataset.f) { S.form[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value; return; }
  if (t.dataset.step) {
    const v = num(t.value); const s = S.doc.steps.find((x) => x.id === t.dataset.step);
    if (!(v >= 0)) { S.msg = { cls: "err", text: "数値を入れてください" }; return render(); }
    const before = snap(); s[t.dataset.k] = t.dataset.k === "angleDeg" ? v : roundHalfUp(v, 3); touch(true, before); S.msg = null; return render();
  }
  const k = t.dataset.set; if (!k) return;
  if (k === "name") { const before = snap(); S.doc.name = t.value || S.doc.name; touch(true, before); return; }
  if (k === "tol") { const v = num(t.value); if (!(v >= 0 && v <= 10)) { S.msg = { cls: "err", text: "許容値は0〜10cmで入れてください" }; return render(); } S.prefs.tolCm = v; await store.putPrefs(S.prefs); S.pts = solve(S.doc, tol()); return render(); }
  if (k === "rot") { const v = num(t.value); if (!Number.isFinite(v)) return render(); const before = snap(); S.doc.sheet.rotationDeg = normDeg(v); touch(true, before); render(); return fit(); }
  if (k === "northAng") { const v = num(t.value); if (!Number.isFinite(v) || !S.doc.north) return render(); const before = snap(); S.doc.north.angleDeg = normDeg(v); touch(true, before); return render(); }
  if (k === "showArea") return setSheet("showArea", t.checked, false);
  if (k === "showWitnessTable") return setSheet("showWitnessTable", t.checked, false);
  if (k === "textVertical") { S.textVertical = t.checked; return; }
  if (["title", "author"].includes(k)) return setSheet(k, t.value, false);
});
$app.addEventListener("input", (e) => { const t = e.target; if (t.dataset.f && t.type !== "checkbox") S.form[t.dataset.f] = t.value; });
window.addEventListener("resize", () => S.view === "editor" && drawSvg());

// PWA（公開サイトでだけ登録する。動作確認用の1ファイル版では登録しない）
if ("serviceWorker" in navigator && location.protocol === "https:" && !document.documentElement.dataset.preview) {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => { const w = reg.installing; w?.addEventListener("statechange", () => {
      if (w.state === "installed" && navigator.serviceWorker.controller) { S.msg = { html: `新しい版があります。<button class="btn sm" data-act="reload">更新する</button>`, text: "" }; render(); } }); });
  }).catch(() => {});
  $app.addEventListener("click", (e) => { if (e.target.closest("[data-act=reload]")) location.reload(); });
}

(async () => { const p = await store.getPrefs(); if (p && p.tolCm != null) S.prefs = { ...S.prefs, ...p }; openList(); })();
