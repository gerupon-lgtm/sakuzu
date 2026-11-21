import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing } from "../src/model/document.js";
import { addPolar, addCircles, defaultRef, deletePoint } from "../src/model/edit.js";
import { solve, misclosure, suspectEdges } from "../src/model/solver.js";
import { createHistory } from "../src/model/history.js";
import { area } from "../src/shared/geometry.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

function parking(first = 5) {
  const doc = createDrawing();
  const p1 = doc.steps[0].id;
  const p2 = addPolar(doc, { from: p1, ref: null, turn: "S", angleDeg: 0, d: first });
  const p3 = addPolar(doc, { from: p2.id, ref: defaultRef(doc, p2.id), turn: "R", angleDeg: 90, d: 2.5 });
  const p4 = addPolar(doc, { from: p3.id, ref: defaultRef(doc, p3.id), turn: "R", angleDeg: 90, d: 5 });
  return { doc, p1, p2, p3, p4 };
}

test("駐車場の長方形（7.1）", () => {
  const { doc, p4 } = parking();
  const pts = solve(doc);
  near(pts.get(p4.id).x, 0); near(pts.get(p4.id).y, -2.5);
});

test("最初の辺を5.20に直すと台形 12.75㎡（受入基準2）", () => {
  const { doc, p2 } = parking();
  p2.d = 5.2;
  const pts = solve(doc);
  const ring = doc.lines[0].points.map((id) => pts.get(id));
  near(area(ring), 12.75);
});

test("二円交点: 選んだ側が保たれる（受入基準5）", () => {
  const doc = createDrawing();
  const a = doc.steps[0].id;
  const b = addPolar(doc, { from: a, ref: null, turn: "S", angleDeg: 0, d: 4 });
  const c = addCircles(doc, { a, da: 5, b: b.id, db: 3 });
  let pts = solve(doc);
  assert.equal(pts.get(c.id).status, "pending");
  c.side = "L"; pts = solve(doc); near(pts.get(c.id).y, 3);
  c.da = 5.1; pts = solve(doc); assert.ok(pts.get(c.id).y > 0);
});

test("交わらない → 依存点が blocked、直すと戻る", () => {
  const doc = createDrawing();
  const a = doc.steps[0].id;
  const b = addPolar(doc, { from: a, ref: null, turn: "S", angleDeg: 0, d: 4 });
  const c = addCircles(doc, { a, da: 5, b: b.id, db: 3 }); c.side = "L";
  const d = addPolar(doc, { from: c.id, ref: [b.id, c.id], turn: "L", angleDeg: 90, d: 1 });
  c.da = 0.5;
  let pts = solve(doc);
  assert.equal(pts.get(c.id).status, "error"); assert.equal(pts.get(d.id).status, "blocked");
  c.da = 5; pts = solve(doc);
  assert.equal(pts.get(d.id).status, "ok");
});

test("削除は依存ごと・元に戻すで復元（受入基準6）", () => {
  const { doc, p2 } = parking();
  const h = createHistory();
  h.push(doc);
  const n = deletePoint(doc, p2.id);
  assert.equal(n, 3); assert.equal(doc.steps.length, 1); assert.equal(doc.dims.length, 0);
  const back = h.undo(doc);
  assert.equal(back.steps.length, 4);
});

test("履歴は50件まで", () => {
  const h = createHistory(50); const doc = createDrawing();
  for (let i = 0; i < 51; i++) h.push(doc);
  assert.equal(h.size, 50);
});

test("閉合のずれ 1cm と目安（受入基準7）", () => {
  const { doc, p4 } = parking();
  const s = addPolar(doc, { from: p4.id, ref: defaultRef(doc, p4.id), turn: "R", angleDeg: 90, d: 2.51, closing: true });
  const pts = solve(doc);
  const line = doc.lines[0];
  const m = misclosure(doc, pts, line);
  near(m.len, 0.01, 1e-9);
  const sus = suspectEdges(pts, line, m.v);
  assert.equal(sus.length, 2); // 2.5mの2辺
});

test("200点の再計算は10ms以内", () => {
  const doc = createDrawing();
  let prev = doc.steps[0].id;
  for (let i = 0; i < 199; i++) prev = addPolar(doc, { from: prev, ref: defaultRef(doc, prev), turn: "L", angleDeg: 10, d: 1 }).id;
  solve(doc);
  const t = performance.now(); solve(doc); const ms = performance.now() - t;
  assert.ok(ms < 10, ms + "ms");
});
