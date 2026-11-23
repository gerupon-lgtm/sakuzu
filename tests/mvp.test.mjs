import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing } from "../src/model/document.js";
import { addPolar, addCircles, defaultRef, closeLineAt, addManualLine, addManualDim, addRoom, addRoad, deletePoint, normalize } from "../src/model/edit.js";
import { solve } from "../src/model/solver.js";
import { roomTable, roadGeometry, closedAreas } from "../src/model/elements.js";
import { alignAngle, rotate, normDeg, readableDeg } from "../src/shared/rotate.js";
import { selectDrawingScale, paperSize } from "../src/shared/print.js";
import { todayJst, parseDateInput, formatTyping } from "../src/shared/date.js";
import { formatArea } from "../src/shared/round.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
function rect(w = 5, h = 2.5, closeMeasured = null) {
  const doc = createDrawing(); const p1 = doc.steps[0].id;
  const p2 = addPolar(doc, { from: p1, ref: null, turn: "S", angleDeg: 0, d: w });
  const p3 = addPolar(doc, { from: p2.id, ref: defaultRef(doc, p2.id), turn: "R", angleDeg: 90, d: h });
  const p4 = addPolar(doc, { from: p3.id, ref: defaultRef(doc, p3.id), turn: "R", angleDeg: 90, d: w });
  return { doc, p1, p2, p3, p4 };
}

test("F-030: 測らずに閉じると、閉じる辺に計算値の寸法が付く（受入基準19）", () => {
  const { doc, p1, p4 } = rect();
  closeLineAt(doc, p4.id);
  const closing = doc.dims.find((d) => d.a === p4.id && d.b === p1);
  assert.ok(closing); assert.equal(closing.computed, true);
  assert.equal(doc.dims.filter((d) => !d.computed).length, 3); // 入力した3辺は計算値ではない
});

test("F-030: 測って閉じた場合も、閉じる辺は計算値", () => {
  const { doc, p1, p4 } = rect();
  addPolar(doc, { from: p4.id, ref: defaultRef(doc, p4.id), turn: "R", angleDeg: 90, d: 2.51, closing: true });
  assert.equal(doc.dims.find((d) => d.a === p4.id && d.b === p1).computed, true);
});

test("F-032: 概算面積 12.50 → 最初の辺を5.20にすると12.75（受入基準21）", () => {
  const { doc, p2, p4 } = rect();
  closeLineAt(doc, p4.id);
  let a = closedAreas(doc, solve(doc));
  assert.equal(formatArea(a[0].area), "12.50");
  p2.d = 5.2;
  a = closedAreas(doc, solve(doc));
  assert.equal(formatArea(a[0].area), "12.75");
});

test("F-032: 交差・計算できない点", () => {
  const doc = createDrawing(); const p1 = doc.steps[0].id;
  const a = addPolar(doc, { from: p1, ref: null, turn: "S", angleDeg: 0, d: 2 });
  const b = addPolar(doc, { from: a.id, ref: defaultRef(doc, a.id), turn: "L", angleDeg: 135, d: Math.SQRT2 * 2 });
  const c = addPolar(doc, { from: b.id, ref: null, turn: "S", angleDeg: 0, d: 2 });
  addManualLine(doc, [p1, c.id, a.id, b.id], true);  // 交差する四角形（ちょうちょ形）
  const pts = solve(doc);
  assert.equal(closedAreas(doc, pts).at(-1).code, "POLY_SELF_INTERSECT");
  a.d = -1; // 計算できない
  assert.equal(closedAreas(doc, solve(doc)).at(-1).code, "BLOCKED");
});

test("F-008: 部屋の面積と合計（受入基準8）", () => {
  const doc = createDrawing(); const o = doc.steps[0].id;
  const x3 = addPolar(doc, { from: o, ref: null, turn: "S", angleDeg: 0, d: 3 });
  const x5 = addPolar(doc, { from: x3.id, ref: defaultRef(doc, x3.id), turn: "S", angleDeg: 0, d: 2 });
  const y5 = addPolar(doc, { from: x5.id, ref: defaultRef(doc, x5.id), turn: "L", angleDeg: 90, d: 4 });
  const y3 = addPolar(doc, { from: y5.id, ref: defaultRef(doc, y5.id), turn: "L", angleDeg: 90, d: 2 });
  const y0 = addPolar(doc, { from: y3.id, ref: defaultRef(doc, y3.id), turn: "S", angleDeg: 0, d: 3 });
  addRoom(doc, "客席", [o, x3.id, y3.id, y0.id]);
  addRoom(doc, "厨房", [x3.id, x5.id, y5.id, y3.id]);
  const t = roomTable(doc, solve(doc));
  assert.deepEqual(t.rows.map((r) => formatArea(r.area)), ["12.00", "8.00"]);
  assert.equal(formatArea(t.total), "20.00");
});

test("F-009: 道路は敷地の外側に描かれ、向きを切り替えられる", () => {
  const { doc, p1, p2, p4 } = rect();
  closeLineAt(doc, p4.id);
  const road = addRoad(doc, [p1, p2.id], 4, "市道");
  const pts = solve(doc);
  let g = roadGeometry(doc, pts, road);
  near(g.far[0].y, 4); near(g.near[0].x, -1); near(g.near[1].x, 6);   // 敷地は y<0 側なので、道路は y>0 側
  road.flip = true; g = roadGeometry(doc, pts, road);
  near(g.far[0].y, -4);
  deletePoint(doc, p2.id); assert.equal(doc.roads.length, 0);
});

test("F-029: 回転（辺を水平・垂直にそろえる）", () => {
  near(alignAngle({ x: 0, y: 0 }, { x: 1, y: 1 }, "h"), -45);
  near(alignAngle({ x: 0, y: 0 }, { x: 1, y: 1 }, "v"), 45);
  near(alignAngle({ x: 0, y: 0 }, { x: -1, y: 0 }, "h"), 0);   // 逆向きの水平線は回さない
  const p = rotate({ x: 1, y: 1 }, -45); near(p.y, 0); near(p.x, Math.SQRT2);
  assert.equal(normDeg(190), -170); assert.equal(readableDeg(120), -60);
});

test("F-031: 2点間の距離（3-4-5）", () => {
  const doc = createDrawing(); const a = doc.steps[0].id;
  const b = addPolar(doc, { from: a, ref: null, turn: "S", angleDeg: 0, d: 4 });
  const c = addCircles(doc, { a, da: 5, b: b.id, db: 3 }); c.side = "L";
  const pts = solve(doc); const P = pts.get(a), Q = pts.get(c.id);
  near(Math.hypot(Q.x - P.x, Q.y - P.y), 5);
  const dm = addManualDim(doc, a, b.id); assert.equal(dm, null); // 既にある辺は重複させない
});

test("図面の縮尺の選び方", () => {
  const C = [20, 30, 50, 100, 150, 200, 250, 300, 500];
  assert.equal(selectDrawingScale(6, 3, 200, 140, C).denominator, 30);     // 駐車場 6m（ちょうど収まる）
  assert.equal(selectDrawingScale(6.5, 3, 200, 140, C).denominator, 50);
  assert.equal(selectDrawingScale(10, 8, 200, 140, C).denominator, 100);   // 店内 10m
  const r = selectDrawingScale(200, 100, 200, 140, C); assert.equal(r.fixed, false); near(r.denominator, 1000);
  assert.deepEqual(paperSize("A4", "portrait"), { w: 210, h: 297 });
});

test("作成日（TZ=UTC で日本時間の日付）", () => {
  assert.equal(todayJst(new Date("2026-11-21T14:59:59Z")), "2026-11-21");
  assert.equal(todayJst(new Date("2026-11-21T15:00:00Z")), "2026-11-22");
  assert.equal(todayJst(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
  assert.equal(parseDateInput("2028/02/29").ymd, "2028-02-29");
  assert.equal(parseDateInput("2026/02/29").code, "DATE_INVALID");
  assert.equal(parseDateInput("２０２６１１２３").ymd, "2026-11-23");
  assert.equal(formatTyping("20261123"), "2026/11/23");
});

test("古いデータの読み込み（項目の補完）", () => {
  const d = createDrawing(); delete d.texts; delete d.sheet.rotationDeg; d.dims.push({ a: 1, b: 2 });
  normalize(d); assert.deepEqual(d.texts, []); assert.equal(d.sheet.rotationDeg, 0); assert.equal(d.dims[0].computed, false);
});
