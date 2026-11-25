// SZ-L01〜L03: 手順を順に計算する。状態: ok / warn / error / pending / blocked
import { polar, circleIntersect, candidates, lineIntersect, perpFoot } from "../shared/construct.js";
import { headingOf, dist } from "../shared/geometry.js";
import { refsOfStep } from "./document.js";

export const SHALLOW_DEG = 10; // 【想定】交点の注意を出す角度
export const usable = (p) => p && (p.status === "ok" || p.status === "warn");

export function solve(doc, tol = 0.03) {
  const pts = new Map();
  for (const s of doc.steps) {
    const refs = refsOfStep(s).map((id) => pts.get(id));
    if (refs.some((p) => !usable(p))) { pts.set(s.id, { status: "blocked" }); continue; }
    if (s.type === "base") { pts.set(s.id, { x: s.x, y: s.y, status: "ok" }); continue; }
    if (s.type === "polar") {
      if (!(s.d > 0)) { pts.set(s.id, { status: "error", code: "POLAR_BAD_DISTANCE" }); continue; }
      if (!(s.angleDeg >= 0 && s.angleDeg <= 180)) { pts.set(s.id, { status: "error", code: "POLAR_BAD_ANGLE" }); continue; }
      const from = pts.get(s.from);
      const h = s.ref ? headingOf(pts.get(s.ref[0]), pts.get(s.ref[1])) : 0;
      const p = polar(from, h, s.turn, s.angleDeg, s.d);
      pts.set(s.id, { x: p.x, y: p.y, status: "ok" });
      continue;
    }
    if (s.type === "cross") { // F-019 2本の線の交点。交わる角度が10°未満なら注意（少しの誤差で位置が大きく動くため）
      const r = lineIntersect(pts.get(s.a1), pts.get(s.a2), pts.get(s.b1), pts.get(s.b2));
      if (r.status === "error") { pts.set(s.id, { status: "error", code: r.code }); continue; }
      pts.set(s.id, { ...r.point, status: r.angleDeg < SHALLOW_DEG ? "warn" : "ok", angleDeg: r.angleDeg, shallow: r.angleDeg < SHALLOW_DEG });
      continue;
    }
    if (s.type === "foot") { // F-019 垂線の足
      const r = perpFoot(pts.get(s.p), pts.get(s.a), pts.get(s.b));
      if (r.status === "error") { pts.set(s.id, { status: "error", code: r.code }); continue; }
      pts.set(s.id, { ...r.point, status: "ok" });
      continue;
    }
    if (s.type === "circles") {
      const A = pts.get(s.a), B = pts.get(s.b);
      if (!(s.da > 0 && s.db > 0)) { pts.set(s.id, { status: "error", code: "POLAR_BAD_DISTANCE" }); continue; }
      if (!s.side) {
        const c = candidates(A, s.da, B, s.db, tol);
        if (c.status === "error") { pts.set(s.id, { status: "error", code: c.code, gap: c.gap }); continue; }
        pts.set(s.id, { status: "pending", candidates: { L: c.L, R: c.R }, gap: c.gap }); continue;
      }
      const r = circleIntersect(A, s.da, B, s.db, s.side, tol);
      if (r.status === "error") { pts.set(s.id, { status: "error", code: r.code, gap: r.gap }); continue; }
      pts.set(s.id, { ...r.point, status: r.status === "tangent" ? "warn" : "ok", gap: r.gap });
    }
  }
  return pts;
}

/** 閉合のずれ（SZ-L05）。closing の polar 手順の到達点 E と、線の始点 S の差 */
export function misclosure(doc, pts, line) {
  if (!line?.closure) return null;
  const E = pts.get(line.closure.stepId), S = pts.get(line.points[0]);
  if (!usable(E) || !usable(S)) return null;
  const v = { x: E.x - S.x, y: E.y - S.y };
  return { v, len: Math.hypot(v.x, v.y), none: Math.hypot(v.x, v.y) < 0.0005 };
}

/** ずれの向きと平行（20°以内）な辺を返す（測り直す箇所の目安） */
export function suspectEdges(pts, line, v, maxDeg = 20) {
  const out = [], n = line.points.length;
  const va = Math.atan2(v.y, v.x);
  for (let i = 0; i < n; i++) {
    const a = pts.get(line.points[i]), b = pts.get(line.points[(i + 1) % n]);
    if (!usable(a) || !usable(b) || dist(a, b) < 1e-9) continue;
    let d = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) - va) % Math.PI;
    d = Math.min(d, Math.PI - d) * 180 / Math.PI;
    if (d <= maxDeg) out.push([line.points[i], line.points[(i + 1) % n]]);
  }
  return out;
}
