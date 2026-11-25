// 部屋・道路・閉じた図形の面積（SZ-L06、F-032）
import { area, validatePolygon, signedArea } from "../shared/geometry.js";
import { usable } from "./solver.js";
import { triangulate, trisValid, diagonals, flip } from "../shared/triangulate.js";
import { sansha, cmText, cm2ToM2Text } from "../shared/sansha.js";

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

/**
 * F-028 三斜求積。閉じた線を三角形に分け、三斜求積表を作る。
 * 分け方は line.sanshaTris に保存（対角線の入れ替えを残すため）。点が変わって合わなくなったら自動で分け直す。
 * 面積は「倍面積の合計 ÷ 2」を 0.01㎡ 未満切り捨て【想定】。座標法の面積との差も返す。
 */
export function sanshaOf(line, pts) {
  const pa = polygonArea(pts, line.points); if (pa.code) return { code: pa.code };
  const ps = line.points.map((id) => pts.get(id));
  let tris = line.sanshaTris && trisValid(ps, line.sanshaTris) ? line.sanshaTris : triangulate(ps);
  if (!tris) return { code: "POLY_SELF_INTERSECT" };
  const r = sansha(ps, tris);
  const half = Math.floor(r.T / 2 / 100); // cm² → 0.01㎡ 単位（切り捨て）
  return { ...r, tris, diags: diagonals(tris, ps.length).map((d) => ({ a: line.points[d.a], b: line.points[d.b], ia: d.a, ib: d.b })),
    areaText: `${Math.floor(half / 100)}.${String(half % 100).padStart(2, "0")}`, doubleText: cm2ToM2Text(r.T), ps,
    rowText: r.rows.map((x) => ({ no: x.no, b: cmText(x.bCm), h: cmText(x.hCm), dbl: cm2ToM2Text(x.double) })) };
}
/** 対角線 a-b（点のid）を入れ替える。凸でない四角形などで入れ替えられないときは code を返す */
export function flipSansha(line, pts, a, b) {
  const s = sanshaOf(line, pts); if (s.code) return s;
  const ia = line.points.indexOf(a), ib = line.points.indexOf(b);
  const r = flip(s.ps, s.tris, ia, ib); if (r.code) return r;
  line.sanshaTris = r.tris; return { ok: true };
}
