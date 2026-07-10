/**
 * Bootstrap collapse helpers for module section panels (chevron + aria-expanded sync).
 */
(function () {
    'use strict';

    function syncToggleAria(toggleBtn, panel) {
        if (!toggleBtn || !panel) return;
        var isExpanded = panel.classList.contains('show');
        toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    function bindCollapsePanel(toggleBtn, panel) {
        if (!toggleBtn || !panel || toggleBtn.dataset.macSectionCollapseBound === '1') return;
        toggleBtn.dataset.macSectionCollapseBound = '1';
        syncToggleAria(toggleBtn, panel);
        panel.addEventListener('shown.bs.collapse', function () {
            syncToggleAria(toggleBtn, panel);
        });
        panel.addEventListener('hidden.bs.collapse', function () {
            syncToggleAria(toggleBtn, panel);
        });
    }

    function initMacSectionCollapses(root) {
        var scope = root && root.querySelector ? root : document;
        scope.querySelectorAll('.mac-section-collapse-toggle[data-bs-toggle="collapse"]').forEach(function (btn) {
            var targetSel = btn.getAttribute('data-bs-target');
            if (!targetSel) return;
            var panel = scope.querySelector(targetSel);
            if (!panel) panel = document.querySelector(targetSel);
            bindCollapsePanel(btn, panel);
        });
    }

    window.initMacSectionCollapses = initMacSectionCollapses;
})();
