// SZ-0.6.0: F-019 交点・垂線の足
import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing } from "../src/model/document.js";
import { addBase, addCross, addFoot, collectDependents, orderIsValid } from "../src/model/edit.js";
import { solve } from "../src/model/solver.js";
import { lineIntersect, perpFoot } from "../src/shared/construct.js";

const r3 = (v) => Math.round(v * 1000) / 1000;

test("交点: 延ばした線どうしの交点。平行・同じ点はエラー。浅い角度は注意", () => {
  assert.deepEqual(lineIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }).point, { x: 3, y: 0 });
  assert.equal(lineIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }).code, "LINES_PARALLEL");
  assert.equal(lineIntersect({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }).code, "LINE_SAME_POINTS");
  const d = createDrawing("t"); const o = d.steps[0].id;
  const a = addBase(d, 4, 0), b = addBase(d, 0, 3), c = addBase(d, 4, 3);
  const x = addCross(d, { a1: o, a2: c.id, b1: a.id, b2: b.id }); // 対角線の交点
  let p = solve(d).get(x.id); assert.deepEqual([r3(p.x), r3(p.y), p.status], [2, 1.5, "ok"]);
  const s1 = addBase(d, 10, 0.5); // o→a（x軸）と o→s1（約2.9°）
  const y = addCross(d, { a1: o, a2: a.id, b1: o, b2: s1.id }); p = solve(d).get(y.id);
  assert.equal(p.status, "warn"); assert.ok(p.shallow);
});

test("垂線の足: 線を延ばした先でも求まる。元の点を直すと追従し、削除すると依存も消える", () => {
  const d = createDrawing("t"); const o = d.steps[0].id;
  const a = addBase(d, 5, 0), p = addBase(d, 7, 3);
  const f = addFoot(d, { p: p.id, a: o, b: a.id });
  let q = solve(d).get(f.id); assert.deepEqual([r3(q.x), r3(q.y)], [7, 0]);
  p.x = 2; q = solve(d).get(f.id); assert.deepEqual([r3(q.x), r3(q.y)], [2, 0]);
  assert.ok(collectDependents(d, p.id).points.has(f.id));
  assert.equal(perpFoot({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }).code, "LINE_SAME_POINTS");
  assert.equal(orderIsValid([f, ...d.steps.filter((s) => s !== f)]), false); // 参照より前には置けない
});

// F-028 三斜求積
import { addManualLine } from "../src/model/edit.js";
import { sanshaOf, flipSansha } from "../src/model/elements.js";
import { buildSheet } from "../src/ui/sheet.js";

test("三斜: 20×30mの長方形。2つの三角形、倍面積の合計と面積（切り捨て）、対角線の入れ替え", () => {
  const d = createDrawing("t"); const o = d.steps[0].id;
  const a = addBase(d, 20, 0), b = addBase(d, 20, 30), c = addBase(d, 0, 30);
  const l = addManualLine(d, [o, a.id, b.id, c.id], true); l.sansha = true;
  const pts = solve(d); const s = sanshaOf(l, pts);
  assert.equal(s.rows.length, 2); assert.equal(s.diags.length, 1);
  assert.equal(s.T, s.rows[0].double + s.rows[1].double);
  assert.ok(Math.abs(Number(s.areaText) - 600) < 0.1); assert.match(s.areaText, /^\d+\.\d\d$/);
  const before = s.diags[0];
  assert.deepEqual(flipSansha(l, pts, before.a, before.b), { ok: true });
  const s2 = sanshaOf(l, pts); assert.notDeepEqual([s2.diags[0].a, s2.diags[0].b].sort(), [before.a, before.b].sort());
  const svg = buildSheet(d, pts).svg; assert.match(svg, /三斜求積表/); assert.match(svg, new RegExp(s2.areaText.replace(".", "\\.") + "㎡"));
});

test("三斜: L字（へこみあり）でも分けられ、合計が座標の面積とほぼ一致。点を動かして分け方が合わなくなったら分け直す", () => {
  const d = createDrawing("t"); const o = d.steps[0].id;
  const p = [[20, 0], [20, 10], [10, 10], [10, 30], [0, 30]].map(([x, y]) => addBase(d, x, y).id);
  const l = addManualLine(d, [o, ...p], true); l.sansha = true;
  let s = sanshaOf(l, solve(d)); assert.equal(s.rows.length, 4); assert.ok(Math.abs(s.diff) <= s.tolerance + 1e-9);
  l.sanshaTris = [[0, 1, 2]]; // 古い分け方
  s = sanshaOf(l, solve(d)); assert.equal(s.rows.length, 4);
  // へこんだ四角形になる対角線は入れ替えられない
  const bad = s.diags.find((x) => flipSansha(structuredClone(l), solve(d), x.a, x.b).code === "FLIP_NOT_CONVEX");
  assert.ok(bad);
});

// F-020 DXFの書き出し
import { toDxf, DXF_LAYERS } from "../src/model/dxfexport.js";
import { parseDxf, decodeText } from "../src/shared/importers.js";
import { encodeSjis } from "../src/shared/sjis.js";
import { addRoom, addText } from "../src/model/edit.js";
import { addRect, addLeader } from "../src/model/annot.js";

test("DXF: 書き出したものを読み戻すと、点・閉じた線・部屋・レイヤーがそろう。日本語は Shift_JIS で往復できる", () => {
  const d = createDrawing("車庫"); const o = d.steps[0].id;
  const a = addBase(d, 2.5, 0), b = addBase(d, 2.5, 5.5), c = addBase(d, 0, 5.5);
  const l = addManualLine(d, [o, a.id, b.id, c.id], true); l.sansha = true; d.sheet.showArea = true;
  addRoom(d, "駐車場", [o, a.id, b.id, c.id]);
  addText(d, -1, 2, "公道").vertical = true;
  addRect(d, { x: 4, y: 0 }, { x: 8, y: 5 }, 0, "物置");
  addLeader(d, { pointId: b.id }, { x: -2, y: 7 }, "保管場所");
  d.north = { x: 6, y: 7, angleDeg: 15 };
  const pts = solve(d);
  const text = toDxf(d, pts, { den: 100 });
  assert.match(text, /AC1009/); assert.match(text, /ANSI_932/);
  const bytes = encodeSjis(text); const back = decodeText(bytes);
  assert.equal(back.encoding, "shift_jis"); assert.match(back.text, /駐車場/); assert.match(back.text, /概算面積 13\.75㎡/);
  const r = parseDxf(back.text);
  for (const k of ["point", "line", "room", "dim", "text", "shape", "sansha", "north"]) assert.ok(r.layers.includes(DXF_LAYERS[k]) || k === "dim" || k === "text", k);
  assert.equal(r.points.length, 4);
  const closed = r.polylines.filter((p) => p.closed && p.layer === DXF_LAYERS.line);
  assert.equal(closed.length, 1); assert.deepEqual(closed[0].pts.map((p) => [p.x, p.y]), [[0, 0], [2.5, 0], [2.5, 5.5], [0, 5.5]]);
  assert.equal(r.polylines.filter((p) => p.layer === DXF_LAYERS.sansha).length, 1 + 2); // 対角線1・高さ2
  assert.ok((back.text.match(/\r\n1\r\n[公道]\r\n/g) || []).length === 2); // 縦書きは1文字ずつ
});

// F-021 什器・出入口の記号
import { SYMBOLS, addSymbol, symbolGeometry } from "../src/model/symbols.js";
import { moveShape } from "../src/model/annot.js";

test("記号: すべての種類が置け、形が大きさの範囲に収まる。回転・反転・移動が形に反映され、印刷とDXFに出る", () => {
  const d = createDrawing("店"); addBase(d, 5, 4);
  for (const k of Object.keys(SYMBOLS)) {
    const sh = addSymbol(d, k, { x: 2, y: 1 });
    const ps = symbolGeometry(sh).polys.flatMap((p) => p.pts);
    for (const p of ps) { assert.ok(Math.abs(p.x - 2) <= sh.w / 2 + 1e-9 && Math.abs(p.y - 1) <= sh.h / 2 + 1e-9, `${k} の形が枠の外 ${JSON.stringify(p)}`); }
  }
  const door = d.shapes.find((s) => s.kind === "door");
  const before = symbolGeometry(door).polys[0].pts.map((p) => [p.x, p.y]);
  door.mirror = true; const mir = symbolGeometry(door).polys[0].pts.map((p) => [p.x, p.y]);
  assert.deepEqual(mir.map(([x, y]) => [Math.round((4 - x) * 1e9) / 1e9, y]), before.map(([x, y]) => [Math.round(x * 1e9) / 1e9, y])); // 中心 x=2 で左右反転
  door.angleDeg = 90; moveShape(door, 1, 0); assert.equal(door.cx, 3);
  const pts = solve(d);
  assert.match(buildSheet(d, pts).svg, /冷蔵庫/);
  const dx = parseDxf(toDxf(d, pts)); assert.ok(dx.layers.includes("SZ_SYMBOL"));
  assert.equal(addSymbol(d, "nothing", { x: 0, y: 0 }), null);
});
