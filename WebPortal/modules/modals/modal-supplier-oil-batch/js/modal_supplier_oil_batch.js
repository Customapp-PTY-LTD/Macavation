/**
 * Modal: Supplier Oil Batch (legacy/optional).
 * Kept to satisfy route config and avoid missing-script errors.
 */
var _modalSupplierOilBatch = (function () {
    'use strict';

    var CONTAINER_ID = 'supplierOilBatchModal';
    var _inited = false;

    var api = {
        init: function () {
            if (_inited) return;
            _inited = true;
            var btn = document.getElementById('supplierOilBatchSaveBtn');
            if (btn) {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (typeof Swal !== 'undefined') {
                        Swal.fire('Info', 'This modal is currently not used. Please use Receiver checklist on Supplier Intake.', 'info');
                    }
                });
            }
        },
        show: function () {
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        }
    };

    return api;
})();

_modalSupplierOilBatch.init();

