/**
 * Sales & Production Data — generic row-grid engine.
 *
 * Driven entirely by a column definition (WebPortal/modules/sales-data/js/sales-data-column-defs.js)
 * — this file never references a dataset by name. Modelled on the kernel job-card pattern
 * (WebPortal/modules/modals/modal-kernel-job-card/js/kernel_job_card_stock.js:82-98 for
 * DOM-collection, WebPortal/modules/modals/modal-kernel-job-card/js/modal_kernel_job_card.js:264-267
 * for recompute-on-input) but NOT its unnamespaced $(document) bindings — every binding in the
 * controller that uses this engine is namespaced and removed in destroy().
 *
 * Pure value helpers (formatKg, parseNullableNumber, parseTotalNumber, sameKg, cellState,
 * totalsFor, countSeededDrift, scalarIsoDate, shiftIsoDateByOneDay) touch neither `document` nor
 * `$`/`jQuery` and can be evaluated with plain `vm.Script` and no DOM (same convention as
 * WebPortal/modules/sales-reports/js/report-metric-line.js). The rendering/DOM-collection functions
 * below them reference `w.jQuery`/`w.MacStatus` only inside function bodies — never at evaluation
 * time — so the whole file can still be loaded that way; they simply cannot be *called* without a
 * real DOM.
 *
 * Every database/user value reaches the DOM only via .text()/.val() or an attribute set through
 * jQuery — never .html()/innerHTML/string concatenation into markup.
 */
(function (w) {
    'use strict';

    var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    // ------------------------------------------------------------------
    // Pure value helpers — no DOM, no jQuery, no `document`.
    // ------------------------------------------------------------------

    function isFiniteNumber(v) {
        return typeof v === 'number' ? Number.isFinite(v) : (Number.isFinite(Number(v)) && String(v).trim() !== '');
    }

    // Locale-independent formatting, matching WebPortal/modules/sales-reports/js/report-metric-line.js
    // (no toLocaleString/Intl so behaviour is identical in every browser and in this pure-Node check).
    function formatNumberInternal(n) {
        var fixed = n.toFixed(2);
        var neg = fixed.charAt(0) === '-';
        if (neg) fixed = fixed.slice(1);
        var parts = fixed.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + parts.join('.');
    }

    function formatKg(value) {
        if (value === null || value === undefined) return '\u2014';
        var n = Number(value);
        if (!Number.isFinite(n)) return '\u2014';
        return formatNumberInternal(n);
    }

    // Number of decimal places a column's step implies — 0.01 => 2, 0.001 => 3. Defaults to 2 for
    // a step with no decimal point, and is capped at 6 so a malformed step cannot blow up Math.pow.
    function decimalsForStep(step) {
        var s = String(step == null ? '' : step);
        var dot = s.indexOf('.');
        if (dot < 0) return 2;
        return Math.min(6, s.length - dot - 1);
    }

    // Never falls back to 0 — a blank/unparseable value on a nullable column must stay null, not
    // become a silent 0 that the server would then persist. `decimals` defaults to 2, so existing
    // callers keep the repo's usual Math.round(x*100)/100 behaviour.
    function parseNullableNumber(value, decimals) {
        if (value === null || value === undefined) return null;
        var s = String(value).trim();
        if (s === '') return null;
        var t = s.replace(/\s/g, '');
        if (t.indexOf(',') >= 0 && t.indexOf('.') < 0) {
            t = t.replace(',', '.');
        } else if (t.indexOf(',') >= 0 && t.indexOf('.') >= 0) {
            t = t.replace(/,/g, '');
        }
        var n = parseFloat(t);
        if (!Number.isFinite(n)) return null;
        // Rounds to the column's own scale, not a fixed 2dp: wholes_pct/uncracks_pct are
        // numeric(6,3) with step="0.001", and a hard 2dp round here silently turned a typed
        // 12.345 into 12.35 before it ever reached the database.
        var dp = (decimals === null || decimals === undefined) ? 2 : decimals;
        var f = Math.pow(10, dp);
        return Math.round(n * f) / f;
    }

    // The 0-defaulting parse — used ONLY for the <tfoot> totals row, never for a save payload.
    function parseTotalNumber(value) {
        var n = parseNullableNumber(value);
        return n === null ? 0 : n;
    }

    function sameKg(a, b) {
        var an = (a === null || a === undefined) ? null : Number(a);
        var bn = (b === null || b === undefined) ? null : Number(b);
        if (an === null && bn === null) return true;
        if (an === null || bn === null) return false;
        if (!Number.isFinite(an) || !Number.isFinite(bn)) return false;
        return Math.round(an * 100) === Math.round(bn * 100);
    }

    // Four states: system null => never seeded (no edited/drift accent); otherwise edited/drifted
    // are independent booleans and both may be true at once.
    function cellState(opts) {
        var o = opts || {};
        var system = (o.system === undefined) ? null : o.system;
        var live = (o.live === undefined) ? null : o.live;
        var effective = (o.effective === undefined) ? null : o.effective;
        if (system === null || system === undefined) {
            return { seeded: false, edited: false, drifted: false };
        }
        return {
            seeded: true,
            edited: !sameKg(effective, system),
            drifted: !sameKg(system, live)
        };
    }

    function totalsFor(def, rows) {
        var totals = {};
        if (!def || !Array.isArray(def.columns)) return totals;
        var list = Array.isArray(rows) ? rows : [];
        def.columns.forEach(function (col) {
            if (!col.totalable) return;
            var sum = 0;
            list.forEach(function (row) {
                sum += parseTotalNumber(row ? row[col.key] : null);
            });
            totals[col.key] = Math.round(sum * 100) / 100;
        });
        return totals;
    }

    // Counts only rows whose stored_system is non-null — get_data_production_daily_drift uses
    // IS DISTINCT FROM, so a never-seeded day is returned as "drift" for both fields; that is not
    // evidence of real drift and must not inflate the badge.
    function countSeededDrift(driftRows) {
        var rows = Array.isArray(driftRows) ? driftRows : [];
        var count = 0;
        rows.forEach(function (r) {
            if (r && r.stored_system !== null && r.stored_system !== undefined) count++;
        });
        return count;
    }

    // Accepts a bare string, a one-element array of objects, or a plain object — the three shapes
    // callFunction can hand back for a scalar-returning RPC (data-functions.js:632-639).
    function scalarIsoDate(result) {
        function extract(v) {
            if (typeof v !== 'string') return null;
            var s = v.trim();
            return ISO_DATE_RE.test(s) ? s : null;
        }
        if (result === null || result === undefined) return null;
        var direct = extract(result);
        if (direct) return direct;
        if (Array.isArray(result)) {
            if (!result.length) return null;
            return scalarIsoDate(result[0]);
        }
        if (typeof result === 'object') {
            var keys = Object.keys(result);
            for (var i = 0; i < keys.length; i++) {
                var found = extract(result[keys[i]]);
                if (found) return found;
            }
            return null;
        }
        return null;
    }

    // The single permitted client-side date computation in this module: moves exactly one day,
    // then the server snaps the result to a real period boundary. Date.UTC normalises overflow
    // (day 0 of a month, day 32, etc.) so no manual month-length table is needed.
    function shiftIsoDateByOneDay(iso, delta) {
        if (delta !== 1 && delta !== -1) return null;
        var s = String(iso == null ? '' : iso).trim();
        if (!ISO_DATE_RE.test(s)) return null;
        var parts = s.split('-');
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        var d = parseInt(parts[2], 10);
        var dt = new Date(Date.UTC(y, m - 1, d + delta));
        var pad = function (n) { return n < 10 ? '0' + n : String(n); };
        return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
    }

    // South African standard rate. Named rather than inlined because the three money columns are
    // stored figures, not derived ones — this only ever seeds them, never corrects them on load.
    var VAT_RATE = 0.15;

    // Derives the three money figures from quantity and price. Returns null meaning "leave the row
    // alone" when either input is missing, so a half-typed line is never zeroed out.
    function recomputeMoney(row) {
        var r = row || {};
        var qty = (r.quantity_kg === null || r.quantity_kg === undefined) ? null : Number(r.quantity_kg);
        var price = (r.price_per_kg === null || r.price_per_kg === undefined) ? null : Number(r.price_per_kg);
        if (qty === null || price === null || !Number.isFinite(qty) || !Number.isFinite(price)) return null;
        var excl = Math.round(qty * price * 100) / 100;
        var vat = Math.round(excl * VAT_RATE * 100) / 100;
        var incl = Math.round((excl + vat) * 100) / 100;
        return { vat_excl_zar: excl, vat_zar: vat, vat_incl_zar: incl };
    }

    // A dataset with an idColumn is a ledger (many rows per date, keyed on a uuid); without one it
    // is period-scoped and keyed on its date, which is how production_daily works.
    function isLedger(def) {
        return !!(def && def.idColumn);
    }

    function rowKeyOf(def, row) {
        var r = row || {};
        if (isLedger(def)) {
            var id = r[def.idColumn];
            return (id === null || id === undefined || id === '') ? null : String(id);
        }
        var d = r[def && def.dateColumn];
        return d == null ? null : String(d).slice(0, 10);
    }

    // ------------------------------------------------------------------
    // Rendering / DOM collection — browser only. References w.jQuery/w.MacStatus only inside
    // function bodies, never at evaluation time.
    // ------------------------------------------------------------------

    // Builds one <tr> for a row of `def`'s dataset. `row` is the RPC row; `editable` gates whether
    // inputs are enabled (the caller must have already checked hasAction('reports.data.edit')).
    // Builds a <select> for a `select` (options on the column) or `lookup` (options supplied by the
    // caller) column. Every option's label goes in via .text() and its value via .val() — these are
    // customer names and style labels straight out of the database, never concatenated into markup.
    //
    // `unmatchedFrom` handles a real shape in this data: a row can carry a customer_name with no
    // matching customer_id (63 of the 277 backfilled kernel sales lines do). Rather than silently
    // showing blank, the row's own stored text is prepended as a disabled option so it stays
    // visible; it is never submitted, because collectRowPayload maps it back to null.
    function buildSelectCell(col, row, editable, options) {
        var $ = w.jQuery;
        var r = row || {};
        var current = r[col.key];
        var currentStr = (current === null || current === undefined) ? '' : String(current);
        var list = Array.isArray(options) ? options : [];

        var $sel = $('<select>', { 'class': 'form-select form-select-sm js-sales-data-input' })
            .attr('data-field', col.key)
            .prop('disabled', !editable);
        $sel.append($('<option>').val('').text(col.blankLabel || '—'));

        var matched = false;
        list.forEach(function (opt) {
            var val = (opt && opt.value !== undefined && opt.value !== null) ? String(opt.value) : '';
            if (val === currentStr && currentStr !== '') matched = true;
            $sel.append($('<option>').val(val).text(String((opt && opt.label) || val)));
        });

        if (!matched && currentStr !== '') {
            // A stored value with no matching option — show it rather than resetting it to blank.
            $sel.append($('<option>').val(currentStr).text(currentStr));
            matched = true;
        }
        if (!matched && col.unmatchedFrom) {
            var fallback = r[col.unmatchedFrom];
            var fallbackStr = (fallback === null || fallback === undefined) ? '' : String(fallback).trim();
            if (fallbackStr !== '') {
                $sel.prepend($('<option>').val('').prop('disabled', true)
                    .text(fallbackStr + ' (not linked)'));
            }
        }
        $sel.val(matched ? currentStr : '');
        return $sel;
    }

    function buildRow(def, row, editable, options) {
        var $ = w.jQuery;
        var r = row || {};
        var opts = options || {};
        var ledger = isLedger(def);
        var dateVal = r[def.dateColumn] != null ? String(r[def.dateColumn]).slice(0, 10) : '';
        var $tr = $('<tr>');
        if (ledger) {
            var rowId = rowKeyOf(def, r);
            // A new unsaved row carries no data-row-id at all; collectRowPayload omits `id` for it,
            // which is what makes upsert_data_*_lines treat it as an insert.
            if (rowId) $tr.attr('data-row-id', rowId);
        } else {
            $tr.attr('data-date', dateVal);
        }

        // Leading cell: the date for a period-scoped grid (where it is the row's identity and not
        // editable), or just the quality pill for a ledger (whose date is an editable column).
        var $leadCell = $('<td>').text(ledger ? '' : dateVal);
        var flags = Array.isArray(r.data_quality_flags) ? r.data_quality_flags : [];
        if (flags.length && w.MacStatus) {
            var $pill = $(w.MacStatus.pill('warning', 'Check'));
            $pill.attr('title', flags.map(String).join(', '));
            if (!ledger) $leadCell.append(' ');
            $leadCell.append($pill);
        }
        $tr.append($leadCell);

        (def.columns || []).forEach(function (col) {
            var $td = $('<td>');
            if (col.type === 'select' || col.type === 'lookup') {
                $td.append(buildSelectCell(col, r, editable,
                    col.type === 'select' ? col.options : opts[col.key]));
            } else if (col.type === 'date') {
                var dv = r[col.key] != null ? String(r[col.key]).slice(0, 10) : '';
                $td.append($('<input>', {
                    type: 'date',
                    'class': 'form-control form-control-sm js-sales-data-input'
                }).attr('data-field', col.key).prop('disabled', !editable).val(dv));
            } else if (col.type === 'text') {
                var textVal = r[col.key] != null ? String(r[col.key]) : '';
                var $ta = $('<textarea>', { rows: 1, 'class': 'form-control form-control-sm js-sales-data-input' })
                    .attr('data-field', col.key)
                    .prop('disabled', !editable)
                    .val(textVal);
                $td.append($ta);
            } else if (col.hasSystemTwin) {
                var system = r[col.key + '_system'];
                var live = r[col.key + '_live'];
                var effective = (r[col.key] === undefined) ? null : r[col.key];
                var state = cellState({ system: system, live: live, effective: effective });
                var $input = $('<input>', {
                    type: 'number',
                    step: col.step || '0.01',
                    'class': 'form-control form-control-sm js-sales-data-input'
                }).attr('data-field', col.key)
                    .prop('disabled', !editable)
                    .val(effective === null || effective === undefined ? '' : String(effective));
                if (state.edited) $td.addClass('mac-cell-edited');
                if (state.drifted) $td.addClass('mac-cell-drifted');
                $td.append($input);
                if (!state.seeded) {
                    $td.append($('<div>', { 'class': 'mac-cell-note text-muted small' }).text('Not seeded'));
                } else if (state.drifted) {
                    $td.append($('<div>', { 'class': 'mac-cell-note small' }).text('System now says ' + formatKg(live)));
                }
            } else {
                var numVal = (r[col.key] === undefined || r[col.key] === null) ? '' : String(r[col.key]);
                var $numInput = $('<input>', {
                    type: 'number',
                    step: col.step || '0.01',
                    'class': 'form-control form-control-sm js-sales-data-input'
                }).attr('data-field', col.key)
                    .prop('disabled', !editable)
                    .val(numVal);
                $td.append($numInput);
            }
            $tr.append($td);
        });

        return $tr;
    }

    // Renders the full body: an empty dataset renders macEmptyRow across every column (date +
    // one per definition column), never a raw empty <tbody>.
    function renderRows($tbody, def, rows, editable, options) {
        var $ = w.jQuery;
        var $body = $($tbody);
        $body.empty();
        var list = Array.isArray(rows) ? rows : [];
        var colCount = 1 + ((def && Array.isArray(def.columns)) ? def.columns.length : 0);
        if (!list.length) {
            if (typeof w.macEmptyRow === 'function') {
                $body.html(w.macEmptyRow(colCount,
                    (def && def.emptyText) || 'No production rows for this period.'));
            }
            return;
        }
        list.forEach(function (row) {
            $body.append(buildRow(def, row, editable, options));
        });
    }

    // Appends one blank row to a ledger grid. `defaults` seeds fields the user should not have to
    // retype (in practice the date), and the row carries no data-row-id so it saves as an insert.
    function addBlankRow($tbody, def, editable, options, defaults) {
        var $ = w.jQuery;
        var $body = $($tbody);
        // Drop the macEmptyRow placeholder before the first real row is added.
        $body.find('tr').filter(function () {
            return $(this).find('[data-field]').length === 0;
        }).remove();
        var $tr = buildRow(def, defaults || {}, editable, options);
        $body.append($tr);
        return $tr;
    }

    // Reads one row's <tr> back into a whole-row payload object: production_date plus every column
    // key, numeric columns via parseNullableNumber (never parseTotalNumber — a blank must stay
    // null/invalid here, not become 0), text columns trimmed or null.
    function collectRowPayload(def, trEl) {
        var $ = w.jQuery;
        var $tr = $(trEl);
        var payload = {};
        if (isLedger(def)) {
            // Omit `id` entirely for a new row — the RPC's NULLIF(r->>'id','') routes a row with no
            // id to its INSERT branch, and omitting is clearer than sending an empty string.
            var rowId = $tr.attr('data-row-id');
            if (rowId) payload[def.idColumn] = rowId;
        } else {
            payload[def.dateColumn] = $tr.attr('data-date') || null;
        }
        (def.columns || []).forEach(function (col) {
            var $field = $tr.find('[data-field="' + col.key + '"]');
            var raw = $field.length ? $field.val() : '';
            if (col.type === 'text' || col.type === 'select' || col.type === 'lookup' || col.type === 'date') {
                var s = String(raw == null ? '' : raw).trim();
                payload[col.key] = s === '' ? null : s;
            } else {
                payload[col.key] = parseNullableNumber(raw, decimalsForStep(col.step));
            }
        });
        return payload;
    }

    // Renders the <tfoot> totals row for the totalable columns only.
    function renderTotalsRow($tfoot, def, rows) {
        var $ = w.jQuery;
        var $foot = $($tfoot);
        $foot.empty();
        var totals = totalsFor(def, rows);
        var $tr = $('<tr>');
        $tr.append($('<th>').text('Total'));
        (def.columns || []).forEach(function (col) {
            var $th = $('<th>');
            if (col.totalable) {
                $th.text(formatKg(totals[col.key]));
            }
            $tr.append($th);
        });
        $foot.append($tr);
    }

    w.SalesDataRowGrid = {
        formatKg: formatKg,
        decimalsForStep: decimalsForStep,
        parseNullableNumber: parseNullableNumber,
        parseTotalNumber: parseTotalNumber,
        sameKg: sameKg,
        cellState: cellState,
        totalsFor: totalsFor,
        countSeededDrift: countSeededDrift,
        scalarIsoDate: scalarIsoDate,
        shiftIsoDateByOneDay: shiftIsoDateByOneDay,
        recomputeMoney: recomputeMoney,
        isLedger: isLedger,
        rowKeyOf: rowKeyOf,
        buildRow: buildRow,
        buildSelectCell: buildSelectCell,
        renderRows: renderRows,
        addBlankRow: addBlankRow,
        collectRowPayload: collectRowPayload,
        renderTotalsRow: renderTotalsRow,
        VAT_RATE: VAT_RATE
    };
})(typeof window !== 'undefined' ? window : this);
