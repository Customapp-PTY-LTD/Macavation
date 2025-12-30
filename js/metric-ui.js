/**
 * Context-Aware Metric UI Components
 * Implements Process-Driven Design: Context-Aware Metrics
 */

var _metricUI = function () {
    return {
        /**
         * Render context-aware metric card
         */
        renderMetricCard: function (metric) {
            const {
                title,
                value,
                unit = '',
                target = null,
                current = null,
                trend = null,
                trendPeriod = 'vs. last period',
                exceptions = [],
                icon = 'bi-graph-up',
                color = 'primary'
            } = metric;
            
            // Calculate percentage if target exists
            const percentage = target && current !== null ? Math.min(100, (current / target) * 100) : null;
            
            // Determine trend direction
            const trendClass = trend !== null 
                ? (trend > 0 ? 'trend-up' : trend < 0 ? 'trend-down' : 'trend-neutral')
                : '';
            
            const trendIcon = trend !== null
                ? (trend > 0 ? 'bi-arrow-up' : trend < 0 ? 'bi-arrow-down' : 'bi-dash')
                : '';
            
            // Determine status
            const statusClass = percentage !== null
                ? (percentage >= 100 ? 'status-excellent' : percentage >= 80 ? 'status-good' : percentage >= 60 ? 'status-warning' : 'status-critical')
                : '';
            
            return `
                <div class="metric-card ${statusClass}">
                    <div class="metric-header">
                        <span class="metric-icon">
                            <i class="bi ${icon}"></i>
                        </span>
                        <span class="metric-title">${title}</span>
                    </div>
                    <div class="metric-body">
                        <div class="metric-value">${this.formatValue(value)}</div>
                        <div class="metric-label">${unit}</div>
                        ${percentage !== null ? `
                            <div class="metric-progress">
                                <div class="progress-bar" style="width: ${percentage}%"></div>
                            </div>
                            <div class="metric-target">
                                Target: ${this.formatValue(target)} ${unit} (${percentage.toFixed(1)}%)
                            </div>
                        ` : ''}
                        ${trend !== null ? `
                            <div class="metric-comparison">
                                <span class="trend ${trendClass}">
                                    <i class="bi ${trendIcon}"></i>
                                    ${Math.abs(trend).toFixed(1)}%
                                </span>
                                <span class="period">${trendPeriod}</span>
                            </div>
                        ` : ''}
                    </div>
                    ${exceptions && exceptions.length > 0 ? `
                        <div class="metric-footer">
                            <a href="#" onclick="metricUI.viewExceptions('${title}')" class="metric-exceptions-link">
                                <i class="bi bi-exclamation-triangle-fill me-1"></i>
                                ${exceptions.length} item${exceptions.length !== 1 ? 's' : ''} need attention
                            </a>
                        </div>
                    ` : ''}
                </div>
            `;
        },

        /**
         * Format value for display
         */
        formatValue: function (value) {
            if (value === null || value === undefined) return 'N/A';
            
            if (typeof value === 'number') {
                // Format large numbers
                if (value >= 1000000) {
                    return (value / 1000000).toFixed(2) + 'M';
                } else if (value >= 1000) {
                    return (value / 1000).toFixed(2) + 'K';
                } else if (value % 1 !== 0) {
                    return value.toFixed(2);
                } else {
                    return value.toLocaleString();
                }
            }
            
            return value;
        },

        /**
         * Render metric panel
         */
        renderMetricPanel: function (metrics, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            if (!metrics || metrics.length === 0) {
                container.innerHTML = '<div class="alert alert-info">No metrics available</div>';
                return;
            }
            
            const html = `
                <div class="row g-3">
                    ${metrics.map(metric => `
                        <div class="col-md-6 col-lg-3">
                            ${this.renderMetricCard(metric)}
                        </div>
                    `).join('')}
                </div>
            `;
            
            container.innerHTML = html;
        },

        /**
         * View exceptions for a metric
         */
        viewExceptions: function (metricTitle) {
            // Navigate to exceptions view filtered by metric
            if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                _appRouter.loadContent('exceptions-grid', { metric: metricTitle });
            }
        }
    };
}();

// Create global instance
const metricUI = _metricUI;
window.metricUI = metricUI;

