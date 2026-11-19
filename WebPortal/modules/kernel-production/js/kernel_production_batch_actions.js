/**
 * Kernel Production Batch Actions Module
 * Grid-only: release to stock, new batch modal + save. No modal controllers – batch history routes to _modal_batch_history.show() from grid.
 */
var _kernelProductionBatchActions = function () {
    'use strict';
    /** Contact types that may own a batch. Matches modal_grower_create_kernel_batch.js. */
    var SUPPLIER_TYPES = ['nis_supplier', 'supplier', 'both'];
    return {
        init: () => {
            const scope = _kernelProductionBatchActions;
            $(document).off('click.kernelNewBatch', '#saveNewBatchBtn').on('click.kernelNewBatch', '#saveNewBatchBtn', (e) => {
                e.preventDefault();
                scope.saveNewBatch();
            });
            $(document).off('click.kernelAddSupplier', '#prodAddSupplierBtn').on('click.kernelAddSupplier', '#prodAddSupplierBtn', (e) => {
                e.preventDefault();
                scope.showAddSupplierForm();
            });
            $(document).off('click.kernelAddSupplier', '#prodNewSupplierSubmitBtn').on('click.kernelAddSupplier', '#prodNewSupplierSubmitBtn', (e) => {
                e.preventDefault();
                scope.submitNewSupplierForm();
            });
            $(document).off('click.kernelAddSupplier', '#prodNewSupplierCancelBtn').on('click.kernelAddSupplier', '#prodNewSupplierCancelBtn', (e) => {
                e.preventDefault();
                scope.hideAddSupplierForm();
            });
        },

        jobCardHasStockQuantities: (jobCardData) => {
            if (typeof _kernelJobCardStock !== 'undefined' && _kernelJobCardStock.hasStockQuantities) {
                return _kernelJobCardStock.hasStockQuantities(jobCardData);
            }
            if (!jobCardData || typeof jobCardData !== 'object') return false;
            function parseStyles(val) {
                if (!val) return [];
                if (Array.isArray(val)) return val;
                if (typeof val === 'string') {
                    try { return JSON.parse(val); } catch (e) { return []; }
                }
                return [];
            }
            function hasQty(rows) {
                return rows.some(function (row) {
                    if (!row) return false;
                    var c = parseInt(row.cartons, 10) || 0;
                    var kg = parseFloat(row.weight_kg) || 0;
                    return c > 0 || kg > 0;
                });
            }
            return hasQty(parseStyles(jobCardData.sound_kernel_styles)) ||
                hasQty(parseStyles(jobCardData.butter_grade_styles));
        },

        releaseBatchToStock: (batchId) => {
            if (!batchId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.completeKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Release function not available. Please refresh.', 'error');
                return;
            }
            var batch = (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch) ? _kernelProductionGrid.getBatch(batchId) : null;
            var batchLabel = batch ? macBatchNo.format(batch.batch_number || 'this batch') : 'this batch';
            var scope = _kernelProductionBatchActions;

            var detailPromise = (dataFunctions.getKernelBatchDetail && batchId)
                ? dataFunctions.getKernelBatchDetail(batchId)
                : Promise.resolve(null);
            detailPromise.then(function (detail) {
                var approved = (typeof _dataFunctions !== 'undefined' && _dataFunctions.isKernelJobcardApproved)
                    ? (_dataFunctions.isKernelJobcardApproved(detail) || _dataFunctions.isKernelJobcardApproved(batch))
                    : ((detail && detail.jobcard_approved === true) ||
                        (batch && batch.has_jobcard_approved === true));
                if (!approved) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Job card not approved',
                        text: 'Open the job card, review style quantities, and press Jobcard approved before releasing to stock.'
                    });
                    return;
                }
                var jc = detail && detail.job_card_data ? detail.job_card_data : null;
                if (!scope.jobCardHasStockQuantities(jc)) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Job card quantities required',
                        text: 'Enter at least one style line (cartons or kg) on the job card and press Jobcard approved before releasing to stock.'
                    });
                    return;
                }
                scope.showTransferSheet(batchId, batch, batchLabel);
            }).catch(function () {
                Swal.fire({
                    icon: 'warning',
                    title: 'Could not verify job card',
                    text: 'Reload the batch and ensure the job card is approved before releasing to stock.'
                });
            });
        },

        /** Whole boxes as "15", part boxes as "14.5". */
        fmtBoxes: (n) => {
            var v = Math.round((Number(n) || 0) * 100) / 100;
            return String(v);
        },

        /**
         * Transfer to stock = a count sheet (Mike, 19 Nov 2026; migration 20261119090000).
         * Shows what production packed per style (from the approved job card); the person counts the
         * boxes and types each number. A style that differs needs a note. Stock on hand takes the
         * COUNTED numbers; a difference is flagged on Stock on Hand.
         */
        showTransferSheet: (batchId, batch, batchLabel) => {
            var scope = _kernelProductionBatchActions;
            var esc = function (s) { return _common.escapeHtml(String(s == null ? '' : s)); };
            if (!dataFunctions.getKernelTransferSheet || !dataFunctions.transferKernelBatchToStock) {
                Swal.fire('Error', 'Transfer to stock is not available. Please refresh the page.', 'error');
                return Promise.resolve();
            }
            return dataFunctions.getKernelTransferSheet(batchId).then(function (sheet) {
                if (!sheet || sheet.success === false) throw new Error((sheet && sheet.error) || 'Could not load the count sheet.');
                var lines = Array.isArray(sheet.lines) ? sheet.lines : [];
                if (!lines.length) {
                    Swal.fire({ icon: 'warning', title: 'Job card quantities required', text: 'Enter at least one style line (cartons or kg) on the job card and press Jobcard approved first.' });
                    return;
                }
                var supplier = (sheet.grower_name || '').toString().trim();
                var rows = lines.map(function (l, i) {
                    return '<tr class="kp-tc-row" data-i="' + i + '">' +
                        '<td class="fw-semibold">' + esc(l.style) + '</td>' +
                        '<td class="text-end">' + esc(scope.fmtBoxes(l.cartons)) + '<div class="small text-muted">' + esc(_common.formatKg(l.kg)) + ' kg</div></td>' +
                        '<td><input type="number" min="0" step="1" inputmode="numeric" class="form-control form-control-sm kp-tc-count" data-i="' + i + '" aria-label="Boxes counted, style ' + esc(l.style) + '"></td>' +
                        '</tr>' +
                        '<tr class="kp-tc-note-row d-none" data-i="' + i + '"><td colspan="3" class="pt-0">' +
                        '<div class="small text-danger mb-1 kp-tc-diff" data-i="' + i + '"></div>' +
                        '<input type="text" maxlength="300" class="form-control form-control-sm kp-tc-note" data-i="' + i + '" placeholder="Why is it different? e.g. one box damaged, re-packed into style 4L">' +
                        '</td></tr>';
                }).join('');
                var total = lines.reduce(function (a, l) { return a + (Number(l.cartons) || 0); }, 0);
                var html =
                    '<div class="text-start">' +
                    '<p class="mb-2">Count the boxes of each style and type the number you counted. If it is different from what production packed, say why.</p>' +
                    '<p class="small text-muted mb-2">Stock on hand will use <strong>your counted numbers</strong>.' +
                    (supplier ? ' Supplier: ' + esc(supplier) + '.' : '') + '</p>' +
                    '<table class="table table-sm align-middle mb-2"><thead><tr><th>Style</th><th class="text-end">Production packed (boxes)</th><th>Boxes counted</th></tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                    '<tfoot><tr><th>Total</th><th class="text-end">' + esc(scope.fmtBoxes(total)) + '</th><th class="kp-tc-total">–</th></tr></tfoot></table>' +
                    '<input type="text" maxlength="300" class="form-control form-control-sm" id="kpTcNote" placeholder="Anything else to note (optional)">' +
                    '<div class="mt-2"><a href="#" id="kpTcPrint" class="small"><i class="fas fa-print me-1"></i>Print a count sheet to take to the floor</a></div>' +
                    '</div>';

                function readCounts() {
                    return lines.map(function (l, i) {
                        var raw = String($('.kp-tc-count[data-i="' + i + '"]').val() || '').trim();
                        var note = String($('.kp-tc-note[data-i="' + i + '"]').val() || '').trim();
                        return { style: l.style, raw: raw, counted: raw === '' ? null : Number(raw), note: note, expected: Number(l.cartons) || 0 };
                    });
                }
                function refresh() {
                    var counts = readCounts();
                    var sum = 0, all = true;
                    counts.forEach(function (c, i) {
                        var differs = c.counted != null && isFinite(c.counted) && Math.round((c.counted - c.expected) * 100) !== 0;
                        $('.kp-tc-note-row[data-i="' + i + '"]').toggleClass('d-none', !differs);
                        $('.kp-tc-row[data-i="' + i + '"]').toggleClass('table-warning', differs);
                        if (differs) {
                            var d = Math.round((c.counted - c.expected) * 100) / 100;
                            $('.kp-tc-diff[data-i="' + i + '"]').text((d > 0 ? d + ' more' : (-d) + ' fewer') + ' than production packed.');
                        }
                        if (c.counted == null || !isFinite(c.counted)) all = false; else sum += c.counted;
                    });
                    $('.kp-tc-total').text(all ? scope.fmtBoxes(sum) : '–');
                }

                return Swal.fire({
                    title: 'Transfer ' + esc(batchLabel) + ' to stock',
                    html: html,
                    width: 640,
                    showCancelButton: true,
                    confirmButtonText: 'Transfer to stock',
                    cancelButtonText: 'Cancel',
                    focusConfirm: false,
                    didOpen: function () {
                        $('.kp-tc-count, .kp-tc-note').on('input', refresh);
                        $('#kpTcPrint').on('click', function (e) {
                            e.preventDefault();
                            scope.printTransferSheet(sheet, batchLabel);
                        });
                        var first = document.querySelector('.kp-tc-count');
                        if (first) first.focus();
                    },
                    preConfirm: function () {
                        var counts = readCounts();
                        for (var i = 0; i < counts.length; i++) {
                            var c = counts[i];
                            if (c.raw === '' || !isFinite(c.counted) || c.counted < 0) {
                                Swal.showValidationMessage('Enter the boxes counted for style ' + c.style + ' (0 if there are none).');
                                return false;
                            }
                            if (Math.round((c.counted - c.expected) * 100) !== 0 && !c.note) {
                                Swal.showValidationMessage('Style ' + c.style + ' is different from production. Say why in the note.');
                                return false;
                            }
                        }
                        var payload = counts.map(function (c) { return { style: c.style, counted: String(c.counted), note: c.note || null }; });
                        var note = String($('#kpTcNote').val() || '').trim() || null;
                        return dataFunctions.transferKernelBatchToStock(batchId, payload, note).then(function (res) {
                            if (!res || res.success === false) {
                                Swal.showValidationMessage((res && res.error) || 'Could not transfer the batch.');
                                return false;
                            }
                            return res;
                        }).catch(function (e) {
                            Swal.showValidationMessage((e && e.message) || 'Could not transfer the batch.');
                            return false;
                        });
                    }
                }).then(function (res) {
                    if (!res.isConfirmed || !res.value) return;
                    var out = res.value;
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadKernelBatches) _stockManagementGrid.loadKernelBatches(true);
                    if (typeof workflowViews !== 'undefined' && workflowViews.refreshTaskBadge) workflowViews.refreshTaskBadge();
                    if (out.has_difference) {
                        var diffs = (out.lines || []).filter(function (l) { return Number(l.difference) !== 0; });
                        return Swal.fire({
                            icon: 'info',
                            title: 'In stock, with a difference',
                            html: '<p>' + esc(batchLabel) + ' is in stock at the counted numbers. The difference is flagged on Stock on Hand.</p>' +
                                '<ul class="text-start small mb-0">' + diffs.map(function (l) {
                                    return '<li>Style ' + esc(l.style) + ': production ' + esc(scope.fmtBoxes(l.expected_cartons)) + ', counted ' +
                                        esc(scope.fmtBoxes(l.counted_cartons)) + (l.note ? ' (' + esc(l.note) + ')' : '') + '</li>';
                                }).join('') + '</ul>'
                        });
                    }
                    if (typeof HandoffDialog !== 'undefined' && HandoffDialog.showKernelReleaseToStock) {
                        HandoffDialog.showKernelReleaseToStock(batch || { batch_number: batchLabel });
                    } else {
                        Swal.fire({ icon: 'success', title: 'In stock', text: batchLabel + ' is now in kernel stock. Every count matched.', timer: 2500, showConfirmButton: false });
                    }
                });
            }).catch(function (e) {
                console.error('[Transfer to stock]', e);
                Swal.fire('Error', (e && e.message) || 'Could not load the count sheet.', 'error');
            });
        },

        /** A plain paper sheet: production's boxes per style, blank Counted and Note columns, sign-off lines. */
        printTransferSheet: (sheet, batchLabel) => {
            var scope = _kernelProductionBatchActions;
            var esc = function (s) { return _common.escapeHtml(String(s == null ? '' : s)); };
            var rows = (sheet.lines || []).map(function (l) {
                return '<tr><td>' + esc(l.style) + '</td><td class="n">' + esc(scope.fmtBoxes(l.cartons)) + '</td><td></td><td></td></tr>';
            }).join('');
            var doc = '<!doctype html><html><head><meta charset="utf-8"><title>Count sheet ' + esc(batchLabel) + '</title>' +
                '<style>body{font-family:Arial,sans-serif;margin:24px}h1{font-size:20px;margin:0 0 4px}p{margin:2px 0 12px}' +
                'table{border-collapse:collapse;width:100%}th,td{border:1px solid;padding:10px 8px;text-align:left}td.n{text-align:right}' +
                '.sign{margin-top:28px;display:flex;gap:32px}.sign div{flex:1;border-top:1px solid;padding-top:4px}</style></head><body>' +
                '<h1>Transfer to stock: count sheet</h1>' +
                '<p>Batch <strong>' + esc(batchLabel) + '</strong>' + (sheet.grower_name ? ' &middot; ' + esc(sheet.grower_name) : '') + '</p>' +
                '<table><thead><tr><th>Style</th><th>Production packed (boxes)</th><th>Boxes counted</th><th>Note if different</th></tr></thead><tbody>' +
                rows + '</tbody></table>' +
                '<div class="sign"><div>Counted by</div><div>Date</div><div>Signature</div></div>' +
                '</body></html>';
            var w = window.open('', '_blank');
            if (!w) {
                Swal.showValidationMessage('Your browser blocked the print window. Allow pop-ups for this site and try again.');
                return;
            }
            w.document.open();
            w.document.write(doc);
            w.document.close();
            w.focus();
            setTimeout(function () { w.print(); }, 250);
        },

        archiveBatch: (batchId) => {
            if (!batchId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.deactivateKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Archive is not available. Please refresh.', 'error');
                return;
            }
            var batch = (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch) ? _kernelProductionGrid.getBatch(batchId) : null;
            var batchLabel = batch ? macBatchNo.format(batch.batch_number || 'this batch') : 'this batch';
            Swal.fire({
                title: 'Archive kernel batch?',
                html: 'Send <strong>' + batchLabel + '</strong> to the archive? It will be removed from production lists. Restore later from Stock → <strong>View archive</strong>.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#6c757d',
                confirmButtonText: 'Yes, archive',
                cancelButtonText: 'Cancel'
            }).then((res) => {
                if (!res.isConfirmed) return;
                dataFunctions.deactivateKernelBatch(batchId).then((result) => {
                    var inner = (result && result.deactivate_kernel_batch) ? result.deactivate_kernel_batch : result;
                    if (inner && inner.success === false) throw new Error(inner.error || 'Archive failed');
                    Swal.fire({ icon: 'success', title: 'Batch archived', text: batchLabel + ' has been sent to the archive.', timer: 2200, showConfirmButton: false });
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                }).catch((e) => {
                    console.error(e);
                    Swal.fire('Error', e.message || 'Failed to archive batch', 'error');
                });
            });
        },

        deleteBatch: (batchId) => {
            _kernelProductionBatchActions.archiveBatch(batchId);
        },

        /** Prefill batch number from DB; uses received date year (matches create_kernel_batch). */
        refreshSuggestedBatchNumber: () => {
            var supplierId = $('#batchSupplier').val() || null;
            var dateStr = $('#batchReceivedDate').val();
            var year = dateStr && dateStr.length >= 4 ? parseInt(dateStr.slice(0, 4), 10) : new Date().getFullYear();
            if (!supplierId) {
                $('#batchNumber').val('').attr('placeholder', 'Select supplier to see suggestion');
                return;
            }
            (dataFunctions.getNextBatchNumber && dataFunctions.getNextBatchNumber(supplierId, year) || Promise.resolve(null))
                .then(function (nextId) {
                    $('#batchNumber').val(nextId ? macBatchNo.format(nextId) : '').attr('placeholder', nextId ? '' : 'Will assign on save');
                })
                .catch(function () { $('#batchNumber').val('').attr('placeholder', 'Will assign on save'); });
        },

        /**
         * Fill the supplier dropdown. Only contacts that can own a batch are listed, and each label
         * carries the supplier code because that code is the SS segment of every batch number.
         */
        populateSupplierDropdown: (preselectSupplierId) => {
            var p = (dataFunctions.getContacts && dataFunctions.getContacts(null, true)) || Promise.resolve([]);
            return p.then((raw) => {
                var contacts = Array.isArray(raw)
                    ? raw
                    : (raw && raw.get_contacts ? raw.get_contacts : (raw && raw.data ? raw.data : []));
                var html = '<option value="">Select Supplier</option>';
                if (Array.isArray(contacts)) {
                    contacts
                        .filter((c) => SUPPLIER_TYPES.indexOf((c.contact_type || '').trim()) >= 0)
                        .forEach((contact) => {
                            var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                            var code = contact.supplier_number != null ? ' (' + contact.supplier_number + ')' : '';
                            html += '<option value="' + contact.id + '">' + name + code + '</option>';
                        });
                }
                $('#batchSupplier').html(html);
                if (preselectSupplierId) $('#batchSupplier').val(preselectSupplierId);
            }).catch((e) => {
                console.error('[Kernel Production] Failed to load suppliers:', e);
            });
        },

        showAddSupplierForm: () => {
            ['prodNewSupplierName', 'prodNewSupplierCode', 'prodNewSupplierProvince', 'prodNewSupplierArea', 'prodNewSupplierContact', 'prodNewSupplierNotes']
                .forEach((id) => { var el = document.getElementById(id); if (el) el.value = ''; });
            $('#prodNewSupplierError').hide().text('');
            $('#prodNewSupplierForm').show();
            setTimeout(() => { var el = document.getElementById('prodNewSupplierName'); if (el) el.focus(); }, 50);
        },

        hideAddSupplierForm: () => {
            $('#prodNewSupplierForm').hide();
            $('#prodNewSupplierError').hide().text('');
        },

        submitNewSupplierForm: () => {
            const scope = _kernelProductionBatchActions;
            var nameEl = document.getElementById('prodNewSupplierName');
            var codeEl = document.getElementById('prodNewSupplierCode');
            var companyName = nameEl && nameEl.value ? nameEl.value.trim() : '';
            var codeVal = codeEl && codeEl.value !== '' ? parseInt(codeEl.value, 10) : NaN;
            var showErr = (msg, focusEl) => {
                $('#prodNewSupplierError').text(msg).show();
                if (focusEl) focusEl.focus();
            };
            if (!companyName) return showErr('Company name is required.', nameEl);
            if (isNaN(codeVal) || codeVal < 0 || codeVal > 99) {
                return showErr('Supplier code must be a number (0–99) used for batch naming.', codeEl);
            }
            $('#prodNewSupplierError').hide().text('');
            var trimmed = (id) => {
                var el = document.getElementById(id);
                return el && el.value ? el.value.trim() : null;
            };
            scope.doCreateSupplier({
                contact_type: 'nis_supplier',
                company_name: companyName,
                supplier_number: codeVal,
                physical_province: trimmed('prodNewSupplierProvince'),
                physical_city: trimmed('prodNewSupplierArea'),
                primary_contact_name: trimmed('prodNewSupplierContact'),
                notes: trimmed('prodNewSupplierNotes'),
                status: 'active'
            });
        },

        doCreateSupplier: (payload) => {
            const scope = _kernelProductionBatchActions;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createContact) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create contact not available.', 'error');
                return;
            }
            dataFunctions.createContact(payload).then((res) => {
                var id = (res && res.id) || (res && res.data && res.data.id);
                if (!id) throw new Error((res && res.error) || 'Failed to add supplier');
                scope.hideAddSupplierForm();
                return scope.populateSupplierDropdown(id).then(() => {
                    scope.refreshSuggestedBatchNumber();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Supplier added', timer: 1500, showConfirmButton: false });
                });
            }).catch((e) => {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to add supplier', 'error');
            });
        },

        showNewBatchModal: () => {
            const scope = _kernelProductionBatchActions;
            $('#newBatchModalLabel').text('New Production Batch');
            $('#batchId').val('');
            scope.clearNewBatchForm();
            $('#batchReceivedDate').val(new Date().toISOString().split('T')[0]);
            $('#batchNumber').val('').attr('placeholder', 'Select supplier to see suggestion');
            $('#batchSupplier').off('change.kernelNextBatch').on('change.kernelNextBatch', function () {
                scope.refreshSuggestedBatchNumber();
            });
            $('#batchReceivedDate').off('change.kernelNextBatchDate').on('change.kernelNextBatchDate', function () {
                scope.refreshSuggestedBatchNumber();
            });
            scope.populateSupplierDropdown().then(() => {
                var modalEl = document.getElementById('newBatchModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
                else $('#newBatchModal').modal('show');
            });
        },

        clearNewBatchForm: () => {
            const scope = _kernelProductionBatchActions;
            var form = document.getElementById('newBatchForm');
            if (form) form.reset();
            $('#batchId').val('');
            scope.hideAddSupplierForm();
        },

        saveNewBatch: () => {
            var form = document.getElementById('newBatchForm');
            if (!form || !form.checkValidity()) {
                if (form) form.reportValidity();
                return;
            }
            var wetNisKg = _common.parseKg($('#batchWetNIS').val());
            if (wetNisKg == null || wetNisKg <= 0) {
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Cannot save yet', text: 'Enter the Wet NIS (kg) as a number greater than 0.' });
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create batch function not available. Please refresh.', 'error');
                return;
            }
            var getVal = (id) => $('#' + id).val() || null;
            var getFloat = (id) => { var v = $('#' + id).val(); return v ? parseFloat(v) : null; };
            var batchNumRaw = $('#batchNumber').val();
            var batchNumTrim = batchNumRaw != null ? String(batchNumRaw).trim() : '';
            var batchData = {
                batch_number:        batchNumTrim.length ? macBatchNo.toStored(batchNumTrim) : null,
                received_date:       getVal('batchReceivedDate'),
                wet_nis_received_kg: wetNisKg,
                supplier_id:         getVal('batchSupplier') || null,
                grower_name:         getVal('batchGrowerName') || null
            };
            dataFunctions.createKernelBatch(batchData).then((result) => {
                var inner = (result && result.create_kernel_batch) ? result.create_kernel_batch : result;
                if (inner && inner.success === false) throw new Error(inner.error || 'Failed to create batch');
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: 'Production batch created successfully', timer: 2000, showConfirmButton: false });
                var modalEl = document.getElementById('newBatchModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else $('#newBatchModal').modal('hide');
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
            }).catch((e) => {
                console.error('[Kernel Production] saveNewBatch failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to create batch', 'error');
            });
        }
    };
}();
