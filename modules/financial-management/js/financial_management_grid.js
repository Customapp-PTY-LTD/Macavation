/**
 * Financial Management Grid Module
 */
var _financialManagementGrid = function () {
    'use strict';

    return {
        transactions: [],
        _handlersBound: false,

        init: async () => {
            const scope = _financialManagementGrid;
            scope.initHandlers();
            await scope.loadTransactions();
        },

        initHandlers: () => {
            const scope = _financialManagementGrid;
            $('#addInvoiceBtn').off('click').on('click', () => {
                Swal.fire('Info', 'New invoice form coming soon', 'info');
            });
            $('#addPaymentBtn').off('click').on('click', () => {
                Swal.fire('Info', 'Record payment form coming soon', 'info');
            });
            $('#exportTransactionsBtn').off('click').on('click', () => scope.exportTransactions());
            if (!scope._handlersBound) {
                scope._handlersBound = true;
                $(document).on('click', '.js-view-transaction', function () {
                    const id = $(this).data('id');
                    if (id) scope.viewTransaction(id);
                });
            }
        },

        loadTransactions: async () => {
            const scope = _financialManagementGrid;
            try {
                const transactions = await dataFunctions.getFinancialTransactions().catch(() => []);
                scope.transactions = transactions || [];
                scope.renderTransactions();
            } catch (error) {
                console.error('Error loading transactions:', error);
                scope.showError('Unable to load financial transactions. Please try again later.');
            }
        },

        renderTransactions: () => {
            const scope = _financialManagementGrid;
            const tbody = $('#financialTableBody');
            tbody.empty();
            if (scope.transactions.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No financial transactions found. Use "New Invoice" or "Record Payment" to add transactions.</td></tr>');
                return;
            }
            scope.transactions.forEach(trans => {
                const statusClass = trans.status === 'paid' ? 'bg-success' :
                    trans.status === 'pending' ? 'bg-warning' : 'bg-secondary';
                const row = `<tr>
                    <td>${trans.document_number || 'N/A'}</td>
                    <td>${trans.transaction_type || 'N/A'}</td>
                    <td>${trans.contact_name || 'N/A'}</td>
                    <td>R ${trans.amount || '0.00'}</td>
                    <td>${(typeof _common !== 'undefined' && _common.formatDateDDMMYYYY ? _common.formatDateDDMMYYYY(trans.transaction_date) : trans.transaction_date) || 'N/A'}</td>
                    <td><span class="badge ${statusClass}">${trans.status || 'N/A'}</span></td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary js-view-transaction" data-id="${trans.id}"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },

        viewTransaction: (transId) => {
            Swal.fire('Info', 'Transaction details view is under development', 'info');
        },

        showError: (message) => {
            Swal.fire({ icon: 'error', title: 'Error', text: message });
        },

        exportTransactions: () => {
            const scope = _financialManagementGrid;
            if (!scope.transactions || scope.transactions.length === 0) {
                Swal.fire('Info', 'No transactions to export', 'info');
                return;
            }

            const columns = [
                { key: 'document_number', label: 'Document Number' },
                { key: 'transaction_type', label: 'Type' },
                { key: 'contact_name', label: 'Contact' },
                { key: 'amount', label: 'Amount (ZAR)' },
                { key: 'transaction_date', label: 'Date' },
                { key: 'status', label: 'Status' }
            ];

            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.transactions, 'financial_transactions', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

_financialManagementGrid.init();
