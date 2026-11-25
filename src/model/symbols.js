// F-021 什器・出入口の記号。記号は shape（type "sym"）として持ち、形は中心・幅・奥行・角度から毎回作る。
// 【想定】の記号の種類と既定の大きさ（m）。図面の様式は地域で違うため、発案者の確認で直す（A区分: 形・名前・大きさの既定値）
import { newId } from "./document.js";
import { rotate } from "../shared/rotate.js";

export const SYMBOLS = {
  door: { name: "開き戸", w: 0.8, h: 0.8 },
  slide: { name: "引き戸", w: 1.6, h: 0.1 },
  window: { name: "窓", w: 1.6, h: 0.12 },
  sink: { name: "流し台", w: 1.2, h: 0.6 },
  handwash: { name: "手洗い器", w: 0.45, h: 0.35 },
  toilet: { name: "便器", w: 0.4, h: 0.7 },
  fridge: { name: "冷蔵庫", w: 0.7, h: 0.7, label: "冷蔵庫" },
  counter: { name: "カウンター", w: 2.0, h: 0.6, label: "カウンター" },
  table: { name: "テーブル", w: 0.8, h: 0.8 },
  chair: { name: "いす", w: 0.45, h: 0.45 },
};

/** 記号を置く。rotDeg は画面の回転（画面に対してまっすぐに置く） */
export function addSymbol(doc, kind, at, rotDeg = 0) {
  const k = SYMBOLS[kind]; if (!k) return null;
  const sh = { id: newId(), type: "sym", kind, cx: at.x, cy: at.y, w: k.w, h: k.h, angleDeg: -rotDeg, mirror: false, text: k.label || "" };
  doc.shapes.push(sh); return sh;
}

const symBox = (x0, y0, x1, y1) => ({ pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true });
const symSeg = (x0, y0, x1, y1) => ({ pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }], closed: false });
const symEllipse = (cx, cy, rx, ry, n = 24) => ({ pts: [...Array(n).keys()].map((i) => ({ x: cx + rx * Math.cos(2 * Math.PI * i / n), y: cy + ry * Math.sin(2 * Math.PI * i / n) })), closed: true });
const symArc = (cx, cy, r, a0, a1, n = 12) => ({ pts: [...Array(n + 1).keys()].map((i) => { const a = a0 + (a1 - a0) * i / n; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; }), closed: false });

/** 記号の形（作図の座標）。polys は線、texts は文字の位置 */
export function symbolGeometry(sh) {
  const w = sh.w, h = sh.h, X = w / 2, Y = h / 2, polys = [], texts = [];
  switch (sh.kind) {
    case "door": // 吊り元（左下）から扉の線と、開く範囲の円弧
      polys.push(symSeg(-X, -Y, -X, -Y + w), symArc(-X, -Y, w, Math.PI / 2, 0), symSeg(-X, -Y, X, -Y)); break;
    case "slide": { const o = Math.min(0.05, w * 0.05); polys.push(symBox(-X, -Y, o, 0), symBox(-o, 0, X, Y)); break; }
    case "window": polys.push(symBox(-X, -Y, X, Y), symSeg(-X, 0, X, 0)); break;
    case "sink": { const m = Math.min(w, h) * 0.12, bw = Math.min(w * 0.45, w - 2 * m); polys.push(symBox(-X, -Y, X, Y), symBox(-X + m, -Y + m, -X + m + bw, Y - m), symEllipse(-X + m + bw / 2, 0, Math.min(bw, h) * 0.08, Math.min(bw, h) * 0.08, 12)); break; }
    case "handwash": polys.push(symBox(-X, -Y, X, Y), symEllipse(0, -Y * 0.1, X * 0.7, Y * 0.6)); break;
    case "toilet": { const t = Math.min(0.18, h * 0.3); polys.push(symBox(-X, Y - t, X, Y), symEllipse(0, -t / 2, X * 0.85, (h - t) / 2 * 0.95)); break; }
    case "chair": polys.push(symBox(-X, -Y, X, Y), symSeg(-X, Y * 0.6, X, Y * 0.6)); break;
    default: polys.push(symBox(-X, -Y, X, Y));
  }
  if (sh.text) texts.push({ x: 0, y: 0, text: sh.text });
  const tf = (p) => { const q = rotate({ x: sh.mirror ? -p.x : p.x, y: p.y }, sh.angleDeg || 0); return { x: sh.cx + q.x, y: sh.cy + q.y }; };
  return { polys: polys.map((p) => ({ pts: p.pts.map(tf), closed: p.closed })), texts: texts.map((t) => ({ ...tf(t), text: t.text })) };
}
