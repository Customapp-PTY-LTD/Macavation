/**
 * Modal: New delivery (oil plant) - one delivery with its truck checks and its bags; each bag row
 * becomes a supplier intake batch. Edit: one batch's data is pre-filled for changes.
 * Oil kernel is picked as 'oil_kernel:crude' / 'oil_kernel:food_grade' and saved as product_type
 * oil_kernel plus intake_data.grade (Mike, 29 Oct 2026). Truck checks are required on every new load.
 */
var _modal_supplier_receiver_checklist = (function () {
    'use strict';

    var CONTAINER_ID = 'supplierReceiverChecklistModal';
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var _inited = false;
    var _editingBatchId = null;
    var _editingBatchStatus = null;
    /** Snapshot of grid batch while editing — preserves official FFA fields not on the form. */
    var _editingBatchSnapshot = null;

    function toISO(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return null;
        var s = String(dateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return null;
        var parts = s.split('/');
        return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
    }

    function fromISO(isoStr) {
        if (!isoStr) return '';
        var s = String(isoStr).trim().split('T')[0];
        var parts = s.split('-');
        if (parts.length !== 3) return s;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    /**
     * Shift an ISO date by months with day clamping (e.g. 31st -> last day of target month).
     */
    function shiftIsoDateByMonths(isoDate, monthDelta) {
        if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) return null;
        var parts = String(isoDate).split('-');
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        var d = parseInt(parts[2], 10);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;

        var monthIndex = (m - 1) + monthDelta;
        var targetYear = y + Math.floor(monthIndex / 12);
        var targetMonth = ((monthIndex % 12) + 12) % 12;
        var lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        var targetDay = Math.min(d, lastDay);
        var out = new Date(Date.UTC(targetYear, targetMonth, targetDay));
        return out.toISOString().split('T')[0];
    }

    function calculateBestBeforeIso(manufacturedIso) {
        return shiftIsoDateByMonths(manufacturedIso, 18);
    }

    function getEditManufacturedIso(batch) {
        if (!batch || typeof batch !== 'object') return null;
        var mfg = batch.manufactured_date ? String(batch.manufactured_date).split('T')[0] : null;
        if (mfg && /^\d{4}-\d{2}-\d{2}$/.test(mfg)) return mfg;
        var bb = batch.best_before_date ? String(batch.best_before_date).split('T')[0] : null;
        if (bb && /^\d{4}-\d{2}-\d{2}$/.test(bb)) return shiftIsoDateByMonths(bb, -18);
        return null;
    }

    function escapeHtml(t) {
        if (t == null) return '';
        return _common.escapeHtml(t);
    }

    function initFlatpickrInModal() {
        var container = document.getElementById(CONTAINER_ID);
        if (!container || typeof flatpickr === 'undefined') return;
        container.querySelectorAll('.flatpickr-date').forEach(function (el) {
            if (el && !el._flatpickr) flatpickr(el, FLATPICKR_DDMMYYYY);
        });
    }

    function ensureAtLeastOneRow() {
        if (typeof $ === 'undefined') return;
        var rows = $('#srcItemsTableBody tr');
        if (!rows.length) {
            api.addItemRow();
        }
    }

    function getSupplierDetailsText() {
        var el = document.getElementById('srcSupplierDetails');
        if (!el) return null;
        var opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
        return opt && opt.text ? opt.text : null;
    }

    function setRadio(name, value) {
        if (value == null || value === '') return;
        var s = String(value);
        var inputs = document.querySelectorAll('input[name="' + name + '"]');
        inputs.forEach(function (inp) { inp.checked = (inp.value === s); });
    }

    /** 'oil_kernel:food_grade' -> { product_type: 'oil_kernel', grade: 'food_grade' }. */
    function splitProductValue(v) {
        var parts = String(v || '').split(':');
        return { product_type: parts[0] || null, grade: parts[0] === 'oil_kernel' ? (parts[1] || null) : null };
    }

    /** Select value for a saved batch; ungraded oil kernel has no value, so the grade must be picked. */
    function productValueOf(batch) {
        if (!batch || !batch.product_type) return '';
        if (batch.product_type === 'oil_kernel') return batch.grade ? 'oil_kernel:' + batch.grade : '';
        return batch.product_type;
    }

    // Same checks as the nut-in-shell Receiving Checklist. key = stored intake_data key;
    // bad = the answer that needs "what was wrong and what action was taken?" (and may raise an alert,
    // see migrations/20261030090000_oil_intake_problem_alert.sql).
    var TRUCK_CHECKS = [
        { key: 'vehicle_clean', name: 'srcVehicleClean', label: 'Is the vehicle clean?', bad: 'No' },
        { key: 'vehicle_enclosed', name: 'srcVehicleEnclosed', label: 'Vehicle fully enclosed?', bad: 'No' },
        { key: 'hazard_substances', name: 'srcHazardSubstances', label: 'Any hazard substances noted on truck?', bad: 'Yes' },
        { key: 'pest_infestations', name: 'srcPestInfestations', label: 'Any signs of pest infestations?', bad: 'Yes' },
        { key: 'pallets_condition', name: 'srcPalletsCondition', label: 'Pallets received are in good condition', bad: 'No' },
        { key: 'raw_materials_condition', name: 'srcRawMaterialsCondition', label: 'Are raw materials received in good condition?', bad: 'No' }
    ];
    var PHOTO_FOLDER = 'Macavation/OilReceivingChecklist';

    // Typed comments and uploaded photos per check, kept while the answer flips Yes <-> No.
    var checkState = {};
    var pendingUploads = 0;

    function resetCheckState() {
        checkState = {};
        TRUCK_CHECKS.forEach(function (c) { checkState[c.key] = { comment: '', photos: [] }; });
        pendingUploads = 0;
    }
    resetCheckState();

    function norm(v) { return v == null ? '' : String(v).trim().toLowerCase(); }
    function answerOf(c) {
        var el = document.querySelector('input[name="' + c.name + '"]:checked');
        return el ? el.value : '';
    }
    function isBad(c) { return answerOf(c) !== '' && norm(answerOf(c)) === norm(c.bad); }

    function showMessage(lines) {
        var box = document.getElementById('srcChecklistMessage');
        if (!box) return;
        box.innerHTML = '';
        if (!lines || !lines.length) { box.classList.add('d-none'); return; }
        var head = document.createElement('div');
        head.className = 'fw-semibold mb-1';
        head.textContent = 'Please complete these before saving:';
        var ul = document.createElement('ul');
        ul.className = 'mb-0';
        lines.forEach(function (l) { var li = document.createElement('li'); li.textContent = l; ul.appendChild(li); });
        box.appendChild(head);
        box.appendChild(ul);
        box.classList.remove('d-none');
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function renderThumbs(c) {
        if (typeof $ === 'undefined') return;
        var $box = $('#' + c.name + 'Thumbs').empty();
        checkState[c.key].photos.forEach(function (p, idx) {
            var $wrap = $('<div class="position-relative">');
            var $inner;
            if (p.file_link) {
                $inner = $('<a target="_blank" rel="noopener noreferrer">').attr('href', p.file_link)
                    .append($('<img class="img-thumbnail" style="width:72px;height:72px;object-fit:cover;">').attr('src', p.file_link).attr('alt', p.name || 'photo'));
            } else {
                $inner = $('<span class="small text-muted">').text(p.name || 'photo');
            }
            var $rm = $('<button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0 p-0 src-check-photo-remove" style="width:20px;height:20px;line-height:1;" aria-label="Remove photo"><i class="fas fa-times"></i></button>')
                .attr('data-key', c.key).attr('data-idx', idx);
            $wrap.append($inner).append($rm).appendTo($box);
        });
    }

    function syncCheckVisibility(c) {
        var extra = document.getElementById(c.name + 'Extra');
        if (!extra) return;
        if (isBad(c)) {
            extra.classList.remove('d-none');
            var ta = document.getElementById(c.name + 'Comment');
            if (ta) ta.value = checkState[c.key].comment;
            renderThumbs(c);
        } else {
            extra.classList.add('d-none');
        }
    }

    function syncAllChecks() { TRUCK_CHECKS.forEach(syncCheckVisibility); }

    async function uploadCheckPhotos(c, files) {
        var err = document.getElementById(c.name + 'PhotoError');
        if (err) { err.classList.add('d-none'); err.textContent = ''; }
        var errors = [];
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var safeName = (file.name || 'photo').replace(/[^\w.-]/g, '_');
            var fileId = 'chk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + safeName;
            pendingUploads++;
            try {
                var res = (typeof _common !== 'undefined' && _common.uploadFile)
                    ? await _common.uploadFile({ file: file, resourceFolder: PHOTO_FOLDER, fileId: fileId })
                    : { Success: false, LastErrorDescription: 'Upload not available' };
                if (!res || !res.Success) {
                    errors.push((file.name || 'photo') + ': ' + ((res && res.LastErrorDescription) || 'Upload failed'));
                } else {
                    var data = res.Data;
                    checkState[c.key].photos.push({
                        file_id: (data && data[0] && (data[0].fileId || data[0].key)) || (data && data.fileId) || fileId,
                        file_link: (data && data[0] && data[0].fileLink) || (data && data.fileLink) || null,
                        name: file.name || safeName
                    });
                }
            } catch (e) {
                errors.push((file.name || 'photo') + ': ' + (e && e.message ? e.message : 'Upload failed'));
            } finally {
                pendingUploads--;
            }
        }
        renderThumbs(c);
        if (errors.length && err) { err.textContent = errors.join(' '); err.classList.remove('d-none'); }
    }

    /** Comments/photos are saved for bad answers only, same as the nut-in-shell checklist. */
    function collectCheckExtras() {
        var out = { item_comments: {}, item_photos: {} };
        TRUCK_CHECKS.forEach(function (c) {
            if (!isBad(c)) return;
            out.item_comments[c.key] = (checkState[c.key].comment || '').trim();
            out.item_photos[c.key] = checkState[c.key].photos.map(function (p) {
                return { file_id: p.file_id, file_link: p.file_link, name: p.name };
            });
        });
        return out;
    }

    function optionForProductType(selected) {
        var opts = [
            { v: '', l: 'Select product…' },
            { v: 'oil_kernel:crude', l: 'Oil kernel (crude grade)' },
            { v: 'oil_kernel:food_grade', l: 'Oil kernel (food grade)' },
            { v: 'cracker_dust', l: 'Cracker dust' },
            { v: 'kernel_dust', l: 'Kernel dust' },
            { v: 'crush', l: 'Crush' },
            { v: 'cake', l: 'Cake' }
        ];
        var h = '';
        opts.forEach(function (o) {
            var isSel = (selected && String(o.v) === String(selected));
            h += '<option value="' + escapeHtml(o.v) + '"' + (isSel ? ' selected' : '') + '>' + escapeHtml(o.l) + '</option>';
        });
        return h;
    }

    function escapeAttr(v) {
        if (v == null) return '';
        return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function nextSequentialBatch(baseBatch, step) {
        var raw = (baseBatch || '').trim();
        if (!raw) return '';
        var m = raw.match(/^(.*?)(\d+)$/);
        if (m) {
            var prefix = m[1];
            var n = parseInt(m[2], 10);
            if (!isNaN(n)) {
                var next = String(n + step);
                var width = m[2].length;
                if (next.length < width) next = next.padStart(width, '0');
                return prefix + next;
            }
        }
        return raw + '.' + String(step + 1);
    }

    /** New rows copy the LAST row's description, batch and date (never its weight), so adding twice keeps numbering batches on. */
    function readLastRowSeed() {
        if (typeof $ === 'undefined') return null;
        var $row = $('#srcItemsTableBody tr:last');
        if (!$row.length) return null;
        return {
            productType: ($row.find('[name="productType"]').val() || '').trim(),
            batch: ($row.find('[name="batch"]').val() || '').trim(),
            manufacturedDate: ($row.find('[name="manufacturedDate"]').val() || '').trim()
        };
    }

    /** Typed "Add [n] bag(s)" count; anything odd falls back to 1, capped at 500. */
    function readAddCount() {
        var el = document.getElementById('srcAddBagCount');
        var n = parseInt(el && el.value, 10);
        if (isNaN(n) || n <= 0) n = 1;
        if (n > 500) n = 500;
        if (el) el.value = '1';
        return n;
    }

    function fmtKg(v) {
        if (typeof _common !== 'undefined' && _common.formatKg) return _common.formatKg(v);
        return Number(v || 0).toFixed(2);
    }

    /** No. column and the weighed total / bag count footer, same as the NIS delivery. */
    function refreshBagTotals() {
        if (typeof $ === 'undefined') return;
        var total = 0;
        var count = 0;
        $('#srcItemsTableBody tr').each(function (i) {
            $(this).find('.srcBagNo').text(String(i + 1));
            var kg = parseFloat($(this).find('[name="quantity"]').val());
            if (!isNaN(kg) && kg > 0) { total += kg; count += 1; }
        });
        $('#srcBagCount').text(String(count));
        $('#srcBagTotal').text(fmtKg(total) || '0.00');
    }

    function readRows() {
        var items = [];
        if (typeof $ === 'undefined') return items;

        $('#srcItemsTableBody tr').each(function (i) {
            var $row = $(this);
            var productType = ($row.find('[name="productType"]').val() || '').trim();
            var batch = ($row.find('[name="batch"]').val() || '').trim();
            var qtyRaw = ($row.find('[name="quantity"]').val() || '').trim();
            var mfgRaw = ($row.find('[name="manufacturedDate"]').val() || '').trim();
            var manufacturedIso = mfgRaw ? (toISO(mfgRaw) || mfgRaw) : null;
            var bestBeforeIso = manufacturedIso ? calculateBestBeforeIso(manufacturedIso) : null;

            // A row with no weight is not a bag (spare rows from "+ Add"), same as the NIS delivery.
            var qty = qtyRaw ? parseFloat(qtyRaw) : NaN;
            if (isNaN(qty) || qty <= 0) return;

            var product = splitProductValue(productType);
            items.push({
                no: i + 1,
                product_type: product.product_type,
                grade: product.grade,
                batch_number: batch || null,
                quantity_kg: qty,
                manufactured_date: manufacturedIso,
                best_before_date: bestBeforeIso
            });
        });

        return items;
    }

    /**
     * Oil & Protein supplier intake: only CRM contacts used for oil-side supply chain.
     * Excludes kernel NIS growers (nis_supplier) and kernel customers (kernel_customer).
     * Matches CRM tabs: Suppliers, Oil Processors — not "NIS Suppliers".
     */
    var OIL_INTAKE_SUPPLIER_CONTACT_TYPES = ['supplier', 'both', 'oil_processor', 'oil_ingredient_supplier'];

    function filterContactsForOilIntake(contacts, selectedId) {
        if (!contacts || !Array.isArray(contacts)) return [];
        var allowed = function (c) {
            var t = (c.contact_type || '').trim();
            return OIL_INTAKE_SUPPLIER_CONTACT_TYPES.indexOf(t) >= 0;
        };
        var list = contacts.filter(allowed);
        if (selectedId) {
            var sel = contacts.find(function (c) { return String(c.id) === String(selectedId); });
            if (sel && !allowed(sel)) {
                list.push(sel);
            }
        }
        list.sort(function (a, b) {
            var na = (a.company_name || a.trading_name || a.primary_contact_name || '').toLowerCase();
            var nb = (b.company_name || b.trading_name || b.primary_contact_name || '').toLowerCase();
            return na.localeCompare(nb);
        });
        return list;
    }

    async function loadSuppliers(selectedId) {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return;
        try {
            var contacts = await dataFunctions.getContacts(null, true);
            var forDropdown = filterContactsForOilIntake(contacts, selectedId);
            var select = document.getElementById('srcSupplierDetails');
            if (!select) return;
            var html = '<option value="">Select supplier</option>';
            forDropdown.forEach(function (c) {
                var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                var sel = selectedId && String(c.id) === String(selectedId) ? ' selected' : '';
                html += '<option value="' + escapeHtml(c.id) + '"' + sel + '>' + escapeHtml(name) + '</option>';
            });
            select.innerHTML = html;
        } catch (e) {
            console.error('[Receiver checklist] Failed to load suppliers', e);
        }
    }

    function hideNewSupplierPanel() {
        var panel = document.getElementById('srcNewSupplierPanel');
        var err = document.getElementById('srcNewSupplierError');
        var addBtn = document.getElementById('srcAddSupplierBtn');
        if (panel) panel.style.display = 'none';
        if (err) { err.style.display = 'none'; err.textContent = ''; }
        if (addBtn) addBtn.setAttribute('aria-expanded', 'false');
    }

    function showNewSupplierPanel() {
        var panel = document.getElementById('srcNewSupplierPanel');
        var companyEl = document.getElementById('srcNewSupplierCompany');
        var personEl = document.getElementById('srcNewSupplierPerson');
        var typeEl = document.getElementById('srcNewSupplierContactType');
        var err = document.getElementById('srcNewSupplierError');
        if (companyEl) companyEl.value = '';
        if (personEl) personEl.value = '';
        if (typeEl) typeEl.value = 'supplier';
        if (err) { err.style.display = 'none'; err.textContent = ''; }
        if (panel) {
            panel.style.display = '';
            setTimeout(function () { if (companyEl) companyEl.focus(); }, 100);
        }
        var addBtn = document.getElementById('srcAddSupplierBtn');
        if (addBtn) addBtn.setAttribute('aria-expanded', 'true');
    }

    function extractNewContactId(res) {
        if (!res) return null;
        if (res.id) return res.id;
        if (res.contact_id) return res.contact_id;
        if (res.data && res.data.id) return res.data.id;
        if (Array.isArray(res.inserted_ids) && res.inserted_ids.length) return res.inserted_ids[0];
        if (res.result && res.result.id) return res.result.id;
        if (res.success !== false && res.p_id) return res.p_id;
        return null;
    }

    var api = {
        init: function () {
            if (_inited) return;
            _inited = true;
            if (typeof $ !== 'undefined') {
                $(document).off('click.srcAddItemRow', '#srcAddItemRow').on('click.srcAddItemRow', '#srcAddItemRow', function (e) {
                    e.preventDefault();
                    api.addItemRows(readAddCount());
                });
                $(document).off('keydown.srcAddBagCount', '#srcAddBagCount').on('keydown.srcAddBagCount', '#srcAddBagCount', function (e) {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    api.addItemRows(readAddCount());
                });
                $(document).off('input.srcBagQty', '#srcItemsTableBody [name="quantity"]').on('input.srcBagQty', '#srcItemsTableBody [name="quantity"]', function () {
                    refreshBagTotals();
                });
                TRUCK_CHECKS.forEach(function (c) {
                    $(document).off('change.srcCheck', '#' + CONTAINER_ID + ' input[name="' + c.name + '"]').on('change.srcCheck', '#' + CONTAINER_ID + ' input[name="' + c.name + '"]', function () { syncCheckVisibility(c); });
                    $(document).off('input.srcCheck', '#' + c.name + 'Comment').on('input.srcCheck', '#' + c.name + 'Comment', function () { checkState[c.key].comment = this.value; });
                    $(document).off('change.srcCheckPhoto', '#' + c.name + 'Photos').on('change.srcCheckPhoto', '#' + c.name + 'Photos', function () {
                        var files = Array.prototype.slice.call(this.files || []);
                        this.value = '';
                        if (files.length) uploadCheckPhotos(c, files);
                    });
                });
                $(document).off('click.srcCheckPhotoRm', '.src-check-photo-remove').on('click.srcCheckPhotoRm', '.src-check-photo-remove', function () {
                    var key = $(this).attr('data-key');
                    var idx = parseInt($(this).attr('data-idx'), 10);
                    var c = TRUCK_CHECKS.filter(function (x) { return x.key === key; })[0];
                    if (!c || !checkState[key]) return;
                    checkState[key].photos.splice(idx, 1);
                    renderThumbs(c);
                });
                $(document).off('click.srcCreateBatchesBtn', '#srcCreateBatchesBtn').on('click.srcCreateBatchesBtn', '#srcCreateBatchesBtn', function (e) {
                    e.preventDefault();
                    api.createBatches();
                });
                $(document).off('click.srcAddSupplierBtn', '#srcAddSupplierBtn').on('click.srcAddSupplierBtn', '#srcAddSupplierBtn', function (e) {
                    e.preventDefault();
                    var panel = document.getElementById('srcNewSupplierPanel');
                    if (panel && panel.style.display === 'none') showNewSupplierPanel();
                    else hideNewSupplierPanel();
                });
                $(document).off('click.srcNewSupplierSaveBtn', '#srcNewSupplierSaveBtn').on('click.srcNewSupplierSaveBtn', '#srcNewSupplierSaveBtn', function (e) {
                    e.preventDefault();
                    api.saveNewSupplier();
                });
                $(document).off('click.srcNewSupplierCancelBtn', '#srcNewSupplierCancelBtn').on('click.srcNewSupplierCancelBtn', '#srcNewSupplierCancelBtn', function (e) {
                    e.preventDefault();
                    hideNewSupplierPanel();
                });
                $(document).off('click.srcRemoveItemRow', '.srcRemoveItemRow').on('click.srcRemoveItemRow', '.srcRemoveItemRow', function (e) {
                    e.preventDefault();
                    $(this).closest('tr').remove();
                    ensureAtLeastOneRow();
                    refreshBagTotals();
                });
                $(document).off('shown.bs.modal.srcSupplierReceiver', '#' + CONTAINER_ID).on('shown.bs.modal.srcSupplierReceiver', '#' + CONTAINER_ID, function () {
                    initFlatpickrInModal();
                });
                $(document).off('hidden.bs.modal.srcSupplierReceiver', '#' + CONTAINER_ID).on('hidden.bs.modal.srcSupplierReceiver', '#' + CONTAINER_ID, function () {
                    api.clearForm();
                });
            }
        },

        show: async function (editingBatch) {
            api.clearForm(false);
            if (editingBatch && editingBatch.id) {
                _editingBatchId = editingBatch.id;
                _editingBatchStatus = editingBatch.status || null;
                _editingBatchSnapshot = editingBatch;
            } else {
                _editingBatchId = null;
                _editingBatchStatus = null;
                _editingBatchSnapshot = null;
            }
            hideNewSupplierPanel();

            var titleEl = document.getElementById('supplierReceiverChecklistModalLabel');
            var addBagBtn = document.getElementById('srcAddBagsWrap');
            var saveBtn = document.getElementById('srcCreateBatchesBtn');

            if (_editingBatchId && editingBatch) {
                if (titleEl) titleEl.textContent = 'Edit batch';
                if (addBagBtn) addBagBtn.style.display = 'none';
                if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save changes';

                var dateEl = document.getElementById('srcDateReceived');
                var noteEl = document.getElementById('srcDeliveryNoteRef');
                var commentsEl = document.getElementById('srcReceivingComments');
                if (dateEl) dateEl.value = editingBatch.date_received ? fromISO(String(editingBatch.date_received).split('T')[0]) : '';
                if (noteEl) noteEl.value = (editingBatch.delivery_note_ref || '').toString();
                if (commentsEl) commentsEl.value = (editingBatch.receiving_comments || '').toString();

                setRadio('srcVehicleClean', editingBatch.vehicle_clean);
                setRadio('srcVehicleEnclosed', editingBatch.vehicle_enclosed);
                setRadio('srcHazardSubstances', editingBatch.hazard_substances);
                setRadio('srcPestInfestations', editingBatch.pest_infestations);
                setRadio('srcPalletsCondition', editingBatch.pallets_condition);
                setRadio('srcRawMaterialsCondition', editingBatch.raw_materials_condition);
                var savedComments = editingBatch.item_comments || {};
                var savedPhotos = editingBatch.item_photos || {};
                TRUCK_CHECKS.forEach(function (c) {
                    checkState[c.key].comment = savedComments[c.key] || '';
                    checkState[c.key].photos = Array.isArray(savedPhotos[c.key]) ? savedPhotos[c.key].slice() : [];
                });
                syncAllChecks();

                await loadSuppliers(editingBatch.supplier_id || null);

                if (typeof $ !== 'undefined') {
                    var editManufacturedIso = getEditManufacturedIso(editingBatch);
                    $('#srcItemsTableBody tr').remove();
                    api.addItemRow({
                        productType: productValueOf(editingBatch),
                        batch: (editingBatch.batch_number || '').toString(),
                        quantity: editingBatch.quantity_kg != null ? String(editingBatch.quantity_kg) : '',
                        manufacturedDate: editManufacturedIso ? fromISO(editManufacturedIso) : ''
                    });
                    initFlatpickrInModal();
                }
            } else {
                if (titleEl) titleEl.textContent = 'New delivery';
                if (addBagBtn) addBagBtn.style.display = '';
                if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save delivery';

                var todayISO = new Date().toISOString().split('T')[0];
                var dateEl = document.getElementById('srcDateReceived');
                if (dateEl) dateEl.value = fromISO(todayISO);
                await loadSuppliers(null);
                ensureAtLeastOneRow();
            }

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        clearForm: function (resetRows) {
            resetRows = resetRows !== false;
            if (resetRows) {
                _editingBatchId = null;
                _editingBatchStatus = null;
                _editingBatchSnapshot = null;
            }
            hideNewSupplierPanel();
            var form = document.getElementById('supplierReceiverChecklistForm');
            if (form) form.reset();
            if (typeof $ !== 'undefined' && resetRows) {
                $('#srcItemsTableBody tr').remove();
            }
            var titleEl = document.getElementById('supplierReceiverChecklistModalLabel');
            var addBagBtn = document.getElementById('srcAddBagsWrap');
            var saveBtn = document.getElementById('srcCreateBatchesBtn');
            if (titleEl) titleEl.textContent = 'New delivery';
            if (addBagBtn) addBagBtn.style.display = '';
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save delivery';
            if (resetRows && typeof $ !== 'undefined') ensureAtLeastOneRow();
            refreshBagTotals();
            resetCheckState();
            TRUCK_CHECKS.forEach(function (c) {
                var thumbs = document.getElementById(c.name + 'Thumbs');
                if (thumbs) thumbs.innerHTML = '';
                var perr = document.getElementById(c.name + 'PhotoError');
                if (perr) { perr.classList.add('d-none'); perr.textContent = ''; }
            });
            syncAllChecks();
            showMessage(null);
        },

        saveNewSupplier: async function () {
            var companyEl = document.getElementById('srcNewSupplierCompany');
            var personEl = document.getElementById('srcNewSupplierPerson');
            var typeEl = document.getElementById('srcNewSupplierContactType');
            var errEl = document.getElementById('srcNewSupplierError');
            var company = companyEl && companyEl.value ? companyEl.value.trim() : '';
            if (!company) {
                if (errEl) { errEl.textContent = 'Enter a company name.'; errEl.style.display = ''; }
                if (companyEl) companyEl.focus();
                return;
            }
            var contactType = (typeEl && typeEl.value) ? typeEl.value.trim() : 'supplier';
            if (OIL_INTAKE_SUPPLIER_CONTACT_TYPES.indexOf(contactType) < 0) contactType = 'supplier';

            if (typeof dataFunctions === 'undefined' || !dataFunctions.createContact) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Cannot create contacts. Refresh the page.', 'error');
                return;
            }

            var saveBtn = document.getElementById('srcNewSupplierSaveBtn');
            if (saveBtn) saveBtn.disabled = true;
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

            try {
                var payload = {
                    contact_type: contactType,
                    company_name: company,
                    primary_contact_name: (personEl && personEl.value) ? personEl.value.trim() : null,
                    status: 'active'
                };
                var res = await dataFunctions.createContact(payload);
                if (res && res.success === false) {
                    throw new Error(res.error || res.message || 'Could not create contact');
                }
                var newId = extractNewContactId(res);
                if (!newId) {
                    throw new Error((res && (res.error || res.message)) || 'No id returned from server');
                }
                hideNewSupplierPanel();
                await loadSuppliers(newId);
                var sel = document.getElementById('srcSupplierDetails');
                if (sel) sel.value = String(newId);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'success', title: 'Supplier added', text: company, timer: 1800, showConfirmButton: false });
                }
            } catch (err) {
                console.error('[Receiver checklist] saveNewSupplier', err);
                var msg = (err && err.message) ? err.message : String(err);
                if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
                else if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
            } finally {
                if (saveBtn) saveBtn.disabled = false;
            }
        },

        addItemRow: function (seed) {
            if (typeof $ === 'undefined') return;
            seed = seed || {};
            var row = '<tr>' +
                '<td><strong class="srcBagNo"></strong></td>' +
                '<td><select class="form-select form-select-sm" name="productType" required aria-label="Description">' +
                optionForProductType(seed.productType || '') +
                '</select></td>' +
                '<td><input type="text" class="form-control form-control-sm" name="batch" required placeholder="e.g. OIL-2026-03-001" value="' + escapeAttr(seed.batch || '') + '"></td>' +
                '<td><input type="number" class="form-control form-control-sm text-end" name="quantity" step="0.01" min="0.01" required value="' + escapeAttr(seed.quantity || '') + '"></td>' +
                '<td><input type="text" class="form-control form-control-sm flatpickr-date" name="manufacturedDate" placeholder="dd/mm/yyyy" required value="' + escapeAttr(seed.manufacturedDate || '') + '"></td>' +
                '<td>' + (_editingBatchId ? '' : '<button type="button" class="btn btn-sm btn-outline-secondary srcRemoveItemRow" title="Remove" aria-label="Remove bag">✕</button>') + '</td>' +
                '</tr>';
            var $row = $(row);
            $('#srcItemsTableBody').append($row);
            $row.find('.flatpickr-date').each(function () {
                if (typeof flatpickr !== 'undefined' && !this._flatpickr) flatpickr(this, FLATPICKR_DDMMYYYY);
            });
            refreshBagTotals();
            return $row;
        },

        addItemRows: function (count) {
            if (typeof $ === 'undefined' || !count || count <= 0) return;
            var seed = readLastRowSeed() || {};
            var $first = null;
            for (var i = 1; i <= count; i++) {
                var $row = api.addItemRow({
                    productType: seed.productType || '',
                    batch: nextSequentialBatch(seed.batch || '', i),
                    // Weight starts blank like the NIS delivery: a copied weight was counted as weighed.
                    manufacturedDate: seed.manufacturedDate || ''
                });
                if (!$first) $first = $row;
            }
            if ($first) $first.find('[name="quantity"]').trigger('focus');
        },

        createBatches: async function () {
            var dateReceivedRaw = (document.getElementById('srcDateReceived') && document.getElementById('srcDateReceived').value) || null;
            var dateReceived = dateReceivedRaw ? (toISO(dateReceivedRaw) || dateReceivedRaw) : null;
            var deliveryNoteRef = (document.getElementById('srcDeliveryNoteRef') && document.getElementById('srcDeliveryNoteRef').value) || null;
            var supplierId = (document.getElementById('srcSupplierDetails') && document.getElementById('srcSupplierDetails').value) || null;
            var supplierDetails = getSupplierDetailsText();

            var vehicle_clean = (document.querySelector('input[name="srcVehicleClean"]:checked') && document.querySelector('input[name="srcVehicleClean"]:checked').value) || null;
            var vehicle_enclosed = (document.querySelector('input[name="srcVehicleEnclosed"]:checked') && document.querySelector('input[name="srcVehicleEnclosed"]:checked').value) || null;
            var hazard_substances = (document.querySelector('input[name="srcHazardSubstances"]:checked') && document.querySelector('input[name="srcHazardSubstances"]:checked').value) || null;
            var pest_infestations = (document.querySelector('input[name="srcPestInfestations"]:checked') && document.querySelector('input[name="srcPestInfestations"]:checked').value) || null;
            var pallets_condition = (document.querySelector('input[name="srcPalletsCondition"]:checked') && document.querySelector('input[name="srcPalletsCondition"]:checked').value) || null;
            var raw_materials_condition = (document.querySelector('input[name="srcRawMaterialsCondition"]:checked') && document.querySelector('input[name="srcRawMaterialsCondition"]:checked').value) || null;
            var receiving_comments = (document.getElementById('srcReceivingComments') && document.getElementById('srcReceivingComments').value) || null;

            var rows = readRows();

            // Every problem in one list inside the form, like the nut-in-shell Receiving Checklist.
            var missing = [];
            if (!dateReceived) missing.push('Enter the date received');
            if (!deliveryNoteRef || !String(deliveryNoteRef).trim()) missing.push('Enter the delivery note / PO number');
            if (!supplierId) missing.push('Choose the supplier');
            if (!_editingBatchId) {
                TRUCK_CHECKS.forEach(function (c) { if (!answerOf(c)) missing.push('Answer "' + c.label + '"'); });
            }
            TRUCK_CHECKS.forEach(function (c) {
                if (isBad(c) && !(checkState[c.key].comment || '').trim()) missing.push('Say what was wrong and what action was taken for "' + c.label + '"');
            });
            if (!rows.length) missing.push('Enter the weight of at least one bag');
            rows.forEach(function (r) {
                var label = 'Bag ' + r.no;
                if (!r.product_type) missing.push(label + ': choose a description');
                if (!r.batch_number) missing.push(label + ': enter a batch number');
                if (!r.manufactured_date) missing.push(label + ': enter a manufactured date (best before is worked out as +18 months)');
            });
            if (pendingUploads > 0) missing.push('Wait for the photo uploads to finish');
            if (missing.length) { showMessage(missing); return; }
            showMessage(null);

            var checkExtras = collectCheckExtras();

            var createBtn = document.getElementById('srcCreateBatchesBtn');
            if (createBtn) createBtn.disabled = true;

            try {
                if (_editingBatchId) {
                    if (typeof dataFunctions === 'undefined' || !dataFunctions.updateSupplierIntakeBatch) {
                        if (typeof Swal !== 'undefined') Swal.fire('Error', 'Update function not available. Please refresh.', 'error');
                        return;
                    }
                    var r = rows[0];
                    var payload = {
                        batch_number: r.batch_number,
                        date_received: dateReceived,
                        delivery_note_ref: deliveryNoteRef,
                        supplier_id: supplierId,
                        supplier_details: supplierDetails,
                        product_type: r.product_type,
                        grade: r.grade,
                        quantity_kg: r.quantity_kg,
                        manufactured_date: r.manufactured_date,
                        best_before_date: r.best_before_date,
                        // Reference is no longer on the form; keep whatever an older batch already had.
                        reference: (_editingBatchSnapshot && _editingBatchSnapshot.reference) || null,
                        delivery_group_id: (_editingBatchSnapshot && _editingBatchSnapshot.delivery_group_id) || null,
                        item_comments: checkExtras.item_comments,
                        item_photos: checkExtras.item_photos,
                        description: null,
                        vehicle_clean: vehicle_clean,
                        vehicle_enclosed: vehicle_enclosed,
                        hazard_substances: hazard_substances,
                        pest_infestations: pest_infestations,
                        pallets_condition: pallets_condition,
                        raw_materials_condition: raw_materials_condition,
                        receiving_comments: receiving_comments,
                        status: _editingBatchStatus || 'awaiting_test'
                    };
                    if (_editingBatchSnapshot && _editingBatchSnapshot.official_ffa != null && _editingBatchSnapshot.official_ffa !== '') {
                        payload.official_ffa = _editingBatchSnapshot.official_ffa;
                        payload.ffa = _editingBatchSnapshot.official_ffa;
                    }
                    if (_editingBatchSnapshot && _editingBatchSnapshot.supplier_intake_official_ffa_at) {
                        payload.supplier_intake_official_ffa_at = _editingBatchSnapshot.supplier_intake_official_ffa_at;
                    }
                    var res = await dataFunctions.updateSupplierIntakeBatch(_editingBatchId, payload);
                    if (res && res.success === false) {
                        throw new Error(res.error || res.message || 'Failed to update batch');
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Batch updated.', timer: 2500, showConfirmButton: false });
                } else {
                    if (typeof dataFunctions === 'undefined' || !dataFunctions.createSupplierIntakeBatch) {
                        if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create function not available. Please refresh.', 'error');
                        return;
                    }
                    var deliveryGroupId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (function () { var d = new Date().getTime(); return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = (d + Math.random() * 16) % 16 | 0; d = Math.floor(d / 16); return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }); })();
                    var created = 0;
                    for (var i = 0; i < rows.length; i++) {
                        var r = rows[i];
                        var payload = {
                            status: 'awaiting_test',
                            delivery_group_id: deliveryGroupId,
                            batch_number: r.batch_number,
                            date_received: dateReceived,
                            delivery_note_ref: deliveryNoteRef,
                            supplier_id: supplierId,
                            supplier_details: supplierDetails,
                            product_type: r.product_type,
                            grade: r.grade,
                            quantity_kg: r.quantity_kg,
                            manufactured_date: r.manufactured_date,
                            best_before_date: r.best_before_date,
                            reference: null,
                            item_comments: checkExtras.item_comments,
                            item_photos: checkExtras.item_photos,
                            description: null,
                            vehicle_clean: vehicle_clean,
                            vehicle_enclosed: vehicle_enclosed,
                            hazard_substances: hazard_substances,
                            pest_infestations: pest_infestations,
                            pallets_condition: pallets_condition,
                            raw_materials_condition: raw_materials_condition,
                            receiving_comments: receiving_comments
                        };
                        var res = await dataFunctions.createSupplierIntakeBatch(payload);
                        if (res && res.success === false) {
                            throw new Error(res.error || res.message || 'Failed to create batch');
                        }
                        created++;
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Created', text: 'Delivery saved: ' + created + ' bag' + (created === 1 ? '' : 's') + ' moved to Awaiting tests.', timer: 2500, showConfirmButton: false });
                }

                var modalEl = document.getElementById(CONTAINER_ID);
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('hide');

                if (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.loadBatches) {
                    await _supplierIntakeGrid.loadBatches(true);
                }
            } catch (e) {
                console.error('[Receiver checklist] save failed', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save.', 'error');
            } finally {
                if (createBtn) createBtn.disabled = false;
                _editingBatchId = null;
                _editingBatchSnapshot = null;
            }
        }
    };

    return api;
})();

_modal_supplier_receiver_checklist.init();

