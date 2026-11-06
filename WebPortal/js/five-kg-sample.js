/**
 * 5 kg sample: final Sound / Unsound Kernel after the float test.
 *
 * The crack-out's Sound Kernel is weighed BEFORE the float test, so it still holds the sinkers
 * (butter grade). Those belong in Unsound Kernel. QA's worked example (Nov 2026 workbook, "Correct"
 * table) is the spec:
 *   floating dry = floating wet / total wet x pre-float sound kernel     -> final Sound Kernel
 *   sinking dry  = sinking wet  / total wet x pre-float sound kernel     -> "Sinkers" row
 *   unsound (crack-out) = sum of the 9 breakdown weights
 *   final Unsound Kernel = unsound (crack-out) + sinking dry
 *   water weight = total wet - pre-float sound kernel (% of pre-float)
 * Shell and the grand total do not change.
 *
 * Before this the portal reported the pre-float figures as final (20.86% SK / 5.52% USK on the
 * workbook's numbers instead of 18.25% / 8.13%).
 *
 * Pure values only: no DOM, so scripts/verify-five-kg-sample.mjs can load it with vm.Script.
 */
(function (w) {
    'use strict';

    var UNSOUND_KEYS = ['germination_g', 'late_stinkbug_g', 'early_stinkbug_g', 'dark_centre_g', 'mould_g',
        'rotten_g', 'immature_split_g', 'shrivelled_g', 'nut_borer_g'];

    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        var n = typeof v === 'number' ? v : parseFloat(v);
        return isFinite(n) ? n : null;
    }

    /**
     * @param {object} s  { sound_kernel_g, shell_g, floating_g, sinking_g, unsound: { germination_g, ... },
     *                      unsound_kernel_g }  unsound_kernel_g is only used when no breakdown weight is
     *                      entered (samples saved before the breakdown drove the crack-out figure).
     * @returns {object} every figure in grams; a figure that cannot be worked out yet is null.
     */
    function calc(s) {
        s = s || {};
        var un = s.unsound || {};
        var anyBreakdown = false;
        var unsoundSum = 0;
        UNSOUND_KEYS.forEach(function (k) {
            var v = num(un[k]);
            if (v != null) { anyBreakdown = true; unsoundSum += v; }
        });
        var unsound = anyBreakdown ? unsoundSum : num(s.unsound_kernel_g);

        var sound = num(s.sound_kernel_g);
        var shell = num(s.shell_g);
        var floating = num(s.floating_g);
        var sinking = num(s.sinking_g);
        var wetTotal = (floating || 0) + (sinking || 0);
        // Both float weights are needed (0 is fine): with one blank the split would put everything on one side.
        var haveFloat = floating != null && sinking != null && wetTotal > 0 && sound != null;

        var floatingDry = haveFloat ? (floating || 0) / wetTotal * sound : null;
        var sinkingDry = haveFloat ? (sinking || 0) / wetTotal * sound : null;
        var crackOutTotal = (sound || 0) + (unsound || 0) + (shell || 0);

        var finalSound = haveFloat ? floatingDry : null;
        var finalUnsound = haveFloat ? (unsound || 0) + sinkingDry : null;

        return {
            unsound_kernel_g: unsound,           // crack-out row (breakdown total, sinkers excluded)
            crack_out_total_g: crackOutTotal,
            wet_total_g: wetTotal > 0 ? wetTotal : null,
            water_g: haveFloat ? wetTotal - sound : null,
            water_pct: haveFloat && sound > 0 ? (wetTotal - sound) / sound * 100 : null,
            // All the pre-float sound kernel goes in the bath (QA, 6 Nov 2026), so wet below it is a typing slip.
            wet_below_prefloat: haveFloat && wetTotal < sound,
            floating_dry_g: floatingDry,
            sinking_dry_g: sinkingDry,
            final_sound_kernel_g: finalSound,
            final_unsound_kernel_g: finalUnsound,
            final_shell_g: shell,
            final_total_g: crackOutTotal,
            final_sound_kernel_pct: finalSound != null && crackOutTotal > 0 ? finalSound / crackOutTotal * 100 : null,
            final_unsound_kernel_pct: finalUnsound != null && crackOutTotal > 0 ? finalUnsound / crackOutTotal * 100 : null,
            final_shell_pct: shell != null && crackOutTotal > 0 ? shell / crackOutTotal * 100 : null
        };
    }

    /** Same as calc(), from a saved intake_data.five_kg_sample object. */
    function fromSaved(fk) {
        fk = fk || {};
        var co = fk.crack_out || {};
        var ft = fk.float_test || {};
        return calc({
            sound_kernel_g: co.sound_kernel_g,
            unsound_kernel_g: co.unsound_kernel_g,
            shell_g: co.shell_g,
            floating_g: ft.floating_g,
            sinking_g: ft.sinking_g,
            unsound: fk.unsound || {}
        });
    }

    w.FiveKgSample = { UNSOUND_KEYS: UNSOUND_KEYS, calc: calc, fromSaved: fromSaved };
})(typeof window !== 'undefined' ? window : this);
