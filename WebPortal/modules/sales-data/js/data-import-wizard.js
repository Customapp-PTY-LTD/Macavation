/**
 * Fill gaps from a file - the import wizard opened from the Data health tab.
 *
 * Four steps, built from the approved mockup
 * (CustomappReports/Macavation-Fill-Gaps-Import-Mockup-2026-10-14.html):
 *   1. Choose  - which page, which dates, Excel/CSV or Photo/PDF.
 *   2. AI reads it
 *        spreadsheet: SheetJS reads every sheet here in the browser; only the headings and up to five
 *                     sample rows go to the AI (read-import-file / map_columns), which says which
 *                     column is which. Every value is then read from the cells below, never by the AI.
 *        document:    the AI reads the photo/PDF into rows (read_document); every field is editable
 *                     and anything under 85% sure is flagged "check".
 *   3. Check   - every row is new / already in the system / not recognised / outside the dates /
 *                needs a fix, with a per-month reconciliation against the file itself.
 *   4. Saved   - import_data_page_rows writes the ticked rows as one batch; Undo removes it.
 *
 * Production (daily) is not importable here: its gaps are filled from the factory with "Refresh from
 * factory" on the Production tab.
 *
 * Saving goes through import_data_page_rows (migrations/20261015090000), never the upsert RPCs: those
 * force data_source = 'manual', and an import must stay identifiable so its batch can be undone.
 *
 * Security: every file, database and AI value reaches the DOM through textContent / .value only.
 */
var DataImportWizard = (function () {
    'use strict';

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var LOW_CONFIDENCE = 0.85;
    var MAX_SHEET_BYTES = 10 * 1024 * 1024;
    var MAX_DOC_BYTES = 8 * 1024 * 1024;
    var IMAGE_LONG_EDGE = 2000;
    var PAGE = 500;

    // What each importable page is, in terms the wizard needs. Field definitions themselves come from
    // SalesDataColumnDefs; this only names the roles of a few columns.
    var DATASETS = {
        nis_intake: {
            label: 'Nut in Shell Intake', date: 'received_date', name: 'supplier_name', id: 'supplier_id',
            qty: 'nis_kg', qtyRequired: true, ref: 'batch_number', who: 'Supplier', getter: 'getDataNisIntake'
        },
        kernel_sales_lines: {
            label: 'Kernel Sales', date: 'sale_date', name: 'customer_name', id: 'customer_id',
            qty: 'quantity_kg', qtyRequired: true, ref: 'invoice_number', who: 'Customer', getter: 'getDataKernelSalesLines'
        },
        oil_sales_lines: {
            label: 'Oil & Protein Sales', date: 'sale_date', name: 'customer_name', id: 'customer_id',
            qty: 'quantity_kg', qtyRequired: true, ref: 'invoice_number', who: 'Customer', getter: 'getDataOilSalesLines'
        },
        oil_export_register: {
            label: 'Oil Export Register', date: 'export_date', name: 'customer_name', id: 'customer_id',
            qty: 'weight_kg', qtyRequired: false, ref: 'document_number', who: 'Customer', getter: 'getDataOilExportRegister'
        }
    };

    var S = null; // wizard state for the open modal

    // ------------------------------------------------------------------
    // Small helpers.
    // ------------------------------------------------------------------

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = String(text);
        return e;
    }

    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

    function fmtDate(iso) {
        if (!iso) return '';
        var p = String(iso).split('-');
        return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0];
    }

    function num(v) {
        var n = Number(v) || 0;
        return n.toLocaleString('en-ZA', { maximumFractionDigits: 2 }).replace(/ /g, ' ');
    }

    function button(cls, text, onClick) {
        var b = el('button', cls, text);
        b.type = 'button';
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    function pill(kind, text) { return el('span', 'dimp-pill dimp-pill-' + kind, text); }

    function confBar(c) {
        var wrap = el('span', 'dimp-conf' + (c < LOW_CONFIDENCE ? ' dimp-conf-low' : ''));
        var bar = el('span', 'dimp-conf-bar');
        var fill = el('i');
        fill.style.width = Math.round(Math.max(0, Math.min(1, c)) * 100) + '%';
        bar.appendChild(fill);
        wrap.appendChild(bar);
        wrap.appendChild(document.createTextNode(Math.round(c * 100) + '%'));
        return wrap;
    }

    function option(value, label, selected) {
        var o = el('option', null, label);
        o.value = value;
        if (selected) o.selected = true;
        return o;
    }

    // Fields the file can fill, from the page's own column definitions. The contact-id lookup columns
    // are filled by matching the name, so they are not offered as targets.
    function targetFields(datasetKey) {
        var def = SalesDataColumnDefs.get(datasetKey);
        if (!def || !Array.isArray(def.columns)) return [];
        return def.columns.filter(function (c) {
            return !(c.type === 'lookup' && c.unmatchedFrom);
        }).map(function (c) {
            return { key: c.key, label: c.label, type: c.type === 'lookup' ? 'text' : c.type, options: c.options || null,
                lookup: c.type === 'lookup', whole: c.decimals === 0 };
        });
    }

    function fieldByKey(key) {
        for (var i = 0; i < S.fields.length; i++) if (S.fields[i].key === key) return S.fields[i];
        return null;
    }

    // ------------------------------------------------------------------
    // Parsing (spreadsheet cells and AI-read text alike). No AI here.
    // ------------------------------------------------------------------

    function parseDate(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number' && isFinite(v)) {
            if (typeof XLSX !== 'undefined' && XLSX.SSF && XLSX.SSF.parse_date_code) {
                var c = XLSX.SSF.parse_date_code(v);
                if (c && c.y > 1990 && c.y < 2100) return c.y + '-' + pad(c.m) + '-' + pad(c.d);
            }
            return null;
        }
        if (v instanceof Date && !isNaN(v)) return isoOf(v);
        var s = String(v).trim().replace(/\s+/g, ' ');
        var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (m) return valid(+m[1], +m[2], +m[3]);
        m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
        if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
        m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -](\d{2,4})$/);
        if (m) {
            var mi = MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m[2].slice(0, 3).toLowerCase());
            if (mi !== -1) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], mi + 1, +m[1]);
        }
        return null;
        function valid(y, mo, d) {
            var dt = new Date(y, mo - 1, d);
            return (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) ? isoOf(dt) : null;
        }
    }

    function parseNumber(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : NaN;
        var s = String(v).replace(/[\s ]/g, '').replace(/^R/i, '').replace(/%$/, '');
        if (s === '' || s === '-') return null;
        if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
        else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
        else if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) s = s.replace(/,/g, '');
        var n = Number(s);
        return isFinite(n) ? n : NaN;
    }

    function normName(s) {
        return String(s || '').toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\(pty\)|\bpty\b|\bltd\b|\blimited\b|\bcc\b|\binc\b/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function tokens(s) { return normName(s).split(' ').filter(function (t) { return t.length > 1; }); }

    function similarity(a, b) {
        var A = tokens(a), B = tokens(b);
        if (!A.length || !B.length) return 0;
        var hit = 0;
        A.forEach(function (t) { if (B.indexOf(t) !== -1) hit++; });
        return hit / Math.max(A.length, B.length);
    }

    // ------------------------------------------------------------------
    // Modal shell.
    // ------------------------------------------------------------------

    function buildModal() {
        var modal = el('div', 'modal fade dimp-modal');
        modal.tabIndex = -1;
        modal.setAttribute('aria-labelledby', 'dimpTitle');
        var dialog = el('div', 'modal-dialog modal-xl modal-dialog-scrollable');
        var content = el('div', 'modal-content');
        var head = el('div', 'modal-header dimp-head');
        var t = el('h5', 'modal-title', 'Fill gaps from a file');
        t.id = 'dimpTitle';
        var close = button('btn-close', null, null);
        close.setAttribute('data-bs-dismiss', 'modal');
        close.setAttribute('aria-label', 'Close');
        head.appendChild(t);
        head.appendChild(close);
        var steps = el('div', 'dimp-steps');
        ['Choose', 'AI reads it', 'Check', 'Saved'].forEach(function (name, i) {
            var s = el('div', 'dimp-step');
            s.appendChild(el('b', null, i + 1));
            s.appendChild(document.createTextNode(name));
            steps.appendChild(s);
        });
        var body = el('div', 'modal-body dimp-body');
        var foot = el('div', 'modal-footer dimp-foot');
        var back = button('btn btn-outline-secondary', '← Back', function () { go(S.step - 1); });
        var note = el('span', 'dimp-foot-note text-muted small');
        var next = button('btn btn-primary', 'Next →', onNext);
        foot.appendChild(back);
        foot.appendChild(note);
        foot.appendChild(next);
        content.appendChild(head);
        content.appendChild(steps);
        content.appendChild(body);
        content.appendChild(foot);
        dialog.appendChild(content);
        modal.appendChild(dialog);
        document.body.appendChild(modal);
        return { modal: modal, steps: steps, body: body, back: back, next: next, note: note };
    }

    function setFoot(nextText, nextEnabled, noteText) {
        S.ui.next.textContent = nextText;
        S.ui.next.disabled = !nextEnabled;
        S.ui.note.textContent = noteText || '';
        S.ui.back.style.visibility = (S.step > 1 && S.step < 4 && !S.busy) ? 'visible' : 'hidden';
    }

    function go(step) {
        if (S.busy) return;
        S.step = Math.max(1, Math.min(4, step));
        Array.prototype.forEach.call(S.ui.steps.children, function (s, i) {
            s.classList.toggle('dimp-step-on', i + 1 === S.step);
            s.classList.toggle('dimp-step-done', i + 1 < S.step);
        });
        clear(S.ui.body);
        if (S.step === 1) renderChoose();
        if (S.step === 2) renderRead();
        if (S.step === 3) renderCheck();
        if (S.step === 4) renderSaved();
    }

    function onNext() {
        if (S.step === 1) { go(2); return; }
        if (S.step === 2) { go(3); return; }
        if (S.step === 3) { save(); return; }
        S.bs.hide();
    }

    // ------------------------------------------------------------------
    // Step 1: choose.
    // ------------------------------------------------------------------

    function renderChoose() {
        var b = S.ui.body;
        var grid = el('div', 'row g-3');
        function col(label, input) {
            var c = el('div', 'col-md-4');
            var l = el('label', 'form-label', label);
            c.appendChild(l);
            c.appendChild(input);
            grid.appendChild(c);
        }
        var sel = el('select', 'form-select');
        Object.keys(DATASETS).forEach(function (k) { sel.appendChild(option(k, DATASETS[k].label, k === S.datasetKey)); });
        sel.addEventListener('change', function () { S.datasetKey = sel.value; S.fields = targetFields(S.datasetKey); resetFile(); renderStep1Foot(); });
        col('Fill which page', sel);
        var from = el('input', 'form-control');
        from.type = 'date';
        from.value = S.from;
        from.addEventListener('change', function () { S.from = from.value; renderStep1Foot(); });
        col('From', from);
        var to = el('input', 'form-control');
        to.type = 'date';
        to.value = S.to;
        to.addEventListener('change', function () { S.to = to.value; renderStep1Foot(); });
        col('To', to);
        b.appendChild(grid);
        b.appendChild(el('p', 'text-muted small mt-2 mb-0',
            'Rows outside these dates are shown but not imported. Production (daily) is not listed: its gaps are filled from the factory with "Refresh from factory" on the Production tab.'));

        var src = el('div', 'dimp-src mt-3');
        [['spreadsheet', 'Excel or CSV', 'e.g. a procurement workbook. The AI works out which column is which, then every figure is read exactly from the cells. Nothing is guessed.'],
         ['document', 'Photo or PDF', 'e.g. a delivery note, weighbridge slip or invoice. The AI reads the page into rows; you check each one before saving.']].forEach(function (o) {
            var card = el('div', 'dimp-srcopt' + (S.kind === o[0] ? ' dimp-srcopt-on' : ''));
            card.tabIndex = 0;
            card.appendChild(el('div', 'dimp-srcopt-title', o[1]));
            card.appendChild(el('div', 'text-muted small', o[2]));
            function pick() { if (S.kind !== o[0]) { S.kind = o[0]; resetFile(); } go(1); }
            card.addEventListener('click', pick);
            card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
            src.appendChild(card);
        });
        b.appendChild(src);

        var drop = el('div', 'dimp-drop' + (S.file ? ' dimp-drop-has' : ''));
        var input = el('input');
        input.type = 'file';
        input.accept = S.kind === 'spreadsheet' ? '.xlsx,.xls,.csv' : '.jpg,.jpeg,.png,.pdf';
        input.className = 'd-none';
        input.addEventListener('change', function () { if (input.files && input.files[0]) takeFile(input.files[0]); });
        if (S.file) {
            drop.appendChild(el('strong', null, S.file.name));
            drop.appendChild(el('span', 'text-muted small ms-2', Math.max(1, Math.round(S.file.size / 1024)) + ' KB'));
            drop.appendChild(button('btn btn-sm btn-outline-secondary ms-3', 'Change', function () { input.click(); }));
        } else {
            drop.appendChild(el('div', 'dimp-drop-title', S.kind === 'spreadsheet' ? 'Drop the workbook here' : 'Drop the photo or PDF here'));
            drop.appendChild(button('btn btn-sm btn-outline-secondary mt-2', 'Choose a file', function () { input.click(); }));
            drop.appendChild(el('div', 'text-muted small mt-1', S.kind === 'spreadsheet' ? '.xlsx, .xls or .csv, up to 10 MB' : '.jpg, .png or .pdf, up to 8 MB. A phone photo is fine.'));
        }
        if (S.fileError) drop.appendChild(el('div', 'text-danger small mt-2', S.fileError));
        drop.appendChild(input);
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dimp-drop-over'); });
        drop.addEventListener('dragleave', function () { drop.classList.remove('dimp-drop-over'); });
        drop.addEventListener('drop', function (e) {
            e.preventDefault();
            drop.classList.remove('dimp-drop-over');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]);
        });
        b.appendChild(drop);
        renderStep1Foot();
    }

    function renderStep1Foot() {
        var ok = !!(S.file && S.from && S.to && S.from <= S.to);
        setFoot('Read the file →', ok, !S.file ? 'Choose a file first' : (S.from > S.to ? 'From must not be after To' : ''));
    }

    function resetFile() { S.file = null; S.fileError = null; S.sheets = null; S.mapping = null; S.docRows = null; S.records = null; }

    function takeFile(f) {
        S.fileError = null;
        var name = String(f.name || '').toLowerCase();
        var okType = S.kind === 'spreadsheet' ? /\.(xlsx|xls|csv)$/.test(name) : /\.(jpe?g|png|pdf)$/.test(name);
        var limit = S.kind === 'spreadsheet' ? MAX_SHEET_BYTES : MAX_DOC_BYTES;
        if (!okType) S.fileError = S.kind === 'spreadsheet' ? 'Choose an .xlsx, .xls or .csv file.' : 'Choose a .jpg, .png or .pdf file.';
        else if (f.size > limit) S.fileError = 'That file is too large (limit ' + Math.round(limit / 1048576) + ' MB).';
        S.file = S.fileError ? null : f;
        S.sheets = null; S.mapping = null; S.docRows = null; S.records = null;
        go(1);
    }

    // ------------------------------------------------------------------
    // Step 2: AI reads it.
    // ------------------------------------------------------------------

    function busy(text) {
        S.busy = true;
        var b = S.ui.body;
        clear(b);
        var w = el('div', 'dimp-reading');
        w.appendChild(el('div', 'spinner-border spinner-border-sm text-success'));
        w.appendChild(el('span', null, text));
        b.appendChild(w);
        setFoot('Check the rows →', false, 'Reading…');
    }

    function done() { S.busy = false; }

    function renderRead() {
        if (S.kind === 'spreadsheet') {
            if (S.mapping) { drawMapping(); return; }
            busy('Reading the workbook…');
            readWorkbook(S.file).then(function (sheets) {
                S.sheets = sheets;
                if (!sheets.length) throw new Error('The file has no sheet with column headings.');
                busy('Asking the AI which column is which…');
                var payload = {
                    action: 'map_columns',
                    dataset_key: S.datasetKey,
                    target_fields: S.fields.map(function (f) { return { key: f.key, label: f.label, type: f.type }; }),
                    sheets: sheets.map(function (s) { return { name: s.name, headers: s.headers, sample_rows: s.rows.slice(0, 5).map(function (r) { return r.map(String); }) }; })
                };
                return dataFunctions.readImportFile(payload);
            }).then(function (res) {
                done();
                S.aiError = null;
                var chosen = S.sheets[0];
                var map = {};
                if (res && res.ok && res.data) {
                    S.sheets.forEach(function (s) { if (s.name === res.data.sheet) chosen = s; });
                    (res.data.mapping || []).forEach(function (m) { if (m && m.field) map[m.column] = { field: m.field, confidence: Number(m.confidence) || 0 }; });
                    S.aiNote = res.data.note || '';
                } else {
                    S.aiError = (res && res.error) || 'The AI could not read the headings.';
                }
                S.sheetName = chosen.name;
                S.mapping = autoFill(chosen, map);
                drawMapping();
            }).catch(function (e) {
                done();
                S.fileError = (e && e.message) || 'The file could not be read.';
                go(1);
            });
            return;
        }
        if (S.docRows) { drawDocument(); return; }
        busy('Preparing the file…');
        fileToPayload(S.file).then(function (p) {
            S.preview = p.preview;
            busy('The AI is reading the document…');
            return dataFunctions.readImportFile({
                action: 'read_document',
                dataset_key: S.datasetKey,
                target_fields: S.fields.map(function (f) { return { key: f.key, label: f.label, type: f.type }; }),
                media_type: p.mediaType,
                data_base64: p.base64
            });
        }).then(function (res) {
            done();
            if (!res || !res.ok) {
                S.fileError = (res && res.error) || 'The AI could not read the document.';
                go(1);
                return;
            }
            S.aiNote = res.data.note || '';
            S.docRows = (res.data.rows || []).map(function (r) {
                var values = {}, conf = {};
                (r.fields || []).forEach(function (f) { if (fieldByKey(f.key)) { values[f.key] = f.value == null ? '' : String(f.value); conf[f.key] = Number(f.confidence) || 0; } });
                return { values: values, conf: conf };
            });
            drawDocument();
        }).catch(function (e) {
            done();
            S.fileError = (e && e.message) || 'The file could not be read.';
            go(1);
        });
    }

    // Unmapped columns whose heading is the field's own label get mapped anyway (also the fallback
    // when the AI is unavailable). `fields` defaults to the open wizard's page.
    function autoFill(sheet, map, fields) {
        var used = {};
        Object.keys(map).forEach(function (c) { used[map[c].field] = true; });
        sheet.headers.forEach(function (h) {
            if (map[h]) return;
            var n = normName(h);
            (fields || S.fields).forEach(function (f) {
                if (!used[f.key] && (normName(f.label) === n || normName(f.key) === n)) { map[h] = { field: f.key, confidence: 0.6, guessed: true }; used[f.key] = true; }
            });
        });
        return map;
    }

    function readWorkbook(file) {
        return file.arrayBuffer().then(function (buf) {
            if (typeof XLSX === 'undefined') throw new Error('The spreadsheet reader did not load. Refresh the page and try again.');
            var wb = XLSX.read(buf, { type: 'array' });
            return wb.SheetNames.map(function (name) {
                var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
                var h = -1;
                for (var i = 0; i < aoa.length && i < 30; i++) {
                    var filled = (aoa[i] || []).filter(function (c) { return String(c).trim() !== ''; }).length;
                    if (filled >= 2) { h = i; break; }
                }
                if (h === -1) return null;
                var headers = (aoa[h] || []).map(function (c, j) { var s = String(c).trim(); return s || ('Column ' + (j + 1)); });
                var rows = aoa.slice(h + 1).filter(function (r) { return (r || []).some(function (c) { return String(c).trim() !== ''; }); });
                return { name: name, headers: headers, rows: rows };
            }).filter(Boolean);
        });
    }

    function fileToPayload(file) {
        if (/\.pdf$/i.test(file.name)) {
            return readAsBase64(file).then(function (b64) { return { mediaType: 'application/pdf', base64: b64, preview: null }; });
        }
        // Re-encode images through a canvas: JPEG, long edge at most 2000 px, well under the API's 5 MB.
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var scale = Math.min(1, IMAGE_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
                var c = document.createElement('canvas');
                c.width = Math.round(img.naturalWidth * scale);
                c.height = Math.round(img.naturalHeight * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                var dataUrl = c.toDataURL('image/jpeg', 0.85);
                resolve({ mediaType: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1), preview: url });
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That image could not be opened.')); };
            img.src = url;
        });
    }

    function readAsBase64(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { var s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
            r.onerror = function () { reject(new Error('The file could not be read.')); };
            r.readAsDataURL(file);
        });
    }

    function currentSheet() {
        for (var i = 0; i < S.sheets.length; i++) if (S.sheets[i].name === S.sheetName) return S.sheets[i];
        return S.sheets[0];
    }

    function drawMapping() {
        var b = S.ui.body;
        clear(b);
        var sheet = currentSheet();
        if (S.aiError) {
            var warn = el('div', 'alert alert-warning py-2');
            warn.textContent = S.aiError + ' Match the columns yourself below.';
            b.appendChild(warn);
        }
        var top = el('div', 'd-flex justify-content-between align-items-center flex-wrap gap-2');
        var left = el('div');
        if (!S.aiError) left.appendChild(pill('ai', 'AI'));
        left.appendChild(el('strong', 'ms-1', 'Sheet "' + sheet.name + '"'));
        left.appendChild(el('span', 'ms-1', '· ' + sheet.rows.length + ' rows'));
        top.appendChild(left);
        var sheetSel = el('select', 'form-select form-select-sm w-auto');
        S.sheets.forEach(function (s) { sheetSel.appendChild(option(s.name, s.name, s.name === sheet.name)); });
        sheetSel.addEventListener('change', function () { S.sheetName = sheetSel.value; S.mapping = autoFill(currentSheet(), {}); drawMapping(); });
        top.appendChild(sheetSel);
        b.appendChild(top);
        if (S.aiNote) b.appendChild(el('div', 'text-muted small mt-1', S.aiNote));

        var t = el('table', 'table table-sm mt-2 dimp-table');
        var thead = el('thead'), hr = el('tr');
        ['Column in the file', 'Goes into', 'Sure?', 'First value'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        t.appendChild(thead);
        var tbody = el('tbody');
        sheet.headers.forEach(function (h, i) {
            var tr = el('tr');
            tr.appendChild(el('td', 'fw-semibold', h));
            var td = el('td');
            var sel = el('select', 'form-select form-select-sm w-auto');
            var cur = S.mapping[h] ? S.mapping[h].field : '';
            sel.appendChild(option('', '(leave out)', !cur));
            S.fields.forEach(function (f) { sel.appendChild(option(f.key, f.label, f.key === cur)); });
            sel.addEventListener('change', function () {
                var v = sel.value;
                Object.keys(S.mapping).forEach(function (k) { if (S.mapping[k].field === v && k !== h) delete S.mapping[k]; });
                if (v) S.mapping[h] = { field: v, confidence: 1, manual: true }; else delete S.mapping[h];
                S.records = null;
                drawMapping();
            });
            td.appendChild(sel);
            tr.appendChild(td);
            var tdc = el('td');
            if (S.mapping[h]) tdc.appendChild(S.mapping[h].manual ? el('span', 'text-muted small', 'you chose') : confBar(S.mapping[h].confidence));
            tr.appendChild(tdc);
            tr.appendChild(el('td', 'text-muted', sheet.rows[0] ? String(sheet.rows[0][i] == null ? '' : sheet.rows[0][i]) : ''));
            tbody.appendChild(tr);
        });
        t.appendChild(tbody);
        b.appendChild(t);
        b.appendChild(el('div', 'dimp-note',
            'For a spreadsheet the AI only sees the headings and the first five rows, and only decides which column is which. Every row is then read straight from the cells, so no figure is ever typed or guessed by the AI.'));

        var meta = DATASETS[S.datasetKey];
        var mapped = {};
        Object.keys(S.mapping).forEach(function (k) { mapped[S.mapping[k].field] = true; });
        var missing = [];
        if (!mapped[meta.date]) missing.push(fieldByKey(meta.date).label);
        if (meta.qtyRequired && !mapped[meta.qty]) missing.push(fieldByKey(meta.qty).label);
        setFoot('Check the rows →', !missing.length, missing.length ? 'Match a column to: ' + missing.join(', ') : 'Nothing is saved until you press Save');
    }

    function drawDocument() {
        var b = S.ui.body;
        clear(b);
        var wrap = el('div', 'row g-3');
        var left = el('div', 'col-lg-5');
        if (S.preview) {
            var img = el('img', 'dimp-preview');
            img.alt = 'The uploaded document';
            img.src = S.preview;
            left.appendChild(img);
        } else {
            left.appendChild(el('div', 'dimp-note', 'PDF: ' + S.file.name));
        }
        var right = el('div', 'col-lg-7');
        var head = el('div');
        head.appendChild(pill('ai', 'AI'));
        head.appendChild(el('strong', 'ms-1', S.docRows.length + ' row' + (S.docRows.length === 1 ? '' : 's') + ' read from the ' + (S.preview ? 'photo' : 'PDF')));
        right.appendChild(head);
        if (S.aiNote) right.appendChild(el('div', 'text-muted small', S.aiNote));
        var shown = S.fields.filter(function (f) { return S.docRows.some(function (r) { return r.values[f.key] !== undefined && r.values[f.key] !== ''; }); });
        S.docRows.forEach(function (r, ri) {
            var card = el('div', 'dimp-docrow');
            card.appendChild(el('div', 'text-muted small mb-1', 'Row ' + (ri + 1)));
            shown.forEach(function (f) {
                var line = el('div', 'dimp-docfield');
                line.appendChild(el('label', 'small', f.label));
                var inp = el('input', 'form-control form-control-sm');
                inp.type = 'text';
                inp.value = r.values[f.key] || '';
                inp.addEventListener('input', function () { r.values[f.key] = inp.value; r.conf[f.key] = 1; S.records = null; });
                line.appendChild(inp);
                var c = r.conf[f.key] == null ? 0 : r.conf[f.key];
                line.appendChild(confBar(c));
                if (c < LOW_CONFIDENCE) line.appendChild(pill('unk', 'check'));
                card.appendChild(line);
            });
            right.appendChild(card);
        });
        if (!S.docRows.length) right.appendChild(el('div', 'alert alert-warning mt-2', 'No rows could be read. Try a clearer, straighter photo.'));
        right.appendChild(el('div', 'dimp-note', 'Anything the AI is less than 85% sure of is marked "check". Correct it against the document before carrying on.'));
        wrap.appendChild(left);
        wrap.appendChild(right);
        b.appendChild(wrap);
        setFoot('Check the rows →', S.docRows.length > 0, 'Nothing is saved until you press Save');
    }

    // ------------------------------------------------------------------
    // Step 3: check.
    // ------------------------------------------------------------------

    // Raw value objects {fieldKey: cell} from the mapped sheet or the AI-read rows.
    function rawRecords() {
        if (S.kind === 'document') return S.docRows.map(function (r) { return r.values; });
        var sheet = currentSheet();
        var colOf = {};
        sheet.headers.forEach(function (h, i) { if (S.mapping[h]) colOf[S.mapping[h].field] = i; });
        return sheet.rows.map(function (row) {
            var o = {};
            Object.keys(colOf).forEach(function (k) { o[k] = row[colOf[k]]; });
            return o;
        });
    }

    function buildRecords() {
        var meta = DATASETS[S.datasetKey];
        return rawRecords().map(function (raw, i) {
            var rec = { i: i, values: {}, errors: [], include: false, choice: null, styleChoice: null };
            S.fields.forEach(function (f) {
                var v = raw[f.key];
                if (v === undefined || v === null || String(v).trim() === '') return;
                if (f.type === 'date') {
                    var d = parseDate(v);
                    if (d) rec.values[f.key] = d; else rec.errors.push(f.label + ' "' + String(v) + '" is not a date');
                } else if (f.type === 'number') {
                    var n = parseNumber(v);
                    if (n === null) return;
                    if (isNaN(n)) rec.errors.push(f.label + ' "' + String(v) + '" is not a number');
                    else rec.values[f.key] = n;
                } else if (f.type === 'select') {
                    var s = String(v).trim(), match = null;
                    (f.options || []).forEach(function (o) { if (normName(o.value) === normName(s) || normName(o.label) === normName(s)) match = o.value; });
                    if (match) rec.values[f.key] = match; else rec.errors.push(f.label + ' "' + s + '" is not one of the allowed values');
                } else {
                    rec.values[f.key] = String(v).trim();
                }
            });
            if (!rec.values[meta.date] && !rec.errors.length) rec.errors.push('No date');
            if (meta.qtyRequired && rec.values[meta.qty] == null && !rec.errors.length) rec.errors.push('No ' + fieldByKey(meta.qty).label);
            if (rec.values[meta.qty] < 0) rec.errors.push('The quantity is negative');
            return rec;
        });
    }

    // Arguments default to the open wizard's page and dates (Fill everything passes its own).
    function fetchExisting(datasetKey, from, to) {
        datasetKey = datasetKey || S.datasetKey;
        from = from || S.from;
        to = to || S.to;
        var meta = DATASETS[datasetKey];
        var fn = dataFunctions[meta.getter];
        if (typeof fn !== 'function') return Promise.resolve([]);
        var all = [];
        function page(offset) {
            return fn.call(dataFunctions, from, to, PAGE, offset, null, true).then(function (res) {
                var rows = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
                rows.forEach(function (r) { if (r && r[meta.date]) all.push(r); });
                var total = rows.length ? Number(rows[0].total_count) || 0 : 0;
                if (rows.length === PAGE && offset + PAGE < total && offset < 20000) return page(offset + PAGE);
                return all;
            });
        }
        return page(0);
    }

    // Fills ctx.contacts (and ctx.styles when needStyles) once; ctx defaults to the open wizard.
    function loadLookups(ctx, needStyles) {
        ctx = ctx || S;
        if (needStyles === undefined) needStyles = ctx.datasetKey === 'kernel_sales_lines';
        var tasks = [];
        if (!ctx.contacts) {
            tasks.push(dataFunctions.getContacts().then(function (rows) {
                ctx.contacts = (Array.isArray(rows) ? rows : []).map(function (c) {
                    return { id: c && (c.id || c.contact_id), name: (c && (c.company_name || c.name || c.contact_name)) || '' };
                }).filter(function (c) { return c.id && c.name; });
            }).catch(function () { ctx.contacts = []; }));
        }
        if (!ctx.styles && needStyles) {
            tasks.push(dataFunctions.getKernelStyles().then(function (rows) {
                ctx.styles = (Array.isArray(rows) ? rows : []).map(function (s) { return s && s.style_code; }).filter(Boolean);
            }).catch(function () { ctx.styles = []; }));
        }
        return Promise.all(tasks);
    }

    function classify() {
        var meta = DATASETS[S.datasetKey];
        var byNorm = {};
        S.contacts.forEach(function (c) { byNorm[normName(c.name)] = c; });
        var usedExisting = {};
        var seenKeys = {};
        var existingKeys = {};
        S.existing.forEach(function (r) { existingKeys[naturalKey(r)] = true; });

        S.records.forEach(function (rec) {
            rec.status = 'new';
            rec.note = '';
            if (rec.errors.length) { rec.status = 'fix'; rec.note = rec.errors.join('; '); return; }
            var d = rec.values[meta.date];
            if (d < S.from || d > S.to) { rec.status = 'out'; rec.note = 'Outside ' + fmtDate(S.from) + ' – ' + fmtDate(S.to); return; }

            var nk = naturalKey(rec.values);
            if (nk && (existingKeys[nk] || seenKeys[nk])) {
                rec.status = 'dup';
                rec.note = seenKeys[nk] ? 'Twice in the file' : 'Same reference already in the system';
                return;
            }
            if (nk) seenKeys[nk] = true;
            // One-to-one fuzzy duplicate: same date and quantity, and the same name or reference.
            var qty = Number(rec.values[meta.qty]) || 0;
            for (var j = 0; j < S.existing.length; j++) {
                var e = S.existing[j];
                if (usedExisting[j] || String(e[meta.date]).slice(0, 10) !== d) continue;
                if (Math.abs((Number(e[meta.qty]) || 0) - qty) > 0.5) continue;
                var sameName = normName(e[meta.name]) && normName(e[meta.name]) === normName(rec.values[meta.name]);
                var sameRef = e[meta.ref] && rec.values[meta.ref] && String(e[meta.ref]).trim() === String(rec.values[meta.ref]).trim();
                if (sameName || sameRef) {
                    usedExisting[j] = true;
                    rec.status = 'dup';
                    rec.note = num(e[meta.qty]) + ' already entered on ' + fmtDate(d);
                    return;
                }
            }

            // Supplier / customer match.
            var name = rec.values[meta.name];
            rec.contactId = null;
            rec.suggestion = null;
            if (name) {
                var exact = byNorm[normName(name)];
                if (exact) {
                    rec.contactId = exact.id;
                    rec.values[meta.name] = exact.name;
                } else {
                    var best = null, score = 0;
                    S.contacts.forEach(function (c) { var s = similarity(name, c.name); if (s > score) { score = s; best = c; } });
                    rec.suggestion = score >= 0.4 ? best : null;
                    rec.status = 'unk';
                    rec.note = meta.who + ' not recognised';
                }
            }
            // Kernel styles must exist in the registry (foreign key).
            if (S.datasetKey === 'kernel_sales_lines' && rec.values.style_code && (S.styles || []).indexOf(rec.values.style_code) === -1) {
                rec.styleUnknown = true;
                rec.status = 'unk';
                rec.note = (rec.note ? rec.note + '; ' : '') + 'Style "' + rec.values.style_code + '" is not in the style list';
            }
        });
        S.records.forEach(function (rec) { rec.include = rec.status === 'new'; });
    }

    function naturalKey(v) {
        var meta = DATASETS[S.datasetKey];
        var d = v[meta.date] ? String(v[meta.date]).slice(0, 10) : '';
        if (S.datasetKey === 'nis_intake') return v.batch_number ? [v.batch_number, d, Number(v.nis_kg) || 0].join('|') : null;
        if (S.datasetKey === 'oil_export_register') return v.document_number ? 'doc|' + String(v.document_number).trim() : null;
        return v.invoice_number ? [String(v.invoice_number).trim(), v.item_code || '', Number(v.quantity_kg) || 0, d].join('|') : null;
    }

    function resolved(rec) {
        if (rec.status !== 'unk') return rec.status === 'new';
        var nameOk = !rec.note || rec.note.indexOf('not recognised') === -1 || rec.choice;
        var styleOk = !rec.styleUnknown || rec.styleChoice;
        return !!(nameOk && styleOk);
    }

    function renderCheck() {
        if (!S.records) {
            busy('Checking every row against what is already in the portal…');
            S.records = buildRecords();
            Promise.all([fetchExisting(), loadLookups()]).then(function (r) {
                done();
                S.existing = r[0];
                classify();
                drawCheck();
            }).catch(function (e) {
                done();
                S.records = null;
                var b = S.ui.body;
                clear(b);
                b.appendChild(el('div', 'alert alert-danger', 'The existing rows could not be loaded, so duplicates cannot be checked: ' + ((e && e.message) || 'unknown error') + '. Try again.'));
                setFoot('Save', false, '');
            });
            return;
        }
        drawCheck();
    }

    function drawCheck() {
        var meta = DATASETS[S.datasetKey];
        var b = S.ui.body;
        clear(b);
        var counts = { add: 0, addQty: 0, dup: 0, unk: 0, out: 0, fix: 0 };
        S.records.forEach(function (r) {
            if (r.include && resolved(r)) { counts.add++; counts.addQty += Number(r.values[meta.qty]) || 0; }
            if (r.status === 'dup') counts.dup++;
            if (r.status === 'unk' && !resolved(r)) counts.unk++;
            if (r.status === 'out') counts.out++;
            if (r.status === 'fix') counts.fix++;
        });
        var sum = el('div', 'dimp-sumrow');
        [['Will be added', counts.add + ' rows', num(counts.addQty) + ' ' + (meta.qty === 'weight_kg' ? 'kg' : 'kg')],
         ['Already in the system', String(counts.dup), 'skipped, no double counting'],
         ['Needs you', String(counts.unk + counts.fix), counts.unk + counts.fix ? (counts.fix ? counts.fix + ' to fix, ' : '') + counts.unk + ' to match' : 'all clear'],
         ['Outside the dates', String(counts.out), 'left out']].forEach(function (t) {
            var d = el('div', 'dimp-sum');
            d.appendChild(el('div', 'dimp-sum-k', t[0]));
            d.appendChild(el('div', 'dimp-sum-v', t[1]));
            d.appendChild(el('div', 'dimp-sum-s', t[2]));
            sum.appendChild(d);
        });
        b.appendChild(sum);

        var grid = el('div', 'row g-3');
        var left = el('div', 'col-xl-7');
        left.appendChild(el('div', 'fw-semibold small mb-1', 'Rows found in the file · untick a row to leave it out'));
        var scroll = el('div', 'dimp-scroll');
        var t = el('table', 'table table-sm mb-0 dimp-table');
        var thead = el('thead'), hr = el('tr');
        ['', 'Date', meta.who, 'Ref', 'kg', 'Status'].forEach(function (h, i) { hr.appendChild(el('th', i === 4 ? 'text-end' : null, h)); });
        thead.appendChild(hr);
        t.appendChild(thead);
        var tbody = el('tbody');
        S.records.forEach(function (r) {
            var tr = el('tr', r.include && resolved(r) ? '' : 'dimp-off');
            var tdc = el('td');
            var cb = el('input', 'form-check-input');
            cb.type = 'checkbox';
            cb.checked = !!(r.include && resolved(r));
            cb.disabled = !(r.status === 'new' || (r.status === 'unk' && resolved(r)));
            cb.addEventListener('change', function () { r.include = cb.checked; drawCheck(); });
            tdc.appendChild(cb);
            tr.appendChild(tdc);
            tr.appendChild(el('td', 'text-nowrap', r.values[meta.date] ? fmtDate(r.values[meta.date]) : '–'));
            var tdn = el('td');
            if (r.status === 'unk' && r.note.indexOf('not recognised') !== -1) {
                tdn.appendChild(el('div', 'text-muted small text-decoration-line-through', r.values[meta.name] || ''));
                var sel = el('select', 'form-select form-select-sm');
                sel.appendChild(option('', 'Match to…', !r.choice));
                sel.appendChild(option('__keep__', 'Keep the name as written', r.choice === '__keep__'));
                S.contacts.slice().sort(function (a, c) { return a.name.localeCompare(c.name); }).forEach(function (c) {
                    sel.appendChild(option(c.id, c.name, r.choice === c.id));
                });
                sel.addEventListener('change', function () { r.choice = sel.value || null; r.include = resolved(r); drawCheck(); });
                tdn.appendChild(sel);
                if (!r.choice && r.suggestion) {
                    var sug = button('btn btn-link btn-sm p-0', 'Suggested: ' + r.suggestion.name, function () { r.choice = r.suggestion.id; r.include = resolved(r); drawCheck(); });
                    tdn.appendChild(sug);
                }
            } else {
                tdn.textContent = r.values[meta.name] || '';
            }
            if (r.styleUnknown) {
                var ss = el('select', 'form-select form-select-sm mt-1');
                ss.appendChild(option('', 'Style "' + r.values.style_code + '"…', !r.styleChoice));
                ss.appendChild(option('__blank__', 'Leave the style blank', r.styleChoice === '__blank__'));
                (S.styles || []).forEach(function (s) { ss.appendChild(option(s, s, r.styleChoice === s)); });
                ss.addEventListener('change', function () { r.styleChoice = ss.value || null; r.include = resolved(r); drawCheck(); });
                tdn.appendChild(ss);
            }
            tr.appendChild(tdn);
            tr.appendChild(el('td', 'text-muted text-nowrap', r.values[meta.ref] || ''));
            tr.appendChild(el('td', 'text-end text-nowrap', r.values[meta.qty] == null ? '' : num(r.values[meta.qty])));
            var tds = el('td');
            var label = { 'new': ['new', 'New · fills a gap'], dup: ['dup', 'Already in the system'], unk: ['unk', resolved(r) ? 'Matched' : 'Needs you'], out: ['dup', 'Outside the dates'], fix: ['miss', 'Needs a fix'] }[r.status];
            tds.appendChild(pill(r.status === 'unk' && resolved(r) ? 'new' : label[0], label[1]));
            if (r.note) tds.appendChild(el('div', 'text-muted small', r.note));
            tr.appendChild(tds);
            tbody.appendChild(tr);
        });
        t.appendChild(tbody);
        scroll.appendChild(t);
        left.appendChild(scroll);
        grid.appendChild(left);

        // Reconciliation per month: portal now + this file = after, against the file's own total.
        var right = el('div', 'col-xl-5');
        right.appendChild(el('div', 'fw-semibold small mb-1', 'Does the portal match the file after this import?'));
        var months = {};
        function bucket(m) { return months[m] || (months[m] = { now: 0, add: 0, file: 0 }); }
        S.existing.forEach(function (e) { var d = String(e[meta.date]).slice(0, 10); if (d >= S.from && d <= S.to) bucket(d.slice(0, 7)).now += Number(e[meta.qty]) || 0; });
        S.records.forEach(function (r) {
            var d = r.values[meta.date];
            if (!d || d < S.from || d > S.to || r.status === 'fix') return;
            bucket(d.slice(0, 7)).file += Number(r.values[meta.qty]) || 0;
            if (r.include && resolved(r)) bucket(d.slice(0, 7)).add += Number(r.values[meta.qty]) || 0;
        });
        var rt = el('table', 'table table-sm dimp-table');
        var rh = el('thead'), rhr = el('tr');
        ['Month', 'In portal now', '+ this file', '= After', 'In the file', ''].forEach(function (h, i) { rhr.appendChild(el('th', i && i < 5 ? 'text-end' : null, h)); });
        rh.appendChild(rhr);
        rt.appendChild(rh);
        var rb = el('tbody');
        var allOk = true;
        Object.keys(months).sort().forEach(function (m) {
            var x = months[m], after = x.now + x.add, ok = Math.abs(after - x.file) < 0.5;
            if (!ok) allOk = false;
            var tr = el('tr');
            tr.appendChild(el('td', null, MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4)));
            tr.appendChild(el('td', 'text-end', num(x.now)));
            tr.appendChild(el('td', 'text-end', num(x.add)));
            tr.appendChild(el('td', 'text-end fw-semibold', num(after)));
            tr.appendChild(el('td', 'text-end', num(x.file)));
            tr.appendChild(el('td', ok ? 'dimp-ok' : 'dimp-bad', ok ? '✓' : '✗ ' + num(after - x.file)));
            rb.appendChild(tr);
        });
        rt.appendChild(rb);
        right.appendChild(rt);
        right.appendChild(el('div', 'dimp-note', Object.keys(months).length
            ? (allOk ? '✓ Every month will match the file exactly. Safe to save.'
                     : 'A ✗ means that month will not match the file. Usually a row still needs matching or is unticked; or the portal already has rows the file does not.')
            : 'No rows in the chosen dates.'));
        grid.appendChild(right);
        b.appendChild(grid);

        var unresolved = S.records.filter(function (r) { return r.status === 'unk' && !resolved(r); }).length;
        setFoot('Save ' + counts.add + ' row' + (counts.add === 1 ? '' : 's'), counts.add > 0,
            unresolved ? unresolved + ' row' + (unresolved === 1 ? ' needs' : 's need') + ' matching (or leave unticked)' : '');
    }

    // ------------------------------------------------------------------
    // Save / undo.
    // ------------------------------------------------------------------

    function payloadRows() {
        var meta = DATASETS[S.datasetKey];
        return S.records.filter(function (r) { return r.include && resolved(r); }).map(function (r) {
            var o = {};
            Object.keys(r.values).forEach(function (k) {
                var f = fieldByKey(k), v = r.values[k];
                if (v == null) { o[k] = ''; return; }
                // Whole-number columns (supplier no.) are integer in the database: "12.0" must arrive as "12".
                o[k] = (f && f.whole && typeof v === 'number') ? String(Math.round(v)) : String(v);
            });
            if (r.contactId) o[meta.id] = r.contactId;
            if (r.choice && r.choice !== '__keep__') {
                o[meta.id] = r.choice;
                S.contacts.forEach(function (c) { if (c.id === r.choice) o[meta.name] = c.name; });
            }
            if (r.styleUnknown) o.style_code = r.styleChoice === '__blank__' ? '' : r.styleChoice;
            return o;
        });
    }

    function refreshAfterWrite() {
        if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) dataFunctions.clearCachePattern('sales_data_');
        if (typeof _salesDataGrid !== 'undefined' && _salesDataGrid.invalidateLedgers) _salesDataGrid.invalidateLedgers();
        if (typeof S.onDone === 'function') S.onDone();
    }

    function flushGrid() {
        if (typeof _salesDataGrid !== 'undefined' && _salesDataGrid.flushAutoSave) {
            return Promise.resolve(_salesDataGrid.flushAutoSave()).catch(function () { /* the grid reports its own save errors */ });
        }
        return Promise.resolve();
    }

    function save() {
        var rows = payloadRows();
        if (!rows.length) return;
        S.busy = true;
        setFoot('Saving…', false, '');
        flushGrid().then(function () {
            return dataFunctions.importDataPageRows(S.datasetKey, S.file.name, S.kind, rows);
        }).then(function (res) {
            S.busy = false;
            if (!res || Number(res.success) !== 1) {
                setFoot('Save ' + rows.length + ' rows', true, '');
                var err = el('div', 'alert alert-danger mt-2');
                err.textContent = (res && res.error) || 'The import could not be saved.';
                S.ui.body.insertBefore(err, S.ui.body.firstChild);
                return;
            }
            S.result = { batchId: res.batch_id, rows: Number(res.rows_written) || rows.length, twins: Number(res.twins_linked) || 0,
                qty: rows.reduce(function (s, r) { return s + (Number(r[DATASETS[S.datasetKey].qty]) || 0); }, 0) };
            refreshAfterWrite();
            go(4);
        });
    }

    function renderSaved() {
        var b = S.ui.body;
        var box = el('div', 'dimp-done');
        box.appendChild(el('div', 'dimp-done-tick', '✓'));
        box.appendChild(el('h4', null, S.result.rows + ' row' + (S.result.rows === 1 ? '' : 's') + ' added to ' + DATASETS[S.datasetKey].label));
        box.appendChild(el('div', 'text-muted', num(S.result.qty) + ' kg · Data health and the dashboards update straight away.'));
        if (S.result.twins) box.appendChild(el('div', 'text-muted small', S.result.twins + ' export twin' + (S.result.twins === 1 ? ' was' : 's were') + ' linked so the sale is not counted twice.'));
        var batch = el('div', 'dimp-batch');
        [['Batch', String(S.result.batchId).slice(0, 8).toUpperCase()], ['File', S.file.name]].forEach(function (x) {
            var d = el('div');
            d.appendChild(el('div', 'text-muted small', x[0]));
            d.appendChild(el('strong', null, x[1]));
            batch.appendChild(d);
        });
        batch.appendChild(button('btn btn-sm btn-outline-secondary', '↶ Undo this batch', function () {
            undo(S.result.batchId, function (msg) { box.appendChild(el('div', 'alert alert-info mt-3', msg)); });
        }));
        box.appendChild(batch);
        box.appendChild(el('p', 'text-muted small mt-3', 'Each row is saved as "imported" with the file name. It is listed under Recent imports on Data health, where it can be undone later.'));
        b.appendChild(box);
        setFoot('Done', true, '');
    }

    function confirmUndo() {
        var text = 'Undo this import? Its rows are removed. Rows someone has edited since are kept.';
        if (typeof Swal !== 'undefined' && Swal.fire) {
            return Swal.fire({ title: 'Undo import', text: text, icon: 'warning', showCancelButton: true, confirmButtonText: 'Undo it' })
                .then(function (r) { return !!(r && r.isConfirmed); });
        }
        return Promise.resolve(window.confirm(text));
    }

    // Shared by the Saved step and the Recent imports list on Data health.
    function undo(batchId, report) {
        return confirmUndo().then(function (yes) {
            if (!yes) return null;
            return flushGrid().then(function () { return dataFunctions.undoDataImportBatch(batchId); }).then(function (res) {
                if (!res || Number(res.success) !== 1) {
                    if (report) report((res && res.error) || 'The import could not be undone.');
                    return res;
                }
                if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) dataFunctions.clearCachePattern('sales_data_');
                if (typeof _salesDataGrid !== 'undefined' && _salesDataGrid.invalidateLedgers) _salesDataGrid.invalidateLedgers();
                if (report) report('Undone: ' + res.rows_deleted + ' row' + (Number(res.rows_deleted) === 1 ? '' : 's') + ' removed'
                    + (Number(res.rows_kept) ? ', ' + res.rows_kept + ' kept because someone edited them since' : '') + '.');
                if (S && typeof S.onDone === 'function') S.onDone();
                return res;
            });
        });
    }

    // ------------------------------------------------------------------
    // Public.
    // ------------------------------------------------------------------

    return {
        DATASETS: DATASETS,
        canImport: function (datasetKey) { return Object.prototype.hasOwnProperty.call(DATASETS, datasetKey); },
        /**
         * @param {{datasetKey?: string, from?: string, to?: string, onDone?: function}} opts
         */
        open: function (opts) {
            opts = opts || {};
            if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
            if (S && S.ui && S.ui.modal && S.ui.modal.parentNode) S.ui.modal.parentNode.removeChild(S.ui.modal);
            var key = DATASETS[opts.datasetKey] ? opts.datasetKey : 'nis_intake';
            var today = new Date();
            S = {
                step: 1, busy: false, datasetKey: key, kind: 'spreadsheet',
                from: opts.from || (today.getFullYear() - (today.getMonth() < 3 ? 1 : 0)) + '-04-01',
                to: opts.to || isoOf(today),
                onDone: opts.onDone || null, contacts: null, styles: null
            };
            S.fields = targetFields(key);
            resetFile();
            S.ui = buildModal();
            S.bs = new bootstrap.Modal(S.ui.modal, { backdrop: 'static' });
            S.ui.modal.addEventListener('hidden.bs.modal', function () {
                if (S && S.preview) { try { URL.revokeObjectURL(S.preview); } catch (e) { /* already gone */ } }
                if (S && S.ui.modal.parentNode) S.ui.modal.parentNode.removeChild(S.ui.modal);
            });
            go(1);
            S.bs.show();
        },
        undo: undo,

        /**
         * The checking engine, shared with "Fill everything from a file" (data-import-all-wizard.js) so
         * both wizards read cells, spot rows already in the portal and match names the same way.
         * withState(ctx, fn) runs fn({buildRecords, classify, payloadRows, resolved}) with ctx standing in
         * for this wizard's state. Synchronous only: those four read the state as they run.
         * ctx needs: kind 'spreadsheet', sheets [sheet], sheetName, mapping, fields, datasetKey, from, to,
         * and for classify/payloadRows: records, existing, contacts, styles.
         */
        engine: {
            LOW_CONFIDENCE: LOW_CONFIDENCE,
            targetFields: targetFields,
            parseDate: parseDate,
            normName: normName,
            similarity: similarity,
            readWorkbook: readWorkbook,
            autoFill: autoFill,
            fetchExisting: fetchExisting,
            loadLookups: loadLookups,
            flushGrid: flushGrid,
            withState: function (ctx, fn) {
                var saved = S;
                S = ctx;
                try {
                    return fn({ buildRecords: buildRecords, classify: classify, payloadRows: payloadRows, resolved: resolved });
                } finally {
                    S = saved;
                }
            }
        }
    };
}());

window.DataImportWizard = DataImportWizard;
