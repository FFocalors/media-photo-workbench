// 从两个展示页抽取所有含中文的文本节点与属性，产出 i18n 源串清单。
// 用法：node website/tools/extract-i18n.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE = "http://127.0.0.1:4173";
const PAGES = ["index.html", "architecture.html"];

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const seen = new Set();
  const ordered = [];
  const perPage = {};

  for (const file of PAGES) {
    await page.goto(`${BASE}/${file}`, { waitUntil: "load" });
    await page.waitForTimeout(700);
    const found = await page.evaluate(() => {
      const CJK = /[㐀-䶿一-鿿豈-﫿]/;
      const SKIP = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "NOSCRIPT", "TEXTAREA"]);
      const out = { text: [], attr: [] };

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const value = node.nodeValue;
        if (!CJK.test(value)) continue;
        let el = node.parentElement, blocked = false;
        while (el) {
          if (SKIP.has(el.tagName)) { blocked = true; break; }
          el = el.parentElement;
        }
        if (blocked) continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        out.text.push(trimmed);
      }

      document.querySelectorAll("[alt],[aria-label],[title],[placeholder]").forEach((el) => {
        for (const name of ["alt", "aria-label", "title", "placeholder"]) {
          const raw = el.getAttribute(name);
          if (!raw || !CJK.test(raw)) continue;
          out.attr.push({ tag: el.tagName, name, value: raw.trim() });
        }
      });
      return out;
    });

    perPage[file] = { text: found.text.length, attr: found.attr.length };
    const push = (s) => { if (!seen.has(s)) { seen.add(s); ordered.push(s); } };
    found.text.forEach(push);
    found.attr.forEach((a) => push(a.value));
  }

  await browser.close();

  const outDir = path.join(ROOT, "assets", "i18n");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "source.json"), JSON.stringify(ordered, null, 0) + "\n", "utf8");

  console.log("每页抽取：", JSON.stringify(perPage));
  console.log("去重后唯一字符串：", ordered.length);
  console.log("---- 清单（前 40 条）----");
  ordered.slice(0, 40).forEach((s, i) => console.log(`${String(i).padStart(3)} ${s}`));
})();
