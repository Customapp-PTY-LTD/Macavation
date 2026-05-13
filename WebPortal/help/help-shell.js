/**
 * Help shell in a browser tab: single-topic vs full guide, TOC, missing screenshots.
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
    toc.querySelectorAll("ul").forEach(function (ul) {
      ul.remove();
    });
    var ul = document.createElement("ul");
    document.querySelectorAll("section.guide-section[id]").forEach(function (sec) {
      var id = sec.id;
      if (!id) return;
      if (sec.getAttribute("data-exclude-from-full-guide") === "1") return;
      if (sec.getAttribute("data-toc") === "0") return;
      var li = document.createElement("li");
      var a = document.createElement("a");
      var base = window.location.pathname.split("/").pop() || "index.html";
      a.href = base + "?full=1#" + encodeURIComponent(id);
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

    var intro = document.getElementById("guide-intro");
    var toc = document.getElementById("guide-toc");
    var process = document.getElementById("guide-process");
    var mainTitle = document.getElementById("guide-main-title");

    document.querySelectorAll("section.guide-section").forEach(function (sec) {
      var excludeFull = sec.getAttribute("data-exclude-from-full-guide") === "1";
      sec.hidden =
        (full && excludeFull) ||
        (single && sec.id !== id);
    });

    if (intro) intro.hidden = single;
    if (toc) toc.hidden = single;
    if (mainTitle) mainTitle.hidden = single;

    var hubStrip = document.getElementById("guide-hub-strip");
    if (hubStrip) hubStrip.hidden = single;

    if (process) process.hidden = single;

    var bar = document.getElementById("guide-single-bar");
    if (bar && single && target) {
      var titleEl = bar.querySelector(".single-title");
      if (titleEl) titleEl.textContent = getTitleForSection(target);
      var fullLink = bar.querySelector('a[data-action="full-guide"]');
      if (fullLink) {
        var baseName = window.location.pathname.split("/").pop() || "index.html";
        fullLink.href = baseName + "?full=1" + (id ? "#" + encodeURIComponent(id) : "");
      }
    }

    var fullToolbar = document.getElementById("guide-full-toolbar");
    if (fullToolbar) {
      if (single) fullToolbar.setAttribute("hidden", "");
      else fullToolbar.removeAttribute("hidden");
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

  function initDownloadPdf() {
    document.querySelectorAll('[data-action="download-pdf"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.print();
      });
    });
  }

  function initBackToTop() {
    var btn = document.getElementById("back-to-top");
    if (!btn) return;
    var visible = false;
    window.addEventListener("scroll", function () {
      var show = window.scrollY > 400;
      if (show !== visible) {
        visible = show;
        btn.style.display = show ? "block" : "none";
      }
    }, { passive: true });
  }

  function init() {
    buildToc();
    markMissingImages();
    applyLayout();
    initDownloadPdf();
    initBackToTop();
    window.addEventListener("hashchange", applyLayout);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
