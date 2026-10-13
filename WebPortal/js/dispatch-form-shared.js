/**
 * Shared pieces for the Kernel and Oil "Inspection of Vehicle & Dispatch" forms.
 *
 *   var ctx = DispatchFormShared.create({ prefix: 'kernelDsp', folder: 'Macavation/KernelDispatch' });
 *
 * One ctx per form. It owns: the six vehicle-inspection checks (answers, reveal comment + photos,
 * validation), the transport-company select with inline add, the sender's signature pad, the
 * attachments widget, and the customer-contact prefill. Every widget lives in elements whose ids are
 * `<prefix><Suffix>` - the form HTML supplies the empty containers, this file fills them.
 *
 * Security: all DB / user text goes through .text() / .val(); links are only ever set with
 * .attr('href', url) and only when the url starts with https://. No .html() with data.
 */
(function (w) {
    'use strict';

    var MAX_FILE_BYTES = 6 * 1024 * 1024;
    var LEGACY_OPTION = '__legacy__';
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    /** key = record key without "_yn". bad = the answer that needs a comment. col = layout column. */
    var CHECKS = [
        { key: 'vehicle_clean', q: 'Is the vehicle clean?', bad: 'No', col: 0 },
        { key: 'vehicle_enclosed', q: 'Vehicle fully enclosed?', bad: 'No', col: 0 },
        { key: 'hazard_substances', q: 'Any hazard substances noted on truck?', bad: 'Yes', col: 0 },
        { key: 'pest_infestations', q: 'Any signs of pest infestations?', bad: 'Yes', col: 1 },
        { key: 'pallets_condition', q: 'Pallets loaded are in good condition and identified', bad: 'No', col: 1 },
        { key: 'truck_bin_locked', q: 'Truck bin locked before departing?', bad: 'No', col: 1 }
    ];

    /** "1 Carton" / "N Cartons". */
    function cartonLabel(n) {
        var num = Number(n);
        return (num === 1 ? '1 Carton' : (isNaN(num) ? String(n) : num) + ' Cartons');
    }

    function isHttps(u) { return typeof u === 'string' && u.indexOf('https://') === 0; }

    function parseObj(v) {
        if (v == null) return {};
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return {}; } }
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }
    function parseArr(v) {
        if (v == null) return [];
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return []; } }
        return Array.isArray(v) ? v : [];
    }

    function cleanFile(f) {
        return { file_id: f.file_id || null, file_link: f.file_link || null, name: f.name || 'file' };
    }

    function fileAllowed(file) {
        var t = (file.type || '').toLowerCase();
        if (t.indexOf('image/') === 0 || t === 'application/pdf') return true;
        return !t && /\.pdf$/i.test(file.name || '');
    }

    async function uploadOne(file, folder, tag) {
        var safeName = (file.name || 'file').replace(/[^\w.-]/g, '_');
        var fileId = tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + safeName;
        var res = (typeof _common !== 'undefined' && _common.uploadFile)
            ? await _common.uploadFile({ file: file, resourceFolder: folder, fileId: fileId })
            : { Success: false, LastErrorDescription: 'Upload not available' };
        if (!res || !res.Success) throw new Error((res && res.LastErrorDescription) || 'Upload failed');
        var data = res.Data;
        return {
            file_id: (data && data[0] && (data[0].fileId || data[0].key)) || (data && data.fileId) || fileId,
            file_link: (data && data[0] && data[0].fileLink) || (data && data.fileLink) || null,
            name: file.name || safeName
        };
    }

    /** Renders a list of {name,file_link} into $el; optional remove callback(index). */
    function renderFileList($el, files, canRemove, onRemove) {
        $el.empty();
        files.forEach(function (f, i) {
            var $row = $('<div class="d-flex align-items-center gap-2 small mb-1"></div>');
            var $name;
            if (isHttps(f.file_link)) {
                $name = $('<a></a>').attr('href', f.file_link).attr('target', '_blank').attr('rel', 'noopener').text(f.name || 'file');
            } else {
                $name = $('<span></span>').text(f.name || 'file');
            }
            $row.append($name);
            if (canRemove) {
                $row.append($('<button type="button" class="btn btn-link btn-sm text-danger p-0 text-decoration-none">Remove</button>')
                    .attr('aria-label', 'Remove ' + (f.name || 'file'))
                    .on('click', function () { onRemove(i); }));
            }
            $el.append($row);
        });
    }

    function create(opts) {
        var P = opts.prefix;
        var FOLDER = opts.folder;
        function $id(suffix) { return $('#' + P + suffix); }

        var state = {};            // check key -> { comment, photos[] }
        var attachments = [];
        var pending = 0;
        var generation = 0;        // bumped by reset(); an upload that finishes after a reset is dropped (it belongs to the previous order)
        var readOnly = false;
        var transporters = [];
        var configLoaded = false;
        var desiredTransport = { name: '', id: null };
        var pad = null;
        var sigValue = '';         // PNG data URL to show once the pad exists
        var sigLegacy = '';        // old typed-name signature
        var api = {};

        CHECKS.forEach(function (c) { state[c.key] = { comment: '', photos: [] }; });

        // ---------------- Inspection ----------------

        function radioName(c) { return P + 'Chk_' + c.key; }
        function answerOf(c) { return $('input[name="' + radioName(c) + '"]:checked').val() || null; }
        function isBad(c) { return answerOf(c) === c.bad; }

        function syncVisibility(c) {
            $id('Extra_' + c.key).toggleClass('d-none', !isBad(c));
        }

        function renderPhotos(c) {
            renderFileList($id('Thumbs_' + c.key), state[c.key].photos, !readOnly, function (i) {
                state[c.key].photos.splice(i, 1);
                renderPhotos(c);
            });
        }

        async function uploadCheckPhotos(c, files) {
            var $err = $id('PhotoErr_' + c.key).addClass('d-none').text('');
            var errors = [];
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (!fileAllowed(file) || (file.type || '').indexOf('image/') !== 0) {
                    errors.push((file.name || 'file') + ': photos must be images.');
                    continue;
                }
                if (file.size > MAX_FILE_BYTES) { errors.push((file.name || 'photo') + ': larger than 6 MB.'); continue; }
                pending++;
                var photoGen = generation;
                try {
                    var photo = await uploadOne(file, FOLDER, 'insp');
                    if (photoGen !== generation) return;
                    state[c.key].photos.push(photo);
                } catch (e) {
                    errors.push((file.name || 'photo') + ': ' + (e && e.message ? e.message : 'Upload failed'));
                } finally {
                    if (photoGen === generation) pending--;
                }
            }
            renderPhotos(c);
            if (errors.length) $err.text(errors.join(' ')).removeClass('d-none');
        }

        function buildCheck(c) {
            var name = radioName(c);
            var $item = $('<div class="py-2 border-bottom"></div>');
            var $head = $('<div class="d-flex align-items-center justify-content-between gap-3"></div>');
            $head.append($('<span></span>').text(c.q));
            var $opts = $('<div class="d-flex gap-3"></div>');
            ['Yes', 'No'].forEach(function (v) {
                var id = P + 'Chk_' + c.key + '_' + v;
                var $input = $('<input class="form-check-input" type="radio">').attr({ name: name, id: id, value: v });
                $opts.append($('<div class="form-check form-check-inline me-0"></div>')
                    .append($input)
                    .append($('<label class="form-check-label"></label>').attr('for', id).text(v)));
            });
            $head.append($opts);
            $item.append($head);

            var $extra = $('<div class="border border-danger-subtle bg-danger-subtle rounded p-3 mt-2 d-none"></div>').attr('id', P + 'Extra_' + c.key);
            var cId = P + 'Comment_' + c.key;
            var pId = P + 'Photos_' + c.key;
            $extra.append($('<label class="form-label fw-semibold text-danger"></label>').attr('for', cId).text('What was wrong and what action was taken? *'));
            $extra.append($('<textarea class="form-control mb-2" rows="2"></textarea>').attr('id', cId));
            $extra.append($('<button type="button" class="btn btn-outline-secondary btn-sm js-add-photo">Add photo</button>'));
            $extra.append($('<input type="file" class="d-none" accept="image/*" multiple>').attr('id', pId));
            $extra.append($('<div class="text-danger small mt-1 d-none"></div>').attr('id', P + 'PhotoErr_' + c.key));
            $extra.append($('<div class="mt-2"></div>').attr('id', P + 'Thumbs_' + c.key));
            $item.append($extra);

            $item.on('change', 'input[name="' + name + '"]', function () { syncVisibility(c); });
            $extra.find('.js-add-photo').on('click', function () { $extra.find('input[type="file"]').trigger('click'); });
            $extra.find('textarea').on('input', function () { state[c.key].comment = $(this).val(); });
            $extra.find('input[type="file"]').on('change', function () {
                var files = Array.prototype.slice.call(this.files || []);
                this.value = '';
                if (files.length) uploadCheckPhotos(c, files);
            });
            return $item;
        }

        /** Fills #<P>InspColA / #<P>InspColB with the six checks. Safe to call once at init. */
        api.renderInspection = function () {
            var $cols = [$id('InspColA'), $id('InspColB')];
            $cols.forEach(function ($c) { $c.empty(); });
            CHECKS.forEach(function (c) { $cols[c.col].append(buildCheck(c)); });
        };

        api.clearInspection = function () {
            CHECKS.forEach(function (c) {
                $('input[name="' + radioName(c) + '"]').prop('checked', false);
                state[c.key] = { comment: '', photos: [] };
                $id('Comment_' + c.key).val('');
                $id('PhotoErr_' + c.key).addClass('d-none').text('');
                renderPhotos(c);
                syncVisibility(c);
            });
        };

        /** record = saved dispatch record (answers as <key>_yn, inspection_comments, inspection_photos). */
        api.setInspection = function (record) {
            record = record || {};
            var comments = parseObj(record.inspection_comments);
            var photos = parseObj(record.inspection_photos);
            CHECKS.forEach(function (c) {
                var v = record[c.key + '_yn'];
                var $radios = $('input[name="' + radioName(c) + '"]');
                $radios.prop('checked', false);
                if (v != null && v !== '') $radios.filter(function () { return $(this).val() === String(v); }).prop('checked', true);
                state[c.key] = {
                    comment: typeof comments[c.key] === 'string' ? comments[c.key] : '',
                    photos: parseArr(photos[c.key]).map(cleanFile)
                };
                $id('Comment_' + c.key).val(state[c.key].comment);
                renderPhotos(c);
                syncVisibility(c);
            });
        };

        /** { answers:{vehicle_clean_yn:..}, comments:{key:text}, photos:{key:[..]} } - comments/photos for bad answers only. */
        api.getInspection = function () {
            var out = { answers: {}, comments: {}, photos: {} };
            CHECKS.forEach(function (c) {
                out.answers[c.key + '_yn'] = answerOf(c);
                if (isBad(c)) {
                    var txt = ($id('Comment_' + c.key).val() || '').trim();
                    if (txt) out.comments[c.key] = txt;
                    if (state[c.key].photos.length) out.photos[c.key] = state[c.key].photos.map(cleanFile);
                }
            });
            return out;
        };

        /** requireAll: every check must be answered (new dispatch). Returns an array of messages ([] = valid). */
        api.validateInspection = function (requireAll) {
            var missing = [];
            if (requireAll) {
                CHECKS.forEach(function (c) { if (!answerOf(c)) missing.push('Answer "' + c.q + '"'); });
            }
            CHECKS.forEach(function (c) {
                if (isBad(c) && !($id('Comment_' + c.key).val() || '').trim()) missing.push('Add a comment for "' + c.q + '"');
            });
            return missing;
        };

        // ---------------- Transport company ----------------

        function showTransportError(msg) {
            $id('TransportAddError').text(msg || '').toggleClass('d-none', !msg);
        }

        function renderTransportSelect() {
            var $sel = $id('TransportSelect');
            if (!$sel.length) return;
            var want = desiredTransport || { name: '', id: null };
            $sel.empty().append($('<option value=""></option>').text('Select transport company'));
            transporters.forEach(function (t) {
                $sel.append($('<option></option>').attr('value', t.id).text(t.name));
            });
            var match = null;
            if (want.id) match = transporters.filter(function (t) { return String(t.id) === String(want.id); })[0];
            if (!match && want.name) {
                match = transporters.filter(function (t) { return String(t.name).toLowerCase() === String(want.name).toLowerCase(); })[0];
            }
            if (match) {
                $sel.val(match.id);
            } else if (want.name) {
                $sel.append($('<option></option>').attr('value', LEGACY_OPTION).text(want.name));
                $sel.val(LEGACY_OPTION);
            } else {
                $sel.val('');
            }
        }

        function applyTransportMode() {
            var useSelect = configLoaded;
            $id('TransportSelect').toggleClass('d-none', !useSelect);
            $id('TransportAddBtn').toggleClass('d-none', !useSelect);
            $id('TransportText').toggleClass('d-none', useSelect);
            if (!useSelect) $id('TransportAddForm').addClass('d-none');
        }

        /** Loads active transporters; failure degrades to the free-text input. Never rejects. */
        api.loadTransporters = async function () {
            configLoaded = false;
            transporters = [];
            try {
                var cfg = (typeof dataFunctions !== 'undefined' && dataFunctions.getKernelPipelineConfig)
                    ? await dataFunctions.getKernelPipelineConfig() : null;
                if (!cfg || cfg.success === false || !Array.isArray(cfg.transporters)) throw new Error('config unavailable');
                transporters = cfg.transporters.filter(function (t) { return t && t.id && t.is_active !== false; });
                configLoaded = true;
            } catch (err) {
                console.warn('[Dispatch form] Transporter list not available, using free text:', err);
            }
            applyTransportMode();
            renderTransportSelect();
            $id('TransportText').val(desiredTransport.name || '');
        };

        api.setTransporter = function (name, id) {
            desiredTransport = { name: name || '', id: id || null };
            renderTransportSelect();
            $id('TransportText').val(desiredTransport.name);
        };

        api.getTransporter = function () {
            if (!configLoaded) {
                var txt = ($id('TransportText').val() || '').trim();
                return { name: txt || null, id: null };
            }
            var v = $id('TransportSelect').val();
            if (!v) return { name: null, id: null };
            if (v === LEGACY_OPTION) {
                var keepId = desiredTransport.id && UUID_RE.test(String(desiredTransport.id)) ? desiredTransport.id : null;
                return { name: desiredTransport.name || null, id: keepId };
            }
            var t = transporters.filter(function (x) { return String(x.id) === String(v); })[0];
            return { name: t ? t.name : null, id: t ? t.id : null };
        };

        async function addTransporter() {
            var name = ($id('TransportAddName').val() || '').trim();
            if (!name) { showTransportError('Enter the company name.'); return; }
            showTransportError('');
            var $btn = $id('TransportAddSave').prop('disabled', true);
            try {
                var res = (typeof dataFunctions !== 'undefined' && dataFunctions.upsertTransporter)
                    ? await dataFunctions.upsertTransporter(name) : null;
                if (!res || res.success === false || !res.id) throw new Error((res && res.error) || 'Could not add the company.');
                if (!transporters.some(function (t) { return String(t.id) === String(res.id); })) {
                    transporters.push({ id: res.id, name: res.name || name, is_active: true });
                }
                desiredTransport = { name: res.name || name, id: res.id };
                renderTransportSelect();
                $id('TransportAddName').val('');
                $id('TransportAddForm').addClass('d-none');
            } catch (e) {
                showTransportError(e && e.message ? e.message : 'Could not add the company.');
            } finally {
                $btn.prop('disabled', false);
            }
        }

        // ---------------- Signature ----------------

        function sizeCanvas() {
            var canvas = $id('SigCanvas')[0];
            if (!canvas || !pad) return;
            var keep = pad.isEmpty() ? '' : pad.toDataURL('image/png');
            var ratio = Math.max(w.devicePixelRatio || 1, 1);
            canvas.style.height = '150px';
            canvas.width = canvas.offsetWidth * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext('2d').scale(ratio, ratio);
            pad.clear();
            if (keep) pad.fromDataURL(keep, { ratio: ratio });
        }

        function applySigLegacy() {
            $id('SigLegacy').toggleClass('d-none', !sigLegacy);
            $id('SigLegacyName').text(sigLegacy);
        }

        /** Call on the modal's shown.bs.modal (a hidden canvas has no width). Idempotent per show. */
        api.initSignature = function () {
            var canvas = $id('SigCanvas')[0];
            if (!canvas || typeof SignaturePad === 'undefined') return;
            if (pad) { try { pad.off(); } catch (e) { /* ignore */ } }
            canvas.style.height = '150px';
            pad = new SignaturePad(canvas, { penColor: 'black', backgroundColor: 'rgba(255,255,255,0)' });
            var ratio = Math.max(w.devicePixelRatio || 1, 1);
            canvas.width = canvas.offsetWidth * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext('2d').scale(ratio, ratio);
            pad.clear();
            if (sigValue) pad.fromDataURL(sigValue, { ratio: ratio });
            pad.addEventListener('endStroke', function () { sigValue = pad.isEmpty() ? '' : pad.toDataURL('image/png'); });
            if (readOnly) pad.off();
        };

        api.resizeSignature = function () { if (pad) sizeCanvas(); };

        /** Reload a saved signature. A typed-name legacy value is shown as text above an empty pad. */
        api.setSignature = function (value) {
            var v = typeof value === 'string' ? value.trim() : '';
            if (v.indexOf('data:image/png') === 0) { sigValue = v; sigLegacy = ''; } else { sigValue = ''; sigLegacy = v; }
            applySigLegacy();
            if (pad) {
                pad.clear();
                if (sigValue) pad.fromDataURL(sigValue, { ratio: Math.max(w.devicePixelRatio || 1, 1) });
            }
        };

        api.clearSignature = function () {
            sigValue = '';
            if (pad) pad.clear();
        };

        api.getSignature = function () {
            if (pad && !pad.isEmpty()) return pad.toDataURL('image/png');
            if (!pad && sigValue) return sigValue;
            return sigLegacy || null;
        };

        // ---------------- Attachments ----------------

        function renderAttachments() {
            renderFileList($id('AttachList'), attachments, !readOnly, function (i) {
                attachments.splice(i, 1);
                renderAttachments();
            });
        }

        async function uploadAttachments(files) {
            var $err = $id('AttachError').addClass('d-none').text('');
            var errors = [];
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (!fileAllowed(file)) { errors.push((file.name || 'file') + ': only images and PDF documents are allowed.'); continue; }
                if (file.size > MAX_FILE_BYTES) { errors.push((file.name || 'file') + ': larger than 6 MB.'); continue; }
                pending++;
                var attGen = generation;
                try {
                    var att = await uploadOne(file, FOLDER, 'att');
                    if (attGen !== generation) return;
                    attachments.push(att);
                } catch (e) {
                    errors.push((file.name || 'file') + ': ' + (e && e.message ? e.message : 'Upload failed'));
                } finally {
                    if (attGen === generation) pending--;
                }
            }
            renderAttachments();
            if (errors.length) $err.text(errors.join(' ')).removeClass('d-none');
        }

        api.setAttachments = function (list) {
            attachments = parseArr(list).map(cleanFile);
            renderAttachments();
        };
        api.getAttachments = function () { return attachments.map(cleanFile); };
        api.isUploading = function () { return pending > 0; };

        // ---------------- Customer contact (prefill) ----------------

        /** Resolves to { name, cell, company } (empty strings when unknown). Never rejects. */
        api.loadCustomerContact = async function (contactId) {
            var out = { name: '', cell: '', company: '' };
            if (!contactId || typeof dataFunctions === 'undefined' || !dataFunctions.getContactById) return out;
            try {
                var c = await dataFunctions.getContactById(contactId, null, true);
                if (c) {
                    out.name = String(c.primary_contact_name || '').trim();
                    out.cell = String(c.primary_contact_mobile || c.primary_contact_phone || '').trim();
                    out.company = String(c.company_name || c.trading_name || '').trim();
                }
            } catch (e) {
                console.warn('[Dispatch form] Customer contact not available:', e);
            }
            return out;
        };

        // ---------------- Read-only / reset / wiring ----------------

        /** Form-level setFormReadOnly already disables inputs; this covers pad, buttons and remove links. */
        api.setReadOnly = function (ro) {
            readOnly = !!ro;
            if (pad) { if (readOnly) pad.off(); else pad.on(); }
            $id('SigClear').toggleClass('d-none', readOnly);
            $id('TransportAddBtn').prop('disabled', readOnly).toggleClass('d-none', readOnly || !configLoaded);
            if (readOnly) $id('TransportAddForm').addClass('d-none');
            $id('AttachAddWrap').toggleClass('d-none', readOnly);
            $('#' + P + 'InspColA, #' + P + 'InspColB').find('.js-add-photo').toggleClass('d-none', readOnly);
            CHECKS.forEach(renderPhotos);
            renderAttachments();
        };

        /** Wipes widget state for a fresh open. */
        api.reset = function () {
            generation++;
            pending = 0;
            api.clearInspection();
            attachments = [];
            renderAttachments();
            desiredTransport = { name: '', id: null };
            sigValue = ''; sigLegacy = '';
            applySigLegacy();
            if (pad) pad.clear();
            showTransportError('');
            $id('TransportAddForm').addClass('d-none');
            $id('AttachError').addClass('d-none').text('');
            renderTransportSelect();
            $id('TransportText').val('');
        };

        api.init = function () {
            api.renderInspection();
            $id('TransportAddBtn').off('click').on('click', function () {
                $id('TransportAddForm').toggleClass('d-none');
                showTransportError('');
                $id('TransportAddName').trigger('focus');
            });
            $id('TransportAddCancel').off('click').on('click', function () { $id('TransportAddForm').addClass('d-none'); showTransportError(''); });
            $id('TransportAddSave').off('click').on('click', function () { addTransporter(); });
            $id('TransportSelect').off('change').on('change', function () {
                var v = $(this).val();
                if (v && v !== LEGACY_OPTION) {
                    var t = transporters.filter(function (x) { return String(x.id) === String(v); })[0];
                    if (t) desiredTransport = { name: t.name, id: t.id };
                } else if (!v) {
                    desiredTransport = { name: '', id: null };
                }
            });
            $id('SigClear').off('click').on('click', function () { api.clearSignature(); sigLegacy = ''; applySigLegacy(); });
            $id('AttachBtn').off('click').on('click', function () { $id('AttachInput').trigger('click'); });
            $id('AttachInput').off('change').on('change', function () {
                var files = Array.prototype.slice.call(this.files || []);
                this.value = '';
                if (files.length) uploadAttachments(files);
            });
            $(w).off('resize.' + P).on('resize.' + P, function () { api.resizeSignature(); });
            renderAttachments();
        };

        return api;
    }

    w.DispatchFormShared = { create: create, cartonLabel: cartonLabel, CHECKS: CHECKS };
}(window));
