// ファイルの取り込み（S-T31〜S-T34、受入基準12〜17）
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeText, parseSima, parseCsv, csvRows, guessCsv, parseDxf, formatOf, ImportError } from "../src/shared/importers.js";
import { applyImport, importCandidates, scaleFromTwo } from "../src/model/importdoc.js";
import { createDrawing } from "../src/model/document.js";
import { addPolar, addCircles } from "../src/model/edit.js";
import { solve } from "../src/model/solver.js";
import { closedAreas } from "../src/model/elements.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const emptyDoc = () => { const d = createDrawing("取り込み"); d.steps = []; return d; };
const r2 = (v) => Math.round(v * 100) / 100;
const lengths = (d) => { const pts = solve(d); return d.dims.map((dm) => r2(Math.hypot(pts.get(dm.b).x - pts.get(dm.a).x, pts.get(dm.b).y - pts.get(dm.a).y))).sort((a, b) => a - b); };

test("文字コード: Shift_JIS は自動で読める。UTF-8 はそのまま", () => {
  const r = decodeText(fx("rect.sim")); assert.equal(r.encoding, "shift_jis"); assert.match(r.text, /境界1/);
  const u = decodeText(new TextEncoder().encode("﻿A,1,2")); assert.equal(u.encoding, "utf-8"); assert.equal(u.text, "A,1,2");
  assert.throws(() => decodeText(new Uint8Array()), (e) => e instanceof ImportError && e.code === "empty");
});

test("受入12: SIMA の4点区画。点名・座標が一致し、XとYを入れ替え（北が上）、閉じた線と面積", () => {
  const data = parseSima(decodeText(fx("rect.sim")).text);
  assert.equal(data.points.length, 5);
  const d = emptyDoc(); const r = applyImport(d, data);
  assert.equal(r.added, 5); assert.equal(r.lines, 1);
  const p1 = d.steps.find((s) => s.label === "境界1"); assert.deepEqual([p1.x, p1.y], [200, 100]); // x=Y(東), y=X(北)
  const p2 = d.steps.find((s) => s.label === "境界2"); assert.equal(p2.x - p1.x, 10); // 東へ10m
  const areas = closedAreas(d, solve(d)); assert.equal(areas.length, 1); assert.equal(r2(areas[0].area), 50);
  assert.deepEqual(lengths(d), [5, 5, 10, 10]);
});

test("受入13: mm 単位の DXF を mm（×0.001）で取り込むと 10.00m・5.00m・50.00㎡。円・文字は取り込まず知らせる", () => {
  const data = parseDxf(decodeText(fx("rect-mm.dxf")).text);
  assert.equal(data.unitHint, "mm"); assert.deepEqual(data.layers, ["敷地", "道路"]);
  assert.match(data.warnings[0], /CIRCLE 1個/); assert.match(data.warnings[0], /TEXT 1個/);
  const only = parseDxf(decodeText(fx("rect-mm.dxf")).text, { layers: ["敷地"] });
  const d = emptyDoc(); applyImport(d, only, { scale: 0.001 });
  assert.deepEqual(lengths(d), [5, 5, 10, 10]);
  assert.equal(r2(closedAreas(d, solve(d))[0].area), 50);
});

test("受入14: 単位の分からない DXF で、長辺を 10m と指定すると同じ結果", () => {
  const data = parseDxf(decodeText(fx("rect-nounit.dxf")).text); assert.equal(data.unitHint, null);
  const c = importCandidates(data); assert.equal(c.length, 4);
  const { scale } = scaleFromTwo(c[0], c[1], 10); assert.equal(scale, 0.001);
  const d = emptyDoc(); applyImport(d, data, { scale });
  assert.equal(r2(closedAreas(d, solve(d))[0].area), 50);
  assert.equal(scaleFromTwo(c[0], c[0], 10).error, "samePoint");
  assert.equal(scaleFromTwo(c[0], c[1], 0).error, "badLength");
});

test("受入15: 列が「X,Y,点名」の CSV を、見出しの推測と列の指定で取り込める", () => {
  const text = decodeText(fx("xyname.csv")).text;
  const g = guessCsv(csvRows(text)); assert.deepEqual(g, { header: true, nameCol: 2, xCol: 0, yCol: 1, axis: "survey" });
  const data = parseCsv(text, g); assert.deepEqual(data.points.map((p) => [p.name, p.x, p.y]), [["A", 0, 0], ["B", 5, 0], ["C", 5, 3]]);
  const m = parseCsv(text, { ...g, axis: "math" }); assert.deepEqual([m.points[1].x, m.points[1].y], [0, 5]);
  assert.throws(() => parseCsv(text, { ...g, header: false }), (e) => e.code === "badNumber" && e.line === 1);
  assert.deepEqual(csvRows('"a,b",1\t\n'), [['a,b', '1']]);
});

test("受入16: 取り込んだ座標点から距離と方向・二円交点で続けて作図できる", () => {
  const d = emptyDoc(); applyImport(d, parseCsv(decodeText(fx("xyname.csv")).text, {}));
  const [A, B] = d.steps;
  const p = addPolar(d, { from: B.id, ref: [A.id, B.id], turn: "L", angleDeg: 90, d: 2 });
  const q = addCircles(d, { a: A.id, da: 3, b: B.id, db: 4 }); q.side = "L";
  const pts = solve(d);
  assert.deepEqual([r2(pts.get(p.id).x), r2(pts.get(p.id).y)], [5, 2]);
  assert.equal(pts.get(q.id).status === "ok" || pts.get(q.id).status === "warn", true);
});

test("受入17: 壊れたファイル・点がないファイルは取り込まず、理由（行番号）を返す", () => {
  assert.throws(() => parseSima("G00,01,x\r\nA01,1,K1,abc,1,\r\n"), (e) => e.code === "badNumber" && e.line === 2);
  assert.throws(() => parseSima("G00,01,x\r\nZ00,\r\n"), (e) => e.code === "noPoints");
  assert.throws(() => parseDxf("AutoCAD Binary DXF\r\n"), (e) => e.code === "binary");
  assert.throws(() => parseDxf("0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n10\n0\n20\n0\n0\nENDSEC\n0\nEOF\n"), (e) => e.code === "noPoints");
  assert.throws(() => parseDxf("hello\nworld\n"), (e) => e.code === "format" && e.line === 1);
});

test("重複: 同じ座標の点は1つに（1mm未満）。同名で座標が違えば「-2」を付けて警告。開いている図面へ追加もできる", () => {
  const d = createDrawing("t"); // P1 (0,0) がある
  const data = parseDxf(decodeText(fx("poly-m.dxf")).text);
  assert.equal(data.unitHint, "m");
  const r = applyImport(d, data);
  assert.equal(d.steps.length, 3); // POINT(4,3) は頂点と同じ、(0,0) は既存の P1 と同じ
  assert.equal(r.lines, 1); assert.equal(r2(closedAreas(d, solve(d))[0].area), 6);
  const r3 = applyImport(d, { points: [{ name: "P1", x: 0, y: 0.0004 }, { name: "P1", x: 9, y: 9 }], polylines: [], warnings: [] });
  assert.equal(r3.added, 1); assert.ok(d.steps.some((s) => s.label === "P1-2")); assert.match(r3.warnings[0], /P1-2/);
});

test("形式の判定", () => {
  assert.equal(formatOf("a.SIM"), "sima"); assert.equal(formatOf("b.csv"), "csv"); assert.equal(formatOf("c.dxf"), "dxf"); assert.equal(formatOf("d.json"), null);
});
