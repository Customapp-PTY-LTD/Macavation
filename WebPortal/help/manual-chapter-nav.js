/**
 * Injects per-chapter prev / next / index links on user-manual.html
 */
(function () {
  "use strict";

  function init() {
    var articles = Array.prototype.slice.call(
      document.querySelectorAll("article.manual-chapter[id]")
    );
    if (!articles.length) return;

    var indexHref = "help-index.html";

    articles.forEach(function (article, i) {
      var prev = articles[i - 1];
      var next = articles[i + 1];

      var nav = document.createElement("nav");
      nav.className = "manual-chapter-nav";
      nav.setAttribute("aria-label", "Chapter navigation");

      var home = document.createElement("a");
      home.className = "manual-chapter-nav-home";
      home.href = indexHref;
      home.textContent = "Documentation index";

      var steps = document.createElement("div");
      steps.className = "manual-chapter-nav-steps";

      if (prev) {
        var aPrev = document.createElement("a");
        aPrev.className = "manual-chapter-nav-prev";
        aPrev.href = "#" + encodeURIComponent(prev.id);
        var prevTitle = prev.querySelector("h2");
        aPrev.textContent =
          "← " + (prevTitle ? prevTitle.textContent.trim() : "Previous");
        steps.appendChild(aPrev);
      } else {
        var aFirst = document.createElement("a");
        aFirst.href = indexHref;
        aFirst.className = "manual-chapter-nav-prev manual-chapter-nav-fallback";
        aFirst.textContent = "← Back to index";
        steps.appendChild(aFirst);
      }

      if (next) {
        var aNext = document.createElement("a");
        aNext.className = "manual-chapter-nav-next";
        aNext.href = "#" + encodeURIComponent(next.id);
        var nextTitle = next.querySelector("h2");
        aNext.textContent =
          (nextTitle ? nextTitle.textContent.trim() : "Next") + " →";
        steps.appendChild(aNext);
      } else {
        var aEnd = document.createElement("a");
        aEnd.className = "manual-chapter-nav-next manual-chapter-nav-fallback";
        aEnd.href = indexHref;
        aEnd.textContent = "Index →";
        steps.appendChild(aEnd);
      }

      nav.appendChild(home);
      nav.appendChild(steps);
      article.appendChild(nav);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
