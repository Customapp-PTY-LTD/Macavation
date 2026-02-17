/**
 * Oil & Protein Dispatch Grid Module
 * INV from OIL PROTEIN R YES → FEED+OIL+PROTEIN CUSTOMERS → DEBTORS.
 * Follows company module pattern: IIFE, arrow methods, scope = _oilDispatchGrid for same-module calls.
 */
var _oilDispatchGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        init: async () => {
            const scope = _oilDispatchGrid;
            await scope.waitForReady();
            scope.setupEventListeners();
            await scope.loadData();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _oilDispatchGrid;
            // Attach handlers by id/selector when DOM elements exist
        },

        loadData: async () => {
            const scope = _oilDispatchGrid;
            // Data capture for oil & protein dispatch (INV to feed/oil/protein customers) - to be implemented
        },

        showError: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'error');
            } else if (typeof Swal !== 'undefined' && Swal.fire) {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                alert(message);
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        formatDate: (value) => {
            if (!value) return '';
            var d = value instanceof Date ? value : new Date(value);
            if (isNaN(d.getTime())) return '';
            var day = String(d.getDate()).padStart(2, '0');
            var month = String(d.getMonth() + 1).padStart(2, '0');
            var year = d.getFullYear();
            return day + '/' + month + '/' + year;
        }
    };
}();

window.oilDispatchGrid = _oilDispatchGrid;

function initializeOilDispatchGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined' && dataFunctions) {
            _oilDispatchGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeOilDispatchGrid();
});
