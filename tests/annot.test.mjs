import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing } from "../src/model/document.js";
import { addPolar, addCircles, deletePoint, normalize } from "../src/model/edit.js";
import { solve } from "../src/model/solver.js";
import { addRect, rectCorners, addLeader, leaderTarget, setWitness, witnessRows, moveShape, addFreeDim } from "../src/model/annot.js";
import { rotate } from "../src/shared/rotate.js";
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test("F-033: 四角（回転0）", () => {
  const d = createDrawing(); const r = addRect(d, { x: 0, y: 0 }, { x: 4, y: 3 }, 0, "自宅");
  near(r.w, 4); near(r.h, 3); near(r.cx, 2); near(r.cy, 1.5);
  const c = rectCorners(r); near(c[0].x, 0); near(c[2].y, 3);
});
test("F-033: 回転した画面で置いた四角は、画面上でそろう", () => {
  const d = createDrawing(); const rot = 30;
  const p1 = rotate({ x: 0, y: 0 }, -rot), p2 = rotate({ x: 4, y: 3 }, -rot); // 画面上の (0,0)-(4,3)
  const r = addRect(d, p1, p2, rot);
  near(r.w, 4); near(r.h, 3);
  const c = rectCorners(r).map((p) => rotate(p, rot)); near(c[0].x, 0); near(c[0].y, 0); near(c[2].x, 4); near(c[2].y, 3);
});
test("F-038: 引き出し線は点に追従する（受入基準24）", () => {
  const d = createDrawing(); const p1 = d.steps[0].id;
  const p2 = addPolar(d, { from: p1, ref: null, turn: "S", angleDeg: 0, d: 5 });
  const l = addLeader(d, { pointId: p2.id }, { x: 6, y: 2 }, "境界標");
  near(leaderTarget(l, solve(d)).x, 5);
  p2.d = 6; near(leaderTarget(l, solve(d)).x, 6);
  moveShape(l, 1, 1); near(l.x, 7); near(leaderTarget(l, solve(d)).x, 6); // 文字だけ動く
  deletePoint(d, p2.id); assert.equal(d.shapes.length, 0);
});
test("F-039: 引照点の距離は入力値をそのまま使う（受入基準23）", () => {
  const d = createDrawing(); const p1 = d.steps[0].id;
  const p2 = addPolar(d, { from: p1, ref: null, turn: "S", angleDeg: 0, d: 4 });
  const pole = addCircles(d, { a: p1, da: 5.004, b: p2.id, db: 3 }); pole.side = "L";
  setWitness(d, pole.id, "電柱 No.12", [p1, p2.id]);
  const rows = witnessRows(d, solve(d));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].measured, true); assert.equal(rows[0].dist, 5.004);
  assert.equal(rows[1].dist, 3);
  setWitness(d, p2.id, "杭", [pole.id, d.steps[0].id]);       // P2 から電柱は入力値、P1 からも入力値（距離と方向）
  const r2 = witnessRows(d, solve(d)).filter((r) => r.name === "杭");
  assert.equal(r2.find((r) => r.target === pole.id).measured, true);
  assert.equal(r2.find((r) => r.target === p1).dist, 4);
});
test("F-039: 入力していない距離は計算値", () => {
  const d = createDrawing(); const p1 = d.steps[0].id;
  const p2 = addPolar(d, { from: p1, ref: null, turn: "S", angleDeg: 0, d: 3 });
  const p3 = addPolar(d, { from: p2.id, ref: [p1, p2.id], turn: "L", angleDeg: 90, d: 4 });
  setWitness(d, p3.id, "塀角", [p1]);
  const r = witnessRows(d, solve(d))[0];
  assert.equal(r.measured, false); near(r.dist, 5);
  deletePoint(d, p3.id); assert.equal(d.witnesses.length, 0);
});
test("F-035: 自由な寸法線と古いデータの補完", () => {
  const d = createDrawing(); addFreeDim(d, { x: 0, y: 0 }, { x: 2.5, y: 0 });
  assert.equal(d.shapes[0].type, "dim");
  const old = createDrawing(); delete old.shapes; delete old.witnesses; normalize(old);
  assert.deepEqual(old.shapes, []); assert.deepEqual(old.witnesses, []); assert.equal(old.sheet.showWitnessTable, false);
});
