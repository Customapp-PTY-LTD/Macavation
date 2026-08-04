/**
 * Canonical kernel/oil batch display status for Batch Journey, kanban cards, and handoffs.
 */
var BatchStatus = (function () {
    'use strict';

    var STATUS_ORDER = [
        'gi-receiving',
        'gi-intake-received',
        'gi-quality-pending',
        'gi-quality-approved',
        'awaiting-production',
        'in-production',
        'awaiting-test',
        'release-ready',
        'stock',
        'complete'
    ];

    var PRODUCTION_KANBAN_MAP = {
        'awaiting-production': 'awaiting_production',
        'in-production': 'in_production',
        'awaiting-test': 'awaiting_test',
        'release-ready': 'release_ready'
    };

    var MODULE_SUBTITLES = {
        'grower-intake-grid': 'Batches here: Receiving, Intake received, Quality pending, Quality approved',
        'kernel-production-grid': 'Batches here: Awaiting production, In production, Awaiting test, Release ready',
        'stock-management-kernel': 'Finished kernel stock by style — batches with remaining stock on hand',
        'kernel-dispatch-grid': 'Dispatch baskets for kernel customers',
        'supplier-intake-grid': 'Oil ingredient batches: Awaiting tests, Ready for Oil Production',
        'oil-production-grid': 'Released raw ingredients, bin runs, and production sheets',
        'stock-management-oil': 'Oil and protein stock lots on hand',
        'oil-dispatch-grid': 'Dispatch baskets for oil and protein customers',
        'batch-journey': 'Search any kernel batch — see status and open the module where it lives'
    };

    function sumRemainingKg(batch) {
        var r = batch && batch.remaining_by_style;
        if (!r || typeof r !== 'object') return 0;
        var t = 0;
        for (var k in r) {
            if (Object.prototype.hasOwnProperty.call(r, k)) {
                t += parseFloat(r[k]) || 0;
            }
        }
        return t;
    }

    function getGrowerIntakeColumnKey(batch) {
        if (!batch) return 'receiving';
        var st = (batch.status || '').toLowerCase();
        if (['receiving', 'intake_received', 'quality_pending', 'quality_approved'].indexOf(st) >= 0) {
            return st;
        }
        var checklistDone = !!batch.has_receiving_checklist;
        var sampleDone = !!batch.has_ziplock_sample && !!batch.has_5kg_sample;
        if (!checklistDone) return 'receiving';
        if (!sampleDone) return 'intake_received';
        return 'quality_approved';
    }

    function isGrowerIntakeStatus(batch) {
        if (!batch) return false;
        var st = (batch.status || '').toLowerCase();
        if (st === 'intake') return true;
        return ['receiving', 'intake_received', 'quality_pending', 'quality_approved'].indexOf(st) >= 0;
    }

    function hasProductionActivity(batch, opts) {
        if (opts && opts.hasProductionData != null) return !!opts.hasProductionData;
        return (parseInt(batch.production_day_count, 10) || 0) > 0 || !!batch.has_job_card;
    }

    /**
     * @param {object} batch
     * @param {{ hasProductionData?: boolean }} [opts]
     * @returns {{ value: string, label: string, bucket: string }}
     */
    function getDisplayStatus(batch, opts) {
        opts = opts || {};
        if (!batch || typeof batch !== 'object') {
            return { value: 'gi-receiving', label: 'Receiving', bucket: 'grower' };
        }

        var st = (batch.status || '').toLowerCase();
        var remainingKg = sumRemainingKg(batch);

        if (st === 'complete' || st === 'in_finished_stock') {
            if (remainingKg <= 0.000001) {
                return { value: 'complete', label: 'Complete', bucket: 'complete' };
            }
            return { value: 'stock', label: 'Stock', bucket: 'stock' };
        }

        if (st === 'dispatch') {
            if (remainingKg <= 0.000001) {
                return { value: 'complete', label: 'Complete', bucket: 'complete' };
            }
            return { value: 'stock', label: 'Stock', bucket: 'stock' };
        }

        if (isGrowerIntakeStatus(batch)) {
            var col = getGrowerIntakeColumnKey(batch);
            if (col === 'intake_received') {
                return { value: 'gi-intake-received', label: 'Intake received', bucket: 'grower' };
            }
            if (col === 'quality_pending') {
                return { value: 'gi-quality-pending', label: 'Quality pending', bucket: 'grower' };
            }
            if (col === 'quality_approved') {
                return { value: 'gi-quality-approved', label: 'Quality approved', bucket: 'grower' };
            }
            return { value: 'gi-receiving', label: 'Receiving', bucket: 'grower' };
        }

        var inProductionPipeline = ['production', 'qa', 'awaiting_production', 'in_production', 'awaiting_test', 'release_ready', 'pending_release'].indexOf(st) >= 0;
        if (inProductionPipeline) {
            if (batch.production_finished_at && !batch.has_qa) {
                return { value: 'awaiting-test', label: 'Awaiting test', bucket: 'awaiting-test' };
            }
            if (batch.production_finished_at && batch.has_qa) {
                return { value: 'release-ready', label: 'Release ready', bucket: 'production' };
            }
            if (hasProductionActivity(batch, opts)) {
                return { value: 'in-production', label: 'In production', bucket: 'production' };
            }
            return { value: 'awaiting-production', label: 'Awaiting production', bucket: 'production' };
        }

        return { value: 'gi-receiving', label: 'Receiving', bucket: 'grower' };
    }

    function getProductionKanbanStatus(batch, opts) {
        var d = getDisplayStatus(batch, opts);
        var filterValue = PRODUCTION_KANBAN_MAP[d.value];
        if (filterValue) {
            return { label: d.label, filterValue: filterValue, value: d.value, bucket: d.bucket };
        }
        return { label: d.label, filterValue: 'awaiting_production', value: d.value, bucket: d.bucket };
    }

    function statusBadgeHtml(displayStatus) {
        var d = displayStatus;
        if (typeof d === 'object' && d.label) {
            return '<span class="bj-status bj-status-' + String(d.value).replace(/"/g, '') + '">' + escapeHtml(d.label) + '</span>';
        }
        return '';
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return _common.escapeHtml(s);
    }

    function statusFilterMatches(batch, filter) {
        if (!filter) return true;
        var d = getDisplayStatus(batch);
        if (filter === 'grower-intake') return d.bucket === 'grower';
        if (filter === 'production-module') return d.bucket === 'production' || d.bucket === 'awaiting-test';
        return d.value === filter;
    }

    /** Where to open a kernel batch based on journey status. */
    function getKernelRouteForStatus(displayStatus) {
        var d = displayStatus && displayStatus.value ? displayStatus : getDisplayStatus(displayStatus);
        var map = {
            'gi-receiving': { route: 'grower-intake-grid', label: 'Open Grower Intake', searchInputId: 'searchIntakeBatchesInput' },
            'gi-intake-received': { route: 'grower-intake-grid', label: 'Open Grower Intake', searchInputId: 'searchIntakeBatchesInput' },
            'gi-quality-pending': { route: 'grower-intake-grid', label: 'Open Grower Intake', searchInputId: 'searchIntakeBatchesInput' },
            'gi-quality-approved': { route: 'grower-intake-grid', label: 'Open Grower Intake', searchInputId: 'searchIntakeBatchesInput' },
            'awaiting-production': { route: 'kernel-production-grid', label: 'Open Kernel Production', searchInputId: 'searchBatchesInput' },
            'in-production': { route: 'kernel-production-grid', label: 'Open Kernel Production', searchInputId: 'searchBatchesInput' },
            'awaiting-test': { route: 'kernel-production-grid', label: 'Open Kernel Production', searchInputId: 'searchBatchesInput' },
            'release-ready': { route: 'kernel-production-grid', label: 'Open Kernel Production', searchInputId: 'searchBatchesInput' },
            'stock': { route: 'stock-management-kernel', label: 'Open Stock (Kernel)', searchInputId: null },
            'complete': { route: 'batch-journey', label: 'Find in Batch Journey', searchInputId: 'bjSearchInput' }
        };
        return map[d.value] || { route: 'batch-journey', label: 'Find in Batch Journey', searchInputId: 'bjSearchInput' };
    }

    /** Oil supplier batch display status (simplified pipeline). */
    function getOilDisplayStatus(batch) {
        if (!batch) return { value: 'oil-received', label: 'Received', bucket: 'intake' };
        var st = (batch.status || '').toLowerCase();
        if (st === 'production' || st === 'raw_empty' || st === 'in_production') {
            return { value: 'oil-in-production', label: 'In oil production', bucket: 'production' };
        }
        if (st === 'release_ready') {
            return { value: 'oil-ready', label: 'Ready for Oil Production', bucket: 'intake' };
        }
        if (st === 'sent_to_stock' || st === 'complete') {
            return { value: 'oil-in-stock', label: 'In stock', bucket: 'stock' };
        }
        if (st === 'dispatched') {
            return { value: 'oil-dispatched', label: 'Dispatched', bucket: 'complete' };
        }
        return { value: 'oil-awaiting-test', label: 'Awaiting tests', bucket: 'intake' };
    }

    function getOilRouteForStatus(displayStatus) {
        var d = displayStatus && displayStatus.value ? displayStatus : getOilDisplayStatus(displayStatus);
        var map = {
            'oil-awaiting-test': { route: 'supplier-intake-grid', label: 'Open Supplier Intake', searchInputId: 'searchSupplierIntakeInput' },
            'oil-ready': { route: 'supplier-intake-grid', label: 'Open Supplier Intake', searchInputId: 'searchSupplierIntakeInput' },
            'oil-received': { route: 'supplier-intake-grid', label: 'Open Supplier Intake', searchInputId: 'searchSupplierIntakeInput' },
            'oil-in-production': { route: 'oil-production-grid', label: 'Open Oil Production', searchInputId: 'searchOilProductionInput' },
            'oil-in-stock': { route: 'stock-management-oil', label: 'Open Stock (Oil & Protein)', searchInputId: 'oilSearchInput' },
            'oil-dispatched': { route: 'oil-dispatch-grid', label: 'Open Oil Dispatch', searchInputId: 'searchOilDispatchInput' }
        };
        return map[d.value] || { route: 'batch-journey', label: 'Find a batch', searchInputId: 'bjOilSearchInput' };
    }

    function applyModuleSubtitle(routeName) {
        var text = MODULE_SUBTITLES[routeName];
        if (!text) return;
        var el = document.getElementById('macavationModuleJourneySubtitle');
        if (el) el.textContent = text;
    }

    return {
        STATUS_ORDER: STATUS_ORDER,
        MODULE_SUBTITLES: MODULE_SUBTITLES,
        sumRemainingKg: sumRemainingKg,
        getDisplayStatus: getDisplayStatus,
        getProductionKanbanStatus: getProductionKanbanStatus,
        statusBadgeHtml: statusBadgeHtml,
        statusFilterMatches: statusFilterMatches,
        getKernelRouteForStatus: getKernelRouteForStatus,
        getOilDisplayStatus: getOilDisplayStatus,
        getOilRouteForStatus: getOilRouteForStatus,
        applyModuleSubtitle: applyModuleSubtitle,
        escapeHtml: escapeHtml
    };
})();
