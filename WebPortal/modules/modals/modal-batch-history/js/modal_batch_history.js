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
    var sortButter = n(s.butterhigh_qty);
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
    return {
        init: () => {},

        show: (batchId) => {
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            var batchInfo = (batch.batch_number || 'Batch') + (batch.grower_name ? ' — ' + batch.grower_name : '');
            $('#batchHistoryModalLabel').text('Batch history');
            $('#batchHistoryBatchInfo').text('Batch: ' + batchInfo);
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

                var entries = [];
                var fmt = function (v) { return v != null && v !== '' ? String(v) : '—'; };

                // --- Intake: receiving checklist ---
                var intake = detail.intake_data || {};
                var cl = intake.receiving_checklist;
                if (cl) {
                    var html = '<div class="small">';
                    html += '<p class="mb-1"><strong>Date received:</strong> ' + fmt(cl.date_received) + '</p>';
                    html += '<p class="mb-1"><strong>Delivery note ref:</strong> ' + fmt(cl.delivery_note_ref) + '</p>';
                    if (cl.vehicle_clean || cl.vehicle_enclosed) {
                        html += '<p class="mb-1"><strong>Vehicle clean:</strong> ' + fmt(cl.vehicle_clean) + ' &nbsp; <strong>Enclosed:</strong> ' + fmt(cl.vehicle_enclosed) + '</p>';
                    }
                    if (cl.pallets_condition) html += '<p class="mb-1"><strong>Pallets condition:</strong> ' + fmt(cl.pallets_condition) + '</p>';
                    if (cl.comments) html += '<p class="mb-2"><strong>Comments:</strong> ' + fmt(cl.comments) + '</p>';
                    var items = cl.received_items || [];
                    if (items.length > 0) {
                        html += '<table class="table table-sm table-bordered mt-2"><thead><tr><th>Description</th><th>Qty (kg)</th><th>Manufactured Date</th></tr></thead><tbody>';
                        items.forEach(function (it) {
                            html += '<tr><td>' + fmt(it.description) + '</td><td>' + fmt(it.quantity_kg) + '</td><td>' + fmt(it.manufactured_date) + '</td></tr>';
                        });
                        html += '</tbody></table>';
                    }
                    html += '</div>';
                    entries.push({ type: 'checklist', title: 'Receiving checklist', bodyHtml: html, date: cl.date_received || null });
                }

                // --- Intake: ziplock sample ---
                var zl = intake.ziplock_sample;
                if (zl && zl.completed_at) {
                    var html = '<div class="small">';
                    if (zl.submission_number) html += '<p class="mb-1"><strong>Submission:</strong> ' + fmt(zl.submission_number) + '</p>';
                    html += '<p class="mb-1"><strong>Completed:</strong> ' + fmt(zl.completed_at ? String(zl.completed_at).split('T')[0] : null) + '</p>';
                    if (zl.moisture) html += '<p class="mb-1"><strong>Moisture:</strong> ' + (zl.moisture.required ? '&#10003; ' : '') + (zl.moisture.result != null ? zl.moisture.result + '%' : '—') + '</p>';
                    if (zl.peroxide) html += '<p class="mb-1"><strong>Peroxide:</strong> ' + (zl.peroxide.required ? '&#10003; ' : '') + (zl.peroxide.result != null ? zl.peroxide.result + ' meqO2/kg' : '—') + '</p>';
                    if (zl.ffa) html += '<p class="mb-0"><strong>FFA:</strong> ' + (zl.ffa.required ? '&#10003; ' : '') + (zl.ffa.result != null ? zl.ffa.result + '%' : '—') + '</p>';
                    html += '</div>';
                    entries.push({ type: 'sample', title: 'Ziplock sample', bodyHtml: html, date: String(zl.completed_at).split('T')[0] || null });
                }

                // --- Intake: 5kg sample ---
                var kg5 = intake.five_kg_sample;
                if (kg5 && kg5.completed_at) {
                    var html = '<div class="small">';
                    html += '<p class="mb-1"><strong>Completed:</strong> ' + fmt(String(kg5.completed_at).split('T')[0]) + '</p>';
                    if (kg5.crack_out) {
                        html += '<p class="mb-1"><strong>Crack out:</strong> Sound ' + fmt(kg5.crack_out.sound_kernel_g) + 'g, Unsound ' + fmt(kg5.crack_out.unsound_kernel_g) + 'g, Shell ' + fmt(kg5.crack_out.shell_g) + 'g</p>';
                    }
                    if (kg5.float_test) {
                        html += '<p class="mb-0"><strong>Float test:</strong> Floating ' + fmt(kg5.float_test.floating_g) + 'g, Sinking ' + fmt(kg5.float_test.sinking_g) + 'g</p>';
                    }
                    html += '</div>';
                    entries.push({ type: 'sample', title: '5kg sample', bodyHtml: html, date: String(kg5.completed_at).split('T')[0] || null });
                }

                // --- Production days ---
                var cracking = Array.isArray(detail.cracking_data) ? detail.cracking_data : [];
                var washing  = Array.isArray(detail.washing_data)  ? detail.washing_data  : [];
                var sorting  = Array.isArray(detail.sorting_data)  ? detail.sorting_data  : [];
                var packing  = Array.isArray(detail.packing_data)  ? detail.packing_data  : [];
                var maxLen = Math.max(cracking.length, washing.length, sorting.length, packing.length);
                for (var i = 0; i < maxLen; i++) {
                    var c = cracking[i] || {};
                    var w = washing[i]  || {};
                    var s = sorting[i]  || {};
                    var p = packing[i]  || {};
                    var dayDate = getProductionDayDateLatest({ cracking_data: c, washing_data: w, sorting_data: s, packing_data: p })
                               || getProductionDayDate({ cracking_data: c, washing_data: w, sorting_data: s, packing_data: p });
                    var snippets = getStageSummarySnippets(c, w, s, p);
                    var dateDisplay = dayDate ? ('Day ' + (i + 1) + ' (' + formatStageDate(dayDate) + ')') : ('Day ' + (i + 1));
                    var html = '<div class="small"><p class="mb-1"><strong>Date:</strong> ' + dateDisplay + '</p>';
                    if (snippets.length > 0) {
                        html += '<ul class="mb-0 ps-3">' + snippets.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>';
                    } else {
                        html += '<p class="text-muted mb-0">No stage data recorded for this day.</p>';
                    }
                    html += '</div>';
                    entries.push({ type: 'production', title: 'Production — Day ' + (i + 1), bodyHtml: html, date: dayDate || null });
                }

                // --- Job card ---
                var jc = (detail.job_card_data && Object.keys(detail.job_card_data).length) ? detail.job_card_data : null;
                if (jc) {
                    var fmtN = function (v) { return v != null && v !== '' ? (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v)) : '—'; };
                    var html = '<div class="small">';
                    html += '<p class="mb-1"><strong>Batch:</strong> ' + fmtN(jc.batch_number) + ' &nbsp; <strong>Received:</strong> ' + fmtN(jc.received_date) + '</p>';
                    html += '<p class="mb-1"><strong>Total weight (kg):</strong> ' + fmtN(jc.total_weight_kg) + ' &nbsp; <strong>Supplier:</strong> ' + fmtN(jc.supplier_name) + '</p>';
                    html += '<p class="mb-1"><strong>Packing:</strong> ' + fmtN(jc.packing_start_date) + ' – ' + fmtN(jc.packing_completion_date) + '</p>';
                    html += '<p class="mb-0"><strong>Sound kernel:</strong> ' + fmtN(jc.sound_kernel_total_cartons) + ' cartons, ' + fmtN(jc.sound_kernel_total_kg) + ' kg &nbsp; <strong>Butter grade:</strong> ' + fmtN(jc.butter_grade_total_cartons) + ' cartons, ' + fmtN(jc.butter_grade_total_kg) + ' kg</p></div>';
                    entries.push({ type: 'job_card', title: 'Job Card', bodyHtml: html, date: jc.packing_completion_date || jc.received_date || null });
                }

                // --- QA / End sample ---
                var qa = (detail.qa_data && Object.keys(detail.qa_data).length) ? detail.qa_data : null;
                if (qa) {
                    var tick = function (b) { return b ? '&#10003;' : '—'; };
                    var fmt2 = function (v) { return v != null && v !== '' ? v : '—'; };
                    var html = '<div class="small">';
                    html += '<table class="table table-sm table-bordered mb-2"><thead><tr><th>Test</th><th>Required</th><th>Result</th></tr></thead><tbody>';
                    html += '<tr><td>Moisture</td><td>'       + tick(qa.moisture_required)       + '</td><td>' + fmt2(qa.moisture_result)       + '</td></tr>';
                    html += '<tr><td>Peroxide</td><td>'       + tick(qa.peroxide_required)       + '</td><td>' + fmt2(qa.peroxide_result)       + '</td></tr>';
                    html += '<tr><td>FFA</td><td>'            + tick(qa.ffa_required)            + '</td><td>' + fmt2(qa.ffa_result)            + '</td></tr>';
                    html += '<tr><td>Internal Micro</td><td>' + tick(qa.internal_micro_required) + '</td><td>' + fmt2(qa.internal_micro_result) + '</td></tr>';
                    html += '<tr><td>External Lab</td><td>'   + tick(qa.external_lab_required)   + '</td><td>' + fmt2(qa.external_lab_result)   + '</td></tr>';
                    html += '</tbody></table>';
                    if (qa.supervisor_signed_by)         html += '<p class="mb-0"><strong>Signed (Supervisor):</strong> '      + fmt2(qa.supervisor_signed_by)         + '</p>';
                    if (qa.nut_plant_manager_signed_by)  html += '<p class="mb-0"><strong>Signed (Nut Plant Manager):</strong> ' + fmt2(qa.nut_plant_manager_signed_by) + '</p>';
                    html += '</div>';
                    entries.push({ type: 'qa', title: 'End Sample (QA)', bodyHtml: html, date: qa.completed_at ? String(qa.completed_at).split('T')[0] : null });
                }

                entries.reverse();

                var statusLabel = '';
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatchDisplayStatus) {
                    var displayStatus = _kernelProductionGrid.getBatchDisplayStatus(batch);
                    statusLabel = displayStatus && displayStatus.label ? displayStatus.label : '';
                }
                if (!statusLabel && batch && batch.status) {
                    statusLabel = String(batch.status).split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(' ');
                }

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
