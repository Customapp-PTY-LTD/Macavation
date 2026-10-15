/**
 * Fill everything from a file - the whole-workbook import opened from the Data health tab.
 *
 * Built from the approved mockup (CustomappReports/Macavation-Fill-Everything-From-File-Mockup-2026-10-15.html):
 *   1. Drop the file   - no page and no dates to choose. Excel or CSV only (a photo is one page: use
 *                        "One page from a file").
 *   2. What's in it    - read-import-file / identify_sheets says which page (or none) each sheet belongs
 *                        to and which column is which, from the headings and five sample rows only.
 *                        Every sheet's page and every column can be changed.
 *   3. Check the plan  - every row is checked against the whole financial year (up to the cut-over and
 *                        today) with the one-page wizard's own engine (DataImportWizard.engine), then
 *                        sorted: fills a missing week (ticked), new (ticked), needs you, extra rows in
 *                        weeks that already have data (not ticked: that is where double counting
 *                        happens), already in the portal (skipped), left out. The Data health grid
 *                        shows which weeks turn green; each page reconciles month by month against the
 *                        file.
 *   4. Done            - what was filled and what is still missing, as one import with one Undo.
 *
 * Saving goes through import_data_pages (migrations/20261015120000_data_import_groups.sql): one batch
 * per page, all in one transaction, tied together by import_group_id. Undo is undo_data_import_group.
 *
 * Security: every file, database and AI value reaches the DOM through textContent / .value only.
 */
var DataImportAllWizard = (function () {
    'use strict';

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var MAX_BYTES = 10 * 1024 * 1024;
    var MISS_PAGES = ['nis_intake', 'kernel_sales_lines'];

    // Importable pages in display order. checkable: Data health can say whether a week is missing.
    var PAGES = [
        { key: 'nis_intake', checkable: true, extra: null, noun: 'delivery', missWhat: 'Deliveries were booked in but the file has no intake rows for' },
        { key: 'kernel_sales_lines', checkable: true, extra: 'style_code', noun: 'sale', missWhat: 'Dispatches went out but the file has no invoice lines for' },
        { key: 'oil_sales_lines', checkable: false, extra: 'product_line', noun: 'sale' },
        { key: 'oil_export_register', checkable: false, extra: null, noun: 'export' }
    ];

    var W = null; // state of the open modal

    // ------------------------------------------------------------------
    // Helpers.
    // ------------------------------------------------------------------

    function E() { return DataImportWizard.engine; }
    function meta(key) { return DataImportWizard.DATASETS[key]; }
    function pageDef(key) { for (var i = 0; i < PAGES.length; i++) if (PAGES[i].key === key) return PAGES[i]; return null; }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = String(text);
        return e;
    }

    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseIso(iso) { var p = String(iso).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function fmtShort(iso) { var p = String(iso).split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1]; }
    function num(v) { return (Number(v) || 0).toLocaleString('en-ZA', { maximumFractionDigits: 1 }).replace(/ /g, ' '); }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

    function button(cls, text, onClick) {
        var b = el('button', cls, text);
        b.type = 'button';
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    function pill(kind, text) { return el('span', 'dimp-pill dimp-pill-' + kind, text); }

    function option(value, label, selected) {
        var o = el('option', null, label);
        o.value = value;
        if (selected) o.selected = true;
        return o;
    }

    function confBar(c) {
        var wrap = el('span', 'dimp-conf' + (c < E().LOW_CONFIDENCE ? ' dimp-conf-low' : ''));
        var bar = el('span', 'dimp-conf-bar');
        var fill = el('i');
        fill.style.width = Math.round(Math.max(0, Math.min(1, c)) * 100) + '%';
        bar.appendChild(fill);
        wrap.appendChild(bar);
        wrap.appendChild(document.createTextNode(Math.round(c * 100) + '%'));
        return wrap;
    }

    function pageLabel(key) { return key ? meta(key).label : 'Don’t import'; }
    function fieldsOf(key) { return W.fieldsByPage[key] || []; }
    function fieldLabel(key, field) { var f = fieldsOf(key).filter(function (x) { return x.key === field; })[0]; return f ? f.label : field; }

    // The financial year up to the day before the cut-over (from then on everything is captured in the
    // portal) and never past today.
    function range(snap) {
        var from = (snap.fy - 1) + '-04-01';
        var fyEnd = snap.fy + '-03-31';
        var c = parseIso(snap.cutoverIso);
        var beforeCut = isoOf(new Date(c.getFullYear(), c.getMonth(), c.getDate() - 1));
        var to = [fyEnd, beforeCut, snap.todayIso || isoOf(new Date())].sort()[0];
        return { from: from, to: to, fyEnd: fyEnd };
    }

    function weekOf(iso) {
        var ws = W.snap.weeks;
        if (!ws.length || !iso) return -1;
        var i = Math.floor((parseIso(iso) - parseIso(ws[0].startIso)) / 864e5 / 7);
        return i >= 0 && i < ws.length ? i : -1;
    }

    function missWeeks(key) {
        return (W.snap.status[key] || []).reduce(function (a, s, i) {
            if (s === 'miss' && W.snap.weeks[i].startIso < W.snap.cutoverIso) a.push(i);
            return a;
        }, []);
    }

    // ------------------------------------------------------------------
    // Modal shell.
    // ------------------------------------------------------------------

    function buildModal() {
        var modal = el('div', 'modal fade dimp-modal dimpa-modal');
        modal.tabIndex = -1;
        modal.setAttribute('aria-labelledby', 'dimpaTitle');
        var dialog = el('div', 'modal-dialog modal-xl modal-dialog-scrollable');
        var content = el('div', 'modal-content');
        var head = el('div', 'modal-header dimp-head');
        var t = el('h5', 'modal-title', 'Fill everything from a file');
        t.id = 'dimpaTitle';
        var close = button('btn-close', null, null);
        close.setAttribute('data-bs-dismiss', 'modal');
        close.setAttribute('aria-label', 'Close');
        head.appendChild(t);
        head.appendChild(close);
        var steps = el('div', 'dimp-steps');
        ['Drop the file', 'What’s in it', 'Check the plan', 'Done'].forEach(function (name, i) {
            var s = el('div', 'dimp-step');
            s.appendChild(el('b', null, i + 1));
            s.appendChild(document.createTextNode(name));
            steps.appendChild(s);
        });
        var body = el('div', 'modal-body dimp-body');
        var foot = el('div', 'modal-footer dimp-foot');
        var back = button('btn btn-outline-secondary', '← Back', function () { go(W.step - 1); });
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
        W.ui.next.textContent = nextText;
        W.ui.next.disabled = !nextEnabled;
        W.ui.note.textContent = noteText || '';
        W.ui.back.style.visibility = (W.step > 1 && W.step < 4 && !W.busy) ? 'visible' : 'hidden';
    }

    function go(step) {
        if (W.busy) return;
        W.step = Math.max(1, Math.min(4, step));
        Array.prototype.forEach.call(W.ui.steps.children, function (s, i) {
            s.classList.toggle('dimp-step-on', i + 1 === W.step);
            s.classList.toggle('dimp-step-done', i + 1 < W.step);
        });
        clear(W.ui.body);
        if (W.step === 1) renderDrop();
        if (W.step === 2) renderRead();
        if (W.step === 3) renderPlan();
        if (W.step === 4) renderDone();
    }

    function onNext() {
        if (W.step === 1) { go(2); return; }
        if (W.step === 2) { go(3); return; }
        if (W.step === 3) { save(); return; }
        W.bs.hide();
    }

    // ------------------------------------------------------------------
    // Step 1: drop the file.
    // ------------------------------------------------------------------

    function renderDrop() {
        var b = W.ui.body;
        var drop = el('div', 'dimp-drop dimpa-drop' + (W.file ? ' dimp-drop-has' : ''));
        var input = el('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls,.csv';
        input.className = 'd-none';
        input.addEventListener('change', function () { if (input.files && input.files[0]) takeFile(input.files[0]); });
        if (W.file) {
            var row = el('div', 'd-flex justify-content-between align-items-center flex-wrap gap-2');
            var left = el('div');
            left.appendChild(el('i', 'fas fa-file-excel me-2'));
            left.appendChild(el('strong', null, W.file.name));
            left.appendChild(el('span', 'text-muted small ms-2', '· ' + Math.max(1, Math.round(W.file.size / 1024)) + ' KB'));
            row.appendChild(left);
            row.appendChild(button('btn btn-sm btn-outline-secondary', 'Change', function () { input.click(); }));
            drop.appendChild(row);
        } else {
            drop.appendChild(el('i', 'fas fa-upload dimpa-drop-icon'));
            var t = el('div', 'dimpa-drop-title');
            t.appendChild(el('strong', null, 'Drop the workbook here'));
            t.appendChild(document.createTextNode(', or '));
            t.appendChild(button('btn btn-link p-0 align-baseline dimpa-drop-link', 'choose a file', function () { input.click(); }));
            drop.appendChild(t);
            drop.appendChild(el('div', 'text-muted small mt-1', '.xlsx, .xls or .csv, up to 10 MB · every sheet is looked at'));
        }
        if (W.fileError) drop.appendChild(el('div', 'text-danger small mt-2', W.fileError));
        drop.appendChild(input);
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dimp-drop-over'); });
        drop.addEventListener('dragleave', function () { drop.classList.remove('dimp-drop-over'); });
        drop.addEventListener('drop', function (e) {
            e.preventDefault();
            drop.classList.remove('dimp-drop-over');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]);
        });
        b.appendChild(drop);

        var promise = el('div', 'dimpa-promise');
        [['No page or dates to pick', 'The portal works out which sheet goes to which page and checks the whole financial year.'],
         ['Only fills what’s missing', 'Rows already in the portal are skipped, so nothing is counted twice.'],
         ['You see the plan first', 'Nothing is saved until you’ve seen exactly what will be added and pressed Save.']].forEach(function (x) {
            var d = el('div');
            d.appendChild(el('strong', null, x[0]));
            d.appendChild(el('div', null, x[1]));
            promise.appendChild(d);
        });
        b.appendChild(promise);
        var foot = el('p', 'text-muted small mt-2 mb-0');
        foot.appendChild(document.createTextNode('Excel or CSV. For a photo or PDF of a delivery note or invoice, use '));
        foot.appendChild(el('strong', null, 'One page from a file'));
        foot.appendChild(document.createTextNode(', since a single document only ever belongs to one page. Dates from '
            + fmtShort(W.snap.cutoverIso) + ' ' + W.snap.cutoverIso.slice(0, 4) + ' are left out: from then on everything is captured in the portal.'));
        b.appendChild(foot);

        if (W.range.from > W.range.to) {
            b.appendChild(el('div', 'alert alert-warning mt-3 mb-0', 'This financial year starts after the cut-over, so there is nothing to fill from a file.'));
            setFoot('Read the file →', false, '');
            return;
        }
        setFoot('Read the file →', !!W.file, W.file ? '' : 'Choose a file first');
    }

    function takeFile(f) {
        W.fileError = null;
        var name = String(f.name || '').toLowerCase();
        if (!/\.(xlsx|xls|csv)$/.test(name)) W.fileError = 'Choose an .xlsx, .xls or .csv file.';
        else if (f.size > MAX_BYTES) W.fileError = 'That file is too large (limit 10 MB).';
        W.file = W.fileError ? null : f;
        W.sheets = null;
        W.plan = null;
        go(1);
    }

    // ------------------------------------------------------------------
    // Step 2: what's in it.
    // ------------------------------------------------------------------

    var READ_LINES = ['Opening the workbook…', 'Working out what each sheet holds…', 'Matching columns to each page’s fields…', 'Reading every row from the cells…'];

    function renderRead() {
        if (W.sheets) { drawSheets(); return; }
        W.busy = true;
        var b = W.ui.body;
        var box = el('div', 'dimpa-reading');
        var lines = READ_LINES.map(function (t) {
            var d = el('div');
            d.appendChild(el('span', 'spinner-border spinner-border-sm text-success'));
            d.appendChild(el('span', null, t));
            box.appendChild(d);
            return d;
        });
        b.appendChild(box);
        setFoot('Check the plan →', false, 'Reading…');
        function on(i, text) { lines[i].classList.add('dimpa-on'); if (text) lines[i].lastChild.textContent = text; }
        on(0);
        E().readWorkbook(W.file).then(function (sheets) {
            if (!sheets.length) throw new Error('The file has no sheet with column headings.');
            W.rawSheets = sheets;
            on(0, 'Opening ' + plural(sheets.length, 'sheet') + '…');
            on(1);
            return dataFunctions.readImportFile({
                action: 'identify_sheets',
                pages: PAGES.map(function (p) {
                    return { dataset_key: p.key, label: meta(p.key).label,
                        fields: fieldsOf(p.key).map(function (f) { return { key: f.key, label: f.label, type: f.type }; }) };
                }),
                sheets: sheets.map(function (s) { return { name: s.name, headers: s.headers, sample_rows: s.rows.slice(0, 5).map(function (r) { return r.map(String); }) }; })
            });
        }).then(function (res) {
            on(2);
            var byName = {};
            W.aiError = null;
            if (res && res.ok && res.data && Array.isArray(res.data.sheets)) {
                res.data.sheets.forEach(function (x) { if (x && x.sheet && !byName[x.sheet]) byName[x.sheet] = x; });
            } else {
                W.aiError = (res && res.error) || 'The AI could not read the headings.';
            }
            W.sheets = W.rawSheets.map(function (s) {
                var ai = byName[s.name] || null;
                var page = ai && ai.page && meta(ai.page) ? ai.page : null;
                var sh = { name: s.name, headers: s.headers, rows: s.rows, page: page, aiPage: page,
                    reason: ai ? String(ai.reason || '') : '', conf: ai ? Number(ai.confidence) || 0 : 0,
                    aiMapping: ai && Array.isArray(ai.mapping) ? ai.mapping : [], open: false };
                sh.mapping = mappingFor(sh);
                return sh;
            });
            on(3);
            W.busy = false;
            drawSheets();
        }).catch(function (e) {
            W.busy = false;
            W.fileError = (e && e.message) || 'The file could not be read.';
            go(1);
        });
    }

    // The AI's mapping kept to the chosen page's fields (each used once), topped up by heading names.
    function mappingFor(sh) {
        var map = {};
        if (!sh.page) return map;
        var allowed = {}, used = {};
        fieldsOf(sh.page).forEach(function (f) { allowed[f.key] = true; });
        if (sh.page === sh.aiPage) {
            sh.aiMapping.forEach(function (m) {
                if (!m || !m.field || !allowed[m.field] || used[m.field] || sh.headers.indexOf(m.column) === -1) return;
                used[m.field] = true;
                map[m.column] = { field: m.field, confidence: Number(m.confidence) || 0 };
            });
        }
        return E().autoFill(sh, map, fieldsOf(sh.page));
    }

    function usedSheets() { return (W.sheets || []).filter(function (s) { return s.page; }); }

    function sheetDates(sh) {
        var dateField = meta(sh.page).date, col = -1;
        sh.headers.forEach(function (h, i) { if (sh.mapping[h] && sh.mapping[h].field === dateField) col = i; });
        if (col === -1) return '';
        var lo = null, hi = null;
        sh.rows.forEach(function (r) {
            var d = E().parseDate(r[col]);
            if (!d) return;
            if (!lo || d < lo) lo = d;
            if (!hi || d > hi) hi = d;
        });
        return lo ? fmtShort(lo) + ' – ' + fmtShort(hi) : '';
    }

    function sheetProblem(sh) {
        var m = meta(sh.page), mapped = {};
        Object.keys(sh.mapping).forEach(function (k) { mapped[sh.mapping[k].field] = true; });
        var missing = [];
        if (!mapped[m.date]) missing.push(fieldLabel(sh.page, m.date));
        if (m.qtyRequired && !mapped[m.qty]) missing.push(fieldLabel(sh.page, m.qty));
        return missing.length ? 'Sheet "' + sh.name + '": match a column to ' + missing.join(' and ') : '';
    }

    function drawSheets() {
        var b = W.ui.body;
        clear(b);
        if (W.aiError) b.appendChild(el('div', 'alert alert-warning py-2', W.aiError + ' Choose a page for each sheet below; columns are matched by their headings.'));
        var used = usedSheets();
        var rowsTotal = used.reduce(function (a, s) { return a + s.rows.length; }, 0);
        var pagesHit = {};
        used.forEach(function (s) { pagesHit[s.page] = true; });

        var head = el('div');
        if (!W.aiError) head.appendChild(pill('ai', 'AI'));
        head.appendChild(el('strong', 'ms-1', used.length + ' of ' + plural(W.sheets.length, 'sheet') + ' hold transactions'));
        head.appendChild(document.createTextNode(' · ' + plural(rowsTotal, 'row') + ', going to ' + plural(Object.keys(pagesHit).length, 'page')
            + '. Change any sheet below if it looks wrong.'));
        b.appendChild(head);

        var t = el('table', 'table table-sm mt-2 dimp-table dimpa-sheets');
        var thead = el('thead'), hr = el('tr');
        ['Sheet', 'Goes to', 'Rows', 'Dates', 'Sure?', ''].forEach(function (h, i) { hr.appendChild(el('th', i === 2 ? 'text-end' : null, h)); });
        thead.appendChild(hr);
        t.appendChild(thead);
        var tbody = el('tbody');
        W.sheets.forEach(function (sh) {
            var tr = el('tr', sh.page ? null : 'dimpa-skip');
            tr.appendChild(el('td', 'fw-semibold', sh.name));
            var tdSel = el('td');
            var sel = el('select', 'form-select form-select-sm w-auto');
            PAGES.forEach(function (p) { sel.appendChild(option(p.key, meta(p.key).label, sh.page === p.key)); });
            sel.appendChild(option('', 'Don’t import', !sh.page));
            sel.addEventListener('change', function () {
                sh.page = sel.value || null;
                sh.mapping = mappingFor(sh);
                W.plan = null;
                drawSheets();
            });
            tdSel.appendChild(sel);
            tr.appendChild(tdSel);
            if (!sh.page) {
                var why = el('td', 'text-muted small', sh.reason || 'Left out.');
                why.colSpan = 4;
                tr.appendChild(why);
                tbody.appendChild(tr);
                return;
            }
            tr.appendChild(el('td', 'text-end', num(sh.rows.length)));
            tr.appendChild(el('td', 'text-nowrap', sheetDates(sh)));
            var tdc = el('td');
            if (sh.page === sh.aiPage && !W.aiError) tdc.appendChild(confBar(sh.conf)); else tdc.appendChild(el('span', 'text-muted small', 'you chose'));
            tr.appendChild(tdc);
            var tdb = el('td', 'text-end');
            tdb.appendChild(button('btn btn-link btn-sm p-0', sh.open ? 'Hide columns' : 'Columns', function () { sh.open = !sh.open; drawSheets(); }));
            tr.appendChild(tdb);
            tbody.appendChild(tr);
            if (sh.open) tbody.appendChild(mappingRow(sh));
        });
        t.appendChild(tbody);
        b.appendChild(t);

        var note = el('div', 'dimp-note');
        note.textContent = '🔒 The AI only sees each sheet’s headings and first five rows, and only decides which sheet and column is which. All '
            + num(rowsTotal) + ' rows are then read straight from the cells, so no figure is ever typed or guessed by the AI.';
        var least = used.filter(function (s) { return s.page === s.aiPage && !W.aiError; })
            .sort(function (a, c) { return a.conf - c.conf; })[0];
        if (least && least.conf < 0.9) {
            note.appendChild(document.createTextNode(' The '));
            note.appendChild(el('strong', null, least.name));
            note.appendChild(document.createTextNode(' sheet is the least sure (' + Math.round(least.conf * 100) + '%): open its columns to check.'));
        }
        b.appendChild(note);

        var problems = used.map(sheetProblem).filter(Boolean);
        setFoot('Check the plan →', used.length > 0 && !problems.length,
            !used.length ? 'Choose a page for at least one sheet' : (problems[0] || 'Nothing is saved until you press Save'));
    }

    function mappingRow(sh) {
        var tr = el('tr', 'dimpa-maprow');
        tr.appendChild(el('td'));
        var td = el('td');
        td.colSpan = 5;
        var t = el('table', 'table table-sm mb-0 dimp-table');
        var thead = el('thead'), hr = el('tr');
        ['Column in the sheet', 'Goes into', 'Sure?', 'First value'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        t.appendChild(thead);
        var tbody = el('tbody');
        sh.headers.forEach(function (h, i) {
            var r = el('tr');
            r.appendChild(el('td', 'fw-semibold', h));
            var tds = el('td');
            var sel = el('select', 'form-select form-select-sm w-auto');
            var cur = sh.mapping[h] ? sh.mapping[h].field : '';
            sel.appendChild(option('', '(leave out)', !cur));
            fieldsOf(sh.page).forEach(function (f) { sel.appendChild(option(f.key, f.label, f.key === cur)); });
            sel.addEventListener('change', function () {
                var v = sel.value;
                Object.keys(sh.mapping).forEach(function (k) { if (sh.mapping[k].field === v && k !== h) delete sh.mapping[k]; });
                if (v) sh.mapping[h] = { field: v, confidence: 1, manual: true }; else delete sh.mapping[h];
                W.plan = null;
                drawSheets();
            });
            tds.appendChild(sel);
            r.appendChild(tds);
            var tdc = el('td');
            if (sh.mapping[h]) tdc.appendChild(sh.mapping[h].manual ? el('span', 'text-muted small', 'you chose') : confBar(sh.mapping[h].confidence));
            r.appendChild(tdc);
            r.appendChild(el('td', 'text-muted', sh.rows[0] ? String(sh.rows[0][i] == null ? '' : sh.rows[0][i]) : ''));
            tbody.appendChild(r);
        });
        t.appendChild(tbody);
        td.appendChild(t);
        tr.appendChild(td);
        return tr;
    }

    // ------------------------------------------------------------------
    // Step 3: check the plan.
    // ------------------------------------------------------------------

    function renderPlan() {
        if (W.plan) { drawPlan(); return; }
        W.busy = true;
        var b = W.ui.body;
        var w = el('div', 'dimp-reading');
        w.appendChild(el('div', 'spinner-border spinner-border-sm text-success'));
        w.appendChild(el('span', null, 'Checking every row against the whole year…'));
        b.appendChild(w);
        setFoot('Save', false, 'Checking…');

        var keys = PAGES.map(function (p) { return p.key; }).filter(function (k) { return usedSheets().some(function (s) { return s.page === k; }); });
        Promise.all([
            Promise.all(keys.map(function (k) { return E().fetchExisting(k, W.range.from, W.range.to); })),
            E().loadLookups(W, keys.indexOf('kernel_sales_lines') !== -1)
        ]).then(function (r) {
            W.busy = false;
            W.plan = {};
            keys.forEach(function (k, i) { W.plan[k] = buildPage(k, r[0][i]); });
            drawPlan();
        }).catch(function (e) {
            W.busy = false;
            W.plan = null;
            clear(b);
            b.appendChild(el('div', 'alert alert-danger', 'What is already in the portal could not be loaded, so duplicates cannot be checked: '
                + ((e && e.message) || 'unknown error') + '. Try again.'));
            setFoot('Save', false, '');
        });
    }

    function ctxFor(key, extra) {
        var c = { kind: 'spreadsheet', datasetKey: key, fields: fieldsOf(key), from: W.range.from, to: W.range.to,
            contacts: W.contacts || [], styles: W.styles || [] };
        Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
        return c;
    }

    function buildPage(key, existing) {
        var records = [];
        usedSheets().filter(function (s) { return s.page === key; }).forEach(function (sh) {
            var recs = E().withState(ctxFor(key, { sheets: [sh], sheetName: sh.name, mapping: sh.mapping }), function (e) { return e.buildRecords(); });
            recs.forEach(function (r) { r.sheet = sh.name; records.push(r); });
        });
        records.forEach(function (r, i) { r.i = i; });
        var pg = { key: key, def: pageDef(key), existing: existing, records: records, open: false };
        pg.ctx = ctxFor(key, { records: records, existing: existing });
        E().withState(pg.ctx, function (e) { e.classify(); });
        var m = meta(key);
        pg.existingWeeks = {};
        existing.forEach(function (x) { var wk = weekOf(String(x[m.date]).slice(0, 10)); if (wk !== -1) pg.existingWeeks[wk] = true; });
        records.forEach(function (r) { bucket(pg, r); });
        pg.open = records.some(function (r) { return r.b === 'unk'; });
        return pg;
    }

    function outNote(d) {
        if (!d) return '';
        if (d < W.range.from) return 'Before this financial year (starts 1 Apr ' + (W.snap.fy - 1) + ')';
        if (d >= W.snap.cutoverIso) return 'From ' + fmtShort(W.snap.cutoverIso) + ' everything is captured in the portal';
        if (d > (W.snap.todayIso || '')) return 'Dated in the future';
        return 'After this financial year';
    }

    // Sort one classified row into the plan's groups. classify() has already marked new / dup / unk /
    // out / fix; this only splits "new" by what Data health knows about its week.
    function bucket(pg, r) {
        var m = meta(pg.key);
        r.wk = weekOf(r.values[m.date]);
        if (r.status === 'fix') { r.b = 'out'; r.include = false; return; }
        if (r.status === 'out') { r.b = 'out'; r.note = outNote(r.values[m.date]); r.include = false; return; }
        if (r.status === 'dup') { r.b = 'dup'; r.include = false; return; }
        if (r.status === 'unk') { r.b = 'unk'; r.include = false; return; }
        var st = r.wk === -1 ? null : W.snap.status[pg.key][r.wk];
        if (!pg.def.checkable) { r.b = 'new'; r.include = true; return; }
        if (st === 'miss') { r.b = 'fill'; r.include = true; return; }
        if (pg.existingWeeks[r.wk]) { r.b = 'extra'; r.include = false; r.note = extraNote(pg, r, st); return; }
        r.b = 'new';
        r.include = true;
    }

    // Why an extra row is unticked: a near-twin already in the portal, or just a week that has data.
    function extraNote(pg, r, st) {
        var m = meta(pg.key), E_ = E();
        var d = parseIso(r.values[m.date]), qty = Number(r.values[m.qty]) || 0;
        var digits = function (s) { return String(s || '').replace(/\D/g, ''); };
        var twin = pg.existing.filter(function (x) {
            var xd = String(x[m.date]).slice(0, 10);
            if (Math.abs(parseIso(xd) - d) > 3 * 864e5) return false;
            if (Math.abs((Number(x[m.qty]) || 0) - qty) > 0.5) return false;
            var sameName = E_.normName(x[m.name]) && (E_.normName(x[m.name]) === E_.normName(r.values[m.name]) || E_.similarity(x[m.name], r.values[m.name]) >= 0.5);
            var sameRef = digits(x[m.ref]) && digits(x[m.ref]) === digits(r.values[m.ref]);
            return sameName || sameRef;
        })[0];
        if (twin) {
            return 'Looks like ' + (twin[m.ref] || twin[m.name] || 'a row') + ', ' + num(twin[m.qty]) + ' kg, already entered on '
                + fmtShort(String(twin[m.date]).slice(0, 10)) + ': probably the same ' + pg.def.noun + ' typed differently. Leave it unticked unless it was a second ' + pg.def.noun + '.';
        }
        if (pg.key === 'nis_intake' && st === 'diff') return 'This week has fewer intake rows than deliveries booked in, so this row probably belongs.';
        return 'This week already has rows on this page. Tick it if it was a separate ' + pg.def.noun + '; the month check shows whether it belongs.';
    }

    function resolved(pg, r) { return E().withState(pg.ctx, function (e) { return e.resolved(r); }); }
    function counted(pg, r) { return !!(r.include && r.b !== 'out' && r.b !== 'dup' && resolved(pg, r)); }
    function pagesInPlan() { return PAGES.map(function (p) { return W.plan[p.key]; }).filter(Boolean); }
    function countedRows(pg) { return pg.records.filter(function (r) { return counted(pg, r); }); }
    function needsYou(pg) { return pg.records.filter(function (r) { return r.b === 'unk' && !resolved(pg, r); }); }

    function filledWeeks(key) {
        var pg = W.plan && W.plan[key];
        if (!pg) return [];
        return missWeeks(key).filter(function (i) { return pg.records.some(function (r) { return r.wk === i && counted(pg, r); }); });
    }

    function afterStatus(key, i) {
        var s = W.snap.status[key][i];
        var pg = W.plan && W.plan[key];
        if (!pg || s === 'ok' || s === 'future') return s;
        return pg.records.some(function (r) { return r.wk === i && counted(pg, r); }) ? 'will' : s;
    }

    function recon(pg) {
        var m = meta(pg.key), months = {}, active = {};
        function bk(mo) { return months[mo] || (months[mo] = { now: 0, add: 0, file: 0 }); }
        pg.existing.forEach(function (x) { var d = String(x[m.date]).slice(0, 10); if (d >= W.range.from && d <= W.range.to) bk(d.slice(0, 7)).now += Number(x[m.qty]) || 0; });
        pg.records.forEach(function (r) {
            var d = r.values[m.date];
            if (!d || r.b === 'out') return;
            var x = bk(d.slice(0, 7));
            x.file += Number(r.values[m.qty]) || 0;
            if (counted(pg, r)) x.add += Number(r.values[m.qty]) || 0;
            if (r.b !== 'dup') active[d.slice(0, 7)] = true;
        });
        var lines = [], others = 0, othersOff = 0;
        Object.keys(months).sort().forEach(function (mo) {
            var x = months[mo];
            if (!x.file && !x.add) return; // a month the file does not cover
            var after = x.now + x.add, ok = Math.abs(after - x.file) < 0.5;
            if (active[mo]) lines.push({ m: mo, now: x.now, add: x.add, after: after, file: x.file, ok: ok });
            else { others++; if (!ok) othersOff++; }
        });
        return { lines: lines, ok: lines.every(function (l) { return l.ok; }), others: others, othersOff: othersOff };
    }

    function drawPlan() {
        var b = W.ui.body;
        clear(b);
        var pages = pagesInPlan();
        var mw = 0, fw = 0;
        MISS_PAGES.forEach(function (k) { mw += missWeeks(k).length; fw += filledWeeks(k).length; });
        var add = 0, dup = 0, unk = 0, extra = 0, hit = 0;
        pages.forEach(function (pg) {
            var c = countedRows(pg).length;
            add += c;
            if (c) hit++;
            dup += pg.records.filter(function (r) { return r.b === 'dup'; }).length;
            unk += needsYou(pg).length;
            extra += pg.records.filter(function (r) { return r.b === 'extra' && !r.include; }).length;
        });

        var sum = el('div', 'dimp-sumrow');
        [['Missing weeks filled', fw + ' of ' + mw, mw - fw ? (mw - fw) + ' the file has nothing for' : (mw ? 'all of them' : 'none were missing'), ''],
         ['Rows to add', String(add), 'across ' + plural(hit, 'page'), ''],
         ['Already in the portal', String(dup), 'skipped, nothing counted twice', ''],
         ['Needs you', String(unk), (unk ? 'to match' : 'all matched') + (extra ? ' · ' + plural(extra, 'extra row') + ' unticked' : ''), unk ? 'dimpa-warn' : 'dimpa-good']
        ].forEach(function (t) {
            var d = el('div', 'dimp-sum');
            d.appendChild(el('div', 'dimp-sum-k', t[0]));
            d.appendChild(el('div', 'dimp-sum-v ' + t[3], t[1]));
            d.appendChild(el('div', 'dimp-sum-s', t[2]));
            sum.appendChild(d);
        });
        b.appendChild(sum);

        // The Data health grid, before or after this import.
        var gh = el('div', 'd-flex justify-content-between align-items-center flex-wrap gap-2');
        gh.appendChild(el('strong', 'small', 'What Data health will look like'));
        var seg = el('div', 'btn-group btn-group-sm');
        seg.setAttribute('role', 'group');
        [['before', 'Before'], ['after', 'After this import']].forEach(function (x) {
            seg.appendChild(button('btn ' + (W.view === x[0] ? 'btn-secondary' : 'btn-outline-secondary'), x[1], function () { W.view = x[0]; drawPlan(); }));
        });
        gh.appendChild(seg);
        b.appendChild(gh);
        var wrap = el('div', 'dh-grid-wrap mt-1');
        var grid = el('table', 'dh-grid');
        wrap.appendChild(grid);
        b.appendChild(wrap);
        DataHealthPanel.renderPreviewGrid(grid, function (k, i) { return W.view === 'after' ? afterStatus(k, i) : W.snap.status[k][i]; },
            { production_daily: 'filled from the factory, not files' });
        var legend = el('div', 'dh-legend');
        [['will', 'Filled by this file'], ['ok', 'Captured'], ['miss', 'Missing'], ['diff', 'Doesn’t match the factory'], ['none', 'No activity'], ['cant', 'Can’t be checked']].forEach(function (x) {
            var s = el('span', 'dh-legend-item');
            s.appendChild(el('span', 'dh-sw dh-' + x[0]));
            s.appendChild(document.createTextNode(x[1]));
            legend.appendChild(s);
        });
        b.appendChild(legend);

        pages.forEach(function (pg) { b.appendChild(pageCard(pg)); });
        var missing = PAGES.filter(function (p) { return !W.plan[p.key]; }).map(function (p) { return meta(p.key).label; });
        if (missing.length) b.appendChild(el('div', 'text-muted small mt-2', 'Not in this file: ' + missing.join(', ') + '.'));

        var nUnk = unk;
        setFoot('Save ' + plural(add, 'row') + ' across ' + plural(hit, 'page'), add > 0,
            nUnk ? plural(nUnk, 'row') + (nUnk === 1 ? ' needs' : ' need') + ' matching, or save without ' + (nUnk === 1 ? 'it' : 'them') : 'One import, one Undo');
    }

    function pageCard(pg) {
        var m = meta(pg.key);
        var rows = countedRows(pg);
        var kg = rows.reduce(function (a, r) { return a + (Number(r.values[m.qty]) || 0); }, 0);
        var rc = recon(pg);
        var nUnk = needsYou(pg).length;
        var nExtra = pg.records.filter(function (r) { return r.b === 'extra' && !r.include; }).length;

        var card = el('div', 'dimpa-pg' + (pg.open ? ' dimpa-pg-open' : ''));
        var head = el('button', 'dimpa-pg-h');
        head.type = 'button';
        head.setAttribute('aria-expanded', pg.open ? 'true' : 'false');
        head.addEventListener('click', function () { pg.open = !pg.open; drawPlan(); });
        var left = el('div');
        left.appendChild(el('i', 'fas ' + (pg.open ? 'fa-caret-down' : 'fa-caret-right') + ' dimpa-car'));
        left.appendChild(el('strong', null, m.label));
        left.appendChild(el('span', 'text-muted small', ' · ' + plural(rows.length, 'row') + ' to add · ' + num(kg) + ' kg · '
            + (pg.def.checkable ? filledWeeks(pg.key).length + ' of ' + missWeeks(pg.key).length + ' missing weeks filled' : 'Weeks can’t be checked yet')));
        head.appendChild(left);
        var right = el('div', 'd-flex gap-1 flex-wrap');
        if (nUnk) right.appendChild(pill('unk', nUnk + ' needs you'));
        if (nExtra) right.appendChild(pill('dup', nExtra + ' extra unticked'));
        right.appendChild(rc.ok ? pill('new', '✓ Matches the file') : pill('miss', '✗ Doesn’t match yet'));
        head.appendChild(right);
        card.appendChild(head);
        if (!pg.open) return card;

        var body = el('div', 'dimpa-pg-b');
        var lcol = el('div', 'dimpa-tablewrap');
        lcol.appendChild(rowsTable(pg));
        body.appendChild(lcol);
        var rcol = el('div');
        rcol.appendChild(el('div', 'fw-semibold small mb-1', 'Does the portal match the file afterwards?'));
        var t = el('table', 'table table-sm dimp-table dimpa-recon');
        var thead = el('thead'), hr = el('tr');
        ['Month', 'In portal', '+ adding', '= After', 'In the file', ''].forEach(function (h, i) { hr.appendChild(el('th', i && i < 5 ? 'text-end' : null, h)); });
        thead.appendChild(hr);
        t.appendChild(thead);
        var tb = el('tbody');
        rc.lines.forEach(function (l) {
            var tr = el('tr');
            tr.appendChild(el('td', null, MONTHS[+l.m.slice(5) - 1])); // always inside the one financial year
            tr.appendChild(el('td', 'text-end', num(l.now)));
            tr.appendChild(el('td', 'text-end', num(l.add)));
            tr.appendChild(el('td', 'text-end fw-semibold', num(l.after)));
            tr.appendChild(el('td', 'text-end', num(l.file)));
            tr.appendChild(el('td', l.ok ? 'dimp-ok' : 'dimp-bad', l.ok ? '✓' : '✗ ' + num(l.after - l.file)));
            tb.appendChild(tr);
        });
        t.appendChild(tb);
        rcol.appendChild(t);
        var note = el('div', 'dimp-note');
        if (rc.ok) {
            note.appendChild(el('strong', null, '✓ Every month will match the file.'));
            if (rc.others) note.appendChild(document.createTextNode(rc.othersOff
                ? ' Of the other ' + plural(rc.others, 'month') + ' the file covers, ' + rc.othersOff + ' already differ from the portal: it holds rows the file doesn’t, or the other way round.'
                : ' Other months already match.'));
        } else {
            note.appendChild(el('strong', null, 'A ✗ month won’t match the file yet.'));
            note.appendChild(document.createTextNode(' Usually a row still needs matching, or an extra row that really belongs is unticked. The note on each row says which.'));
        }
        rcol.appendChild(note);
        body.appendChild(rcol);
        card.appendChild(body);
        return card;
    }

    var GROUPS = [
        ['fill', 'Fills a missing week · ticked'],
        ['new', null],
        ['unk', 'Needs you'],
        ['extra', 'Extra rows in weeks that already have data · not ticked, to avoid double counting'],
        ['out', 'Left out']
    ];

    function rowsTable(pg) {
        var m = meta(pg.key);
        var xField = pg.def.extra;
        var cols = 6 + (xField ? 1 : 0);
        var t = el('table', 'table table-sm mb-0 dimp-table');
        var thead = el('thead'), hr = el('tr');
        var heads = ['', 'Date', m.who];
        if (xField) heads.push(fieldLabel(pg.key, xField));
        heads.push(fieldLabel(pg.key, m.ref), 'kg', 'What happens');
        heads.forEach(function (h, i) { hr.appendChild(el('th', h === 'kg' ? 'text-end' : null, h)); });
        thead.appendChild(hr);
        t.appendChild(thead);
        var tbody = el('tbody');
        function groupRow(text) { var tr = el('tr', 'dimpa-grp'); var td = el('td', null, text); td.colSpan = cols; tr.appendChild(td); tbody.appendChild(tr); }
        GROUPS.forEach(function (g) {
            var rs = pg.records.filter(function (r) { return r.b === g[0]; });
            if (!rs.length) return;
            var label = g[1] || (pg.def.checkable ? 'New rows in weeks with nothing entered yet · ticked'
                : 'New rows · ticked (this page has nothing to compare against, so every row the portal doesn’t already hold is added)');
            groupRow(label);
            rs.forEach(function (r) { tbody.appendChild(recordRow(pg, r, xField)); });
        });
        var nDup = pg.records.filter(function (r) { return r.b === 'dup'; }).length;
        groupRow('Already in the portal · ' + plural(nDup, 'row') + ' skipped, nothing counted twice');
        t.appendChild(tbody);
        return t;
    }

    function recordRow(pg, r, xField) {
        var m = meta(pg.key);
        var on = counted(pg, r);
        var tr = el('tr', on ? '' : 'dimp-off');
        var tdc = el('td');
        var cb = el('input', 'form-check-input');
        cb.type = 'checkbox';
        cb.checked = on;
        cb.disabled = r.b === 'out' || !resolved(pg, r);
        cb.setAttribute('aria-label', 'Include this row');
        cb.addEventListener('change', function () { r.include = cb.checked; drawPlan(); });
        tdc.appendChild(cb);
        tr.appendChild(tdc);
        tr.appendChild(el('td', 'text-nowrap', r.values[m.date] ? fmtShort(r.values[m.date]) : '–'));

        var tdn = el('td');
        if (r.b === 'unk' && r.note && r.note.indexOf('not recognised') !== -1) {
            tdn.appendChild(el('div', 'text-muted small text-decoration-line-through', r.values[m.name] || ''));
            var sel = el('select', 'form-select form-select-sm dimpa-match');
            sel.appendChild(option('', 'Match to…', !r.choice));
            sel.appendChild(option('__keep__', 'Keep the name as written', r.choice === '__keep__'));
            (W.contacts || []).slice().sort(function (a, c) { return a.name.localeCompare(c.name); }).forEach(function (c) { sel.appendChild(option(c.id, c.name, r.choice === c.id)); });
            sel.addEventListener('change', function () { r.choice = sel.value || null; r.include = resolved(pg, r); drawPlan(); });
            tdn.appendChild(sel);
            if (!r.choice && r.suggestion) {
                tdn.appendChild(button('btn btn-link btn-sm p-0', 'Suggested: ' + r.suggestion.name, function () { r.choice = r.suggestion.id; r.include = resolved(pg, r); drawPlan(); }));
            }
        } else {
            tdn.textContent = r.values[m.name] || '';
        }
        tr.appendChild(tdn);

        if (xField) {
            var tdx = el('td');
            if (r.styleUnknown && xField === 'style_code') {
                tdx.appendChild(el('div', 'text-muted small text-decoration-line-through', r.values.style_code));
                var ss = el('select', 'form-select form-select-sm dimpa-match');
                ss.appendChild(option('', 'Style…', !r.styleChoice));
                ss.appendChild(option('__blank__', 'Leave the style blank', r.styleChoice === '__blank__'));
                (W.styles || []).forEach(function (s) { ss.appendChild(option(s, s, r.styleChoice === s)); });
                ss.addEventListener('change', function () { r.styleChoice = ss.value || null; r.include = resolved(pg, r); drawPlan(); });
                tdx.appendChild(ss);
                var sug = suggestStyle(r.values.style_code);
                if (!r.styleChoice && sug) tdx.appendChild(button('btn btn-link btn-sm p-0', 'Suggested: ' + sug, function () { r.styleChoice = sug; r.include = resolved(pg, r); drawPlan(); }));
            } else {
                tdx.textContent = r.values[xField] == null ? '' : String(r.values[xField]);
            }
            tr.appendChild(tdx);
        }
        tr.appendChild(el('td', 'text-muted text-nowrap', r.values[m.ref] || ''));
        tr.appendChild(el('td', 'text-end text-nowrap', r.values[m.qty] == null ? '' : num(r.values[m.qty])));

        var tds = el('td');
        var note = r.note || '';
        if (r.b === 'fill') tds.appendChild(pill('new', 'Fills week of ' + W.snap.weeks[r.wk].label));
        else if (r.b === 'new') tds.appendChild(pill('new', 'New'));
        else if (r.b === 'extra') tds.appendChild(pill('unk', 'Week already has data'));
        else if (r.b === 'unk') tds.appendChild(resolved(pg, r) ? pill('new', 'Matched') : pill('unk', 'Needs you'));
        else tds.appendChild(pill('dup', 'Left out'));
        if (note && (r.b !== 'unk' || !resolved(pg, r))) tds.appendChild(el('div', 'text-muted small dimpa-rownote', note));
        tr.appendChild(tds);
        return tr;
    }

    // A style in the list that the unknown code starts with (e.g. "5S" -> "5"), if exactly one does.
    function suggestStyle(code) {
        var c = String(code || '').toUpperCase();
        var hits = (W.styles || []).filter(function (s) { var u = String(s).toUpperCase(); return u && c !== u && (c.indexOf(u) === 0 || u.indexOf(c) === 0); });
        return hits.length === 1 ? hits[0] : null;
    }

    // ------------------------------------------------------------------
    // Save / undo.
    // ------------------------------------------------------------------

    function clearCaches() {
        if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) dataFunctions.clearCachePattern('sales_data_');
        if (typeof _salesDataGrid !== 'undefined' && _salesDataGrid.invalidateLedgers) _salesDataGrid.invalidateLedgers();
    }

    function save() {
        var pages = [];
        pagesInPlan().forEach(function (pg) {
            var rows = E().withState(pg.ctx, function (e) { return e.payloadRows(); });
            // payloadRows takes every ticked, resolved row; Left out and Already in the portal are never ticked.
            if (rows.length) pages.push({ dataset_key: pg.key, rows: rows });
        });
        if (!pages.length) return;
        W.busy = true;
        setFoot('Saving…', false, '');
        E().flushGrid().then(function () {
            return dataFunctions.importDataPages(W.file.name, pages);
        }).then(function (res) {
            W.busy = false;
            if (!res || Number(res.success) !== 1) {
                drawPlan();
                var err = el('div', 'alert alert-danger');
                err.textContent = (res && res.error) || 'The import could not be saved.';
                W.ui.body.insertBefore(err, W.ui.body.firstChild);
                return;
            }
            var groupId = String(res.group_id || '');
            W.result = { groupId: groupId, code: 'IMP-' + groupId.slice(0, 8).toUpperCase(), fileName: W.file.name, at: new Date() };
            clearCaches();
            if (typeof W.onSaved === 'function') W.onSaved({ groupId: groupId, code: W.result.code, fileName: W.file.name });
            go(4);
        });
    }

    function confirmUndo() {
        var text = 'Undo this import? Every row it added, on every page, is removed. Rows someone has edited since are kept.';
        if (typeof Swal !== 'undefined' && Swal.fire) {
            return Swal.fire({ title: 'Undo import', text: text, icon: 'warning', showCancelButton: true, confirmButtonText: 'Undo it' })
                .then(function (r) { return !!(r && r.isConfirmed); });
        }
        return Promise.resolve(window.confirm(text));
    }

    // Shared by the Done step, the Data health bar and Recent imports.
    function undo(groupId, report) {
        return confirmUndo().then(function (yes) {
            if (!yes) return null;
            return E().flushGrid().then(function () { return dataFunctions.undoDataImportGroup(groupId); }).then(function (res) {
                if (!res || Number(res.success) !== 1) {
                    if (report) report((res && res.error) || 'The import could not be undone.');
                    return res;
                }
                clearCaches();
                if (report) report('Undone: ' + plural(Number(res.rows_deleted) || 0, 'row') + ' removed'
                    + (Number(res.rows_kept) ? ', ' + res.rows_kept + ' kept because someone edited them since' : '') + '.');
                return res;
            });
        });
    }

    // ------------------------------------------------------------------
    // Step 4: done.
    // ------------------------------------------------------------------

    function renderDone() {
        var b = W.ui.body;
        var pages = pagesInPlan();
        var total = 0, hit = 0, dup = 0;
        pages.forEach(function (pg) { var n = countedRows(pg).length; total += n; if (n) hit++; dup += pg.records.filter(function (r) { return r.b === 'dup'; }).length; });
        var mw = 0, fw = 0;
        MISS_PAGES.forEach(function (k) { mw += missWeeks(k).length; fw += filledWeeks(k).length; });

        var box = el('div', 'dimp-done');
        box.appendChild(el('div', 'dimp-done-tick', '✓'));
        box.appendChild(el('h4', null, plural(total, 'row') + ' added across ' + plural(hit, 'page')));
        box.appendChild(el('div', 'text-muted', fw + ' of ' + mw + ' missing weeks are now green on Data health · ' + plural(dup, 'row') + ' were already there and were skipped'));
        b.appendChild(box);

        var report = el('div', 'dimpa-report');
        pages.forEach(function (pg) {
            var m = meta(pg.key), rows = countedRows(pg);
            if (!rows.length && !pg.def.checkable) return;
            var kg = rows.reduce(function (a, r) { return a + (Number(r.values[m.qty]) || 0); }, 0);
            var months = [];
            rows.forEach(function (r) { var mo = MONTHS[+r.values[m.date].slice(5, 7) - 1]; if (months.indexOf(mo) === -1) months.push(mo); });
            var miss = missWeeks(pg.key), filled = filledWeeks(pg.key);
            var left = miss.filter(function (i) { return filled.indexOf(i) === -1; });
            var ok = !pg.def.checkable || !left.length;
            var line = el('div', 'dimpa-r');
            line.appendChild(el('div', 'dimpa-r-ic ' + (ok ? 'dimp-ok' : 'dimp-bad'), ok ? '✓' : '!'));
            var txt = el('div');
            txt.appendChild(el('strong', null, m.label));
            txt.appendChild(document.createTextNode(': ' + plural(rows.length, 'row') + ', ' + num(kg) + ' kg' + (months.length ? ' (' + months.join(', ') + ')' : '') + '. '));
            if (!pg.def.checkable) {
                txt.appendChild(document.createTextNode('This page has nothing to compare against yet, so every row the portal didn’t already hold was added.'));
            } else if (left.length) {
                txt.appendChild(document.createTextNode(filled.length + ' of ' + miss.length + ' missing weeks filled. '));
                txt.appendChild(el('strong', null, 'Still missing: week of ' + left.map(function (i) { return W.snap.weeks[i].label; }).join(', ')));
                txt.appendChild(document.createTextNode(', because the file has no rows for ' + (left.length === 1 ? 'it' : 'them') + '.'));
            } else {
                txt.appendChild(document.createTextNode(miss.length ? 'All ' + miss.length + ' missing weeks filled.' : 'No weeks were missing.'));
            }
            var skipped = pg.records.filter(function (r) { return r.b !== 'out' && r.b !== 'dup' && !counted(pg, r); }).length;
            if (skipped) txt.appendChild(el('span', 'text-muted small', ' ' + plural(skipped, 'row') + ' you left unticked.'));
            line.appendChild(txt);
            report.appendChild(line);
        });
        b.appendChild(report);

        var todo = [];
        var prod = missWeeks('production_daily');
        if (prod.length) {
            todo.push(['Production (daily)', plural(prod.length, 'week') + ' (' + W.snap.weeks[prod[0]].label + ' – ' + fmtShort(W.snap.weeks[prod[prod.length - 1]].endIso)
                + '). Use Refresh from factory on the Production tab.']);
        }
        PAGES.filter(function (p) { return p.checkable; }).forEach(function (p) {
            var filled = filledWeeks(p.key);
            var left = missWeeks(p.key).filter(function (i) { return filled.indexOf(i) === -1; });
            if (left.length) todo.push([meta(p.key).label, 'week of ' + left.map(function (i) { return W.snap.weeks[i].label; }).join(', ')
                + '. ' + p.missWhat + ' ' + (left.length === 1 ? 'it' : 'them') + '. Enter ' + (left.length === 1 ? 'it' : 'them') + ' on ' + meta(p.key).label + '.']);
        });
        if (todo.length) {
            var tbox = el('div', 'dimpa-todo');
            tbox.appendChild(el('strong', null, 'Still to do (not from this file)'));
            var ul = el('ul');
            todo.forEach(function (x) { var li = el('li'); li.appendChild(el('strong', null, x[0])); li.appendChild(document.createTextNode(': ' + x[1])); ul.appendChild(li); });
            tbox.appendChild(ul);
            b.appendChild(tbox);
        }

        var center = el('div', 'text-center');
        var batch = el('div', 'dimp-batch');
        var at = W.result.at;
        [['Import', W.result.code], ['File', W.result.fileName],
         ['By', 'You · ' + at.getDate() + ' ' + MONTHS[at.getMonth()] + ' ' + at.getFullYear() + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes())]].forEach(function (x) {
            var d = el('div');
            d.appendChild(el('div', 'text-muted small', x[0]));
            d.appendChild(el('strong', null, x[1]));
            batch.appendChild(d);
        });
        var msg = el('div');
        var ub = button('btn btn-sm btn-outline-secondary', '↶ Undo the whole import', function () {
            undo(W.result.groupId, function (text) {
                clear(msg);
                msg.appendChild(el('div', 'alert alert-info mt-3', text));
                ub.disabled = true;
                if (typeof W.onUndone === 'function') W.onUndone();
            });
        });
        batch.appendChild(ub);
        center.appendChild(batch);
        center.appendChild(el('p', 'text-muted small mt-2', 'One Undo takes back every page from this file. Each row is saved as "imported" with the file name, so it shows in that page’s edit history. The dashboards update straight away.'));
        center.appendChild(msg);
        b.appendChild(center);
        setFoot('Done', true, '');
    }

    // ------------------------------------------------------------------
    // Public.
    // ------------------------------------------------------------------

    return {
        /**
         * @param {{snapshot: {fy: number, todayIso: string, cutoverIso: string, weeks: Array, status: Object},
         *          onSaved?: function({groupId: string, code: string, fileName: string}), onUndone?: function}} opts
         */
        open: function (opts) {
            opts = opts || {};
            if (typeof bootstrap === 'undefined' || !bootstrap.Modal || typeof DataImportWizard === 'undefined' || !DataImportWizard.engine) return;
            if (!opts.snapshot || !opts.snapshot.weeks || !opts.snapshot.weeks.length) return;
            if (W && W.ui && W.ui.modal && W.ui.modal.parentNode) W.ui.modal.parentNode.removeChild(W.ui.modal);
            W = {
                step: 1, busy: false, snap: opts.snapshot, view: 'after',
                onSaved: opts.onSaved || null, onUndone: opts.onUndone || null,
                file: null, fileError: null, sheets: null, plan: null, contacts: null, styles: null, fieldsByPage: {}
            };
            W.range = range(W.snap);
            PAGES.forEach(function (p) { W.fieldsByPage[p.key] = DataImportWizard.engine.targetFields(p.key); });
            W.ui = buildModal();
            W.bs = new bootstrap.Modal(W.ui.modal, { backdrop: 'static' });
            W.ui.modal.addEventListener('hidden.bs.modal', function () {
                if (W && W.ui.modal.parentNode) W.ui.modal.parentNode.removeChild(W.ui.modal);
            });
            go(1);
            W.bs.show();
        },
        undo: undo
    };
}());

window.DataImportAllWizard = DataImportAllWizard;
