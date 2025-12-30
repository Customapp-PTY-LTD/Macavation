/**
 * Anomaly Detection Framework
 * Implements Process-Driven Design Principle: Exception-First Design
 */

var _anomalyDetection = function () {
    return {
        // Anomaly severity levels
        severity: {
            CRITICAL: 'critical',
            WARNING: 'warning',
            INFO: 'info'
        },

        // Anomaly types
        types: {
            RESOURCE: 'resource',
            SCHEDULE: 'schedule',
            COMPLIANCE: 'compliance',
            FINANCIAL: 'financial',
            QUALITY: 'quality',
            INVENTORY: 'inventory'
        },

        /**
         * Detect anomalies for a given entity type
         */
        detectAnomalies: async function (entityType, thresholds = null) {
            try {
                // Get current metrics
                const metrics = await this.getCurrentMetrics(entityType);
                
                // Get thresholds if not provided
                if (!thresholds) {
                    thresholds = await this.getThresholds(entityType);
                }
                
                // Compare and identify anomalies
                const anomalies = [];
                
                for (const metric of metrics) {
                    const threshold = thresholds[metric.name];
                    if (!threshold) continue;
                    
                    // Check critical thresholds
                    if (threshold.critical_low !== undefined && metric.value < threshold.critical_low) {
                        anomalies.push({
                            entity_type: entityType,
                            entity_id: metric.entity_id,
                            anomaly_type: this.getAnomalyType(metric.name),
                            severity: this.severity.CRITICAL,
                            title: `${metric.label} Below Critical Threshold`,
                            description: `${metric.label} is ${metric.value} ${metric.unit}, which is below the critical threshold of ${threshold.critical_low} ${metric.unit}`,
                            current_value: metric.value,
                            threshold_value: threshold.critical_low,
                            impact_description: this.getImpactDescription(metric.name, 'critical_low', metric.value, threshold.critical_low),
                            suggested_actions: this.getSuggestedActions(metric.name, 'critical_low'),
                            metric_name: metric.name,
                            metric_label: metric.label,
                            unit: metric.unit
                        });
                    } else if (threshold.critical_high !== undefined && metric.value > threshold.critical_high) {
                        anomalies.push({
                            entity_type: entityType,
                            entity_id: metric.entity_id,
                            anomaly_type: this.getAnomalyType(metric.name),
                            severity: this.severity.CRITICAL,
                            title: `${metric.label} Above Critical Threshold`,
                            description: `${metric.label} is ${metric.value} ${metric.unit}, which exceeds the critical threshold of ${threshold.critical_high} ${metric.unit}`,
                            current_value: metric.value,
                            threshold_value: threshold.critical_high,
                            impact_description: this.getImpactDescription(metric.name, 'critical_high', metric.value, threshold.critical_high),
                            suggested_actions: this.getSuggestedActions(metric.name, 'critical_high'),
                            metric_name: metric.name,
                            metric_label: metric.label,
                            unit: metric.unit
                        });
                    }
                    // Check warning thresholds
                    else if (threshold.warning_low !== undefined && metric.value < threshold.warning_low) {
                        anomalies.push({
                            entity_type: entityType,
                            entity_id: metric.entity_id,
                            anomaly_type: this.getAnomalyType(metric.name),
                            severity: this.severity.WARNING,
                            title: `${metric.label} Below Warning Threshold`,
                            description: `${metric.label} is ${metric.value} ${metric.unit}, which is below the warning threshold of ${threshold.warning_low} ${metric.unit}`,
                            current_value: metric.value,
                            threshold_value: threshold.warning_low,
                            impact_description: this.getImpactDescription(metric.name, 'warning_low', metric.value, threshold.warning_low),
                            suggested_actions: this.getSuggestedActions(metric.name, 'warning_low'),
                            metric_name: metric.name,
                            metric_label: metric.label,
                            unit: metric.unit
                        });
                    } else if (threshold.warning_high !== undefined && metric.value > threshold.warning_high) {
                        anomalies.push({
                            entity_type: entityType,
                            entity_id: metric.entity_id,
                            anomaly_type: this.getAnomalyType(metric.name),
                            severity: this.severity.WARNING,
                            title: `${metric.label} Above Warning Threshold`,
                            description: `${metric.label} is ${metric.value} ${metric.unit}, which exceeds the warning threshold of ${threshold.warning_high} ${metric.unit}`,
                            current_value: metric.value,
                            threshold_value: threshold.warning_high,
                            impact_description: this.getImpactDescription(metric.name, 'warning_high', metric.value, threshold.warning_high),
                            suggested_actions: this.getSuggestedActions(metric.name, 'warning_high'),
                            metric_name: metric.name,
                            metric_label: metric.label,
                            unit: metric.unit
                        });
                    }
                }
                
                // Store/update anomalies in database
                if (anomalies.length > 0) {
                    await this.upsertAnomalies(anomalies);
                }
                
                return anomalies;
            } catch (error) {
                console.error('Error detecting anomalies:', error);
                return [];
            }
        },

        /**
         * Get current metrics for an entity type
         */
        getCurrentMetrics: async function (entityType) {
            // This should be implemented per entity type
            // For now, return empty array - will be extended by specific implementations
            return [];
        },

        /**
         * Get thresholds for an entity type
         */
        getThresholds: async function (entityType) {
            // Default thresholds - should be configurable per entity
            const defaultThresholds = {
                stock_level: {
                    warning_low: 100,
                    critical_low: 50,
                    warning_high: 1000,
                    critical_high: 2000
                },
                quality_score: {
                    warning_low: 80,
                    critical_low: 70,
                    warning_high: 100,
                    critical_high: 100
                },
                days_overdue: {
                    warning_low: 0,
                    critical_low: 0,
                    warning_high: 3,
                    critical_high: 7
                }
            };
            
            return defaultThresholds;
        },

        /**
         * Get anomaly type from metric name
         */
        getAnomalyType: function (metricName) {
            if (metricName.includes('stock') || metricName.includes('inventory')) {
                return this.types.INVENTORY;
            } else if (metricName.includes('quality') || metricName.includes('test')) {
                return this.types.QUALITY;
            } else if (metricName.includes('overdue') || metricName.includes('schedule')) {
                return this.types.SCHEDULE;
            } else if (metricName.includes('compliance') || metricName.includes('certificate')) {
                return this.types.COMPLIANCE;
            } else if (metricName.includes('cost') || metricName.includes('revenue') || metricName.includes('budget')) {
                return this.types.FINANCIAL;
            } else {
                return this.types.RESOURCE;
            }
        },

        /**
         * Get impact description
         */
        getImpactDescription: function (metricName, thresholdType, currentValue, thresholdValue) {
            const gap = Math.abs(currentValue - thresholdValue);
            
            if (metricName.includes('stock')) {
                if (thresholdType.includes('low')) {
                    return `Stock level is ${gap} units below threshold. This may cause production delays or stockouts.`;
                } else {
                    return `Stock level is ${gap} units above threshold. This may indicate overstocking and tied-up capital.`;
                }
            } else if (metricName.includes('quality')) {
                return `Quality score is ${gap} points below threshold. This may result in customer complaints or product rejection.`;
            } else if (metricName.includes('overdue')) {
                return `Item is ${gap} days overdue. This may impact downstream processes and customer satisfaction.`;
            }
            
            return `Current value is ${gap} units away from threshold. This may impact operations.`;
        },

        /**
         * Get suggested actions
         */
        getSuggestedActions: function (metricName, thresholdType) {
            const actions = [];
            
            if (metricName.includes('stock') && thresholdType.includes('low')) {
                actions.push({
                    action: 'reorder',
                    label: 'Create Purchase Order',
                    url: '#purchase-orders'
                });
                actions.push({
                    action: 'investigate',
                    label: 'Investigate Stock Movement',
                    url: '#stock-movements'
                });
            } else if (metricName.includes('quality')) {
                actions.push({
                    action: 'review',
                    label: 'Review Quality Test Results',
                    url: '#quality-tests'
                });
                actions.push({
                    action: 'contact',
                    label: 'Contact Supplier',
                    url: '#crm'
                });
            } else if (metricName.includes('overdue')) {
                actions.push({
                    action: 'resolve',
                    label: 'Resolve Overdue Item',
                    url: '#workflow'
                });
                actions.push({
                    action: 'escalate',
                    label: 'Escalate to Manager',
                    url: '#escalate'
                });
            }
            
            // Default actions
            if (actions.length === 0) {
                actions.push({
                    action: 'view',
                    label: 'View Details',
                    url: '#details'
                });
            }
            
            return actions;
        },

        /**
         * Upsert anomalies to database
         */
        upsertAnomalies: async function (anomalies) {
            try {
                // Store in database via data functions
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    for (const anomaly of anomalies) {
                        await dataFunctions.callFunction('upsert_anomaly', {
                            p_entity_type: anomaly.entity_type,
                            p_entity_id: anomaly.entity_id,
                            p_anomaly_type: anomaly.anomaly_type,
                            p_severity: anomaly.severity,
                            p_title: anomaly.title,
                            p_description: anomaly.description,
                            p_current_value: anomaly.current_value,
                            p_threshold_value: anomaly.threshold_value,
                            p_impact_description: anomaly.impact_description,
                            p_suggested_actions: JSON.stringify(anomaly.suggested_actions),
                            p_metric_name: anomaly.metric_name,
                            p_metric_label: anomaly.metric_label,
                            p_unit: anomaly.unit
                        }, null, { useCache: false });
                    }
                }
            } catch (error) {
                console.error('Error upserting anomalies:', error);
            }
        },

        /**
         * Get active anomalies
         */
        getActiveAnomalies: async function (severity = null, entityType = null) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const params = {
                        p_severity: severity || null,
                        p_entity_type: entityType || null
                    };
                    return await dataFunctions.callFunction('get_active_anomalies', params, null, {
                        cacheKey: `anomalies_${severity || 'all'}_${entityType || 'all'}`,
                        useCache: true,
                        cacheTtl: 60000 // 1 minute
                    });
                }
                return [];
            } catch (error) {
                console.error('Error getting active anomalies:', error);
                return [];
            }
        },

        /**
         * Resolve an anomaly
         */
        resolveAnomaly: async function (anomalyId, resolutionNotes, resolvedBy) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    return await dataFunctions.callFunction('resolve_anomaly', {
                        p_anomaly_id: anomalyId,
                        p_resolution_notes: resolutionNotes,
                        p_resolved_by: resolvedBy
                    }, null, { useCache: false });
                }
            } catch (error) {
                console.error('Error resolving anomaly:', error);
                throw error;
            }
        }
    };
}();

// Create global instance
const anomalyDetection = _anomalyDetection;
window.anomalyDetection = anomalyDetection;

