/*
 * MacStatus — the single status→color language for the whole portal.
 *
 * Every status pill in every grid renders through this map so the same state
 * always looks the same. Semantic tones only (see docs/design/DESIGN_SYSTEM.md):
 *   success = done/healthy · info = in motion · warning = waiting on someone ·
 *   danger = blocked/failed/destructive · neutral = off/none.
 *
 * Usage:
 *   MacStatus.pill(row.status)                       → tinted pill HTML
 *   MacStatus.pill('active', 'Currently active')     → custom label
 *   MacStatus.pill(user.is_active ? 'active' : 'inactive')
 *   MacStatus.tone('qa')                             → 'info' (for custom UIs)
 */
(function (w) {
    'use strict';

    var TONES = ['success', 'info', 'warning', 'danger', 'neutral'];

    var TONE_MAP = {
        // done / healthy
        active: 'success', complete: 'success', completed: 'success', done: 'success',
        released: 'success', approved: 'success', resolved: 'success', dispatched: 'success',
        live: 'success', on_hand: 'success', in_stock: 'success', passed: 'success', ok: 'success',
        // in motion
        production: 'info', in_progress: 'info', processing: 'info', qa: 'info',
        dispatch: 'info', testing: 'info', open: 'info', sent: 'info', running: 'info',
        // waiting on someone/something
        intake: 'warning', receiving: 'warning', pending: 'warning', waiting: 'warning',
        awaiting_test: 'warning', hold: 'warning', on_hold: 'warning', draft: 'warning',
        due: 'warning', low: 'warning',
        // blocked / failed
        blocked: 'danger', failed: 'danger', error: 'danger', rejected: 'danger',
        overdue: 'danger', critical: 'danger', expired: 'danger',
        // off / none
        inactive: 'neutral', disabled: 'neutral', archived: 'neutral', cancelled: 'neutral',
        canceled: 'neutral', none: 'neutral', closed: 'neutral'
    };

    function normalize(status) {
        return String(status == null ? '' : status).trim().toLowerCase().replace(/[\s-]+/g, '_');
    }

    function tone(status) {
        var key = normalize(status);
        if (TONES.indexOf(key) > -1) { return key; } // already a tone name
        return TONE_MAP[key] || 'neutral';
    }

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function label(status) {
        var s = String(status == null ? '' : status).trim().replace(/[_-]+/g, ' ');
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function pill(status, labelOverride) {
        return '<span class="mac-pill mac-pill-' + tone(status) + '">'
            + esc(labelOverride != null ? labelOverride : label(status)) + '</span>';
    }

    w.MacStatus = { pill: pill, tone: tone, normalize: normalize };
})(typeof window !== 'undefined' ? window : this);
