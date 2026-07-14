/**
 * Connected Workflows
 * Implements Process-Driven Design: Connected Workflows
 * Shows downstream impacts and linked records
 */

var _connectedWorkflows = function () {
    return {
        /**
         * Get downstream impacts for an action
         */
        getDownstreamImpacts: async function (entityType, entityId, action) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const impacts = await dataFunctions.callFunction('get_downstream_impacts', {
                        p_entity_type: entityType,
                        p_entity_id: entityId,
                        p_action: action
                    }, null, {
                        cacheKey: `impacts_${entityType}_${entityId}_${action}`,
                        useCache: true,
                        cacheTtl: 300000 // 5 minutes
                    });
                    return impacts || [];
                }
                return [];
            } catch (error) {
                console.error('Error getting downstream impacts:', error);
                return [];
            }
        },

        /**
         * Get linked records for an entity
         */
        getLinkedRecords: async function (entityType, entityId) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const linked = await dataFunctions.callFunction('get_linked_records', {
                        p_entity_type: entityType,
                        p_entity_id: entityId
                    }, null, {
                        cacheKey: `linked_${entityType}_${entityId}`,
                        useCache: true,
                        cacheTtl: 300000 // 5 minutes
                    });
                    return linked || [];
                }
                return [];
            } catch (error) {
                console.error('Error getting linked records:', error);
                return [];
            }
        },

        /**
         * Check for conflicts before action
         */
        checkConflicts: async function (entityType, entityId, action, data) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const conflicts = await dataFunctions.callFunction('check_action_conflicts', {
                        p_entity_type: entityType,
                        p_entity_id: entityId,
                        p_action: action,
                        p_data: JSON.stringify(data)
                    }, null, { useCache: false });
                    return conflicts || [];
                }
                return [];
            } catch (error) {
                console.error('Error checking conflicts:', error);
                return [];
            }
        },

        /**
         * Render impact panel
         */
        renderImpactPanel: function (impacts, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            if (!impacts || impacts.length === 0) {
                container.innerHTML = '<div class="alert alert-info">No downstream impacts detected.</div>';
                return;
            }

            const html = `
                <div class="impact-panel">
                    <h6 class="mb-3">
                        <i class="fas fa-diagram-project me-2"></i>
                        Downstream Impacts
                    </h6>
                    <div class="impact-list">
                        ${impacts.map(impact => `
                            <div class="impact-item impact-${impact.severity || 'info'}" data-impact-id="${impact.id}">
                                <div class="impact-header">
                                    <span class="impact-icon">
                                        <i class="bi ${this.getImpactIcon(impact.type)}"></i>
                                    </span>
                                    <span class="impact-title">${impact.title || impact.entity_type}</span>
                                    <span class="impact-badge badge bg-${this.getSeverityColor(impact.severity)}">
                                        ${impact.severity || 'info'}
                                    </span>
                                </div>
                                <div class="impact-body">
                                    <p class="impact-description">${impact.description || ''}</p>
                                    ${impact.action_required ? `
                                        <div class="impact-action-required">
                                            <strong>Action Required:</strong> ${impact.action_required}
                                        </div>
                                    ` : ''}
                                </div>
                                ${impact.entity_id ? `
                                    <div class="impact-actions">
                                        <button class="btn btn-sm btn-outline-primary" 
                                                onclick="connectedWorkflows.viewImpact('${impact.entity_type}', '${impact.entity_id}')">
                                            View ${impact.entity_type}
                                        </button>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        /**
         * Render linked records panel
         */
        renderLinkedRecordsPanel: function (linkedRecords, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            if (!linkedRecords || linkedRecords.length === 0) {
                container.innerHTML = '<div class="alert alert-info">No linked records found.</div>';
                return;
            }

            const html = `
                <div class="linked-records-panel">
                    <h6 class="mb-3">
                        <i class="fas fa-link me-2"></i>
                        Linked Records
                    </h6>
                    <div class="linked-records-list">
                        ${linkedRecords.map(record => `
                            <div class="linked-record-item" data-record-id="${record.id}">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div>
                                        <strong>${record.title || record.entity_type}</strong>
                                        <div class="text-muted small">${record.description || ''}</div>
                                        <div class="text-muted small">
                                            <span class="badge bg-secondary">${record.entity_type}</span>
                                            ${record.status ? `<span class="badge bg-${this.getStatusColor(record.status)} ms-1">${record.status}</span>` : ''}
                                        </div>
                                    </div>
                                    <button class="btn btn-sm btn-outline-primary" 
                                            onclick="connectedWorkflows.viewLinkedRecord('${record.entity_type}', '${record.id}')">
                                        View
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        /**
         * Render conflict warnings
         */
        renderConflictWarnings: function (conflicts, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            if (!conflicts || conflicts.length === 0) {
                return;
            }

            const html = `
                <div class="conflict-warnings">
                    <div class="alert alert-warning">
                        <h6 class="alert-heading">
                            <i class="fas fa-triangle-exclamation me-2"></i>
                            Conflicts Detected
                        </h6>
                        <ul class="mb-0">
                            ${conflicts.map(conflict => `
                                <li>
                                    <strong>${conflict.title || 'Conflict'}:</strong> 
                                    ${conflict.description || conflict.message}
                                    ${conflict.resolution ? `
                                        <div class="mt-1">
                                            <small><strong>Resolution:</strong> ${conflict.resolution}</small>
                                        </div>
                                    ` : ''}
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        /**
         * Get impact icon
         */
        getImpactIcon: function (type) {
            const iconMap = {
                'create': 'bi-plus-circle',
                'update': 'bi-pencil',
                'delete': 'bi-trash',
                'approve': 'bi-check2-square',
                'reject': 'bi-x-circle',
                'complete': 'bi-check-circle',
                'block': 'bi-shield-exclamation'
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
        },

        /**
         * Get status color
         */
        getStatusColor: function (status) {
            const colorMap = {
                'active': 'success',
                'inactive': 'secondary',
                'pending': 'warning',
                'completed': 'success',
                'cancelled': 'danger'
            };
            return colorMap[status?.toLowerCase()] || 'secondary';
        },

        /**
         * View impact entity
         */
        viewImpact: function (entityType, entityId) {
            // Navigate to entity view
            const routeMap = {
                'contact': 'crm-grid',
                'batch': 'kernel-production-grid',
                'sample': 'grower-intake-grid',
                'quality_test': 'quality-assurance-grid',
                'stock_item': 'stock-management-grid'
            };
            
            const route = routeMap[entityType] || 'dashboard';
            if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                _appRouter.loadContent(route, { id: entityId });
            }
        },

        /**
         * View linked record
         */
        viewLinkedRecord: function (entityType, entityId) {
            this.viewImpact(entityType, entityId);
        },

        /**
         * Show impact panel in form
         */
        showImpactPanelInForm: async function (formId, entityType, entityId, action) {
            const form = document.getElementById(formId);
            if (!form) return;

            // Get impacts
            const impacts = await this.getDownstreamImpacts(entityType, entityId, action);
            
            // Create or update impact panel
            let panel = document.getElementById('impact-panel-container');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'impact-panel-container';
                panel.className = 'card mt-3';
                form.appendChild(panel);
            }

            this.renderImpactPanel(impacts, 'impact-panel-container');
        },

        /**
         * Show linked records in form
         */
        showLinkedRecordsInForm: async function (formId, entityType, entityId) {
            const form = document.getElementById(formId);
            if (!form) return;

            // Get linked records
            const linked = await this.getLinkedRecords(entityType, entityId);
            
            // Create or update linked records panel
            let panel = document.getElementById('linked-records-container');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'linked-records-container';
                panel.className = 'card mt-3';
                form.appendChild(panel);
            }

            this.renderLinkedRecordsPanel(linked, 'linked-records-container');
        },

        /**
         * Validate action with conflicts
         */
        validateAction: async function (entityType, entityId, action, data) {
            const conflicts = await this.checkConflicts(entityType, entityId, action, data);
            
            if (conflicts && conflicts.length > 0) {
                // Show conflicts
                const container = document.getElementById('conflict-warnings-container');
                if (container) {
                    this.renderConflictWarnings(conflicts, 'conflict-warnings-container');
                }
                
                // Return validation result
                return {
                    valid: false,
                    conflicts: conflicts
                };
            }

            return {
                valid: true,
                conflicts: []
            };
        }
    };
}();

// Create global instance
const connectedWorkflows = _connectedWorkflows;
window.connectedWorkflows = connectedWorkflows;

