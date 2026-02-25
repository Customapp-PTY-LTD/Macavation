/**
 * Supplier Intake Grid – Oil & Protein.
 * Implementation aligned with grower-intake: _supplierIntakeGrid object, modal loading, filters, export.
 * Modals: New batch (new-batch-modal), Receiving checklist (receiving-checklist-modal).
 */
var _supplierIntakeGrid = function () {
    'use strict';

    function productTypeLabel(value) {
        var map = { oil_kernel: 'Oil kernel', cracker_dust: 'Cracker dust', kernel_dust: 'Kernel dust', crush: 'Crush', cake: 'Cake' };
        return map[value] || value || '—';
    }

    function formatDate(d) {
        if (!d) return '—';
        if (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) return _common.formatDateDDMMYYYY(d);
        var s = typeof d === 'string' ? d : (d.toISOString ? d.toISOString() : String(d));
        return s.split('T')[0];
    }

    function escapeHtml(s) {
        if (s == null) return '';
        var str = String(s);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return {
        batches: [],
        filteredBatches: [],

        init: () => {
            const scope = _supplierIntakeGrid;
            scope.bindEvents();
            scope.loadBatches(true);
            const loadPromises = [];
            $('.modal[route-name]').each((index, el) => {
                const routeName = $(el).attr('route-name');
                const elementSelector = '#' + $(el).attr('id');
                if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName, elementSelector }));
                }
            });
            Promise.all(loadPromises).then(() => {
                if (typeof _modal_supplier_new_batch !== 'undefined' && _modal_supplier_new_batch.init) _modal_supplier_new_batch.init();
                if (typeof _modalSupplierOilBatch !== 'undefined' && _modalSupplierOilBatch.init) _modalSupplierOilBatch.init();
                if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.init) _modal_stock_receiving_checklist.init();
            }).catch((err) => {
                console.error('[Supplier Intake] Error loading modals:', err);
                if (typeof _modal_supplier_new_batch !== 'undefined' && _modal_supplier_new_batch.init) _modal_supplier_new_batch.init();
                if (typeof _modalSupplierOilBatch !== 'undefined' && _modalSupplierOilBatch.init) _modalSupplierOilBatch.init();
                if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.init) _modal_stock_receiving_checklist.init();
            });
        },

        bindEvents: () => {
            const scope = _supplierIntakeGrid;
            $('#addNewBatchProductBtn').off('click').on('click', function (e) {
                e.preventDefault();
                if (typeof _modal_supplier_new_batch !== 'undefined' && _modal_supplier_new_batch.show) {
                    _modal_supplier_new_batch.show();
                } else if (typeof _modalSupplierOilBatch !== 'undefined' && _modalSupplierOilBatch.show) {
                    _modalSupplierOilBatch.show();
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'New batch modal not loaded. Please refresh the page.', 'error');
                }
            });
            $('#exportSupplierIntakeBtn').off('click').on('click', () => scope.exportBatches());
            $('#refreshSupplierIntakeBtn').off('click').on('click', () => scope.loadBatches(true));

            $('#searchSupplierIntakeInput').on('input', () => scope.filterBatches());
            $('#filterSupplierIntakeStatus').on('change', () => scope.filterBatches());
            $('#clearSupplierIntakeFiltersBtn').on('click', () => {
                $('#searchSupplierIntakeInput').val('');
                $('#filterSupplierIntakeStatus').val('');
                scope.filterBatches();
            });

            $(document).on('click', '#supplierIntakeBatchesTableBody tr.js-supplier-intake-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchDetail(batchId);
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .supplier-intake-batch-number-link', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchDetail(batchId);
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .js-supplier-intake-checklist-btn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const batch = batchId ? scope.batches.find((b) => String(b.id) === batchId || String(b.batch_number) === batchId) : null;
                if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.show) {
                    _modal_stock_receiving_checklist.show(batch || undefined);
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Receiving checklist modal not loaded. Please refresh the page.', 'error');
                }
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .js-supplier-intake-view', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchDetail(batchId);
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .js-supplier-intake-edit', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var batchId = $(this).data('batch-id');
                if (!batchId) return;
                var batch = (scope.batches || []).find(function (b) {
                    return (b.id != null && String(b.id) === String(batchId)) || (b.batch_number != null && String(b.batch_number) === String(batchId));
                });
                if (batch && typeof _modal_supplier_new_batch !== 'undefined' && _modal_supplier_new_batch.show) {
                    _modal_supplier_new_batch.show(batch);
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire('Info', batch ? 'Edit modal not loaded. Please refresh the page.' : 'Batch not found.', 'info');
                }
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .js-supplier-intake-release-oil', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var batchId = $(this).closest('tr.js-supplier-intake-row').data('batch-id');
                if (!batchId) {
                    if (typeof Swal !== 'undefined') Swal.fire('Info', 'Could not determine batch. Please try again.', 'info');
                    return;
                }
                var batch = (scope.batches || []).find(function (b) {
                    return (b.id != null && String(b.id) === String(batchId)) || (b.batch_number != null && String(b.batch_number) === String(batchId));
                });
                scope.releaseBatchToOilProduction(batchId, batch);
            });
            /* Move Actions dropdown menu to body so it is not clipped by table overflow */
            $(document).on('show.bs.dropdown', '#supplierIntakeBatchesTable .dropdown', function () {
                var $dropdown = $(this);
                var $menu = $dropdown.find('.dropdown-menu');
                if ($menu.length) {
                    $dropdown.data('si-menu', $menu);
                    $menu.addClass('supplier-intake-actions-menu').appendTo(document.body);
                }
            });
            $(document).on('hidden.bs.dropdown', '#supplierIntakeBatchesTable .dropdown', function () {
                var $dropdown = $(this);
                var $menu = $dropdown.data('si-menu');
                if ($menu && $menu.length) {
                    $menu.removeClass('supplier-intake-actions-menu').appendTo($dropdown);
                    $dropdown.removeData('si-menu');
                }
            });
        },

        filterBatches: () => {
            const scope = _supplierIntakeGrid;
            const searchTerm = ($('#searchSupplierIntakeInput').val() || '').toLowerCase();
            const statusFilter = $('#filterSupplierIntakeStatus').val();
            scope.filteredBatches = scope.batches.filter((b) => {
                const matchesSearch = !searchTerm ||
                    (b.batch_number && b.batch_number.toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    ((b.supplier_details || '').toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    ((b.delivery_note_ref || '').toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    ((b.product_type || '').toString().toLowerCase().indexOf(searchTerm) >= 0);
                const matchesStatus = !statusFilter || (b.status || 'intake') === statusFilter;
                return matchesSearch && matchesStatus;
            });
            scope.renderBatches();
        },

        loadBatches: async (forceRefresh) => {
            const scope = _supplierIntakeGrid;
            const tbody = $('#supplierIntakeBatchesTableBody');
            if (!tbody.length) return;
            tbody.html('<tr><td colspan="10" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>Loading…</td></tr>');
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getSupplierIntakeBatches) {
                    tbody.html('<tr><td colspan="10" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>Data functions not available.</td></tr>');
                    return;
                }
                const all = await dataFunctions.getSupplierIntakeBatches('supplier_intake', null, forceRefresh);
                scope.batches = Array.isArray(all) ? all : [];
                scope.filterBatches();
            } catch (e) {
                console.error('[Supplier Intake] loadBatches failed:', e);
                scope.batches = [];
                tbody.html('<tr><td colspan="10" class="text-center text-danger py-4">Failed to load batches.</td></tr>');
            }
        },

        renderBatches: () => {
            const scope = _supplierIntakeGrid;
            const tbody = $('#supplierIntakeBatchesTableBody');
            if (!tbody.length) return;
            tbody.empty();
            if (scope.filteredBatches.length === 0) {
                if (scope.batches.length === 0) {
                    tbody.html('<tr><td colspan="10" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No batches in supplier intake. Click Add new batch of product to add one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="10" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search.</td></tr>');
                }
                return;
            }
            scope.filteredBatches.forEach((b) => {
                const batchId = (b.id != null ? b.id : b.batch_number || '').toString();
                const supplier = (b.supplier_details != null ? b.supplier_details : (b.supplier_id ? '—' : '—'));
                const mfgBb = [formatDate(b.manufactured_date), formatDate(b.best_before_date)].filter(Boolean).join(' / ') || '—';
                const batchNumEscaped = (b.batch_number || '—').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const batchNumberCell = '<a href="#" class="supplier-intake-batch-number-link" role="button" data-batch-id="' + batchId + '">' + batchNumEscaped + '</a>';
                const checklistBtn = '<button type="button" class="btn btn-sm btn-primary supplier-intake-step-btn js-supplier-intake-checklist-btn" data-batch-id="' + escapeHtml(batchId) + '" title="Receiving checklist"><i class="fas fa-clipboard-check me-1"></i><span class="supplier-intake-btn-text">Receiving checklist</span></button>';
                const receivingCell = '<div class="supplier-intake-receiving-buttons">' + checklistBtn + '</div>';
                const releaseItem = '<a class="dropdown-item js-supplier-intake-release-oil" href="#"><i class="fas fa-arrow-right me-2"></i>Release to Oil Production</a>';
                const viewItem = '<a class="dropdown-item js-supplier-intake-view" href="#" data-batch-id="' + batchId + '"><i class="fas fa-eye me-2"></i>View</a>';
                const editItem = '<a class="dropdown-item js-supplier-intake-edit" href="#" data-batch-id="' + batchId + '"><i class="fas fa-edit me-2"></i>Edit</a>';
                const actionsCell = '<div class="dropdown">' +
                    '<button class="btn btn-sm btn-outline-secondary" type="button" id="supplierIntakeActions' + escapeHtml(batchId) + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                    '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="supplierIntakeActions' + escapeHtml(batchId) + '">' + releaseItem + viewItem + editItem + '</ul></div>';
                const row = '<tr class="js-supplier-intake-row" data-batch-id="' + batchId + '">' +
                    '<td class="supplier-intake-col-batch">' + batchNumberCell + '</td>' +
                    '<td class="supplier-intake-col-product d-none d-md-table-cell">' + (productTypeLabel(b.product_type) || '—') + '</td>' +
                    '<td class="supplier-intake-col-date">' + (formatDate(b.date_received) || '—') + '</td>' +
                    '<td class="supplier-intake-col-note d-none d-lg-table-cell">' + (b.delivery_note_ref || '—') + '</td>' +
                    '<td class="supplier-intake-col-supplier">' + (supplier || '—') + '</td>' +
                    '<td class="supplier-intake-col-qty d-none d-sm-table-cell">' + (b.quantity_kg != null ? b.quantity_kg : '—') + '</td>' +
                    '<td class="supplier-intake-col-mfg d-none d-lg-table-cell">' + mfgBb + '</td>' +
                    '<td class="supplier-intake-col-receiving">' + receivingCell + '</td>' +
                    '<td class="supplier-intake-col-status"><span class="badge bg-info">' + (b.status === 'intake' ? 'Supplier intake' : (b.status || 'intake')) + '</span></td>' +
                    '<td class="supplier-intake-col-actions">' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
            scope.initActionsDropdowns();
        },

        initActionsDropdowns: () => {
            if (typeof bootstrap === 'undefined' || !bootstrap.Dropdown) return;
            $('#supplierIntakeBatchesTable [data-bs-toggle="dropdown"]').each(function () {
                var trigger = this;
                var existing = bootstrap.Dropdown.getInstance(trigger);
                if (existing) existing.dispose();
                new bootstrap.Dropdown(trigger, {
                    popperConfig: function (cfg) {
                        var c = Object.assign({}, cfg || {}, { strategy: 'fixed', placement: 'bottom-end' });
                        var mods = Array.isArray(c.modifiers) ? c.modifiers.slice() : [];
                        for (var i = 0; i < mods.length; i++) {
                            if (mods[i] && mods[i].name === 'flip') {
                                mods[i] = Object.assign({}, mods[i], { enabled: false });
                                break;
                            }
                        }
                        if (mods.every(function (m) { return m.name !== 'flip'; })) mods.push({ name: 'flip', enabled: false });
                        c.modifiers = mods;
                        return c;
                    }
                });
            });
        },

        showBatchDetail: (batchId) => {
            const scope = _supplierIntakeGrid;
            const b = (scope.batches || []).find((x) => (x.id != null ? x.id : x.batch_number) === batchId || String(x.id) === batchId || String(x.batch_number) === batchId);
            if (!b) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Batch not found.', 'info');
                return;
            }
            var line = function (label, value) {
                var v = value != null && value !== '' ? String(value) : '—';
                return '<p><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(v) + '</p>';
            };
            var html = '<div class="text-start small">' +
                '<p><strong>Batch #:</strong> ' + escapeHtml(b.batch_number || '—') + '</p>' +
                line('Product type', productTypeLabel(b.product_type) || b.product_type) +
                line('Date received', formatDate(b.date_received)) +
                line('Delivery note / PO', b.delivery_note_ref) +
                line('Supplier', b.supplier_details) +
                line('Quantity (kg)', b.quantity_kg != null ? b.quantity_kg : '') +
                line('Carton / bulk bags', b.carton_bulk_bags) +
                line('Manufactured date', formatDate(b.manufactured_date)) +
                line('Best before date', formatDate(b.best_before_date)) +
                line('Reference / PO', b.reference) +
                line('Description', b.description) +
                line('Status', b.status === 'intake' ? 'Supplier intake' : (b.status || 'intake'));
            if (b.vehicle_clean != null || b.vehicle_enclosed != null || b.hazard_substances != null || b.pest_infestations != null || b.pallets_condition != null || b.raw_materials_condition != null) {
                html += '<hr class="my-2"><p class="mb-1"><strong>Receiving checks</strong></p>' +
                    line('Vehicle clean', b.vehicle_clean) +
                    line('Vehicle enclosed', b.vehicle_enclosed) +
                    line('Hazard substances', b.hazard_substances) +
                    line('Pest infestations', b.pest_infestations) +
                    line('Pallets condition', b.pallets_condition) +
                    line('Raw materials condition', b.raw_materials_condition);
            }
            if (b.receiving_comments != null && String(b.receiving_comments).trim() !== '') {
                html += line('Receiving comments', b.receiving_comments);
            }
            html += '</div>';
            if (typeof Swal !== 'undefined') Swal.fire({ title: 'Batch details', html, confirmButtonText: 'OK', width: '420px' });
        },

        releaseBatchToOilProduction: async (batchId, batch) => {
            const scope = _supplierIntakeGrid;
            if (!batchId || typeof dataFunctions === 'undefined' || !dataFunctions.releaseSupplierIntakeBatchToOilProduction) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Unable to release batch. Please try again.', 'error');
                return;
            }
            var idToSend = (batch && batch.id != null) ? String(batch.id) : batchId;
            try {
                const result = await dataFunctions.releaseSupplierIntakeBatchToOilProduction(idToSend, batch);
                var resolved = result && (result.data !== undefined ? result.data : result);
                var success = resolved && resolved.success !== false;
                if (success) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released', text: 'Batch has been moved to Oil Production.', timer: 2500, showConfirmButton: false });
                    scope.loadBatches(true);
                    if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) _appRouter.routeTo('oil-production-grid');
                    else window.location.hash = '#oil-production-grid';
                } else {
                    throw new Error(resolved && (resolved.error || resolved.message) ? (resolved.error || resolved.message) : 'Release failed');
                }
            } catch (e) {
                console.error('[Supplier Intake] releaseBatchToOilProduction failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release batch to Oil Production.', 'error');
            }
        },

        exportBatches: () => {
            const scope = _supplierIntakeGrid;
            const list = scope.filteredBatches.length > 0 ? scope.filteredBatches : scope.batches;
            if (!list || list.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            const columns = [
                { key: 'batch_number', label: 'Batch #' },
                { key: 'product_type', label: 'Product type' },
                { key: 'date_received', label: 'Date received' },
                { key: 'delivery_note_ref', label: 'Delivery note / PO' },
                { key: 'supplier_details', label: 'Supplier' },
                { key: 'quantity_kg', label: 'Quantity (kg)' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(list, 'supplier_intake_batches', columns);
            } else if (typeof Swal !== 'undefined') {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

window.initializeSupplierIntakeGrid = function () {
    if (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.init) {
        _supplierIntakeGrid.init();
    }
};
