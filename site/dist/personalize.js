/* personalize.js — reader preferences, all in localStorage (zero backend):
 *   1. Language memory: the Google Translate choice survives page loads —
 *      the combo is auto-re-applied on every page.
 *   2. Beat follows: "+ follow" buttons on section headers; followed beats
 *      build a "⭐ Your news" block at the top of the front page.
 * Every access is try/catch wrapped (private mode safe); every failure is
 * silent — personalisation must never break reading.
 */
(function () {
  "use strict";

  var LANG_KEY = "tdp.lang";
  var FOLLOWS_KEY = "tdp.follows";
  var INDEX_KEY = "tdp.mynews.index"; // per-visit "seen" marker (optional future use)

  function get(k) {
    try { return window.localStorage.getItem(k); } catch { return null; }
  }
  function set(k, v) {
    try { window.localStorage.setItem(k, v); } catch { /* private mode */ }
  }

  /* ---------------- 1. language memory ---------------- */
  // The Google Translate combo stores its choice in a googtrans cookie, but
  // cookies are per-host and often stripped; we mirror the choice in
  // localStorage and re-apply it by clicking the combo after it renders.
  function appliedLang() {
    var m = /(?:^|;\s*)googtrans=([^;]+)/.exec(document.cookie || "");
    return m ? decodeURIComponent(m[1]) : null; // like "/en/hi"
  }

  function applySavedLanguage() {
    var saved = get(LANG_KEY);
    if (!saved || appliedLang() === saved) return;
    var attempt = 0;
    var timer = setInterval(function () {
      attempt++;
      var combo = document.querySelector(".goog-te-combo");
      if (combo) {
        clearInterval(timer);
        combo.value = saved;
        if (combo.fireEvent) combo.fireEvent("onchange");
        else {
          var ev = document.createEvent("HTMLEvents");
          ev.initEvent("change", true, false);
          combo.dispatchEvent(ev);
        }
      } else if (attempt > 20) {
        clearInterval(timer); // widget never rendered — give up silently
      }
    }, 300);
  }

  function rememberLanguage() {
    document.addEventListener("change", function (e) {
      if (e.target && e.target.classList && e.target.classList.contains("goog-te-combo")) {
        var v = e.target.value || "";
        if (v && v !== "") set(LANG_KEY, v);
      }
    }, true);
    // also remember the page's own language link (/hi/) once visited
    document.querySelectorAll('a[href="/hi/"]').forEach(function (a) {
      a.addEventListener("click", function () { set(LANG_KEY, "hi"); });
    });
  }

  /* ---------------- 2. beat follows + "Your news" ---------------- */
  function follows() {
    try { return JSON.parse(get(FOLLOWS_KEY) || "[]"); } catch { return []; }
  }

  function saveFollows(list) {
    set(FOLLOWS_KEY, JSON.stringify(list));
  }

  function buildYourNews() {
    var followed = follows();
    if (!followed.length) return;
    var wrap = document.createElement("div");
    wrap.className = "yournews";
    var html = '<h2 class="sec">⭐ Your news</h2><div class="cols">';
    followed.forEach(function (beat) {
      var col = document.querySelector('.col h3 a[href="/category/' + beat + '.html"]');
      var colBox = col && col.closest(".col");
      if (colBox) {
        html += '<div class="col" data-beat="' + beat + '">' + colBox.innerHTML + "</div>";
      } else {
        // front page without that section (no stories yet) — link only
        html += '<div class="col" data-beat="' + beat + '"><h3><a href="/category/' + beat + '.html">' + beat + "</a></h3><ul><li><small>Section waiting for stories…</small></li></ul></div>";
      }
    });
    html += "</div>";
    wrap.innerHTML = html;
    var firstSec = document.querySelector("main, .wrap");
    if (firstSec) firstSec.insertBefore(wrap, firstSec.firstChild.nextSibling ? firstSec.children[1] : firstSec.firstChild);
  }

  function addFollowButtons() {
    document.querySelectorAll(".col h3 a[href^='/category/']").forEach(function (a) {
      var beat = (a.getAttribute("href") || "").split("/").pop().replace(".html", "");
      var h3 = a.parentElement;
      var btn = document.createElement("button");
      btn.className = "followbtn";
      var list = follows();
      var on = list.indexOf(beat) !== -1;
      btn.textContent = on ? "✓ following" : "+ follow";
      btn.addEventListener("click", function () {
        var cur = follows();
        var i = cur.indexOf(beat);
        if (i === -1) { cur.push(beat); btn.textContent = "✓ following"; }
        else { cur.splice(i, 1); btn.textContent = "+ follow"; if (!cur.length) location.reload(); }
        saveFollows(cur);
        buildYourNews();
      });
      h3.appendChild(btn);
    });
  }

  /* ---------------- boot ---------------- */
  function init() {
    rememberLanguage();
    applySavedLanguage();
    addFollowButtons();
    buildYourNews();
    var s = document.createElement("style");
    s.textContent =
      ".followbtn{margin-left:8px;font-size:10px;padding:2px 7px;border-radius:8px;border:1px solid #999;background:#fff;cursor:pointer;vertical-align:middle}" +
      ".followbtn:hover{border-color:var(--accent);color:var(--accent)}" +
      ".yournews{margin-top:18px}" +
      ".yournews .sec{margin-top:0}";
    document.head.appendChild(s);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
