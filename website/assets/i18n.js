/* ============================================================
   frameflow 多语言运行时
   源语言就是 HTML 里的中文原文，所以不加载 zh-CN 词表：
   首次进入时把可译文本快照进内存，切回中文即还原快照。
   其他语言按需注入 assets/i18n/<code>.js（普通 script，file:// 下也能用）。
   ============================================================ */
(function () {
  "use strict";

  var LOCALES = [
    { code: "zh-CN", label: "简体中文", htmlLang: "zh-Hans-CN" },
    { code: "zh-Hant", label: "繁體中文", htmlLang: "zh-Hant-TW" },
    { code: "en", label: "English", htmlLang: "en" },
    { code: "ja", label: "日本語", htmlLang: "ja" }
  ];
  var STORAGE_KEY = "frameflow-lang";
  var CJK = /[㐀-䶿一-鿿豈-﫿]/;
  var SKIP = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, TEXTAREA: 1 };
  var ATTRS = ["alt", "aria-label", "title", "placeholder"];

  var dict = null;      // 当前语言词表；null 表示中文原文
  var activeLang = "zh-CN";
  var booted = false;

  /* ---------- 快照：boot 时抓一次，之后所有还原都基于它 ---------- */

  var textNodes = [];   // { node, raw, lead, trail, key }
  var attrNodes = [];   // { el, name, raw, key }

  function splitWs(value) {
    var lead = value.match(/^\s*/)[0];
    var trail = value.match(/\s*$/)[0];
    return { lead: lead, trail: trail, key: value.trim() };
  }

  function takeSnapshot() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue;
      if (!CJK.test(raw)) continue;
      var parent = node.parentElement;
      var blocked = false;
      while (parent) {
        if (SKIP[parent.tagName]) { blocked = true; break; }
        parent = parent.parentElement;
      }
      if (blocked) continue;
      var parts = splitWs(raw);
      if (!parts.key) continue;
      textNodes.push({ node: node, raw: raw, lead: parts.lead, trail: parts.trail, key: parts.key });
    }

    var labelled = document.querySelectorAll("[alt],[aria-label],[title],[placeholder]");
    Array.prototype.forEach.call(labelled, function (el) {
      ATTRS.forEach(function (name) {
        var raw = el.getAttribute(name);
        if (!raw || !CJK.test(raw)) return;
        var key = raw.trim();
        if (!key) return;
        attrNodes.push({ el: el, name: name, raw: raw, key: key });
      });
    });

    titleSource = document.title;
    var meta = document.querySelector('meta[name="description"]');
    descSource = meta ? meta.getAttribute("content") : "";
  }

  var titleSource = "";
  var descSource = "";

  /* ---------- 应用 ---------- */

  function lookup(key) {
    if (!dict) return null;
    var hit = dict[key];
    return typeof hit === "string" ? hit : null;
  }

  function apply() {
    textNodes.forEach(function (item) {
      var hit = lookup(item.key);
      item.node.nodeValue = hit === null ? item.raw : item.lead + hit + item.trail;
    });
    attrNodes.forEach(function (item) {
      var hit = lookup(item.key);
      item.el.setAttribute(item.name, hit === null ? item.raw : hit);
    });

    var nextTitle = lookup("@title");
    document.title = nextTitle === null ? titleSource : nextTitle;
    var meta = document.querySelector('meta[name="description"]');
    if (meta) {
      var nextDesc = lookup("@description");
      meta.setAttribute("content", nextDesc === null ? descSource : nextDesc);
    }

    var htmlLang = activeLang;
    LOCALES.forEach(function (item) { if (item.code === activeLang) htmlLang = item.htmlLang; });
    document.documentElement.setAttribute("lang", htmlLang);
    // 为中文行宽手工加的换行只对中文成立：繁中字数与简中相当，保留；
    // 日文与英文交给容器自然折行，否则会出现「のため／のツールです」这类断法。
    var naturalWrap = activeLang === "en" || activeLang === "ja";
    document.documentElement.classList.toggle("lang-flow", naturalWrap);

    syncSwitcher();
  }

  /* ---------- 语言切换器 ---------- */

  function syncSwitcher() {
    var root = document.querySelector("[data-lang-switcher]");
    if (!root) return;
    var current = LOCALES.filter(function (item) { return item.code === activeLang; })[0] || LOCALES[0];
    var label = root.querySelector("[data-lang-current]");
    if (label) label.textContent = current.label;
    Array.prototype.forEach.call(root.querySelectorAll("[data-lang-option]"), function (option) {
      var on = option.getAttribute("data-lang-option") === activeLang;
      option.setAttribute("aria-current", on ? "true" : "false");
    });
  }

  function closeMenu(root) {
    root.classList.remove("is-open");
    var trigger = root.querySelector("[data-lang-trigger]");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function wireSwitcher() {
    var root = document.querySelector("[data-lang-switcher]");
    if (!root) return;
    var trigger = root.querySelector("[data-lang-trigger]");
    var menu = root.querySelector("[data-lang-menu]");
    if (!trigger || !menu) return;

    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      var open = !root.classList.contains("is-open");
      root.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        var first = menu.querySelector("[data-lang-option]");
        if (first) first.focus();
      }
    });

    root.addEventListener("click", function (event) {
      var option = event.target.closest ? event.target.closest("[data-lang-option]") : null;
      if (!option) return;
      event.preventDefault();
      setLang(option.getAttribute("data-lang-option"), { syncUrl: true });
      closeMenu(root);
      trigger.focus();
    });

    document.addEventListener("click", function (event) {
      if (!root.contains(event.target)) closeMenu(root);
    });

    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeMenu(root);
        trigger.focus();
      }
    });
  }

  /* ---------- 载入词表 ---------- */

  function loadDict(code, done) {
    if (code === "zh-CN") { done(null); return; }
    var store = (window.FRAMEFLOW_I18N = window.FRAMEFLOW_I18N || {});
    if (store[code]) { done(store[code]); return; }
    var script = document.createElement("script");
    script.src = "assets/i18n/" + code + ".js";
    script.onload = function () { done(store[code] || null); };
    script.onerror = function () {
      if (window.console) console.warn("[frameflow] 词表载入失败，回退中文：" + code);
      done(null);
    };
    document.head.appendChild(script);
  }

  function setLang(code, options) {
    var known = LOCALES.some(function (item) { return item.code === code; });
    if (!known) code = "zh-CN";
    activeLang = code;
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
    // 只有用户主动选择时才回写地址，避免首次访问就被改掉 URL
    if (options && options.syncUrl && history.replaceState) {
      history.replaceState(null, "", location.pathname + (code === "zh-CN" ? "" : "?lang=" + code));
    }
    loadDict(code, function (table) {
      dict = table;
      apply();
      document.dispatchEvent(new CustomEvent("frameflow:lang", { detail: { lang: code } }));
    });
  }

  function initialLang() {
    var fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl) return fromUrl;
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return saved;
    } catch (e) {}
    var nav = (navigator.language || "zh-CN").toLowerCase();
    if (nav.indexOf("zh") === 0) return /hant|tw|hk|mo/.test(nav) ? "zh-Hant" : "zh-CN";
    if (nav.indexOf("ja") === 0) return "ja";
    if (nav.indexOf("en") === 0) return "en";
    return "zh-CN";
  }

  /* ---------- 对外 ---------- */

  window.frameflowI18n = {
    setLang: setLang,
    getLang: function () { return activeLang; },
    // 供页面内脚本拼接动态文案；只吃中文原文，查不到就原样返回
    t: function (zh) { var hit = lookup(zh); return hit === null ? zh : hit; },
    locales: LOCALES
  };

  function boot() {
    if (booted) return;
    booted = true;
    takeSnapshot();
    wireSwitcher();
    var start = initialLang();
    if (start === "zh-CN") { activeLang = "zh-CN"; syncSwitcher(); return; }
    setLang(start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
