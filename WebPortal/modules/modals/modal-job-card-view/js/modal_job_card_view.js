/**
 * Modal: Job Card View – read-only display. Logic from modules/kernel-production/js/kernel_production_job_card.js
 */
var _modal_job_card_view = (function () {
    'use strict';
    return {
        init: () => {},

        show: (jobCardId) => {
            var $body = $('#jobCardViewBody');
            if (!$body.length) return;
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('jobCardViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#jobCardViewModal').modal('show');
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getKernelJobCard) {
                $body.html('<p class="text-danger mb-0">Cannot load job card.</p>');
                return;
            }
            dataFunctions.getKernelJobCard(jobCardId).then(function (jc) {
                if (!jc) { $body.html('<p class="text-muted mb-0">Job card not found.</p>'); return; }
                var fmt = function (v) { return v != null && v !== '' ? v : '—'; };
                var html = '<div class="small">';
                html += '<div class="card mb-2"><div class="card-body py-2"><strong>Batch:</strong> ' + fmt(jc.batch_number) + ' &nbsp; <strong>Received:</strong> ' + fmt(jc.received_date) + ' &nbsp; <strong>Supplier:</strong> ' + fmt(jc.supplier_name) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Receiving</strong></div><div class="card-body py-2">Total weight: ' + fmt(jc.total_weight_kg) + ' kg &nbsp; Removed pre-sizer: ' + fmt(jc.removed_pre_sizer_kg) + ' kg &nbsp; Balance: ' + fmt(jc.balance_kg) + ' kg</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Moisture</strong></div><div class="card-body py-2">Receiving: ' + fmt(jc.receiving_moisture_percentage) + '% &nbsp; Packing: ' + fmt(jc.packing_moisture_percentage) + '% &nbsp; Removed: ' + fmt(jc.removed_moisture_percentage) + '%</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Packing</strong></div><div class="card-body py-2">Start: ' + fmt(jc.packing_start_date) + ' &nbsp; Completion: ' + fmt(jc.packing_completion_date) + ' &nbsp; Best before: ' + fmt(jc.best_before_date) + '</div></div>';
                var sk = jc.sound_kernel_styles;
                if (typeof sk === 'string') { try { sk = JSON.parse(sk); } catch (e) { sk = null; } }
                if (sk && Array.isArray(sk) && sk.length > 0) {
                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sound kernel</strong></div><div class="card-body py-2"><table class="table table-sm table-bordered mb-0"><thead><tr><th>Style</th><th>Cartons</th><th>Weight (kg)</th></tr></thead><tbody>';
                    for (var i = 0; i < sk.length; i++) html += '<tr><td>' + fmt(sk[i].style) + '</td><td>' + fmt(sk[i].cartons) + '</td><td>' + fmt(sk[i].weight_kg) + '</td></tr>';
                    html += '</tbody></table><div class="mt-1">Total cartons: ' + fmt(jc.sound_kernel_total_cartons) + ' &nbsp; Total kg: ' + fmt(jc.sound_kernel_total_kg) + '</div></div></div>';
                } else {
                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sound kernel</strong></div><div class="card-body py-2">Total cartons: ' + fmt(jc.sound_kernel_total_cartons) + ' &nbsp; Total kg: ' + fmt(jc.sound_kernel_total_kg) + '</div></div>';
                }
                var bg = jc.butter_grade_styles;
                if (typeof bg === 'string') { try { bg = JSON.parse(bg); } catch (e) { bg = null; } }
                if (bg && Array.isArray(bg) && bg.length > 0) {
                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Butter grade</strong></div><div class="card-body py-2"><table class="table table-sm table-bordered mb-0"><thead><tr><th>Style</th><th>Cartons</th><th>Weight (kg)</th></tr></thead><tbody>';
                    for (var j = 0; j < bg.length; j++) html += '<tr><td>' + fmt(bg[j].style) + '</td><td>' + fmt(bg[j].cartons) + '</td><td>' + fmt(bg[j].weight_kg) + '</td></tr>';
                    html += '</tbody></table><div class="mt-1">Total cartons: ' + fmt(jc.butter_grade_total_cartons) + ' &nbsp; Total kg: ' + fmt(jc.butter_grade_total_kg) + '</div></div></div>';
                } else {
                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Butter grade</strong></div><div class="card-body py-2">Total cartons: ' + fmt(jc.butter_grade_total_cartons) + ' &nbsp; Total kg: ' + fmt(jc.butter_grade_total_kg) + '</div></div>';
                }
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Waste (kg)</strong></div><div class="card-body py-2">Oil kernel: ' + fmt(jc.waste_oil_kernel_kg) + ' &nbsp; Shell fines: ' + fmt(jc.waste_shell_fines_kg) + ' &nbsp; Compost: ' + fmt(jc.waste_compost_kg) + ' &nbsp; Shell: ' + fmt(jc.waste_shell_kg) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Mass balance</strong></div><div class="card-body py-2">In: ' + fmt(jc.mass_balance_in_kg) + ' kg &nbsp; Out: ' + fmt(jc.mass_balance_out_kg) + ' kg &nbsp; Balance: ' + fmt(jc.mass_balance_percentage) + '%</div></div>';
                html += '<p class="mb-0"><strong>Status:</strong> ' + fmt(jc.status) + '</p></div>';
                $body.html(html);
            }).catch(() => {
                $body.html('<p class="text-danger mb-0">Could not load job card.</p>');
            });
        }
    };
}());
_modal_job_card_view.init();
