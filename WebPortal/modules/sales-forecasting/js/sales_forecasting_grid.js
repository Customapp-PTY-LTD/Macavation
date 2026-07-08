/**
 * Sales Forecasting Grid Module
 * Follows company module pattern: IIFE, arrow methods, scope = _salesForecastingGrid for same-module calls.
 */
var _salesForecastingGrid = function () {
    'use strict';

    return {
        forecasts: [],

        init: async () => {
            const scope = _salesForecastingGrid;
            await scope.waitForReady();
            scope.setupEventListeners();
            await scope.loadForecasts();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                if (typeof $ !== 'undefined') {
                    $(document).ready(resolve);
                } else if (document.readyState === 'complete') {
                    resolve();
                } else {
                    document.addEventListener('DOMContentLoaded', resolve);
                }
            });
        },

        setupEventListeners: () => {
            const scope = _salesForecastingGrid;
            if (typeof $ === 'undefined') return;
            $('#addForecastBtn').on('click', function () {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'New forecast form coming soon', 'info');
            });
            $(document).on('click', '.js-view-forecast', function (e) {
                e.preventDefault();
                var id = $(this).attr('data-forecast-id');
                scope.viewForecast(id);
            });
        },

        loadForecasts: async () => {
            const scope = _salesForecastingGrid;
            try {
                var forecasts = await dataFunctions.getSalesForecasts().catch(function () { return []; });
                scope.forecasts = forecasts || [];
                scope.renderForecasts();
            } catch (error) {
                console.error('Error loading forecasts:', error);
                scope.showError('Unable to load sales forecasts. Please try again later.');
            }
        },

        renderForecasts: () => {
            const scope = _salesForecastingGrid;
            if (typeof $ === 'undefined') return;
            var tbody = $('#forecastsTableBody');
            tbody.empty();
            if (scope.forecasts.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No sales forecasts found. Click "New Forecast" to create one.</td></tr>');
                return;
            }
            scope.forecasts.forEach(function (forecast) {
                var row = '<tr><td>' + (forecast.forecast_period || 'N/A') + '</td><td>' + (forecast.product_type || 'N/A') + '</td><td>' + (forecast.forecasted_quantity_kg || '0') + '</td><td>' + (forecast.confidence_level || 'N/A') + '</td><td><span class="badge bg-info">' + (forecast.status || 'draft') + '</span></td><td class="mac-table-actions-col">' + MacTableActions.render({
                    items: [{ label: 'View', className: 'js-view-forecast', icon: 'fas fa-eye', attrs: { 'data-forecast-id': forecast.id || '' } }]
                }) + '</td></tr>';
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('forecastsTable'));
        },

        viewForecast: (forecastId) => {
            if (typeof Swal !== 'undefined') Swal.fire('Info', 'Forecast details view is under development', 'info');
        },

        showError: (message) => {
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: message });
        },

        exportForecasts: () => {
            const scope = _salesForecastingGrid;
            if (!scope.forecasts || scope.forecasts.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No forecasts to export', 'info');
                return;
            }
            var columns = [
                { key: 'forecast_period', label: 'Period' },
                { key: 'product_type', label: 'Product Type' },
                { key: 'forecasted_quantity_kg', label: 'Forecasted Quantity (kg)' },
                { key: 'confidence_level', label: 'Confidence Level' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.forecasts, 'sales_forecasts', columns);
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

window.salesForecastingGrid = _salesForecastingGrid;

function initializeSalesForecastingGrid() {
    if (typeof _salesForecastingGrid !== 'undefined') {
        if (typeof $ !== 'undefined') {
            $(document).ready(function () { _salesForecastingGrid.init(); });
        } else if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { _salesForecastingGrid.init(); });
        } else {
            _salesForecastingGrid.init();
        }
    }
}
