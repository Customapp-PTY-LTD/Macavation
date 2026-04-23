/**
 * Modal: Batch History – Grower Intake + Kernel Production timeline.
 * Data source: getKernelProductionHistory (1 call) → intake_data, stage arrays, job_card_data, qa_data.
 */
function formatStageDate(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return '';
    var s = String(isoStr).split('T')[0];
    var parts = s.split('-');
    if (parts.length !== 3) return isoStr;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
}

/** Display string for empty / blank values in batch history (user-facing spelling). */
var BATCH_HISTORY_NIL = 'nill';

function historyEscapeHtml(s) {
    if (s == null || s === '') return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function historyFmt(v, nilStr) {
    nilStr = nilStr == null ? BATCH_HISTORY_NIL : nilStr;
    if (v == null) return nilStr;
    if (typeof v === 'string' && v.trim() === '') return nilStr;
    return historyEscapeHtml(String(v));
}

function historyFmtProductionDate(raw, nilStr) {
    nilStr = nilStr == null ? BATCH_HISTORY_NIL : nilStr;
    if (raw == null || raw === '') return nilStr;
    var s = String(raw).split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatStageDate(s);
    return historyEscapeHtml(String(raw));
}

function mergeBatchHistoryStageObjects(entries) {
    var o = {};
    (entries || []).forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        for (var k in e) {
            if (Object.prototype.hasOwnProperty.call(e, k)) o[k] = e[k];
        }
    });
    return o;
}

/**
 * Same rules as kernel_production_grid hasMeaningfulStageData: ignore date-only rows / placeholders.
 */
function batchHistoryStageEntryHasMeaningful(data) {
    if (!data || typeof data !== 'object') return false;
    for (var key in data) {
        if (!Object.prototype.hasOwnProperty.call(data, key) || key === 'date') continue;
        var val = data[key];
        if (typeof val === 'boolean') {
            if (val) return true;
            continue;
        }
        if (val == null) continue;
        if (typeof val === 'string') {
            if (val.trim() !== '') return true;
            continue;
        }
        return true;
    }
    return false;
}

function batchHistoryStageArrayHasMeaningful(entries) {
    var arr = entries || [];
    for (var i = 0; i < arr.length; i++) {
        if (batchHistoryStageEntryHasMeaningful(arr[i])) return true;
    }
    return false;
}

function batchHistoryDayGroupHasAnyMeaningfulStage(g) {
    if (!g) return false;
    return batchHistoryStageArrayHasMeaningful(g.cracking) ||
        batchHistoryStageArrayHasMeaningful(g.washing) ||
        batchHistoryStageArrayHasMeaningful(g.sorting) ||
        batchHistoryStageArrayHasMeaningful(g.packing);
}

/**
 * Canonical production stage fields (keys match getProductionStagesSectionData / JSON saved by Production modal).
 */
var BATCH_HISTORY_CRACKING_SCHEMA = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'start1', label: 'Start time' },
    { key: 'end1', label: 'End time' },
    { key: 'timespent1', label: 'Time spent' },
    { key: 'startqty1', label: 'Start qty', unit: 'kg' },
    { key: 'endqty1', label: 'End qty', unit: 'kg' },
    { key: 'silo1', label: 'Silo qty', unit: 'kg' },
    { key: 'totaltime', label: 'Total time' },
    { key: 'totalqty', label: 'Total qty', unit: 'kg' },
    { key: 'wholes_07', label: 'Wholes 07h00', unit: 'kg' },
    { key: 'uncracks_07', label: 'Uncracks 07h00', unit: 'kg' },
    { key: 'total_07', label: 'Total 07h00', unit: 'kg' },
    { key: 'wholes_10', label: 'Wholes 10h00', unit: 'kg' },
    { key: 'uncracks_10', label: 'Uncracks 10h00', unit: 'kg' },
    { key: 'total_10', label: 'Total 10h00', unit: 'kg' },
    { key: 'wholes_13', label: 'Wholes 13h00', unit: 'kg' },
    { key: 'uncracks_13', label: 'Uncracks 13h00', unit: 'kg' },
    { key: 'total_13', label: 'Total 13h00', unit: 'kg' },
    { key: 'avg_wholes', label: 'Average wholes', unit: 'kg' },
    { key: 'avg_uncracks', label: 'Average uncracks', unit: 'kg' },
    { key: 'avg_total', label: 'Average total', unit: 'kg' },
    { key: 'shell_bag1', label: 'Shell bag #1' },
    { key: 'shell_batch1', label: 'Shell batch #1' },
    { key: 'shell_qty1', label: 'Shell qty #1', unit: 'kg' },
    { key: 'shell_bag2', label: 'Shell bag #2' },
    { key: 'shell_batch2', label: 'Shell batch #2' },
    { key: 'shell_qty2', label: 'Shell qty #2', unit: 'kg' },
    { key: 'shell_total', label: 'Total shell waste', unit: 'kg' }
];

var BATCH_HISTORY_WASHING_SCHEMA = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'crates_in', label: 'Crates in' },
    { key: 'qty_in', label: 'Quantity in', unit: 'kg' },
    { key: 'floater_crates', label: 'Floater crates out' },
    { key: 'floater_qty', label: 'Floater qty out', unit: 'kg' },
    { key: 'sinker_crates', label: 'Sinker crates out' },
    { key: 'sinker_qty', label: 'Sinker qty out', unit: 'kg' },
    { key: 'total_crates', label: 'Total crates out' },
    { key: 'total_qty', label: 'Total qty out', unit: 'kg' },
    { key: 'crate_diff', label: 'Crate difference' },
    { key: 'qty_diff', label: 'Quantity difference', unit: 'kg' },
    { key: 'test1_time', label: 'Peracetic test 1 time' },
    { key: 'test1_pass', label: 'Peracetic test 1 pass', type: 'bool' },
    { key: 'test2_time', label: 'Peracetic test 2 time' },
    { key: 'test2_pass', label: 'Peracetic test 2 pass', type: 'bool' },
    { key: 'test3_time', label: 'Peracetic test 3 time' },
    { key: 'test3_pass', label: 'Peracetic test 3 pass', type: 'bool' },
    { key: 'waste_shellfines', label: 'Shell fines waste', unit: 'kg' },
    { key: 'waste_compost', label: 'Compost waste', unit: 'kg' },
    { key: 'waste_total', label: 'Waste total', unit: 'kg' }
];

var BATCH_HISTORY_SORTING_SCHEMA = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'floater_crates_in', label: 'Floater crates in' },
    { key: 'floater_qty_in', label: 'Floater qty in', unit: 'kg' },
    { key: 'style0_crates', label: 'Style 0 crates out' },
    { key: 'style0_qty', label: 'Style 0 qty out', unit: 'kg' },
    { key: 'style1_crates', label: 'Style 1 crates out' },
    { key: 'style1_qty', label: 'Style 1 qty out', unit: 'kg' },
    { key: 'style1s_crates', label: 'Style 1S crates out' },
    { key: 'style1s_qty', label: 'Style 1S qty out', unit: 'kg' },
    { key: 'style4l_crates', label: 'Style 4L crates out' },
    { key: 'style4l_qty', label: 'Style 4L qty out', unit: 'kg' },
    { key: 'style5_crates', label: 'Style 5 crates out' },
    { key: 'style5_qty', label: 'Style 5 qty out', unit: 'kg' },
    { key: 'style6_crates', label: 'Style 6 crates out' },
    { key: 'style6_qty', label: 'Style 6 qty out', unit: 'kg' },
    { key: 'style78_crates', label: 'Style 7/8 crates out' },
    { key: 'style78_qty', label: 'Style 7/8 qty out', unit: 'kg' },
    { key: 'sound_crates', label: 'Sound kernel total crates' },
    { key: 'sound_qty', label: 'Sound kernel total qty', unit: 'kg' },
    { key: 'sinker_crates_in', label: 'Sinker crates in' },
    { key: 'sinker_qty_in', label: 'Sinker qty in', unit: 'kg' },
    { key: 'butterlow_crates', label: 'Butter low oil crates out' },
    { key: 'butterlow_qty', label: 'Butter low oil qty out', unit: 'kg' },
    { key: 'butter_crates', label: 'Butter kernel total crates' },
    { key: 'butter_qty', label: 'Butter kernel total qty', unit: 'kg' },
    { key: 'oil_qty', label: 'Oil qty out', unit: 'kg' },
    { key: 'compost_qty', label: 'Compost qty out', unit: 'kg' }
];

var BATCH_HISTORY_PACKING_SCHEMA = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'sk_sp_cartons', label: 'SP cartons' },
    { key: 'sk_sp_qty', label: 'SP quantity', unit: 'kg' },
    { key: 'sk_0_cartons', label: 'Style 0 cartons' },
    { key: 'sk_0_qty', label: 'Style 0 quantity', unit: 'kg' },
    { key: 'sk_1_cartons', label: 'Style 1 cartons' },
    { key: 'sk_1_qty', label: 'Style 1 quantity', unit: 'kg' },
    { key: 'sk_1s_cartons', label: 'Style 1S cartons' },
    { key: 'sk_1s_qty', label: 'Style 1S quantity', unit: 'kg' },
    { key: 'sk_4l_cartons', label: 'Style 4L cartons' },
    { key: 'sk_4l_qty', label: 'Style 4L quantity', unit: 'kg' },
    { key: 'sk_5_cartons', label: 'Style 5 cartons' },
    { key: 'sk_5_qty', label: 'Style 5 quantity', unit: 'kg' },
    { key: 'sk_6_cartons', label: 'Style 6 cartons' },
    { key: 'sk_6_qty', label: 'Style 6 quantity', unit: 'kg' },
    { key: 'sk_total_cartons', label: 'Sound kernel total cartons' },
    { key: 'sk_total_qty', label: 'Sound kernel total qty', unit: 'kg' },
    { key: 'bt_78_cartons', label: 'Butter 7/8 cartons' },
    { key: 'bt_78_qty', label: 'Butter 7/8 quantity', unit: 'kg' },
    { key: 'bt_high_cartons', label: 'Butter high oil cartons' },
    { key: 'bt_high_qty', label: 'Butter high oil quantity', unit: 'kg' },
    { key: 'bt_low_cartons', label: 'Butter low oil cartons' },
    { key: 'bt_low_qty', label: 'Butter low oil quantity', unit: 'kg' },
    { key: 'bt_total_cartons', label: 'Butter kernel total cartons' },
    { key: 'bt_total_qty', label: 'Butter kernel total qty', unit: 'kg' },
    { key: 'totals_cartons', label: 'Grand total cartons' },
    { key: 'totals_qty', label: 'Grand total qty', unit: 'kg' },
    { key: 'signature', label: 'Packed by (signature)', type: 'signature' }
];

function renderBatchHistoryProductionSchemaTable(schema, obj, nilStr) {
    nilStr = nilStr == null ? BATCH_HISTORY_NIL : nilStr;
    if (!schema || !schema.length) return '';
    obj = obj || {};
    var rows = schema.map(function (spec) {
        var raw = obj[spec.key];
        var cell;
        if (spec.type === 'bool') {
            if (raw === true || raw === 'true' || raw === 1 || raw === '1') cell = 'Yes';
            else if (raw === false || raw === 'false' || raw === 0 || raw === '0') cell = 'No';
            else cell = nilStr;
        } else if (spec.type === 'signature') {
            if (raw && typeof raw === 'string' && raw.indexOf('data:image') === 0) cell = 'On file';
            else if (raw != null && String(raw).trim() !== '') cell = historyEscapeHtml(String(raw).length > 120 ? String(raw).substring(0, 120) + '…' : String(raw));
            else cell = nilStr;
        } else if (spec.type === 'date') {
            cell = historyFmtProductionDate(raw, nilStr);
        } else if (raw != null && raw !== '' && spec.unit) {
            cell = historyEscapeHtml(String(raw)) + ' ' + spec.unit;
        } else {
            cell = raw != null && raw !== '' ? historyEscapeHtml(String(raw)) : nilStr;
        }
        return '<tr><th class="text-nowrap bg-light" style="width:38%">' + historyEscapeHtml(spec.label) + '</th><td>' + cell + '</td></tr>';
    }).join('');
    return '<table class="table table-sm table-bordered mb-3"><tbody>' + rows + '</tbody></table>';
}

function buildProductionDayHistoryBody(dayGroup, nilStr) {
    nilStr = nilStr == null ? BATCH_HISTORY_NIL : nilStr;
    var h = '<div class="small">';
    if (batchHistoryStageArrayHasMeaningful(dayGroup.cracking)) {
        h += '<h6 class="small fw-semibold mb-1">Cracking</h6>';
        h += renderBatchHistoryProductionSchemaTable(BATCH_HISTORY_CRACKING_SCHEMA, mergeBatchHistoryStageObjects(dayGroup.cracking), nilStr);
    }
    if (batchHistoryStageArrayHasMeaningful(dayGroup.washing)) {
        h += '<h6 class="small fw-semibold mb-1">Washing</h6>';
        h += renderBatchHistoryProductionSchemaTable(BATCH_HISTORY_WASHING_SCHEMA, mergeBatchHistoryStageObjects(dayGroup.washing), nilStr);
    }
    if (batchHistoryStageArrayHasMeaningful(dayGroup.sorting)) {
        h += '<h6 class="small fw-semibold mb-1">Sorting</h6>';
        h += renderBatchHistoryProductionSchemaTable(BATCH_HISTORY_SORTING_SCHEMA, mergeBatchHistoryStageObjects(dayGroup.sorting), nilStr);
    }
    if (batchHistoryStageArrayHasMeaningful(dayGroup.packing)) {
        h += '<h6 class="small fw-semibold mb-1">Packing</h6>';
        h += renderBatchHistoryProductionSchemaTable(BATCH_HISTORY_PACKING_SCHEMA, mergeBatchHistoryStageObjects(dayGroup.packing), nilStr);
    }
    h += '</div>';
    return h;
}

function getStageSummarySnippets(cracking_data, washing_data, sorting_data, packing_data) {
    var c = cracking_data || {};
    var w = washing_data || {};
    var s = sorting_data || {};
    var p = packing_data || {};
    var n = function (v) { var x = parseFloat(v); return isNaN(x) ? null : x; };
    var parts = [];
    var crackTime = (c.timespent1 || c.totaltime || '').toString().trim();
    var crackQty = n(c.totalqty);
    if (crackTime || crackQty != null) {
        parts.push('Cracking: ' + (crackTime ? crackTime + (crackQty != null ? ', ' : '') : '') + (crackQty != null ? crackQty + ' kg' : ''));
    }
    var washIn = n(w.qty_in);
    var washOut = n(w.total_qty);
    if (washIn != null || washOut != null) {
        parts.push('Washing: ' + (washIn != null ? washIn + ' kg in' : '') + (washIn != null && washOut != null ? ' → ' : '') + (washOut != null ? washOut + ' kg out' : ''));
    }
    var sortSound = n(s.sound_qty);
    var sortButter = n(s.butter_qty);
    if (sortSound != null || sortButter != null) {
        var sp = [];
        if (sortSound != null) sp.push('Sound ' + sortSound + ' kg');
        if (sortButter != null) sp.push('Butter ' + sortButter + ' kg');
        parts.push('Sorting: ' + sp.join(', '));
    }
    var packSk = n(p.sk_total_qty);
    var packBt = n(p.bt_total_qty);
    var packTot = n(p.totals_qty);
    if (packSk != null || packBt != null || packTot != null) {
        var pp = [];
        if (packSk != null) pp.push('SK ' + packSk + ' kg');
        if (packBt != null) pp.push('Butter ' + packBt + ' kg');
        if (packTot != null && (packSk == null && packBt == null)) pp.push(packTot + ' kg');
        if (packTot != null && (packSk != null || packBt != null)) pp.push('Total ' + packTot + ' kg');
        parts.push('Packing: ' + pp.join(', '));
    }
    return parts;
}

function getProductionDayDate(stages) {
    if (!stages) return null;
    var c = stages.cracking_data || {};
    var w = stages.washing_data || {};
    var s = stages.sorting_data || {};
    var p = stages.packing_data || {};
    var raw = c.date || w.date || s.date || p.date;
    if (raw && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
    return null;
}

function getProductionDayDateLatest(stages) {
    if (!stages) return null;
    var c = stages.cracking_data || {};
    var w = stages.washing_data || {};
    var s = stages.sorting_data || {};
    var p = stages.packing_data || {};
    var dates = [c.date, w.date, s.date, p.date].filter(function (raw) {
        return raw && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw);
    });
    if (dates.length === 0) return null;
    dates.sort();
    return dates[dates.length - 1];
}

var _modal_batch_history = (function () {
    'use strict';
    function statusToTitleCase(str) {
        if (!str || typeof str !== 'string') return str || '';
        return str.split('_').map(function (part) {
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        }).join(' ');
    }

    function hasJsonContent(value) {
        return !!(value && typeof value === 'object' && Object.keys(value).length > 0);
    }

    function getBatchDisplayStatus(batch) {
        if (!batch || typeof batch !== 'object') return '';
        var cracking = Array.isArray(batch.cracking_data) ? batch.cracking_data : [];
        var washing = Array.isArray(batch.washing_data) ? batch.washing_data : [];
        var sorting = Array.isArray(batch.sorting_data) ? batch.sorting_data : [];
        var packing = Array.isArray(batch.packing_data) ? batch.packing_data : [];
        var productionDayCount = parseInt(batch.production_day_count, 10) || 0;
        var hasJobCard = !!batch.has_job_card || hasJsonContent(batch.job_card_data);
        var hasQa = !!batch.has_qa || hasJsonContent(batch.qa_data);
        var hasProductionData = productionDayCount > 0 || hasJobCard || cracking.length > 0 || washing.length > 0 || sorting.length > 0 || packing.length > 0;
        var productionFinished = !!batch.production_finished_at;

        if (productionFinished && hasQa) return 'Release ready';
        if (productionFinished) return 'Awaiting test';
        if (hasProductionData) return 'In production';
        return batch.status ? statusToTitleCase(batch.status) : 'Awaiting production';
    }

    function getBatchInfoText(batch) {
        if (!batch) return 'Batch: Loading...';
        var batchNumber = batch.batch_number || 'Batch';
        return 'Batch: ' + batchNumber + (batch.grower_name ? ' — ' + batch.grower_name : '');
    }

    return {
        init: () => {},

        show: (batchOrId) => {
            var batch = (batchOrId && typeof batchOrId === 'object') ? batchOrId : null;
            var batchId = batch && batch.id ? batch.id : batchOrId;
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch ID missing', 'error');
                return;
            }
            $('#batchHistoryModalLabel').text('Batch history');
            if (!batch && typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch) {
                batch = _kernelProductionGrid.getBatch(batchId);
            }
            $('#batchHistoryBatchInfo').text(getBatchInfoText(batch));
            var $container = $('#batchHistoryTimelineEntries');
            $container.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('batchHistoryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#batchHistoryModal').modal('show');

            if (typeof dataFunctions === 'undefined' || !dataFunctions.getKernelProductionHistory) {
                $container.html('<p class="text-danger mb-0">Cannot load batch history.</p>');
                return;
            }

            dataFunctions.getKernelProductionHistory(batchId).then(function (detail) {
                if (!detail) {
                    $container.html('<p class="text-muted mb-0">Batch detail not found.</p>');
                    return;
                }
                var displayBatch = detail || batch || {};
                $('#batchHistoryBatchInfo').text(getBatchInfoText(displayBatch));

                var entries = [];
                var nil = BATCH_HISTORY_NIL;
                var fmt = function (v) { return historyFmt(v, nil); };

                // --- Intake: receiving checklist ---
                var intake = detail.intake_data || {};
                var cl = intake.receiving_checklist;
                if (cl) {
                    var html = '<div class="small">';
                    html += '<table class="table table-sm table-bordered mb-2"><tbody>';
                    html += '<tr><th class="text-nowrap bg-light" style="width:35%">Date received</th><td>' + historyFmtProductionDate(cl.date_received, nil) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Delivery note ref</th><td>' + fmt(cl.delivery_note_ref) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Vehicle clean</th><td>' + fmt(cl.vehicle_clean) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Enclosed</th><td>' + fmt(cl.vehicle_enclosed) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Pallets condition</th><td>' + fmt(cl.pallets_condition) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Comments</th><td>' + fmt(cl.comments) + '</td></tr>';
                    html += '</tbody></table>';
                    var items = Array.isArray(cl.received_items) ? cl.received_items : [];
                    html += '<p class="small fw-semibold mb-1">Received items</p>';
                    html += '<table class="table table-sm table-bordered mt-0"><thead><tr><th>Description</th><th>Qty (kg)</th><th>Manufactured date</th></tr></thead><tbody>';
                    if (items.length === 0) {
                        html += '<tr><td>' + nil + '</td><td>' + nil + '</td><td>' + nil + '</td></tr>';
                    } else {
                        items.forEach(function (it) {
                            html += '<tr><td>' + fmt(it && it.description) + '</td><td>' + fmt(it && it.quantity_kg) + '</td><td>' + historyFmtProductionDate(it && it.manufactured_date, nil) + '</td></tr>';
                        });
                    }
                    html += '</tbody></table></div>';
                    entries.push({ type: 'checklist', title: 'Receiving checklist', bodyHtml: html, date: cl.date_received || null });
                }

                // --- Intake: ziplock sample ---
                var zl = intake.ziplock_sample;
                if (zl != null && typeof zl === 'object') {
                    var zlReq = function (v) {
                        if (v === true || v === 'true' || v === 1 || v === '1') return '&#10003;';
                        if (v === false || v === 'false' || v === 0 || v === '0') return historyEscapeHtml('No');
                        return nil;
                    };
                    var zlRes = function (v, suffix) {
                        if (v == null || v === '') return nil;
                        return historyEscapeHtml(String(v)) + (suffix || '');
                    };
                    var html = '<div class="small">';
                    html += '<table class="table table-sm table-bordered mb-0"><tbody>';
                    html += '<tr><th class="text-nowrap bg-light" style="width:35%">Completed</th><td>' + historyFmtProductionDate(zl.completed_at ? String(zl.completed_at).split('T')[0] : null, nil) + '</td></tr>';
                    html += '</tbody></table>';
                    html += '<table class="table table-sm table-bordered mt-2 mb-0"><thead><tr><th>Test</th><th>Required</th><th>Result</th></tr></thead><tbody>';
                    html += '<tr><td>Moisture</td><td>' + zlReq(zl.moisture_required) + '</td><td>' + zlRes(zl.moisture_result, '%') + '</td></tr>';
                    html += '<tr><td>Peroxide value</td><td>' + zlReq(zl.peroxide_required) + '</td><td>' + zlRes(zl.peroxide_result, ' meqO&#8322;/kg') + '</td></tr>';
                    html += '<tr><td>Free fatty acids</td><td>' + zlReq(zl.ffa_required) + '</td><td>' + zlRes(zl.ffa_result, '%') + '</td></tr>';
                    html += '</tbody></table></div>';
                    entries.push({ type: 'sample', title: 'Ziplock sample', bodyHtml: html, date: zl.completed_at ? String(zl.completed_at).split('T')[0] : null });
                }

                // --- Intake: 5kg sample ---
                var kg5 = intake.five_kg_sample;
                if (kg5 != null && typeof kg5 === 'object') {
                    var co = kg5.crack_out && typeof kg5.crack_out === 'object' ? kg5.crack_out : {};
                    var ft = kg5.float_test && typeof kg5.float_test === 'object' ? kg5.float_test : {};
                    var gCell = function (v) {
                        if (v == null || v === '') return nil;
                        return historyEscapeHtml(String(v)) + ' g';
                    };
                    var html = '<div class="small">';
                    html += '<table class="table table-sm table-bordered mb-2"><tbody>';
                    html += '<tr><th class="text-nowrap bg-light" style="width:35%">Completed</th><td>' + historyFmtProductionDate(kg5.completed_at ? String(kg5.completed_at).split('T')[0] : null, nil) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Crack out — sound kernel</th><td>' + gCell(co.sound_kernel_g) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Crack out — unsound kernel</th><td>' + gCell(co.unsound_kernel_g) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Crack out — shell</th><td>' + gCell(co.shell_g) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Float test — floating</th><td>' + gCell(ft.floating_g) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Float test — sinking</th><td>' + gCell(ft.sinking_g) + '</td></tr>';
                    html += '</tbody></table></div>';
                    entries.push({ type: 'sample', title: '5kg sample', bodyHtml: html, date: kg5.completed_at ? String(kg5.completed_at).split('T')[0] : null });
                }

                // --- Production days ---
                var cracking = Array.isArray(detail.cracking_data) ? detail.cracking_data : [];
                var washing  = Array.isArray(detail.washing_data)  ? detail.washing_data  : [];
                var sorting  = Array.isArray(detail.sorting_data)  ? detail.sorting_data  : [];
                var packing  = Array.isArray(detail.packing_data)  ? detail.packing_data  : [];

                // Group all stage entries by date — each array is independent
                var dayMap = {};
                var noDateKey = '__nodate';
                var collectStage = function (arr, stageName) {
                    arr.forEach(function (entry) {
                        var raw = entry && entry.date;
                        var key = (raw && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw))
                            ? raw.substring(0, 10) : noDateKey;
                        if (!dayMap[key]) dayMap[key] = { cracking: [], washing: [], sorting: [], packing: [] };
                        dayMap[key][stageName].push(entry);
                    });
                };
                collectStage(cracking, 'cracking');
                collectStage(washing,  'washing');
                collectStage(sorting,  'sorting');
                collectStage(packing,  'packing');

                var sortedDates = Object.keys(dayMap).sort(function (a, b) {
                    if (a === noDateKey) return 1;
                    if (b === noDateKey) return -1;
                    return a < b ? -1 : a > b ? 1 : 0;
                });

                var dayNum = 0;
                sortedDates.forEach(function (dateKey) {
                    var g = dayMap[dateKey];
                    if (!batchHistoryDayGroupHasAnyMeaningfulStage(g)) return;
                    dayNum++;
                    var dateLabel = dateKey === noDateKey ? ('Day ' + dayNum) : ('Day ' + dayNum + ' &ndash; ' + formatStageDate(dateKey));
                    var html = buildProductionDayHistoryBody(g, nil);
                    entries.push({ type: 'production', title: dateLabel, bodyHtml: html, date: dateKey === noDateKey ? null : dateKey });
                });

                // --- Job card ---
                // DATA SOURCES (getKernelProductionHistory): detail = kernel row + batches.batch_id.
                //   - detail.job_card_data  → kernel.job_card_data (jsonb, saved by upsert_kernel_job_card; keys without p_)
                //   - detail.grower_name    → kernel.grower_name (varchar)
                //   - detail.actual_wet_nis_kg → kernel.actual_wet_nis_kg (numeric), only if migration adds it to get_kernel_production_history
                //   - detail.received_date  → kernel.received_date (date)
                // Job card jsonb keys (either key or p_key): batch_number, received_date, total_weight_kg, supplier_name,
                //   packing_start_date, packing_completion_date, sound_kernel_total_cartons, sound_kernel_total_kg,
                //   butter_grade_total_cartons, butter_grade_total_kg.
                var jc = (detail.job_card_data && Object.keys(detail.job_card_data).length) ? detail.job_card_data : null;
                if (jc) {
                    var jcVal = function (key) {
                        var v = jc[key];
                        if (v != null && v !== '') return v;
                        var pKey = 'p_' + key;
                        return (jc[pKey] != null && jc[pKey] !== '') ? jc[pKey] : null;
                    };
                    var fmtText = function (v) { return historyFmt(v, nil); };
                    var fmtDate = function (v) {
                        return historyFmtProductionDate(v ? String(v).split('T')[0] : null, nil);
                    };
                    var fmtMeasure = function (v, suffix) {
                        if (v == null || v === '') return nil;
                        var n = parseFloat(v);
                        if (isNaN(n)) return historyEscapeHtml(String(v));
                        var text = Number.isInteger(n) ? String(n) : n.toFixed(2);
                        return historyEscapeHtml(suffix ? text + ' ' + suffix : text);
                    };
                    var parseArray = function (value) {
                        if (!value) return null;
                        if (Array.isArray(value)) return value;
                        if (typeof value === 'string') {
                            try { return JSON.parse(value); } catch (e) { return null; }
                        }
                        return null;
                    };
                    var rowHtml = function (label, value) {
                        return '<tr><th class="text-nowrap bg-light" style="width: 35%;">' + label + '</th><td>' + value + '</td></tr>';
                    };
                    var batchNumber = jcVal('batch_number') || detail.batch_number || null;
                    var receivedDate = jcVal('received_date') || detail.received_date || null;
                    var supplierDisplay = jcVal('supplier_name') || detail.grower_name || null;
                    var totalWeightKg = jcVal('total_weight_kg');
                    if (totalWeightKg == null && detail.actual_wet_nis_kg != null && detail.actual_wet_nis_kg !== '') totalWeightKg = detail.actual_wet_nis_kg;
                    var removedPreSizerKg = jcVal('removed_pre_sizer_kg');
                    var balanceKg = jcVal('balance_kg');
                    var receivingMoisture = jcVal('receiving_moisture_percentage');
                    var packingMoisture = jcVal('packing_moisture_percentage');
                    var removedMoisture = jcVal('removed_moisture_percentage');
                    var packingStart = jcVal('packing_start_date');
                    var packingCompletion = jcVal('packing_completion_date');
                    var bestBefore = jcVal('best_before_date');
                    var soundCartons = jcVal('sound_kernel_total_cartons');
                    var soundKg = jcVal('sound_kernel_total_kg');
                    var butterCartons = jcVal('butter_grade_total_cartons');
                    var butterKg = jcVal('butter_grade_total_kg');
                    var wasteOilKernel = jcVal('waste_oil_kernel_kg');
                    var wasteShellFines = jcVal('waste_shell_fines_kg');
                    var wasteCompost = jcVal('waste_compost_kg');
                    var wasteShell = jcVal('waste_shell_kg');
                    var massBalanceIn = jcVal('mass_balance_in_kg');
                    var massBalanceOut = jcVal('mass_balance_out_kg');
                    var massBalancePercentage = jcVal('mass_balance_percentage');
                    var soundKernelStyles = parseArray(jcVal('sound_kernel_styles'));
                    var butterGradeStyles = parseArray(jcVal('butter_grade_styles'));

                    var html = '<div class="small">';
                    html += '<div class="card mb-2 border-0 bg-light"><div class="card-body py-2">';
                    html += '<div class="fw-semibold mb-1">' + fmtText(batchNumber) + '</div>';
                    html += '<div><strong>Received:</strong> ' + fmtDate(receivedDate) + ' &nbsp; <strong>Supplier:</strong> ' + fmtText(supplierDisplay) + '</div>';
                    html += '<div class="mt-1"><strong>Production batch ID:</strong> ' + fmtText(jcVal('production_batch_id')) + '</div>';
                    html += '</div></div>';

                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Receiving</strong></div><div class="card-body py-2 p-0">';
                    html += '<table class="table table-sm table-bordered mb-0"><tbody>';
                    html += rowHtml('Total weight', fmtMeasure(totalWeightKg, 'kg'));
                    html += rowHtml('Removed pre-sizer', fmtMeasure(removedPreSizerKg, 'kg'));
                    html += rowHtml('Balance', fmtMeasure(balanceKg, 'kg'));
                    html += '</tbody></table></div></div>';

                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Moisture</strong></div><div class="card-body py-2 p-0">';
                    html += '<table class="table table-sm table-bordered mb-0"><tbody>';
                    html += rowHtml('Receiving moisture', fmtMeasure(receivingMoisture, '%'));
                    html += rowHtml('Packing moisture', fmtMeasure(packingMoisture, '%'));
                    html += rowHtml('Removed moisture', fmtMeasure(removedMoisture, '%'));
                    html += '</tbody></table></div></div>';

                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Packing</strong></div><div class="card-body py-2 p-0">';
                    html += '<table class="table table-sm table-bordered mb-0"><tbody>';
                    html += rowHtml('Packing start', fmtDate(packingStart));
                    html += rowHtml('Packing completion', fmtDate(packingCompletion));
                    html += rowHtml('Best before', fmtDate(bestBefore));
                    html += '</tbody></table></div></div>';

                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sound kernel</strong></div><div class="card-body py-2">';
                    html += '<table class="table table-sm table-bordered mb-2"><thead><tr><th>Style</th><th>Cartons</th><th>Weight (kg)</th></tr></thead><tbody>';
                    if (soundKernelStyles && soundKernelStyles.length > 0) {
                        soundKernelStyles.forEach(function (row) {
                            html += '<tr><td>' + fmtText(row && row.style) + '</td><td>' + fmtText(row && row.cartons) + '</td><td>' + fmtMeasure(row && row.weight_kg, null) + '</td></tr>';
                        });
                    } else {
                        html += '<tr><td>' + nil + '</td><td>' + nil + '</td><td>' + nil + '</td></tr>';
                    }
                    html += '</tbody></table>';
                    html += '<div><strong>Total cartons:</strong> ' + fmtText(soundCartons) + ' &nbsp; <strong>Total kg:</strong> ' + fmtMeasure(soundKg, null) + '</div>';
                    html += '</div></div>';

                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Butter grade</strong></div><div class="card-body py-2">';
                    html += '<table class="table table-sm table-bordered mb-2"><thead><tr><th>Style</th><th>Cartons</th><th>Weight (kg)</th></tr></thead><tbody>';
                    if (butterGradeStyles && butterGradeStyles.length > 0) {
                        butterGradeStyles.forEach(function (row) {
                            html += '<tr><td>' + fmtText(row && row.style) + '</td><td>' + fmtText(row && row.cartons) + '</td><td>' + fmtMeasure(row && row.weight_kg, null) + '</td></tr>';
                        });
                    } else {
                        html += '<tr><td>' + nil + '</td><td>' + nil + '</td><td>' + nil + '</td></tr>';
                    }
                    html += '</tbody></table>';
                    html += '<div><strong>Total cartons:</strong> ' + fmtText(butterCartons) + ' &nbsp; <strong>Total kg:</strong> ' + fmtMeasure(butterKg, null) + '</div>';
                    html += '</div></div>';

                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Waste</strong></div><div class="card-body py-2 p-0">';
                    html += '<table class="table table-sm table-bordered mb-0"><tbody>';
                    html += rowHtml('Oil kernel', fmtMeasure(wasteOilKernel, 'kg'));
                    html += rowHtml('Shell fines', fmtMeasure(wasteShellFines, 'kg'));
                    html += rowHtml('Compost', fmtMeasure(wasteCompost, 'kg'));
                    html += rowHtml('Shell', fmtMeasure(wasteShell, 'kg'));
                    html += '</tbody></table></div></div>';

                    html += '<div class="card mb-0"><div class="card-header py-1"><strong>Mass balance</strong></div><div class="card-body py-2 p-0">';
                    html += '<table class="table table-sm table-bordered mb-0"><tbody>';
                    html += rowHtml('Mass balance in', fmtMeasure(massBalanceIn, 'kg'));
                    html += rowHtml('Mass balance out', fmtMeasure(massBalanceOut, 'kg'));
                    html += rowHtml('Mass balance %', fmtMeasure(massBalancePercentage, '%'));
                    html += '</tbody></table></div></div>';
                    html += '</div>';

                    entries.push({ type: 'job_card', title: 'Job Card', bodyHtml: html, date: packingCompletion || receivedDate || null });
                }

                // --- QA / End sample ---
                var qa = (detail.qa_data && Object.keys(detail.qa_data).length) ? detail.qa_data : null;
                if (qa) {
                    var qaReq = function (v) {
                        if (v === true || v === 'true' || v === 1 || v === '1') return '&#10003;';
                        if (v === false || v === 'false' || v === 0 || v === '0') return historyEscapeHtml('No');
                        return nil;
                    };
                    var fmt2 = function (v) { return historyFmt(v, nil); };
                    var html = '<div class="small">';
                    html += '<table class="table table-sm table-bordered mb-2"><tbody>';
                    html += '<tr><th class="text-nowrap bg-light" style="width:35%">Completed</th><td>' + historyFmtProductionDate(qa.completed_at ? String(qa.completed_at).split('T')[0] : null, nil) + '</td></tr>';
                    html += '</tbody></table>';
                    html += '<table class="table table-sm table-bordered mb-2"><thead><tr><th>Test</th><th>Required</th><th>Result</th></tr></thead><tbody>';
                    html += '<tr><td>Moisture</td><td>' + qaReq(qa.moisture_required) + '</td><td>' + fmt2(qa.moisture_result) + '</td></tr>';
                    html += '<tr><td>Peroxide</td><td>' + qaReq(qa.peroxide_required) + '</td><td>' + fmt2(qa.peroxide_result) + '</td></tr>';
                    html += '<tr><td>FFA</td><td>' + qaReq(qa.ffa_required) + '</td><td>' + fmt2(qa.ffa_result) + '</td></tr>';
                    html += '<tr><td>Internal micro</td><td>' + qaReq(qa.internal_micro_required) + '</td><td>' + fmt2(qa.internal_micro_result) + '</td></tr>';
                    html += '<tr><td>External lab</td><td>' + qaReq(qa.external_lab_required) + '</td><td>' + fmt2(qa.external_lab_result) + '</td></tr>';
                    html += '</tbody></table>';
                    html += '<table class="table table-sm table-bordered mb-0"><tbody>';
                    html += '<tr><th class="text-nowrap bg-light" style="width:35%">Signed (Supervisor)</th><td>' + fmt2(qa.supervisor_signed_by) + '</td></tr>';
                    html += '<tr><th class="text-nowrap bg-light">Signed (Nut Plant Manager)</th><td>' + fmt2(qa.nut_plant_manager_signed_by) + '</td></tr>';
                    html += '</tbody></table></div>';
                    entries.push({ type: 'qa', title: 'End Sample (QA)', bodyHtml: html, date: qa.completed_at ? String(qa.completed_at).split('T')[0] : null });
                }

                entries.reverse();

                var statusLabel = getBatchDisplayStatus(displayBatch);

                var html = '';
                entries.forEach(function (entry, idx) {
                    var bodyHtml = entry.bodyHtml || '';
                    var titleHtml = entry.title || '';
                    if (idx === 0 && statusLabel) {
                        titleHtml = '<span class="batch-history-timeline__title-text">' + titleHtml + '</span> <span class="badge rounded-pill batch-history-timeline__status-badge">' + statusLabel + '</span>';
                    }
                    html += '<div class="batch-history-timeline__entry">';
                    html += '<div class="batch-history-timeline__node"></div>';
                    html += '<div class="batch-history-timeline__block">';
                    html += '<h6 class="batch-history-timeline__block-title">' + titleHtml + '</h6>';
                    html += '<div class="batch-history-timeline__block-body">' + bodyHtml + '</div>';
                    html += '</div></div>';
                });
                if (entries.length === 0) {
                    html = '<p class="text-muted mb-0">No timeline data for this batch.</p>';
                }
                $container.html(html);
            }).catch(function () {
                $container.html('<p class="text-danger mb-0">Could not load timeline.</p>');
            });
        }
    };
}());
_modal_batch_history.init();
