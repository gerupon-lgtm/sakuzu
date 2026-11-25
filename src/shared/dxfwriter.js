// DXF（R12・ASCII）を書く小さな部品（アプリ固有の処理なし。C-04b）。座標は x右・y上、単位はファイルの単位（m）
// 文字コードは Shift_JIS（$DWGCODEPAGE ANSI_932）を前提にし、バイト列への変換は sjis.js で行う
const fmtN = (v) => (Math.round(v * 1e6) / 1e6).toString();

export class DxfWriter {
  constructor({ insunits = 6 } = {}) { this.layers = new Map(); this.ents = []; this.insunits = insunits; }
  layer(name, color = 7, linetype = "CONTINUOUS") { if (!this.layers.has(name)) this.layers.set(name, { color, linetype }); return name; }
  g(code, v) { this.ents.push(String(code), String(v)); }
  line(layer, a, b) { this.g(0, "LINE"); this.g(8, layer); this.g(10, fmtN(a.x)); this.g(20, fmtN(a.y)); this.g(30, 0); this.g(11, fmtN(b.x)); this.g(21, fmtN(b.y)); this.g(31, 0); }
  polyline(layer, ps, closed) {
    this.g(0, "POLYLINE"); this.g(8, layer); this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, 0); this.g(70, closed ? 1 : 0);
    for (const p of ps) { this.g(0, "VERTEX"); this.g(8, layer); this.g(10, fmtN(p.x)); this.g(20, fmtN(p.y)); this.g(30, 0); }
    this.g(0, "SEQEND"); this.g(8, layer);
  }
  point(layer, p) { this.g(0, "POINT"); this.g(8, layer); this.g(10, fmtN(p.x)); this.g(20, fmtN(p.y)); this.g(30, 0); }
  circle(layer, c, r) { this.g(0, "CIRCLE"); this.g(8, layer); this.g(10, fmtN(c.x)); this.g(20, fmtN(c.y)); this.g(30, 0); this.g(40, fmtN(r)); }
  /** align: "left"（左下）・"center"（中央） */
  text(layer, p, h, s, rotDeg = 0, align = "center") {
    const str = String(s).replace(/[\r\n]+/g, " "); if (!str) return;
    this.g(0, "TEXT"); this.g(8, layer); this.g(10, fmtN(p.x)); this.g(20, fmtN(p.y)); this.g(30, 0); this.g(40, fmtN(h)); this.g(1, str);
    if (rotDeg) this.g(50, fmtN(rotDeg));
    if (align === "center") { this.g(72, 1); this.g(73, 2); this.g(11, fmtN(p.x)); this.g(21, fmtN(p.y)); this.g(31, 0); }
  }
  toString() {
    const o = [], g = (c, v) => o.push(String(c), String(v));
    g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$DWGCODEPAGE"); g(3, "ANSI_932"); g(9, "$INSUNITS"); g(70, this.insunits); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "TABLES");
    g(0, "TABLE"); g(2, "LTYPE"); g(70, 2);
    g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
    g(0, "LTYPE"); g(2, "DASHED"); g(70, 0); g(3, "Dashed __ __ __"); g(72, 65); g(73, 2); g(40, 0.75); g(49, 0.5); g(49, -0.25);
    g(0, "ENDTAB");
    g(0, "TABLE"); g(2, "LAYER"); g(70, this.layers.size);
    for (const [name, l] of this.layers) { g(0, "LAYER"); g(2, name); g(70, 0); g(62, l.color); g(6, l.linetype); }
    g(0, "ENDTAB"); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES"); o.push(...this.ents); g(0, "ENDSEC"); g(0, "EOF");
    return o.join("\r\n") + "\r\n";
  }
}
