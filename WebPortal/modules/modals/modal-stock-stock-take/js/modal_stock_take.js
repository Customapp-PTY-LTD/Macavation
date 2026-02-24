/**
 * Modal: Stock Take - Physical Count. Parent calls show(); modal owns close, save, complete, load system stock, variance.
 */
var _modal_stock_stock_take = (function () {
    'use strict';
    var api = {
        init: function () {
            var scope = api;
            var saveBtn = document.getElementById('saveStockTakeBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); scope.saveStockTake(); });
            var completeBtn = document.getElementById('completeStockTakeBtn');
            if (completeBtn) completeBtn.addEventListener('click', function (e) { e.preventDefault(); scope.completeStockTake(); });
            var loadBtn = document.getElementById('loadSystemStockBtn');
            if (loadBtn) loadBtn.addEventListener('click', function () { scope.loadSystemStockIntoTable(); });
            var addRowBtn = document.getElementById('addStockTakeItemRow');
            if (addRowBtn) addRowBtn.addEventListener('click', function () { scope.addStockTakeItemRow(); });

            var modalEl = document.getElementById('stockTakeModal');
            if (modalEl) {
                var cancelBtn = document.getElementById('stockTakeModalCancelBtn');
                if (cancelBtn) cancelBtn.addEventListener('click', function () { scope.close(); });
                var closeBtn = document.getElementById('stockTakeModalCloseBtn');
                if (closeBtn) closeBtn.addEventListener('click', function () { scope.close(); });
                modalEl.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape' || e.keyCode === 27) {
                        e.preventDefault();
                        scope.close();
                    }
                });
            }

            document.addEventListener('click', function (e) {
                if (e.target.closest('.removeStockTakeRow')) {
                    e.preventDefault();
                    var row = e.target.closest('tr');
                    if (row) row.remove();
                    scope.calculateStockTakeVariance();
                }
            });

            var stockTakeTable = document.getElementById('stockTakeTable');
            if (stockTakeTable) {
                stockTakeTable.addEventListener('input', function (e) {
                    if (e.target.name === 'physicalQuantity') {
                        var row = e.target.closest('tr');
                        if (row) {
                            scope.calculateRowVariance(row);
                            scope.calculateStockTakeVariance();
                        }
                    }
                });
            }

            if (typeof $ !== 'undefined') {
                $(document).on('click', '.removeStockTakeRow', function () {
                    $(this).closest('tr').remove();
                    scope.calculateStockTakeVariance();
                });
                $(document).on('input', 'input[name="physicalQuantity"]', function () {
                    var row = this.closest('tr');
                    if (row) {
                        scope.calculateRowVariance(row);
                        scope.calculateStockTakeVariance();
                    }
                });
            }
        },

        show: async function () {
            if (typeof $ !== 'undefined') {
                $('#stockTakeModalLabel').text('Stock Take - Physical Count');
                $('#stockTakeId').val('');
                api.clearStockTakeForm();
                var today = new Date().toISOString().split('T')[0];
                $('#stockTakeDate').val(today);
            }

            var modalEl = document.getElementById('stockTakeModal');
            if (!modalEl) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Stock take modal not found. Please refresh the page.', 'error');
                return;
            }
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#stockTakeModal').modal('show');
            }
        },

        close: function () {
            var modalEl = document.getElementById('stockTakeModal');
            if (!modalEl) return;
            var triggerBtn = document.getElementById('stockTakeBtn');
            if (triggerBtn) triggerBtn.focus();
            else if (document.activeElement && modalEl.contains(document.activeElement)) document.activeElement.blur();
            try {
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                if (typeof $ !== 'undefined' && $.fn.modal) $('#stockTakeModal').modal('hide');
                var self = api;
                setTimeout(function () {
                    if (modalEl.classList.contains('show') || modalEl.style.display === 'block') {
                        self.hardForceClose();
                    }
                }, 50);
            } catch (e) {
                api.hardForceClose();
            }
        },

        hardForceClose: function () {
            var modalEl = document.getElementById('stockTakeModal');
            if (!modalEl) return;
            var triggerBtn = document.getElementById('stockTakeBtn');
            if (triggerBtn) triggerBtn.focus();
            else if (document.activeElement && modalEl.contains(document.activeElement)) document.activeElement.blur();
            if (typeof window !== 'undefined' && typeof window.forceCloseAllModals === 'function') window.forceCloseAllModals();
            modalEl.classList.remove('show');
            modalEl.style.display = 'none';
            modalEl.setAttribute('aria-hidden', 'true');
            modalEl.removeAttribute('aria-modal');
            modalEl.removeAttribute('role');
            document.querySelectorAll('.modal-backdrop').forEach(function (b) { b.remove(); });
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        },

        clearStockTakeForm: function () {
            var form = document.getElementById('stockTakeForm');
            if (form) form.reset();
            var stockTakeId = document.getElementById('stockTakeId');
            if (stockTakeId) stockTakeId.value = '';
            var stockTakeBody = document.getElementById('stockTakeTableBody');
            if (stockTakeBody) {
                var rows = stockTakeBody.querySelectorAll('tr');
                for (var i = rows.length - 1; i > 0; i--) rows[i].remove();
                if (rows[0]) {
                    var inputs = rows[0].querySelectorAll('input');
                    for (var j = 0; j < inputs.length; j++) inputs[j].value = '';
                }
            }
            api.calculateStockTakeVariance();
        },

        loadSystemStockIntoTable: async function () {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getStockItems) return;
                var stockItems = await dataFunctions.getStockItems();
                var tbody = document.getElementById('stockTakeTableBody');
                if (!tbody) return;
                tbody.innerHTML = '';
                if (stockItems && stockItems.length > 0) {
                    stockItems.forEach(function (item) {
                        var row = document.createElement('tr');
                        row.innerHTML =
                            '<td><input type="text" class="form-control form-control-sm" name="stockNumber" value="' + (item.stock_number || '') + '" readonly></td>' +
                            '<td><input type="text" class="form-control form-control-sm" name="description" value="' + (item.description || item.product_type || '') + '"></td>' +
                            '<td><input type="text" class="form-control form-control-sm" name="unitOfMeasure" value="kg"></td>' +
                            '<td><input type="text" class="form-control form-control-sm" name="binLocation" value="' + (item.bin_location || 'DEFAULT') + '"></td>' +
                            '<td><input type="number" class="form-control form-control-sm" name="systemQuantity" step="0.01" value="' + (item.quantity_kg || 0) + '" readonly></td>' +
                            '<td><input type="number" class="form-control form-control-sm" name="physicalQuantity" step="0.01" value="' + (item.quantity_kg || 0) + '"></td>' +
                            '<td><input type="number" class="form-control form-control-sm" name="variance" step="0.01" readonly></td>' +
                            '<td><input type="number" class="form-control form-control-sm" name="variancePercentage" step="0.01" readonly></td>' +
                            '<td><button type="button" class="btn btn-sm btn-danger removeStockTakeRow"><i class="fas fa-times"></i></button></td>';
                        tbody.appendChild(row);
                    });
                    tbody.querySelectorAll('tr').forEach(function (row) { api.calculateRowVariance(row); });
                    api.calculateStockTakeVariance();
                }
            } catch (err) {
                console.error('Error loading system stock:', err);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to load system stock: ' + (err.message || '') });
            }
        },

        addStockTakeItemRow: function () {
            var newRow = '<tr>' +
                '<td><input type="text" class="form-control form-control-sm" name="stockNumber"></td>' +
                '<td><input type="text" class="form-control form-control-sm" name="description"></td>' +
                '<td><input type="text" class="form-control form-control-sm" name="unitOfMeasure" value="kg"></td>' +
                '<td><input type="text" class="form-control form-control-sm" name="binLocation" value="DEFAULT"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="systemQuantity" step="0.01" readonly></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="physicalQuantity" step="0.01"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="variance" step="0.01" readonly></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="variancePercentage" step="0.01" readonly></td>' +
                '<td><button type="button" class="btn btn-sm btn-danger removeStockTakeRow"><i class="fas fa-times"></i></button></td>' +
                '</tr>';
            var stockTakeBody = document.getElementById('stockTakeTableBody');
            if (stockTakeBody) stockTakeBody.insertAdjacentHTML('beforeend', newRow);
            else if (typeof $ !== 'undefined') $('#stockTakeTableBody').append(newRow);
        },

        calculateRowVariance: function (row) {
            var rowEl = row && row.jquery ? row[0] : (row || null);
            if (!rowEl) return;
            var systemQtyInput = rowEl.querySelector('input[name="systemQuantity"]');
            var physicalQtyInput = rowEl.querySelector('input[name="physicalQuantity"]');
            var varianceInput = rowEl.querySelector('input[name="variance"]');
            var variancePctInput = rowEl.querySelector('input[name="variancePercentage"]');
            if (!systemQtyInput || !physicalQtyInput || !varianceInput || !variancePctInput) return;
            var systemQty = parseFloat(systemQtyInput.value) || 0;
            var physicalQty = parseFloat(physicalQtyInput.value) || 0;
            var variance = physicalQty - systemQty;
            var variancePercentage = systemQty > 0 ? (variance / systemQty) * 100 : 0;
            varianceInput.value = variance.toFixed(2);
            variancePctInput.value = variancePercentage.toFixed(2);
            if (Math.abs(variancePercentage) > 5) rowEl.classList.add('table-warning');
            else rowEl.classList.remove('table-warning');
        },

        calculateStockTakeVariance: function () {
            var totalItems = 0, itemsWithVariance = 0, totalSystemValue = 0, totalPhysicalValue = 0;
            var stockTakeBody = document.getElementById('stockTakeTableBody');
            if (stockTakeBody) {
                var rows = stockTakeBody.querySelectorAll('tr');
                rows.forEach(function (row) {
                    var systemQtyInput = row.querySelector('input[name="systemQuantity"]');
                    var physicalQtyInput = row.querySelector('input[name="physicalQuantity"]');
                    var systemQty = systemQtyInput ? parseFloat(systemQtyInput.value) || 0 : 0;
                    var physicalQty = physicalQtyInput ? parseFloat(physicalQtyInput.value) || 0 : 0;
                    if (systemQty > 0 || physicalQty > 0) {
                        totalItems++;
                        totalSystemValue += systemQty;
                        totalPhysicalValue += physicalQty;
                        if (Math.abs(systemQty - physicalQty) > 0.01) itemsWithVariance++;
                    }
                });
            }
            var totalItemsEl = document.getElementById('totalItemsCounted');
            var itemsWithVarianceEl = document.getElementById('itemsWithVariance');
            var totalSystemValueEl = document.getElementById('totalSystemValue');
            var totalPhysicalValueEl = document.getElementById('totalPhysicalValue');
            if (totalItemsEl) totalItemsEl.value = totalItems;
            if (itemsWithVarianceEl) itemsWithVarianceEl.value = itemsWithVariance;
            if (totalSystemValueEl) totalSystemValueEl.value = totalSystemValue.toFixed(2);
            if (totalPhysicalValueEl) totalPhysicalValueEl.value = totalPhysicalValue.toFixed(2);
        },

        saveStockTake: async function () {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.createStockTake) return;
                var form = document.getElementById('stockTakeForm');
                if (form && !form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                var stockTakeItems = [];
                var stockTakeBody = document.getElementById('stockTakeTableBody');
                if (stockTakeBody) {
                    var rows = stockTakeBody.querySelectorAll('tr');
                    rows.forEach(function (row) {
                        var stockNumberInput = row.querySelector('input[name="stockNumber"]');
                        var descriptionInput = row.querySelector('input[name="description"]');
                        var unitOfMeasureInput = row.querySelector('input[name="unitOfMeasure"]');
                        var binLocationInput = row.querySelector('input[name="binLocation"]');
                        var systemQtyInput = row.querySelector('input[name="systemQuantity"]');
                        var physicalQtyInput = row.querySelector('input[name="physicalQuantity"]');
                        var varianceInput = row.querySelector('input[name="variance"]');
                        var variancePctInput = row.querySelector('input[name="variancePercentage"]');
                        var stockNumber = stockNumberInput ? stockNumberInput.value : '';
                        var description = descriptionInput ? descriptionInput.value : '';
                        if (stockNumber || description) {
                            stockTakeItems.push({
                                stock_number: stockNumber || null,
                                description: description || null,
                                unit_of_measure: unitOfMeasureInput ? unitOfMeasureInput.value : null,
                                bin_location: binLocationInput ? binLocationInput.value : null,
                                system_quantity: systemQtyInput ? parseFloat(systemQtyInput.value) || 0 : 0,
                                physical_quantity: physicalQtyInput ? parseFloat(physicalQtyInput.value) || 0 : 0,
                                variance_quantity: varianceInput ? parseFloat(varianceInput.value) || 0 : 0,
                                variance_percentage: variancePctInput ? parseFloat(variancePctInput.value) || 0 : 0
                            });
                        }
                    });
                }
                function getValue(id) {
                    var el = document.getElementById(id);
                    return el ? el.value : null;
                }
                var stockTakeData = {
                    p_stock_take_date: getValue('stockTakeDate'),
                    p_location: getValue('stockTakeLocation') || null,
                    p_stock_take_type: getValue('stockTakeType') || 'full',
                    p_notes: getValue('stockTakeNotes') || null,
                    p_stock_take_items: stockTakeItems.length > 0 ? JSON.stringify(stockTakeItems) : null
                };
                var result = await dataFunctions.createStockTake(stockTakeData);
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'success', title: 'Success', text: 'Stock take saved successfully', timer: 2000, showConfirmButton: false });
                    api.close();
                } else {
                    throw new Error(result && (result.error || result.message) ? (result.error || result.message) : 'Failed to save stock take');
                }
            } catch (error) {
                console.error('Error saving stock take:', error);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save stock take: ' + (error.message || '') });
            }
        },

        completeStockTake: async function () {
            await api.saveStockTake();
        }
    };
    return api;
})();
_modal_stock_stock_take.init();
