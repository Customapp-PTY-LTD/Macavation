/**
 * Modal: End Sample View – read-only. Uses getKernelBatchDetail → qa_data.
 */
var _modal_end_sample_view = (function () {
    'use strict';
    var _currentKernelId = null;

    return {
        init: () => {
            $(document).off('click', '#endSampleViewEditBtn').on('click', '#endSampleViewEditBtn', function () {
                var modalEl = document.getElementById('endSampleViewModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else $('#endSampleViewModal').modal('hide');
                if (_currentKernelId && typeof _modal_end_sample !== 'undefined' && _modal_end_sample.show) {
                    _modal_end_sample.show(_currentKernelId);
                }
            });
        },

        show: (kernelId) => {
            _currentKernelId = kernelId || null;
            var $body = $('#endSampleViewBody');
            if (!$body.length) return;
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('endSampleViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#endSampleViewModal').modal('show');
            if (!kernelId || typeof dataFunctions === 'undefined' || !dataFunctions.getKernelBatchDetail) {
                $body.html('<p class="text-danger mb-0">Cannot load end sample.</p>');
                return;
            }
            dataFunctions.getKernelBatchDetail(kernelId).then(function (detail) {
                var ps = (detail && detail.qa_data && Object.keys(detail.qa_data).length) ? detail.qa_data : null;
                if (!ps) { $body.html('<p class="text-muted mb-0">End sample not found.</p>'); return; }
                var fmt = function (v) { return v != null && v !== '' ? v : '—'; };
                var tick = function (b) { return b ? '&#10003;' : '—'; };
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
                if (ps.lab_test_pdf_url) {
                    var pdfHref = (typeof _common !== 'undefined' && _common.sanitizeHtml) ? _common.sanitizeHtml(ps.lab_test_pdf_url) : ps.lab_test_pdf_url;
                    html += '<div class="mt-2"><a href="' + pdfHref + '" target="_blank" rel="noopener" class="text-primary"><i class="fas fa-file-pdf me-1"></i>Lab Test PDF</a></div>';
                }
                $body.html(html);
            }).catch(() => {
                $body.html('<p class="text-danger mb-0">Could not load end sample.</p>');
            });
        }
    };
}());
_modal_end_sample_view.init();
