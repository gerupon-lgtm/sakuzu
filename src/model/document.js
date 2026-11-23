import { APP_VERSION } from "../version.js";
export const SCHEMA_VERSION = 1;
const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
export const newId = uid;

export function createDrawing(name = "新しい図面") {
  const p1 = { id: uid(), type: "base", label: "P1", x: 0, y: 0 };
  return {
    appId: "sakuzu", schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION,
    id: uid(), name, updatedAt: new Date().toISOString(),
    steps: [p1], lines: [], rooms: [], roads: [], dims: [], texts: [], north: null,
    sheet: { paper: "A4", orientation: "landscape", unit: "m", title: "", createdDate: "", author: "", rotationDeg: 0, showArea: false },
  };
}
export function nextLabel(doc) {
  let n = 0;
  for (const s of doc.steps) { const m = /^P(\d+)$/.exec(s.label); if (m) n = Math.max(n, +m[1]); }
  return "P" + (n + 1);
}
/** その手順が参照する点ID */
export function refsOfStep(s) {
  if (s.type === "polar") return [s.from, ...(s.ref || [])];
  if (s.type === "circles") return [s.a, s.b];
  return [];
}
