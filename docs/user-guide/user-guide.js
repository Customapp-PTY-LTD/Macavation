/**
 * Full guide vs single-section view:
 * - With a hash (#crm-grid), show only that section (from in-app Help).
 * - Open ?full=1 or click "Full guide" to see every section + table of contents.
 */
(function () {
  "use strict";

  function getTargetId() {
    var h = window.location.hash.replace(/^#/, "");
    try {
      return decodeURIComponent(h);
    } catch (e) {
      return h;
    }
  }

  function isFullMode() {
    return new URLSearchParams(window.location.search).get("full") === "1";
  }

  function getTitleForSection(el) {
    var h2 = el.querySelector("h2");
    return h2 ? h2.textContent.trim() : el.id;
  }

  function buildToc() {
    var toc = document.getElementById("guide-toc");
    if (!toc) return;
    var ul = document.createElement("ul");
    document.querySelectorAll("section.guide-section[id]").forEach(function (sec) {
      var id = sec.id;
      if (!id) return;
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "user-guide.html?full=1#" + encodeURIComponent(id);
      a.textContent = getTitleForSection(sec);
      li.appendChild(a);
      ul.appendChild(li);
    });
    toc.appendChild(ul);
  }

  function applyLayout() {
    var full = isFullMode();
    var id = getTargetId();
    var target = id ? document.getElementById(id) : null;
    var isGuideSection = target && target.classList && target.classList.contains("guide-section");
    var single = !full && isGuideSection;

    document.body.classList.toggle("guide-single", single);
    document.body.classList.toggle("guide-full", !single);

    var bar = document.getElementById("guide-single-bar");
    var intro = document.getElementById("guide-intro");
    var toc = document.getElementById("guide-toc");
    var process = document.getElementById("guide-process");
    var mainTitle = document.getElementById("guide-main-title");

    document.querySelectorAll("section.guide-section").forEach(function (sec) {
      sec.hidden = single && sec.id !== id;
    });

    if (intro) intro.hidden = single;
    if (toc) toc.hidden = single;
    if (process) process.hidden = single;
    if (mainTitle) mainTitle.hidden = single;

    if (bar && single && target) {
      bar.querySelector(".single-title").textContent = getTitleForSection(target);
      var back = bar.querySelector('a[data-action="full-guide"]');
      if (back) {
        back.href =
          "user-guide.html?full=1" + (id ? "#" + encodeURIComponent(id) : "");
      }
    }

    document.title = single
      ? getTitleForSection(target) + " — Macavation Help"
      : "Macavation User Guide";

    if (single && target) {
      target.scrollIntoView({ block: "start" });
    }
  }

  function markMissingImages() {
    document.querySelectorAll(".guide-shot img").forEach(function (img) {
      function fail(fig) {
        if (!fig) return;
        fig.classList.add("is-missing");
        var cap = fig.querySelector("figcaption");
        if (cap)
          cap.textContent =
            "Screenshot not found. Generate with: cd e2e && npx playwright test tests/user-guide/capture-module-screenshots.spec.ts (requires .env.e2e and BASE_URL).";
      }
      function ok(fig) {
        if (!fig) return;
        fig.classList.remove("is-missing");
      }
      img.addEventListener("error", function () {
        fail(img.closest(".guide-shot"));
      });
      img.addEventListener("load", function () {
        var fig = img.closest(".guide-shot");
        if (img.naturalWidth > 0) ok(fig);
        else fail(fig);
      });
      if (img.complete && img.naturalWidth === 0) fail(img.closest(".guide-shot"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    buildToc();
    applyLayout();
    markMissingImages();
    window.addEventListener("hashchange", applyLayout);
  }
})();
