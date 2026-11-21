// 手順の追加・削除（SZ-L04）と、線の自動生成
import { newId, nextLabel, refsOfStep } from "./document.js";

/** from を終点とする直前の辺（polar で作った点なら from-of-from → from） */
export function defaultRef(doc, fromId) {
  const s = doc.steps.find((x) => x.id === fromId);
  if (s?.type === "polar") return [s.from, s.id];
  for (const l of doc.lines) {
    const i = l.points.lastIndexOf(fromId);
    if (i > 0) return [l.points[i - 1], fromId];
  }
  return null;
}

export function addPolar(doc, { from, ref, turn, angleDeg, d, closing = false }) {
  const step = { id: newId(), type: "polar", label: nextLabel(doc), from, ref, turn, angleDeg, d };
  if (closing) step.isClosing = true;
  doc.steps.push(step);
  let line = doc.lines.find((l) => !l.closed && l.points[l.points.length - 1] === from);
  if (closing) {
    if (!line) line = { id: newId(), points: [from], closed: false };
    if (!doc.lines.includes(line)) doc.lines.push(line);
    line.closed = true;
    line.closure = { stepId: step.id, choice: "pending" };
    if (line.points.length >= 2) doc.dims.push({ id: newId(), a: line.points[line.points.length - 1], b: line.points[0], offset: 0.4, auto: true, stepId: step.id });
  } else {
    if (!line) { line = { id: newId(), points: [from], closed: false }; doc.lines.push(line); }
    line.points.push(step.id);
    doc.dims.push({ id: newId(), a: from, b: step.id, offset: 0.4, auto: true, stepId: step.id });
  }
  return step;
}

export function addCircles(doc, { a, da, b, db }) {
  const step = { id: newId(), type: "circles", label: nextLabel(doc), a, da, b, db, side: null };
  doc.steps.push(step);
  return step;
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
  }
  doc.lines = doc.lines.filter((l) => l.points.length >= 2);
  doc.rooms = doc.rooms.filter((r) => !r.points.some((p) => points.has(p)));
  return points.size;
}
