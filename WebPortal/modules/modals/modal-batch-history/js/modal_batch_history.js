/**
 * Modal: Batch History – Grower Intake + Kernel Production timeline.
 * Timeline entries: Sample, Receiving checklist, then Production Day 1, 2, … (each with date and stage summaries).
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

/** Latest (most recent) date in stages. Used to group a record so packing on 21st appears under Day 3 (21/02), not under an earlier date. */
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

/** Snippets only for sections whose date matches forDate (so each day card shows only activities logged for that date). */
function getStageSummarySnippetsForDate(cracking_data, washing_data, sorting_data, packing_data, forDate) {
    if (!forDate || forDate === '') return getStageSummarySnippets(cracking_data, washing_data, sorting_data, packing_data);
    var c = cracking_data || {};
    var w = washing_data || {};
    var s = sorting_data || {};
    var p = packing_data || {};
    var n = function (v) { var x = parseFloat(v); return isNaN(x) ? null : x; };
    var parts = [];
    if (c.date === forDate) {
        var crackTime = (c.timespent1 || c.totaltime || '').toString().trim();
        var crackQty = n(c.totalqty);
        if (crackTime || crackQty != null) parts.push('Cracking: ' + (crackTime ? crackTime + (crackQty != null ? ', ' : '') : '') + (crackQty != null ? crackQty + ' kg' : ''));
    }
    if (w.date === forDate) {
        var washIn = n(w.qty_in);
        var washOut = n(w.total_qty);
        if (washIn != null || washOut != null) parts.push('Washing: ' + (washIn != null ? washIn + ' kg in' : '') + (washIn != null && washOut != null ? ' → ' : '') + (washOut != null ? washOut + ' kg out' : ''));
    }
    if (s.date === forDate) {
        var sortSound = n(s.sound_qty);
        var sortButter = n(s.butterhigh_qty);
        if (sortSound != null || sortButter != null) {
            var sp = [];
            if (sortSound != null) sp.push('Sound ' + sortSound + ' kg');
            if (sortButter != null) sp.push('Butter ' + sortButter + ' kg');
            parts.push('Sorting: ' + sp.join(', '));
        }
    }
    if (p.date === forDate) {
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
    }
    return parts;
}

/** Unwrap API response to stages object (cracking_data, washing_data, ...). */
function unwrapStages(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.cracking_data !== undefined || raw.washing_data !== undefined) return raw;
    if (raw.get_kernel_production_stages_by_day != null) return raw.get_kernel_production_stages_by_day;
    if (raw.get_kernel_production_stages != null) return raw.get_kernel_production_stages;
    if (Array.isArray(raw) && raw[0]) return unwrapStages(raw[0]);
    return raw;
}


var _modal_batch_history = function () {
    'use strict';
    return {
        show: (batchId) => {
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            var checklistId = batch.receiving_checklist_id || batch.receivingChecklistId;
            var sampleId = batch.sample_submission_id || batch.sampleSubmissionId;
            var batchInfo = (batch.batch_number || 'Batch') + (batch.grower_name ? ' — ' + batch.grower_name : '');
            $('#batchHistoryModalLabel').text('Batch history');
            $('#batchHistoryBatchInfo').text('Batch: ' + batchInfo);
            var $container = $('#batchHistoryTimelineEntries');
            $container.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('batchHistoryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#batchHistoryModal').modal('show');

            var entries = [];

            var samplePromise = Promise.resolve(null);
            if (sampleId && dataFunctions.getSampleSubmissions) {
                samplePromise = dataFunctions.getSampleSubmissions(null, true).then(function (samples) {
                    var sample = (samples || []).filter(function (s) { return s.id === sampleId; })[0];
                    if (sample) {
                        var html = '<div class="small"><p class="mb-1"><strong>Submission:</strong> ' + (sample.submission_number || '—') + '</p><p class="mb-1"><strong>Grower:</strong> ' + (sample.grower_name || '—') + '</p><p class="mb-1"><strong>Delivery date:</strong> ' + (sample.delivery_date || '—') + '</p><p class="mb-1"><strong>Wet NIS (kg):</strong> ' + (sample.wet_nut_in_shell_kg != null ? sample.wet_nut_in_shell_kg : '—') + '</p><p class="mb-1"><strong>Moisture %:</strong> ' + (sample.moisture_content_percentage != null ? sample.moisture_content_percentage : '—') + '</p><p class="mb-0"><strong>Status:</strong> ' + (sample.status || '—') + '</p></div>';
                        return { type: 'sample', title: 'Batch test / sample', bodyHtml: html, date: sample.delivery_date || null };
                    }
                    return { type: 'sample', title: 'Batch test / sample', bodyHtml: '<p class="text-muted mb-0">Sample not found.</p>', date: null };
                }).catch(function () {
                    return { type: 'sample', title: 'Batch test / sample', bodyHtml: '<p class="text-danger mb-0">Could not load sample.</p>', date: null };
                });
            } else {
                samplePromise = Promise.resolve({ type: 'sample', title: 'Batch test / sample', bodyHtml: '<p class="text-muted mb-0">No sample linked to this batch.</p>', date: null });
            }

            var checklistPromise = Promise.resolve(null);
            if (checklistId && dataFunctions.getReceivingChecklist) {
                checklistPromise = dataFunctions.getReceivingChecklist(checklistId).then(function (raw) {
                    var payload = (raw && (raw.checklist || raw.received_items !== undefined)) ? raw : (raw && raw.data) ? raw.data : raw;
                    if (payload && payload.checklist) {
                        var c = payload.checklist;
                        var items = payload.received_items || [];
                        var html = '<div class="small"><p class="mb-1"><strong>Date received:</strong> ' + (c.date_received || '—') + '</p><p class="mb-1"><strong>Delivery note ref:</strong> ' + (c.delivery_note_ref || '—') + '</p><p class="mb-1"><strong>Vehicle clean:</strong> ' + (c.vehicle_clean || '—') + ' &nbsp; <strong>Enclosed:</strong> ' + (c.vehicle_enclosed || '—') + '</p><p class="mb-1"><strong>Pallets condition:</strong> ' + (c.pallets_condition || '—') + '</p>';
                        if (c.comments) html += '<p class="mb-2"><strong>Comments:</strong> ' + (c.comments || '—') + '</p>';
                        if (items.length > 0) {
                            html += '<table class="table table-sm table-bordered mt-2"><thead><tr><th>Reference</th><th>Description</th><th>Batch</th><th>Qty (kg)</th><th>Best before</th></tr></thead><tbody>';
                            items.forEach(function (it) {
                                html += '<tr><td>' + (it.reference || '—') + '</td><td>' + (it.description || '—') + '</td><td>' + (it.batch || '—') + '</td><td>' + (it.quantity_kg != null ? it.quantity_kg : '—') + '</td><td>' + (it.best_before_date || '—') + '</td></tr>';
                            });
                            html += '</tbody></table>';
                        }
                        html += '</div>';
                        return { type: 'checklist', title: 'Receiving checklist', bodyHtml: html, date: c.date_received || null };
                    }
                    return { type: 'checklist', title: 'Receiving checklist', bodyHtml: '<p class="text-muted mb-0">No checklist data available.</p>', date: null };
                }).catch(function () {
                    return { type: 'checklist', title: 'Receiving checklist', bodyHtml: '<p class="text-danger mb-0">Could not load checklist.</p>', date: null };
                });
            } else {
                checklistPromise = Promise.resolve({ type: 'checklist', title: 'Receiving checklist', bodyHtml: '<p class="text-muted mb-0">No receiving checklist linked to this batch.</p>', date: null });
            }

            var productionPromise = Promise.resolve([]);
            if (dataFunctions.getKernelProductionDays) {
                productionPromise = dataFunctions.getKernelProductionDays(batchId).then(function (raw) {
                    var days = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
                    if (!days.length) return [];
                    var stagePromises = days.map(function (d) {
                        var dayId = d.id || d.kernel_production_day_id;
                        var stagesId = d.kernel_production_stages_id;
                        var p = stagesId && dataFunctions.getKernelProductionStages
                            ? dataFunctions.getKernelProductionStages(stagesId)
                            : (dayId && dataFunctions.getKernelProductionStagesByDay ? dataFunctions.getKernelProductionStagesByDay(dayId) : Promise.resolve(null));
                        return p.then(function (rawStages) {
                            var stages = unwrapStages(rawStages);
                            var dateStr = getProductionDayDateLatest(stages) || getProductionDayDate(stages);
                            return { type: 'production', date: dateStr, stages: stages };
                        });
                    });
                    return Promise.all(stagePromises).then(function (entries) {
                        var byDate = {};
                        entries.forEach(function (e) {
                            var d = e.date || '';
                            if (!byDate[d]) byDate[d] = [];
                            byDate[d].push(e);
                        });
                        var sortedDates = Object.keys(byDate).filter(function (d) { return d !== ''; }).sort();
                        var noDate = byDate[''];
                        if (noDate && noDate.length) sortedDates.push('');
                        var result = [];
                        sortedDates.forEach(function (dateStr, idx) {
                            var group = byDate[dateStr] || [];
                            var merged = [];
                            var seen = {};
                            group.forEach(function (e) {
                                var snippets = e.stages
                                    ? getStageSummarySnippetsForDate(e.stages.cracking_data, e.stages.washing_data, e.stages.sorting_data, e.stages.packing_data, dateStr)
                                    : [];
                                snippets.forEach(function (line) {
                                    if (line && !seen[line]) {
                                        seen[line] = true;
                                        merged.push(line);
                                    }
                                });
                            });
                            var dayNum = idx + 1;
                            var dateDisplay = dateStr ? ('Day ' + dayNum + ' (' + formatStageDate(dateStr) + ')') : ('Day ' + dayNum);
                            var bodyHtml = '<div class="small">';
                            bodyHtml += '<p class="mb-1"><strong>Date:</strong> ' + dateDisplay + '</p>';
                            if (merged.length > 0) {
                                bodyHtml += '<ul class="mb-0 ps-3">';
                                merged.forEach(function (line) {
                                    bodyHtml += '<li>' + line + '</li>';
                                });
                                bodyHtml += '</ul>';
                            } else {
                                bodyHtml += '<p class="text-muted mb-0">No stage data recorded for this day.</p>';
                            }
                            bodyHtml += '</div>';
                            result.push({ type: 'production', title: 'Production — Day ' + dayNum, bodyHtml: bodyHtml, date: dateStr || null, dayNumber: dayNum });
                        });
                        return result;
                    });
                }).catch(function () {
                    return [];
                });
            }

            var jobCardPromise = Promise.resolve(null);
            if (batch && batch.batch_number && dataFunctions.getKernelJobCards) {
                jobCardPromise = (dataFunctions.getKernelJobCard && batch.jobCardId ? dataFunctions.getKernelJobCard(batch.jobCardId) : dataFunctions.getKernelJobCards(null, true)).then(function (jcOrList) {
                    var jc = jcOrList && jcOrList.batch_number ? jcOrList : (Array.isArray(jcOrList) ? (jcOrList.filter(function (c) { return c.batch_number === batch.batch_number; })[0]) : null);
                    if (!jc) return null;
                    var fmt = function (v) { return v != null && v !== '' ? (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v)) : '—'; };
                    var fmtDate = function (d) {
                        if (!d) return '—';
                        var s = typeof d === 'string' ? d : (d.toString && d.toString());
                        return s.indexOf('T') >= 0 ? s.split('T')[0] : s;
                    };
                    var html = '<div class="small">';
                    html += '<p class="mb-1"><strong>Batch:</strong> ' + fmt(jc.batch_number) + ' &nbsp; <strong>Received:</strong> ' + fmtDate(jc.received_date) + '</p>';
                    html += '<p class="mb-1"><strong>Total weight (kg):</strong> ' + fmt(jc.total_weight_kg) + ' &nbsp; <strong>Supplier:</strong> ' + fmt(jc.supplier_name) + '</p>';
                    html += '<p class="mb-1"><strong>Packing:</strong> ' + fmtDate(jc.packing_start_date) + ' – ' + fmtDate(jc.packing_completion_date) + '</p>';
                    html += '<p class="mb-1"><strong>Sound kernel:</strong> ' + fmt(jc.sound_kernel_total_cartons) + ' cartons, ' + fmt(jc.sound_kernel_total_kg) + ' kg &nbsp; <strong>Butter grade:</strong> ' + fmt(jc.butter_grade_total_cartons) + ' cartons, ' + fmt(jc.butter_grade_total_kg) + ' kg</p>';
                    html += '<p class="mb-0"><strong>Status:</strong> ' + fmt(jc.status) + '</p></div>';
                    return { type: 'job_card', title: 'Job Card', bodyHtml: html, date: jc.packing_completion_date || jc.received_date || null };
                }).catch(function () { return null; });
            }

            Promise.all([samplePromise, checklistPromise, productionPromise, jobCardPromise]).then(function (results) {
                var sampleEntry = results[0];
                var checklistEntry = results[1];
                var productionEntries = results[2] || [];
                var jobCardEntry = results[3];
                entries = [];
                if (sampleEntry) entries.push(sampleEntry);
                if (checklistEntry) entries.push(checklistEntry);
                productionEntries.forEach(function (e) { entries.push(e); });
                if (jobCardEntry) entries.push(jobCardEntry);
                entries.reverse();

                var statusLabel = '';
                if (batch && typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatchDisplayStatus) {
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
}();
