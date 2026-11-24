import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing } from "../src/model/document.js";
import { addPolar, addBase, moveStep, orderIsValid, addCircles } from "../src/model/edit.js";
import { solve } from "../src/model/solver.js";

test("F-002: 2つ目の基準点を置き、そこから作図できる", () => {
  const d = createDrawing();
  const b = addBase(d, 10, 2);
  assert.equal(b.label, "P2");
  const p = addPolar(d, { from: b.id, ref: null, turn: "S", angleDeg: 0, d: 3 });
  const pts = solve(d); assert.equal(pts.get(p.id).x, 13); assert.equal(pts.get(p.id).y, 2);
  b.x = 0; assert.equal(solve(d).get(p.id).x, 3); // 基準点の座標を直すと追従
});

test("F-005: 手順の並べ替えは、参照の制約を守る範囲でだけできる", () => {
  const d = createDrawing(); const p1 = d.steps[0].id;
  const a = addPolar(d, { from: p1, ref: null, turn: "S", angleDeg: 0, d: 2 });
  const b = addBase(d, 5, 5);
  const c = addPolar(d, { from: a.id, ref: null, turn: "L", angleDeg: 90, d: 1 });
  assert.equal(moveStep(d, a.id, -1), false);        // P1 より前には行けない（P1 を参照している）
  assert.equal(moveStep(d, b.id, -1), true);         // 独立した基準点は上へ動かせる
  assert.deepEqual(d.steps.map((s) => s.label), ["P1", "P3", "P2", "P4"]);
  assert.equal(moveStep(d, c.id, -1), false);        // c は a（すぐ上）を参照しているので、上へは行けない
  assert.equal(moveStep(d, b.id, 1), true);          // 基準点は下へも動かせる
  assert.deepEqual(d.steps.map((s) => s.label), ["P1", "P2", "P3", "P4"]);
  assert.equal(orderIsValid(d.steps), true);
  assert.equal(moveStep(d, d.steps[0].id, -1), false); // 範囲外
});

test("F-005: 二円交点も、参照する2点より前には動かせない", () => {
  const d = createDrawing(); const p1 = d.steps[0].id;
  const a = addPolar(d, { from: p1, ref: null, turn: "S", angleDeg: 0, d: 4 });
  const c = addCircles(d, { a: p1, da: 5, b: a.id, db: 3 });
  assert.equal(moveStep(d, c.id, -1), false);
});
