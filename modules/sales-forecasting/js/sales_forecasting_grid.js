/**
 * Sales Forecasting Grid Module
 */
var _salesForecastingGrid = function () {
    return {
        forecasts: [],
        init: function () {
            this.setupEventListeners();
            this.loadForecasts();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#addForecastBtn').on('click', function () {
                Swal.fire('Info', 'New forecast form coming soon', 'info');
            });
        },
        loadForecasts: async function () {
            try {
                const forecasts = await dataFunctions.getSalesForecasts().catch(() => []);
                this.forecasts = forecasts || [];
                this.renderForecasts();
            } catch (error) {
                console.error('Error loading forecasts:', error);
                this.showError('Unable to load sales forecasts. Please try again later.');
            }
        },
        renderForecasts: function () {
            const tbody = $('#forecastsTableBody');
            tbody.empty();
            if (this.forecasts.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No sales forecasts found. Click "New Forecast" to create one.</td></tr>');
                return;
            }
            this.forecasts.forEach(forecast => {
                const row = `<tr>
                    <td>${forecast.forecast_period || 'N/A'}</td>
                    <td>${forecast.product_type || 'N/A'}</td>
                    <td>${forecast.forecasted_quantity_kg || '0'}</td>
                    <td>${forecast.confidence_level || 'N/A'}</td>
                    <td><span class="badge bg-info">${forecast.status || 'draft'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="salesForecastingGrid.viewForecast('${forecast.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        viewForecast: function (forecastId) {
            Swal.fire('Info', 'Forecast details view is under development', 'info');
        },
        showError: function (message) {
            Swal.fire({ icon: 'error', title: 'Error', text: message });
        },
        exportForecasts: function () {
            if (!this.forecasts || this.forecasts.length === 0) {
                Swal.fire('Info', 'No forecasts to export', 'info');
                return;
            }
            
            const columns = [
                { key: 'forecast_period', label: 'Period' },
                { key: 'product_type', label: 'Product Type' },
                { key: 'forecasted_quantity_kg', label: 'Forecasted Quantity (kg)' },
                { key: 'confidence_level', label: 'Confidence Level' },
                { key: 'status', label: 'Status' }
            ];
            
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(this.forecasts, 'sales_forecasts', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();
const salesForecastingGrid = _salesForecastingGrid;
function initializeSalesForecastingGrid() {
    if (typeof salesForecastingGrid !== 'undefined') {
        salesForecastingGrid.init();
    }
}

