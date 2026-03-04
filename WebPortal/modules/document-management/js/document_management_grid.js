/**
 * Document Management Grid Module
 * Upload documents with name and category; add categories on the fly. Pattern: IIFE, single global _documentManagementGrid.
 */
var _documentManagementGrid = (function () {
    'use strict';

    function escapeHtml(str) {
        if (str == null || typeof str !== 'string') return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getCurrentUserId() {
        try {
            var user = typeof Session !== 'undefined' && Session.get && Session.get('user');
            return user && user.id ? user.id : null;
        } catch (e) { return null; }
    }

    return {
        documents: [],
        categories: [],

        init: function () {
            var scope = _documentManagementGrid;
            scope.initHandlers();
            scope.loadDocuments();
        },

        initHandlers: function () {
            var scope = _documentManagementGrid;
            $('#uploadDocBtn').on('click', function () {
                scope.openUploadModal();
            });
            $('#docAddCategoryBtn').on('click', function () {
                $('#docNewCategoryWrap').removeClass('d-none');
                $('#docNewCategoryName').val('').focus();
            });
            $('#docNewCategoryCancel').on('click', function () {
                $('#docNewCategoryWrap').addClass('d-none');
                $('#docNewCategoryName').val('');
            });
            $('#docNewCategorySave').on('click', function () {
                scope.saveNewCategory();
            });
            $('#docUploadSubmitBtn').on('click', function () {
                scope.submitUpload();
            });
            $('#uploadDocumentModal').on('show.bs.modal', function () {
                scope.loadCategoriesForUpload();
            });
            $('#uploadDocumentModal').on('hidden.bs.modal', function () {
                $('#docUploadName').val('');
                $('#docUploadCategory').val('');
                $('#docUploadFile').val('');
                $('#docUploadStatus').text('');
                $('#docNewCategoryWrap').addClass('d-none');
            });
            $(document).on('click', '[data-document-action][data-document-id]', function (e) {
                e.preventDefault();
                var action = $(this).data('document-action');
                var docId = $(this).data('document-id');
                if (action === 'view') scope.viewDocument(docId);
                else if (action === 'download') scope.downloadDocument(docId);
                else if (action === 'delete') scope.deleteDocument(docId);
            });
        },

        loadCategoriesForUpload: function () {
            var scope = _documentManagementGrid;
            var sel = document.getElementById('docUploadCategory');
            if (!sel) return;
            var firstOpt = sel.options[0];
            sel.innerHTML = firstOpt ? firstOpt.outerHTML : '<option value="">— No category —</option>';
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getDocumentCategories) return;
            dataFunctions.getDocumentCategories().then(function (list) {
                scope.categories = Array.isArray(list) ? list : [];
                scope.categories.forEach(function (c) {
                    var opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name || '';
                    sel.appendChild(opt);
                });
            }).catch(function () { scope.categories = []; });
        },

        saveNewCategory: function () {
            var scope = _documentManagementGrid;
            var name = ($('#docNewCategoryName').val() || '').trim();
            if (!name) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Enter a category name', 'warning');
                else alert('Enter a category name');
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createDocumentCategory) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create category not available', 'error');
                return;
            }
            dataFunctions.createDocumentCategory({ name: name }).then(function (result) {
                var ok = result && (result.success === true || result.id);
                var id = result && (result.id || (result.data && result.data.id));
                if (ok && id) {
                    var sel = document.getElementById('docUploadCategory');
                    if (sel) {
                        var opt = document.createElement('option');
                        opt.value = id;
                        opt.textContent = name;
                        opt.selected = true;
                        sel.appendChild(opt);
                    }
                    scope.categories.push({ id: id, name: name });
                    $('#docNewCategoryWrap').addClass('d-none');
                    $('#docNewCategoryName').val('');
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Category added', timer: 1500, showConfirmButton: false });
                } else {
                    var err = (result && result.error) || 'Failed to add category';
                    if (typeof Swal !== 'undefined') Swal.fire('Error', err, 'error');
                    else alert(err);
                }
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to add category', 'error');
            });
        },

        openUploadModal: function () {
            var modal = document.getElementById('uploadDocumentModal');
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal && modal) {
                new bootstrap.Modal(modal).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#uploadDocumentModal').modal('show');
            }
        },

        submitUpload: function () {
            var scope = _documentManagementGrid;
            var name = ($('#docUploadName').val() || '').trim();
            var categoryId = ($('#docUploadCategory').val() || '').trim() || null;
            var fileInput = document.getElementById('docUploadFile');
            var file = fileInput && fileInput.files && fileInput.files[0];

            if (!name) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please enter a document name.', 'warning');
                return;
            }
            if (!file) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please select a file to upload.', 'warning');
                return;
            }

            var statusEl = document.getElementById('docUploadStatus');
            var btn = document.getElementById('docUploadSubmitBtn');
            if (statusEl) statusEl.textContent = 'Uploading file…';
            if (btn) btn.disabled = true;

            var resourceFolder = 'Macavation/Documents';
            var fileId = 'doc_' + Date.now() + '_' + (file.name || 'file').replace(/\s/g, '_');
            var uploadPromise = (typeof _common !== 'undefined' && _common.uploadFile)
                ? _common.uploadFile({ file: file, resourceFolder: resourceFolder, fileId: fileId })
                : Promise.resolve({ Success: false, LastErrorDescription: 'Upload not available' });

            uploadPromise.then(function (uploadResult) {
                if (statusEl) statusEl.textContent = '';
                if (btn) btn.disabled = false;
                if (!uploadResult || !uploadResult.Success) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (uploadResult && uploadResult.LastErrorDescription) || 'Upload failed', 'error');
                    return;
                }
                var data = uploadResult.Data;
                var fileIdStored = (data && data[0] && (data[0].fileId || data[0].key)) || (data && data.fileId) || fileId;
                var fileLink = (data && data[0] && data[0].fileLink) || (data && data.fileLink) || null;

                if (typeof dataFunctions === 'undefined' || !dataFunctions.createDocument) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Save document not available', 'error');
                    return;
                }
                return dataFunctions.createDocument({
                    document_name: name,
                    category_id: categoryId,
                    file_name: file.name,
                    file_id: fileIdStored,
                    file_link: fileLink,
                    uploaded_by: getCurrentUserId()
                }).then(function (createResult) {
                    var ok = createResult && (createResult.success === true || createResult.id);
                    if (ok) {
                        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                            var modal = document.getElementById('uploadDocumentModal');
                            if (modal) bootstrap.Modal.getInstance(modal).hide();
                        } else if (typeof $ !== 'undefined') $('#uploadDocumentModal').modal('hide');
                        scope.loadDocuments();
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Document uploaded', timer: 2000, showConfirmButton: false });
                    } else {
                        if (typeof Swal !== 'undefined') Swal.fire('Error', (createResult && createResult.error) || 'Failed to save document', 'error');
                    }
                });
            }).catch(function (e) {
                if (statusEl) statusEl.textContent = '';
                if (btn) btn.disabled = false;
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Upload failed', 'error');
            });
        },

        loadDocuments: function () {
            var scope = _documentManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getDocuments) {
                scope.documents = [];
                scope.renderDocuments();
                return;
            }
            dataFunctions.getDocuments(null, true).then(function (list) {
                scope.documents = Array.isArray(list) ? list : [];
                scope.renderDocuments();
            }).catch(function () {
                scope.documents = [];
                scope.renderDocuments();
            });
        },

        renderDocuments: function () {
            var scope = _documentManagementGrid;
            var tbody = $('#documentsTableBody');
            tbody.empty();
            if (scope.documents.length === 0) {
                tbody.html('<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No documents found. Click "Upload Document" to add one.</td></tr>');
                return;
            }
            scope.documents.forEach(function (doc) {
                var dateStr = doc.created_at ? (doc.created_at.slice(0, 10) + ' ' + (doc.created_at.slice(11, 16) || '')).trim() : 'N/A';
                var row = '<tr>' +
                    '<td>' + escapeHtml(doc.document_name || 'N/A') + '</td>' +
                    '<td>' + escapeHtml(doc.category_name || '—') + '</td>' +
                    '<td>' + escapeHtml(doc.uploaded_by_name || 'N/A') + '</td>' +
                    '<td>' + escapeHtml(dateStr) + '</td>' +
                    '<td>' +
                    '<button type="button" class="btn btn-sm btn-outline-primary me-1" data-document-action="view" data-document-id="' + escapeHtml(doc.id) + '" title="View"><i class="fas fa-eye"></i></button>' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary me-1" data-document-action="download" data-document-id="' + escapeHtml(doc.id) + '" title="Download"><i class="fas fa-download"></i></button>' +
                    '<button type="button" class="btn btn-sm btn-outline-danger" data-document-action="delete" data-document-id="' + escapeHtml(doc.id) + '" title="Delete"><i class="fas fa-trash"></i></button>' +
                    '</td></tr>';
                tbody.append(row);
            });
        },

        viewDocument: function (docId) {
            var scope = _documentManagementGrid;
            var doc = scope.documents.find(function (d) { return d.id === docId; });
            if (doc && doc.file_link) {
                window.open(doc.file_link, '_blank');
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'View link not available for this document.', 'info');
            }
        },

        downloadDocument: function (docId) {
            var scope = _documentManagementGrid;
            var doc = scope.documents.find(function (d) { return d.id === docId; });
            if (doc && doc.file_link) {
                window.open(doc.file_link, '_blank');
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Download link not available for this document.', 'info');
            }
        },

        deleteDocument: function (docId) {
            var scope = _documentManagementGrid;
            if (typeof Swal === 'undefined') {
                if (confirm('Delete this document?')) scope.doDeleteDocument(docId);
                return;
            }
            Swal.fire({
                title: 'Delete document?',
                text: 'This cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#dc3545',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Yes, delete'
            }).then(function (res) {
                if (res.isConfirmed) scope.doDeleteDocument(docId);
            });
        },

        doDeleteDocument: function (docId) {
            var scope = _documentManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.deleteDocument) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Delete not available', 'error');
                return;
            }
            dataFunctions.deleteDocument(docId).then(function (result) {
                if (result && result.success !== false) {
                    scope.loadDocuments();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Document deleted', timer: 1500, showConfirmButton: false });
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Delete failed', 'error');
                }
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Delete failed', 'error');
            });
        },

        showError: function (message) {
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: message });
            else alert('Error: ' + message);
        }
    };
})();

function initializeDocumentManagementGrid() {
    if (typeof _documentManagementGrid !== 'undefined') _documentManagementGrid.init();
}
