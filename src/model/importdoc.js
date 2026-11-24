// 読み取った内容を図面に入れる（F-022〜F-027）。座標点は type "base"（imported: true）の手順になる。
import { newId, nextLabel } from "./document.js";
import { addManualLine } from "./edit.js";

const MM = 0.001; // 同じ点とみなす差（1mm未満）
const key = (x, y) => `${Math.round(x / MM)},${Math.round(y / MM)}`;

/** 取り込み前の点の一覧（2点指定の縮尺に使う）。ファイルの単位のまま、座標の重複を除く */
export function importCandidates(data) {
  const seen = new Map(); let n = 0;
  const add = (p) => { const k = `${p.x},${p.y}`; if (!seen.has(k)) seen.set(k, { name: p.name || `点${++n}`, x: p.x, y: p.y }); else if (p.name && /^点\d+$/.test(seen.get(k).name)) seen.get(k).name = p.name; };
  for (const p of data.points) add(p);
  for (const pl of data.polylines) for (const p of pl.pts) add(p);
  return [...seen.values()];
}
/** 2点の実際の長さから倍率を出す（倍率 = L ÷ ファイル上の長さ） */
export function scaleFromTwo(a, b, lengthM) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(d > 0)) return { error: "samePoint" };
  if (!(lengthM > 0)) return { error: "badLength" };
  return { scale: lengthM / d };
}
export function countPoints(data) { return importCandidates(data).length; }

/**
 * 図面に取り込む。倍率はここで一度だけ座標に掛ける。
 * 点名の重複: 同じ名前・同じ座標 → 1点にまとめる。座標が違う → 「名前-2」にして警告。
 * 名前のない点（DXF）は、同じ座標の点があればそれを使い、なければ P番号を付ける。
 */
export function applyImport(doc, data, { scale = 1 } = {}) {
  const warnings = [...(data.warnings || [])];
  const byKey = new Map(), byLabel = new Map();
  for (const s of doc.steps) {
    byLabel.set(s.label, s);
    if (s.type === "base") byKey.set(key(s.x, s.y), s);
  }
  let added = 0;
  const pointAt = (p) => {
    const x = p.x * scale, y = p.y * scale, k = key(x, y);
    const name = String(p.name || "").replace(/[<>&"]/g, "").trim();
    if (name) {
      const same = byLabel.get(name);
      if (same && same.type === "base" && key(same.x, same.y) === k) return same.id;
      let label = name;
      if (same) { let i = 2; while (byLabel.has(`${name}-${i}`)) i++; label = `${name}-${i}`; warnings.push(`点名「${name}」が重なり、座標が違うため「${label}」として取り込みました`); }
      return make(label, x, y, k);
    }
    const hit = byKey.get(k); if (hit) return hit.id;
    return make(null, x, y, k);
  };
  const make = (label, x, y, k) => {
    const s = { id: newId(), type: "base", imported: true, label: label ?? nextLabel(doc), x, y };
    doc.steps.push(s); byLabel.set(s.label, s); if (!byKey.has(k)) byKey.set(k, s); added++;
    return s.id;
  };
  for (const p of data.points) pointAt(p);
  let lines = 0;
  for (const pl of data.polylines) {
    let ids = pl.pts.map(pointAt).filter((id, i, a) => i === 0 || id !== a[i - 1]);
    let closed = !!pl.closed;
    if (ids.length > 2 && ids[0] === ids[ids.length - 1]) { ids = ids.slice(0, -1); closed = true; }
    if (closed && ids.length < 3) closed = false;
    if (ids.length < 2) continue;
    addManualLine(doc, ids, closed); lines++;
  }
  return { added, lines, warnings };
}
