// F-020 DXFの書き出し。図面の内容を R12（ASCII）の DXF 文字列にする。DOMに触らない。
// 【想定】の仕様（発案者のCADで開けるかを確かめて確定する）:
//  - 座標は作図の座標そのまま（m、x右・y上）。図面の回転（見た目だけの回転、F-029）は掛けない
//  - 文字の高さは、印刷の縮尺で 2.5mm になる長さ（den はプレビューで選ばれた縮尺の分母）
//  - レイヤー名は英字。点は POINT と点名の文字。斜線の塗り（ハッチ）は書き出さない
//  - 縦書きの文字は、1文字ずつ下へ並べる
import { DxfWriter } from "../shared/dxfwriter.js";
import { formatLength, formatArea } from "../shared/round.js";
import { usable } from "./solver.js";
import { closedAreas, roomTable, roadGeometry, polygonArea, sanshaOf } from "./elements.js";
import { rectCorners, leaderTarget, witnessRows } from "./annot.js";
import { symbolGeometry } from "./symbols.js";

export const DXF_LAYERS = { point: "SZ_POINT", line: "SZ_LINE", room: "SZ_ROOM", road: "SZ_ROAD", dim: "SZ_DIM", area: "SZ_AREA", text: "SZ_TEXT", shape: "SZ_SHAPE", witness: "SZ_WITNESS", sansha: "SZ_SANSHA", north: "SZ_NORTH", sym: "SZ_SYMBOL" };

export function toDxf(doc, pts, { den = 100, computedSuffix = "（計算値）", areaLabel = "概算面積" } = {}) {
  const w = new DxfWriter(), L = DXF_LAYERS, unit = doc.sheet.unit;
  w.layer(L.point, 3); w.layer(L.line, 7); w.layer(L.room, 4); w.layer(L.road, 8); w.layer(L.dim, 2); w.layer(L.area, 2); w.layer(L.text, 7); w.layer(L.shape, 6); w.layer(L.witness, 1, "DASHED"); w.layer(L.sansha, 5); w.layer(L.north, 7); w.layer(L.sym, 6);
  const th = 0.0025 * den, P = (id) => pts.get(id), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const readable = (a, b) => { let d = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; if (d > 90) d -= 180; if (d <= -90) d += 180; return d; };
  const along = (layer, a, b, s, off) => { const len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 1e-9) return; const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }; const m = mid(a, b); w.text(layer, { x: m.x + n.x * off, y: m.y + n.y * off }, th, s, readable(a, b)); };
  const vtext = (layer, p, s, h) => { [...s].forEach((ch, i) => w.text(layer, { x: p.x, y: p.y - i * h * 1.15 }, h, ch)); };
  // 点
  for (const s of doc.steps) { const p = P(s.id); if (!usable(p)) continue; w.point(L.point, p); w.text(L.point, { x: p.x + th * 0.6, y: p.y + th * 0.6 }, th * 0.8, s.label, 0, "left"); }
  // 線・部屋
  for (const l of doc.lines) { const ps = l.points.map(P); if (ps.some((p) => !usable(p))) continue; w.polyline(L.line, ps, !!l.closed); }
  for (const r of doc.rooms) { const ps = r.points.map(P); if (ps.some((p) => !usable(p))) continue; w.polyline(L.room, ps, true);
    const pa = polygonArea(pts, r.points); if (pa.centroid) { w.text(L.room, pa.centroid, th * 1.2, r.name); w.text(L.room, { x: pa.centroid.x, y: pa.centroid.y - th * 1.6 }, th, `${formatArea(pa.area)}㎡`); } }
  // 道路
  for (const road of doc.roads) { const r = roadGeometry(doc, pts, road); if (!r) continue; w.line(L.road, r.far[0], r.far[1]); w.line(L.road, r.near[0], r.near[1]); w.line(L.dim, r.dim[0], r.dim[1]); along(L.dim, r.dim[0], r.dim[1], `${road.name ? road.name + " " : ""}幅 ${formatLength(road.width, unit)}`, th * 0.8); }
  // 寸法（印刷と同じ位置: 動かした寸法は offsetM、ほかは線の外側）
  for (const dm of doc.dims) { const a = P(dm.a), b = P(dm.b); if (!usable(a) || !usable(b)) continue; const len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 1e-9) continue;
    let off = dm.offsetM ?? th * 1.2; if (dm.offsetM == null && (b.x - a.x) < 0) off = -off; // 印刷と同様に上側へ
    along(L.dim, a, b, formatLength(len, unit) + (dm.computed ? computedSuffix : ""), off); }
  // 概算面積
  if (doc.sheet.showArea) for (const ca of closedAreas(doc, pts)) if (ca.centroid) { const lo = doc.lines.find((x) => x.id === ca.lineId)?.areaOffset; w.text(L.area, { x: ca.centroid.x + (lo?.dx || 0), y: ca.centroid.y + (lo?.dy || 0) - th * 2 }, th, `${areaLabel} ${formatArea(ca.area)}㎡`); }
  // 三斜（F-028）
  for (const l of doc.lines) if (l.closed && l.sansha) { const s = sanshaOf(l, pts); if (s.code) continue;
    for (const d of s.diags) w.line(L.sansha, s.ps[d.ia], s.ps[d.ib]);
    for (const r of s.rows) { w.line(L.sansha, s.ps[r.apex], r.foot); const c = r.tri.map((i) => s.ps[i]).reduce((m, p) => ({ x: m.x + p.x / 3, y: m.y + p.y / 3 }), { x: 0, y: 0 }); w.text(L.sansha, c, th, `(${r.no})`); } }
  // 文字
  for (const t of doc.texts) { const h = th * ((t.size || 3) / 2.5); if (t.vertical) vtext(L.text, t, t.text, h); else w.text(L.text, t, h, t.text); }
  // 自由図形
  for (const sh of doc.shapes) {
    if (sh.type === "rect") { w.polyline(L.shape, rectCorners(sh), true); if (sh.text) { if (sh.vertical) vtext(L.shape, { x: sh.cx, y: sh.cy }, sh.text, th); else w.text(L.shape, { x: sh.cx, y: sh.cy }, th, sh.text); } }
    else if (sh.type === "sym") { const gm = symbolGeometry(sh); for (const p of gm.polys) w.polyline(L.sym, p.pts, p.closed); for (const t of gm.texts) w.text(L.sym, t, th * 0.75, t.text); }
    else if (sh.type === "line") w.line(L.shape, { x: sh.x1, y: sh.y1 }, { x: sh.x2, y: sh.y2 });
    else if (sh.type === "dim") { const a = { x: sh.x1, y: sh.y1 }, b = { x: sh.x2, y: sh.y2 }; w.line(L.dim, a, b); along(L.dim, a, b, sh.label || `${formatLength(Math.hypot(b.x - a.x, b.y - a.y), unit)}${computedSuffix}`, th * 0.8); }
    else if (sh.type === "leader") { const tp = leaderTarget(sh, pts); if (!tp) continue; w.line(L.shape, { x: sh.x, y: sh.y }, tp); w.circle(L.shape, tp, th * 0.2); w.text(L.shape, { x: sh.x, y: sh.y + th * 0.6 }, th, sh.text); }
  }
  // 引照点
  for (const r of witnessRows(doc, pts)) { if (!r.ok) continue; const a = P(r.pointId), b = P(r.target); w.line(L.witness, a, b); along(L.witness, a, b, formatLength(r.dist, unit) + (r.measured ? "" : computedSuffix), th * 0.8); }
  for (const wt of doc.witnesses) { const p = P(wt.pointId); if (!usable(p)) continue; w.circle(L.witness, p, th * 0.5); w.text(L.witness, { x: p.x + th * 0.8, y: p.y + th * 0.8 }, th, wt.name, 0, "left"); }
  // 北の記号（矢印と N）
  if (doc.north) { const a = (doc.north.angleDeg || 0) * Math.PI / 180, s = th * 3, c = doc.north; const dir = { x: -Math.sin(a), y: Math.cos(a) };
    const tip = { x: c.x + dir.x * s, y: c.y + dir.y * s }, tail = { x: c.x - dir.x * s, y: c.y - dir.y * s };
    w.line(L.north, tail, tip); w.line(L.north, tip, { x: tip.x - dir.x * s * 0.4 + dir.y * s * 0.25, y: tip.y - dir.y * s * 0.4 - dir.x * s * 0.25 }); w.line(L.north, tip, { x: tip.x - dir.x * s * 0.4 - dir.y * s * 0.25, y: tip.y - dir.y * s * 0.4 + dir.x * s * 0.25 });
    w.text(L.north, { x: tip.x + dir.x * th, y: tip.y + dir.y * th }, th, "N", (doc.north.angleDeg || 0)); }
  // 部屋の一覧は、図の下に文字で置く
  const rt = roomTable(doc, pts);
  if (rt.rows.length) { const ys = [...pts.values()].filter(usable).map((p) => p.y), xs = [...pts.values()].filter(usable).map((p) => p.x); let y = Math.min(...ys) - th * 4; const x = Math.min(...xs);
    for (const r of rt.rows) { w.text(L.room, { x, y }, th, `${r.name} ${r.area != null ? formatArea(r.area) + "㎡" : "-"}`, 0, "left"); y -= th * 1.6; }
    w.text(L.room, { x, y }, th, `合計 ${formatArea(rt.total)}㎡`, 0, "left"); }
  return w.toString();
}
