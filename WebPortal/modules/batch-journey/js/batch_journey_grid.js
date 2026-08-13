var _batchJourneyGrid = (function () {
    'use strict';

    var scope = {
        batches: [],
        filteredBatches: [],
        oilBatches: [],
        filteredOilBatches: [],
        activeStream: 'kernel'
    };

    function getDisplayStatus(batch) {
        return typeof BatchStatus !== 'undefined'
            ? BatchStatus.getDisplayStatus(batch)
            : { value: 'gi-receiving', label: 'Receiving', bucket: 'grower' };
    }

    function getOilDisplayStatus(batch) {
        return typeof BatchStatus !== 'undefined'
            ? BatchStatus.getOilDisplayStatus(batch)
            : { value: 'oil-awaiting-test', label: 'Awaiting tests', bucket: 'intake' };
    }

    function statusFilterMatches(batch, filter) {
        if (typeof BatchStatus !== 'undefined') {
            return BatchStatus.statusFilterMatches(batch, filter);
        }
        return true;
    }

    function getMoistureValue(batch) {
        try {
            var intake = batch.intake_data;
            if (!intake) return null;
            if (typeof intake === 'string') intake = JSON.parse(intake);
            if (intake.ziplock_sample && intake.ziplock_sample.moisture_result != null) {
                return parseFloat(intake.ziplock_sample.moisture_result);
            }
            if (intake.five_kg_sample && intake.five_kg_sample.moisture_result != null) {
                return parseFloat(intake.five_kg_sample.moisture_result);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function getTotalYield(batch) {
        var yield_data = batch.yield_by_style;
        if (!yield_data) return 0;
        if (typeof yield_data === 'string') {
            try { yield_data = JSON.parse(yield_data); } catch (e) { return 0; }
        }
        var total = 0;
        for (var key in yield_data) {
            total += parseFloat(yield_data[key]) || 0;
        }
        return total;
    }

    function formatNumber(val, decimals) {
        if (val == null || val === '' || isNaN(val)) return '-';
        return parseFloat(val).toLocaleString('en-ZA', {
            minimumFractionDigits: decimals || 0,
            maximumFractionDigits: decimals || 0
        });
    }

    function escapeHtml(s) {
        if (typeof BatchStatus !== 'undefined') return BatchStatus.escapeHtml(s);
        if (s == null) return '';
        return _common.escapeHtml(s);
    }

    function normalizeOilBatchList(raw) {
        if (Array.isArray(raw)) return raw;
        if (raw && raw.get_oil_batches && Array.isArray(raw.get_oil_batches)) return raw.get_oil_batches;
        if (raw && raw.data && Array.isArray(raw.data)) return raw.data;
        return [];
    }

    /** Map get_oil_batches row to grid fields (batch_id → batch_number, intake_data → supplier/qty/date). */
    function mapOilRowForJourney(o) {
        if (!o || typeof o !== 'object') return o;
        var intakeRaw = o.intake_data;
        var intake = {};
        if (intakeRaw != null) {
            if (typeof intakeRaw === 'string') {
                try { intake = JSON.parse(intakeRaw); } catch (e) { intake = {}; }
            } else if (typeof intakeRaw === 'object') {
                intake = intakeRaw;
            }
        }
        var supplier = intake.supplier || intake.supplier_details || '';
        var qty = intake.quantity_kg;
        if (qty == null && intake.items && intake.items[0]) qty = intake.items[0].quantity_kg;
        if (qty == null && o.total_oil_litre != null) qty = o.total_oil_litre;
        var received = intake.date_received || o.production_date || o.created_at;
        return {
            id: o.id,
            batch_number: o.batch_id || o.batch_number,
            supplier_name: supplier,
            supplier_details: supplier,
            grower_name: supplier,
            quantity_kg: qty,
            date_received: received,
            received_date: received,
            status: o.status,
            // Carried through unmapped so the grid can show what these batches actually record,
            // and so OilBatchEdit can prefill from the row without a second fetch.
            production_date: o.production_date,
            total_oil_litre: o.total_oil_litre,
            intake_data: o.intake_data,
            production_data: o.production_data,
            stock_data: o.stock_data,
            dispatch_data: o.dispatch_data
        };
    }

    function statusBadgeHtml(d) {
        return typeof BatchStatus !== 'undefined' ? BatchStatus.statusBadgeHtml(d) : escapeHtml(d.label || '');
    }

    /**
     * Supplier cell for an oil batch.
     *
     * An oil batch has no single supplier contact — its "suppliers" are the raw material batches
     * consumed to make it, each with its own supplier, quantity and FFA. So the cell is a button
     * onto that list, and a plain "—" when the batch records no ingredients.
     *
     * The has/hasn't decision is read from production_data, which already travels with the row.
     * Asking the detail RPC per row would be one request per visible batch (the grid loads up to
     * 500). OilBatchIngredients may not be loaded yet on a pre-deploy page, so fall back to the
     * old text rendering rather than showing nothing — the button appears once it is available.
     */
    function oilSupplierCellHtml(ob) {
        var plain = escapeHtml(ob.supplier_name || ob.supplier_details || ob.grower_name || '-');
        if (typeof OilBatchIngredients === 'undefined' || !OilBatchIngredients.hasIngredients) return plain;
        if (!OilBatchIngredients.hasIngredients(ob)) return plain;

        var names = OilBatchIngredients.supplierNames(ob);
        var label = names.length === 1
            ? names[0]
            : (names.length > 1 ? names.length + ' suppliers' : 'View ingredients');
        return '<button type="button" class="btn btn-link btn-sm p-0 text-start js-bj-oil-ingredients" '
            + 'data-batch-number="' + escapeHtml(ob.batch_number || ob.batch_id || '') + '" '
            + 'title="Show the raw material batches that went into this oil batch">'
            + '<i class="fas fa-flask me-1"></i>' + escapeHtml(label) + '</button>';
    }

    /**
     * Run `run` once the named edit-dialog global exists, fetching its script if the page never
     * loaded it.
     *
     * WHY THIS EXISTS: the dialogs are plain <script> tags in index.html, but this is a single-page
     * app. A tab opened BEFORE a deploy keeps that old index.html forever — the router only ever
     * swaps module JS underneath it. So this file can arrive fresh, complete with an Edit button,
     * inside a page whose script tags predate the dialog: the button renders, the global is
     * undefined, and the user is told to refresh. Loading it on demand heals that in place.
     *
     * The guard is kept, not removed — if the fetch genuinely fails (offline, asset missing) the
     * user still gets a clear message instead of a silent no-op.
     */
    function withEditDialog(globalName, src, run, onFail) {
        function ready() {
            return typeof window[globalName] !== 'undefined' && !!window[globalName];
        }
        // onFail lets a caller carry on without the module — the Supplier column preloads this way,
        // so a failed fetch degrades to plain text instead of an error popup on page load.
        function fail() {
            if (typeof onFail === 'function') { onFail(); return; }
            if (typeof Swal !== 'undefined') {
                Swal.fire('Error', 'Edit is not available. Please refresh the page and try again.', 'error');
            }
        }
        if (ready()) { run(); return; }

        var selector = 'script[data-mac-dialog="' + globalName + '"]';
        var existing = document.querySelector(selector);
        if (existing) {
            // A click landed while an earlier one was still fetching — wait on the same request.
            existing.addEventListener('load', function () { if (ready()) run(); else fail(); });
            existing.addEventListener('error', fail);
            return;
        }
        var el = document.createElement('script');
        el.src = src;
        el.setAttribute('data-mac-dialog', globalName);
        el.onload = function () { if (ready()) run(); else fail(); };
        el.onerror = function () {
            // Leaving the failed tag in place would make every later click wait on a dead request.
            if (el.parentNode) el.parentNode.removeChild(el);
            fail();
        };
        document.head.appendChild(el);
    }

    function sortBatches(batches, sortBy) {
        var sorted = batches.slice();
        var statusOrder = typeof BatchStatus !== 'undefined' ? BatchStatus.STATUS_ORDER : [];
        switch (sortBy) {
            case 'newest':
                sorted.sort(function (a, b) {
                    return new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0);
                });
                break;
            case 'oldest':
                sorted.sort(function (a, b) {
                    return new Date(a.received_date || a.created_at || 0) - new Date(b.received_date || b.created_at || 0);
                });
                break;
            case 'status':
                sorted.sort(function (a, b) {
                    function ord(x, getter) {
                        var i = statusOrder.indexOf(getter(x).value);
                        return i >= 0 ? i : 999;
                    }
                    return ord(a, getDisplayStatus) - ord(b, getDisplayStatus);
                });
                break;
            case 'grower':
                sorted.sort(function (a, b) {
                    return (a.grower_name || a.supplier_name || '').localeCompare(b.grower_name || b.supplier_name || '');
                });
                break;
            case 'weight':
                sorted.sort(function (a, b) {
                    return (parseFloat(b.wet_nis_received_kg || b.quantity_kg) || 0) - (parseFloat(a.wet_nis_received_kg || a.quantity_kg) || 0);
                });
                break;
            case 'moisture':
                sorted.sort(function (a, b) {
                    var ma = getMoistureValue(a);
                    var mb = getMoistureValue(b);
                    if (ma == null && mb == null) return 0;
                    if (ma == null) return 1;
                    if (mb == null) return -1;
                    return mb - ma;
                });
                break;
        }
        return sorted;
    }

    function openActionForKernelBatch(batch) {
        var d = getDisplayStatus(batch);
        var routeInfo = typeof BatchStatus !== 'undefined'
            ? BatchStatus.getKernelRouteForStatus(d)
            : { route: 'batch-journey', label: 'Open', searchInputId: 'bjSearchInput' };
        var label = batch.batch_number || batch.id || '';
        if (typeof HandoffDialog !== 'undefined') {
            HandoffDialog.navigateToRoute(routeInfo.route, label, routeInfo.searchInputId);
        } else if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
            _appRouter.routeTo(routeInfo.route);
        }
    }

    function openActionForOilBatch(batch) {
        var d = getOilDisplayStatus(batch);
        var routeInfo = typeof BatchStatus !== 'undefined'
            ? BatchStatus.getOilRouteForStatus(d)
            : { route: 'supplier-intake-grid', label: 'Open', searchInputId: 'searchSupplierIntakeInput' };
        var label = batch.batch_number || batch.id || '';
        if (typeof HandoffDialog !== 'undefined') {
            HandoffDialog.navigateToRoute(routeInfo.route, label, routeInfo.searchInputId);
        } else if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
            _appRouter.routeTo(routeInfo.route);
        }
    }

    function renderKernelTable() {
        var tbody = document.getElementById('bjTableBody');
        var countEl = document.getElementById('bjBatchCount');
        if (!tbody) return;

        if (!scope.filteredBatches.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No batches found</td></tr>';
            if (countEl) countEl.textContent = '0 batches';
            return;
        }

        if (countEl) countEl.textContent = scope.filteredBatches.length + ' batch' + (scope.filteredBatches.length !== 1 ? 'es' : '');

        var html = '';
        for (var i = 0; i < scope.filteredBatches.length; i++) {
            var b = scope.filteredBatches[i];
            var displayStatus = getDisplayStatus(b);
            var moisture = getMoistureValue(b);
            var totalYield = getTotalYield(b);
            var receivedDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                ? (_common.formatDateDDMMYYYY(b.received_date) || '-')
                : '-';
            var kid = escapeHtml(b.id);
            var routeInfo = typeof BatchStatus !== 'undefined' ? BatchStatus.getKernelRouteForStatus(displayStatus) : { label: 'Open' };
            var ddSuffix = String(b.id || '').replace(/-/g, '');
            html += '<tr class="js-bj-row" data-batch-id="' + kid + '">'
                + '<td>' + (b.batch_number || '-') + '</td>'
                + '<td>' + (b.grower_name || '-') + '</td>'
                + '<td>' + statusBadgeHtml(displayStatus) + '</td>'
                + '<td>' + receivedDate + '</td>'
                + '<td class="text-end">' + formatNumber(b.wet_nis_received_kg) + '</td>'
                + '<td class="text-end">' + (moisture != null ? formatNumber(moisture, 1) + '%' : '-') + '</td>'
                + '<td class="text-end">' + (totalYield > 0 ? formatNumber(totalYield) : '-') + '</td>'
                + '<td class="text-end"><button type="button" class="btn btn-sm btn-primary js-bj-open-module" data-batch-id="' + kid + '" title="' + escapeHtml(routeInfo.label) + '">' + escapeHtml(routeInfo.label.replace(/^Open /, '')) + '</button></td>'
                + '<td class="mac-table-actions-col">'
                + MacTableActions.render({
                    id: 'bjActions' + ddSuffix,
                    wrapLi: true,
                    items: [
                        { label: 'Edit batch details', className: 'js-bj-edit-batch', icon: 'fas fa-pen', dataAttrs: { 'batch-id': b.id } },
                        { label: 'Archive', className: 'bj-archive-batch', icon: 'fas fa-archive', dataAttrs: { 'kernel-id': b.id } }
                    ]
                })
                + '</td>'
                + '</tr>';
        }
        tbody.innerHTML = html;
        MacTableActions.init(document.getElementById('bjTable'));
    }

    function renderOilTable() {
        var tbody = document.getElementById('bjOilTableBody');
        var countEl = document.getElementById('bjOilBatchCount');
        if (!tbody) return;

        if (!scope.filteredOilBatches.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No oil batches found</td></tr>';
            if (countEl) countEl.textContent = '0 batches';
            return;
        }

        if (countEl) countEl.textContent = scope.filteredOilBatches.length + ' batch' + (scope.filteredOilBatches.length !== 1 ? 'es' : '');

        var html = '';
        for (var j = 0; j < scope.filteredOilBatches.length; j++) {
            var ob = scope.filteredOilBatches[j];
            var od = getOilDisplayStatus(ob);
            var productionDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                ? (_common.formatDateDDMMYYYY(ob.production_date) || '-')
                : '-';
            var oid = escapeHtml(ob.id);
            var oilRoute = typeof BatchStatus !== 'undefined' ? BatchStatus.getOilRouteForStatus(od) : { label: 'Open' };
            html += '<tr class="js-bj-oil-row" data-oil-id="' + oid + '">'
                + '<td>' + escapeHtml(ob.batch_number || ob.batch_id || '-') + '</td>'
                + '<td>' + oilSupplierCellHtml(ob) + '</td>'
                + '<td>' + statusBadgeHtml(od) + '</td>'
                + '<td>' + productionDate + '</td>'
                + '<td class="text-end">' + (ob.total_oil_litre != null && ob.total_oil_litre !== '' ? formatNumber(ob.total_oil_litre, 2) : '-') + '</td>'
                + '<td class="mac-table-actions-col">'
                + MacTableActions.render({
                    id: 'bjOilActions' + String(ob.id || '').replace(/-/g, ''),
                    items: [
                        { label: oilRoute.label.replace(/^Open /, ''), className: 'js-bj-oil-open-module', dataAttrs: { 'oil-id': ob.id } },
                        { label: 'Edit batch details', className: 'js-bj-oil-edit-batch', icon: 'fas fa-pen', dataAttrs: { 'oil-id': ob.id } },
                        { label: 'History', className: 'js-bj-oil-history', icon: 'fas fa-history', dataAttrs: { 'oil-id': ob.id } }
                    ]
                })
                + '</td>'
                + '</tr>';
        }
        tbody.innerHTML = html;
        MacTableActions.init(document.getElementById('bjOilTable'));
    }

    function filterAndSort() {
        if (scope.activeStream === 'oil') {
            filterAndSortOil();
            return;
        }
        var search = (document.getElementById('bjSearchInput').value || '').toLowerCase().trim();
        var statusFilter = document.getElementById('bjStatusFilter').value;
        var sortBy = document.getElementById('bjSortBy').value;

        var filtered = scope.batches.filter(function (b) {
            if (!statusFilterMatches(b, statusFilter)) return false;
            if (search) {
                var haystack = ((b.batch_number || '') + ' ' + (b.grower_name || '')).toLowerCase();
                if (haystack.indexOf(search) === -1) return false;
            }
            return true;
        });

        scope.filteredBatches = sortBatches(filtered, sortBy);
        renderKernelTable();
    }

    function filterAndSortOil() {
        var searchEl = document.getElementById('bjOilSearchInput');
        var search = searchEl ? (searchEl.value || '').toLowerCase().trim() : '';
        var statusFilterEl = document.getElementById('bjOilStatusFilter');
        var statusFilter = statusFilterEl ? statusFilterEl.value : '';
        var sortEl = document.getElementById('bjOilSortBy');
        var sortBy = sortEl ? sortEl.value : 'newest';

        scope.filteredOilBatches = scope.oilBatches.filter(function (b) {
            if (statusFilter) {
                var d = getOilDisplayStatus(b);
                if (d.value !== statusFilter) return false;
            }
            if (search) {
                var hay = ((b.batch_number || b.batch_id || '') + ' ' + (b.supplier_name || b.supplier_details || b.grower_name || '')).toLowerCase();
                if (hay.indexOf(search) === -1) return false;
            }
            return true;
        });
        scope.filteredOilBatches = sortBatches(scope.filteredOilBatches, sortBy);
        renderOilTable();
    }

    function setActiveStream(stream) {
        scope.activeStream = stream === 'oil' ? 'oil' : 'kernel';
        var kernelPanel = document.getElementById('bjKernelPanel');
        var oilPanel = document.getElementById('bjOilPanel');
        if (kernelPanel) kernelPanel.style.display = scope.activeStream === 'kernel' ? '' : 'none';
        if (oilPanel) oilPanel.style.display = scope.activeStream === 'oil' ? '' : 'none';
        document.querySelectorAll('#bjStreamTabs .nav-link').forEach(function (btn) {
            var s = btn.getAttribute('data-stream');
            btn.classList.toggle('active', s === scope.activeStream);
        });
        if (scope.activeStream === 'oil' && !scope.oilBatches.length) {
            loadOilBatches();
        } else if (scope.activeStream === 'oil') {
            filterAndSortOil();
        } else {
            filterAndSort();
        }
    }

    function bindEvents() {
        document.getElementById('bjSearchInput').addEventListener('input', filterAndSort);
        document.getElementById('bjStatusFilter').addEventListener('change', filterAndSort);
        document.getElementById('bjSortBy').addEventListener('change', filterAndSort);

        var clearBtn = document.getElementById('bjClearBtn');
        if (clearBtn) clearBtn.addEventListener('click', function () {
            document.getElementById('bjSearchInput').value = '';
            document.getElementById('bjStatusFilter').value = '';
            document.getElementById('bjSortBy').value = 'newest';
            filterAndSort();
        });

        var oilSearch = document.getElementById('bjOilSearchInput');
        if (oilSearch) oilSearch.addEventListener('input', filterAndSortOil);
        var oilStatus = document.getElementById('bjOilStatusFilter');
        if (oilStatus) oilStatus.addEventListener('change', filterAndSortOil);
        var oilSort = document.getElementById('bjOilSortBy');
        if (oilSort) oilSort.addEventListener('change', filterAndSortOil);
        var oilClearBtn = document.getElementById('bjOilClearBtn');
        if (oilClearBtn) oilClearBtn.addEventListener('click', function () {
            if (oilSearch) oilSearch.value = '';
            if (oilStatus) oilStatus.value = '';
            if (oilSort) oilSort.value = 'newest';
            filterAndSortOil();
        });

        document.querySelectorAll('#bjStreamTabs .nav-link').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                setActiveStream(btn.getAttribute('data-stream'));
            });
        });

        $(document).on('click', '#bjTableBody tr.js-bj-row', function (e) {
            if ($(e.target).closest('button, .btn, .dropdown, a').length) return;
            var batchId = $(this).data('batch-id');
            if (batchId && typeof _modal_batch_history !== 'undefined' && _modal_batch_history.show) {
                _modal_batch_history.show(batchId);
            }
        });

        $(document).on('click', '#bjTableBody .js-bj-open-module', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var batchId = $(this).data('batch-id');
            var batch = scope.filteredBatches.find(function (b) { return String(b.id) === String(batchId); });
            if (batch) openActionForKernelBatch(batch);
        });

        // Edit batch details — kernel. Reuses the shared dialog that Kernel Production uses, so the
        // rules live in one place. Rows here come from get_kernel_batches, the exact shape the
        // dialog expects, so no extra fetch is needed.
        $(document).on('click', '#bjTableBody .js-bj-edit-batch', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var batchId = $(this).data('batch-id');
            withEditDialog('KernelBatchEdit', 'js/kernel-batch-edit.js', function () {
                var batch = scope.filteredBatches.find(function (b) { return String(b.id) === String(batchId); });
                if (!batch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found. Refresh and try again.', 'error');
                    return;
                }
                KernelBatchEdit.prompt(batch, { onSaved: function () { loadBatches(); } });
            });
        });

        $(document).on('click', '#bjOilTableBody .js-bj-oil-open-module', function (e) {
            e.preventDefault();
            var oilId = $(this).data('oil-id');
            var batch = scope.filteredOilBatches.find(function (b) { return String(b.id) === String(oilId); });
            if (batch) openActionForOilBatch(batch);
        });

        // Raw ingredients that went into an oil batch — the oil equivalent of "supplier".
        $(document).on('click', '#bjOilTableBody .js-bj-oil-ingredients', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var batchNumber = $(this).data('batch-number');
            withEditDialog('OilBatchIngredients', 'js/oil-batch-ingredients.js', function () {
                OilBatchIngredients.show(batchNumber);
            });
        });

        // Edit batch details — oil. Header fields only, mirroring the kernel dialog's scope.
        $(document).on('click', '#bjOilTableBody .js-bj-oil-edit-batch', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var oilId = $(this).data('oil-id');
            withEditDialog('OilBatchEdit', 'js/oil-batch-edit.js', function () {
                var batch = scope.filteredOilBatches.find(function (b) { return String(b.id) === String(oilId); });
                if (!batch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found. Refresh and try again.', 'error');
                    return;
                }
                OilBatchEdit.prompt(batch, { onSaved: function () { loadOilBatches(); } });
            });
        });

        $(document).on('click', '#bjOilTableBody .js-bj-oil-history', function (e) {
            e.preventDefault();
            var oilId = $(this).data('oil-id');
            var batch = scope.filteredOilBatches.find(function (b) { return String(b.id) === String(oilId); });
            if (batch && typeof _modal_oil_batch_history !== 'undefined' && _modal_oil_batch_history.show) {
                _modal_oil_batch_history.show(batch);
            } else if (batch && typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'info',
                    title: batch.batch_number || 'Oil batch',
                    html: '<p class="mb-1"><strong>Status:</strong> ' + escapeHtml(getOilDisplayStatus(batch).label) + '</p>'
                        + '<p class="small text-muted mb-0">Use the Open button to continue this batch in the correct module.</p>'
                });
            }
        });

        $(document).on('click', '#bjTableBody .dropdown-toggle', function (e) {
            e.stopPropagation();
        });

        $(document).on('click', '#bjTableBody .bj-archive-batch', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var kernelId = $(this).data('kernel-id');
            if (!kernelId) return;
            var row = $(this).closest('tr.js-bj-row');
            var label = (row.find('td').first().text() || 'This batch').trim();
            scope.archiveKernelBatch(kernelId, label);
        });
    }

    scope.archiveKernelBatch = function (kernelId, label) {
        var df = (typeof dataFunctions !== 'undefined') ? dataFunctions : (typeof _dataFunctions !== 'undefined' ? _dataFunctions : null);
        if (!df || !df.deactivateKernelBatch) {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Archive is not available. Please refresh.', 'error');
            else window.alert('Archive is not available.');
            return;
        }
        var batchLabel = (label && String(label).trim()) ? String(label).trim() : 'this batch';
        if (typeof Swal === 'undefined') {
            if (!window.confirm('Archive batch ' + batchLabel + '?')) return;
            df.deactivateKernelBatch(kernelId).then(function (result) {
                var inner = (result && result.deactivate_kernel_batch) ? result.deactivate_kernel_batch : result;
                if (inner && inner.success === false) throw new Error(inner.error || 'Archive failed');
                loadBatches();
            }).catch(function (err) {
                console.error('Batch Journey: archive failed', err);
                window.alert((err && err.message) ? err.message : 'Archive failed');
            });
            return;
        }
        Swal.fire({
            title: 'Archive kernel batch?',
            html: 'Send <strong>' + escapeHtml(batchLabel) + '</strong> to the archive? It will be removed from active lists. Restore later from Stock → <strong>View archive</strong>.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#6c757d',
            confirmButtonText: 'Yes, archive',
            cancelButtonText: 'Cancel'
        }).then(function (res) {
            if (!res || !res.isConfirmed) return;
            df.deactivateKernelBatch(kernelId).then(function (result) {
                var inner = (result && result.deactivate_kernel_batch) ? result.deactivate_kernel_batch : result;
                if (inner && inner.success === false) throw new Error(inner.error || 'Archive failed');
                Swal.fire({
                    icon: 'success',
                    title: 'Batch archived',
                    text: batchLabel + ' has been sent to the archive.',
                    timer: 2200,
                    showConfirmButton: false
                });
                loadBatches();
            }).catch(function (err) {
                console.error('Batch Journey: archive failed', err);
                var msg = (err && err.message) ? err.message : 'Failed to archive batch';
                Swal.fire('Error', msg, 'error');
            });
        });
    };

    function loadBatches() {
        if (typeof _dataFunctions === 'undefined') return;

        _dataFunctions.getKernelBatches(null, false, {
            status: null,
            limit: 500
        }).then(function (data) {
            scope.batches = data || [];
            filterAndSort();
        }).catch(function (err) {
            console.error('Batch Journey: failed to load batches', err);
            document.getElementById('bjTableBody').innerHTML =
                '<tr><td colspan="9" class="text-center text-danger py-4">Failed to load batches</td></tr>';
        });
    }

    function loadOilBatches() {
        var df = (typeof dataFunctions !== 'undefined') ? dataFunctions : (typeof _dataFunctions !== 'undefined' ? _dataFunctions : null);
        if (!df || !df.getOilBatches) {
            var tbody = document.getElementById('bjOilTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Oil batch list is not available.</td></tr>';
            return;
        }
        df.getOilBatches({ limit: 500 }, null, false).then(function (rows) {
            scope.oilBatches = normalizeOilBatchList(rows).map(mapOilRowForJourney);
            // Make sure the ingredients module is present BEFORE the first render: the Supplier
            // cell needs it to decide button-vs-"—", and on a pre-deploy page it would otherwise
            // render plain text on load and only gain buttons after some later refresh.
            withEditDialog('OilBatchIngredients', 'js/oil-batch-ingredients.js', filterAndSortOil, filterAndSortOil);
        }).catch(function (err) {
            console.error('Batch Journey: failed to load oil batches', err);
            var tbody = document.getElementById('bjOilTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Failed to load oil batches</td></tr>';
        });
    }

    return {
        init: function () {
            if (typeof BatchStatus !== 'undefined') BatchStatus.applyModuleSubtitle('batch-journey');
            if (typeof HandoffDialog !== 'undefined') HandoffDialog.applyPendingSearchForRoute('batch-journey');
            bindEvents();
            loadBatches();

            if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                _appRouter.loadContent({
                    routeName: 'batch-history-modal',
                    elementSelector: '#batchHistoryModal'
                });
            }
        }
    };
})();

/** Lightweight oil batch history (Find a batch → Oil tab). */
var _modal_oil_batch_history = {
    show: function (batch) {
        if (!batch || typeof Swal === 'undefined') return;
        var d = typeof BatchStatus !== 'undefined' ? BatchStatus.getOilDisplayStatus(batch) : { label: batch.status || '—' };
        var routeInfo = typeof BatchStatus !== 'undefined' ? BatchStatus.getOilRouteForStatus(d) : null;
        var html = '<dl class="text-start small mb-0">'
            + '<dt>Batch</dt><dd>' + (typeof BatchStatus !== 'undefined' ? BatchStatus.escapeHtml(batch.batch_number || '—') : (batch.batch_number || '—')) + '</dd>'
            + '<dt>Supplier</dt><dd>' + (batch.supplier_name || batch.grower_name || '—') + '</dd>'
            + '<dt>Status</dt><dd>' + d.label + '</dd>'
            + '<dt>Quantity (kg)</dt><dd>' + (batch.quantity_kg != null ? batch.quantity_kg : '—') + '</dd>'
            + '</dl>';
        Swal.fire({
            title: 'Oil batch history',
            html: html,
            icon: 'info',
            showCancelButton: !!routeInfo,
            confirmButtonText: routeInfo ? routeInfo.label : 'OK',
            cancelButtonText: 'Close'
        }).then(function (res) {
            if (res && res.isConfirmed && routeInfo && typeof HandoffDialog !== 'undefined') {
                HandoffDialog.navigateToRoute(routeInfo.route, batch.batch_number || '', routeInfo.searchInputId);
            }
        });
    }
};
