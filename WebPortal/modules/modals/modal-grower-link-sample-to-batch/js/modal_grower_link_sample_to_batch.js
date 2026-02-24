/**
 * Modal: New batch sample (Grower Intake).
 * Two tabs: (1) Ziplock bag sample – original form (Moisture, Peroxide, FFA).
 * (2) 5kg sample – full printed form (Receiving, Batch info, Crack-Out, Float Test, Unsound breakdown).
 * Saves per tab independently; sample step is complete only when both tabs are saved.
 * Autosaves form state every 2 minutes and restores on reopen (device sleep or leaving modal).
 * Uses container id: linkSampleToBatchModal
 */
var _modal_grower_link_sample_to_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'linkSampleToBatchModal';
    var DRAFT_STORAGE_PREFIX = 'grower_intake_sample_draft_';
    var AUTOSAVE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

    var _batchId = null;
    var _autosaveTimerId = null;

    function getActiveSampleTab() {
        var pane5kg = document.getElementById('pane-5kg-sample');
        if (pane5kg && pane5kg.classList.contains('show') && pane5kg.classList.contains('active')) return '5kg';
        return 'ziplock';
    }

    var CRACK_OUT_IDS = ['sampleSoundKernelG', 'sampleUnsoundKernelG', 'sampleShellG'];
    var FLOAT_IDS = ['sampleFloatingKernelG', 'sampleSinkingKernelG'];
    var UNSOUND_IDS = ['sampleGerminationG', 'sampleLateStinkbugG', 'sampleEarlyStinkbugG', 'sampleDarkCentreG', 'sampleMouldG', 'sampleRottenG', 'sampleImmatureSplitG', 'sampleShrivelledG', 'sampleNutBorerG'];

    var ZIPLOCK_FIELD_IDS = ['sampleMoistureRequired', 'samplePeroxideRequired', 'sampleFfaRequired', 'sampleMoistureResult', 'samplePeroxideResult', 'sampleFfaResult'];
    var ALL_NUMBER_IDS = ['sampleMoistureResult', 'samplePeroxideResult', 'sampleFfaResult'].concat(CRACK_OUT_IDS, FLOAT_IDS, UNSOUND_IDS);
    var ALL_CHECKBOX_IDS = ['sampleMoistureRequired', 'samplePeroxideRequired', 'sampleFfaRequired'];

    function getFloat(id) {
        var el = document.getElementById(id);
        if (!el || !el.value || el.value.trim() === '') return null;
        var n = parseFloat(el.value);
        return isNaN(n) ? null : n;
    }

    function sumInputs(ids) {
        var sum = 0;
        ids.forEach(function (id) {
            var v = getFloat(id);
            if (v != null) sum += v;
        });
        return sum;
    }

    function updateTotals() {
        var crackTotal = sumInputs(CRACK_OUT_IDS);
        var floatTotal = sumInputs(FLOAT_IDS);
        var unsoundTotal = sumInputs(UNSOUND_IDS);
        var crackEl = document.getElementById('sampleCrackOutTotalG');
        var floatEl = document.getElementById('sampleFloatTotalG');
        var unsoundEl = document.getElementById('sampleUnsoundTotalG');
        if (crackEl) crackEl.value = crackTotal > 0 ? crackTotal : '';
        if (floatEl) floatEl.value = floatTotal > 0 ? floatTotal : '';
        if (unsoundEl) unsoundEl.value = unsoundTotal > 0 ? unsoundTotal : '';
    }

    function getFormState() {
        var state = {};
        ALL_CHECKBOX_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) state[id] = !!el.checked;
        });
        ALL_NUMBER_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) state[id] = el.value != null ? String(el.value).trim() : '';
        });
        return state;
    }

    function setFormState(state) {
        if (!state || typeof state !== 'object') return;
        ALL_CHECKBOX_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el && state[id] !== undefined) el.checked = !!state[id];
        });
        ALL_NUMBER_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el && state[id] !== undefined) el.value = state[id] != null ? String(state[id]) : '';
        });
        updateTotals();
    }

    function clearDraft(batchId) {
        try {
            if (typeof localStorage !== 'undefined' && batchId) {
                localStorage.removeItem(DRAFT_STORAGE_PREFIX + batchId);
            }
        } catch (e) { /* ignore */ }
    }

    function loadDraft(batchId) {
        try {
            if (typeof localStorage === 'undefined' || !batchId) return;
            var raw = localStorage.getItem(DRAFT_STORAGE_PREFIX + batchId);
            if (raw) {
                var state = JSON.parse(raw);
                setFormState(state);
            }
        } catch (e) { /* ignore */ }
    }

    function saveDraft(batchId) {
        try {
            if (typeof localStorage === 'undefined' || !batchId) return;
            var state = getFormState();
            localStorage.setItem(DRAFT_STORAGE_PREFIX + batchId, JSON.stringify(state));
        } catch (e) { /* ignore */ }
    }

    function clearForm() {
        ['sampleMoistureRequired', 'samplePeroxideRequired', 'sampleFfaRequired'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.checked = false;
        });
        ['sampleMoistureResult', 'samplePeroxideResult', 'sampleFfaResult'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        CRACK_OUT_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('sampleCrackOutTotalG') && (document.getElementById('sampleCrackOutTotalG').value = '');
        FLOAT_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('sampleFloatTotalG') && (document.getElementById('sampleFloatTotalG').value = '');
        UNSOUND_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('sampleUnsoundTotalG') && (document.getElementById('sampleUnsoundTotalG').value = '');
    }

    function startAutosave(batchId) {
        stopAutosave();
        if (!batchId) return;
        _autosaveTimerId = setInterval(function () {
            if (_batchId === batchId) saveDraft(batchId);
        }, AUTOSAVE_INTERVAL_MS);
    }

    function stopAutosave() {
        if (_autosaveTimerId != null) {
            clearInterval(_autosaveTimerId);
            _autosaveTimerId = null;
        }
    }

    var api = {
        init: function () {
            var btn = document.getElementById('linkSampleToBatchBtn');
            if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            $(document).on('shown.bs.modal', '#' + CONTAINER_ID, function () {
                var container = document.getElementById(CONTAINER_ID);
                if (container) {
                    container.querySelectorAll('input[type="number"]:not([readonly])').forEach(function (input) {
                        if (!input._sampleTotalBound) {
                            input._sampleTotalBound = true;
                            input.addEventListener('input', updateTotals);
                            input.addEventListener('change', updateTotals);
                        }
                    });
                }
                if (_batchId) startAutosave(_batchId);
            });
            $(document).on('hidden.bs.modal', '#' + CONTAINER_ID, function () {
                stopAutosave();
            });
        },

        show: function (batchId, batchNumber) {
            _batchId = batchId || null;
            if (!_batchId) return;
            clearForm();
            loadDraft(_batchId);
            var tabZiplock = document.getElementById('tab-ziplock-bag');
            var tab5kg = document.getElementById('tab-5kg-sample');
            if (tabZiplock && tab5kg && typeof bootstrap !== 'undefined') {
                var tabZiplockInstance = bootstrap.Tab.getOrCreateInstance(tabZiplock);
                if (tabZiplockInstance) tabZiplockInstance.show();
            }
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        save: async function () {
            var batchId = _batchId;
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected.', 'error');
                return;
            }

            var activeTab = getActiveSampleTab();
            var payload;

            if (activeTab === 'ziplock') {
                var moistureRequired = !!document.getElementById('sampleMoistureRequired')?.checked;
                var peroxideRequired = !!document.getElementById('samplePeroxideRequired')?.checked;
                var ffaRequired = !!document.getElementById('sampleFfaRequired')?.checked;
                var moistureResult = getFloat('sampleMoistureResult');
                var peroxideResult = getFloat('samplePeroxideResult');
                var ffaResult = getFloat('sampleFfaResult');

                if (moistureRequired && moistureResult == null) {
                    if (typeof Swal !== 'undefined') Swal.fire('Please enter a result for Moisture.', '', 'info');
                    return;
                }
                if (peroxideRequired && peroxideResult == null) {
                    if (typeof Swal !== 'undefined') Swal.fire('Please enter a result for Peroxide Value.', '', 'info');
                    return;
                }
                if (ffaRequired && ffaResult == null) {
                    if (typeof Swal !== 'undefined') Swal.fire('Please enter a result for Free Fatty Acids.', '', 'info');
                    return;
                }

                payload = {
                    p_batch_id: batchId,
                    p_sample_type: 'ziplock',
                    p_moisture_required: moistureRequired,
                    p_moisture_result: moistureResult,
                    p_peroxide_required: peroxideRequired,
                    p_peroxide_result: peroxideResult,
                    p_ffa_required: ffaRequired,
                    p_ffa_result: ffaResult,
                    p_wet_nut_in_shell_kg: 0
                };
            } else {
                payload = {
                    p_batch_id: batchId,
                    p_sample_type: '5kg',
                    p_moisture_required: false,
                    p_moisture_result: null,
                    p_peroxide_required: false,
                    p_peroxide_result: null,
                    p_ffa_required: false,
                    p_ffa_result: null,
                    p_wet_nut_in_shell_kg: 0,
                    p_crack_out_sound_kernel_g: getFloat('sampleSoundKernelG'),
                    p_crack_out_unsound_kernel_g: getFloat('sampleUnsoundKernelG'),
                    p_crack_out_shell_g: getFloat('sampleShellG'),
                    p_float_floating_g: getFloat('sampleFloatingKernelG'),
                    p_float_sinking_g: getFloat('sampleSinkingKernelG'),
                    p_unsound_germination_g: getFloat('sampleGerminationG'),
                    p_unsound_late_stinkbug_g: getFloat('sampleLateStinkbugG'),
                    p_unsound_early_stinkbug_g: getFloat('sampleEarlyStinkbugG'),
                    p_unsound_dark_centre_g: getFloat('sampleDarkCentreG'),
                    p_unsound_mould_g: getFloat('sampleMouldG'),
                    p_unsound_rotten_g: getFloat('sampleRottenG'),
                    p_unsound_immature_split_g: getFloat('sampleImmatureSplitG'),
                    p_unsound_shrivelled_g: getFloat('sampleShrivelledG'),
                    p_unsound_nut_borer_g: getFloat('sampleNutBorerG')
                };
            }

            try {
                var result = await dataFunctions.createSampleSubmissionForBatch(payload);

                var ok = result && (result.success === true || (result.success !== false && result.id));
                if (!ok) {
                    throw new Error(result && result.error ? result.error : 'Failed to save sample');
                }

                clearDraft(batchId);

                var message = activeTab === 'ziplock' ? 'Ziplock sample saved.' : '5kg sample saved.';
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'success',
                        title: 'Saved',
                        text: message,
                        timer: 2000,
                        showConfirmButton: false
                    });
                }

                if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.loadIntakeBatches) {
                    _growerIntakeGrid.loadIntakeBatches(true);
                }

                /* Modal stays open so user can complete the other tab or close manually */
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save sample', 'error');
            }
        }
    };
    return api;
})();
_modal_grower_link_sample_to_batch.init();
