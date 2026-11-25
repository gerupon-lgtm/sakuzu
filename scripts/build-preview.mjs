// 動作確認用に、モジュールを1つのHTMLにまとめる（公開用のビルドではない）
import { readFileSync, writeFileSync } from "node:fs";
const order = ["src/version.js", "src/shared/geometry.js", "src/shared/construct.js", "src/shared/round.js", "src/shared/rotate.js", "src/shared/print.js", "src/shared/date.js", "src/shared/importers.js", "src/shared/triangulate.js", "src/shared/sansha.js", "src/shared/sjis.js", "src/shared/dxfwriter.js",
  "src/model/document.js", "src/model/solver.js", "src/model/edit.js", "src/model/elements.js", "src/model/history.js", "src/model/annot.js", "src/model/importdoc.js", "src/model/symbols.js", "src/model/dxfexport.js", "src/ui/messages.js", "src/ui/annot-svg.js", "src/ui/sheet.js", "src/ui/import-view.js", "src/ui/app.js"];
const seen = new Map();
const js = order.map((f) => {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/^(?:export )?(?:const|function|let|class) (\w+)/gm)) {
    if (seen.has(m[1])) throw new Error(`名前の重複: ${m[1]}（${seen.get(m[1])} と ${f}）`);
    seen.set(m[1], f);
  }
  return `// ---- ${f}\n` + src.replace(/^import [\s\S]*?;\s*$/gm, "").replace(/^export (const|function|let|class) /gm, "$1 ");
}).join("\n");
const css = readFileSync("src/ui/styles.css", "utf8");
const html = `<!doctype html><html lang="ja" data-preview="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>サクズ（動作確認版）</title><style>${css}</style></head><body><div id="app" class="app"></div><script type="module">\n${js}\n</script></body></html>`;
writeFileSync("dist/preview.html", html);
console.log("dist/preview.html", html.length, "bytes");
