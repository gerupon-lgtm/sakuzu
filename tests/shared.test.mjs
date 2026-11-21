import test from "node:test";
import assert from "node:assert/strict";
import { area, validatePolygon } from "../src/shared/geometry.js";
import { circleIntersect, candidates, polar } from "../src/shared/construct.js";
import { roundHalfUp, formatLength, formatArea } from "../src/shared/round.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test("面積と多角形の検証", () => {
  near(area([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]), 6);
  assert.equal(validatePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }]), "POLY_TOO_FEW");
  assert.equal(validatePolygon([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }]), "POLY_SELF_INTERSECT");
  assert.equal(validatePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), "POLY_ZERO_AREA");
  const L = [{x:0,y:0},{x:4,y:0},{x:4,y:2},{x:2,y:2},{x:2,y:4},{x:0,y:4}];
  assert.equal(validatePolygon(L), null); near(area(L), 12);
});

test("二円交点: 3-4-5", () => {
  const A = { x: 0, y: 0 }, B = { x: 4, y: 0 };
  const l = circleIntersect(A, 5, B, 3, "L");
  near(l.point.x, 4); near(l.point.y, 3);
  const r = circleIntersect(A, 5, B, 3, "R");
  near(r.point.y, -3);
});

test("二円交点: 許容値の境界（tol=3cm）", () => {
  const A = { x: 0, y: 0 }, B = { x: 10, y: 0 };
  assert.equal(circleIntersect(A, 5, B, 4.971, "L", 0.03).status, "tangent");
  assert.equal(circleIntersect(A, 5, B, 4.970, "L", 0.03).status, "tangent"); // ちょうど3cm
  const e = circleIntersect(A, 5, B, 4.969, "L", 0.03);
  assert.equal(e.status, "error"); assert.equal(e.code, "CIRCLE_NO_INTERSECTION"); near(e.gap, 0.031, 1e-9);
  assert.equal(circleIntersect(A, 1, A, 1, "L", 0.03).code, "CIRCLE_SAME_CENTER");
  // 内側に含まれる場合
  assert.equal(circleIntersect(A, 20, B, 9.98, "L", 0.03).status, "tangent");
  assert.equal(circleIntersect(A, 20, B, 9.96, "L", 0.03).status, "error");
  assert.equal(circleIntersect(A, 5, B, 4.999, "L", 0).status, "error");
});

test("距離と方向", () => {
  const p = polar({ x: 0, y: 0 }, 0, "L", 45, Math.SQRT2);
  near(p.x, 1); near(p.y, 1);
  const q = polar({ x: 5, y: 0 }, 0, "R", 90, 2.5);
  near(q.x, 5); near(q.y, -2.5);
});

test("丸め", () => {
  assert.equal(roundHalfUp(12.345, 2), 12.35);
  assert.equal(formatLength(5.2, "mm"), "5200");
  assert.equal(formatLength(5.2049, "m"), "5.20");
  assert.equal(formatArea(12.745), "12.75");
});
