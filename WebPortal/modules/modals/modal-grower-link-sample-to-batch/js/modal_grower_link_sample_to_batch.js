/**
 * Modal: New batch sample (Grower Intake).
 * Two tabs: (1) Ziplock bag sample – Moisture, Peroxide, FFA.
 *           (2) 5kg sample – Crack-Out, Float Test, Unsound breakdown.
 *
 * Each tab saves independently. The batch/kernel record MUST already exist
 * (created via modal_grower_create_kernel_batch) before this modal is opened.
 * show() accepts the kernel UUID directly — no new batch/kernel creation here.
 *
 * Both tabs must be saved to enable "Release to production" in the grid.
 * Uses container id: linkSampleToBatchModal
 */
var _modal_grower_link_sample_to_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'linkSampleToBatchModal';
    var DRAFT_STORAGE_PREFIX = 'grower_intake_sample_draft_';
    var AUTOSAVE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

    var _kernelId     = null;  // UUID from kernel.id — set on show(), never null during save
    var _batchId      = null;  // Human-readable batch number — used as localStorage draft key only
    var _ziplockSaved = false;
    var _fiveKgSaved  = false;
    var _autosaveTimerId = null;

    function getActiveSampleTab() {
        var pane5kg = document.getElementById('pane-5kg-sample');
        if (pane5kg && pane5kg.classList.contains('show') && pane5kg.classList.contains('active')) return '5kg';
        return 'ziplock';
    }

    var CRACK_OUT_IDS = ['sampleSoundKernelG', 'sampleUnsoundKernelG', 'sampleShellG'];
    var FLOAT_IDS = ['sampleFloatingKernelG', 'sampleSinkingKernelG'];
    var UNSOUND_IDS = ['sampleGerminationG', 'sampleLateStinkbugG', 'sampleEarlyStinkbugG', 'sampleDarkCentreG', 'sampleMouldG', 'sampleRottenG', 'sampleImmatureSplitG', 'sampleShrivelledG', 'sampleNutBorerG'];

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

    // Spec thresholds from Kernel Pipeline Settings (display only). Stays empty if the load fails = "No limits set".
    var _specThresholds = [];
    var SPEC_INPUTS = { moisture: 'sampleMoistureResult', pv: 'samplePeroxideResult', ffa: 'sampleFfaResult' };
    var SPEC_HINTS = {
        ok:       ['In spec', 'text-success'],
        warn:     ['Borderline', 'text-warning'],
        bad:      ['Out of spec', 'text-danger'],
        noLimits: ['No limits set', 'text-muted']
    };

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function fmtG(v) {
        return _common.formatKg(v);
    }

    function fmtPct(part, whole) {
        if (!(whole > 0) || part == null) return '';
        return (part / whole * 100).toFixed(1) + '%';
    }

    function showWarning(id, text) {
        var el = document.getElementById(id);
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('d-none', !text);
    }

    function getSpec(testKey) {
        for (var i = 0; i < _specThresholds.length; i++) {
            if (_specThresholds[i] && _specThresholds[i].test_key === testKey) return _specThresholds[i];
        }
        return null;
    }

    // Returns 'ok' | 'warn' | 'bad' | 'noLimits' | '' (no value entered)
    function classifySpec(spec, value) {
        if (value == null) return '';
        if (!spec || spec.green_limit == null || spec.yellow_limit == null) return 'noLimits';
        var g = Number(spec.green_limit), y = Number(spec.yellow_limit);
        if (isNaN(g) || isNaN(y)) return 'noLimits';
        if (spec.direction === 'min') return value >= g ? 'ok' : (value >= y ? 'warn' : 'bad');
        return value <= g ? 'ok' : (value <= y ? 'warn' : 'bad');
    }

    function updateSpecColours() {
        Object.keys(SPEC_INPUTS).forEach(function (key) {
            var input = document.getElementById(SPEC_INPUTS[key]);
            var hint = document.getElementById(SPEC_INPUTS[key] + 'Hint');
            if (!input) return;
            var state = classifySpec(getSpec(key), getFloat(SPEC_INPUTS[key]));
            input.classList.remove('is-valid', 'is-invalid', 'border-warning');
            if (state === 'ok') input.classList.add('is-valid');
            else if (state === 'warn') input.classList.add('border-warning');
            else if (state === 'bad') input.classList.add('is-invalid');
            if (hint) {
                hint.classList.remove('text-success', 'text-warning', 'text-danger', 'text-muted');
                var h = SPEC_HINTS[state];
                hint.textContent = h ? h[0] : '';
                if (h) hint.classList.add(h[1]);
            }
        });
    }

    async function loadSpecThresholds() {
        _specThresholds = [];
        try {
            if (typeof dataFunctions !== 'undefined' && dataFunctions.getKernelPipelineConfig) {
                var cfg = await dataFunctions.getKernelPipelineConfig();
                if (cfg && cfg.success !== false && Array.isArray(cfg.spec_thresholds)) _specThresholds = cfg.spec_thresholds;
            }
        } catch (e) {
            console.warn('Spec thresholds unavailable:', e);
        }
        updateSpecColours();
    }

    function updateTotals() {
        var crackTotal = sumInputs(CRACK_OUT_IDS);
        var floatTotal = sumInputs(FLOAT_IDS);
        var unsoundTotal = sumInputs(UNSOUND_IDS);
        var crackEl = document.getElementById('sampleCrackOutTotalG');
        var floatEl = document.getElementById('sampleFloatTotalG');
        var unsoundEl = document.getElementById('sampleUnsoundTotalG');
        // Totals sit in number inputs, so they hold plain (unformatted) numbers.
        if (crackEl) crackEl.value = crackTotal > 0 ? Math.round(crackTotal * 100) / 100 : '';
        if (floatEl) floatEl.value = floatTotal > 0 ? Math.round(floatTotal * 100) / 100 : '';
        if (unsoundEl) unsoundEl.value = unsoundTotal > 0 ? Math.round(unsoundTotal * 100) / 100 : '';

        // Crack-out % column
        var soundG = getFloat('sampleSoundKernelG');
        CRACK_OUT_IDS.forEach(function (id) {
            setText(id.replace(/G$/, '') + 'Pct', fmtPct(getFloat(id), crackTotal));
        });
        setText('sampleCrackOutTotalPct', crackTotal > 0 ? '100.0%' : '');

        // 5 kg warning (never blocks save)
        showWarning('sampleFiveKgWarning', (soundG != null && soundG < 5000)
            ? 'Pre-Float Test (Sound Kernel) is ' + fmtG(soundG) + ' g, under the 5 kg (5,000 g) sample. You can still save, but check the sample.'
            : '');

        // Float test: % of wet and auto dry weight (dry = wet / total wet x Pre-Float weight)
        var haveDry = floatTotal > 0 && soundG != null;
        [['sampleFloatingKernelG', 'sampleFloatingPct', 'sampleFloatingDry'],
         ['sampleSinkingKernelG', 'sampleSinkingPct', 'sampleSinkingDry']].forEach(function (r) {
            var w = getFloat(r[0]);
            setText(r[1], fmtPct(w, floatTotal));
            setText(r[2], haveDry && w != null ? fmtG(w / floatTotal * soundG) : '');
        });
        setText('sampleFloatTotalPct', floatTotal > 0 ? '100.0%' : '');
        setText('sampleFloatDryTotal', haveDry ? fmtG(soundG) : '');

        // Unsound breakdown: % of whole crack-out
        UNSOUND_IDS.forEach(function (id) {
            setText(id + 'Pct', fmtPct(getFloat(id), crackTotal));
        });
        setText('sampleUnsoundTotalPct', unsoundTotal > 0 ? fmtPct(unsoundTotal, crackTotal) : '');
        var crackUnsound = getFloat('sampleUnsoundKernelG') || 0;
        var mismatch = unsoundTotal > 0 && Math.abs(unsoundTotal - crackUnsound) > 0.005;
        showWarning('sampleBreakdownWarning', mismatch
            ? 'Breakdown total (' + fmtG(unsoundTotal) + " g) doesn't match Unsound Kernel in the crack-out (" + fmtG(crackUnsound) + ' g).'
            : '');

        updateSpecColours();
    }

    function updateTabIndicators() {
        var zBadge = document.getElementById('ziplock-tab-badge');
        var fBadge = document.getElementById('fivekg-tab-badge');
        if (zBadge) zBadge.classList.toggle('d-none', !_ziplockSaved);
        if (fBadge) fBadge.classList.toggle('d-none', !_fiveKgSaved);
    }

    function loadExistingData(kd) {
        if (!kd || !kd.intake_data) return;
        var intakeData = kd.intake_data;
        var el;

        // Ziplock sample
        var zl = intakeData.ziplock_sample;
        if (zl && zl.completed_at) {
            _ziplockSaved = true;
            el = document.getElementById('sampleMoistureRequired');
            if (el) el.checked = !!zl.moisture_required;
            el = document.getElementById('sampleMoistureResult');
            if (el) el.value = zl.moisture_result != null ? zl.moisture_result : '';
            el = document.getElementById('samplePeroxideRequired');
            if (el) el.checked = !!zl.peroxide_required;
            el = document.getElementById('samplePeroxideResult');
            if (el) el.value = zl.peroxide_result != null ? zl.peroxide_result : '';
            el = document.getElementById('sampleFfaRequired');
            if (el) el.checked = !!zl.ffa_required;
            el = document.getElementById('sampleFfaResult');
            if (el) el.value = zl.ffa_result != null ? zl.ffa_result : '';
        }

        // 5kg sample
        var fk = intakeData.five_kg_sample;
        if (fk && fk.completed_at) {
            _fiveKgSaved = true;
            if (fk.crack_out) {
                el = document.getElementById('sampleSoundKernelG');
                if (el) el.value = fk.crack_out.sound_kernel_g != null ? fk.crack_out.sound_kernel_g : '';
                el = document.getElementById('sampleUnsoundKernelG');
                if (el) el.value = fk.crack_out.unsound_kernel_g != null ? fk.crack_out.unsound_kernel_g : '';
                el = document.getElementById('sampleShellG');
                if (el) el.value = fk.crack_out.shell_g != null ? fk.crack_out.shell_g : '';
            }
            if (fk.float_test) {
                el = document.getElementById('sampleFloatingKernelG');
                if (el) el.value = fk.float_test.floating_g != null ? fk.float_test.floating_g : '';
                el = document.getElementById('sampleSinkingKernelG');
                if (el) el.value = fk.float_test.sinking_g != null ? fk.float_test.sinking_g : '';
            }
            if (fk.unsound) {
                el = document.getElementById('sampleGerminationG');
                if (el) el.value = fk.unsound.germination_g != null ? fk.unsound.germination_g : '';
                el = document.getElementById('sampleLateStinkbugG');
                if (el) el.value = fk.unsound.late_stinkbug_g != null ? fk.unsound.late_stinkbug_g : '';
                el = document.getElementById('sampleEarlyStinkbugG');
                if (el) el.value = fk.unsound.early_stinkbug_g != null ? fk.unsound.early_stinkbug_g : '';
                el = document.getElementById('sampleDarkCentreG');
                if (el) el.value = fk.unsound.dark_centre_g != null ? fk.unsound.dark_centre_g : '';
                el = document.getElementById('sampleMouldG');
                if (el) el.value = fk.unsound.mould_g != null ? fk.unsound.mould_g : '';
                el = document.getElementById('sampleRottenG');
                if (el) el.value = fk.unsound.rotten_g != null ? fk.unsound.rotten_g : '';
                el = document.getElementById('sampleImmatureSplitG');
                if (el) el.value = fk.unsound.immature_split_g != null ? fk.unsound.immature_split_g : '';
                el = document.getElementById('sampleShrivelledG');
                if (el) el.value = fk.unsound.shrivelled_g != null ? fk.unsound.shrivelled_g : '';
                el = document.getElementById('sampleNutBorerG');
                if (el) el.value = fk.unsound.nut_borer_g != null ? fk.unsound.nut_borer_g : '';
            }
            updateTotals();
        }
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
        ALL_CHECKBOX_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.checked = false;
        });
        ALL_NUMBER_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        ['sampleCrackOutTotalG', 'sampleFloatTotalG', 'sampleUnsoundTotalG'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
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
            // init() runs more than once per page; bind Save once per button or one click saves twice.
            if (btn && btn.getAttribute('data-kp-bound') !== '1') {
                btn.setAttribute('data-kp-bound', '1');
                btn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            }
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

        /**
         * show — open the sample modal for an EXISTING kernel batch.
         * @param {string} kernelId     kernel.id UUID (b.id from get_kernel_batches)
         * @param {string} batchNumber  human-readable batch number (used as draft key)
         */
        show: async function (kernelId, batchNumber) {
            _kernelId     = kernelId || null;
            _batchId      = batchNumber || kernelId;
            _ziplockSaved = false;
            _fiveKgSaved  = false;

            clearForm();

            // Load existing sample data from the kernel record
            if (_kernelId && typeof dataFunctions !== 'undefined' && dataFunctions.getKernelBatchDetail) {
                try {
                    var kd = await dataFunctions.getKernelBatchDetail(_kernelId, null, true);
                    kd = kd && (kd.data !== undefined ? kd.data : kd);
                    if (kd) loadExistingData(kd);
                } catch (e) {
                    console.error('Error loading existing sample data:', e);
                    loadDraft(_batchId);
                }
            }

            updateTotals();
            updateTabIndicators();
            loadSpecThresholds(); // not awaited: a config failure must never block the modal

            // Always open on ziplock tab
            var tabZiplock = document.getElementById('tab-ziplock-bag');
            if (tabZiplock && typeof bootstrap !== 'undefined') {
                bootstrap.Tab.getOrCreateInstance(tabZiplock).show();
            }

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        save: async function () {
            if (!_kernelId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'No batch selected — open this from a batch row.', 'error');
                return;
            }

            var activeTab = getActiveSampleTab();
            var sampleData = { kernel_id: _kernelId };

            if (activeTab === 'ziplock') {
                var moistureRequired = !!document.getElementById('sampleMoistureRequired')?.checked;
                var peroxideRequired = !!document.getElementById('samplePeroxideRequired')?.checked;
                var ffaRequired      = !!document.getElementById('sampleFfaRequired')?.checked;
                var moistureResult   = getFloat('sampleMoistureResult');
                var peroxideResult   = getFloat('samplePeroxideResult');
                var ffaResult        = getFloat('sampleFfaResult');

                if (!moistureRequired && !peroxideRequired && !ffaRequired) {
                    if (typeof Swal !== 'undefined') Swal.fire('Incomplete', 'Please tick at least one test (Moisture, Peroxide, or FFA) to record.', 'info');
                    return;
                }
                if (moistureRequired && moistureResult == null) {
                    if (typeof Swal !== 'undefined') Swal.fire('Incomplete', 'Please enter a result for Moisture.', 'info');
                    return;
                }
                if (peroxideRequired && peroxideResult == null) {
                    if (typeof Swal !== 'undefined') Swal.fire('Incomplete', 'Please enter a result for Peroxide Value.', 'info');
                    return;
                }
                if (ffaRequired && ffaResult == null) {
                    if (typeof Swal !== 'undefined') Swal.fire('Incomplete', 'Please enter a result for Free Fatty Acids.', 'info');
                    return;
                }

                sampleData.sample_type         = 'ziplock';
                sampleData.moisture_required   = moistureRequired;
                sampleData.moisture_result     = moistureResult;
                sampleData.peroxide_required   = peroxideRequired;
                sampleData.peroxide_result     = peroxideResult;
                sampleData.ffa_required        = ffaRequired;
                sampleData.ffa_result          = ffaResult;
                sampleData.wet_nut_in_shell_kg = 0;

            } else {
                // 5kg: crack-out is the core measurement
                var crackTotal = (getFloat('sampleSoundKernelG') || 0) +
                                 (getFloat('sampleUnsoundKernelG') || 0) +
                                 (getFloat('sampleShellG') || 0);
                if (crackTotal <= 0) {
                    if (typeof Swal !== 'undefined') Swal.fire('Incomplete', 'Please enter at least one crack-out weight (Sound Kernel, Unsound Kernel, or Shell).', 'info');
                    return;
                }

                sampleData.sample_type                = '5kg';
                sampleData.crack_out_sound_kernel_g   = getFloat('sampleSoundKernelG');
                sampleData.crack_out_unsound_kernel_g = getFloat('sampleUnsoundKernelG');
                sampleData.crack_out_shell_g          = getFloat('sampleShellG');
                sampleData.float_floating_g           = getFloat('sampleFloatingKernelG');
                sampleData.float_sinking_g            = getFloat('sampleSinkingKernelG');
                sampleData.unsound_germination_g      = getFloat('sampleGerminationG');
                sampleData.unsound_late_stinkbug_g    = getFloat('sampleLateStinkbugG');
                sampleData.unsound_early_stinkbug_g   = getFloat('sampleEarlyStinkbugG');
                sampleData.unsound_dark_centre_g      = getFloat('sampleDarkCentreG');
                sampleData.unsound_mould_g            = getFloat('sampleMouldG');
                sampleData.unsound_rotten_g           = getFloat('sampleRottenG');
                sampleData.unsound_immature_split_g   = getFloat('sampleImmatureSplitG');
                sampleData.unsound_shrivelled_g       = getFloat('sampleShrivelledG');
                sampleData.unsound_nut_borer_g        = getFloat('sampleNutBorerG');
            }

            try {
                var result = await dataFunctions.saveKernelIntakeSample(sampleData);
                var ok = result && (result.success === true || (result.success !== false && result.kernel_id));
                if (!ok) {
                    throw new Error(result && result.error ? result.error : 'Failed to save sample data');
                }

                if (activeTab === 'ziplock') _ziplockSaved = true;
                else _fiveKgSaved = true;
                updateTabIndicators();
                clearDraft(_batchId);

                if (_ziplockSaved && _fiveKgSaved) {
                    if (typeof Swal !== 'undefined') Swal.fire({
                        icon: 'success',
                        title: 'Both samples complete',
                        text: 'Ziplock and 5kg samples are saved. Use "Release to production" in the batch actions to move this batch forward.',
                        timer: 3500,
                        showConfirmButton: false
                    });
                } else {
                    var remaining = activeTab === 'ziplock' ? '5kg sample still needed.' : 'Ziplock sample still needed.';
                    if (typeof Swal !== 'undefined') Swal.fire({
                        icon: 'success',
                        title: 'Saved',
                        text: (activeTab === 'ziplock' ? 'Ziplock sample saved. ' : '5kg sample saved. ') + remaining,
                        timer: 2500,
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
