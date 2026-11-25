// 図面（印刷用）のSVGを作る（F-013・F-029・F-030・F-032）
import { usable } from "../model/solver.js";
import { roomTable, roadGeometry, closedAreas, polygonArea, sanshaOf } from "../model/elements.js";
import { rotate, readableDeg } from "../shared/rotate.js";
import { paperSize, selectDrawingScale } from "../shared/print.js";
import { formatLength, formatArea } from "../shared/round.js";
import { formatYmd } from "../shared/date.js";
import { COMPUTED_SUFFIX, AREA_LABEL } from "./messages.js";
import { annotDefs, annotSvg, hatchFill, textSvg } from "./annot-svg.js";
import { witnessRows, rectCorners, leaderTarget } from "../model/annot.js";
import { symbolGeometry } from "../model/symbols.js";

export const SCALES = [20, 30, 50, 100, 150, 200, 250, 300, 500];
const escS = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function buildSheet(doc, pts) {
  const sh = doc.sheet, rot = sh.rotationDeg || 0, unit = sh.unit;
  const { w: W, h: H } = paperSize(sh.paper, sh.orientation);
  const sanshas = doc.lines.filter((l) => l.closed && l.sansha).map((l) => sanshaOf(l, pts)).filter((s) => !s.code);
  const M = 10, TB = 16, rooms = roomTable(doc, pts), wrows = sh.showWitnessTable ? witnessRows(doc, pts) : [], TW = rooms.rows.length || wrows.length || sanshas.length ? 62 : 0, PAD = 8;
  const AO = { id: "pr", lw: 0.25, fs: 3, sym: 1.2, arrow: 2.5, hatch: 1.5 };
  const area = { x: M + PAD, y: M + PAD, w: W - 2 * M - TW - 2 * PAD, h: H - 2 * M - TB - 2 * PAD };
  const R = (p) => rotate(p, rot);
  // 外接矩形（回転後）
  const all = [];
  for (const [, p] of pts) if (usable(p)) all.push(R(p));
  const roads = doc.roads.map((road) => ({ road, g: roadGeometry(doc, pts, road) })).filter((x) => x.g);
  for (const { g } of roads) all.push(...g.far.map(R), ...g.near.map(R));
  for (const t of doc.texts) all.push(R(t));
  for (const s2 of doc.shapes || []) {
    if (s2.type === "rect") all.push(...rectCorners(s2).map(R));
    else if (s2.type === "sym") for (const p of symbolGeometry(s2).polys) all.push(...p.pts.map(R));
    else if (s2.type === "line" || s2.type === "dim") all.push(R({ x: s2.x1, y: s2.y1 }), R({ x: s2.x2, y: s2.y2 }));
    else { all.push(R(s2)); const tp = leaderTarget(s2, pts); if (tp) all.push(R(tp)); }
  }
  if (!all.length) return { svg: "", empty: true, W, H };
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const bw = Math.max(...xs) - Math.min(...xs) || 1, bh = Math.max(...ys) - Math.min(...ys) || 1;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const sc = selectDrawingScale(bw, bh, area.w, area.h, SCALES);
  const k = 1000 / sc.denominator; // mm / m
  const ox = area.x + area.w / 2, oy = area.y + area.h / 2;
  const T = (p) => { const q = R(p); return { x: ox + (q.x - cx) * k, y: oy - (q.y - cy) * k }; };
  const P = (id) => pts.get(id);
  let g = "";
  // 道路
  for (const { road, g: r } of roads) {
    const a = T(r.far[0]), b = T(r.far[1]);
    g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#000" stroke-width="0.35"/>`;
    const n0 = T(r.near[0]), n1 = T(r.near[1]);
    g += `<line x1="${n0.x}" y1="${n0.y}" x2="${n1.x}" y2="${n1.y}" stroke="#000" stroke-width="0.2" stroke-dasharray="1.5 1"/>`;
    g += dimSvg(T(r.dim[0]), T(r.dim[1]), 0, `${road.name ? escS(road.name) + " " : ""}幅 ${formatLength(road.width, unit)}`, false);
  }
  // 部屋
  for (const r of doc.rooms) {
    const ps = r.points.map(P); if (ps.some((p) => !usable(p))) continue;
    g += `<polygon points="${ps.map(T).map((p) => `${p.x},${p.y}`).join(" ")}" fill="${r.hatch ? hatchFill(AO) : "none"}" stroke="#000" stroke-width="0.35"/>`;
    const pa = polygonArea(pts, r.points);
    if (pa.centroid) { const c = T(pa.centroid); g += `<text x="${c.x}" y="${c.y}" font-size="3" text-anchor="middle">${escS(r.name)}</text><text x="${c.x}" y="${c.y + 4}" font-size="2.5" text-anchor="middle">${formatArea(pa.area)}㎡</text>`; }
  }
  // 線
  for (const l of doc.lines) {
    const ps = l.points.map(P); if (ps.some((p) => !usable(p))) continue;
    const d = ps.map(T).map((p) => `${p.x},${p.y}`).join(" ");
    g += l.closed ? `<polygon points="${d}" fill="${l.hatch ? hatchFill(AO) : "none"}" stroke="#000" stroke-width="0.5"/>` : `<polyline points="${d}" fill="none" stroke="#000" stroke-width="0.5"/>`;
  }
  // 寸法
  for (const dm of doc.dims) {
    const a = P(dm.a), b = P(dm.b); if (!usable(a) || !usable(b)) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1e-9) continue;
    let at = null;
    if (dm.offsetM != null) { const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L; at = T({ x: (a.x + b.x) / 2 + nx * dm.offsetM, y: (a.y + b.y) / 2 + ny * dm.offsetM }); }
    g += dimSvg(T(a), T(b), 5, formatLength(L, unit) + (dm.computed ? COMPUTED_SUFFIX : ""), true, at);
  }
  // 概算面積（切り替えで印刷に載せる）
  if (sh.showArea) for (const ca of closedAreas(doc, pts)) if (ca.centroid) { const lo = doc.lines.find((x) => x.id === ca.lineId)?.areaOffset; const c = T({ x: ca.centroid.x + (lo?.dx || 0), y: ca.centroid.y + (lo?.dy || 0) }); g += `<text x="${c.x}" y="${c.y + 8}" font-size="2.5" text-anchor="middle">${AREA_LABEL} ${formatArea(ca.area)}㎡</text>`; }
  // 三斜（F-028）
  for (const s of sanshas) g += sanshaOverlay(s, T, { lw: 0.18, fs: 2.4, dash: "1 0.8", color: "#000" });
  // 文字
  for (const t of doc.texts) { const c = T(t); g += textSvg(c.x, c.y, t.text, t.size || 3, !!t.vertical); }
  g += annotSvg(doc, pts, T, AO);
  // 北の記号（作図上の角度に、図面の回転を足す）
  if (doc.north) { const c = T(doc.north); g += northSvg(c.x, c.y, (doc.north.angleDeg || 0) + rot, 7); }
  // 部屋の一覧表
  let tbl = "";
  if (TW) {
    const x0 = W - M - TW, y0 = M; let y = y0 + 7;
    tbl += `<rect x="${x0}" y="${y0}" width="${TW}" height="${H - 2 * M - TB}" fill="none" stroke="#000" stroke-width="0.3"/>`;
    if (rooms.rows.length) {
      tbl += `<text x="${x0 + 3}" y="${y}" font-size="3.2" font-weight="700">部屋の一覧</text>`;
      for (const r of rooms.rows) { y += 6; tbl += `<text x="${x0 + 3}" y="${y}" font-size="2.8">${escS(r.name)}</text><text x="${x0 + TW - 3}" y="${y}" font-size="2.8" text-anchor="end">${r.area != null ? formatArea(r.area) + "㎡" : "—"}</text>`; }
      y += 7; tbl += `<line x1="${x0 + 2}" y1="${y - 4.5}" x2="${x0 + TW - 2}" y2="${y - 4.5}" stroke="#000" stroke-width="0.2"/><text x="${x0 + 3}" y="${y}" font-size="2.8" font-weight="700">合計</text><text x="${x0 + TW - 3}" y="${y}" font-size="2.8" font-weight="700" text-anchor="end">${formatArea(rooms.total)}㎡</text>`;
      y += 10;
    }
    sanshas.forEach((s, si) => { // 三斜求積表
      tbl += `<text x="${x0 + 3}" y="${y}" font-size="3.2" font-weight="700">三斜求積表${sanshas.length > 1 ? `（${si + 1}）` : ""}</text>`;
      y += 5; tbl += `<text x="${x0 + 3}" y="${y}" font-size="2.2">番号</text><text x="${x0 + 25}" y="${y}" font-size="2.2" text-anchor="end">底辺</text><text x="${x0 + 38}" y="${y}" font-size="2.2" text-anchor="end">高さ</text><text x="${x0 + TW - 3}" y="${y}" font-size="2.2" text-anchor="end">倍面積</text>`;
      for (const r of s.rowText) { y += 4.2; tbl += `<text x="${x0 + 3}" y="${y}" font-size="2.4">(${r.no})</text><text x="${x0 + 25}" y="${y}" font-size="2.4" text-anchor="end">${r.b}</text><text x="${x0 + 38}" y="${y}" font-size="2.4" text-anchor="end">${r.h}</text><text x="${x0 + TW - 3}" y="${y}" font-size="2.4" text-anchor="end">${r.dbl}</text>`; }
      y += 5.5; tbl += `<line x1="${x0 + 2}" y1="${y - 3.8}" x2="${x0 + TW - 2}" y2="${y - 3.8}" stroke="#000" stroke-width="0.2"/><text x="${x0 + 3}" y="${y}" font-size="2.4">倍面積の合計</text><text x="${x0 + TW - 3}" y="${y}" font-size="2.4" text-anchor="end">${s.doubleText}</text>`;
      y += 4.5; tbl += `<text x="${x0 + 3}" y="${y}" font-size="2.6" font-weight="700">面積</text><text x="${x0 + TW - 3}" y="${y}" font-size="2.6" font-weight="700" text-anchor="end">${s.areaText}㎡</text>`;
      y += 10;
    });
    if (wrows.length) {
      const lab = (id) => doc.steps.find((x) => x.id === id)?.label ?? "?";
      tbl += `<text x="${x0 + 3}" y="${y}" font-size="3.2" font-weight="700">引照点の一覧</text>`;
      for (const r of wrows) { y += 6; tbl += `<text x="${x0 + 3}" y="${y}" font-size="2.6">${escS(r.name)} → ${lab(r.target)}</text><text x="${x0 + TW - 3}" y="${y}" font-size="2.6" text-anchor="end">${r.dist != null ? formatLength(r.dist, unit) + (r.measured ? "" : COMPUTED_SUFFIX) : "—"}</text>`; }
    }
  }
  // 表題欄
  const ty = H - M - TB, scaleTxt = sc.fixed ? `1/${sc.denominator}` : "任意";
  const tb = `<rect x="${M}" y="${ty}" width="${W - 2 * M}" height="${TB}" fill="none" stroke="#000" stroke-width="0.3"/>
   <text x="${M + 4}" y="${ty + 10}" font-size="5" font-weight="700">${escS(sh.title || doc.name)}</text>
   <text x="${W - M - 4}" y="${ty + 6.5}" font-size="2.8" text-anchor="end">縮尺 ${scaleTxt}　作成日 ${formatYmd(sh.createdDate) || "—"}</text>
   <text x="${W - M - 4}" y="${ty + 12}" font-size="2.8" text-anchor="end">作成者 ${escS(sh.author) || "—"}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" style="font-family: var(--font, sans-serif)">
   ${annotDefs(AO)}<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/><rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" fill="none" stroke="#000" stroke-width="0.5"/>${g}${tbl}${tb}</svg>`;
  return { svg, W, H, scale: sc };
}

/** 寸法（線に沿った文字。off は線から外側への離れ mm） */
export function dimSvg(a, b, off, label, outward, at = null) {
  const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1e-6) return "";
  let nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
  if (outward && ny > 0) { nx = -nx; ny = -ny; }
  const m = at ?? { x: (a.x + b.x) / 2 + nx * off * 0.5, y: (a.y + b.y) / 2 + ny * off * 0.5 };
  const ang = readableDeg(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
  return `<text x="${m.x}" y="${m.y}" font-size="2.5" text-anchor="middle" dominant-baseline="middle" transform="rotate(${ang} ${m.x} ${m.y})" stroke="#fff" stroke-width="0.8" paint-order="stroke">${label}</text>`;
}
/** 北の記号（angleDeg: 数学の向きで、北が上から何度回っているか。反時計回りが正） */
export function northSvg(x, y, angleDeg, s) {
  const r = -angleDeg; // SVGは時計回りが正
  return `<g transform="translate(${x} ${y}) rotate(${r})"><circle r="${s * 0.55}" fill="none" stroke="#000" stroke-width="${s * 0.04}"/><path d="M0 ${-s * 0.5} L${s * 0.2} ${s * 0.3} L0 ${s * 0.15} L${-s * 0.2} ${s * 0.3} Z" fill="#000"/><text y="${-s * 0.62}" font-size="${s * 0.35}" text-anchor="middle">N</text></g>`;
}

/** 三斜の線（対角線・高さ）と三角形の番号。T は座標を描く位置に変える関数（画面と印刷で共通） */
export function sanshaOverlay(s, T, o) {
  let g = "";
  for (const d of s.diags) { const a = T(s.ps[d.ia]), b = T(s.ps[d.ib]); g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${o.color}" stroke-width="${o.lw}"/>`; }
  for (const r of s.rows) {
    const a = T(s.ps[r.apex]), f = T(r.foot), b0 = T(s.ps[r.base[0]]), b1 = T(s.ps[r.base[1]]);
    g += `<line x1="${a.x}" y1="${a.y}" x2="${f.x}" y2="${f.y}" stroke="${o.color}" stroke-width="${o.lw}" stroke-dasharray="${o.dash}"/>`;
    // 足が底辺の外に出たときは、底辺を点線で延ばす
    const L = Math.hypot(b1.x - b0.x, b1.y - b0.y), t = L ? ((f.x - b0.x) * (b1.x - b0.x) + (f.y - b0.y) * (b1.y - b0.y)) / (L * L) : 0;
    if (t < 0 || t > 1) { const e = t < 0 ? b0 : b1; g += `<line x1="${e.x}" y1="${e.y}" x2="${f.x}" y2="${f.y}" stroke="${o.color}" stroke-width="${o.lw}" stroke-dasharray="${o.dash}"/>`; }
    const c = r.tri.map((i) => T(s.ps[i])).reduce((m, p) => ({ x: m.x + p.x / 3, y: m.y + p.y / 3 }), { x: 0, y: 0 });
    g += `<text x="${c.x}" y="${c.y}" font-size="${o.fs}" text-anchor="middle" dominant-baseline="middle" fill="${o.color}" stroke="#fff" stroke-width="${o.fs * 0.25}" paint-order="stroke">(${r.no})</text>`;
  }
  return g;
}
