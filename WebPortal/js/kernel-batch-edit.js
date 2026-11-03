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
 *
 * The form pieces (fields, grower picker, batch-number suggestion, validation) are also used inline by
 * Find a batch's batch page (modules/batch-journey/js/batch_journey_detail.js). Every builder takes an
 * id prefix: the dialog keeps 'swalKBatch' (its ids are unchanged), the batch page uses its own, so the
 * two can never collide and the rules live in one place.
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

    /** Id prefix of the SweetAlert dialog's fields. Kept as before so nothing else has to change. */
    var DIALOG_PREFIX = 'swalKBatch';

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

    /** Display name for a contact, without the "(supplier #)" suffix used only for disambiguation. */
    function contactName(c) {
        return c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
    }

    /**
     * Grower <select> markup.
     *
     * ONE field, not two. kernel carries both supplier_id (FK to contacts) and grower_name (free
     * text) — the same thing under two names, "supplier" being the oil-side term and "grower" the
     * kernel-side one. Exposing both let them drift: of the batches carrying both, most disagreed
     * with the contact they point at (typos, truncations, "(40)" suffixes baked into the text).
     * The dropdown is now the only input, and grower_name is written from the chosen contact.
     *
     * A null list (load failed) still renders a usable dialog — the grower simply cannot be
     * changed, and an omitted supplier_id leaves both fields untouched server-side.
     */
    function growerSelectHtml(suppliers, currentSupplierId, currentGrowerName, prefix) {
        var selectId = (prefix || DIALOG_PREFIX) + 'Supplier';
        if (!suppliers) {
            var label = currentGrowerName || 'current grower';
            return '<select id="' + selectId + '" class="form-select mb-1" disabled>' +
                '<option>' + escapeHtml(label) + '</option></select>' +
                '<div class="small text-danger mb-2">Grower list could not be loaded, so the grower cannot be changed right now. Refresh and try again.</div>';
        }
        // Batches predating the FK have a name but no contact. Their placeholder keeps that name
        // visible and, left alone, preserves it — picking a grower is what replaces it.
        var keepLabel = currentGrowerName && !currentSupplierId
            ? 'Keep current: ' + currentGrowerName
            : 'Keep current grower';
        var opts = '<option value="">' + escapeHtml(keepLabel) + '</option>';
        suppliers.forEach(function (c) {
            var code = c.supplier_number != null ? ' (' + c.supplier_number + ')' : '';
            var selected = String(c.id) === String(currentSupplierId) ? ' selected' : '';
            opts += '<option value="' + escapeHtml(c.id) + '"' + selected + '>' + escapeHtml(contactName(c) + code) + '</option>';
        });
        return '<select id="' + selectId + '" class="form-select mb-2">' + opts + '</select>';
    }

    /**
     * The six fields as { label, html } pairs, ids built from `prefix`. dialogHtml stacks them for the
     * SweetAlert exactly as before; gridFormHtml lays the same pairs out for the batch page.
     */
    function formParts(batch, suppliers, prefix) {
        var p = prefix || DIALOG_PREFIX;
        var currentSupplierId = supplierIdFromBatch(batch);
        var bnLocked = !(typeof window.hasAction === 'function' && window.hasAction('grower_intake.edit_batch_number'));
        return [
            {
                label: '<label class="form-label">Grower</label>',
                html: growerSelectHtml(suppliers, currentSupplierId, batch.grower_name, p)
            },
            {
                label: '<label class="form-label">Batch number <span class="text-danger">*</span></label>',
                html: '<input id="' + p + 'Bn" class="form-control mb-1" value="' + escapeHtml(batch.batch_number || '') + '" autocomplete="off"' + (bnLocked ? ' readonly' : '') + '>' +
                    '<div id="' + p + 'BnHint" class="small text-muted mb-2">' + (bnLocked
                        ? '🔒 Auto-generated. Your role cannot change it.'
                        : 'Auto-generated. Your role is allowed to change it. Changing the grower suggests a new number (Bn [grower #] [year] [seq]).') + '</div>'
            },
            {
                label: '<label class="form-label">Received date</label>',
                html: '<input id="' + p + 'Rd" type="date" class="form-control mb-2" value="' + escapeHtml(isoDateOnlyForInput(batch.received_date)) + '">'
            },
            {
                label: '<label class="form-label">Supplier\'s declared weight (kg)</label>',
                html: '<input id="' + p + 'Wet" type="text" inputmode="decimal" class="form-control mb-2 js-kg-input" value="' + escapeHtml(_common.formatKg(batch.wet_nis_received_kg)) + '">'
            },
            {
                label: '<label class="form-label">FFA (QA)</label>',
                html: '<input id="' + p + 'Ffa" type="number" step="0.01" min="0" class="form-control mb-2" value="' + escapeHtml(numberForInput(batch.ffa)) + '" placeholder="Optional">'
            },
            {
                label: '<label class="form-label">Best before date</label>',
                html: '<input id="' + p + 'Bb" type="date" class="form-control" value="' + escapeHtml(isoDateOnlyForInput(batch.best_before_date)) + '">'
            }
        ];
    }

    /** What an empty box means on save (same RPC, same rules, wherever the form is shown). */
    var SAVE_RULES_NOTE = 'Leave FFA or best before empty to leave them unchanged. Clearing the supplier\'s declared weight or received date removes the stored value.';

    function dialogHtml(batch, suppliers) {
        var html = '<div class="text-start">';
        formParts(batch, suppliers, DIALOG_PREFIX).forEach(function (part) { html += part.label + part.html; });
        return html + '<p class="small text-muted mt-2 mb-0">' + SAVE_RULES_NOTE + '</p></div>';
    }

    /** The same fields in a responsive grid (two columns from md up, one on a phone) for an inline editor. */
    function gridFormHtml(batch, suppliers, prefix) {
        var html = '<div class="row g-2">';
        formParts(batch, suppliers, prefix).forEach(function (part) {
            html += '<div class="col-12 col-md-6">' + part.label + part.html + '</div>';
        });
        return html + '</div><p class="small text-muted mt-2 mb-0">' + SAVE_RULES_NOTE + '</p>';
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
    function bindBatchNumberSuggestion(batch, prefix) {
        var p = prefix || DIALOG_PREFIX;
        var supplierEl = el(p + 'Supplier');
        var numberEl = el(p + 'Bn');
        var hintEl = el(p + 'BnHint');
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
            var dateStr = valueOf(p + 'Rd');
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

    /**
     * Validate and read the form. Returns { value } (the updateKernelStockBatchInfo payload) or
     * { error } (a message for the user). Reads the DOM only; the caller decides how to show an error.
     */
    function collectForm(batch, suppliers, prefix) {
        var p = prefix || DIALOG_PREFIX;
        var batchNumber = valueOf(p + 'Bn').trim();
        if (!batchNumber) return { error: 'Batch number is required' };
        var wetRaw = valueOf(p + 'Wet').trim();
        var wet = wetRaw === '' ? null : _common.parseKg(wetRaw);
        if (wetRaw !== '' && (wet == null || !isFinite(wet) || wet < 0)) {
            return { error: 'Supplier\'s declared weight must be a valid non-negative number' };
        }
        var ffaRaw = valueOf(p + 'Ffa').trim();
        var ffa = ffaRaw === '' ? null : parseFloat(ffaRaw);
        if (ffaRaw !== '' && (!isFinite(ffa) || ffa < 0)) {
            return { error: 'FFA must be a valid non-negative number' };
        }
        var receivedDate = valueOf(p + 'Rd').trim();
        var bestBefore = valueOf(p + 'Bb').trim();
        var supplierEl = el(p + 'Supplier');
        var chosenId = (supplierEl && !supplierEl.disabled && supplierEl.value) ? supplierEl.value : null;

        // grower_name is derived, never typed. It is what every kernel grid displays and what
        // get_kernel_batches searches on, so it has to stay in step with the chosen contact —
        // that is exactly what drifted while this was a free-text box. Nothing chosen means keep
        // what the batch already has: the RPC writes grower_name unconditionally, so sending null
        // here would CLEAR the name on the legacy batches that have no contact to derive it from.
        var chosenName = null;
        if (chosenId && Array.isArray(suppliers)) {
            var picked = suppliers.find(function (c) { return String(c.id) === String(chosenId); });
            if (picked) chosenName = contactName(picked);
        }
        var growerName = chosenName != null ? chosenName : ((batch && batch.grower_name) || null);

        return {
            value: {
                batch_number: batchNumber,
                // Empty means "keep current" — the RPC treats a null p_supplier_id as leave-unchanged.
                supplier_id: chosenId,
                grower_name: growerName,
                received_date: receivedDate === '' ? null : receivedDate,
                wet_nis_received_kg: wet,
                ffa: ffa,
                best_before_date: bestBefore === '' ? null : bestBefore
            }
        };
    }

    /** SweetAlert preConfirm adapter: shows the validation message, or hands back the payload. */
    function readForm(batch, suppliers) {
        var res = collectForm(batch, suppliers, DIALOG_PREFIX);
        if (res.error) {
            global.Swal.showValidationMessage(res.error);
            return false;
        }
        return res.value;
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
                preConfirm: function () { return readForm(batch, suppliers); }
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
        SUPPLIER_TYPES: SUPPLIER_TYPES,
        // Inline-editor building blocks (Find a batch → batch page). Same rules as the dialog.
        loadSuppliers: loadSuppliers,
        kernelIdFromBatch: kernelIdFromBatch,
        gridFormHtml: gridFormHtml,
        bindBatchNumberSuggestion: bindBatchNumberSuggestion,
        collectForm: collectForm
    };
})(typeof window !== 'undefined' ? window : this);
