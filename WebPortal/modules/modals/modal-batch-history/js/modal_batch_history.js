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
                    html += '<p class="mb-2"><strong>Completed:</strong> ' + fmt(String(zl.completed_at).split('T')[0]) + '</p>';
                    html += '<table class="table table-sm table-bordered mb-0"><thead><tr><th>Test</th><th>Required</th><th>Result</th></tr></thead><tbody>';
                    if (zl.moisture_required || zl.moisture_result != null) {
                        html += '<tr><td>Moisture</td><td>' + (zl.moisture_required ? '&#10003;' : '—') + '</td><td>' + (zl.moisture_result != null ? zl.moisture_result + '%' : '—') + '</td></tr>';
                    }
                    if (zl.peroxide_required || zl.peroxide_result != null) {
                        html += '<tr><td>Peroxide Value</td><td>' + (zl.peroxide_required ? '&#10003;' : '—') + '</td><td>' + (zl.peroxide_result != null ? zl.peroxide_result + ' meqO&#8322;/kg' : '—') + '</td></tr>';
                    }
                    if (zl.ffa_required || zl.ffa_result != null) {
                        html += '<tr><td>Free Fatty Acids</td><td>' + (zl.ffa_required ? '&#10003;' : '—') + '</td><td>' + (zl.ffa_result != null ? zl.ffa_result + '%' : '—') + '</td></tr>';
                    }
                    html += '</tbody></table></div>';
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

                var nv = function (v) { var x = parseFloat(v); return isNaN(x) ? null : x; };
                var dayNum = 0;
                sortedDates.forEach(function (dateKey) {
                    dayNum++;
                    var g = dayMap[dateKey];
                    var dateLabel = dateKey === noDateKey ? ('Day ' + dayNum) : ('Day ' + dayNum + ' &ndash; ' + formatStageDate(dateKey));
                    var lines = [];

                    g.cracking.forEach(function (c) {
                        var crackTime = (c.timespent1 || c.totaltime || '').toString().trim();
                        var crackQty = nv(c.totalqty);
                        if (crackTime || crackQty != null) {
                            lines.push('<strong>Cracking:</strong> ' + (crackTime ? crackTime : '') + (crackTime && crackQty != null ? ', ' : '') + (crackQty != null ? crackQty + ' kg' : ''));
                        }
                    });
                    g.washing.forEach(function (w) {
                        var washIn = nv(w.qty_in);
                        var washOut = nv(w.total_qty);
                        if (washIn != null || washOut != null) {
                            lines.push('<strong>Washing:</strong> ' + (washIn != null ? washIn + ' kg in' : '') + (washIn != null && washOut != null ? ' &rarr; ' : '') + (washOut != null ? washOut + ' kg out' : ''));
                        }
                    });
                    g.sorting.forEach(function (s) {
                        var sortFields = [
                            { key: 'sound_qty',     label: 'Sound' },
                            { key: 'butter_qty',    label: 'Butter' },
                            { key: 'butterlow_qty', label: 'Butter Low' },
                            { key: 'oil_qty',       label: 'Oil' },
                            { key: 'compost_qty',   label: 'Compost' }
                        ];
                        var sp = [];
                        sortFields.forEach(function (f) {
                            var v = nv(s[f.key]);
                            if (v != null) sp.push(f.label + ' ' + v + ' kg');
                        });
                        if (sp.length > 0) lines.push('<strong>Sorting:</strong> ' + sp.join(', '));
                    });
                    g.packing.forEach(function (p) {
                        var packSk = nv(p.sk_total_qty);
                        var packBt = nv(p.bt_total_qty);
                        var packTot = nv(p.totals_qty);
                        if (packSk != null || packBt != null || packTot != null) {
                            var pp = [];
                            if (packSk != null) pp.push('SK ' + packSk + ' kg');
                            if (packBt != null) pp.push('Butter ' + packBt + ' kg');
                            if (packTot != null && packSk == null && packBt == null) pp.push(packTot + ' kg');
                            if (packTot != null && (packSk != null || packBt != null)) pp.push('Total ' + packTot + ' kg');
                            lines.push('<strong>Packing:</strong> ' + pp.join(', '));
                        }
                    });

                    var html = '<div class="small">';
                    if (lines.length > 0) {
                        html += '<ul class="mb-0 ps-3">' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>';
                    } else {
                        html += '<p class="text-muted mb-0">No data recorded.</p>';
                    }
                    html += '</div>';
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
                    var fmtN = function (v) { return v != null && v !== '' ? (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v)) : '—'; };
                    // Batch: kernel.job_card_data.batch_number (or .p_batch_number)
                    var batchNumber = jcVal('batch_number');
                    // Received: kernel.job_card_data.received_date (or .p_received_date)
                    var receivedDate = jcVal('received_date');
                    // Total weight: kernel.job_card_data.total_weight_kg, fallback kernel.actual_wet_nis_kg
                    var totalWeightKg = jcVal('total_weight_kg');
                    if (totalWeightKg == null && detail.actual_wet_nis_kg != null && detail.actual_wet_nis_kg !== '') totalWeightKg = detail.actual_wet_nis_kg;
                    // Supplier: kernel.job_card_data.supplier_name, fallback kernel.grower_name
                    var supplierDisplay = jcVal('supplier_name');
                    if (supplierDisplay == null && detail.grower_name != null && detail.grower_name !== '') supplierDisplay = detail.grower_name;
                    // Packing dates: kernel.job_card_data.packing_start_date / packing_completion_date
                    var packingStart = jcVal('packing_start_date');
                    var packingCompletion = jcVal('packing_completion_date');
                    // Sound kernel / Butter grade: kernel.job_card_data.sound_kernel_total_* / butter_grade_total_*
                    var soundCartons = jcVal('sound_kernel_total_cartons');
                    var soundKg = jcVal('sound_kernel_total_kg');
                    var butterCartons = jcVal('butter_grade_total_cartons');
                    var butterKg = jcVal('butter_grade_total_kg');
                    var html = '<div class="small">';
                    html += '<p class="mb-1"><strong>Batch:</strong> ' + fmtN(batchNumber) + ' &nbsp; <strong>Received:</strong> ' + fmtN(receivedDate) + '</p>';
                    html += '<p class="mb-1"><strong>Total weight (kg):</strong> ' + fmtN(totalWeightKg) + ' &nbsp; <strong>Supplier:</strong> ' + fmtN(supplierDisplay) + '</p>';
                    html += '<p class="mb-1"><strong>Packing:</strong> ' + fmtN(packingStart) + ' – ' + fmtN(packingCompletion) + '</p>';
                    html += '<p class="mb-0"><strong>Sound kernel:</strong> ' + fmtN(soundCartons) + ' cartons, ' + fmtN(soundKg) + ' kg &nbsp; <strong>Butter grade:</strong> ' + fmtN(butterCartons) + ' cartons, ' + fmtN(butterKg) + ' kg</p></div>';
                    entries.push({ type: 'job_card', title: 'Job Card', bodyHtml: html, date: packingCompletion || receivedDate || null });
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
