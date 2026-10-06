/**
 * Kernel Pipeline Settings — one screen for everything Macavation asked to be adjustable.
 *
 * Everything loads from getKernelPipelineConfig(). Each card saves on its own Save button and
 * only sends the rows that changed. Role access for "Edit batch number" reuses the existing
 * admin role-action functions (getRoles / getActions / getRoleActions / createRoleAction /
 * deleteRoleActionForRole); it saves per checkbox, like the Customize screen does.
 *
 * Security invariant: every DB-sourced or typed string goes into the DOM via esc();
 * keys (test_key, crate_type, ids) are only ever read from the RPC rows, never typed.
 */
var _kernelPipelineSettingsGrid = (function () {
    'use strict';

    var NS = '.kps';
    var EDIT_BATCH_ACTION = 'grower_intake.edit_batch_number';
    var SILO_COUNT = 12;
    var STAGE_LABELS = { washing: 'Washing', sorting: 'Sorting' };

    var state = { cfg: null, roles: null, actions: null, roleActions: null, roleAccessOk: false };

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml)
            ? _common.escapeHtml(v)
            : String(v == null ? '' : v);
    }

    function canEdit() {
        return typeof window.hasAction === 'function' && window.hasAction('kernel_settings.edit');
    }

    function toast(msg, type) {
        if (typeof _common !== 'undefined' && _common.showToastMessage) {
            _common.showToastMessage(msg, type || 'info');
        }
    }

    function errText(res, fallback) {
        return (res && res.error) ? String(res.error) : fallback;
    }

    // Blank -> null; otherwise a plain number (NaN when not numeric).
    function numOrNull(s) {
        var t = String(s == null ? '' : s).trim();
        if (t === '') return null;
        return Number(t);
    }

    function same(a, b) {
        return (a == null && b == null) || (a != null && b != null && Number(a) === Number(b));
    }

    function numAttr(v) {
        return v == null ? '' : esc(String(v));
    }

    function dis() { return canEdit() ? '' : ' disabled'; }

    function saveBtn(id) {
        return canEdit()
            ? '<button type="button" class="btn btn-primary btn-sm" id="' + id + '"><i class="fas fa-save me-1"></i>Save</button>'
            : '';
    }

    function card(title, bodyHtml, footHtml) {
        return '<div class="card mb-3"><div class="card-header"><strong>' + esc(title) + '</strong></div>' +
            '<div class="card-body">' + bodyHtml + '</div>' +
            (footHtml ? '<div class="card-footer text-end">' + footHtml + '</div>' : '') + '</div>';
    }

    // ------------------------------------------------------------------
    // Cards.
    // ------------------------------------------------------------------

    function specCard(cfg) {
        var rows = (cfg.spec_thresholds || []).map(function (t) {
            return '<tr data-test="' + esc(t.test_key) + '">' +
                '<td>' + esc(t.label || t.test_key) + '</td>' +
                '<td><select class="form-select form-select-sm kps-select kps-dir"' + dis() + '>' +
                '<option value="max"' + (t.direction !== 'min' ? ' selected' : '') + '>Lower</option>' +
                '<option value="min"' + (t.direction === 'min' ? ' selected' : '') + '>Higher</option>' +
                '</select></td>' +
                '<td><input type="number" step="any" min="0" class="form-control form-control-sm kps-num kps-green" value="' + numAttr(t.green_limit) + '"' + dis() + '></td>' +
                '<td><input type="number" step="any" min="0" class="form-control form-control-sm kps-num kps-yellow" value="' + numAttr(t.yellow_limit) + '"' + dis() + '></td>' +
                '<td><span class="badge bg-danger">Red</span></td></tr>';
        }).join('');
        var body = '<div class="table-responsive"><table class="table align-middle mb-2 kps-table"><thead><tr>' +
            '<th>Test</th><th>Better when</th><th>Green up to</th><th>Yellow up to</th><th>Above that</th></tr></thead><tbody>' +
            rows + '</tbody></table></div>' +
            '<div class="kps-hint">When \'Better when\' is Higher, the limits read as \'green from\' and \'yellow from\'. ' +
            'Leave a test\'s limits blank and it shows no colour.</div>';
        return card('Sample spec limits', body, saveBtn('kpsSaveSpec'));
    }

    function crateCard(cfg) {
        var list = cfg.crate_weights || [];
        var rows = '';
        ['washing', 'sorting'].forEach(function (stage) {
            list.filter(function (c) { return c.stage === stage; }).forEach(function (c) {
                rows += '<tr data-stage="' + esc(c.stage) + '" data-crate="' + esc(c.crate_type) + '">' +
                    '<td>' + esc(STAGE_LABELS[stage] || stage) + ' &middot; ' + esc(c.label || c.crate_type) + '</td>' +
                    '<td><input type="number" step="any" min="0" class="form-control form-control-sm kps-num kps-kg" value="' + numAttr(c.kg_per_crate) + '" placeholder="Manual"' + dis() + '></td></tr>';
            });
        });
        var body = '<div class="table-responsive"><table class="table align-middle mb-2 kps-table"><thead><tr>' +
            '<th>Stage &middot; crate</th><th>Kg per crate</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<div class="kps-hint">Washing and Sorting kg fill in as crates &times; kg per crate. Leave blank to keep that kg field a manual entry.</div>';
        return card('Kg per crate', body, saveBtn('kpsSaveCrates'));
    }

    function roleAccessFallback() {
        return '<p class="mb-2">Turn \'Edit Batch Number\' on or off per role in Administration &rarr; Role permissions.</p>' +
            '<button type="button" class="btn btn-outline-secondary btn-sm" id="kpsGoRolePerms">Open Role permissions</button>';
    }

    function roleAccessHtml() {
        if (!state.roleAccessOk) return roleAccessFallback();
        var action = (state.actions || []).filter(function (a) { return a.key === EDIT_BATCH_ACTION; })[0];
        if (!action) return roleAccessFallback();
        var granted = {};
        (state.roleActions || []).forEach(function (ra) {
            if (ra.action_key === EDIT_BATCH_ACTION && ra.value === 'true') granted[String(ra.role_id)] = true;
        });
        var rows = (state.roles || []).map(function (r) {
            var name = r.role_name || r.name || '';
            var always = /^(super_user|admin)$/i.test(String(name));
            var rid = r.id != null ? r.id : r.role_id;
            var on = always || !!granted[String(rid)];
            return '<tr><td>' + esc(name) + '</td><td>' +
                '<input type="checkbox" class="form-check-input kps-role-chk" data-role-id="' + esc(rid) + '" data-action-id="' + esc(action.id) + '"' +
                (on ? ' checked' : '') + ((always || !canEdit()) ? ' disabled' : '') +
                ' aria-label="Edit batch number for ' + esc(name) + '">' +
                (always ? ' <span class="kps-hint ms-1">always</span>' : '') + '</td></tr>';
        }).join('');
        return '<div class="table-responsive"><table class="table align-middle mb-0 kps-table"><thead><tr>' +
            '<th>Role</th><th>Edit batch number</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function batchCard(cfg) {
        var v = (cfg.settings && cfg.settings.bag_numbering) === 'renumber' ? 'renumber' : 'stable';
        var body = '<div class="mb-3"><label class="form-label" for="kpsBagNumbering">Bag numbering when a bag is deleted</label>' +
            '<select class="form-select kps-select" id="kpsBagNumbering"' + dis() + '>' +
            '<option value="stable"' + (v === 'stable' ? ' selected' : '') + '>Keep numbers fixed (recommended)</option>' +
            '<option value="renumber"' + (v === 'renumber' ? ' selected' : '') + '>Renumber 1..N</option></select></div>' +
            '<h6 class="mt-3">Who may edit a batch number</h6><div id="kpsRoleAccess">' + roleAccessHtml() + '</div>';
        return card('Batch numbers & bags', body, saveBtn('kpsSaveBatch'));
    }

    function listHtml(kind, items) {
        var rows = (items || []).map(function (it) {
            var active = it.is_active !== false;
            return '<div class="kps-list-item' + (active ? '' : ' kps-inactive') + '" data-id="' + esc(it.id) + '">' +
                '<span class="kps-list-name">' + esc(it.name) + (active ? '' : ' (inactive)') + '</span>' +
                (canEdit()
                    ? '<button type="button" class="btn btn-outline-secondary btn-sm kps-rename" data-kind="' + kind + '">Rename</button>' +
                      '<button type="button" class="btn btn-outline-secondary btn-sm kps-toggle" data-kind="' + kind + '">' + (active ? 'Deactivate' : 'Reactivate') + '</button>'
                    : '') + '</div>';
        }).join('');
        if (!rows) rows = '<div class="text-muted py-2">None yet.</div>';
        var add = canEdit()
            ? '<div class="input-group input-group-sm mt-3"><input type="text" class="form-control kps-add-name" maxlength="120" placeholder="Name" aria-label="New name">' +
              '<button type="button" class="btn btn-primary kps-add" data-kind="' + kind + '"><i class="fas fa-plus me-1"></i>Add</button></div>'
            : '';
        return rows + add;
    }

    function transportCard(cfg) {
        var body = '<div class="row g-4"><div class="col-md-6"><h6>Transport companies</h6><div id="kpsTransporters">' +
            listHtml('transporter', cfg.transporters) + '</div></div>' +
            '<div class="col-md-6"><h6>Transport types</h6><div id="kpsTransportTypes">' +
            listHtml('type', cfg.transport_types) + '</div></div></div>';
        return card('Transport', body, '');
    }

    function siloCard(cfg) {
        var cap = {};
        (cfg.silos || []).forEach(function (s) { cap[s.silo_number] = s.capacity_kg; });
        var cells = '';
        for (var n = 1; n <= SILO_COUNT; n++) {
            cells += '<div class="col-6 col-md-3"><label class="form-label" for="kpsSilo' + n + '">Silo ' + n + ' (kg)</label>' +
                '<input type="number" step="any" min="0" class="form-control form-control-sm kps-num kps-silo" id="kpsSilo' + n + '" data-silo="' + n + '" value="' + numAttr(cap[n]) + '"' + dis() + '></div>';
        }
        return card('Silo capacity', '<div class="row g-3 kps-silo-grid">' + cells + '</div>', saveBtn('kpsSaveSilos'));
    }

    function render() {
        var cfg = state.cfg;
        $('#kpsNotice').html(canEdit() ? '' :
            '<div class="alert alert-info">You can view these settings. Ask an admin for \'Edit Kernel Pipeline Settings\' to change them.</div>');
        $('#kpsBody').html(specCard(cfg) + crateCard(cfg) + batchCard(cfg) + transportCard(cfg) + siloCard(cfg));
    }

    // ------------------------------------------------------------------
    // Loading.
    // ------------------------------------------------------------------

    async function loadRoleAccess() {
        state.roleAccessOk = false;
        try {
            var out = await Promise.all([dataFunctions.getRoles(), dataFunctions.getActions(), dataFunctions.getRoleActions()]);
            state.roles = Array.isArray(out[0]) ? out[0] : [];
            state.actions = Array.isArray(out[1]) ? out[1] : [];
            state.roleActions = Array.isArray(out[2]) ? out[2] : [];
            state.roleAccessOk = state.roles.length > 0;
        } catch (e) {
            state.roleAccessOk = false;
        }
    }

    async function load() {
        var res;
        try { res = await dataFunctions.getKernelPipelineConfig(); } catch (e) { res = { success: false, error: e && e.message }; }
        if (!res || res.success === false) {
            $('#kpsNotice').html('');
            $('#kpsBody').html('<div class="alert alert-warning">Kernel Pipeline Settings aren\'t set up on this database yet.</div>');
            return;
        }
        state.cfg = res;
        await loadRoleAccess();
        render();
    }

    async function reloadConfig() {
        var res = await dataFunctions.getKernelPipelineConfig();
        if (res && res.success !== false) { state.cfg = res; render(); }
    }

    // ------------------------------------------------------------------
    // Saving. Each runs its calls in turn and reports the first failure.
    // ------------------------------------------------------------------

    async function runAll(btn, calls, okMsg) {
        if (!calls.length) { toast('Nothing to save.', 'info'); return; }
        $(btn).prop('disabled', true);
        try {
            for (var i = 0; i < calls.length; i++) {
                var res = await calls[i]();
                if (!res || res.success === false) {
                    toast(errText(res, 'Could not save.'), 'error');
                    return;
                }
            }
            toast(okMsg, 'success');
            await reloadConfig();
        } catch (e) {
            toast((e && e.message) || 'Could not save.', 'error');
        } finally {
            $(btn).prop('disabled', false);
        }
    }

    function saveSpec(btn) {
        var calls = [], bad = false;
        $('#kpsBody tr[data-test]').each(function () {
            var $r = $(this), key = $r.attr('data-test');
            var g = numOrNull($r.find('.kps-green').val()), y = numOrNull($r.find('.kps-yellow').val());
            var dir = $r.find('.kps-dir').val() === 'min' ? 'min' : 'max';
            if ((g != null && (isNaN(g) || g < 0)) || (y != null && (isNaN(y) || y < 0))) { bad = true; return false; }
            var old = (state.cfg.spec_thresholds || []).filter(function (t) { return t.test_key === key; })[0] || {};
            if (old.direction === dir && same(old.green_limit, g) && same(old.yellow_limit, y)) return;
            calls.push(function () { return dataFunctions.upsertSampleSpecThreshold(key, dir, g, y); });
        });
        if (bad) { toast('Limits must be numbers of 0 or more.', 'error'); return; }
        runAll(btn, calls, 'Sample spec limits saved.');
    }

    function saveCrates(btn) {
        var calls = [], bad = false;
        $('#kpsBody tr[data-crate]').each(function () {
            var $r = $(this), stage = $r.attr('data-stage'), type = $r.attr('data-crate');
            var kg = numOrNull($r.find('.kps-kg').val());
            if (kg != null && (isNaN(kg) || kg <= 0)) { bad = true; return false; }
            var old = (state.cfg.crate_weights || []).filter(function (c) { return c.stage === stage && c.crate_type === type; })[0] || {};
            if (same(old.kg_per_crate, kg)) return;
            calls.push(function () { return dataFunctions.upsertCrateWeight(stage, type, kg); });
        });
        if (bad) { toast('Kg per crate must be more than 0, or blank for manual entry.', 'error'); return; }
        runAll(btn, calls, 'Kg per crate saved.');
    }

    function saveBatch(btn) {
        var v = $('#kpsBagNumbering').val() === 'renumber' ? 'renumber' : 'stable';
        runAll(btn, [function () { return dataFunctions.setKernelPipelineSetting('bag_numbering', v); }], 'Batch number settings saved.');
    }

    function saveSilos(btn) {
        var calls = [], bad = false;
        $('#kpsBody .kps-silo').each(function () {
            var n = Number($(this).attr('data-silo')), kg = numOrNull($(this).val());
            var old = (state.cfg.silos || []).filter(function (s) { return Number(s.silo_number) === n; })[0] || {};
            if (kg == null) return;
            if (isNaN(kg) || kg <= 0) { bad = true; return false; }
            if (same(old.capacity_kg, kg)) return;
            calls.push(function () { return dataFunctions.upsertSiloCapacity(n, kg); });
        });
        if (bad) { toast('Silo capacity must be more than 0.', 'error'); return; }
        runAll(btn, calls, 'Silo capacity saved.');
    }

    async function transportSave(kind, name, id, isActive, okMsg) {
        var fn = kind === 'transporter' ? 'upsertTransporter' : 'upsertTransportType';
        try {
            var res = await dataFunctions[fn](name, id, isActive);
            if (!res || res.success === false) { toast(errText(res, 'Could not save.'), 'error'); return; }
            toast(okMsg, 'success');
            await reloadConfig();
        } catch (e) {
            toast((e && e.message) || 'Could not save.', 'error');
        }
    }

    function findItem(kind, id) {
        var list = (kind === 'transporter' ? state.cfg.transporters : state.cfg.transport_types) || [];
        return list.filter(function (x) { return String(x.id) === String(id); })[0];
    }

    async function toggleRole(chk) {
        var $c = $(chk), on = $c.prop('checked'), roleId = $c.attr('data-role-id'), actionId = $c.attr('data-action-id');
        $c.prop('disabled', true);
        try {
            if (on) await dataFunctions.createRoleAction({ role_id: roleId, action_id: actionId, value: 'true' });
            else await dataFunctions.deleteRoleActionForRole(roleId, actionId);
            toast('Role access updated.', 'success');
        } catch (e) {
            $c.prop('checked', !on);
            toast((e && e.message) || 'Could not update role access.', 'error');
        } finally {
            $c.prop('disabled', false);
        }
    }

    // ------------------------------------------------------------------
    // Events.
    // ------------------------------------------------------------------

    function bind() {
        var $d = $(document);
        $d.on('click' + NS, '#kpsSaveSpec', function () { saveSpec(this); });
        $d.on('click' + NS, '#kpsSaveCrates', function () { saveCrates(this); });
        $d.on('click' + NS, '#kpsSaveBatch', function () { saveBatch(this); });
        $d.on('click' + NS, '#kpsSaveSilos', function () { saveSilos(this); });
        $d.on('click' + NS, '#kpsGoRolePerms', function () {
            if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) _appRouter.routeTo('role-permissions-grid');
        });
        $d.on('change' + NS, '#kpsModule .kps-role-chk', function () { toggleRole(this); });
        $d.on('click' + NS, '#kpsModule .kps-add', function () {
            var kind = $(this).attr('data-kind');
            var name = $.trim($(this).closest('.input-group').find('.kps-add-name').val());
            if (!name) { toast('Enter a name first.', 'error'); return; }
            transportSave(kind, name, null, true, 'Added.');
        });
        $d.on('keydown' + NS, '#kpsModule .kps-add-name', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); $(this).closest('.input-group').find('.kps-add').trigger('click'); }
        });
        $d.on('click' + NS, '#kpsModule .kps-rename', async function () {
            var kind = $(this).attr('data-kind'), id = $(this).closest('.kps-list-item').attr('data-id');
            var it = findItem(kind, id);
            if (!it || typeof Swal === 'undefined') return;
            var r = await Swal.fire({ title: 'Rename', input: 'text', inputValue: it.name, showCancelButton: true, confirmButtonText: 'Save' });
            var name = r && r.isConfirmed ? $.trim(r.value || '') : '';
            if (!name || name === it.name) return;
            transportSave(kind, name, it.id, it.is_active !== false, 'Renamed.');
        });
        $d.on('click' + NS, '#kpsModule .kps-toggle', function () {
            var kind = $(this).attr('data-kind'), id = $(this).closest('.kps-list-item').attr('data-id');
            var it = findItem(kind, id);
            if (!it) return;
            var nowActive = it.is_active !== false;
            transportSave(kind, it.name, it.id, !nowActive, nowActive ? 'Deactivated.' : 'Reactivated.');
        });
    }

    return {
        init: function () {
            _kernelPipelineSettingsGrid.destroy();
            bind();
            load();
        },
        destroy: function () {
            $(document).off(NS);
        }
    };
}());

window._kernelPipelineSettingsGrid = _kernelPipelineSettingsGrid;
