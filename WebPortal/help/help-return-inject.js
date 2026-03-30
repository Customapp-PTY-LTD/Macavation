/**
 * Sticky bar: always-visible links back to documentation index, manual, full guide, portal.
 * Skips help-index.html (that page uses its own hub bar in markup).
 */
(function () {
  "use strict";

  function init() {
    if (document.getElementById("help-return-bar")) return;

    var path = window.location.pathname || "";
    if (path.indexOf("help-index.html") !== -1) return;

    var nav = document.createElement("nav");
    nav.id = "help-return-bar";
    nav.className = "help-return-bar";
    nav.setAttribute("aria-label", "Documentation navigation");

    var inner = document.createElement("div");
    inner.className = "help-return-bar-inner";

    function addLink(href, text) {
      var a = document.createElement("a");
      a.href = href;
      a.textContent = text;
      inner.appendChild(a);
    }

    function addSep() {
      var s = document.createElement("span");
      s.className = "help-return-bar-sep";
      s.setAttribute("aria-hidden", "true");
      s.textContent = "|";
      inner.appendChild(s);
    }

    addLink("help-index.html", "Documentation index");
    addSep();
    addLink("user-manual.html", "User manual");
    addSep();
    addLink("index.html?full=1", "Full user guide");
    addSep();
    addLink("../index.html", "Web Portal");

    nav.appendChild(inner);

    var skip = document.querySelector("body > .manual-skip");
    if (skip) {
      skip.insertAdjacentElement("afterend", nav);
    } else {
      document.body.insertBefore(nav, document.body.firstChild);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
