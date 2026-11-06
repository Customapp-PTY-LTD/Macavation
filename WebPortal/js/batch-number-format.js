/**
 * Kernel batch numbers on screen (Mike, 5 Nov 2026): "BN.01.26.05" instead of "Bn 01 26 05".
 *
 * DISPLAY ONLY. The database keeps "Bn 01 26 05" (get_next_batch_number, imports and the workbook
 * sync all rely on that exact text). So:
 *   - show:   macBatchNo.format(stored)        'Bn 01 26 05' -> 'BN.01.26.05'
 *   - save:   macBatchNo.toStored(typed)       'BN.01.26.05' -> 'Bn 01 26 05'
 *   - search: macBatchNo.searchKey(text)       both forms    -> '012605'
 * Anything that is not a kernel batch number (oil lots, free text) is returned unchanged.
 * Same rule as public._fmt_batch_number in migrations/20261106090000_dispatch_and_sales_five_steps.sql.
 */
(function (window) {
    'use strict';

    var KERNEL_BN = /^\s*(?:bn[\s.]?)?(\d{2})[\s.](\d{2})[\s.](\d+)\s*$/i;

    var macBatchNo = {
        format: function (value) {
            if (value === null || value === undefined) return '';
            var s = String(value);
            var m = KERNEL_BN.exec(s);
            return m ? 'BN.' + m[1] + '.' + m[2] + '.' + m[3] : s;
        },

        toStored: function (value) {
            if (value === null || value === undefined) return value;
            var s = String(value);
            var m = KERNEL_BN.exec(s);
            return m ? 'Bn ' + m[1] + ' ' + m[2] + ' ' + m[3] : s.trim();
        },

        /** Lower case, separators and a leading "bn" removed, so either form matches the other. */
        searchKey: function (value) {
            if (value === null || value === undefined) return '';
            return String(value).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^bn/, '');
        },

        /** True when the text contains the query, ignoring batch-number separators and case. */
        matches: function (text, query) {
            var q = macBatchNo.searchKey(query);
            if (!q) return true;
            return macBatchNo.searchKey(text).indexOf(q) !== -1;
        }
    };

    window.macBatchNo = macBatchNo;
})(window);
