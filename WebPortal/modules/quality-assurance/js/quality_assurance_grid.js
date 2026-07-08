/**
 * Quality Assurance Grid Module
 * Follows company module pattern: IIFE, arrow methods, scope = _qualityAssuranceGrid for same-module calls.
 */
var _qualityAssuranceGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        tests: [],
        filteredTests: [],
        searchDebounceToken: 0,

        init: async () => {
            const scope = _qualityAssuranceGrid;
            await scope.waitForReady();
            var modalContainers = document.querySelectorAll('.modal[route-name]');
            var loadPromises = [];
            modalContainers.forEach(function (el) {
                var routeName = el.getAttribute('route-name');
                if (routeName && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + el.id }));
                }
            });
            if (loadPromises.length) await Promise.all(loadPromises);
            if (typeof _modal_quality_test !== 'undefined' && _modal_quality_test.init) _modal_quality_test.init();
            scope.setupEventListeners();
            await scope.loadTests();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _qualityAssuranceGrid;

            $('#addTestBtn').on('click', function () {
                if (typeof _modal_quality_test !== 'undefined' && _modal_quality_test.show) _modal_quality_test.show();
            });

            $('#searchTestsInput').on('input', function () {
                var token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) scope.filterTests();
                });
            });

            $('#filterTestType, #filterTestResult').on('change', function () {
                scope.filterTests();
            });

            $('#clearTestFiltersBtn').on('click', function () {
                const scope = _qualityAssuranceGrid;
                $('#searchTestsInput').val('');
                $('#filterTestType').val('');
                $('#filterTestResult').val('');
                scope.filterTests();
            });

            $(document).on('click', '.js-view-qa-test', function (e) {
                e.preventDefault();
                scope.viewTest($(this).data('test-id'));
            });
        },

        filterTests: () => {
            const scope = _qualityAssuranceGrid;
            var searchTerm = $('#searchTestsInput').val().toLowerCase();
            var typeFilter = $('#filterTestType').val();
            var resultFilter = $('#filterTestResult').val();
            scope.filteredTests = scope.tests.filter(function (test) {
                var matchesSearch = !searchTerm ||
                    (test.test_number && test.test_number.toLowerCase().includes(searchTerm)) ||
                    (test.batch_number && test.batch_number.toLowerCase().includes(searchTerm)) ||
                    (test.overall_result && test.overall_result.toLowerCase().includes(searchTerm));
                var matchesType = !typeFilter || test.test_type === typeFilter;
                var matchesResult = !resultFilter || test.overall_result === resultFilter;
                return matchesSearch && matchesType && matchesResult;
            });
            scope.renderTests();
        },

        loadTests: async (forceRefresh) => {
            const scope = _qualityAssuranceGrid;
            try {
                var startTime = performance.now();
                var tests = await dataFunctions.getQualityTests(null, forceRefresh || false);
                var loadTime = performance.now() - startTime;
                console.log('[Performance] Quality tests loaded in ' + loadTime.toFixed(2) + 'ms');
                scope.tests = tests || [];
                scope.filteredTests = scope.tests;
                scope.renderTests();
            } catch (error) {
                console.error('Error loading tests:', error);
            }
        },

        renderTests: () => {
            const scope = _qualityAssuranceGrid;
            if (typeof $ === 'undefined') return;
            var tbody = $('#testsTableBody');
            tbody.empty();
            if (scope.filteredTests.length === 0) {
                if (scope.tests.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No quality tests found. Click "New Quality Test" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No tests match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            scope.filteredTests.forEach(function (test) {
                var badgeClass = test.overall_result === 'pass' ? 'bg-success' : (test.overall_result === 'fail' ? 'bg-danger' : 'bg-warning');
                var row = '<tr><td>' + scope.escapeHtml(test.test_number || 'N/A') + '</td><td>' + scope.escapeHtml(test.test_type || 'N/A') + '</td><td>' + scope.escapeHtml(test.product_type || 'N/A') + '</td><td>' + scope.escapeHtml(test.batch_number || 'N/A') + '</td><td>' + scope.escapeHtml(test.test_date || 'N/A') + '</td><td><span class="badge ' + badgeClass + '">' + scope.escapeHtml(test.overall_result || 'pending') + '</span></td><td class="mac-table-actions-col">' + MacTableActions.render({
                    items: [{ label: 'View', className: 'js-view-qa-test', icon: 'fas fa-eye', dataAttrs: { 'test-id': test.id || '' } }]
                }) + '</td></tr>';
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('testsTable'));
        },

        viewTest: (testId) => {
            const scope = _qualityAssuranceGrid;
            var test = (scope.filteredTests || scope.tests || []).find(function (t) { return t.id === testId; });
            if (typeof _modal_quality_test !== 'undefined' && _modal_quality_test.show) _modal_quality_test.show(test);
            else if (typeof Swal !== 'undefined') Swal.fire('Info', 'Test details view coming soon', 'info');
        },

        exportTests: () => {
            const scope = _qualityAssuranceGrid;
            if (!scope.tests || scope.tests.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No tests to export', 'info');
                return;
            }
            var columns = [
                { key: 'test_number', label: 'Test Number' },
                { key: 'test_type', label: 'Test Type' },
                { key: 'product_type', label: 'Product Type' },
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'test_date', label: 'Test Date' },
                { key: 'overall_result', label: 'Result' },
                { key: 'moisture_percentage', label: 'Moisture %' },
                { key: 'ffa_percentage', label: 'FFA %' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.tests, 'quality_tests', columns);
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Export utility not available', 'error');
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

window.qualityAssuranceGrid = _qualityAssuranceGrid;

function initializeQualityAssuranceGrid() {
    if (typeof _qualityAssuranceGrid !== 'undefined') {
        if (typeof $ !== 'undefined') {
            $(document).ready(function () { _qualityAssuranceGrid.init(); });
        } else if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { _qualityAssuranceGrid.init(); });
        } else {
            _qualityAssuranceGrid.init();
        }
    }
}
