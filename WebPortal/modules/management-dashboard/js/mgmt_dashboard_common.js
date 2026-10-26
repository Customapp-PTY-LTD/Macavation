/**
 * Shared helpers for the Kernel and Oil dashboards (Home menu).
 *
 * Financial year: April to March, mirroring report_fy_of_date exactly as
 * modules/report-targets/js/report_targets_grid.js:82-86 does - FY 2027 runs 1 Apr 2026 to 31 Mar 2027.
 *
 * Security invariant: every value that comes from the database (supplier, customer, style, product
 * line names, dates) reaches the DOM through textContent only - never innerHTML. Chart.js labels are
 * drawn on a canvas and are safe. Colours are read from the --mac-* design tokens at runtime; this
 * file holds no colour literals.
 */
var MgmtDashboard = (function () {
    'use strict';

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Data older than this many days gets a "behind" warning on its section.
    var STALE_DAYS = 14;

    // ------------------------------------------------------------------
    // Dates and the financial year.
    // ------------------------------------------------------------------

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

    function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

    // Mirrors report_fy_of_date: April onwards belongs to the next year's FY.
    function fyOf(date) { return date.getFullYear() + (date.getMonth() + 1 >= 4 ? 1 : 0); }

    function fyRange(fy) { return { from: (fy - 1) + '-04-01', to: fy + '-03-31' }; }

    function fyLabel(fy) { return 'FY ' + fy + ' (Apr ' + (fy - 1) + ' – Mar ' + fy + ')'; }

    // The 12 'YYYY-MM' keys of a financial year, April first.
    function fyMonths(fy) {
        var out = [];
        for (var i = 0; i < 12; i++) {
            var m = 3 + i; // 0-based April
            var y = fy - 1 + Math.floor(m / 12);
            out.push(y + '-' + pad((m % 12) + 1));
        }
        return out;
    }

    // Quarter 1..4 of a financial year: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar.
    function quarterRange(fy, q) {
        var months = fyMonths(fy).slice((q - 1) * 3, q * 3);
        var last = months[2].split('-');
        var lastDay = new Date(+last[0], +last[1], 0).getDate();
        return { from: months[0] + '-01', to: months[2] + '-' + pad(lastDay), months: months };
    }

    function quarterOfMonthKey(key) {
        var m = +key.split('-')[1];
        return Math.floor(((m - 4 + 12) % 12) / 3) + 1;
    }

    function currentMonthKey() { var t = today(); return t.getFullYear() + '-' + pad(t.getMonth() + 1); }

    function monthLabel(key) {
        var label = MONTHS[+key.split('-')[1] - 1];
        return key === currentMonthKey() ? label + ' (to date)' : label;
    }

    function prettyDate(iso) {
        if (!iso) return '';
        var p = String(iso).slice(0, 10).split('-');
        return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0];
    }

    function daysSince(iso) {
        if (!iso) return null;
        var p = String(iso).slice(0, 10).split('-');
        var d = new Date(+p[0], +p[1] - 1, +p[2]);
        return Math.round((today() - d) / 86400000);
    }

    // ------------------------------------------------------------------
    // Numbers.
    // ------------------------------------------------------------------

    function num(v) { return Math.round(Number(v) || 0).toLocaleString('en-ZA').replace(/ /g, ' '); }
    function kg(v) { return num(v) + ' kg'; }
    function litres(v) { return num(v) + ' L'; }
    function rand(v) { return 'R ' + num(v); }
    function pct(a, b) { return b ? ((a - b) / b) * 100 : null; }

    // Turns a [{month: 'YYYY-MM', <field>: n}] array into a value per FY month, 0 where missing.
    function seriesFor(rows, months, field) {
        var map = {};
        (rows || []).forEach(function (r) { if (r && r.month) map[r.month] = Number(r[field]) || 0; });
        return months.map(function (m) { return map[m] || 0; });
    }

    // ------------------------------------------------------------------
    // DOM - textContent only.
    // ------------------------------------------------------------------

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = String(text);
        return e;
    }

    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

    // A stat tile: label, big value, small note. deltaPct (optional) renders an up/down chip.
    function tile(label, value, note, deltaPct) {
        var t = el('div', 'mgmt-tile');
        t.appendChild(el('div', 'mgmt-tile-label', label));
        var v = el('div', 'mgmt-tile-value');
        if (deltaPct != null && isFinite(deltaPct)) {
            v.appendChild(el('span', deltaPct >= 0 ? 'mgmt-up' : 'mgmt-down',
                (deltaPct >= 0 ? '▲ ' : '▼ ') + Math.abs(deltaPct).toFixed(0) + '%'));
            if (value) v.appendChild(el('span', 'mgmt-tile-value-after', ' ' + value));
        } else {
            v.textContent = value;
        }
        t.appendChild(v);
        if (note) t.appendChild(el('div', 'mgmt-tile-note', note));
        return t;
    }

    function setTiles(id, tiles) {
        var host = document.getElementById(id);
        if (!host) return;
        clear(host);
        tiles.forEach(function (t) { host.appendChild(t); });
    }

    // "Data up to 8 Oct 2026", plus a warning link to Data health when it is more than STALE_DAYS old.
    function setFreshness(id, lastDate, whatIsMissing) {
        var host = document.getElementById(id);
        if (!host) return;
        clear(host);
        if (!lastDate) {
            host.appendChild(el('span', 'mgmt-fresh', 'No data captured yet'));
            return;
        }
        host.appendChild(el('span', 'mgmt-fresh', 'Data up to ' + prettyDate(lastDate)));
        var age = daysSince(lastDate);
        if (age != null && age > STALE_DAYS) {
            var a = el('a', 'mgmt-stale', '⚠ ' + age + ' days behind – check Data health');
            a.href = '#';
            a.title = whatIsMissing || 'Open Sales & Production Data to see what is missing';
            a.addEventListener('click', function (e) {
                e.preventDefault();
                if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) _appRouter.routeTo('sales-data-grid');
            });
            host.appendChild(a);
        }
    }

    // Replaces a chart's box with an empty-state message (macEmptyState escapes its arguments).
    function emptyBox(canvasId, title, hint) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;
        var box = canvas.parentNode;
        destroyChart(canvasId);
        canvas.classList.add('d-none');
        var old = box.querySelector('.mgmt-empty');
        if (old) old.remove();
        // Same markup as macEmptyState (js/ui-states.js), built with textContent.
        var holder = el('div', 'mgmt-empty mac-empty-state text-center py-4');
        holder.appendChild(el('i', 'fas fa-inbox mac-empty-icon mb-2'));
        holder.appendChild(el('div', 'mac-empty-title', title));
        if (hint) holder.appendChild(el('div', 'mac-empty-hint', hint));
        box.appendChild(holder);
    }

    function unEmptyBox(canvasId) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;
        canvas.classList.remove('d-none');
        var old = canvas.parentNode.querySelector('.mgmt-empty');
        if (old) old.remove();
    }

    // ------------------------------------------------------------------
    // Charts.
    // ------------------------------------------------------------------

    var charts = {};

    function token(name) {
        try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; }
    }

    function rgba(rgbToken, alpha) {
        var rgb = token(rgbToken);
        return rgb ? 'rgba(' + rgb + ', ' + alpha + ')' : token('--mac-text-tertiary');
    }

    function colors() {
        return {
            green: token('--mac-green'), tan: token('--mac-tan'), info: token('--mac-info'),
            greenSoft: rgba('--mac-green-rgb', 0.4), tanSoft: rgba('--mac-tan-rgb', 0.4),
            grid: token('--mac-border'), text: token('--mac-text-tertiary'), surface: token('--mac-bg')
        };
    }

    function destroyChart(id) {
        if (charts[id]) { try { charts[id].destroy(); } catch (e) { /* already gone */ } delete charts[id]; }
    }

    function destroyAll() { Object.keys(charts).forEach(destroyChart); }

    function axisFormatter(unit) {
        return function (v) {
            if (unit === 'R') return v >= 1e6 ? 'R ' + (v / 1e6) + 'm' : v >= 1000 ? 'R ' + (v / 1000) + 'k' : 'R ' + v;
            if (unit === 'L') return v >= 1000 ? (v / 1000) + 'k L' : v + ' L';
            return v >= 1000 ? (v / 1000) + 't' : v;
        };
    }

    function valueFormatter(unit) {
        return unit === 'R' ? rand : unit === 'L' ? litres : kg;
    }

    // type: 'bar' | 'hbar' | 'line'. datasets: [{label, data, color, dashed, pointColors, barColors}]
    function drawChart(canvasId, type, labels, datasets, unit, opts) {
        opts = opts || {};
        var canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return;
        unEmptyBox(canvasId);
        destroyChart(canvasId);
        var c = colors();
        var fmt = valueFormatter(unit);
        var horizontal = type === 'hbar';
        var isLine = type === 'line';
        var valueAxis = { grid: { color: c.grid, drawTicks: false }, border: { display: false },
            beginAtZero: true, ticks: { color: c.text, padding: 6, callback: axisFormatter(unit) } };
        var catAxis = { grid: { display: false }, border: { display: false },
            ticks: { color: c.text, autoSkip: !horizontal } };
        var ds = datasets.map(function (d) {
            var col = d.color || c.green;
            var base = { label: d.label || '', data: d.data };
            if (isLine) {
                base.borderColor = col;
                base.backgroundColor = col;
                base.borderWidth = 2;
                base.tension = 0.25;
                base.pointRadius = d.pointRadius || 3;
                base.pointBackgroundColor = d.pointColors || col;
                base.borderDash = d.dashed ? [6, 4] : [];
                base.spanGaps = false;
            } else {
                base.backgroundColor = d.barColors || col;
                base.borderRadius = 4;
                base.borderSkipped = 'start';
                base.maxBarThickness = 34;
            }
            return base;
        });
        charts[canvasId] = new Chart(canvas, {
            type: isLine ? 'line' : 'bar',
            data: { labels: labels, datasets: ds },
            options: {
                indexAxis: horizontal ? 'y' : 'x',
                maintainAspectRatio: false,
                animation: false,
                interaction: isLine ? { mode: 'index', intersect: false } : { mode: 'nearest', intersect: true },
                scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
                plugins: {
                    legend: { display: datasets.length > 1, position: 'top', align: 'end',
                        labels: { usePointStyle: true, boxWidth: 8, boxHeight: 6, color: c.text } },
                    tooltip: { callbacks: { label: function (ctx) {
                        var v = horizontal ? ctx.parsed.x : ctx.parsed.y;
                        if (v == null) return '';
                        var extra = opts.tooltipExtra ? opts.tooltipExtra(v, ctx) : '';
                        return ' ' + (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + fmt(v) + extra;
                    } } }
                }
            }
        });
    }

    // Monthly bars with the current (part) month drawn lighter.
    function monthBarColors(months, solid, soft) {
        var cur = currentMonthKey();
        return months.map(function (m) { return m === cur ? soft : solid; });
    }

    // Sizes a horizontal bar chart's box to its number of rows.
    function fitHeight(canvasId, rows) {
        var canvas = document.getElementById(canvasId);
        if (canvas && canvas.parentNode) canvas.parentNode.style.height = Math.max(220, 28 * rows + 60) + 'px';
    }

    // ------------------------------------------------------------------
    // Filter bar (FY, quarter, optional From/To) - shared by both screens.
    // ------------------------------------------------------------------

    // prefix: element id prefix ('kd' or 'od'). onChange(period) gets
    // {fy, quarter, from, to, months, label, custom}.
    function bindPeriodBar(prefix, onChange) {
        var fySel = document.getElementById(prefix + 'Fy');
        var qWrap = document.getElementById(prefix + 'Quarter');
        var fromEl = document.getElementById(prefix + 'From');
        var toEl = document.getElementById(prefix + 'To');
        var clearBtn = document.getElementById(prefix + 'ClearDates');
        var cur = fyOf(today());
        clear(fySel);
        [cur, cur - 1, cur - 2].forEach(function (fy) {
            var o = el('option', null, fyLabel(fy));
            o.value = String(fy);
            fySel.appendChild(o);
        });
        var state = { fy: cur, quarter: 0 };

        function current() {
            var f = fromEl && fromEl.value, t = toEl && toEl.value;
            if (f && t && f <= t) {
                return { fy: state.fy, quarter: 0, from: f, to: t, months: monthsBetween(f, t), custom: true,
                    label: prettyDate(f) + ' – ' + prettyDate(t) };
            }
            if (state.quarter) {
                var q = quarterRange(state.fy, state.quarter);
                return { fy: state.fy, quarter: state.quarter, from: q.from, to: q.to, months: q.months, custom: false,
                    label: 'Q' + state.quarter + ' of FY ' + state.fy };
            }
            var r = fyRange(state.fy);
            return { fy: state.fy, quarter: 0, from: r.from, to: r.to, months: fyMonths(state.fy), custom: false,
                label: 'FY ' + state.fy };
        }

        fySel.addEventListener('change', function () { state.fy = +fySel.value; onChange(current()); });
        Array.prototype.forEach.call(qWrap.querySelectorAll('button[data-q]'), function (b) {
            b.addEventListener('click', function () {
                state.quarter = +b.getAttribute('data-q');
                Array.prototype.forEach.call(qWrap.querySelectorAll('button'), function (x) {
                    x.classList.toggle('active', x === b);
                });
                onChange(current());
            });
        });
        [fromEl, toEl].forEach(function (inp) {
            if (inp) inp.addEventListener('change', function () { onChange(current()); });
        });
        if (clearBtn) clearBtn.addEventListener('click', function () {
            fromEl.value = ''; toEl.value = '';
            onChange(current());
        });
        return current;
    }

    function monthsBetween(fromIso, toIso) {
        var out = [];
        var y = +fromIso.slice(0, 4), m = +fromIso.slice(5, 7);
        var ey = +toIso.slice(0, 4), em = +toIso.slice(5, 7);
        while (y < ey || (y === ey && m <= em)) {
            out.push(y + '-' + pad(m));
            m++; if (m > 12) { m = 1; y++; }
            if (out.length > 60) break;
        }
        return out;
    }

    // The same months one financial year earlier (for this-year-vs-last comparisons).
    function shiftMonthsBackOneYear(months) {
        return months.map(function (k) { return (+k.slice(0, 4) - 1) + k.slice(4); });
    }

    // Two-state chip toggle (e.g. kg / R). Returns a getter.
    function bindToggle(wrapId, onChange) {
        var wrap = document.getElementById(wrapId);
        var active = wrap ? wrap.querySelector('button.active') : null;
        var value = active ? active.getAttribute('data-v') : null;
        if (!wrap) return function () { return value; };
        Array.prototype.forEach.call(wrap.querySelectorAll('button[data-v]'), function (b) {
            b.addEventListener('click', function () {
                value = b.getAttribute('data-v');
                Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (x) {
                    x.classList.toggle('active', x === b);
                });
                onChange(value);
            });
        });
        return function () { return value; };
    }

    // Stock-on-hand rows [{d, series, qty_kg}] -> {dates, totals, latest: [{series, qty_kg}], lastDate}.
    function summariseStock(rows) {
        var byDate = {};
        (rows || []).forEach(function (r) {
            if (!r || !r.d) return;
            var d = String(r.d).slice(0, 10);
            (byDate[d] = byDate[d] || []).push(r);
        });
        var dates = Object.keys(byDate).sort();
        var totals = dates.map(function (d) {
            return byDate[d].reduce(function (s, r) { return s + (Number(r.qty_kg) || 0); }, 0);
        });
        var lastDate = dates.length ? dates[dates.length - 1] : null;
        var latest = lastDate ? byDate[lastDate].map(function (r) {
            return { series: r.series, qty_kg: Number(r.qty_kg) || 0 };
        }).filter(function (r) { return r.qty_kg !== 0; }).sort(function (a, b) { return b.qty_kg - a.qty_kg; }) : [];
        return { dates: dates, totals: totals, latest: latest, lastDate: lastDate };
    }

    // Weekly points from daily totals (every 7th day back from the latest), for a readable 12-month line.
    function weeklyPoints(stock) {
        var labels = [], values = [];
        for (var i = stock.dates.length - 1; i >= 0; i -= 7) {
            labels.unshift(prettyDate(stock.dates[i]).replace(/ \d{4}$/, ''));
            values.unshift(stock.totals[i]);
        }
        return { labels: labels, values: values };
    }

    // Simple table into a <table> element: headers [{text, num}], rows [[cells]], optional total row.
    function fillTable(tableId, headers, rows, totalRow) {
        var t = document.getElementById(tableId);
        if (!t) return;
        clear(t);
        var thead = el('thead'), trh = el('tr');
        headers.forEach(function (h) { trh.appendChild(el('th', h.num ? 'text-end' : null, h.text)); });
        thead.appendChild(trh);
        t.appendChild(thead);
        var tbody = el('tbody');
        rows.forEach(function (r) {
            var tr = el('tr');
            r.forEach(function (cell, i) { tr.appendChild(el('td', headers[i] && headers[i].num ? 'text-end' : null, cell)); });
            tbody.appendChild(tr);
        });
        if (totalRow) {
            var tr = el('tr', 'mgmt-total-row');
            totalRow.forEach(function (cell, i) { tr.appendChild(el('td', headers[i] && headers[i].num ? 'text-end' : null, cell)); });
            tbody.appendChild(tr);
        }
        t.appendChild(tbody);
    }

    return {
        MONTHS: MONTHS, today: today, isoOf: isoOf, fyOf: fyOf, fyRange: fyRange, fyLabel: fyLabel,
        fyMonths: fyMonths, quarterRange: quarterRange, quarterOfMonthKey: quarterOfMonthKey,
        currentMonthKey: currentMonthKey, monthLabel: monthLabel, prettyDate: prettyDate, daysSince: daysSince,
        num: num, kg: kg, litres: litres, rand: rand, pct: pct, seriesFor: seriesFor,
        el: el, clear: clear, tile: tile, setTiles: setTiles, setFreshness: setFreshness,
        emptyBox: emptyBox, colors: colors, drawChart: drawChart, destroyAll: destroyAll,
        monthBarColors: monthBarColors, fitHeight: fitHeight, bindPeriodBar: bindPeriodBar,
        shiftMonthsBackOneYear: shiftMonthsBackOneYear, bindToggle: bindToggle,
        summariseStock: summariseStock, weeklyPoints: weeklyPoints, fillTable: fillTable
    };
}());

window.MgmtDashboard = MgmtDashboard;
