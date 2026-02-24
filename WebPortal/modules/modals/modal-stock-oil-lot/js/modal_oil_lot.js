/**
 * Modal: Add/Edit Oil Stock Lot. Parent (stock-management grid) only loads this route and calls show(lot) or show().
 */
var _modal_stock_oil_lot = (function () {
    'use strict';

    function setVal(id, v) {
        var el = document.getElementById(id);
        if (el) el.value = v !== undefined && v !== null ? v : '';
    }
    function getDefault(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    return {
        init: () => {
            const scope = _modal_stock_oil_lot;
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_stock_oil_lot;
            $('#saveOilLotBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.saveOilLot();
            });
        },

        show: (lot) => {
            setVal('oilLotId', lot ? lot.id : '');
            setVal('oilLotLocation', lot ? lot.location_code : (getDefault('oilLocationFilter') || ''));
            setVal('oilLotCategory', lot ? lot.stock_category : (getDefault('oilCategoryFilter') || ''));
            setVal('oilLotStatus', lot ? lot.status : (getDefault('oilStatusFilter') || 'on_hand'));
            setVal('oilLotCounterpartyType', lot ? lot.counterparty_type : '');
            setVal('oilLotCounterpartyName', lot ? (lot.counterparty_name || '') : '');
            setVal('oilLotPoRef', lot ? (lot.po_reference || '') : '');
            setVal('oilLotBatchNumber', lot ? (lot.batch_number || '') : '');
            setVal('oilLotProductCode', lot ? (lot.product_code || '') : '');
            setVal('oilLotProductDescription', lot ? (lot.product_description || '') : '');
            setVal('oilLotGrade', lot ? (lot.grade || '') : '');
            setVal('oilLotFfa', lot ? (lot.ffa !== undefined && lot.ffa !== null ? lot.ffa : '') : '');
            setVal('oilLotUnits', lot ? (lot.units !== undefined && lot.units !== null ? lot.units : '') : '');
            setVal('oilLotKg', lot ? (lot.kilograms !== undefined && lot.kilograms !== null ? lot.kilograms : '') : '');
            setVal('oilLotVolume', lot ? (lot.volume !== undefined && lot.volume !== null ? lot.volume : '') : '');
            setVal('oilLotDeliveryDate', lot ? (lot.delivery_date || '') : '');
            setVal('oilLotManufactureDate', lot ? (lot.manufacture_date || '') : '');
            setVal('oilLotBbDate', lot ? (lot.bb_date || '') : '');
            setVal('oilLotCoaStatus', lot ? (lot.coa_status || '') : '');
            setVal('oilLotNotes', lot ? (lot.notes || '') : '');

            var title = document.getElementById('oilLotModalLabel');
            if (title) title.textContent = lot ? 'Edit Oil Stock Lot' : 'Add Oil Stock Lot';

            var modalEl = document.getElementById('oilLotModal');
            if (modalEl && typeof bootstrap !== 'undefined') {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#oilLotModal').modal('show');
            }
        },

        saveOilLot: async () => {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions) return;

                var val = function (id) {
                    var el = document.getElementById(id);
                    return el ? el.value : '';
                };

                var lotId = val('oilLotId') || null;
                var location = val('oilLotLocation');
                var category = val('oilLotCategory');
                var kg = parseFloat(val('oilLotKg'));

                if (!location || !category || !kg || kg <= 0) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', 'Location, Category, and Kilograms (> 0) are required.', 'warning');
                    return;
                }

                var payload = {
                    p_location_code: location,
                    p_stock_category: category,
                    p_kilograms: kg,
                    p_status: val('oilLotStatus') || 'on_hand',
                    p_counterparty_type: val('oilLotCounterpartyType') || null,
                    p_counterparty_name: val('oilLotCounterpartyName') || null,
                    p_po_reference: val('oilLotPoRef') || null,
                    p_batch_number: val('oilLotBatchNumber') || null,
                    p_product_code: val('oilLotProductCode') || null,
                    p_product_description: val('oilLotProductDescription') || null,
                    p_grade: val('oilLotGrade') || null,
                    p_ffa: val('oilLotFfa') ? parseFloat(val('oilLotFfa')) : null,
                    p_coa_status: val('oilLotCoaStatus') || null,
                    p_units: val('oilLotUnits') ? parseInt(val('oilLotUnits'), 10) : null,
                    p_volume: val('oilLotVolume') ? parseFloat(val('oilLotVolume')) : null,
                    p_delivery_date: val('oilLotDeliveryDate') || null,
                    p_manufacture_date: val('oilLotManufactureDate') || null,
                    p_bb_date: val('oilLotBbDate') || null,
                    p_notes: val('oilLotNotes') || null
                };

                var result;
                if (lotId) {
                    result = await dataFunctions.updateOilStockLot(lotId, payload);
                } else {
                    result = await dataFunctions.createOilStockLot(payload);
                }

                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Success', lotId ? 'Oil lot updated' : 'Oil lot created', 'success');
                    var modalEl = document.getElementById('oilLotModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#oilLotModal').modal('hide');
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadOilLotsAndSummary) await _stockManagementGrid.loadOilLotsAndSummary(true);
                } else {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', result && (result.error || result.message) ? (result.error || result.message) : 'Failed to save oil lot', 'error');
                }
            } catch (e) {
                console.error('[Stock Management] saveOilLot failed:', e);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', e.message || 'Failed to save oil lot', 'error');
            }
        }
    };
}());
_modal_stock_oil_lot.init();
