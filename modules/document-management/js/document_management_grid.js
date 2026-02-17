/**
 * Document Management Grid Module
 * Pattern: IIFE, single global _documentManagementGrid, arrow methods, initHandlers, jQuery.
 */
var _documentManagementGrid = (function () {
    'use strict';

    return {
        documents: [],

        init: () => {
            const scope = _documentManagementGrid;
            scope.initHandlers();
            scope.loadDocuments();
        },

        initHandlers: () => {
            const scope = _documentManagementGrid;
            $('#uploadDocBtn').on('click', () => {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Document upload coming soon', 'info');
                else alert('Document upload coming soon');
            });
            $(document).on('click', '[data-document-action][data-document-id]', function (e) {
                e.preventDefault();
                const action = $(this).data('document-action');
                const docId = $(this).data('document-id');
                if (action === 'view') scope.viewDocument(docId);
                else if (action === 'download') scope.downloadDocument(docId);
            });
        },

        loadDocuments: async () => {
            const scope = _documentManagementGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getDocuments) {
                    scope.documents = [];
                    scope.renderDocuments();
                    return;
                }
                const documents = await dataFunctions.getDocuments().catch(() => []);
                scope.documents = documents || [];
                scope.renderDocuments();
            } catch (error) {
                console.error('Error loading documents:', error);
                scope.showError('Unable to load documents. Please try again later.');
            }
        },

        renderDocuments: () => {
            const scope = _documentManagementGrid;
            const tbody = $('#documentsTableBody');
            tbody.empty();
            if (scope.documents.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No documents found. Click "Upload Document" to add one.</td></tr>');
                return;
            }
            scope.documents.forEach(doc => {
                const row = `<tr>
                    <td>${doc.document_name || 'N/A'}</td>
                    <td>${doc.document_type || 'N/A'}</td>
                    <td>${doc.related_entity_type || 'N/A'}</td>
                    <td>${doc.uploaded_by_name || 'N/A'}</td>
                    <td>${doc.uploaded_at || 'N/A'}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-outline-primary" data-document-action="view" data-document-id="${doc.id}"><i class="fas fa-eye"></i></button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-document-action="download" data-document-id="${doc.id}"><i class="fas fa-download"></i></button>
                    </td>
                </tr>`;
                tbody.append(row);
            });
        },

        viewDocument: (docId) => {
            if (typeof Swal !== 'undefined') Swal.fire('Info', 'Document viewer coming soon', 'info');
            else alert('Document viewer coming soon');
        },

        downloadDocument: (docId) => {
            if (typeof Swal !== 'undefined') Swal.fire('Info', 'Document download is under development', 'info');
            else alert('Document download is under development');
        },

        showError: (message) => {
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: message });
            else alert('Error: ' + message);
        }
    };
})();

function initializeDocumentManagementGrid() {
    if (typeof _documentManagementGrid !== 'undefined') _documentManagementGrid.init();
}
