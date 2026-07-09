/**
 * App shell behaviour for the unified sidebar: the mobile drawer. On small
 * screens the sidebar slides in over a backdrop (the top navbar that used to
 * hold the toggler is gone).
 */
(function () {
  "use strict";

  function init() {
    var side = document.getElementById("sidebarMenu");
    if (!side) return;

    var menuBtn = document.getElementById("mobileMenuBtn");
    var backdrop = document.getElementById("sidebarBackdrop");

    function openDrawer() {
      side.classList.add("mobile-open");
      if (backdrop) backdrop.classList.add("show");
    }
    function closeDrawer() {
      side.classList.remove("mobile-open");
      if (backdrop) backdrop.classList.remove("show");
    }

    if (menuBtn) menuBtn.addEventListener("click", openDrawer);
    if (backdrop) backdrop.addEventListener("click", closeDrawer);

    // Tapping a destination closes the drawer on mobile.
    side.addEventListener("click", function (e) {
      if (e.target.closest("a[route]") && window.matchMedia("(max-width: 767.98px)").matches) {
        closeDrawer();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
