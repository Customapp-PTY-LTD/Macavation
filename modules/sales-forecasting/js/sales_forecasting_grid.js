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
                const forecasts = await dataFunctions.callFunction('get_sales_forecasts', {});
                this.forecasts = forecasts || [];
                this.renderForecasts();
            } catch (error) {
                console.error('Error loading forecasts:', error);
            }
        },
        renderForecasts: function () {
            const tbody = $('#forecastsTableBody');
            tbody.empty();
            if (this.forecasts.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted">No forecasts found</td></tr>');
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
            Swal.fire('Info', 'Forecast details coming soon', 'info');
        }
    };
}();
const salesForecastingGrid = _salesForecastingGrid;
function initializeSalesForecastingGrid() {
    if (typeof salesForecastingGrid !== 'undefined') {
        salesForecastingGrid.init();
    }
}

