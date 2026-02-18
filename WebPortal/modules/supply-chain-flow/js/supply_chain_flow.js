/**
 * Supply Chain Process Flow module
 * Renders the flow from docs/SUPPLY_CHAIN_PROCESS_FLOW.md and implementation checklist.
 */
(function () {
    function initMermaid() {
        var block = document.getElementById('supplyChainMermaid');
        if (!block || !window.mermaid) return;
        try {
            block.removeAttribute('data-processed');
            window.mermaid.init(undefined, block);
        } catch (e) {
            console.warn('[Supply Chain Flow] Mermaid render failed:', e);
        }
    }

    function loadMermaidThenInit() {
        if (window.mermaid) {
            initMermaid();
            return;
        }
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        script.crossOrigin = 'anonymous';
        script.onload = function () {
            if (window.mermaid) {
                window.mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
                initMermaid();
            }
        };
        script.onerror = function () { console.warn('[Supply Chain Flow] Mermaid CDN load failed'); };
        document.head.appendChild(script);
    }

    function init() {
        loadMermaidThenInit();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
