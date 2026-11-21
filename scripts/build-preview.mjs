// 動作確認用に、モジュールを1つのHTMLにまとめる（公開用のビルドではない）
import { readFileSync, writeFileSync } from "node:fs";
const order = ["src/version.js", "src/shared/geometry.js", "src/shared/construct.js", "src/shared/round.js",
  "src/model/document.js", "src/model/solver.js", "src/model/edit.js", "src/model/history.js", "src/ui/app.js"];
const js = order.map((f) => `// ---- ${f}\n` + readFileSync(f, "utf8")
  .replace(/^import .*?;\s*$/gm, "").replace(/^export (const|function|let|class) /gm, "$1 ")).join("\n");
const css = readFileSync("src/ui/styles.css", "utf8");
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>サクズ（試作α）</title><style>${css}</style></head><body><div id="app" class="app"></div><script type="module">\n${js}\n</script></body></html>`;
writeFileSync("dist/preview.html", html);
console.log("dist/preview.html", html.length, "bytes");
