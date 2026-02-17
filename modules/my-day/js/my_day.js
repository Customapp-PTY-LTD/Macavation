/**
 * My Day Dashboard Module
 * Role-Based Workflow View
 * Follows company module pattern: IIFE, arrow methods, scope = _myDayDashboard for same-module calls.
 */
var _myDayDashboard = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        init: async () => {
            const scope = _myDayDashboard;
            await scope.waitForReady();
            await scope.loadMyDay();
            scope.setupAutoRefresh();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        loadMyDay: async () => {
            const scope = _myDayDashboard;
            try {
                if (typeof workflowViews === 'undefined' || !workflowViews || typeof workflowViews.getMyDayData !== 'function') {
                    console.error('workflowViews not available');
                    scope.showErrorMarkup('my-day-container', 'Workflow views not available. Please refresh the page.');
                    return;
                }
                var data = await workflowViews.getMyDayData();
                if (data && typeof workflowViews.renderMyDay === 'function') {
                    workflowViews.renderMyDay(data, 'my-day-container');
                } else {
                    scope.showErrorMarkup('my-day-container', 'Unable to load your personalized dashboard. Please try again later.', 'warning');
                }
            } catch (error) {
                console.error('Error loading My Day:', error);
                var msg = (error && error.message) ? scope.escapeHtml(error.message) : 'Error loading dashboard.';
                scope.showErrorMarkup('my-day-container', 'Error loading dashboard: ' + msg, 'danger');
            }
        },

        setupAutoRefresh: () => {
            const scope = _myDayDashboard;
            // Refresh every 5 minutes
            setInterval(function () {
                scope.loadMyDay();
            }, 300000);
        },

        showErrorMarkup: (containerId, message, alertType) => {
            var el = document.getElementById(containerId);
            if (!el) return;
            var type = alertType || 'warning';
            el.innerHTML = '<div class="alert alert-' + type + '">' + _myDayDashboard.escapeHtml(message) + '</div>';
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

window.myDayDashboard = _myDayDashboard;

function initializeMyDay() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof workflowViews !== 'undefined' && workflowViews) {
            _myDayDashboard.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeMyDay();
});
