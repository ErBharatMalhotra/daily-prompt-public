/* translator.js — The Daily Prompt progressive multilingual widget.
 * Layer 3 of the zero-cost i18n stack:
 *   1. LLM-translated Hindi edition (/hi/)
 *   2. IndicTrans2 editions (server-side)
 *   3. THIS: reader-side browser built-in translation (zero server cost)
 * Behaviour:
 *   - English pages only; hides itself for English-locale readers.
 *   - Chrome 138+ (built-in AI Translator API): one-click in-browser translation.
 *   - Other browsers: hints the native right-click → Translate flow.
 *   - Every failure path hides the bar silently — never blocks reading.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "tdp.translator.dismissed";
  var state = { chromeTranslator: null, current: null, busy: false };

  // ---- utilities -------------------------------------------------------
  function store(k) {
    try { return window.localStorage.getItem(k); } catch { return null; }
  }
  function setStore(k, v) {
    try { window.localStorage.setItem(k, v); } catch { /* private mode */ }
  }

  function detectReaderLang() {
    var n = navigator.language || "en";
    if (/^hi/i.test(n)) return "hi";
    if (/^(ta|te|mr|pa|bn|gu|kn|ml|or|as)/i.test(n)) return n.slice(0, 2).toLowerCase();
    return "en";
  }

  function isChromeTranslatorAvailable() {
    return typeof self.Translator !== "undefined" && typeof self.Translator.create === "function";
  }

  // ---- Chrome built-in AI Translator -----------------------------------
  function chromeTranslate(target) {
    if (!state.chromeTranslator) return Promise.reject(new Error("no translator"));
    if (state.current === target) return Promise.resolve();
    state.busy = true;
    return state.chromeTranslator
      .translate(document.querySelector("article") || document.body)
      .then(function () {
        state.current = target;
      })
      .finally(function () {
        state.busy = false;
      });
  }

  function makeChromeTranslator(target) {
    if (!isChromeTranslatorAvailable()) return Promise.reject(new Error("unavailable"));
    return self.Translator.create({ sourceLanguage: "en", targetLanguage: target });
  }

  // ---- fallback hint for non-Chrome browsers ---------------------------
  function hintHtml() {
    var ua = navigator.userAgent;
    if (/Firefox/i.test(ua)) {
      return "Firefox menu → <b>Translate This Page</b> — model download hoga, phir offline bhi chalega.";
    }
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
      return "Safari: <b>View → Translation</b> ya address bar ka translate icon.";
    }
    return "Right-click anywhere → <b>Translate to …</b> — Chrome/Edge ka built-in translator use karega.";
  }

  // ---- UI ---------------------------------------------------------------
  function ensureBar() {
    var bar = document.getElementById("tdp-translate-bar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "tdp-translate-bar";
    bar.style.cssText =
      "position:fixed;bottom:14px;left:50%;transform:translateX(-50%);" +
      "background:#1c1c1c;color:#f4f4f4;padding:10px 14px;border-radius:10px;" +
      "font:13px/1.5 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35);" +
      "display:flex;gap:10px;align-items:center;z-index:9999;max-width:92vw";
    bar.innerHTML =
      '<span id="tdp-translate-text"></span>' +
      '<span style="flex:1"></span>' +
      '<button id="tdp-translate-close" aria-label="Dismiss" style="background:none;border:none;color:#bbb;font-size:15px;cursor:pointer">✕</button>';
    document.body.appendChild(bar);
    bar.querySelector("#tdp-translate-close").addEventListener("click", function () {
      setStore(STORAGE_KEY, "1");
      bar.remove();
    });
    return bar;
  }

  function say(html) {
    var bar = ensureBar();
    bar.querySelector("#tdp-translate-text").innerHTML = html;
  }

  function hideBar() {
    var bar = document.getElementById("tdp-translate-bar");
    if (bar) bar.remove();
  }

  // ---- Chrome one-click buttons ----------------------------------------
  function chromeButtons(langs) {
    var pick = langs.slice(0, 4);
    return (
      "Translate: " +
      pick
        .map(function (l) {
          return '<button data-lang="' + l.code + '" style="background:#8b0000;border:none;color:#fff;' +
            'padding:3px 10px;border-radius:6px;cursor:pointer;font-size:12px">' + l.label + "</button>";
        })
        .join(" ")
    );
  }

  function wireChromeButtons(bar, langs) {
    bar.querySelectorAll("button[data-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-lang");
        btn.disabled = true;
        btn.textContent = "…";
        chromeTranslate(target)
          .then(function () {
            say("✅ Translated in your browser (on-device, zero server).");
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = "⚠️ failed";
          });
      });
    });
  }

  // ---- boot -------------------------------------------------------------
  function init() {
    if (store(STORAGE_KEY)) return;
    var reader = detectReaderLang();
    // NOTE: we show the bar for ALL locales, including English — an en-IN
    // reader is often happy to read in Hindi. The bar is dismissible and
    // auto-minimises, so it never blocks reading.

    var langs = [
      { code: "hi", label: "हिंदी" },
      { code: "ta", label: "தமிழ்" },
      { code: "te", label: "తెలుగు" },
      { code: "mr", label: "मराठी" },
      { code: "pa", label: "ਪੰਜਾਬੀ" },
      { code: "bn", label: "বাংলা" },
    ];
    // reader ki apni bhasha sabse aage
    langs.sort(function (a, b) { return (b.code === reader ? 1 : 0) - (a.code === reader ? 1 : 0); });

    var lead = reader === "en" ? "Read in your language: " : "Translate: ";

    if (isChromeTranslatorAvailable()) {
      say(lead + chromeButtons(langs));
      var bar = document.getElementById("tdp-translate-bar");
      wireChromeButtons(bar, langs);
      // pehla click translator instance banata hai (download ho sakta hai, isliye busy state)
      bar.addEventListener("click", function (e) {
        var lang = e.target && e.target.getAttribute && e.target.getAttribute("data-lang");
        if (!lang || state.chromeTranslator || state.busy) return;
        state.busy = true;
        makeChromeTranslator(lang)
          .then(function (t) {
            state.chromeTranslator = t;
            state.busy = false;
          })
          .catch(function () {
            state.busy = false;
            say("⚠️ Browser translator is model download nahi kar paya — " + hintHtml());
          });
      }, true);
    } else {
      say("🌐 " + hintHtml());
    }

    // 12 seconds baad chhota kar do (sirf ✕ bachta hai) — reading me disturb na kare
    setTimeout(function () {
      var t = document.getElementById("tdp-translate-text");
      if (t) t.style.display = "none";
    }, 12000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
