// 周囲の記載と引照点のSVG（作図画面と印刷で共通。T は実座標→描画座標、o は大きさの設定）
import { rectCorners, leaderTarget, witnessRows } from "../model/annot.js";
import { usable } from "../model/solver.js";
import { symbolGeometry } from "../model/symbols.js";
import { formatLength } from "../shared/round.js";
import { readableDeg } from "../shared/rotate.js";
import { COMPUTED_SUFFIX } from "./messages.js";

const escA = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** 斜線の模様と矢印（<defs>） */
export function annotDefs(o) {
  return `<defs><pattern id="${o.id}-hatch" width="${o.hatch}" height="${o.hatch}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${o.hatch}" stroke="#000" stroke-width="${o.lw}"/></pattern>
   <marker id="${o.id}-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="${o.arrow}" markerHeight="${o.arrow}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#000"/></marker>
   <marker id="${o.id}-dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="${o.arrow * 0.7}" markerHeight="${o.arrow * 0.7}" markerUnits="userSpaceOnUse"><circle cx="5" cy="5" r="4" fill="#000"/></marker></defs>`;
}
export const hatchFill = (o) => `url(#${o.id}-hatch)`;

/** 文字（縦書きは1文字ずつ下へ並べる） */
export function textSvg(x, y, text, fs, vertical = false, extra = "") {
  const t = escA(text);
  if (!vertical) return `<text x="${x}" y="${y}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" ${extra}>${t}</text>`;
  const chars = [...String(text ?? "")];
  const y0 = y - (chars.length - 1) * fs * 1.05 / 2;
  return `<text x="${x}" y="${y0}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" ${extra}>${chars.map((c, i) => `<tspan x="${x}" ${i ? `dy="${fs * 1.05}"` : ""}>${escA(c)}</tspan>`).join("")}</text>`;
}

function labelOnLine(a, b, label, fs, off) {
  const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1e-6) return "";
  const nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L;
  const s = ny > 0 ? -1 : 1;
  const m = { x: (a.x + b.x) / 2 + nx * off * s, y: (a.y + b.y) / 2 + ny * off * s };
  const ang = readableDeg(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
  return `<text x="${m.x}" y="${m.y}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${ang} ${m.x} ${m.y})" stroke="#fff" stroke-width="${fs * 0.25}" paint-order="stroke">${escA(label)}</text>`;
}

export function annotSvg(doc, pts, T, o) {
  const unit = doc.sheet.unit; let g = "";
  for (const sh of doc.shapes) {
    if (sh.type === "rect") {
      const c = rectCorners(sh).map(T);
      g += `<polygon points="${c.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#000" stroke-width="${o.lw * 1.2}"/>`;
      if (sh.text) { const m = T({ x: sh.cx, y: sh.cy }); g += textSvg(m.x, m.y, sh.text, o.fs, !!sh.vertical); }
    } else if (sh.type === "sym") { // F-021 什器・出入口
      const gm = symbolGeometry(sh);
      for (const p of gm.polys) { const q = p.pts.map(T).map((v) => `${v.x},${v.y}`).join(" "); g += p.closed ? `<polygon points="${q}" fill="#fff" stroke="#000" stroke-width="${o.lw}"/>` : `<polyline points="${q}" fill="none" stroke="#000" stroke-width="${o.lw}"/>`; }
      for (const t of gm.texts) { const m = T(t); g += textSvg(m.x, m.y + o.fs * 0.3, t.text, o.fs * 0.75, false); }
    } else if (sh.type === "line") {
      const a = T({ x: sh.x1, y: sh.y1 }), b = T({ x: sh.x2, y: sh.y2 });
      g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#000" stroke-width="${o.lw * 1.2}"/>`;
    } else if (sh.type === "dim") {
      const a = T({ x: sh.x1, y: sh.y1 }), b = T({ x: sh.x2, y: sh.y2 });
      g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#000" stroke-width="${o.lw}" marker-start="url(#${o.id}-arrow)" marker-end="url(#${o.id}-arrow)"/>`;
      const len = Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1);
      g += labelOnLine(a, b, sh.label || `${formatLength(len, unit)}${COMPUTED_SUFFIX}`, o.fs * 0.85, o.fs * 0.8);
    } else if (sh.type === "leader") {
      const tp = leaderTarget(sh, pts); if (!tp) continue;
      const a = T(tp), b = T({ x: sh.x, y: sh.y });
      g += `<line x1="${b.x}" y1="${b.y}" x2="${a.x}" y2="${a.y}" stroke="#000" stroke-width="${o.lw}" marker-end="url(#${o.id}-dot)"/>`;
      g += textSvg(b.x, b.y - o.fs * 0.2, sh.text, o.fs, false, `stroke="#fff" stroke-width="${o.fs * 0.25}" paint-order="stroke"`);
    }
  }
  // 引照点
  const rows = witnessRows(doc, pts);
  for (const r of rows) {
    if (!r.ok) continue;
    const a = T(pts.get(r.pointId)), b = T(pts.get(r.target));
    g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#000" stroke-width="${o.lw * 0.8}" stroke-dasharray="${o.lw * 6} ${o.lw * 4}"/>`;
    g += labelOnLine(a, b, formatLength(r.dist, unit) + (r.measured ? "" : COMPUTED_SUFFIX), o.fs * 0.85, o.fs * 0.7);
  }
  for (const w of doc.witnesses) {
    const p = pts.get(w.pointId); if (!usable(p)) continue;
    const c = T(p), R = o.sym;
    g += `<circle cx="${c.x}" cy="${c.y}" r="${R}" fill="#fff" stroke="#000" stroke-width="${o.lw}"/><line x1="${c.x - R * 1.4}" y1="${c.y}" x2="${c.x + R * 1.4}" y2="${c.y}" stroke="#000" stroke-width="${o.lw}"/><line x1="${c.x}" y1="${c.y - R * 1.4}" x2="${c.x}" y2="${c.y + R * 1.4}" stroke="#000" stroke-width="${o.lw}"/>`;
    g += `<text x="${c.x + R * 1.8}" y="${c.y - R * 1.8}" font-size="${o.fs}" stroke="#fff" stroke-width="${o.fs * 0.25}" paint-order="stroke">${escA(w.name)}</text>`;
  }
  return g;
}
