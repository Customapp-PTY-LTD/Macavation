/**
 * Opens in-app help in a modal iframe (WebPortal/help/index.html).
 * Help links use class "macavation-help-link" and href "help/index.html#topic-id".
 */
(function () {
  "use strict";

  var HELP_PAGE = "help/index.html";

  function openHelpModal(hash) {
    var frame = document.getElementById("helpGuideFrame");
    var modalEl = document.getElementById("helpGuideModal");
    if (!frame || !modalEl || typeof bootstrap === "undefined") return;
    var url = HELP_PAGE + (hash ? "#" + encodeURIComponent(hash) : "");
    frame.src = url;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
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
    openHelpModal(hash);
  });

  var modalEl = document.getElementById("helpGuideModal");
  if (modalEl) {
    modalEl.addEventListener("hidden.bs.modal", function () {
      var frame = document.getElementById("helpGuideFrame");
      if (frame) frame.src = "about:blank";
    });
  }
})();
