/**
 * KernelBatchEdit — shared "Edit batch details" dialog for kernel batches.
 *
 * Used by Kernel Production (any active batch) and Stock Management (finished batches). Both grids
 * hand it a row from get_kernel_batches, which already carries everything the dialog needs, so no
 * extra fetch is required.
 *
 * Supplier and batch number move together: batch numbers are 'Bn SS YY NN' where SS is the
 * supplier's contacts.supplier_number, so picking a different supplier re-suggests the number via
 * get_next_batch_number. See migrations/20260317000001_batch_naming_bn_supplier_year_seq.sql.
 */
(function (global) {
    'use strict';

    /** Contact types that may own a batch. Matches modal_grower_create_kernel_batch.js. */
    var SUPPLIER_TYPES = ['nis_supplier', 'supplier', 'both'];

    function escapeHtml(s) {
        if (s == null) return '';
        if (typeof _common !== 'undefined' && _common.escapeHtml) return _common.escapeHtml(s);
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** Kernel row id for RPCs (proxy may send batches.id as Id — server resolves either). */
    function kernelIdFromBatch(b) {
        if (!b) return '';
        if (b.kernel_id != null && b.kernel_id !== '') return String(b.kernel_id);
        if (b.KernelId != null && b.KernelId !== '') return String(b.KernelId);
        if (b.id != null && b.id !== '') return String(b.id);
        if (b.Id != null && b.Id !== '') return String(b.Id);
        return '';
    }

    function supplierIdFromBatch(b) {
        if (!b) return '';
        if (b.supplier_id != null && b.supplier_id !== '') return String(b.supplier_id);
        if (b.SupplierId != null && b.SupplierId !== '') return String(b.SupplierId);
        return '';
    }

    /** Normalize API date to yyyy-mm-dd for date inputs. */
    function isoDateOnlyForInput(v) {
        if (v == null || v === '') return '';
        var s = String(v).trim();
        if (s.indexOf('T') !== -1) return s.split('T')[0];
        if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        return s;
    }

    function numberForInput(v) {
        if (v == null || v === '') return '';
        var n = typeof v === 'number' ? v : parseFloat(v);
        return isNaN(n) ? '' : String(n);
    }

    function el(id) {
        return document.getElementById(id);
    }

    function valueOf(id) {
        var node = el(id);
        return node && node.value != null ? node.value : '';
    }

    /** Suppliers for the picker, newest read (bypasses cache so a just-added supplier appears). */
    function loadSuppliers() {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return Promise.resolve(null);
        return dataFunctions.getContacts(null, true).then(function (raw) {
            var contacts = Array.isArray(raw)
                ? raw
                : (raw && raw.get_contacts ? raw.get_contacts : (raw && raw.data ? raw.data : []));
            if (!Array.isArray(contacts)) return null;
            return contacts.filter(function (c) {
                return SUPPLIER_TYPES.indexOf((c.contact_type || '').trim()) >= 0;
            });
        }).catch(function (e) {
            console.error('[KernelBatchEdit] Failed to load suppliers:', e);
            return null;
        });
    }

    /**
     * Supplier <select> markup. A null list (load failed) still renders a usable dialog — the
     * supplier simply cannot be changed, and an omitted supplier_id leaves it untouched server-side.
     */
    function supplierSelectHtml(suppliers, currentSupplierId, currentGrowerName) {
        if (!suppliers) {
            var label = currentGrowerName || 'current supplier';
            return '<select id="swalKBatchSupplier" class="form-select mb-1" disabled>' +
                '<option>' + escapeHtml(label) + '</option></select>' +
                '<div class="small text-danger mb-2">Supplier list could not be loaded, so the supplier cannot be changed right now. Refresh and try again.</div>';
        }
        var opts = '<option value="">Keep current supplier</option>';
        suppliers.forEach(function (c) {
            var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
            var code = c.supplier_number != null ? ' (' + c.supplier_number + ')' : '';
            var selected = String(c.id) === String(currentSupplierId) ? ' selected' : '';
            opts += '<option value="' + escapeHtml(c.id) + '"' + selected + '>' + escapeHtml(name + code) + '</option>';
        });
        return '<select id="swalKBatchSupplier" class="form-select mb-2">' + opts + '</select>';
    }

    function dialogHtml(batch, suppliers) {
        var currentSupplierId = supplierIdFromBatch(batch);
        return '<div class="text-start">' +
            '<label class="form-label">Supplier</label>' +
            supplierSelectHtml(suppliers, currentSupplierId, batch.grower_name) +
            '<label class="form-label">Batch number <span class="text-danger">*</span></label>' +
            '<input id="swalKBatchBn" class="form-control mb-1" value="' + escapeHtml(batch.batch_number || '') + '" autocomplete="off">' +
            '<div id="swalKBatchBnHint" class="small text-muted mb-2">Changing the supplier suggests a new number (Bn [supplier #] [year] [seq]). You can still type your own.</div>' +
            '<label class="form-label">Grower / supplier name</label>' +
            '<input id="swalKBatchGrower" class="form-control mb-2" value="' + escapeHtml(batch.grower_name || '') + '">' +
            '<label class="form-label">Received date</label>' +
            '<input id="swalKBatchRd" type="date" class="form-control mb-2" value="' + escapeHtml(isoDateOnlyForInput(batch.received_date)) + '">' +
            '<label class="form-label">Wet NIS received (kg)</label>' +
            '<input id="swalKBatchWet" type="number" step="0.01" min="0" class="form-control mb-2" value="' + escapeHtml(numberForInput(batch.wet_nis_received_kg)) + '">' +
            '<label class="form-label">FFA (QA)</label>' +
            '<input id="swalKBatchFfa" type="number" step="0.01" min="0" class="form-control mb-2" value="' + escapeHtml(numberForInput(batch.ffa)) + '" placeholder="Optional">' +
            '<label class="form-label">Best before date</label>' +
            '<input id="swalKBatchBb" type="date" class="form-control" value="' + escapeHtml(isoDateOnlyForInput(batch.best_before_date)) + '">' +
            '<p class="small text-muted mt-2 mb-0">Leave FFA or best before empty to leave them unchanged. Clearing Wet NIS or received date removes the stored value.</p>' +
            '</div>';
    }

    /**
     * Wires the supplier -> batch number suggestion.
     *
     * Two rules this must honour:
     *  - Never suggest on open. get_next_batch_number counts batches already on that supplier, so
     *    re-suggesting for the unchanged supplier would bump a correct batch to seq + 1 every time
     *    the dialog is reopened.
     *  - Stop suggesting once the user types their own number.
     */
    function bindBatchNumberSuggestion(batch) {
        var supplierEl = el('swalKBatchSupplier');
        var numberEl = el('swalKBatchBn');
        var hintEl = el('swalKBatchBnHint');
        if (!supplierEl || !numberEl || supplierEl.disabled) return;

        var originalSupplierId = supplierIdFromBatch(batch);
        var originalNumber = (batch.batch_number || '').toString();
        var userEditedNumber = false;

        numberEl.addEventListener('input', function () { userEditedNumber = true; });

        supplierEl.addEventListener('change', function () {
            if (userEditedNumber) return;
            var chosen = supplierEl.value;
            // Back to the batch's own supplier: restore its number rather than allocating a new one.
            if (!chosen || String(chosen) === String(originalSupplierId)) {
                numberEl.value = originalNumber;
                if (hintEl) hintEl.textContent = 'Changing the supplier suggests a new number (Bn [supplier #] [year] [seq]). You can still type your own.';
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getNextBatchNumber) return;
            var dateStr = valueOf('swalKBatchRd');
            var year = dateStr && dateStr.length >= 4 ? parseInt(dateStr.slice(0, 4), 10) : new Date().getFullYear();
            if (hintEl) hintEl.textContent = 'Suggesting a batch number for the new supplier…';
            dataFunctions.getNextBatchNumber(chosen, year).then(function (nextId) {
                if (userEditedNumber) return;
                if (nextId) {
                    numberEl.value = nextId;
                    if (hintEl) hintEl.textContent = 'Suggested for the new supplier. Edit it if you need a different number.';
                } else if (hintEl) {
                    hintEl.textContent = 'Could not suggest a number — check it matches the new supplier before saving.';
                }
            }).catch(function (err) {
                console.error('[KernelBatchEdit] getNextBatchNumber failed:', err);
                if (hintEl) hintEl.textContent = 'Could not suggest a number — check it matches the new supplier before saving.';
            });
        });
    }

    function readForm() {
        var Swal = global.Swal;
        var batchNumber = valueOf('swalKBatchBn').trim();
        if (!batchNumber) {
            Swal.showValidationMessage('Batch number is required');
            return false;
        }
        var wetRaw = valueOf('swalKBatchWet').trim();
        var wet = wetRaw === '' ? null : parseFloat(wetRaw);
        if (wetRaw !== '' && (!isFinite(wet) || wet < 0)) {
            Swal.showValidationMessage('Wet NIS must be a valid non-negative number');
            return false;
        }
        var ffaRaw = valueOf('swalKBatchFfa').trim();
        var ffa = ffaRaw === '' ? null : parseFloat(ffaRaw);
        if (ffaRaw !== '' && (!isFinite(ffa) || ffa < 0)) {
            Swal.showValidationMessage('FFA must be a valid non-negative number');
            return false;
        }
        var receivedDate = valueOf('swalKBatchRd').trim();
        var bestBefore = valueOf('swalKBatchBb').trim();
        var supplierEl = el('swalKBatchSupplier');
        return {
            batch_number: batchNumber,
            // Empty means "keep current" — the RPC treats a null p_supplier_id as leave-unchanged.
            supplier_id: (supplierEl && !supplierEl.disabled && supplierEl.value) ? supplierEl.value : null,
            grower_name: valueOf('swalKBatchGrower'),
            received_date: receivedDate === '' ? null : receivedDate,
            wet_nis_received_kg: wet,
            ffa: ffa,
            best_before_date: bestBefore === '' ? null : bestBefore
        };
    }

    /**
     * Open the edit dialog for a kernel batch.
     * @param {object} batch - row from get_kernel_batches (id = kernel.id)
     * @param {object} [options] - { onSaved: function }
     */
    function prompt(batch, options) {
        var Swal = global.Swal;
        var opts = options || {};
        if (typeof Swal === 'undefined') return;
        if (!batch) {
            Swal.fire('Error', 'Batch not found. Refresh and try again.', 'error');
            return;
        }
        var kernelId = kernelIdFromBatch(batch);
        if (!kernelId) {
            Swal.fire('Error', 'Batch not found. Refresh and try again.', 'error');
            return;
        }
        var df = (typeof dataFunctions !== 'undefined' && dataFunctions) ? dataFunctions : null;
        if (!df || !df.updateKernelStockBatchInfo) {
            Swal.fire('Error', 'Save is not available. Apply the latest database migration and refresh.', 'error');
            return;
        }

        loadSuppliers().then(function (suppliers) {
            return Swal.fire({
                title: 'Edit batch details',
                width: 520,
                showCancelButton: true,
                confirmButtonText: 'Save',
                focusConfirm: false,
                html: dialogHtml(batch, suppliers),
                didOpen: function () { bindBatchNumberSuggestion(batch); },
                preConfirm: readForm
            });
        }).then(function (res) {
            if (!res || !res.isConfirmed || !res.value) return;
            return df.updateKernelStockBatchInfo(kernelId, res.value).then(function (result) {
                if (result && result.success === false) throw new Error(result.error || 'Save failed');
                Swal.fire({ icon: 'success', title: 'Saved', timer: 1600, showConfirmButton: false });
                if (typeof opts.onSaved === 'function') opts.onSaved(result);
            });
        }).catch(function (e) {
            console.error('[KernelBatchEdit] save failed:', e);
            Swal.fire('Error', e.message || 'Failed to save', 'error');
        });
    }

    global.KernelBatchEdit = {
        prompt: prompt,
        SUPPLIER_TYPES: SUPPLIER_TYPES
    };
})(typeof window !== 'undefined' ? window : this);
