// 共通にする候補（C-04b）。座標は数学の向き（x右・y上、単位m）
import { dist } from "./geometry.js";

/** from から、heading(rad) に turn（L:+θ / R:-θ / S:0）を足した向きへ d 進む */
export function polar(from, headingRad, turn, angleDeg, d) {
  const t = turn === "L" ? 1 : turn === "R" ? -1 : 0;
  const h = headingRad + t * (angleDeg * Math.PI / 180);
  return { x: from.x + d * Math.cos(h), y: from.y + d * Math.sin(h), heading: h };
}

/** 二円交点。side: "L" は A→B の左側、"R" は右側 */
export function circleIntersect(A, da, B, db, side, tol = 0) {
  const D = dist(A, B);
  if (D < 1e-9) return { status: "error", code: "CIRCLE_SAME_CENTER" };
  let x = (da * da - db * db + D * D) / (2 * D);
  let h2 = da * da - x * x;
  let status = "ok", gap = 0;
  if (h2 < 0) {
    gap = Math.max(D - (da + db), Math.abs(da - db) - D);
    if (gap > tol + 1e-12) return { status: "error", code: "CIRCLE_NO_INTERSECTION", gap };
    x = Math.max(-da, Math.min(da, x));
    h2 = 0; status = "tangent";
  }
  const h = Math.sqrt(h2);
  const ux = (B.x - A.x) / D, uy = (B.y - A.y) / D;
  const s = side === "R" ? -1 : 1;
  return { status, gap, point: { x: A.x + ux * x - uy * h * s, y: A.y + uy * x + ux * h * s } };
}

export function candidates(A, da, B, db, tol = 0) {
  const l = circleIntersect(A, da, B, db, "L", tol);
  if (l.status === "error") return l;
  const r = circleIntersect(A, da, B, db, "R", tol);
  return { status: l.status, gap: l.gap, L: l.point, R: r.point };
}

/** 2本の直線（a1-a2 と b1-b2 を延ばした線）の交点。平行なら error。交わる角度が浅いときは angleDeg を返す */
export function lineIntersect(a1, a2, b1, b2) {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y, dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const L1 = Math.hypot(dx1, dy1), L2 = Math.hypot(dx2, dy2);
  if (L1 < 1e-9 || L2 < 1e-9) return { status: "error", code: "LINE_SAME_POINTS" };
  const den = dx1 * dy2 - dy1 * dx2, sin = den / (L1 * L2);
  if (Math.abs(sin) < 1e-9) return { status: "error", code: "LINES_PARALLEL" };
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / den;
  return { status: "ok", point: { x: a1.x + t * dx1, y: a1.y + t * dy1 }, angleDeg: Math.asin(Math.min(1, Math.abs(sin))) * 180 / Math.PI };
}

/** 点 p から直線 a-b（延ばした線）へ下ろした垂線の足 */
export function perpFoot(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  if (L2 < 1e-18) return { status: "error", code: "LINE_SAME_POINTS" };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  return { status: "ok", point: { x: a.x + t * dx, y: a.y + t * dy }, t };
}
