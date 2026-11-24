// ファイルの取り込み画面（F-022〜F-027）。状態を持ち、画面のHTMLを返す。図面への反映は model/importdoc.js。
import { decodeText, parseSima, parseCsv, parseDxf, csvRows, guessCsv, formatOf, ImportError } from "../shared/importers.js";
import { importCandidates, scaleFromTwo, applyImport } from "../model/importdoc.js";

// 選べるファイルを拡張子で絞らない（iPhoneでは知らない拡張子のファイルが選べなくなることがあるため）。形式は拡張子で判定する
const FMT_NAME = { sima: "SIMA", csv: "CSV", dxf: "DXF" };
export const LARGE_COUNT = 2000;
const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** ファイルを受け取って取り込みの状態を作る */
export function startImport(fileName, bytes, canAddToCurrent) {
  const fmt = formatOf(fileName);
  const st = { fileName, bytes, fmt, enc: "auto", used: null, error: null, data: null, rows: null, csv: null, layers: null, allLayers: [], unit: "m", unitHint: null, two: { a: 0, b: 1, L: "" }, dest: "new", canAddToCurrent };
  if (!fmt) st.error = "取り込めるのは SIMA（.sim）・CSV（.csv .txt）・DXF（.dxf）です。作業ファイル（.json）は一覧の「ファイルを読み込む」から読み込んでください";
  else reparse(st, true);
  return st;
}
/** 文字コードや列の指定が変わったら読み直す */
export function reparse(st, first = false) {
  st.error = null; st.data = null;
  try {
    const { text, encoding } = decodeText(st.bytes, st.enc); st.used = encoding;
    if (st.fmt === "sima") st.data = parseSima(text);
    if (st.fmt === "csv") {
      st.rows = csvRows(text);
      if (first || !st.csv) st.csv = guessCsv(st.rows);
      st.data = parseCsv(text, st.csv);
    }
    if (st.fmt === "dxf") {
      const all = parseDxf(text); st.allLayers = all.layers; st.unitHint = all.unitHint;
      if (first) { st.layers = [...all.layers]; if (all.unitHint) st.unit = all.unitHint; }
      st.data = st.layers.length === all.layers.length ? all : parseDxf(text, { layers: st.layers });
    }
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    st.error = e.message;
  }
  if (st.data) { const n = importCandidates(st.data).length; if (st.two.b >= n) st.two = { a: 0, b: Math.min(1, n - 1), L: st.two.L }; }
  return st;
}
/** 倍率（SIMA は m のまま） */
export function scaleOf(st) {
  if (st.fmt === "sima") return { scale: 1 };
  if (st.unit === "two") {
    const c = importCandidates(st.data); const L = Number(String(st.two.L).trim());
    if (String(st.two.L).trim() === "") return { error: "2点の実際の長さ（m）を入れてください" };
    const r = scaleFromTwo(c[st.two.a], c[st.two.b], L);
    return r.error === "samePoint" ? { error: "同じ位置の2点です。別の点を選んでください" } : r.error ? { error: "長さは0より大きい数値で入れてください" } : r;
  }
  return { scale: { mm: 0.001, cm: 0.01, m: 1 }[st.unit] };
}
export function doApply(doc, st) { const { scale } = scaleOf(st); return applyImport(doc, st.data, { scale }); }

const sel = (key, value, opts) => `<select data-imp="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${escH(t)}</option>`).join("")}</select>`;
const seg = (key, value, opts) => `<span class="seg">${opts.map(([v, t]) => `<button class="${v === value ? "on" : ""}" data-act="impSet" data-k="${key}" data-v="${v}">${t}</button>`).join("")}</span>`;

export function importHtml(st) {
  const head = `<h2>ファイルの取り込み</h2><p class="note">${escH(st.fileName)}${st.fmt ? `（${FMT_NAME[st.fmt]}）` : ""}。データはこの端末の中だけで読みます。</p>`;
  if (!st.fmt) return `<div class="imp">${head}<div class="msg err">${escH(st.error)}</div><div class="row"><button class="btn" data-act="impCancel">戻る</button></div></div>`;
  const enc = `<div class="row"><label>文字コード</label>${seg("enc", st.enc, [["auto", "自動"], ["utf-8", "UTF-8"], ["shift_jis", "Shift_JIS"]])}${st.used ? `<span class="note">読んだ文字コード: ${st.used === "utf-8" ? "UTF-8" : "Shift_JIS"}</span>` : ""}</div>`;
  let opts = "";
  if (st.fmt === "csv" && st.rows) {
    const n = Math.max(...st.rows.map((r) => r.length), 0), cols = [...Array(n).keys()].map((i) => [i, `${i + 1}列目${st.csv.header && st.rows[0]?.[i] ? `（${st.rows[0][i]}）` : ""}`]);
    const prev = st.rows.slice(0, 8).map((r, i) => `<tr class="${st.csv.header && i === 0 ? "hd" : ""}">${[...Array(n).keys()].map((c) => `<td class="${c === st.csv.xCol ? "cx" : c === st.csv.yCol ? "cy" : c === st.csv.nameCol ? "cn" : ""}${/^-?[\d.]+$/.test(r[c] ?? "") ? " n" : ""}">${escH(r[c] ?? "")}</td>`).join("")}</tr>`).join("");
    opts += `<div class="scroll"><table class="prev"><tbody>${prev}</tbody></table></div>${st.rows.length > 8 ? `<p class="note">ほか ${st.rows.length - 8} 行</p>` : ""}
     <div class="row"><label>点名の列</label>${sel("nameCol", st.csv.nameCol, [[-1, "なし（P番号を付ける）"], ...cols])}</div>
     <div class="row"><label>Xの列</label>${sel("xCol", st.csv.xCol, cols)}</div>
     <div class="row"><label>Yの列</label>${sel("yCol", st.csv.yCol, cols)}</div>
     <div class="row"><label>見出し行</label><label style="min-width:0"><input type="checkbox" data-imp="header" ${st.csv.header ? "checked" : ""}> 1行目は見出し</label></div>
     <div class="row"><label>軸の向き</label>${seg("axis", st.csv.axis, [["survey", "測量（X北・Y東）"], ["math", "数学（x右・y上）"]])}</div>`;
  }
  if (st.fmt === "dxf" && st.allLayers.length) opts += `<div class="row"><label>レイヤー</label><span>${st.allLayers.map((l) => `<label style="min-width:0;margin-right:10px"><input type="checkbox" data-imp="layer" value="${escH(l)}" ${st.layers.includes(l) ? "checked" : ""}> ${escH(l)}</label>`).join("")}</span></div>`;
  let unit = "";
  if (st.fmt !== "sima" && st.data) {
    const c = importCandidates(st.data), co = c.slice(0, 500).map((p, i) => [i, `${p.name}（${+p.x.toFixed(3)}, ${+p.y.toFixed(3)}）`]);
    unit = `<div class="row"><label>単位</label>${seg("unit", st.unit, [["mm", "mm"], ["cm", "cm"], ["m", "m"], ["two", "2点の長さで指定"]])}${st.fmt === "dxf" ? `<span class="note">${st.unitHint ? `ファイルの指定: ${st.unitHint}` : "ファイルに単位の指定がありません"}</span>` : ""}</div>`
      + (st.unit === "two" ? `<div class="row"><label>点1</label>${sel("twoA", st.two.a, co)}</div><div class="row"><label>点2</label>${sel("twoB", st.two.b, co)}</div><div class="row"><label>実際の長さ</label><input type="number" inputmode="decimal" step="0.001" data-imp="twoL" value="${escH(st.two.L)}"> m</div>` : "");
  }
  let sum = "";
  if (st.error) sum = `<div class="msg err">${escH(st.error)}（取り込んでいません。開いている図面は変わりません）</div>`;
  else if (st.data) {
    const n = importCandidates(st.data).length, sc = scaleOf(st);
    sum = `<div class="msg">点 ${n} 個・線 ${st.data.polylines.length} 本を取り込みます${n > LARGE_COUNT ? `。<b>点が ${LARGE_COUNT} を超えるため、動作が遅くなることがあります</b>` : ""}</div>`
      + (sc.error ? `<div class="msg err">${escH(sc.error)}</div>` : sc.scale !== 1 ? `<p class="note">倍率 ×${+sc.scale.toPrecision(6)}（取り込むときに座標に掛けます）</p>` : "")
      + (st.data.warnings.length ? `<div class="msg warn">${st.data.warnings.slice(0, 10).map(escH).join("<br>")}${st.data.warnings.length > 10 ? `<br>ほか ${st.data.warnings.length - 10} 件` : ""}</div>` : "");
  }
  const dest = st.canAddToCurrent ? `<div class="row"><label>取り込み先</label>${seg("dest", st.dest, [["new", "新しい図面"], ["current", "開いている図面に追加"]])}</div>` : "";
  const ok = st.data && !st.error && !scaleOf(st).error;
  return `<div class="imp">${head}${enc}${opts}${unit}${dest}${sum}<div class="row"><button class="btn primary" data-act="impDo" ${ok ? "" : "disabled"}>取り込む</button><button class="btn" data-act="impCancel">やめる</button></div></div>`;
}

/** 画面の入力を状態に入れる。読み直しが要るときは true */
export function onImpInput(st, t) {
  const k = t.dataset.imp;
  if (k === "nameCol" || k === "xCol" || k === "yCol") { st.csv[k] = +t.value; return true; }
  if (k === "header") { st.csv.header = t.checked; return true; }
  if (k === "layer") { st.layers = t.checked ? [...new Set([...st.layers, t.value])] : st.layers.filter((l) => l !== t.value); if (!st.layers.length) { st.error = "レイヤーを1つ以上選んでください"; st.data = null; return false; } return true; }
  if (k === "twoA") st.two.a = +t.value; if (k === "twoB") st.two.b = +t.value; if (k === "twoL") st.two.L = t.value;
  return false;
}
export function onImpSet(st, key, v) {
  if (key === "enc") { st.enc = v; return true; }
  if (key === "axis") { st.csv.axis = v; return true; }
  if (key === "unit") st.unit = v; if (key === "dest") st.dest = v;
  return false;
}
