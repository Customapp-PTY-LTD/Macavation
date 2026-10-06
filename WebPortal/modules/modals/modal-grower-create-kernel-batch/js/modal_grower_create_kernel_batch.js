/**
 * Modal: New Delivery (Grower Intake). Was "Create kernel batch".
 * Parent calls show(); modal owns init, show, clearForm, save.
 * Uses container id: createKernelBatchModal
 */
var _modal_grower_create_kernel_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'createKernelBatchModal';
    var CREATE_ACTION_KEY = 'grower.intake.create';

    function canCreateIntakeBatch() {
        if (typeof actionAccess !== 'undefined' && actionAccess.denyUnless) {
            return actionAccess.denyUnless(CREATE_ACTION_KEY, 'You do not have permission to create kernel intake batches.');
        }
        if (typeof hasAction === 'function' && !hasAction(CREATE_ACTION_KEY)) {
            if (typeof Swal !== 'undefined') {
                Swal.fire('Not permitted', 'You do not have permission to create kernel intake batches.', 'warning');
            }
            return false;
        }
        return true;
    }

    function applyCreateBatchActionGates() {
        if (typeof actionAccess !== 'undefined' && actionAccess.apply) {
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl) actionAccess.apply(modalEl);
        }
    }

    var SUPPLIER_TYPES = ['nis_supplier', 'supplier', 'both'];
    /** True after user edits batch number; date-only changes won't overwrite until grower changes or Refresh. */
    var _batchNumberUserCustom = false;
    /** Set when modal is opened from the procurement calendar; cleared on close or save. */
    var _pendingProcurementId = null;
    var _pendingGrowerNameOverride = null;

    var EDIT_BATCH_NUMBER_KEY = 'grower_intake.edit_batch_number';
    var DOC_FOLDER = 'Macavation/Deliveries';

    // ---- New Delivery state (reset on every show) ----
    /** [{no, desc, kg}] kg is the raw input string; saved values are parsed to plain numbers. */
    var _bags = [];
    var _nextBagNo = 1;
    /** 'stable' (a deleted number is never reused) or 'renumber' (1..N on delete). */
    var _bagNumbering = 'stable';
    var _transporters = [];
    var _transportTypes = [];
    /** False when get_kernel_pipeline_config failed: transporter / type are then optional so saving still works. */
    var _configLoaded = false;
    var _collectionAddresses = [];
    var _selectedCollection = [];
    var _supplierLoadSeq = 0;
    var _docs = [];
    var _uploadsInFlight = 0;

    function esc(v) {
        if (typeof _common !== 'undefined' && _common.escapeHtml) return _common.escapeHtml(v == null ? '' : String(v));
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtKg(v) {
        if (typeof _common !== 'undefined' && _common.formatKg) return _common.formatKg(v);
        var n = Number(v);
        return isFinite(n) ? n.toFixed(2) : '';
    }

    function fmtRand(v) {
        var t = fmtKg(v);
        return t === '' ? '-' : 'R ' + t;
    }

    function numOrNull(raw) {
        var t = String(raw == null ? '' : raw).trim();
        if (t === '') return null;
        var n = parseFloat(t);
        return isFinite(n) ? n : null;
    }

    function byId(id) { return document.getElementById(id); }

    function canEditBatchNumber() {
        return typeof window.hasAction === 'function' && window.hasAction(EDIT_BATCH_NUMBER_KEY);
    }

    function bagTotal() {
        return _bags.reduce(function (sum, b) {
            var n = numOrNull(b.kg);
            return sum + (n != null && n > 0 ? n : 0);
        }, 0);
    }

    function setText(id, text) {
        var el = byId(id);
        if (el) el.textContent = text;
    }

    function showInline(id, text) {
        var el = byId(id);
        if (!el) return;
        if (text) { el.textContent = text; el.style.display = ''; }
        else { el.textContent = ''; el.style.display = 'none'; }
    }

    var api = {
        init: function () {
            // init() runs at script load AND again from the Grower Intake grid after the modal HTML
            // is inserted. Bind once per inserted modal DOM, or every listener fires twice (two bags
            // deleted per click, two saves per Save).
            var bindMarker = document.getElementById(CONTAINER_ID);
            if (bindMarker && bindMarker.getAttribute('data-kp-bound') === '1') return;
            if (bindMarker) bindMarker.setAttribute('data-kp-bound', '1');
            applyCreateBatchActionGates();
            var saveBtn = document.getElementById('saveCreateKernelBatchBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            // Clear pending procurement on cancel / close
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl) {
                modalEl.addEventListener('hidden.bs.modal', function () {
                    _pendingProcurementId = null;
                    _pendingGrowerNameOverride = null;
                    var banner = document.getElementById('intakeProcurementBanner');
                    if (banner) banner.style.display = 'none';
                });
            }
            var addSupplierBtn = document.getElementById('intakeAddSupplierBtn');
            if (addSupplierBtn) addSupplierBtn.addEventListener('click', function (e) { e.preventDefault(); api.showAddSupplierForm(); });
            var newSupplierSubmit = document.getElementById('intakeNewSupplierSubmitBtn');
            if (newSupplierSubmit) newSupplierSubmit.addEventListener('click', function (e) { e.preventDefault(); api.submitNewSupplierForm(); });
            var newSupplierCancel = document.getElementById('intakeNewSupplierCancelBtn');
            if (newSupplierCancel) newSupplierCancel.addEventListener('click', function (e) { e.preventDefault(); api.hideAddSupplierForm(); });
            var refreshBatchBtn = document.getElementById('intakeRefreshBatchNumberBtn');
            if (refreshBatchBtn) refreshBatchBtn.addEventListener('click', function (e) { e.preventDefault(); api._refreshSuggestedBatchNumber(true); });
            var batchNumInput = document.getElementById('intakeBatchNumber');
            if (batchNumInput) {
                batchNumInput.addEventListener('input', function () { _batchNumberUserCustom = true; });
            }
            var dateEl = document.getElementById('intakeBatchReceivedDate');
            if (dateEl) {
                dateEl.removeEventListener('change', api._onReceivedDateChange);
                dateEl.addEventListener('change', api._onReceivedDateChange);
            }
            var declEl = byId('intakeBatchWetNis');
            if (declEl) declEl.addEventListener('input', api._updateCalcs);
            var rateEl = byId('intakeTransportRate');
            if (rateEl) rateEl.addEventListener('input', api._updateCalcs);
            var addBagBtn = byId('intakeAddBagBtn');
            if (addBagBtn) addBagBtn.addEventListener('click', function (e) { e.preventDefault(); api._addBag(); });
            var bagsBody = byId('intakeBagsBody');
            if (bagsBody) {
                bagsBody.addEventListener('input', function (e) {
                    var t = e.target;
                    if (!t || !t.getAttribute) return;
                    var idx = parseInt(t.getAttribute('data-bag-idx'), 10);
                    if (isNaN(idx) || !_bags[idx]) return;
                    if (t.getAttribute('data-bag-field') === 'kg') { _bags[idx].kg = t.value; api._updateCalcs(); }
                });
                bagsBody.addEventListener('change', function (e) {
                    var t = e.target;
                    if (!t || !t.getAttribute) return;
                    var idx = parseInt(t.getAttribute('data-bag-idx'), 10);
                    if (isNaN(idx) || !_bags[idx]) return;
                    if (t.getAttribute('data-bag-field') === 'desc') _bags[idx].desc = t.value;
                });
                bagsBody.addEventListener('click', function (e) {
                    var btn = e.target && e.target.closest ? e.target.closest('[data-bag-del]') : null;
                    if (!btn) return;
                    e.preventDefault();
                    api._deleteBag(parseInt(btn.getAttribute('data-bag-del'), 10));
                });
            }
            var addTrBtn = byId('intakeAddTransporterBtn');
            if (addTrBtn) addTrBtn.addEventListener('click', function (e) { e.preventDefault(); api._toggleTransporterForm(true); });
            var trCancel = byId('intakeNewTransporterCancelBtn');
            if (trCancel) trCancel.addEventListener('click', function (e) { e.preventDefault(); api._toggleTransporterForm(false); });
            var trSave = byId('intakeNewTransporterSaveBtn');
            if (trSave) trSave.addEventListener('click', function (e) { e.preventDefault(); api._saveNewTransporter(); });
            var cpWrap = byId('intakeCollectionPoints');
            if (cpWrap) cpWrap.addEventListener('change', function (e) {
                var t = e.target;
                if (!t || !t.getAttribute || t.getAttribute('data-cp-idx') == null) return;
                var addr = _collectionAddresses[parseInt(t.getAttribute('data-cp-idx'), 10)];
                if (addr == null) return;
                var at = _selectedCollection.indexOf(addr);
                if (t.checked && at < 0) _selectedCollection.push(addr);
                if (!t.checked && at >= 0) _selectedCollection.splice(at, 1);
            });
            var docsToggle = byId('intakeDocsToggleBtn');
            if (docsToggle) docsToggle.addEventListener('click', function (e) {
                e.preventDefault();
                var body = byId('intakeDocsBody');
                if (!body) return;
                var open = body.style.display === 'none';
                body.style.display = open ? '' : 'none';
                docsToggle.textContent = open ? 'Minimise \u25B4' : 'Maximise \u25BE';
                docsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            var docsInput = byId('intakeDeliveryDocs');
            if (docsInput) docsInput.addEventListener('change', function () { api._uploadDocs(docsInput); });
        },

        // ---------- New Delivery: bags ----------

        _renderBags: function () {
            var body = byId('intakeBagsBody');
            if (!body) return;
            var html = '';
            _bags.forEach(function (b, i) {
                html += '<tr>' +
                    '<td><strong>' + esc(b.no) + '</strong></td>' +
                    '<td><select class="form-select form-select-sm" data-bag-idx="' + i + '" data-bag-field="desc" aria-label="Description bag ' + esc(b.no) + '">' +
                    '<option value="NIS"' + (b.desc === 'NIS' ? ' selected' : '') + '>NIS</option>' +
                    '<option value="Kernel"' + (b.desc === 'Kernel' ? ' selected' : '') + '>Kernel</option></select></td>' +
                    '<td><input type="number" step="0.01" min="0" class="form-control form-control-sm text-end" data-bag-idx="' + i + '" data-bag-field="kg" value="' + esc(b.kg) + '" aria-label="Weight bag ' + esc(b.no) + '"></td>' +
                    '<td><button type="button" class="btn btn-sm btn-outline-secondary" data-bag-del="' + i + '" aria-label="Remove bag ' + esc(b.no) + '">\u2715</button></td>' +
                    '</tr>';
            });
            body.innerHTML = html;
            api._updateCalcs();
        },

        _addBag: function () {
            var prev = _bags.length ? _bags[_bags.length - 1].desc : 'NIS';
            _bags.push({ no: _nextBagNo, desc: prev, kg: '' });
            _nextBagNo += 1;
            api._renderBags();
            var inputs = document.querySelectorAll('#intakeBagsBody input[data-bag-field="kg"]');
            if (inputs.length) inputs[inputs.length - 1].focus();
        },

        _deleteBag: function (idx) {
            if (isNaN(idx) || !_bags[idx]) return;
            _bags.splice(idx, 1);
            if (_bagNumbering === 'renumber') {
                _bags.forEach(function (b, i) { b.no = i + 1; });
                _nextBagNo = _bags.length + 1;
            }
            api._renderBags();
        },

        /** Weighed total, bag count, declared-vs-weighed warning and the transport rate maths. */
        _updateCalcs: function () {
            var total = bagTotal();
            var count = _bags.length;
            setText('intakeBagCount', String(count));
            setText('intakeBagTotal', fmtKg(total) || '0.00');
            setText('intakePallets', String(count));

            var declared = numOrNull(byId('intakeBatchWetNis') && byId('intakeBatchWetNis').value);
            var warn = '';
            if (declared != null && declared > 0 && total > 0 && Math.abs(total - declared) >= 0.005) {
                var diff = Math.abs(total - declared);
                warn = 'Weighed total is ' + fmtKg(diff) + ' kg ' + (total < declared ? 'less' : 'more') +
                    " than the supplier's declared weight. Both figures are kept.";
            }
            showInline('intakeDeclDiffWarning', warn);

            var rate = numOrNull(byId('intakeTransportRate') && byId('intakeTransportRate').value);
            setText('intakeRatePerPallet', rate != null && count > 0 ? fmtRand(rate / count) : '-');
            setText('intakeRatePerKg', rate != null && total > 0 ? fmtRand(rate / total) : '-');
        },

        // ---------- New Delivery: transport ----------

        _fillTransportSelects: function (selectTransporterId) {
            var tr = byId('intakeTransporter');
            var tt = byId('intakeTransportType');
            if (tr) {
                var html = '<option value="">Select transporter</option>';
                _transporters.forEach(function (t) { html += '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; });
                tr.innerHTML = html;
                if (selectTransporterId) tr.value = selectTransporterId;
            }
            if (tt) {
                var html2 = '<option value="">Select transport type</option>';
                _transportTypes.forEach(function (t) { html2 += '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; });
                tt.innerHTML = html2;
            }
        },

        /** Loads transporters, transport types and the bag numbering mode. Failure degrades, never blocks. */
        _loadConfig: async function () {
            _configLoaded = false;
            _transporters = [];
            _transportTypes = [];
            _bagNumbering = 'stable';
            showInline('intakeTransportNotice', '');
            try {
                var cfg = (typeof dataFunctions !== 'undefined' && dataFunctions.getKernelPipelineConfig)
                    ? await dataFunctions.getKernelPipelineConfig() : null;
                if (!cfg || cfg.success === false) throw new Error((cfg && cfg.error) || 'config unavailable');
                _configLoaded = true;
                _transporters = (cfg.transporters || []).filter(function (t) { return t && t.is_active !== false; });
                _transportTypes = (cfg.transport_types || []).filter(function (t) { return t && t.is_active !== false; });
                if (cfg.settings && cfg.settings.bag_numbering === 'renumber') _bagNumbering = 'renumber';
            } catch (err) {
                console.warn('[New Delivery] Pipeline config not available:', err);
                showInline('intakeTransportNotice', 'The transporter and transport type lists could not be loaded, so they are optional for now. The delivery can still be saved.');
            }
            api._fillTransportSelects();
        },

        _toggleTransporterForm: function (show) {
            var form = byId('intakeNewTransporterForm');
            if (!form) return;
            form.style.display = show ? '' : 'none';
            showInline('intakeNewTransporterError', '');
            var nameEl = byId('intakeNewTransporterName');
            if (nameEl) { nameEl.value = ''; if (show) setTimeout(function () { nameEl.focus(); }, 50); }
        },

        _saveNewTransporter: async function () {
            var nameEl = byId('intakeNewTransporterName');
            var name = nameEl && nameEl.value ? nameEl.value.trim() : '';
            if (!name) { showInline('intakeNewTransporterError', 'Transport company name is required.'); return; }
            try {
                var res = await dataFunctions.upsertTransporter(name);
                if (!res || res.success === false || !res.id) throw new Error((res && res.error) || 'Could not save the transport company');
                if (!_transporters.some(function (t) { return String(t.id) === String(res.id); })) {
                    _transporters.push({ id: res.id, name: res.name || name, is_active: true });
                }
                api._fillTransportSelects(res.id);
                api._toggleTransporterForm(false);
            } catch (err) {
                showInline('intakeNewTransporterError', err.message || 'Could not save the transport company');
            }
        },

        // ---------- New Delivery: collection points ----------

        _renderCollectionPoints: function () {
            var wrap = byId('intakeCollectionPoints');
            if (!wrap) return;
            if (!_collectionAddresses.length) {
                var hint = byId('intakeBatchGrower') && byId('intakeBatchGrower').value
                    ? 'This supplier has no addresses in CRM yet.'
                    : 'Select a supplier to see their CRM addresses.';
                wrap.innerHTML = '<span class="small text-muted">' + esc(hint) + '</span>';
                return;
            }
            var html = '';
            _collectionAddresses.forEach(function (a, i) {
                var checked = _selectedCollection.indexOf(a) >= 0;
                html += '<label class="border rounded px-2 py-1 d-inline-flex align-items-center gap-2">' +
                    '<input type="checkbox" class="form-check-input mt-0" data-cp-idx="' + i + '"' + (checked ? ' checked' : '') + '>' +
                    '<span>' + esc(a) + '</span>' +
                    '<a href="https://www.google.com/maps?q=' + encodeURIComponent(a) + '" target="_blank" rel="noopener">Map \u2197</a>' +
                    '</label>';
            });
            wrap.innerHTML = html;
        },

        /** Builds the supplier's CRM address (line 1, area, city) and offers it as a collection point. */
        _loadCollectionPoints: async function (supplierId) {
            var seq = ++_supplierLoadSeq;
            _collectionAddresses = [];
            _selectedCollection = [];
            api._renderCollectionPoints();
            if (!supplierId || typeof dataFunctions === 'undefined' || !dataFunctions.getContactById) return;
            try {
                var raw = await dataFunctions.getContactById(supplierId);
                if (seq !== _supplierLoadSeq) return;
                var c = Array.isArray(raw) ? raw[0] : raw;
                if (c && !c.id && Array.isArray(c.get_contact_by_id)) c = c.get_contact_by_id[0];
                if (c) {
                    var addr = [c.physical_address_line1, c.physical_area, c.physical_city]
                        .map(function (p) { return p == null ? '' : String(p).trim(); })
                        .filter(function (p) { return p; }).join(', ');
                    if (addr) _collectionAddresses = [addr];
                }
            } catch (err) {
                console.warn('[New Delivery] Could not load supplier address:', err);
            }
            if (seq === _supplierLoadSeq) api._renderCollectionPoints();
        },

        // ---------- New Delivery: supporting documents ----------

        _renderDocs: function () {
            var ul = byId('intakeDocsList');
            if (!ul) return;
            ul.innerHTML = '';
            _docs.forEach(function (d) {
                var li = document.createElement('li');
                if (d.file_link && /^https?:\/\//i.test(d.file_link)) {
                    var a = document.createElement('a');
                    a.href = d.file_link; a.target = '_blank'; a.rel = 'noopener';
                    a.textContent = d.name;
                    li.appendChild(a);
                } else {
                    li.textContent = d.name;
                }
                ul.appendChild(li);
            });
        },

        _uploadDocs: async function (input) {
            var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
            if (!files.length) return;
            if (typeof _common === 'undefined' || !_common.uploadFile) { showInline('intakeDocsError', 'Upload is not available.'); return; }
            showInline('intakeDocsError', '');
            var errors = [];
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                _uploadsInFlight += 1;
                try {
                    var safeName = (file.name || 'file').replace(/[^\w.-]/g, '_');
                    var fileId = 'del_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + safeName;
                    var res = await _common.uploadFile({ file: file, resourceFolder: DOC_FOLDER, fileId: fileId });
                    if (!res || !res.Success) {
                        errors.push(file.name + ': ' + ((res && res.LastErrorDescription) || 'Upload failed'));
                    } else {
                        var data = res.Data;
                        var storedId = (data && data[0] && (data[0].fileId || data[0].key)) || (data && data.fileId) || fileId;
                        var link = (data && data[0] && data[0].fileLink) || (data && data.fileLink) || null;
                        _docs.push({ file_id: storedId, file_link: link, name: file.name });
                    }
                } catch (err) {
                    errors.push(file.name + ': ' + (err.message || 'Upload failed'));
                } finally {
                    _uploadsInFlight -= 1;
                }
            }
            input.value = '';
            api._renderDocs();
            if (errors.length) showInline('intakeDocsError', errors.join(' | '));
        },

        _applyBatchNumberLock: function () {
            var numberEl = byId('intakeBatchNumber');
            var locked = !canEditBatchNumber();
            if (numberEl) { if (locked) numberEl.setAttribute('readonly', 'readonly'); else numberEl.removeAttribute('readonly'); }
            setText('intakeBatchNumberHint', locked
                ? '\uD83D\uDD12 Auto-generated. Your role cannot change it.'
                : 'Auto-generated. Your role is allowed to change it.');
        },

        populateSupplierDropdown: function (preselectSupplierId) {
            var sel = document.getElementById('intakeBatchGrower');
            if (!sel) return;
            sel.innerHTML = '<option value="">Select supplier</option>';
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return;
            dataFunctions.getContacts(null, true).then(function (raw) {
                var contacts = Array.isArray(raw) ? raw : (raw && raw.get_contacts ? raw.get_contacts : (raw && raw.data ? raw.data : []));
                if (!Array.isArray(contacts)) return;
                var suppliers = contacts.filter(function (c) {
                    var t = (c.contact_type || '').trim();
                    return SUPPLIER_TYPES.indexOf(t) >= 0;
                });
                var opts = '<option value="">Select supplier</option>';
                suppliers.forEach(function (c) {
                    var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                    var code = c.supplier_number != null ? ' (' + c.supplier_number + ')' : '';
                    opts += '<option value="' + esc(c.id) + '">' + esc(name + code) + '</option>';
                });
                sel.innerHTML = opts;
                // Pre-select supplier if provided (e.g. from procurement calendar)
                if (preselectSupplierId) {
                    sel.value = preselectSupplierId;
                }
                sel.removeEventListener('change', api._onGrowerChange);
                sel.addEventListener('change', api._onGrowerChange);
                // Trigger batch number suggestion if we pre-selected a supplier
                if (preselectSupplierId && sel.value === preselectSupplierId) {
                    api._onGrowerChange();
                }
            }).catch(function (e) { console.error('Error loading suppliers:', e); });
        },

        showAddSupplierForm: function () {
            var formEl = document.getElementById('intakeNewSupplierForm');
            var nameEl = document.getElementById('intakeNewSupplierName');
            var errEl = document.getElementById('intakeNewSupplierError');
            ['intakeNewSupplierName', 'intakeNewSupplierCode', 'intakeNewSupplierProvince', 'intakeNewSupplierArea', 'intakeNewSupplierContact', 'intakeNewSupplierNotes'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });
            if (formEl) formEl.style.display = '';
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
            if (nameEl) setTimeout(function () { nameEl.focus(); }, 50);
        },

        hideAddSupplierForm: function () {
            var formEl = document.getElementById('intakeNewSupplierForm');
            var errEl = document.getElementById('intakeNewSupplierError');
            if (formEl) formEl.style.display = 'none';
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        },

        submitNewSupplierForm: function () {
            var nameEl = document.getElementById('intakeNewSupplierName');
            var codeEl = document.getElementById('intakeNewSupplierCode');
            var errEl = document.getElementById('intakeNewSupplierError');
            var companyName = nameEl && nameEl.value ? nameEl.value.trim() : '';
            var codeVal = codeEl && codeEl.value !== '' ? parseInt(codeEl.value, 10) : NaN;
            if (!companyName) {
                if (errEl) { errEl.textContent = 'Company name is required.'; errEl.style.display = 'block'; }
                if (nameEl) nameEl.focus();
                return;
            }
            if (isNaN(codeVal) || codeVal < 0) {
                if (errEl) { errEl.textContent = 'Supplier code must be a number (0–99) used for batch naming.'; errEl.style.display = 'block'; }
                if (codeEl) codeEl.focus();
                return;
            }
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
            var data = {
                company_name: companyName,
                supplier_number: codeVal,
                physical_province: (document.getElementById('intakeNewSupplierProvince') && document.getElementById('intakeNewSupplierProvince').value) ? document.getElementById('intakeNewSupplierProvince').value.trim() : null,
                physical_city: (document.getElementById('intakeNewSupplierArea') && document.getElementById('intakeNewSupplierArea').value) ? document.getElementById('intakeNewSupplierArea').value.trim() : null,
                primary_contact_name: (document.getElementById('intakeNewSupplierContact') && document.getElementById('intakeNewSupplierContact').value) ? document.getElementById('intakeNewSupplierContact').value.trim() : null,
                notes: (document.getElementById('intakeNewSupplierNotes') && document.getElementById('intakeNewSupplierNotes').value) ? document.getElementById('intakeNewSupplierNotes').value.trim() : null
            };
            api.doCreateSupplier(data);
        },

        doCreateSupplier: function (data) {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createContact) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create contact not available.', 'error');
                return;
            }
            var payload = {
                contact_type: 'nis_supplier',
                company_name: data.company_name,
                supplier_number: data.supplier_number,
                physical_province: data.physical_province || null,
                physical_city: data.physical_city || null,
                primary_contact_name: data.primary_contact_name || null,
                notes: data.notes || null,
                status: 'active'
            };
            dataFunctions.createContact(payload).then(function (res) {
                var id = (res && res.id) || (res && res.data && res.data.id);
                if (id) {
                    api.hideAddSupplierForm();
                    api.populateSupplierDropdown();
                    var sel = document.getElementById('intakeBatchGrower');
                    if (sel) sel.value = id;
                    api._onGrowerChange();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Supplier added', timer: 1500, showConfirmButton: false });
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (res && res.error) || 'Failed to add supplier', 'error');
                }
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to add supplier', 'error');
            });
        },

        show: async function (options) {
            if (!canCreateIntakeBatch()) return;
            var opts = options || {};
            var today = new Date().toISOString().split('T')[0];

            // Use prefilled received date if provided, else today
            var receivedDate = (opts.receivedDate && String(opts.receivedDate).split('T')[0]) || today;
            var dateEl = document.getElementById('intakeBatchReceivedDate');
            if (dateEl) {
                dateEl.value = receivedDate;
                dateEl.removeEventListener('change', api._onReceivedDateChange);
                dateEl.addEventListener('change', api._onReceivedDateChange);
            }

            _batchNumberUserCustom = false;
            var numberEl = document.getElementById('intakeBatchNumber');
            if (numberEl) numberEl.value = '';
            numberEl && numberEl.setAttribute('placeholder', 'Bn suggestion');

            var wetEl = document.getElementById('intakeBatchWetNis');
            if (wetEl) wetEl.value = opts.wetNisKg != null ? opts.wetNisKg : '';

            _pendingGrowerNameOverride = opts.growerNameOverride || null;

            // New Delivery state: one empty bag row, no transport / documents yet.
            _bags = [{ no: 1, desc: 'NIS', kg: '' }];
            _nextBagNo = 2;
            _docs = [];
            _uploadsInFlight = 0;
            _collectionAddresses = [];
            _selectedCollection = [];
            ['intakeDeliveryNoteRef', 'intakeTransportRate'].forEach(function (id) { var e = byId(id); if (e) e.value = ''; });
            api._toggleTransporterForm(false);
            showInline('intakeDocsError', '');
            api._renderDocs();
            api._renderBags();
            api._renderCollectionPoints();
            api._applyBatchNumberLock();
            api._loadConfig().then(function () { api._renderBags(); });

            api.populateSupplierDropdown(opts.supplierId);

            // Show procurement banner if opened from calendar
            var banner = document.getElementById('intakeProcurementBanner');
            if (banner) banner.style.display = opts.fromProcurement ? '' : 'none';

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        /** Open from the procurement calendar with pre-filled data. */
        showFromProcurement: function (procurement) {
            if (!procurement) return;
            if (!canCreateIntakeBatch()) return;
            _pendingProcurementId = procurement.id || null;
            api.show({
                supplierId:        procurement.supplier_id || null,
                growerNameOverride: procurement.grower_name || null,
                receivedDate:      procurement.scheduled_date || null,
                wetNisKg:          procurement.predicted_weight_kg || null,
                fromProcurement:   true
            });
        },

        _onGrowerChange: function () {
            _batchNumberUserCustom = false;
            api._refreshSuggestedBatchNumber(true);
            var sel = byId('intakeBatchGrower');
            api._loadCollectionPoints(sel && sel.value ? sel.value : null);
        },

        _onReceivedDateChange: function () {
            if (_batchNumberUserCustom) return;
            api._refreshSuggestedBatchNumber(true);
        },

        /** @param {boolean} force - false only used internally when date changes and !custom; grower/refresh always pass true */
        _refreshSuggestedBatchNumber: function (force) {
            var sel = document.getElementById('intakeBatchGrower');
            var numberEl = document.getElementById('intakeBatchNumber');
            if (!sel || !numberEl || typeof dataFunctions === 'undefined' || !dataFunctions.getNextBatchNumber) return;
            var supplierId = (sel.value || '').trim() || null;
            if (!supplierId) {
                if (force) {
                    numberEl.value = '';
                    numberEl.setAttribute('placeholder', 'Suggested Bn… or type any batch number');
                    api._applyBatchNumberLock();
                }
                return;
            }
            if (!force && _batchNumberUserCustom) return;
            numberEl.value = '';
            numberEl.setAttribute('placeholder', 'Loading…');
            var dateEl = document.getElementById('intakeBatchReceivedDate');
            var year = dateEl && dateEl.value ? new Date(dateEl.value + 'T12:00:00').getFullYear() : new Date().getFullYear();
            dataFunctions.getNextBatchNumber(supplierId, year).then(function (nextId) {
                var val = (nextId != null && typeof nextId === 'string') ? nextId : (nextId != null ? String(nextId) : '');
                numberEl.value = val;
                numberEl.setAttribute('placeholder', val ? '' : 'Will assign on save');
                api._applyBatchNumberLock();
                _batchNumberUserCustom = false;
            }).catch(function (err) {
                console.error('getNextBatchNumber failed:', err);
                numberEl.value = '';
                numberEl.setAttribute('placeholder', 'Suggested Bn… or type any batch number');
                api._applyBatchNumberLock();
            });
        },

        save: async function () {
            if (!canCreateIntakeBatch()) return;
            var batchNumber = (byId('intakeBatchNumber') && byId('intakeBatchNumber').value || '').trim();
            var receivedDate = byId('intakeBatchReceivedDate') && byId('intakeBatchReceivedDate').value;
            var wetNis = numOrNull(byId('intakeBatchWetNis') && byId('intakeBatchWetNis').value);
            var supplierEl = byId('intakeBatchGrower');
            var supplierId = supplierEl && supplierEl.value ? supplierEl.value : null;
            var growerName = null;
            if (supplierEl && supplierEl.selectedIndex >= 0) {
                var opt = supplierEl.options[supplierEl.selectedIndex];
                if (opt && opt.text) growerName = opt.text.trim();
            }
            if (growerName === '' || growerName === 'Select supplier') growerName = null;
            // Fall back to procurement grower name override when no supplier selected
            if (!growerName && _pendingGrowerNameOverride) growerName = _pendingGrowerNameOverride;

            var transporterId = byId('intakeTransporter') && byId('intakeTransporter').value || '';
            var transportTypeId = byId('intakeTransportType') && byId('intakeTransportType').value || '';
            var deliveryNoteRef = (byId('intakeDeliveryNoteRef') && byId('intakeDeliveryNoteRef').value || '').trim();
            var rateZar = numOrNull(byId('intakeTransportRate') && byId('intakeTransportRate').value);
            var weighedBags = _bags.map(function (b) {
                return { no: b.no, description: b.desc, weight_kg: numOrNull(b.kg) };
            }).filter(function (b) { return b.weight_kg != null && b.weight_kg > 0; });

            var problems = [];
            if (!receivedDate) problems.push('Date Received is required.');
            if (!supplierId && !growerName) problems.push('Supplier is required.');
            if (!batchNumber) problems.push('Batch Number is required.');
            if (wetNis != null && wetNis < 0) problems.push("Supplier's declared weight cannot be negative.");
            if (!weighedBags.length) problems.push('Add at least one bag with a weight greater than 0.');
            if (!deliveryNoteRef) problems.push('Delivery Note Reference Number is required.');
            // When the pipeline config could not be loaded the lists are empty, so these stay optional.
            if (_configLoaded && !transporterId) problems.push('Select a Transporter.');
            if (_configLoaded && !transportTypeId) problems.push('Select a Transport Type.');
            if (rateZar == null || rateZar < 0) problems.push('Transport Rate (R, whole trip) is required.');
            if (_uploadsInFlight > 0) problems.push('Documents are still uploading. Wait a moment and save again.');
            if (problems.length) {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Please check the delivery',
                        html: '<ul class="text-start mb-0">' + problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
                    });
                }
                return;
            }

            try {
                // Step 1: create row in batches (uses form batch number as human-readable id)
                var batchResult = await dataFunctions.upsertBatch({
                    batch_id:   batchNumber,
                    batch_type: 'kernel'
                });
                if (!batchResult || !batchResult.success || !batchResult.id) {
                    throw new Error(batchResult && batchResult.error ? batchResult.error : 'Failed to create batch record');
                }

                var batchUuid = batchResult.id;
                if (typeof dataFunctions.clearCachePattern === 'function') {
                    dataFunctions.clearCachePattern('kernel_batches');
                }
                var existingRows = await dataFunctions.getKernelBatches(null, true, { search: batchNumber, limit: 200 });
                var sameBatch = (existingRows || []).filter(function (r) {
                    return String(r.batch_number || '').trim() === batchNumber;
                }).find(function (r) {
                    return String(r.batch_id) === String(batchUuid);
                });
                if (sameBatch) {
                    var st = String(sameBatch.status || '').toLowerCase();
                    if (st !== 'intake' && st !== 'receiving') {
                        throw new Error('This batch number is already used (status: ' + (sameBatch.status || 'unknown') + '). It will not appear in Grower Intake. Use a **new, unique** batch number for a new intake batch.');
                    }
                }

                // Step 2: create row in kernel (status = intake)
                var kernelResult = await dataFunctions.initializeKernelForBatch({
                    batch_uuid:           batchUuid,
                    supplier_id:          supplierId   || null,
                    grower_name:          growerName   || null,
                    received_date:        receivedDate || null,
                    wet_nis_received_kg:  wetNis
                });
                var krOk = kernelResult && (kernelResult.success === true || kernelResult.success === 'true' ||
                    (kernelResult.id && kernelResult.success !== false));
                if (!krOk) {
                    throw new Error(kernelResult && kernelResult.error ? kernelResult.error : 'Failed to initialize kernel record');
                }

                // Step 3: bags, transport and documents. The batch already exists, so a failure here is a warning, not an abort.
                var deliveryProblem = null;
                try {
                    if (!kernelResult.id) throw new Error('the new kernel record id was not returned');
                    var transporterRow = _transporters.filter(function (t) { return String(t.id) === String(transporterId); })[0];
                    var typeRow = _transportTypes.filter(function (t) { return String(t.id) === String(transportTypeId); })[0];
                    var deliveryRes = await dataFunctions.saveKernelDelivery({
                        kernel_id: kernelResult.id,
                        bags: weighedBags,
                        transport: {
                            transporter_id: transporterId || null,
                            transporter_name: transporterRow ? transporterRow.name : null,
                            delivery_note_ref: deliveryNoteRef,
                            collection_points: _selectedCollection.slice(),
                            transport_type_id: transportTypeId || null,
                            transport_type_name: typeRow ? typeRow.name : null,
                            rate_zar: rateZar
                        },
                        documents: _docs.slice()
                    });
                    if (!deliveryRes || deliveryRes.success === false) {
                        throw new Error((deliveryRes && deliveryRes.error) || 'the delivery details were rejected');
                    }
                } catch (delErr) {
                    console.warn('[New Delivery] saveKernelDelivery failed:', delErr);
                    deliveryProblem = (delErr && delErr.message) || 'unknown error';
                }

                var modalEl = document.getElementById(CONTAINER_ID);
                if (modalEl && typeof bootstrap !== 'undefined') {
                    var inst = bootstrap.Modal.getInstance(modalEl);
                    if (inst) inst.hide();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#' + CONTAINER_ID).modal('hide');
                }

                // If opened from procurement calendar, mark the procurement as converted
                if (_pendingProcurementId) {
                    var pendingId = _pendingProcurementId;
                    _pendingProcurementId = null;
                    _pendingGrowerNameOverride = null;
                    var banner = document.getElementById('intakeProcurementBanner');
                    if (banner) banner.style.display = 'none';
                    var dfConvert = (typeof _dataFunctions !== 'undefined' && _dataFunctions) ? _dataFunctions
                        : (typeof dataFunctions !== 'undefined' ? dataFunctions : null);
                    if (dfConvert && typeof dfConvert.convertKernelIntakeProcurement === 'function') {
                        dfConvert.convertKernelIntakeProcurement(pendingId, batchUuid).catch(function (err) {
                            console.warn('[New Delivery] Failed to convert procurement:', err);
                        });
                    }
                }

                if (typeof Swal !== 'undefined') {
                    if (deliveryProblem) {
                        Swal.fire({
                            icon: 'warning',
                            title: 'Batch created, delivery details not saved',
                            text: 'Batch ' + batchNumber + ' was created, but its bag weights, transport details, collection points and documents were NOT saved (' + deliveryProblem + '). Open the batch to add them again.'
                        });
                    } else {
                        Swal.fire({
                            icon: 'success',
                            title: 'Delivery saved',
                            text: 'Kernel batch is in intake. Complete Stage 1 steps then move to raw stock when ready.',
                            timer: 2500,
                            showConfirmButton: false
                        });
                    }
                }

                if (typeof dataFunctions.clearCachePattern === 'function') {
                    dataFunctions.clearCachePattern('kernel_batches');
                }
                var grid = (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.loadIntakeBatches) ? _growerIntakeGrid
                    : (typeof window.growerIntakeGrid !== 'undefined' && window.growerIntakeGrid.loadIntakeBatches ? window.growerIntakeGrid : null);
                if (grid) {
                    await grid.loadIntakeBatches(true);
                    // Refresh procurement calendar to remove converted entry
                    if (typeof grid.loadProcurements === 'function') grid.loadProcurements(true);
                } else {
                    console.warn('[New Delivery] Grower Intake grid not found; refresh the page to see the new batch.');
                }
            } catch (e) {
                console.error(e);
                var msg = e.message || '';
                var isRbacDenied = msg.indexOf('operation EXECUTE is not allowed') >= 0 || msg.indexOf('Access denied') >= 0;
                if (typeof Swal !== 'undefined') {
                    if (isRbacDenied) {
                        Swal.fire({
                            icon: 'error',
                            title: 'Permission denied',
                            html: 'Creating a batch was blocked by the server. <strong>Ask an admin</strong> to either set the Lambda env <code>SUPABASE_URL</code> to the project where permissions were granted, or run the EXECUTE grants on the database the server uses. See <strong>BluePrint/RBAC_GUIDE.md</strong> or <strong>LAMBDA_ENV_REQUIRED.md</strong>.'
                        });
                    } else {
                        Swal.fire('Error', msg || 'Failed to save delivery', 'error');
                    }
                }
            }
        }
    };
    return api;
})();
_modal_grower_create_kernel_batch.init();
