/* push.js — opt-in web push alerts for The Daily Prompt.
 * Adds a small bell control in the masthead nav on every page:
 *   🔔 Alerts (off)  →  click → permission prompt → subscribe -> /api/push/subscribe
 *   🔔 Alerts (on)   →  click → unsubscribe
 * Never auto-prompts; never nags (dismiss stored for 7 days). All failures
 * silent — notifications are a bonus, not a requirement.
 */
(function () {
  "use strict";

  var DISMISS_KEY = "tdp.push.dismissed";
  var ASKED_KEY = "tdp.push.asked";

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function currentSub() {
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    });
  }

  function subscribe() {
    return fetch("/api/push/vapid")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.publicKey) throw new Error("no vapid key");
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(d.publicKey),
          });
        });
      })
      .then(function (sub) {
        return fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      });
  }

  function unsubscribe() {
    return currentSub().then(function (sub) {
      if (!sub) return;
      // best-effort server cleanup: mark dead, worker prune clears it
      try {
        fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint, dead: true }),
        }).catch(function () {});
      } catch (e) {}
      return sub.unsubscribe();
    });
  }

  function render(btn, state) {
    if (state === "on") {
      btn.textContent = "🔔 Alerts: on";
      btn.setAttribute("aria-pressed", "true");
    } else {
      btn.textContent = "🔔 Alerts";
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function wire(btn) {
    btn.addEventListener("click", function () {
      if (!supported()) return;
      if (Notification.permission === "denied") {
        btn.title = "Notifications blocked in site settings";
        return;
      }
      currentSub()
        .then(function (sub) {
          if (sub) return unsubscribe().then(function () { render(btn, "off"); });
          set(ASKED_KEY, "1");
          return Notification.requestPermission().then(function (perm) {
            if (perm !== "granted") { set(DISMISS_KEY, String(Date.now())); return; }
            return subscribe().then(function () { render(btn, "on"); }).catch(function () {});
          });
        })
        .catch(function () {});
    });

    // initial state
    if (supported() && Notification.permission === "granted") {
      currentSub().then(function (sub) { render(btn, sub ? "on" : "off"); }).catch(function () {});
    }
  }

  function init() {
    if (!supported()) return; // iOS < 16.4, old browsers: bell simply absent
    if (Notification.permission === "denied") return;
    var nav = document.querySelector("header nav.nav") || document.querySelector(".nav");
    if (!nav) return;
    var btn = document.createElement("a");
    btn.href = "#";
    btn.id = "tdp-alerts";
    btn.textContent = "🔔 Alerts";
    btn.addEventListener("click", function (e) { e.preventDefault(); });
    nav.appendChild(document.createTextNode(" · "));
    nav.appendChild(btn);
    wire(btn);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
