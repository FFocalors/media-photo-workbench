// 校验词表：键必须与页面里的中文原文完全一致，缺键会静默回退中文。
// 用法：node website/tools/check-i18n.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "i18n", "source.json"), "utf8"));
// 只存在于内联脚本里、抽取器跳过的字符串
const EXTRA = ["收起菜单", "收起"];
const KEYS = SOURCE.concat(EXTRA.filter((k) => !SOURCE.includes(k)));

const codes = ["zh-Hant", "en", "ja"];
let failed = false;

for (const code of codes) {
  const file = path.join(ROOT, "assets", "i18n", `${code}.js`);
  if (!fs.existsSync(file)) {
    console.log(`${code}: 文件不存在`);
    continue;
  }
  const sandbox = { window: {} };
  const src = fs.readFileSync(file, "utf8");
  new Function("window", src)(sandbox.window);
  const dict = sandbox.window.FRAMEFLOW_I18N && sandbox.window.FRAMEFLOW_I18N[code];

  if (!dict) { console.log(`${code}: 未挂到 window.FRAMEFLOW_I18N["${code}"]`); failed = true; continue; }

  const keys = Object.keys(dict).filter((k) => !k.startsWith("@"));
  const missing = KEYS.filter((k) => !(k in dict));
  const extra = keys.filter((k) => !KEYS.includes(k));
  const empty = keys.filter((k) => !dict[k].trim());
  const same = keys.filter((k) => dict[k] === k);
  const multiline = KEYS.filter((k) => /[\n\r\t]/.test(k));

  console.log(`\n=== ${code} ===`);
  console.log(`条目 ${keys.length} / 源串 ${KEYS.length}（另含 @title、@description）`);
  console.log(`缺键 ${missing.length}${missing.length ? "：" + missing.slice(0, 8).map((s) => JSON.stringify(s)).join(", ") : ""}`);
  console.log(`多余键（疑似打错字）${extra.length}${extra.length ? "：" + extra.slice(0, 8).map((s) => JSON.stringify(s)).join(", ") : ""}`);
  console.log(`空译文 ${empty.length}${empty.length ? "：" + empty.slice(0, 5).map((s) => JSON.stringify(s)).join(", ") : ""}`);
  console.log(`译文与原文相同 ${same.length}${same.length ? "：" + same.slice(0, 8).map((s) => JSON.stringify(s)).join(", ") : ""}`);
  if (multiline.length) console.log(`!! 源串含控制字符，键无法匹配：${multiline.length}`);
  if (missing.length || extra.length || empty.length || multiline.length) failed = true;
}

process.exit(failed ? 1 : 0);
