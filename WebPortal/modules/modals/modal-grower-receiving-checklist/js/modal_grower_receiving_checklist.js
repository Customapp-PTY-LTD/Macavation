/**
 * Modal: Grower Intake Receiving Checklist (with batch linking).
 * Parent calls show(batchId). Uses container id: growerReceivingChecklistModal.
 * Six Yes/No checks; a "bad" answer reveals a required comment and optional photos.
 * Bag weights, delivery note and removed pre-sizer live on New Delivery / Release, not here.
 */
var _modal_grower_receiving_checklist = (function () {
    'use strict';

    var CONTAINER_ID = 'growerReceivingChecklistModal';
    var PHOTO_FOLDER = 'Macavation/ReceivingChecklist';

    // key = stored JSON key; name = radio group name; bad = the answer that needs a comment.
    var CHECKS = [
        { key: 'vehicle_clean',           name: 'growerVehicleClean',          q: 'Is the vehicle clean?',                         bad: 'No' },
        { key: 'vehicle_enclosed',        name: 'growerVehicleEnclosed',       q: 'Vehicle fully enclosed?',                       bad: 'No' },
        { key: 'hazard_substances',       name: 'growerHazardSubstances',      q: 'Any hazard substances noted on truck?',         bad: 'Yes' },
        { key: 'pest_infestations',       name: 'growerPestInfestations',      q: 'Any signs of pest infestations?',               bad: 'Yes' },
        { key: 'pallets_condition',       name: 'growerPalletsCondition',      q: 'Pallets received are in good condition',        bad: 'No' },
        { key: 'raw_materials_condition', name: 'growerRawMaterialsCondition', q: 'Are raw materials received in good condition?', bad: 'No' }
    ];

    // In-memory state so typed text / photos survive toggling Yes <-> No.
    var state = {};
    var pendingUploads = 0;

    function resetState() {
        state = {};
        CHECKS.forEach(function (c) { state[c.key] = { comment: '', photos: [] }; });
        pendingUploads = 0;
    }
    resetState();

    function norm(v) { return v == null ? '' : String(v).trim().toLowerCase(); }
    function answerOf(c) { return $('input[name="' + c.name + '"]:checked').val() || ''; }
    function isBad(c) { return norm(answerOf(c)) === norm(c.bad); }

    function showMessage(lines) {
        var $m = $('#growerChecklistMessage');
        if (!lines || !lines.length) { $m.addClass('d-none').empty(); return; }
        $m.empty().removeClass('d-none');
        $('<div class="fw-semibold mb-1">').text('Please complete the checklist before saving:').appendTo($m);
        var $ul = $('<ul class="mb-0">').appendTo($m);
        lines.forEach(function (l) { $('<li>').text(l).appendTo($ul); });
    }

    function renderThumbs(c) {
        var $box = $('#' + c.name + 'Thumbs').empty();
        state[c.key].photos.forEach(function (p, idx) {
            var $wrap = $('<div class="position-relative">');
            var $inner;
            if (p.file_link) {
                $inner = $('<a target="_blank" rel="noopener noreferrer">').attr('href', p.file_link)
                    .append($('<img class="img-thumbnail" style="width:72px;height:72px;object-fit:cover;">').attr('src', p.file_link).attr('alt', p.name || 'photo'));
            } else {
                $inner = $('<span class="small text-muted">').text(p.name || 'photo');
            }
            var $rm = $('<button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0 p-0 grower-check-photo-remove" style="width:20px;height:20px;line-height:1;" aria-label="Remove photo"><i class="fas fa-times"></i></button>')
                .attr('data-key', c.key).attr('data-idx', idx);
            $wrap.append($inner).append($rm).appendTo($box);
        });
    }

    function syncVisibility(c) {
        var $extra = $('#' + c.name + 'Extra');
        if (isBad(c)) {
            $extra.removeClass('d-none');
            $('#' + c.name + 'Comment').val(state[c.key].comment);
            renderThumbs(c);
        } else {
            $extra.addClass('d-none');
        }
    }

    function syncAll() { CHECKS.forEach(syncVisibility); }

    async function uploadPhotos(c, files) {
        var $err = $('#' + c.name + 'PhotoError').addClass('d-none').text('');
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
                    state[c.key].photos.push({
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
        if (errors.length) $err.text(errors.join(' ')).removeClass('d-none');
    }

    return {
        init: () => {
            const scope = _modal_grower_receiving_checklist;
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_grower_receiving_checklist;
            var saveBtn = document.getElementById('growerSaveReceivingChecklistBtn');
            // init() runs more than once per page; bind Save once per button or one click saves twice.
            if (saveBtn && saveBtn.getAttribute('data-kp-bound') !== '1') {
                saveBtn.setAttribute('data-kp-bound', '1');
                saveBtn.addEventListener('click', (e) => { e.preventDefault(); scope.save(); });
            }

            $(document).off('.kp2ck'); // init() can run more than once; never stack these handlers
            CHECKS.forEach(function (c) {
                $(document).on('change.kp2ck', '#' + CONTAINER_ID + ' input[name="' + c.name + '"]', function () { syncVisibility(c); });
                $(document).on('input.kp2ck', '#' + c.name + 'Comment', function () { state[c.key].comment = this.value; });
                $(document).on('change.kp2ck', '#' + c.name + 'Photos', function () {
                    var files = Array.prototype.slice.call(this.files || []);
                    this.value = '';
                    if (files.length) uploadPhotos(c, files);
                });
            });
            $(document).on('click.kp2ck', '.grower-check-photo-remove', function () {
                var key = $(this).attr('data-key');
                var idx = parseInt($(this).attr('data-idx'), 10);
                var c = CHECKS.filter(function (x) { return x.key === key; })[0];
                if (!c || !state[key]) return;
                state[key].photos.splice(idx, 1);
                renderThumbs(c);
            });

            var container = document.getElementById(CONTAINER_ID);
            if (container && typeof $ !== 'undefined') {
                $(container).on('hidden.bs.modal', () => scope.clearForm());
            }
        },

        show: async (batchId, checklistId) => {
            const scope = _modal_grower_receiving_checklist;
            var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');

            var labelEl = document.getElementById('growerReceivingChecklistModalLabel');
            if (labelEl) labelEl.textContent = 'Receiving Checklist';

            scope.clearForm();
            if (batchIdEl) batchIdEl.value = batchId || '';

            var supplierIdEl = document.getElementById('growerReceivingChecklistSupplierId');

            // Load kernel record to get supplier + any existing checklist data
            if (batchId && typeof dataFunctions !== 'undefined' && dataFunctions.getKernelBatchDetail) {
                try {
                    var kernelDetail = await dataFunctions.getKernelBatchDetail(batchId);
                    var kd = kernelDetail && (kernelDetail.data || kernelDetail);
                    if (kd && kd.supplier_id && supplierIdEl) supplierIdEl.value = kd.supplier_id;
                    var existingChecklist = kd && kd.intake_data && kd.intake_data.receiving_checklist;
                    if (existingChecklist && existingChecklist.completed_at) {
                        scope.loadIntoForm({ checklist: existingChecklist });
                    }
                } catch (err) {
                    console.error('Error loading kernel detail for checklist:', err);
                }
            }

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        loadIntoForm: (payload) => {
            if (typeof $ === 'undefined' || !payload) return;
            var checklist = payload.checklist || payload;
            if (!checklist) return;

            document.getElementById('growerReceivingId').value = checklist.id || '';
            var supplierIdEl = document.getElementById('growerReceivingChecklistSupplierId');
            if (supplierIdEl && checklist.supplier_id) supplierIdEl.value = checklist.supplier_id;
            var itemComments = checklist.item_comments || {};
            var itemPhotos = checklist.item_photos || {};
            CHECKS.forEach(function (c) {
                var val = checklist[c.key] || '';
                // Match case-insensitively so legacy 'yes'/'no' values still restore.
                $('input[name="' + c.name + '"]').each(function () {
                    this.checked = val !== '' && norm(this.value) === norm(val);
                });
                state[c.key].comment = itemComments[c.key] || '';
                state[c.key].photos = Array.isArray(itemPhotos[c.key]) ? itemPhotos[c.key].slice() : [];
            });
            document.getElementById('growerReceivingComments').value = checklist.comments || '';
            syncAll();
        },

        clearForm: () => {
            if (typeof $ === 'undefined') return;
            var form = document.getElementById('growerReceivingChecklistForm');
            if (form) form.reset();
            document.getElementById('growerReceivingId').value = '';
            var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');
            if (batchIdEl) batchIdEl.value = '';
            var supplierIdEl = document.getElementById('growerReceivingChecklistSupplierId');
            if (supplierIdEl) supplierIdEl.value = '';
            resetState();
            CHECKS.forEach(function (c) {
                $('#' + c.name + 'Thumbs').empty();
                $('#' + c.name + 'PhotoError').addClass('d-none').text('');
            });
            syncAll();
            showMessage(null);
        },

        hide: () => {
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') {
                var inst = bootstrap.Modal.getInstance(modalEl);
                if (inst) inst.hide();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#' + CONTAINER_ID).modal('hide');
            }
        },

        /**
         * Every item answered; every bad answer needs a comment.
         * Returns { valid, missing: [string] }.
         */
        validateBeforeSave: () => {
            if (typeof $ === 'undefined') return { valid: true, missing: [] };
            var missing = [];
            CHECKS.forEach(function (c) {
                if (!answerOf(c)) missing.push('Answer "' + c.q + '"');
            });
            CHECKS.forEach(function (c) {
                if (answerOf(c) && isBad(c) && !(state[c.key].comment || '').trim()) {
                    missing.push('Add a comment for "' + c.q + '"');
                }
            });
            return { valid: missing.length === 0, missing: missing };
        },

        save: async () => {
            const scope = _modal_grower_receiving_checklist;
            try {
                if (typeof dataFunctions === 'undefined') return;

                var validation = scope.validateBeforeSave();
                if (!validation.valid) { showMessage(validation.missing); return; }
                if (pendingUploads > 0) { showMessage(['Wait for the photo uploads to finish']); return; }
                showMessage(null);

                var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');
                var kernelId = batchIdEl && batchIdEl.value ? batchIdEl.value.trim() : null;
                if (!kernelId) throw new Error('No kernel record linked — cannot save checklist');
                var supplierIdVal = $('#growerReceivingChecklistSupplierId').val();

                // Comments/photos are sent for bad answers only.
                // received_items / date_received / delivery_note_ref / removed_pre_sizer_kg are deliberately
                // omitted: the RPC merges and keeps what New Delivery / Release stored.
                var req = {
                    kernel_id:     kernelId,
                    supplier_id:   supplierIdVal || null,
                    comments:      $('#growerReceivingComments').val() || null,
                    item_comments: {},
                    item_photos:   {}
                };
                CHECKS.forEach(function (c) {
                    req[c.key] = answerOf(c) || null;
                    if (isBad(c)) {
                        req.item_comments[c.key] = state[c.key].comment.trim();
                        req.item_photos[c.key] = state[c.key].photos.map(function (p) {
                            return { file_id: p.file_id, file_link: p.file_link, name: p.name };
                        });
                    }
                });

                var result = await dataFunctions.upsertKernelChecklist(req);

                if (result && result.success !== false) {
                    if (batchIdEl) batchIdEl.value = '';
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Receiving checklist saved.', timer: 2000, showConfirmButton: false });
                    if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.loadIntakeBatches) await _growerIntakeGrid.loadIntakeBatches(true);
                    scope.hide();
                } else {
                    throw new Error((result && (result.error || result.message)) || 'Failed to save');
                }
            } catch (error) {
                console.error('Error saving receiving checklist:', error);
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save: ' + (error.message || error) });
            }
        }
    };
})();
_modal_grower_receiving_checklist.init();
