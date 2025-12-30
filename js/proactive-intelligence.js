/**
 * Proactive Intelligence
 * Implements Process-Driven Design: Proactive Intelligence
 * Provides trend projections and predictions
 */

var _proactiveIntelligence = function () {
    return {
        /**
         * Calculate trend for a metric
         */
        calculateTrend: function (values, period = 'week') {
            if (!values || values.length < 2) return null;

            // Simple linear regression for trend
            const n = values.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

            values.forEach((value, index) => {
                const x = index;
                const y = value;
                sumX += x;
                sumY += y;
                sumXY += x * y;
                sumX2 += x * x;
            });

            const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
            const intercept = (sumY - slope * sumX) / n;

            // Calculate percentage change
            const firstValue = values[0];
            const lastValue = values[values.length - 1];
            const percentageChange = firstValue !== 0 
                ? ((lastValue - firstValue) / firstValue) * 100 
                : 0;

            return {
                slope: slope,
                intercept: intercept,
                percentageChange: percentageChange,
                direction: slope > 0 ? 'up' : slope < 0 ? 'down' : 'neutral',
                current: lastValue,
                previous: firstValue
            };
        },

        /**
         * Project future value
         */
        projectValue: function (trend, periodsAhead = 1) {
            if (!trend) return null;

            const projectedValue = trend.intercept + trend.slope * (trend.current + periodsAhead);
            return Math.max(0, projectedValue); // Ensure non-negative
        },

        /**
         * Get trend projection for metric
         */
        getTrendProjection: async function (metricName, entityId = null, periods = 4) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const projection = await dataFunctions.callFunction('get_trend_projection', {
                        p_metric_name: metricName,
                        p_entity_id: entityId,
                        p_periods: periods
                    }, null, {
                        cacheKey: `trend_${metricName}_${entityId || 'all'}_${periods}`,
                        useCache: true,
                        cacheTtl: 300000 // 5 minutes
                    });
                    return projection || null;
                }
                return null;
            } catch (error) {
                console.error('Error getting trend projection:', error);
                return null;
            }
        },

        /**
         * Detect patterns
         */
        detectPattern: function (values) {
            if (!values || values.length < 3) return null;

            // Detect if values are increasing, decreasing, or cyclical
            let increasing = 0;
            let decreasing = 0;
            let stable = 0;

            for (let i = 1; i < values.length; i++) {
                const diff = values[i] - values[i - 1];
                if (diff > 0) increasing++;
                else if (diff < 0) decreasing++;
                else stable++;
            }

            const total = values.length - 1;
            const pattern = {
                increasing: (increasing / total) * 100,
                decreasing: (decreasing / total) * 100,
                stable: (stable / total) * 100,
                type: increasing > decreasing ? 'increasing' : decreasing > increasing ? 'decreasing' : 'stable'
            };

            return pattern;
        },

        /**
         * Predict threshold breach
         */
        predictThresholdBreach: function (currentValue, threshold, trend) {
            if (!trend || trend.slope === 0) return null;

            // Calculate periods until threshold breach
            const targetValue = threshold;
            const periodsUntilBreach = (targetValue - trend.current) / trend.slope;

            return {
                willBreach: (trend.slope > 0 && targetValue > trend.current) || 
                           (trend.slope < 0 && targetValue < trend.current),
                periodsUntilBreach: Math.abs(periodsUntilBreach),
                projectedBreachDate: this.calculateBreachDate(periodsUntilBreach),
                severity: this.calculateBreachSeverity(periodsUntilBreach)
            };
        },

        /**
         * Calculate breach date
         */
        calculateBreachDate: function (periods) {
            const today = new Date();
            const daysAhead = Math.ceil(periods * 7); // Assuming weekly periods
            const breachDate = new Date(today);
            breachDate.setDate(today.getDate() + daysAhead);
            return breachDate;
        },

        /**
         * Calculate breach severity
         */
        calculateBreachSeverity: function (periodsUntilBreach) {
            if (periodsUntilBreach <= 1) return 'critical';
            if (periodsUntilBreach <= 2) return 'warning';
            return 'info';
        },

        /**
         * Get predictive insights
         */
        getPredictiveInsights: async function (entityType, entityId = null) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const insights = await dataFunctions.callFunction('get_predictive_insights', {
                        p_entity_type: entityType,
                        p_entity_id: entityId
                    }, null, {
                        cacheKey: `insights_${entityType}_${entityId || 'all'}`,
                        useCache: true,
                        cacheTtl: 300000 // 5 minutes
                    });
                    return insights || [];
                }
                return [];
            } catch (error) {
                console.error('Error getting predictive insights:', error);
                return [];
            }
        },

        /**
         * Render trend projection
         */
        renderTrendProjection: function (projection, containerId) {
            const container = document.getElementById(containerId);
            if (!container || !projection) return;

            const { current, projected, trend, periodsAhead, threshold } = projection;
            const trendClass = trend > 0 ? 'trend-up' : trend < 0 ? 'trend-down' : 'trend-neutral';
            const trendIcon = trend > 0 ? 'bi-arrow-up' : trend < 0 ? 'bi-arrow-down' : 'bi-dash';

            const html = `
                <div class="trend-projection">
                    <h6 class="mb-3">
                        <i class="bi bi-graph-up me-2"></i>
                        Trend Projection
                    </h6>
                    <div class="projection-content">
                        <div class="projection-current">
                            <strong>Current:</strong> ${current}
                        </div>
                        <div class="projection-projected">
                            <strong>Projected (${periodsAhead} periods):</strong> ${projected}
                        </div>
                        <div class="projection-trend ${trendClass}">
                            <i class="bi ${trendIcon}"></i>
                            ${Math.abs(trend).toFixed(1)}% ${trend > 0 ? 'increase' : trend < 0 ? 'decrease' : 'stable'}
                        </div>
                        ${threshold ? `
                            <div class="projection-threshold">
                                <strong>Threshold:</strong> ${threshold}
                                ${this.renderThresholdBreachWarning(current, projected, threshold)}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        /**
         * Render threshold breach warning
         */
        renderThresholdBreachWarning: function (current, projected, threshold) {
            const willBreach = (projected > threshold && current < threshold) || 
                             (projected < threshold && current > threshold);
            
            if (willBreach) {
                const severity = Math.abs(projected - threshold) / threshold > 0.2 ? 'critical' : 'warning';
                return `
                    <div class="alert alert-${severity} mt-2">
                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                        Projected to breach threshold
                    </div>
                `;
            }
            return '';
        },

        /**
         * Render predictive insights
         */
        renderPredictiveInsights: function (insights, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            if (!insights || insights.length === 0) {
                container.innerHTML = '<div class="alert alert-info">No predictive insights available.</div>';
                return;
            }

            const html = `
                <div class="predictive-insights">
                    <h6 class="mb-3">
                        <i class="bi bi-lightbulb me-2"></i>
                        Predictive Insights
                    </h6>
                    <div class="insights-list">
                        ${insights.map(insight => `
                            <div class="insight-item insight-${insight.severity || 'info'}" data-insight-id="${insight.id}">
                                <div class="insight-header">
                                    <span class="insight-icon">
                                        <i class="bi ${this.getInsightIcon(insight.type)}"></i>
                                    </span>
                                    <span class="insight-title">${insight.title}</span>
                                    <span class="insight-badge badge bg-${this.getSeverityColor(insight.severity)}">
                                        ${insight.severity || 'info'}
                                    </span>
                                </div>
                                <div class="insight-body">
                                    <p class="insight-description">${insight.description || ''}</p>
                                    ${insight.projection ? `
                                        <div class="insight-projection">
                                            <strong>Projection:</strong> ${insight.projection}
                                        </div>
                                    ` : ''}
                                    ${insight.suggested_action ? `
                                        <div class="insight-action">
                                            <strong>Suggested Action:</strong> ${insight.suggested_action}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        /**
         * Get insight icon
         */
        getInsightIcon: function (type) {
            const iconMap = {
                'trend': 'bi-graph-up',
                'threshold': 'bi-exclamation-triangle',
                'pattern': 'bi-diagram-3',
                'anomaly': 'bi-shield-exclamation',
                'opportunity': 'bi-lightbulb'
            };
            return iconMap[type] || 'bi-info-circle';
        },

        /**
         * Get severity color
         */
        getSeverityColor: function (severity) {
            const colorMap = {
                'critical': 'danger',
                'warning': 'warning',
                'info': 'info',
                'success': 'success'
            };
            return colorMap[severity] || 'info';
        }
    };
}();

// Create global instance
const proactiveIntelligence = _proactiveIntelligence;
window.proactiveIntelligence = proactiveIntelligence;

