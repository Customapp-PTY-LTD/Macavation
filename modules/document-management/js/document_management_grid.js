/**
 * Document Management Grid Module
 */
var _documentManagementGrid = function () {
    return {
        documents: [],
        init: function () {
            this.setupEventListeners();
            this.loadDocuments();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#uploadDocBtn').on('click', function () {
                Swal.fire('Info', 'Document upload coming soon', 'info');
            });
        },
        loadDocuments: async function () {
            try {
                const documents = await dataFunctions.callFunction('get_documents', {});
                this.documents = documents || [];
                this.renderDocuments();
            } catch (error) {
                console.error('Error loading documents:', error);
            }
        },
        renderDocuments: function () {
            const tbody = $('#documentsTableBody');
            tbody.empty();
            if (this.documents.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted">No documents found</td></tr>');
                return;
            }
            this.documents.forEach(doc => {
                const row = `<tr>
                    <td>${doc.document_name || 'N/A'}</td>
                    <td>${doc.document_type || 'N/A'}</td>
                    <td>${doc.related_entity_type || 'N/A'}</td>
                    <td>${doc.uploaded_by_name || 'N/A'}</td>
                    <td>${doc.uploaded_at || 'N/A'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="documentManagementGrid.viewDocument('${doc.id}')"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="documentManagementGrid.downloadDocument('${doc.id}')"><i class="fas fa-download"></i></button>
                    </td>
                </tr>`;
                tbody.append(row);
            });
        },
        viewDocument: function (docId) {
            Swal.fire('Info', 'Document viewer coming soon', 'info');
        },
        downloadDocument: function (docId) {
            Swal.fire('Info', 'Document download coming soon', 'info');
        }
    };
}();
const documentManagementGrid = _documentManagementGrid;
function initializeDocumentManagementGrid() {
    if (typeof documentManagementGrid !== 'undefined') {
        documentManagementGrid.init();
    }
}

