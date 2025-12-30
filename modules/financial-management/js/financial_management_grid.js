/**
 * Financial Management Grid Module
 */
var _financialManagementGrid = function () {
    return {
        transactions: [],
        init: function () {
            this.setupEventListeners();
            this.loadTransactions();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#addInvoiceBtn').on('click', function () {
                Swal.fire('Info', 'New invoice form coming soon', 'info');
            });
            $('#addPaymentBtn').on('click', function () {
                Swal.fire('Info', 'Record payment form coming soon', 'info');
            });
        },
        loadTransactions: async function () {
            try {
                const transactions = await dataFunctions.callFunction('get_financial_transactions', {});
                this.transactions = transactions || [];
                this.renderTransactions();
            } catch (error) {
                console.error('Error loading transactions:', error);
            }
        },
        renderTransactions: function () {
            const tbody = $('#financialTableBody');
            tbody.empty();
            if (this.transactions.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center text-muted">No financial transactions found</td></tr>');
                return;
            }
            this.transactions.forEach(trans => {
                const statusClass = trans.status === 'paid' ? 'bg-success' : 
                                  trans.status === 'pending' ? 'bg-warning' : 'bg-secondary';
                const row = `<tr>
                    <td>${trans.document_number || 'N/A'}</td>
                    <td>${trans.transaction_type || 'N/A'}</td>
                    <td>${trans.contact_name || 'N/A'}</td>
                    <td>R ${trans.amount || '0.00'}</td>
                    <td>${trans.transaction_date || 'N/A'}</td>
                    <td><span class="badge ${statusClass}">${trans.status || 'N/A'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="financialManagementGrid.viewTransaction('${trans.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        viewTransaction: function (transId) {
            Swal.fire('Info', 'Transaction details coming soon', 'info');
        }
    };
}();
const financialManagementGrid = _financialManagementGrid;
function initializeFinancialManagementGrid() {
    if (typeof financialManagementGrid !== 'undefined') {
        financialManagementGrid.init();
    }
}

