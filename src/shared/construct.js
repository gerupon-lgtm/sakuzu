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
