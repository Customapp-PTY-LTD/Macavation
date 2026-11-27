/**
 * Transporters page (route 'transporters'; Mike's MacView, 27 Nov 2026).
 *
 * Three tabs over get_transport_sheet (migration 20261127090000_transport_rate_sheet.sql):
 *   Transporters  company details, two contacts, GIT insurance and B-BBEE (with expiry), certificates
 *   Routes        code, from, to, km; cheapest current rate per route
 *   Rates         transporter + route + rate per load + valid from / to; Renew starts the next one
 * Editing needs the transport_rates.edit action; everyone with the screen can look.
 * My Day hands over { tab, transporterId } (rates expiring) or { tab, editTransporterId } (documents).
 *
 * Security: every DB-sourced or typed string goes into the DOM through esc() or .text().
 */
var _transporters = (function () {
    'use strict';

    var NS = '.trp';
    var STATUS = [
        ['active', 'Active'], ['approved_not_used', 'Approved, not used'], ['on_hold', 'On hold'], ['inactive', 'Inactive']
    ];
    var BBBEE_LEVELS = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8',
        'Non-compliant', 'EME / QSE affidavit'];
    var DOC_WARN_DAYS = 30;

    var state = { sheet: null, tab: 'transporters', filter: '', showOld: false, modal: null, files: [], uploading: 0 };

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v);
    }
    function canEdit() { return typeof window.hasAction === 'function' && !!window.hasAction('transport_rates.edit'); }
    function money(n) { return TransportRateSheet.money(n); }
    function day(iso) { return iso ? TransportRateSheet.day(iso) : ''; }
    function today() { return (state.sheet && state.sheet.today) || TransportRateSheet.todayIso(); }
    function statusLabel(k) { var s = STATUS.filter(function (x) { return x[0] === k; })[0]; return s ? s[1] : 'Active'; }
    function byId(list, id) { return (list || []).filter(function (x) { return String(x.id) === String(id); })[0] || null; }
    function addDays(iso, n) {
        var d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }
    function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }

    function toast(msg, type) {
        if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(msg, type || 'success');
    }

    // ------------------------------------------------------------------ loading

    async function load() {
        $('#trpNotice').empty();
        var s = await dataFunctions.getTransportSheet();
        if (!s) {
            state.sheet = null;
            $('#trpNotice').html('<div class="alert alert-warning">The rate sheet is not set up on this database yet.</div>');
            $('#trpTransportersBody, #trpRoutesBody, #trpRatesBody').empty();
            return;
        }
        state.sheet = s;
        if (typeof TransportRateSheet !== 'undefined') TransportRateSheet.clear();
        render();
    }

    // ------------------------------------------------------------------ rendering

    /** A date badge: red when past, amber within DOC_WARN_DAYS, plain otherwise. */
    function expiryCell(iso, extra) {
        if (!iso) return '<span class="text-muted">' + (extra ? esc(extra) : '—') + '</span>';
        var left = daysBetween(today(), iso);
        var cls = left < 0 ? 'bg-danger-subtle text-danger-emphasis border border-danger-subtle'
            : left <= DOC_WARN_DAYS ? 'bg-warning-subtle text-warning-emphasis border border-warning-subtle' : 'bg-light text-dark border';
        var when = left < 0 ? 'Expired ' : 'To ';
        return (extra ? '<div class="small">' + esc(extra) + '</div>' : '') +
            '<span class="badge ' + cls + '">' + when + esc(day(iso)) + '</span>';
    }

    function statusBadge(k) {
        var cls = { active: 'bg-success-subtle text-success-emphasis', on_hold: 'bg-warning-subtle text-warning-emphasis',
            inactive: 'bg-light text-muted', approved_not_used: 'bg-info-subtle text-info-emphasis' }[k] || 'bg-light text-dark';
        return '<span class="badge border ' + cls + '">' + esc(statusLabel(k)) + '</span>';
    }

    function renderTransporters() {
        var rows = (state.sheet.transporters || []).map(function (t) {
            var contact = [t.contact_name, t.contact_cell].filter(Boolean).join(' · ');
            return '<tr class="' + (t.is_active ? '' : 'trp-row-inactive') + '">' +
                '<td><div class="fw-semibold">' + esc(t.name) + '</div>' + (t.base ? '<div class="small text-muted">' + esc(t.base) + '</div>' : '') + '</td>' +
                '<td>' + statusBadge(t.status) + '</td>' +
                '<td>' + (contact ? esc(contact) : '<span class="text-muted">—</span>') +
                (t.contact_email ? '<div class="small text-muted">' + esc(t.contact_email) + '</div>' : '') + '</td>' +
                '<td>' + expiryCell(t.git_expiry, t.git_cover_zar != null ? money(t.git_cover_zar) + ' per load' : '') + '</td>' +
                '<td>' + expiryCell(t.bbbee_expiry, t.bbbee_level || '') + '</td>' +
                '<td class="text-end"><button type="button" class="btn btn-link btn-sm p-0" data-trp-act="show-rates" data-id="' + esc(t.id) + '">' + esc(t.current_rates) + '</button></td>' +
                '<td class="text-end text-nowrap"><button type="button" class="btn btn-outline-secondary btn-sm" data-trp-act="edit-transporter" data-id="' + esc(t.id) + '">' +
                (canEdit() ? 'Edit' : 'View') + '</button></td></tr>';
        }).join('');
        $('#trpTransportersBody').html(rows || '<tr><td colspan="7" class="text-center text-muted py-4">No transporters yet.</td></tr>');
    }

    function renderRoutes() {
        var rows = (state.sheet.routes || []).map(function (r) {
            var ch = TransportRateSheet.cheapestOn(state.sheet, r.id, today());
            return '<tr class="' + (r.is_active ? '' : 'trp-row-inactive') + '">' +
                '<td class="trp-code">' + esc(r.code) + (r.is_active ? '' : ' <span class="badge bg-light text-muted border">Not used</span>') + '</td>' +
                '<td>' + esc(r.origin) + '</td><td>' + esc(r.destination) + '</td>' +
                '<td class="text-end">' + (r.km != null ? esc(r.km) : '—') + '</td>' +
                '<td>' + (ch ? '<strong>' + esc(money(ch.rate_zar)) + '</strong> <span class="text-muted">' + esc(ch.transporter_name) + '</span>' : '<span class="text-muted">No current rate</span>') + '</td>' +
                '<td class="text-end">' + esc(r.current_rates) + '</td>' +
                '<td class="text-end">' + (canEdit() ? '<button type="button" class="btn btn-outline-secondary btn-sm" data-trp-act="edit-route" data-id="' + esc(r.id) + '">Edit</button>' : '') + '</td></tr>';
        }).join('');
        $('#trpRoutesBody').html(rows || '<tr><td colspan="7" class="text-center text-muted py-4">No routes yet.' +
            (canEdit() ? ' Press <strong>Add a route</strong>.' : '') + '</td></tr>');
    }

    /** A rate is "replaced" when a later rate for the same transporter + route starts after it. */
    function replacedBy(r) {
        return (state.sheet.rates || []).filter(function (o) {
            return o.id !== r.id && o.transporter_id === r.transporter_id && o.route_id === r.route_id &&
                String(o.valid_from) > String(r.valid_from) && (!o.valid_to || !r.valid_to || o.valid_to > r.valid_to);
        })[0] || null;
    }

    function renderRates() {
        var $f = $('#trpRateFilter');
        var keep = state.filter;
        $f.html('<option value="">All transporters</option>' + (state.sheet.transporters || []).map(function (t) {
            return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
        }).join(''));
        $f.val(keep);
        $('#trpShowOld').prop('checked', state.showOld);
        var on = today();
        var rows = (state.sheet.rates || []).filter(function (r) {
            if (state.filter && String(r.transporter_id) !== String(state.filter)) return false;
            return state.showOld || r.status !== 'expired' || !replacedBy(r);
        }).map(function (r) {
            var cls = r.status === 'current' ? 'bg-success-subtle text-success-emphasis' : r.status === 'expired' ? 'bg-danger-subtle text-danger-emphasis' : 'bg-info-subtle text-info-emphasis';
            var label = r.status === 'current' ? 'Current' : r.status === 'expired' ? 'Expired' : 'Starts ' + day(r.valid_from);
            var soon = r.status === 'current' && r.valid_to && daysBetween(on, r.valid_to) <= 14 && !replacedBy(r);
            if (soon) { cls = 'bg-warning-subtle text-warning-emphasis'; label = 'Ends in ' + daysBetween(on, r.valid_to) + ' days'; }
            var renew = canEdit() && (soon || (r.status === 'expired' && !replacedBy(r)));
            return '<tr>' +
                '<td>' + esc(r.transporter_name) + '</td><td class="trp-code">' + esc(r.route_code) + '</td>' +
                '<td class="text-end fw-semibold">' + esc(money(r.rate_zar)) + '</td>' +
                '<td class="text-end">' + (r.per_km != null ? esc(money(r.per_km)) : '—') + '</td>' +
                '<td>' + esc(day(r.valid_from)) + '</td><td>' + (r.valid_to ? esc(day(r.valid_to)) : '<span class="text-muted">No end date</span>') + '</td>' +
                '<td><span class="badge border ' + cls + '">' + esc(label) + '</span></td>' +
                '<td class="trp-notes" title="' + esc(r.notes || '') + '">' + esc(r.notes || '') + '</td>' +
                '<td class="text-end text-nowrap">' + (canEdit()
                    ? (renew ? '<button type="button" class="btn btn-primary btn-sm me-1" data-trp-act="renew-rate" data-id="' + esc(r.id) + '">Renew</button>' : '') +
                      '<button type="button" class="btn btn-outline-secondary btn-sm" data-trp-act="edit-rate" data-id="' + esc(r.id) + '">Edit</button>'
                    : '') + '</td></tr>';
        }).join('');
        $('#trpRatesBody').html(rows || '<tr><td colspan="9" class="text-center text-muted py-4">No rates' +
            (state.filter ? ' for this transporter' : '') + ' yet.</td></tr>');
    }

    var ADD_LABELS = { transporters: 'Add a transporter', routes: 'Add a route', rates: 'Add a rate' };

    function render() {
        if (!state.sheet) return;
        $('#trpModule .trp-tab').each(function () {
            var on = this.getAttribute('data-tab') === state.tab;
            $(this).toggleClass('active', on).attr('aria-selected', on ? 'true' : 'false');
        });
        $('#trpPaneTransporters').toggleClass('d-none', state.tab !== 'transporters');
        $('#trpPaneRoutes').toggleClass('d-none', state.tab !== 'routes');
        $('#trpPaneRates').toggleClass('d-none', state.tab !== 'rates');
        $('#trpAdd').toggleClass('d-none', !canEdit());
        $('#trpAddLabel').text(ADD_LABELS[state.tab]);
        renderTransporters();
        renderRoutes();
        renderRates();
    }

    // ------------------------------------------------------------------ edit window

    function field(id, label, value, opts) {
        opts = opts || {};
        var ro = canEdit() ? '' : ' disabled';
        var input = opts.textarea
            ? '<textarea class="form-control" id="' + id + '" rows="2"' + ro + '>' + esc(value || '') + '</textarea>'
            : '<input type="' + (opts.type || 'text') + '" class="form-control" id="' + id + '"' +
              (opts.step ? ' step="' + opts.step + '"' : '') + (opts.min != null ? ' min="' + opts.min + '"' : '') +
              (opts.max ? ' maxlength="' + opts.max + '"' : '') + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') +
              ' value="' + esc(value == null ? '' : value) + '"' + ro + '>';
        return '<div class="' + (opts.col || 'col-md-6') + '"><label class="form-label" for="' + id + '">' + esc(label) +
            (opts.req ? ' <span class="text-danger">*</span>' : '') + '</label>' + input +
            (opts.hint ? '<div class="form-text">' + esc(opts.hint) + '</div>' : '') + '</div>';
    }

    function select(id, label, options, value, opts) {
        opts = opts || {};
        var ro = canEdit() ? '' : ' disabled';
        return '<div class="' + (opts.col || 'col-md-6') + '"><label class="form-label" for="' + id + '">' + esc(label) +
            (opts.req ? ' <span class="text-danger">*</span>' : '') + '</label>' +
            '<select class="form-select" id="' + id + '"' + ro + '>' + options.map(function (o) {
                return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value == null ? '' : value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
            }).join('') + '</select></div>';
    }

    function openModal(kind, title, bodyHtml, rec) {
        state.modal = { kind: kind, rec: rec || null };
        $('#trpModalTitle').text(title);
        $('#trpModalBody').html(bodyHtml);
        $('#trpModalError').text('');
        $('#trpModalSave').toggleClass('d-none', !canEdit()).prop('disabled', false);
        $('#trpModalRemove').toggleClass('d-none', !(kind === 'rate' && rec && rec.id && canEdit()));
        bootstrap.Modal.getOrCreateInstance(document.getElementById('trpModal')).show();
    }

    function closeModal() {
        var m = bootstrap.Modal.getInstance(document.getElementById('trpModal'));
        if (m) m.hide();
    }

    function transporterForm(t) {
        t = t || {};
        state.files = Array.isArray(t.documents) ? t.documents.slice() : [];
        var levels = [['', 'Not known']].concat(BBBEE_LEVELS.map(function (l) { return [l, l]; }));
        var h = '<div class="trp-sect">Company</div><div class="row g-3">' +
            field('trpName', 'Company name', t.name, { req: true, max: 120 }) +
            select('trpStatus', 'Status', STATUS, t.status || 'active') +
            field('trpBase', 'Province / base', t.base, { max: 120 }) +
            field('trpTruckTypes', 'Truck types offered', t.truck_types, { ph: 'e.g. Tautliner superlink, tri-axle', max: 200 }) +
            field('trpVat', 'VAT no.', t.vat_no, { max: 40 }) + '</div>' +
            '<div class="trp-sect">Contact people</div><div class="row g-3">' +
            field('trpC1Name', 'Main contact', t.contact_name, { col: 'col-md-4', max: 120 }) +
            field('trpC1Cell', 'Cell', t.contact_cell, { col: 'col-md-4', ph: '+27 82 123 4567', max: 40 }) +
            field('trpC1Email', 'Email', t.contact_email, { col: 'col-md-4', type: 'email', max: 160 }) +
            field('trpC2Name', 'Second contact (e.g. accounts)', t.contact2_name, { col: 'col-md-4', max: 120 }) +
            field('trpC2Cell', 'Cell', t.contact2_cell, { col: 'col-md-4', max: 40 }) +
            field('trpC2Email', 'Email', t.contact2_email, { col: 'col-md-4', type: 'email', max: 160 }) + '</div>' +
            '<div class="trp-sect">Documents and cover</div><div class="row g-3">' +
            field('trpGitInsurer', 'Goods-in-transit insurer', t.git_insurer, { col: 'col-md-4', max: 120 }) +
            field('trpGitCover', 'GIT cover per load (R)', t.git_cover_zar, { col: 'col-md-4', type: 'number', step: '0.01', min: 0 }) +
            field('trpGitExpiry', 'GIT insurance expires', t.git_expiry, { col: 'col-md-4', type: 'date' }) +
            select('trpBbbeeLevel', 'B-BBEE level', levels, t.bbbee_level || '', { col: 'col-md-4' }) +
            field('trpBbbeeExpiry', 'B-BBEE certificate expires', t.bbbee_expiry, { col: 'col-md-4', type: 'date' }) +
            '<div class="col-12"><label class="form-label" for="trpFiles">Certificates (GIT, B-BBEE, roadworthy, tax clearance)</label>' +
            (canEdit() ? '<input type="file" class="form-control" id="trpFiles" multiple accept="image/*,application/pdf">' : '') +
            '<div class="mt-2" id="trpFileList"></div></div></div>' +
            '<div class="trp-sect">Notes</div><div class="row g-3">' +
            field('trpNotes', 'Notes', t.notes, { col: 'col-12', textarea: true }) + '</div>';
        openModal('transporter', t.id ? t.name : 'Add a transporter', h, t);
        drawFiles();
    }

    function drawFiles() {
        var $el = $('#trpFileList');
        if (!$el.length) return;
        var onRemove = canEdit() ? function (i) { state.files.splice(i, 1); drawFiles(); } : null;
        if (typeof FilePreview !== 'undefined') {
            FilePreview.render($el, state.files, { onRemove: onRemove });
            return;
        }
        $el.empty();
        state.files.forEach(function (f, i) {
            var $row = $('<div class="small mb-1"></div>');
            if (typeof f.file_link === 'string' && f.file_link.indexOf('https://') === 0) {
                $row.append($('<a target="_blank" rel="noopener"></a>').attr('href', f.file_link).text(f.name || 'file'));
            } else {
                $row.text(f.name || 'file');
            }
            if (onRemove) {
                $row.append(' ', $('<button type="button" class="btn btn-link btn-sm text-danger p-0">Remove</button>').on('click', function () { onRemove(i); }));
            }
            $el.append($row);
        });
    }

    async function uploadFiles(files) {
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var t = (file.type || '').toLowerCase();
            if (!(t.indexOf('image/') === 0 || t === 'application/pdf' || (!t && /\.pdf$/i.test(file.name || '')))) {
                $('#trpModalError').text(file.name + ' is not a photo or PDF.');
                continue;
            }
            state.uploading++;
            $('#trpModalSave').prop('disabled', true);
            try {
                var safe = (file.name || 'file').replace(/[^\w.-]/g, '_');
                var fileId = 'transporter_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + safe;
                var res = await _common.uploadFile({ file: file, resourceFolder: 'transporters', fileId: fileId });
                if (!res || !res.Success) throw new Error((res && res.LastErrorDescription) || 'Upload failed');
                var data = res.Data;
                state.files.push({
                    file_id: (data && data[0] && (data[0].fileId || data[0].key)) || (data && data.fileId) || fileId,
                    file_link: (data && data[0] && data[0].fileLink) || (data && data.fileLink) || null,
                    name: file.name || safe
                });
                drawFiles();
            } catch (e) {
                $('#trpModalError').text('Could not upload ' + file.name + ': ' + (e.message || e));
            } finally {
                state.uploading--;
                if (!state.uploading) $('#trpModalSave').prop('disabled', false);
            }
        }
    }

    function routeForm(r) {
        r = r || {};
        var h = '<div class="row g-3">' +
            field('trpRouteCode', 'Route code', r.code, { col: 'col-md-4', req: true, ph: 'e.g. HAZ-HOW', max: 30, hint: 'Short and unique. Capitals are added for you.' }) +
            field('trpRouteFrom', 'From (collection point)', r.origin, { col: 'col-md-4', req: true, max: 120 }) +
            field('trpRouteTo', 'To (delivery point)', r.destination || 'Howick', { col: 'col-md-4', max: 120 }) +
            field('trpRouteKm', 'Distance (km)', r.km, { col: 'col-md-4', type: 'number', step: '0.1', min: 0 }) +
            (r.id ? select('trpRouteActive', 'In use', [['1', 'Yes'], ['0', 'No, hide it from the route lists']], r.is_active === false ? '0' : '1', { col: 'col-md-8' }) : '') +
            field('trpRouteNotes', 'Notes', r.notes, { col: 'col-12', textarea: true }) + '</div>';
        openModal('route', r.id ? 'Route ' + r.code : 'Add a route', h, r);
    }

    function rateForm(r, title) {
        r = r || {};
        var ts = [['', 'Pick the transporter']].concat((state.sheet.transporters || []).filter(function (t) {
            return t.is_active || String(t.id) === String(r.transporter_id || '');
        }).map(function (t) { return [t.id, t.name]; }));
        var rs = [['', 'Pick the route']].concat((state.sheet.routes || []).filter(function (x) {
            return x.is_active || String(x.id) === String(r.route_id || '');
        }).map(function (x) { return [x.id, TransportRateSheet.routeLabel(x)]; }));
        var h = '<div class="row g-3">' +
            select('trpRateTr', 'Transporter', ts, r.transporter_id || state.filter || '', { req: true }) +
            select('trpRateRoute', 'Route', rs, r.route_id || '', { req: true }) +
            field('trpRateZar', 'Rate per load (R, excl. VAT)', r.rate_zar, { col: 'col-md-4', type: 'number', step: '0.01', min: 0, req: true }) +
            field('trpRateFrom', 'Valid from', r.valid_from || today(), { col: 'col-md-4', type: 'date', req: true }) +
            field('trpRateTo', 'Valid to (blank = no end date)', r.valid_to, { col: 'col-md-4', type: 'date' }) +
            '<div class="col-12 small text-muted" id="trpRatePerKm" aria-live="polite"></div>' +
            field('trpRateNotes', 'Notes', r.notes, { col: 'col-12', textarea: true }) + '</div>';
        openModal('rate', title || (r.id ? 'Edit rate' : 'Add a rate'), h, r);
        perKm();
    }

    function perKm() {
        var route = byId(state.sheet.routes, $('#trpRateRoute').val());
        var v = parseFloat($('#trpRateZar').val());
        $('#trpRatePerKm').text(route && route.km > 0 && isFinite(v) ? 'Rate per km: ' + money(v / route.km) : '');
    }

    function num(id) {
        var raw = String($('#' + id).val() || '').trim();
        if (raw === '') return null;
        var n = Number(raw);
        return isFinite(n) ? n : NaN;
    }

    async function save() {
        if (!state.modal || !canEdit()) return;
        if (state.uploading) { $('#trpModalError').text('A file is still uploading. Try again in a moment.'); return; }
        var m = state.modal, rec = m.rec || {}, res;
        $('#trpModalError').text('');
        $('#trpModalSave').prop('disabled', true);
        try {
            if (m.kind === 'transporter') {
                var cover = num('trpGitCover');
                if (Number.isNaN(cover)) throw new Error('GIT cover per load must be a number.');
                res = await dataFunctions.saveTransporter(rec.id || null, {
                    name: $('#trpName').val(), status: $('#trpStatus').val(), base: $('#trpBase').val(),
                    truck_types: $('#trpTruckTypes').val(), vat_no: $('#trpVat').val(),
                    contact_name: $('#trpC1Name').val(), contact_cell: $('#trpC1Cell').val(), contact_email: $('#trpC1Email').val(),
                    contact2_name: $('#trpC2Name').val(), contact2_cell: $('#trpC2Cell').val(), contact2_email: $('#trpC2Email').val(),
                    git_insurer: $('#trpGitInsurer').val(), git_cover_zar: cover, git_expiry: $('#trpGitExpiry').val() || null,
                    bbbee_level: $('#trpBbbeeLevel').val(), bbbee_expiry: $('#trpBbbeeExpiry').val() || null,
                    documents: state.files, notes: $('#trpNotes').val()
                });
            } else if (m.kind === 'route') {
                var km = num('trpRouteKm');
                if (Number.isNaN(km)) throw new Error('Distance must be a number.');
                res = await dataFunctions.saveTransportRoute({
                    id: rec.id || null, code: $('#trpRouteCode').val(), origin: $('#trpRouteFrom').val(),
                    destination: $('#trpRouteTo').val(), km: km, notes: $('#trpRouteNotes').val(),
                    is_active: rec.id ? $('#trpRouteActive').val() !== '0' : true
                });
            } else {
                var rate = num('trpRateZar');
                if (rate == null || Number.isNaN(rate)) throw new Error('Enter the rate per load.');
                res = await dataFunctions.saveTransportRate({
                    id: rec.id || null, transporter_id: $('#trpRateTr').val() || null, route_id: $('#trpRateRoute').val() || null,
                    rate_zar: rate, valid_from: $('#trpRateFrom').val() || null, valid_to: $('#trpRateTo').val() || null,
                    notes: $('#trpRateNotes').val()
                });
            }
            if (!res || res.success === false) throw new Error((res && res.error) || 'Could not save.');
            closeModal();
            toast('Saved.');
            await load();
        } catch (e) {
            $('#trpModalError').text(e.message || String(e));
        } finally {
            $('#trpModalSave').prop('disabled', false);
        }
    }

    async function removeRate() {
        var m = state.modal;
        if (!m || m.kind !== 'rate' || !m.rec || !m.rec.id || !canEdit()) return;
        if (typeof Swal !== 'undefined') {
            var ok = await Swal.fire({ title: 'Remove this rate?', text: 'Deliveries already priced from it keep their cost.', icon: 'warning',
                showCancelButton: true, confirmButtonText: 'Remove rate' });
            if (!ok.isConfirmed) return;
        }
        var res = await dataFunctions.saveTransportRate({ id: m.rec.id, is_active: false });
        if (!res || res.success === false) { $('#trpModalError').text((res && res.error) || 'Could not remove.'); return; }
        closeModal();
        toast('Rate removed.');
        await load();
    }

    // ------------------------------------------------------------------ events

    function showTab(tab) {
        if (['transporters', 'routes', 'rates'].indexOf(tab) < 0) return;
        state.tab = tab;
        render();
    }

    function bind() {
        var $m = $('#trpModule');
        $m.off(NS);
        $m.on('click' + NS, '.trp-tab', function () { showTab(this.getAttribute('data-tab')); });
        $m.on('click' + NS, '#trpRefresh', function () { load(); });
        $m.on('click' + NS, '#trpAdd', function () {
            if (!state.sheet || !canEdit()) return;
            if (state.tab === 'routes') routeForm(null);
            else if (state.tab === 'rates') rateForm(null);
            else transporterForm(null);
        });
        $m.on('click' + NS, '[data-trp-act]', function () {
            var act = this.getAttribute('data-trp-act'), id = this.getAttribute('data-id');
            if (act === 'edit-transporter') transporterForm(byId(state.sheet.transporters, id));
            if (act === 'edit-route') routeForm(byId(state.sheet.routes, id));
            if (act === 'edit-rate') rateForm(byId(state.sheet.rates, id));
            if (act === 'show-rates') { state.filter = id; showTab('rates'); }
            if (act === 'renew-rate') {
                var old = byId(state.sheet.rates, id);
                if (!old) return;
                var from = old.valid_to && old.valid_to >= today() ? addDays(old.valid_to, 1) : today();
                rateForm({ transporter_id: old.transporter_id, route_id: old.route_id, rate_zar: old.rate_zar, valid_from: from, notes: '' },
                    'Renew ' + old.transporter_name + ' · ' + old.route_code);
            }
        });
        $m.on('change' + NS, '#trpRateFilter', function () { state.filter = this.value; renderRates(); });
        $m.on('change' + NS, '#trpShowOld', function () { state.showOld = this.checked; renderRates(); });
        $m.on('input' + NS + ' change' + NS, '#trpRateZar, #trpRateRoute', perKm);
        $m.on('change' + NS, '#trpFiles', function () {
            var files = Array.prototype.slice.call(this.files || []);
            this.value = '';
            uploadFiles(files);
        });
        $m.on('click' + NS, '#trpModalSave', save);
        $m.on('click' + NS, '#trpModalRemove', removeRate);
    }

    async function init() {
        state.tab = 'transporters';
        state.filter = '';
        bind();
        var h = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('transporters') : null;
        if (h && h.tab) state.tab = h.tab;
        if (h && h.transporterId) { state.filter = h.transporterId; state.showOld = true; }
        await load();
        if (h && h.editTransporterId && state.sheet) {
            var t = byId(state.sheet.transporters, h.editTransporterId);
            if (t) transporterForm(t);
        }
    }

    return { init: init };
})();
