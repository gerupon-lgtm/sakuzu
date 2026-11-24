// 引き出し線の起点の付け替え（S-T30）
import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing } from "../src/model/document.js";
import { addPolar } from "../src/model/edit.js";
import { solve } from "../src/model/solver.js";
import { addLeader, leaderTarget, setLeaderTarget, moveShape } from "../src/model/annot.js";

test("起点を自由な位置から点へ付け替えると、点の移動に追従する", () => {
  const d = createDrawing("t"); const p1 = d.steps[0].id;
  const p2 = addPolar(d, { from: p1, ref: null, turn: "S", angleDeg: 0, d: 5 });
  const sh = addLeader(d, { x: 1, y: 1 }, { x: 3, y: 3 }, "物置");
  setLeaderTarget(sh, { x: 5, y: 0, pointId: p2.id });
  assert.deepEqual(leaderTarget(sh, solve(d)), { x: 5, y: 0 });
  p2.d = 7; assert.deepEqual(leaderTarget(sh, solve(d)), { x: 7, y: 0 });
  assert.equal(sh.x, 3); // 文字の位置は変わらない
});
test("起点を点から外すと自由な位置に固定され、移動では起点と文字が一緒に動く", () => {
  const d = createDrawing("t"); const p1 = d.steps[0].id;
  const sh = addLeader(d, { pointId: p1 }, { x: 2, y: 2 }, "A");
  setLeaderTarget(sh, { x: 0.5, y: -0.5 });
  assert.equal(sh.target.pointId, undefined);
  moveShape(sh, 1, 1); assert.deepEqual(leaderTarget(sh, solve(d)), { x: 1.5, y: 0.5 });
});
