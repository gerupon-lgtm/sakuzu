// 手順・図面要素の追加と削除（SZ-L04〜L07）
import { newId, nextLabel, refsOfStep } from "./document.js";

/** from を終点とする直前の辺（polar で作った点なら from-of-from → from） */
export function defaultRef(doc, fromId) {
  const s = doc.steps.find((x) => x.id === fromId);
  if (s?.type === "polar" && !s.isClosing) return [s.from, s.id];
  for (const l of doc.lines) {
    const i = l.points.lastIndexOf(fromId);
    if (i > 0) return [l.points[i - 1], fromId];
  }
  return null;
}
const sameEdge = (d, a, b) => (d.a === a && d.b === b) || (d.a === b && d.b === a);
function addDim(doc, a, b, computed, stepId) {
  if (a === b || doc.dims.some((d) => sameEdge(d, a, b))) return null;
  const dm = { id: newId(), a, b, offset: 0.4, auto: true, computed };
  if (stepId) dm.stepId = stepId;
  doc.dims.push(dm);
  return dm;
}

export function addPolar(doc, { from, ref, turn, angleDeg, d, closing = false }) {
  const step = { id: newId(), type: "polar", label: nextLabel(doc), from, ref, turn, angleDeg, d };
  if (closing) step.isClosing = true;
  doc.steps.push(step);
  let line = doc.lines.find((l) => !l.closed && l.points[l.points.length - 1] === from);
  if (closing) {
    if (!line) { line = { id: newId(), points: [from], closed: false }; doc.lines.push(line); }
    line.closed = true;
    line.closure = { stepId: step.id, choice: "pending" };
    // 閉じる辺（最後の点→最初の点）は座標から計算した長さ（F-030）
    if (line.points.length >= 2) addDim(doc, line.points[line.points.length - 1], line.points[0], true, step.id);
  } else {
    if (!line) { line = { id: newId(), points: [from], closed: false }; doc.lines.push(line); }
    line.points.push(step.id);
    addDim(doc, from, step.id, false, step.id);
  }
  return step;
}

/** 測っていない辺で閉じる（F-007・F-030） */
export function closeLineAt(doc, lastPointId) {
  const l = doc.lines.find((x) => !x.closed && x.points[x.points.length - 1] === lastPointId);
  if (!l || l.points.length < 3) return null;
  l.closed = true;
  addDim(doc, l.points[l.points.length - 1], l.points[0], true);
  return l;
}

/** 点をつないで引いた線（辺の長さはすべて計算値） */
export function addManualLine(doc, points, closed) {
  const l = { id: newId(), points: [...points], closed };
  doc.lines.push(l);
  const n = points.length;
  for (let i = 0; i < n - 1; i++) addDim(doc, points[i], points[i + 1], true);
  if (closed && n >= 3) addDim(doc, points[n - 1], points[0], true);
  return l;
}

export function addManualDim(doc, a, b) {
  // 距離と方向で入れた辺と同じなら、入力値として扱う
  const s = doc.steps.find((x) => x.type === "polar" && !x.isClosing && ((x.from === a && x.id === b) || (x.from === b && x.id === a)));
  return addDim(doc, a, b, !s, s?.id);
}

export function addCircles(doc, { a, da, b, db }) {
  const step = { id: newId(), type: "circles", label: nextLabel(doc), a, da, b, db, side: null };
  doc.steps.push(step);
  return step;
}

export function addRoom(doc, name, points) {
  const r = { id: newId(), name, points: [...points] };
  doc.rooms.push(r); return r;
}
export function addRoad(doc, edge, width, name) {
  const r = { id: newId(), edge: [...edge], width, name, flip: false };
  doc.roads.push(r);
  return r;
}
export function addText(doc, x, y, text, size = 3) {
  const t = { id: newId(), x, y, text, size }; doc.texts.push(t); return t;
}

/** 点に依存するものを推移的に集める */
export function collectDependents(doc, pointId) {
  const dead = new Set([pointId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of doc.steps) {
      if (!dead.has(s.id) && refsOfStep(s).some((r) => dead.has(r))) { dead.add(s.id); changed = true; }
    }
  }
  const dims = doc.dims.filter((d) => dead.has(d.a) || dead.has(d.b) || dead.has(d.stepId));
  return { points: dead, dims };
}

export function deletePoint(doc, pointId) {
  const { points, dims } = collectDependents(doc, pointId);
  doc.steps = doc.steps.filter((s) => !points.has(s.id));
  doc.dims = doc.dims.filter((d) => !dims.includes(d));
  for (const l of doc.lines) {
    l.points = l.points.filter((p) => !points.has(p));
    if (l.closure && points.has(l.closure.stepId)) { delete l.closure; l.closed = false; }
    if (l.closed && l.points.length < 3) l.closed = false;
  }
  doc.lines = doc.lines.filter((l) => l.points.length >= 2);
  doc.rooms = doc.rooms.filter((r) => !r.points.some((p) => points.has(p)));
  doc.roads = doc.roads.filter((r) => !r.edge.some((p) => points.has(p)));
  doc.witnesses = (doc.witnesses || []).filter((w) => !points.has(w.pointId)).map((w) => ({ ...w, targets: w.targets.filter((t) => !points.has(t)) }));
  doc.shapes = (doc.shapes || []).filter((sh) => !(sh.type === "leader" && points.has(sh.target.pointId)));
  return points.size;
}

/** 古いデータに、後から追加した項目の既定値を入れる */
export function normalize(doc) {
  doc.texts ??= []; doc.rooms ??= []; doc.roads ??= []; doc.dims ??= []; doc.lines ??= [];
  doc.north ??= null; doc.shapes ??= []; doc.witnesses ??= [];
  for (const t of doc.texts) t.vertical ??= false;
  doc.sheet = { paper: "A4", orientation: "landscape", unit: "m", title: "", createdDate: "", author: "", rotationDeg: 0, showArea: false, showWitnessTable: false, ...(doc.sheet || {}) };
  for (const d of doc.dims) d.computed ??= false;
  for (const s of doc.steps) s.label = String(s.label ?? "").replace(/[<>&"]/g, ""); // 画面に出す名前から記号を除く（読み込んだファイル対策）
  return doc;
}

/** 基準点を追加する（F-002。2つ目以降の基準点） */
export function addBase(doc, x, y) {
  const step = { id: newId(), type: "base", label: nextLabel(doc), x, y };
  doc.steps.push(step); return step;
}

/** 手順の並べ替えが「前の手順だけを参照する」制約を守るか */
export function orderIsValid(steps) {
  const seen = new Set();
  for (const s of steps) { if (refsOfStep(s).some((r) => !seen.has(r))) return false; seen.add(s.id); }
  return true;
}
/** 手順を1つ上（dir=-1）または下（dir=+1）へ動かす。制約を破る場合は動かさず false */
export function moveStep(doc, id, dir) {
  const i = doc.steps.findIndex((s) => s.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= doc.steps.length) return false;
  const next = [...doc.steps]; [next[i], next[j]] = [next[j], next[i]];
  if (!orderIsValid(next)) return false;
  doc.steps = next; return true;
}
