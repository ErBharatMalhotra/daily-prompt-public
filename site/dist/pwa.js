/* pwa.js — installable app experience for The Daily Prompt.
 * Android Chrome: intercepts beforeinstallprompt and shows our own styled
 * banner ("Install app") which triggers the native install dialog.
 * iOS Safari: shows manual "Add to Home Screen" instructions (A2HS).
 * Desktop: small banner too (Chrome/Edge support the same event).
 * Everything dismissible + persisted in localStorage; failures silent.
 */
(function () {
  "use strict";

  var DISMISS_KEY = "tdp.pwa.dismissed.v3";
  var INSTALLED_KEY = "tdp.pwa.installed";
  var deferredPrompt = null;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  function get(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch {} }

  function makeBanner(html, actions) {
    var bar = document.createElement("div");
    bar.id = "tdp-install-bar";
    bar.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:14px;z-index:99998;" +
      "background:#1c1c1c;color:#f4f4f4;border-radius:14px;padding:12px 14px;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.4);display:flex;gap:12px;align-items:center;" +
      "font:14px/1.45 system-ui,sans-serif;max-width:520px;margin:0 auto";
    bar.innerHTML =
      '<img src="/icons/icon-192.png" alt="" style="width:44px;height:44px;border-radius:10px;flex:0 0 auto">' +
      '<div style="flex:1">' + html + "</div>" +
      '<button id="tdp-install-yes" style="background:#8b0000;border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600;flex:0 0 auto">Install</button>' +
      '<button id="tdp-install-no" aria-label="Dismiss" style="background:none;border:none;color:#999;font-size:16px;cursor:pointer;padding:4px">✕</button>';
    document.body.appendChild(bar);
    bar.querySelector("#tdp-install-yes").addEventListener("click", actions.yes);
    bar.querySelector("#tdp-install-no").addEventListener("click", function () {
      set(DISMISS_KEY, String(Date.now()));
      bar.remove();
    });
    // auto-minimise after 20s of ignoring — silently, without recording a
    // dismissal (the banner returns on the next page until dismissed properly)
    setTimeout(function () {
      var b = document.getElementById("tdp-install-bar");
      if (b) b.remove();
    }, 20000);
    return bar;
  }

  function showNativeBanner() {
    if (document.getElementById("tdp-install-bar")) return;
    makeBanner(
      "<b>The Daily Prompt</b><br>Install the app — offline reading, daily editions, notifications-ready.",
      {
        yes: function () {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(function (choice) {
            if (choice && choice.outcome === "accepted") set(INSTALLED_KEY, "1");
            document.getElementById("tdp-install-bar")?.remove();
          });
        },
      }
    );
  }

  function showIOSBanner() {
    if (document.getElementById("tdp-install-bar")) return;
    makeBanner(
      "<b>Install on iPhone</b><br>Tap the Share button, then <b>Add to Home Screen</b>.",
      {
        yes: function () {
          set(DISMISS_KEY, String(Date.now()));
          document.getElementById("tdp-install-bar")?.remove();
        },
      }
    );
    // iOS: "Install" button just dismisses — it's instructions-only.
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (isStandalone) return;
    if (get(INSTALLED_KEY)) return;
    var dismissed = get(DISMISS_KEY);
    // re-show after 7 days even if dismissed earlier
    if (dismissed && Date.now() - Number(dismissed) < 7 * 86400000) return;
    // small delay so it never fights the page load
    setTimeout(showNativeBanner, 2500);
  });

  // Fallback: if beforeinstallprompt hasn't fired yet (service worker still
  // installing, engagement heuristics), still offer an Install button. When
  // tapped, wait briefly for the native prompt and fire it the moment it is
  // ready; only if it truly never arrives, explain the manual menu path.
  setTimeout(function () {
    if (deferredPrompt || isIOS || isStandalone) return;
    if (get(INSTALLED_KEY)) return;
    var dismissed = get(DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < 7 * 86400000) return;
    makeBanner(
      "<b>The Daily Prompt</b><br>Install the app — offline reading, daily editions, notifications.",
      {
        yes: function () {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (choice) {
              if (choice && choice.outcome === "accepted") set(INSTALLED_KEY, "1");
              document.getElementById("tdp-install-bar")?.remove();
            });
            return;
          }
          // native prompt not ready yet — wait for it briefly
          var btn = document.getElementById("tdp-install-yes");
          if (btn) { btn.textContent = "Preparing…"; btn.disabled = true; }
          var waited = 0;
          var iv = setInterval(function () {
            waited += 500;
            if (deferredPrompt) {
              clearInterval(iv);
              deferredPrompt.prompt();
              deferredPrompt.userChoice.then(function (choice) {
                if (choice && choice.outcome === "accepted") set(INSTALLED_KEY, "1");
                document.getElementById("tdp-install-bar")?.remove();
              });
            } else if (waited >= 8000) {
              clearInterval(iv);
              document.getElementById("tdp-install-bar")?.remove();
              makeBanner(
                "<b>Install on Android</b><br>Tap the browser menu (⋮) → <b>Add to Home screen</b>.",
                {
                  yes: function () {
                    set(DISMISS_KEY, String(Date.now()));
                    document.getElementById("tdp-install-bar")?.remove();
                  },
                }
              );
            }
          }, 500);
        },
      }
    );
  }, 5000);

  window.addEventListener("appinstalled", function () {
    set(INSTALLED_KEY, "1");
    document.getElementById("tdp-install-bar")?.remove();
  });

  function init() {
    if (isStandalone) return; // already running as the installed app
    // iOS has no beforeinstallprompt — instruction banner after 4s (first visits)
    if (isIOS && !get(DISMISS_KEY) && !get(INSTALLED_KEY)) {
      setTimeout(showIOSBanner, 4000);
    }
    // register the service worker (offline support)
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
