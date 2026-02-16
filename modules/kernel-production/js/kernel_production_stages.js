/**
 * Kernel Production Stages Module
 * Production modal: days, action dropdown (Cracking/Washing/Sorting/Packing/Summary), save, finish, view.
 * Pattern: same as hatchability.js (return object, arrow functions, const scope = _module).
 */
var _kernelProductionStages = function () {
    'use strict';
    return {
        modalProductionDays: null,
        modalProductionDayStages: null,
        currentProductionAction: null,
        productionActionMap: {
            crack: { section: 'crack', paneId: 'pane-cracking', dataKey: 'cracking_data' },
            wash: { section: 'wash', paneId: 'pane-washing', dataKey: 'washing_data' },
            sort: { section: 'sort', paneId: 'pane-sorting', dataKey: 'sorting_data' },
            pack: { section: 'pack', paneId: 'pane-packing', dataKey: 'packing_data' },
            sum: { section: 'sum', paneId: 'pane-summary', dataKey: 'summary_data' }
        },

        init: () => {
            const scope = _kernelProductionStages;
        $('#productionStagesDayList').off('click').on('click', '[data-day-id]', function (e) {
            e.preventDefault();
            var dayId = $(this).attr('data-day-id');
            if (dayId) scope.selectProductionDay(dayId);
        });
        $(document).off('click.kernelStages', '.production-action-item').on('click.kernelStages', '.production-action-item', function (e) {
            e.preventDefault();
            var action = $(this).attr('data-action');
            if (action) scope.chooseProductionAction(action);
        });
        $('#recordAnotherActionBtn').off('click').on('click', function (e) {
            e.preventDefault();
            scope.showProductionActionSelector();
        });
        $('#saveProductionStagesBtnSingle, #saveProductionStagesBtn').off('click').on('click', function (e) {
            e.preventDefault();
            scope.saveProductionStages();
        });
        $('#addProductionDayBtn').off('click').on('click', function (e) {
            e.preventDefault();
            scope.addProductionDay();
        });
        $('#batchSummaryBtn').off('click').on('click', function (e) {
            e.preventDefault();
            scope.showBatchSummary();
        });
        $('#finishBatchProductionBtn').off('click').on('click', function (e) {
            e.preventDefault();
            scope.finishBatchProduction();
        });
        $(document).on('change input', '#ps_crack_start1, #ps_crack_end1, #ps_crack_start2, #ps_crack_end2', function () {
            var id = this.id;
            if (id === 'ps_crack_start1' || id === 'ps_crack_end1') scope.updateCrackTimeSpentRow(1);
            if (id === 'ps_crack_start2' || id === 'ps_crack_end2') scope.updateCrackTimeSpentRow(2);
        });
        $('#productionStagesModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
            var batchId = $('#productionStagesBatchId').val();
            if (batchId) scope.saveProductionStagesDraftToStorage();
        });
        $('#productionStagesTabs').off('shown.bs.tab').on('shown.bs.tab', function (e) {
            var target = e.target;
            var paneId = $(target).attr('data-bs-target');
            if (paneId) {
                var tabName = paneId.replace('#pane-', '');
                var batchId = $('#productionStagesBatchId').val();
                if (batchId && tabName) {
                    try { localStorage.setItem('kernelProduction_lastTab_' + batchId, tabName); } catch (err) {}
                }
            }
        });
        },

        computeTimeSpent: (startTimeVal, endTimeVal) => {
        if (!startTimeVal || !endTimeVal || typeof startTimeVal !== 'string' || typeof endTimeVal !== 'string') return '';
        var s = startTimeVal.trim().split(':');
        var e = endTimeVal.trim().split(':');
        if (s.length < 2 || e.length < 2) return '';
        var startM = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
        var endM = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
        if (isNaN(startM) || isNaN(endM)) return '';
        var diffM = endM - startM;
        if (diffM < 0) diffM += 24 * 60;
        var h = Math.floor(diffM / 60);
        var m = diffM % 60;
        if (h === 0) return m + 'm';
        if (m === 0) return h + 'h';
        return h + 'h ' + m + 'm';
        },

        parseTimeSpentToMinutes: (str) => {
        if (!str || typeof str !== 'string') return 0;
        str = str.trim();
        var total = 0;
        var hMatch = str.match(/(\d+)\s*h/);
        var mMatch = str.match(/(\d+)\s*m/);
        if (hMatch) total += parseInt(hMatch[1], 10) * 60;
        if (mMatch) total += parseInt(mMatch[1], 10);
        return total;
        },

        updateCrackTimeSpentRow: (rowNum) => {
            const scope = _kernelProductionStages;
            var startVal = $('#ps_crack_start' + rowNum).val();
            var endVal = $('#ps_crack_end' + rowNum).val();
            var spent = scope.computeTimeSpent(startVal, endVal);
            $('#ps_crack_timespent' + rowNum).val(spent);
            scope.updateCrackTotalTime();
        },

        updateCrackTotalTime: () => {
            const scope = _kernelProductionStages;
            var m1 = scope.parseTimeSpentToMinutes($('#ps_crack_timespent1').val());
        var m2 = scope.parseTimeSpentToMinutes($('#ps_crack_timespent2').val());
        var totalM = m1 + m2;
        var h = Math.floor(totalM / 60);
        var m = totalM % 60;
        var totalEl = $('#ps_crack_totaltime');
        if (h === 0 && m === 0) totalEl.val('');
        else if (h === 0) totalEl.val(m + 'm');
        else if (m === 0) totalEl.val(h + 'h');
        else totalEl.val(h + 'h ' + m + 'm');
        },

        getProductionStagesSectionData: (prefix) => {
        var out = {};
        $('[id^="ps_' + prefix + '_"]').each(function () {
            var el = this;
            var key = el.id.replace(new RegExp('^ps_' + prefix + '_'), '');
            var val = el.type === 'checkbox' ? el.checked : (el.value || '');
            out[key] = val;
        });
        return out;
        },

        setProductionStagesSectionData: (prefix, data) => {
        if (!data || typeof data !== 'object') return;
        $.each(data, function (key, v) {
            var el = document.getElementById('ps_' + prefix + '_' + key);
            if (el) {
                if (el.type === 'checkbox') {
                    el.checked = v === true || v === 'true' || v === '1' || v === 1;
                } else {
                    if (el.tagName === 'SELECT' && v != null && v !== '') scope.ensureSelectHasOption(el, String(v));
                    el.value = v != null && v !== '' ? String(v) : '';
                }
            }
        });
        },

        ensureSelectHasOption: (selectEl, value) => {
            const scope = _kernelProductionStages;
        if (!selectEl || selectEl.tagName !== 'SELECT' || !value) return;
        if ($(selectEl).find('option[value="' + value.replace(/"/g, '&quot;') + '"]').length) return;
        var opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        selectEl.appendChild(opt);
        },

        clearProductionStagesForm: () => {
        $('[id^="ps_"]').each(function () {
            if (this.type === 'checkbox') this.checked = false;
            else this.value = '';
        });
        },

        populateProductionGrowerSelects: (selectedGrowerName) => {
            const scope = _kernelProductionStages;
        var ids = ['ps_crack_grower', 'ps_wash_grower', 'ps_sort_grower', 'ps_pack_grower'];
        var html = '<option value="">Select grower</option>';
        var p = dataFunctions.getContacts && dataFunctions.getContacts();
        return p ? p.then(function (contacts) {
            if (contacts && Array.isArray(contacts)) {
                contacts.forEach(function (contact) {
                    var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                    if (name) html += '<option value="' + name.replace(/"/g, '&quot;') + '">' + name.replace(/</g, '&lt;') + '</option>';
                });
            }
            ids.forEach(function (id) {
                var $el = $('#' + id);
                if ($el.length && $el[0].tagName === 'SELECT') {
                    $el.html(html);
                    if (selectedGrowerName) {
                        scope.ensureSelectHasOption($el[0], selectedGrowerName);
                        $el.val(selectedGrowerName);
                    }
                }
            });
        }) : Promise.resolve();
        },

        saveProductionStagesDraftToStorage: () => {
        var batchId = $('#productionStagesBatchId').val();
        if (!batchId) return;
        var draft = {
            cracking_data: scope.getProductionStagesSectionData('crack'),
            washing_data: scope.getProductionStagesSectionData('wash'),
            sorting_data: scope.getProductionStagesSectionData('sort'),
            packing_data: scope.getProductionStagesSectionData('pack'),
            summary_data: scope.getProductionStagesSectionData('sum')
        };
        try { localStorage.setItem('kernelProduction_draft_' + batchId, JSON.stringify(draft)); } catch (err) {}
        },

        clearProductionStagesDraft: (batchId) => {
        if (!batchId) return;
        try { localStorage.removeItem('kernelProduction_draft_' + batchId); } catch (err) {}
        },

        restoreProductionStagesDraft: (batchId) => {
        if (!batchId) return;
        var json = null;
        try { json = localStorage.getItem('kernelProduction_draft_' + batchId); } catch (err) { return; }
        if (!json) return;
        var draft;
        try { draft = JSON.parse(json); } catch (e) { return; }
        if (!draft || typeof draft !== 'object') return;
        if (draft.cracking_data) scope.setProductionStagesSectionData('crack', draft.cracking_data);
        if (draft.washing_data) scope.setProductionStagesSectionData('wash', draft.washing_data);
        if (draft.sorting_data) scope.setProductionStagesSectionData('sort', draft.sorting_data);
        if (draft.packing_data) scope.setProductionStagesSectionData('pack', draft.packing_data);
        if (draft.summary_data) scope.setProductionStagesSectionData('sum', draft.summary_data);
        },

        setProductionStagesTabsVisibility: (visible) => {
            const scope = _kernelProductionStages;
        $('#productionStagesTabsContainer').css('display', visible ? '' : 'none');
        if (visible) scope.showProductionActionSelector();
        },

        showProductionActionSelector: () => {
            const scope = _kernelProductionStages;
        if (scope.currentProductionAction) {
            var prev = scope.productionActionMap[scope.currentProductionAction];
            if (prev && scope.modalProductionDayStages) {
                scope.modalProductionDayStages[prev.dataKey] = scope.getProductionStagesSectionData(prev.section);
            }
        }
        scope.currentProductionAction = null;
        $('#productionStagesActionSelector').show();
        $('#productionStagesTabsWrap').hide();
        $('#productionStagesRecordAnotherWrap').hide();
        $('#productionStagesSingleSaveWrap').hide();
        $('#summaryPaneSaveRow').show();
        ['pane-cracking', 'pane-washing', 'pane-sorting', 'pane-packing', 'pane-summary'].forEach(function (id) {
            $('#' + id).hide().removeClass('show active');
        });
        scope.updateProductionActionButtonTicks();
        },

        updateProductionActionButtonTicks: () => {
            const scope = _kernelProductionStages;
            var stages = scope.modalProductionDayStages || {};
        $.each(scope.productionActionMap, function (action, map) {
            var dataKey = map.dataKey;
            var data = stages[dataKey];
            var hasData = data && typeof data === 'object' && Object.keys(data).length > 0;
            var label = action === 'crack' ? 'Cracking' : action === 'wash' ? 'Washing' : action === 'sort' ? 'Sorting' : action === 'pack' ? 'Packing' : 'Summary';
            var $item = $('.production-action-item[data-action="' + action + '"]');
            $item.text(hasData ? label + ' ✓' : label);
        });
        },

        chooseProductionAction: (action) => {
            const scope = _kernelProductionStages;
        var map = scope.productionActionMap[action];
        if (!map) return;
        if (scope.currentProductionAction) {
            var prev = scope.productionActionMap[scope.currentProductionAction];
            if (prev && scope.modalProductionDayStages) {
                scope.modalProductionDayStages[prev.dataKey] = scope.getProductionStagesSectionData(prev.section);
            }
        }
        scope.currentProductionAction = action;
        scope.modalProductionDayStages = scope.modalProductionDayStages || {};
        scope.setProductionStagesSectionData(map.section, scope.modalProductionDayStages[map.dataKey] || {});
        $('#productionStagesActionSelector').hide();
        $('#productionStagesTabsWrap').show();
        $('#productionStagesTabs').hide();
        $('#productionStagesRecordAnotherWrap').show();
        $('#productionStagesSingleSaveWrap').show();
        $('#summaryPaneSaveRow').hide();
        ['pane-cracking', 'pane-washing', 'pane-sorting', 'pane-packing', 'pane-summary'].forEach(function (id) {
            var show = id === map.paneId;
            $('#' + id).css('display', show ? '' : 'none').toggleClass('show active', show);
        });
        },

        renderProductionDaysList: (days) => {
            var $container = $('#productionStagesDayList');
            $container.empty();
            (days || []).forEach(function (d, idx) {
                var dayId = d.id || d.kernel_production_day_id;
                var num = d.day_number != null ? d.day_number : (idx + 1);
                if (!dayId) return;
                var html = d.kernel_production_stages_id
                    ? 'Day ' + num + ' <span class="text-success ms-1">&#10003;</span>'
                    : 'Day ' + num;
                $container.append($('<button type="button" class="btn btn-sm btn-outline-secondary" data-day-id="' + dayId + '" data-day-saved="' + (d.kernel_production_stages_id ? '1' : '0') + '">').html(html));
            });
        },

        setProductionDayActive: (dayId) => {
        $('#productionStagesDayList [data-day-id]').each(function () {
            var $btn = $(this);
            var isActive = $btn.attr('data-day-id') === dayId;
            var isSaved = $btn.attr('data-day-saved') === '1';
            $btn.removeClass('btn-primary btn-outline-secondary btn-outline-success');
            if (isActive) $btn.addClass('btn-primary');
            else if (isSaved) $btn.addClass('btn-outline-success');
            else $btn.addClass('btn-outline-secondary');
        });
        },

        loadProductionStagesForDay: (dayId, stagesId) => {
            const scope = _kernelProductionStages;
        if (!dayId && !stagesId) return Promise.resolve();
        var p = stagesId ? dataFunctions.getKernelProductionStages(stagesId) : (dayId ? dataFunctions.getKernelProductionStagesByDay(dayId) : Promise.resolve(null));
        return p.then(function (s) {
            scope.modalProductionDayStages = {
                cracking_data: (s && s.cracking_data) ? s.cracking_data : {},
                washing_data: (s && s.washing_data) ? s.washing_data : {},
                sorting_data: (s && s.sorting_data) ? s.sorting_data : {},
                packing_data: (s && s.packing_data) ? s.packing_data : {},
                summary_data: (s && s.summary_data) ? s.summary_data : {}
            };
            if (s) {
                scope.setProductionStagesSectionData('crack', s.cracking_data);
                scope.setProductionStagesSectionData('wash', s.washing_data);
                scope.setProductionStagesSectionData('sort', s.sorting_data);
                scope.setProductionStagesSectionData('pack', s.packing_data);
                scope.setProductionStagesSectionData('sum', s.summary_data);
            } else {
                scope.clearProductionStagesForm();
            }
        }).catch(function () {
            scope.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
            scope.clearProductionStagesForm();
        });
        },

        selectProductionDay: (dayId) => {
            const scope = _kernelProductionStages;
        $('#productionStagesDayId').val(dayId || '');
        var days = scope.modalProductionDays || [];
        var day = days.filter(function (d) { return (d.id || d.kernel_production_day_id) === dayId; })[0];
        scope.loadProductionStagesForDay(dayId, day && day.kernel_production_stages_id).then(function () {
            scope.setProductionDayActive(dayId);
            scope.showProductionActionSelector();
        });
        },

        addProductionDay: () => {
            const scope = _kernelProductionStages;
        var batchId = $('#productionStagesBatchId').val();
        if (!batchId) {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
            return;
        }
        dataFunctions.createKernelProductionDay(batchId).then(function (result) {
            var inner = (result && result.create_kernel_production_day) ? result.create_kernel_production_day : result;
            if (!inner || inner.success === false) throw new Error(inner && inner.error ? inner.error : 'Failed to create day');
            var newDayId = inner.id;
            var dayNum = inner.day_number != null ? inner.day_number : ((scope.modalProductionDays || []).length + 1);
            scope.modalProductionDays = scope.modalProductionDays || [];
            scope.modalProductionDays.push({ id: newDayId, day_number: dayNum, kernel_production_stages_id: null });
            scope.renderProductionDaysList(scope.modalProductionDays);
            $('#productionStagesDayId').val(newDayId);
            scope.clearProductionStagesForm();
            scope.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
            scope.setProductionStagesTabsVisibility(true);
            scope.setProductionDayActive(newDayId);
        }).catch(function (e) {
            console.error('[Kernel Production] addProductionDay failed:', e);
            if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to add day', 'error');
        });
        },

        showBatchSummary: () => {
            const scope = _kernelProductionStages;
            var batchId = $('#productionStagesBatchId').val();
            if (!batchId) return;
            var $body = $('#batchSummaryBody');
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('batchSummaryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#batchSummaryModal').modal('show');
            var days = scope.modalProductionDays || [];
        var loadDays = days.length === 0 ? (dataFunctions.getKernelProductionDays && dataFunctions.getKernelProductionDays(batchId)) : Promise.resolve(days);
        loadDays.then(function (raw) {
            var list = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
            if (list.length === 0) {
                $body.html('<p class="text-muted mb-0">No production days to summarize. Add days and save data first.</p>');
                return;
            }
            var promises = list.map(function (d) {
                return d.kernel_production_stages_id
                    ? dataFunctions.getKernelProductionStages(d.kernel_production_stages_id)
                    : dataFunctions.getKernelProductionStagesByDay(d.id || d.kernel_production_day_id);
            });
            return Promise.all(promises).then(function (allStages) {
                var agg = scope.aggregateProductionStages(allStages);
                $body.html(scope.renderBatchSummaryHtml(agg, list.length));
            });
        }).catch(function () {
            $body.html('<p class="text-muted mb-0">No production days to summarize.</p>');
        });
        },

        aggregateProductionStages: (stagesList) => {
        var sections = ['cracking_data', 'washing_data', 'sorting_data', 'packing_data', 'summary_data'];
        var agg = {};
        sections.forEach(function (sec) { agg[sec] = {}; });
        (stagesList || []).forEach(function (s) {
            sections.forEach(function (sec) {
                var data = s[sec];
                if (data && typeof data === 'object') {
                    for (var key in data) {
                        var v = data[key];
                        if (typeof v === 'number' && !isNaN(v)) agg[sec][key] = (agg[sec][key] || 0) + v;
                    }
                }
            });
        });
        return agg;
        },

        renderBatchSummaryHtml: (agg, dayCount) => {
        var fmt = function (v) { return v != null && typeof v === 'number' ? v.toFixed(2) : (v != null ? String(v) : '—'); };
        var rows = ['<p class="text-muted small">Totals across ' + dayCount + ' day(s).</p>', '<table class="table table-sm table-bordered"><thead><tr><th>Field</th><th>Total</th></tr></thead><tbody>'];
        var sections = [['cracking_data', 'Cracking'], ['washing_data', 'Washing'], ['sorting_data', 'Sorting'], ['packing_data', 'Packing'], ['summary_data', 'Summary']];
        sections.forEach(function (pair) {
            var data = agg[pair[0]];
            if (data && typeof data === 'object') {
                rows.push('<tr><td colspan="2" class="fw-bold">' + pair[1] + '</td></tr>');
                for (var k in data) rows.push('<tr><td class="ps-3">' + k + '</td><td>' + fmt(data[k]) + '</td></tr>');
            }
        });
        rows.push('</tbody></table>');
        return rows.join('');
        },

        finishBatchProduction: () => {
            const scope = _kernelProductionStages;
        var batchId = $('#productionStagesBatchId').val();
        if (!batchId) {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
            return;
        }
        if (typeof Swal !== 'undefined') {
            Swal.fire({ title: 'Finish batch production?', text: 'This will mark the batch production as complete.', icon: 'question', showCancelButton: true, confirmButtonText: 'Finish' }).then(function (confirmResult) {
                if (!confirmResult.isConfirmed) return;
                scope.doFinishBatchProduction(batchId);
            });
        } else {
            scope.doFinishBatchProduction(batchId);
        }
        },

        doFinishBatchProduction: (batchId) => {
            const scope = _kernelProductionStages;
        var p = dataFunctions.finishKernelBatchProduction && dataFunctions.finishKernelBatchProduction(batchId);
        if (!p || typeof p.then !== 'function') {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Finish batch function not available', 'error');
            return;
        }
        p.then(function (result) {
            if (result && result.success !== false) {
                if (typeof Swal !== 'undefined') Swal.fire('Saved', 'Batch production marked as finished.', 'success');
                var modalEl = document.getElementById('productionStagesModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else $('#productionStagesModal').modal('hide');
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
            } else {
                throw new Error(result && result.error ? result.error : 'Failed to finish');
            }
        }).catch(function (e) {
            console.error('[Kernel Production] finishBatchProduction failed:', e);
            if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to finish batch production', 'error');
        });
        },

        saveProductionStages: () => {
            const scope = _kernelProductionStages;
        var batchId = $('#productionStagesBatchId').val();
        var dayId = $('#productionStagesDayId').val();
        if (!batchId) {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
            return;
        }
        if (!dayId) {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Select or add a day first, then save.', 'error');
            return;
        }
        var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
        var batchNumber = batch ? (batch.batch_number || '') : '';
        var growerName = batch ? (batch.grower_name || '') : '';
        var cracking_data, washing_data, sorting_data, packing_data, summary_data;
        if (scope.currentProductionAction) {
            var stages = scope.modalProductionDayStages || {};
            var cur = scope.productionActionMap[scope.currentProductionAction];
            cracking_data = (cur && cur.dataKey === 'cracking_data') ? scope.getProductionStagesSectionData('crack') : (stages.cracking_data || {});
            washing_data = (cur && cur.dataKey === 'washing_data') ? scope.getProductionStagesSectionData('wash') : (stages.washing_data || {});
            sorting_data = (cur && cur.dataKey === 'sorting_data') ? scope.getProductionStagesSectionData('sort') : (stages.sorting_data || {});
            packing_data = (cur && cur.dataKey === 'packing_data') ? scope.getProductionStagesSectionData('pack') : (stages.packing_data || {});
            summary_data = (cur && cur.dataKey === 'summary_data') ? scope.getProductionStagesSectionData('sum') : (stages.summary_data || {});
        } else {
            cracking_data = scope.getProductionStagesSectionData('crack');
            washing_data = scope.getProductionStagesSectionData('wash');
            sorting_data = scope.getProductionStagesSectionData('sort');
            packing_data = scope.getProductionStagesSectionData('pack');
            summary_data = scope.getProductionStagesSectionData('sum');
        }
        var payload = {
            kernel_production_day_id: dayId,
            batch_number: batchNumber,
            grower_name: growerName,
            cracking_data: cracking_data,
            washing_data: washing_data,
            sorting_data: sorting_data,
            packing_data: packing_data,
            summary_data: summary_data
        };
        (dataFunctions.saveKernelProductionStages && dataFunctions.saveKernelProductionStages(payload)).then(function () {
            scope.modalProductionDayStages = { cracking_data: cracking_data, washing_data: washing_data, sorting_data: sorting_data, packing_data: packing_data, summary_data: summary_data };
            scope.updateProductionActionButtonTicks();
            scope.clearProductionStagesDraft(batchId);
            if (typeof Swal !== 'undefined') Swal.fire('Saved', 'Production stages saved for this day.', 'success');
            return (dataFunctions.getKernelProductionDays && dataFunctions.getKernelProductionDays(batchId)) || Promise.resolve([]);
        }).then(function (raw) {
            var days = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
            scope.modalProductionDays = days;
            scope.renderProductionDaysList(days);
            scope.setProductionDayActive(dayId);
        }).catch(function (e) {
            console.error('[Kernel Production] saveProductionStages failed:', e);
            if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save production stages', 'error');
        });
        },

        showProductionStagesModalForBatch: (batchId) => {
            const scope = _kernelProductionStages;
        var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
        if (!batch) {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
            return;
        }
        $('#productionStagesBatchId').val(batchId);
        $('#productionStagesDayId').val('');
        scope.clearProductionStagesForm();
        var dateVal = batch.received_date ? (batch.received_date.toString().split('T')[0]) : (new Date().toISOString().split('T')[0]);
        $('#ps_crack_date').val(dateVal);
        $('#ps_crack_batch1').val(batch.batch_number || '');
        var days = batch.productionDays && batch.productionDays.length ? batch.productionDays : [];
        var loadDays = days.length === 0 && dataFunctions.getKernelProductionDays ? dataFunctions.getKernelProductionDays(batchId) : Promise.resolve(days);
        loadDays.then(function (raw) {
            var list = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
            scope.modalProductionDays = list;
            scope.renderProductionDaysList(list);
            scope.setProductionStagesTabsVisibility(list.length > 0);
            if (list.length > 0) {
                var first = list[0];
                var firstDayId = first.id || first.kernel_production_day_id;
                $('#productionStagesDayId').val(firstDayId || '');
                return scope.populateProductionGrowerSelects(batch.grower_name || '').then(function () {
                    return scope.loadProductionStagesForDay(firstDayId, first.kernel_production_stages_id);
                }).then(function () {
                    scope.setProductionDayActive(firstDayId);
                    scope.updateProductionActionButtonTicks();
                });
            }
            return scope.populateProductionGrowerSelects(batch.grower_name || '');
        }).then(function () {
            scope.restoreProductionStagesDraft(batchId);
            var modalEl = document.getElementById('productionStagesModal');
            var doRestoreTab = function () {
                var savedTab = null;
                try { savedTab = localStorage.getItem('kernelProduction_lastTab_' + batchId); } catch (err) {}
                var tabNames = ['cracking', 'washing', 'sorting', 'packing', 'summary'];
                if (savedTab && tabNames.indexOf(savedTab) !== -1) {
                    var tabBtn = document.getElementById('tab-' + savedTab);
                    if (tabBtn && typeof bootstrap !== 'undefined' && bootstrap.Tab) bootstrap.Tab.getOrCreateInstance(tabBtn).show();
                }
            };
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                $(modalEl).one('shown.bs.modal', doRestoreTab);
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else {
                $('#productionStagesModal').one('shown.bs.modal', doRestoreTab).modal('show');
            }
        }).catch(function (e) {
            console.warn('[Kernel Production] showProductionStagesModalForBatch:', e);
        });
        },

        showProductionStagesViewModal: (stagesId) => {
        var $body = $('#productionStagesViewBody');
        if (!$body.length) return;
        $body.html('<p class="text-muted mb-0">Loading…</p>');
        var modalEl = document.getElementById('productionStagesViewModal');
        if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
        else $('#productionStagesViewModal').modal('show');
        (dataFunctions.getKernelProductionStages && dataFunctions.getKernelProductionStages(stagesId)).then(function (s) {
            if (!s) { $body.html('<p class="text-muted mb-0">Production record not found.</p>'); return; }
            var fmt = function (v) { return v != null && v !== '' ? String(v) : '—'; };
            var renderSection = function (data) {
                if (!data || typeof data !== 'object') return '<p class="text-muted mb-0">No data</p>';
                var rows = [];
                for (var k in data) { if (data.hasOwnProperty(k)) rows.push('<tr><td class="text-nowrap">' + k + '</td><td>' + fmt(data[k]) + '</td></tr>'); }
                return rows.length ? '<table class="table table-sm table-bordered mb-2"><tbody>' + rows.join('') + '</tbody></table>' : '<p class="text-muted mb-0">No data</p>';
            };
            var html = '<div class="small"><p class="mb-2"><strong>Batch:</strong> ' + fmt(s.batch_number) + ' &nbsp; <strong>Grower:</strong> ' + fmt(s.grower_name) + '</p>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Cracking</strong></div><div class="card-body py-2">' + renderSection(s.cracking_data) + '</div></div>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Washing</strong></div><div class="card-body py-2">' + renderSection(s.washing_data) + '</div></div>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sorting</strong></div><div class="card-body py-2">' + renderSection(s.sorting_data) + '</div></div>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Packing</strong></div><div class="card-body py-2">' + renderSection(s.packing_data) + '</div></div>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Summary</strong></div><div class="card-body py-2">' + renderSection(s.summary_data) + '</div></div></div>';
            $body.html(html);
        }).catch(function (e) {
            console.error('[Kernel Production] Error loading production stages for view:', e);
            $body.html('<p class="text-danger mb-0">Could not load production record.</p>');
        });
        }
    };
}();
