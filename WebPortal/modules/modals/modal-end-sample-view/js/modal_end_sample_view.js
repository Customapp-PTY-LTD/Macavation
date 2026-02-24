/**
 * Modal: End Sample View – read-only. Logic from modules/kernel-production/js/kernel_production_end_sample.js
 */
var _modal_end_sample_view = (function () {
    'use strict';
    return {
        init: () => {},

        show: (packingSampleId) => {
            var $body = $('#endSampleViewBody');
            if (!$body.length) return;
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('endSampleViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#endSampleViewModal').modal('show');
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getKernelPackingSample) {
                $body.html('<p class="text-danger mb-0">Cannot load end sample.</p>');
                return;
            }
            dataFunctions.getKernelPackingSample(packingSampleId).then((ps) => {
                if (!ps || !ps.id) {
                    $body.html('<p class="text-muted mb-0">End sample not found.</p>');
                    return;
                }
                var fmt = (v) => v != null && v !== '' ? v : '—';
                var tick = (b) => b ? '&#10003;' : '—';
                var html = '<p class="text-muted small mb-3">1 x kernel sample – ziplock bag, 1 x sterile bag, 1 x 1kg vacuum bag</p>';
                html += '<table class="table table-bordered table-sm"><thead><tr><th>Description</th><th>Required (tick)</th><th>Result</th><th>UOM</th></tr></thead><tbody>';
                html += '<tr><td>Moisture</td><td>' + tick(ps.moisture_required) + '</td><td>' + fmt(ps.moisture_result) + '</td><td>%</td></tr>';
                html += '<tr><td>Peroxide Value</td><td>' + tick(ps.peroxide_required) + '</td><td>' + fmt(ps.peroxide_result) + '</td><td>meqO2/kg</td></tr>';
                html += '<tr><td>Free Fatty Acids</td><td>' + tick(ps.ffa_required) + '</td><td>' + fmt(ps.ffa_result) + '</td><td>%</td></tr>';
                html += '<tr><td>Internal Micro</td><td>' + tick(ps.internal_micro_required) + '</td><td>' + fmt(ps.internal_micro_result) + '</td><td></td></tr>';
                html += '<tr><td>External lab testing</td><td>' + tick(ps.external_lab_required) + '</td><td>' + fmt(ps.external_lab_result) + '</td><td></td></tr>';
                html += '</tbody></table>';
                html += '<div class="row mt-3"><div class="col-md-6"><p class="mb-0"><strong>Signed (Supervisor):</strong> ' + fmt(ps.supervisor_signed_by) + '</p></div>';
                html += '<div class="col-md-6"><p class="mb-0"><strong>Signed (Nut Plant Manager):</strong> ' + fmt(ps.nut_plant_manager_signed_by) + '</p></div></div>';
                $body.html(html);
            }).catch(() => {
                $body.html('<p class="text-danger mb-0">Could not load end sample.</p>');
            });
        }
    };
}());
_modal_end_sample_view.init();
