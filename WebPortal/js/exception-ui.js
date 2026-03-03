/**
 * Exception UI Components
 * Implements Process-Driven Design: Exception-First Design UI patterns
 */

var _exceptionUI = function () {
    return {
        /**
         * Render exception card
         */
        renderExceptionCard: function (exception) {
            const severityClass = exception.severity === 'critical' ? 'exception-critical' :
                                exception.severity === 'warning' ? 'exception-warning' : 'exception-info';
            
            const icon = exception.severity === 'critical' ? 'bi-exclamation-triangle-fill' :
                        exception.severity === 'warning' ? 'bi-exclamation-circle-fill' : 'bi-info-circle-fill';
            
            const actionsHtml = exception.suggested_actions && exception.suggested_actions.length > 0
                ? exception.suggested_actions.map(action => 
                    `<button class="btn btn-sm btn-primary me-2" onclick="exceptionUI.handleAction('${action.action}', '${action.url}', '${exception.id}')">
                        ${action.label}
                    </button>`
                ).join('')
                : `<button class="btn btn-sm btn-outline-secondary" onclick="exceptionUI.viewDetails('${exception.id}')">
                    View Details
                </button>`;
            
            return `
                <div class="exception-card ${severityClass}" data-exception-id="${exception.id}">
                    <div class="exception-header">
                        <span class="exception-icon">
                            <i class="bi ${icon}"></i>
                        </span>
                        <span class="exception-title">${exception.title || 'Exception'}</span>
                        <span class="exception-badge">${exception.anomaly_type || 'General'}</span>
                    </div>
                    <div class="exception-body">
                        <p class="exception-description">${exception.description || ''}</p>
                        ${exception.impact_description ? `<p class="exception-impact"><strong>Impact:</strong> ${exception.impact_description}</p>` : ''}
                        <div class="exception-metrics">
                            ${exception.current_value !== undefined ? `<span><strong>Current:</strong> ${exception.current_value} ${exception.unit || ''}</span>` : ''}
                            ${exception.threshold_value !== undefined ? `<span><strong>Threshold:</strong> ${exception.threshold_value} ${exception.unit || ''}</span>` : ''}
                            ${exception.current_value !== undefined && exception.threshold_value !== undefined 
                                ? `<span><strong>Gap:</strong> ${Math.abs(exception.current_value - exception.threshold_value)} ${exception.unit || ''}</span>` 
                                : ''}
                        </div>
                    </div>
                    <div class="exception-actions">
                        ${actionsHtml}
                        <button class="btn btn-sm btn-link" onclick="exceptionUI.dismissException('${exception.id}')">
                            Dismiss
                        </button>
                    </div>
                </div>
            `;
        },

        /**
         * Render exception panel (container for multiple exceptions)
         */
        renderExceptionPanel: function (exceptions, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            if (!exceptions || exceptions.length === 0) {
                container.innerHTML = '<div class="alert alert-info">No exceptions at this time. All systems operating normally.</div>';
                return;
            }
            
            // Group by severity
            const critical = exceptions.filter(e => e.severity === 'critical');
            const warning = exceptions.filter(e => e.severity === 'warning');
            const info = exceptions.filter(e => e.severity === 'info');
            
            let html = '';
            
            // Critical exceptions
            if (critical.length > 0) {
                html += `
                    <div class="exception-section">
                        <h5 class="exception-section-title text-danger">
                            <i class="bi bi-exclamation-triangle-fill me-2"></i>
                            REQUIRES IMMEDIATE ACTION (${critical.length})
                        </h5>
                        <div class="exception-list">
                            ${critical.map(e => this.renderExceptionCard(e)).join('')}
                        </div>
                    </div>
                `;
            }
            
            // Warning exceptions
            if (warning.length > 0) {
                html += `
                    <div class="exception-section">
                        <h5 class="exception-section-title text-warning">
                            <i class="bi bi-exclamation-circle-fill me-2"></i>
                            WARNINGS (${warning.length})
                        </h5>
                        <div class="exception-list">
                            ${warning.map(e => this.renderExceptionCard(e)).join('')}
                        </div>
                    </div>
                `;
            }
            
            // Info exceptions
            if (info.length > 0) {
                html += `
                    <div class="exception-section">
                        <h5 class="exception-section-title text-info">
                            <i class="bi bi-info-circle-fill me-2"></i>
                            INFORMATION (${info.length})
                        </h5>
                        <div class="exception-list">
                            ${info.map(e => this.renderExceptionCard(e)).join('')}
                        </div>
                    </div>
                `;
            }
            
            container.innerHTML = html;
        },

        /**
         * Handle exception action
         */
        handleAction: function (action, url, exceptionId) {
            // Navigate to URL or handle action
            if (url && url !== '#') {
                if (url.startsWith('#')) {
                    // Internal route
                    const route = url.substring(1);
                    if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                        _appRouter.loadContent(route);
                    }
                } else {
                    // External URL
                    window.open(url, '_blank');
                }
            }
            
            // Log action
            console.log(`Action ${action} triggered for exception ${exceptionId}`);
        },

        /**
         * View exception details
         */
        viewDetails: function (exceptionId) {
            // Show modal with exception details
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Exception Details',
                    html: `<div id="exceptionDetails"></div>`,
                    width: '800px',
                    showConfirmButton: true,
                    showCancelButton: false
                });
            }
        },

        /**
         * Dismiss exception
         */
        dismissException: async function (exceptionId) {
            try {
                const userInfo = Session.get('user') || {};
                await anomalyDetection.resolveAnomaly(exceptionId, 'Dismissed by user', userInfo.id);
                
                // Remove from UI
                const card = document.querySelector(`[data-exception-id="${exceptionId}"]`);
                if (card) {
                    card.remove();
                }
                
                if (typeof _common !== 'undefined' && _common.showToastMessage) {
                    _common.showToastMessage('Exception dismissed', 'success');
                }
            } catch (error) {
                console.error('Error dismissing exception:', error);
                if (typeof _common !== 'undefined' && _common.showToastMessage) {
                    _common.showToastMessage('Failed to dismiss exception', 'error');
                }
            }
        }
    };
}();

// Create global instance
const exceptionUI = _exceptionUI;
window.exceptionUI = exceptionUI;

