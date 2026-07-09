/**
 * Opens user guide in a new browser tab (WebPortal/help/index.html).
 * Help links use class "macavation-help-link" and href "help/index.html#topic-id".
 */
(function () {
  "use strict";

  var HELP_PAGE = "help/index.html";

  function openHelpInNewTab(hash) {
    var url = HELP_PAGE + (hash ? "#" + encodeURIComponent(hash) : "");
    var win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = url;
    }
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest("a.macavation-help-link");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (href.indexOf("help/index.html") === -1) return;
    e.preventDefault();
    var i = href.indexOf("#");
    var hash = i >= 0 ? href.slice(i + 1) : "";
    try {
      hash = decodeURIComponent(hash);
    } catch (err) {
      /* keep raw */
    }
    var tabListSel = a.getAttribute("data-macavation-help-tablist");
    if (tabListSel) {
      var tabList = null;
      try {
        tabList = document.querySelector(tabListSel);
      } catch (err2) {
        tabList = null;
      }
      if (tabList) {
        var activeTab = tabList.querySelector(
          ".nav-link.active, button.nav-link.active, [role='tab'][aria-selected='true']"
        );
        if (activeTab) {
          var tabAnchor = activeTab.getAttribute("data-help-anchor");
          if (tabAnchor) hash = tabAnchor;
        }
      }
    }
    openHelpInNewTab(hash);
  });

  /* ---- Placement: the help "?" sits directly after its section heading ----
   * Help links are authored inside header toolbars; move each one to the end of
   * its nearest heading so it renders as "Heading ?". Runs on load and watches
   * for dynamically injected modules/modals. CSS (.macavation-help-link) turns
   * it into the quiet icon. */
  function findHeading(a) {
    var modalHeader = a.closest(".modal-header");
    if (modalHeader) {
      return modalHeader.querySelector(".modal-title, h1, h2, h3, h4, h5, h6");
    }
    var el = a.parentElement;
    for (var up = 0; up < 5 && el; up++, el = el.parentElement) {
      var h = el.querySelector("h1, h2, h3, h4, h5, h6, .modal-title");
      if (h && !h.contains(a)) return h;
    }
    return null;
  }

  function placeHelpIcon(a) {
    if (a.getAttribute("data-help-placed") === "1") return;
    a.setAttribute("data-help-placed", "1"); // set first, so the move below can't re-trigger
    var heading = findHeading(a);
    if (heading && !heading.contains(a)) heading.appendChild(a);
  }

  function scanHelpIcons() {
    var links = document.querySelectorAll(
      "a.macavation-help-link:not([data-help-placed])"
    );
    for (var i = 0; i < links.length; i++) placeHelpIcon(links[i]);
  }

  var scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    var run = function () {
      scanScheduled = false;
      scanHelpIcons();
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else window.setTimeout(run, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanHelpIcons);
  } else {
    scanHelpIcons();
  }

  try {
    // childList only (not attributes), so setting data-help-placed won't loop.
    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (err3) {
    /* no MutationObserver: links still work, just not relocated */
  }
})();
