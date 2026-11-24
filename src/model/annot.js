// 周囲の記載（自由図形・引き出し線）と引照点（F-033〜F-039）
import { newId } from "./document.js";
import { usable } from "./solver.js";
import { rotate } from "../shared/rotate.js";

/** 2つの角から四角を作る。rotDeg は置いたときの画面の回転（画面でそろった四角にする） */
export function addRect(doc, p1, p2, rotDeg, text = "") {
  const a = rotate(p1, rotDeg), b = rotate(p2, rotDeg);
  const c = rotate({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, -rotDeg);
  const sh = { id: newId(), type: "rect", cx: c.x, cy: c.y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), angleDeg: -rotDeg, text };
  doc.shapes.push(sh); return sh;
}
export function rectCorners(sh) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const p = rotate({ x: sx * sh.w / 2, y: sy * sh.h / 2 }, sh.angleDeg);
    return { x: sh.cx + p.x, y: sh.cy + p.y };
  });
}
export function addFreeLine(doc, a, b) { const sh = { id: newId(), type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y }; doc.shapes.push(sh); return sh; }
export function addFreeDim(doc, a, b, label = "") { const sh = { id: newId(), type: "dim", x1: a.x, y1: a.y, x2: b.x, y2: b.y, label }; doc.shapes.push(sh); return sh; }
/** 引き出し線。target は {pointId} または {x,y} */
export function addLeader(doc, target, pos, text) {
  const sh = { id: newId(), type: "leader", target: { ...target }, x: pos.x, y: pos.y, text };
  doc.shapes.push(sh); return sh;
}
export function leaderTarget(sh, pts) {
  if (sh.target.pointId) { const p = pts.get(sh.target.pointId); return usable(p) ? { x: p.x, y: p.y } : null; }
  return { x: sh.target.x, y: sh.target.y };
}
/** 引き出し線の起点だけを付け替える。pointId があれば点に付け（点が動けば追従）、なければ自由な位置に固定する */
export function setLeaderTarget(sh, p) {
  sh.target = p.pointId ? { pointId: p.pointId } : { x: p.x, y: p.y };
}
/** 図形の代表位置（移動・選択用） */
export function shapeAnchor(sh) {
  if (sh.type === "rect") return { x: sh.cx, y: sh.cy };
  if (sh.type === "line" || sh.type === "dim") return { x: (sh.x1 + sh.x2) / 2, y: (sh.y1 + sh.y2) / 2 };
  return { x: sh.x, y: sh.y };
}
export function moveShape(sh, dx, dy) {
  if (sh.type === "rect") { sh.cx += dx; sh.cy += dy; }
  else if (sh.type === "line" || sh.type === "dim") { sh.x1 += dx; sh.y1 += dy; sh.x2 += dx; sh.y2 += dy; }
  else { sh.x += dx; sh.y += dy; if (sh.type === "leader" && !sh.target.pointId) { sh.target.x += dx; sh.target.y += dy; } }
}

/** 引照点（F-039） */
export function setWitness(doc, pointId, name, targets) {
  doc.witnesses = doc.witnesses.filter((w) => w.pointId !== pointId);
  const w = { id: newId(), pointId, name, targets: [...new Set(targets)].filter((t) => t !== pointId) };
  doc.witnesses.push(w); return w;
}
/** 手順で入力した距離か（入力値なら、その値を返す） */
export function measuredDistance(doc, a, b) {
  for (const s of doc.steps) {
    if (s.type === "circles" && (s.id === a || s.id === b)) {
      const other = s.id === a ? b : a;
      if (s.a === other) return s.da;
      if (s.b === other) return s.db;
    }
    if (s.type === "polar" && !s.isClosing && ((s.id === a && s.from === b) || (s.id === b && s.from === a))) return s.d;
  }
  return null;
}
export function witnessRows(doc, pts) {
  const rows = [];
  for (const w of doc.witnesses) {
    const P = pts.get(w.pointId);
    for (const t of w.targets) {
      const Q = pts.get(t);
      const m = measuredDistance(doc, w.pointId, t);
      const ok = usable(P) && usable(Q);
      rows.push({ witnessId: w.id, name: w.name, pointId: w.pointId, target: t, dist: m ?? (ok ? Math.hypot(Q.x - P.x, Q.y - P.y) : null), measured: m != null, ok });
    }
  }
  return rows;
}
