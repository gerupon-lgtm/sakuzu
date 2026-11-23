// 部屋・道路・閉じた図形の面積（SZ-L06、F-032）
import { area, validatePolygon, signedArea } from "../shared/geometry.js";
import { usable } from "./solver.js";

/** 点IDの列から面積を求める。{area} または {code} */
export function polygonArea(pts, ids) {
  const ps = ids.map((id) => pts.get(id));
  if (ps.some((p) => !usable(p))) return { code: "BLOCKED" };
  const v = validatePolygon(ps);
  if (v) return { code: v };
  return { area: area(ps), centroid: centroid(ps) };
}
export function centroid(ps) {
  const A = signedArea(ps);
  if (Math.abs(A) < 1e-12) return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
  let cx = 0, cy = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i], q = ps[(i + 1) % ps.length], c = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}
/** 部屋の一覧（合計は丸める前の値を足す） */
export function roomTable(doc, pts) {
  const rows = doc.rooms.map((r) => ({ id: r.id, name: r.name, ...polygonArea(pts, r.points) }));
  const total = rows.reduce((s, r) => s + (r.area ?? 0), 0);
  return { rows, total };
}
/** 道路の反対側の線。敷地（この辺を含む閉じた線）の外側へ width だけ平行移動し、両端を ext だけ延ばす */
export function roadGeometry(doc, pts, road, ext = 1) {
  const A = pts.get(road.edge[0]), B = pts.get(road.edge[1]);
  if (!usable(A) || !usable(B)) return null;
  const L = Math.hypot(B.x - A.x, B.y - A.y); if (L < 1e-9) return null;
  const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
  let nx = -uy, ny = ux;                     // 左側の法線
  const site = doc.lines.find((l) => l.closed && l.points.includes(road.edge[0]) && l.points.includes(road.edge[1]));
  if (site) {
    const pa = polygonArea(pts, site.points);
    if (pa.centroid) {
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      if ((pa.centroid.x - mx) * nx + (pa.centroid.y - my) * ny > 0) { nx = -nx; ny = -ny; } // 重心と反対側を外側にする
    }
  }
  if (road.flip) { nx = -nx; ny = -ny; }
  const w = road.width;
  const e1 = { x: A.x - ux * ext, y: A.y - uy * ext }, e2 = { x: B.x + ux * ext, y: B.y + uy * ext };
  return { near: [e1, e2], far: [{ x: e1.x + nx * w, y: e1.y + ny * w }, { x: e2.x + nx * w, y: e2.y + ny * w }],
    dim: [{ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, { x: (A.x + B.x) / 2 + nx * w, y: (A.y + B.y) / 2 + ny * w }] };
}
/** 閉じた線ごとの概算面積（F-032）。ずれがあっても、最初の点で閉じた形で計算する */
export function closedAreas(doc, pts) {
  return doc.lines.filter((l) => l.closed && l.points.length >= 3).map((l) => ({ lineId: l.id, ...polygonArea(pts, l.points) }));
}
