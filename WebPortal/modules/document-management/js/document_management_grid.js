/**
 * Document Management Grid Module — Explorer-style folder browser.
 * Pattern: IIFE, single global _documentManagementGrid.
 */
var _documentManagementGrid = (function () {
    'use strict';

    // ── Utilities ─────────────────────────────────────────────────────────────

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

    function filenameWithoutExtension(filename) {
        var parts = (filename || '').split('.');
        if (parts.length > 1) parts.pop();
        return parts.join('.').replace(/_/g, ' ').trim() || filename;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    /**
     * Unwrap a Supabase RPC result that may be either:
     *   - Lambda proxy path: the raw jsonb object { success, id, … }
     *   - PostgREST fallback: [{ "<fnName>": { success, id, … } }]
     * Returns the inner object in both cases.
     */
    function unwrapRpcResult(raw, fnName) {
        if (Array.isArray(raw) && raw.length > 0) {
            return (fnName && raw[0][fnName] !== undefined) ? raw[0][fnName] : raw[0];
        }
        return raw;
    }

    /** Maximum upload size — matches API Gateway REST payload limit in common.js */
    var MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
    var MAX_UPLOAD_MB = 6;

    function uploadSizeErrorMessage(bytes) {
        return 'File too large (' + (bytes / (1024 * 1024)).toFixed(1) + ' MB). Maximum upload size is ' + MAX_UPLOAD_MB + ' MB.';
    }

    /** Return a FontAwesome class appropriate for a filename extension. */
    function fileIconClass(filename) {
        var ext = (filename || '').split('.').pop().toLowerCase();
        var map = {
            pdf: 'fa-file-pdf', doc: 'fa-file-word', docx: 'fa-file-word',
            xls: 'fa-file-excel', xlsx: 'fa-file-excel',
            csv: 'fa-file-csv', txt: 'fa-file-alt',
            png: 'fa-file-image', jpg: 'fa-file-image', jpeg: 'fa-file-image'
        };
        return 'fas ' + (map[ext] || 'fa-file');
    }

    // ── Module ─────────────────────────────────────────────────────────────────

    return {
        // All documents fetched from the server
        allDocuments: [],
        // All categories (flat list from DB) — used to build folder hierarchy
        allCategories: [],
        // Explorer navigation state
        currentFolderId: null,       // null = Home (root)
        folderPath: [],              // [{ id, name }, …]
        docSearchQuery: '',
        // Context menu / upload targeting
        contextMenuFolderId: undefined,  // folder targeted by right-click
        uploadTargetFolderId: undefined, // folder to use for upload (undefined → use currentFolderId)

        init: function () {
            var scope = _documentManagementGrid;
            scope.ensureModalsInBody();
            scope.initHandlers();
            scope.loadAll();
        },

        /** Move modals to document.body so Bootstrap aria-hidden does not hide focused modal controls. */
        ensureModalsInBody: function () {
            ['uploadDocumentModal'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el && el.parentNode && el.parentNode !== document.body) {
                    document.body.appendChild(el);
                }
            });
        },

        // ── Handlers ──────────────────────────────────────────────────────────

        initHandlers: function () {
            var scope = _documentManagementGrid;

            $('#uploadDocBtn').on('click', function () { scope.openUploadModal(undefined, false); });
            $('#newFolderBtn').on('click', function () { scope.promptCreateFolder(scope.currentFolderId); });

            $('#docUploadFile').on('change', function () { scope.onFilesSelected(this.files); });
            $('#docUploadFolderBtn').on('click', function () { scope.openFolderPicker(); });
            $('#docUploadFolder').on('change', function () { scope.onFilesSelected(this.files); });
            $('#docUploadSubmitBtn').on('click', function () { scope.submitUpload(); });

            $('#uploadDocumentModal').on('hidden.bs.modal', function () {
                $('#docUploadName').val('');
                $('#docUploadFile').val('');
                $('#docUploadFolder').val('');
                $('#docUploadStatus').text('');
                $('#docUploadFileList').empty();
                $('#docUploadNameWrap').show();
                $('#docUploadSubmitBtn').text('Upload');
                scope.uploadTargetFolderId = undefined;
            });

            $('#docBackBtn').on('click', function () { scope.navigateUp(); });

            $('#docSearchInput').on('input', function () {
                scope.docSearchQuery = ($(this).val() || '').trim().toLowerCase();
                $('#docSearchClear').toggle(scope.docSearchQuery.length > 0);
                scope.renderExplorer();
            });
            $('#docSearchClear').on('click', function () {
                $('#docSearchInput').val('');
                scope.docSearchQuery = '';
                $(this).hide();
                scope.renderExplorer();
            });

            // Folder row click (delegated)
            $(document).on('click', '[data-folder-navigate]', function (e) {
                e.preventDefault();
                var id = $(this).data('folder-navigate');
                scope.navigateToFolder(id);
            });

            // Document action buttons (delegated)
            $(document).on('click', '[data-document-action][data-document-id]', function (e) {
                e.preventDefault();
                var action = $(this).data('document-action');
                var docId = $(this).data('document-id');
                if (action === 'view') scope.viewDocument(docId);
                else if (action === 'download') scope.downloadDocument(docId);
                else if (action === 'delete') scope.deleteDocument(docId);
            });

            // Folder delete button (delegated)
            $(document).on('click', '[data-folder-delete]', function (e) {
                e.preventDefault();
                var id = $(this).data('folder-delete');
                if (id) scope.deleteFolder(id);
            });

            // ── Context menu ──────────────────────────────────────────────────

            // Right-click on clickable breadcrumb links (ancestors)
            $(document).on('contextmenu', '#docExplorerBreadcrumb a[data-breadcrumb-index]', function (e) {
                e.preventDefault();
                var idx = parseInt($(this).data('breadcrumb-index'), 10);
                var fid = idx < 0 ? null : scope.folderPath[idx].id;
                scope.showContextMenu(e.clientX, e.clientY, fid);
            });
            // Right-click on the active (current) breadcrumb item
            $(document).on('contextmenu', '#docExplorerBreadcrumb .breadcrumb-item.active', function (e) {
                e.preventDefault();
                scope.showContextMenu(e.clientX, e.clientY, scope.currentFolderId);
            });
            // Right-click anywhere on the explorer table (folder row or background)
            $(document).on('contextmenu', '#documentsTable', function (e) {
                e.preventDefault();
                var folderLink = $(e.target).closest('[data-folder-navigate]');
                var fid = folderLink.length
                    ? folderLink.data('folder-navigate')
                    : scope.currentFolderId;
                scope.showContextMenu(e.clientX, e.clientY, fid);
            });

            // Context menu item clicks
            $(document).on('click', '#docContextMenu [data-ctx-action]', function (e) {
                e.stopPropagation();
                var action = $(this).data('ctx-action');
                var targetId = scope.contextMenuFolderId;
                scope.hideContextMenu();
                if (action === 'new-folder') {
                    scope.promptCreateFolder(targetId);
                    return;
                }
                scope.openUploadModal(targetId, action === 'upload-folder');
            });

            // Dismiss context menu on any outside click or scroll
            $(document).on('click.docCtxMenu', function () { scope.hideContextMenu(); });
            $(document).on('scroll.docCtxMenu', function () { scope.hideContextMenu(); });
        },

        // ── Data loading ──────────────────────────────────────────────────────

        loadAll: function () {
            var scope = _documentManagementGrid;
            var catPromise = (typeof dataFunctions !== 'undefined' && dataFunctions.getDocumentCategories)
                ? dataFunctions.getDocumentCategories()
                : Promise.resolve([]);
            var docPromise = (typeof dataFunctions !== 'undefined' && dataFunctions.getDocuments)
                ? dataFunctions.getDocuments(null, true)
                : Promise.resolve([]);
            Promise.all([catPromise, docPromise]).then(function (results) {
                scope.allCategories = Array.isArray(results[0]) ? results[0] : [];
                scope.allDocuments = Array.isArray(results[1]) ? results[1] : [];
                scope.renderExplorer();
            }).catch(function () {
                scope.allCategories = [];
                scope.allDocuments = [];
                scope.renderExplorer();
            });
        },

        // ── Navigation ────────────────────────────────────────────────────────

        navigateToFolder: function (folderId) {
            var scope = _documentManagementGrid;
            var cat = scope.allCategories.find(function (c) { return c.id === folderId; });
            if (!cat) return;
            scope.folderPath.push({ id: folderId, name: cat.name });
            scope.currentFolderId = folderId;
            scope.renderBreadcrumb();
            scope.renderExplorer();
        },

        navigateUp: function () {
            var scope = _documentManagementGrid;
            if (scope.folderPath.length === 0) return;
            scope.folderPath.pop();
            scope.currentFolderId = scope.folderPath.length
                ? scope.folderPath[scope.folderPath.length - 1].id
                : null;
            scope.renderBreadcrumb();
            scope.renderExplorer();
        },

        navigateToBreadcrumb: function (index) {
            var scope = _documentManagementGrid;
            if (index < 0) {
                scope.folderPath = [];
                scope.currentFolderId = null;
            } else {
                scope.folderPath = scope.folderPath.slice(0, index + 1);
                scope.currentFolderId = scope.folderPath[scope.folderPath.length - 1].id;
            }
            scope.renderBreadcrumb();
            scope.renderExplorer();
        },

        renderBreadcrumb: function () {
            var scope = _documentManagementGrid;
            var crumb = document.getElementById('docExplorerBreadcrumb');
            var backBtn = document.getElementById('docBackBtn');
            if (!crumb) return;
            var items = '<li class="breadcrumb-item"><a href="#" data-breadcrumb-index="-1">Home</a></li>';
            scope.folderPath.forEach(function (f, i) {
                var isLast = i === scope.folderPath.length - 1;
                if (isLast) {
                    items += '<li class="breadcrumb-item active">' + escapeHtml(f.name) + '</li>';
                } else {
                    items += '<li class="breadcrumb-item"><a href="#" data-breadcrumb-index="' + i + '">' + escapeHtml(f.name) + '</a></li>';
                }
            });
            if (scope.folderPath.length === 0) {
                items = '<li class="breadcrumb-item active">Home</li>';
            }
            crumb.innerHTML = items;
            $(crumb).find('[data-breadcrumb-index]').on('click', function (e) {
                e.preventDefault();
                scope.navigateToBreadcrumb(parseInt($(this).data('breadcrumb-index'), 10));
            });
            if (backBtn) backBtn.disabled = scope.folderPath.length === 0;
        },

        // ── Rendering ────────────────────────────────────────────────────────

        renderExplorer: function () {
            var scope = _documentManagementGrid;
            var tbody = $('#documentsTableBody');
            tbody.empty();

            var q = scope.docSearchQuery;
            if (q) {
                scope.renderSearchResults(q);
                return;
            }

            // Folders whose parent matches currentFolderId
            var childFolders = scope.allCategories.filter(function (c) {
                return scope.currentFolderId === null
                    ? (c.parent_id == null)
                    : (c.parent_id === scope.currentFolderId);
            });

            // Documents in this folder
            var childDocs = scope.allDocuments.filter(function (d) {
                return scope.currentFolderId === null
                    ? (d.category_id == null)
                    : (d.category_id === scope.currentFolderId);
            });

            if (childFolders.length === 0 && childDocs.length === 0) {
                var emptyMsg = scope.currentFolderId
                    ? 'This folder is empty. Use New folder or Upload to add content here.'
                    : 'No documents yet. Use New folder or Upload to get started.';
                tbody.html('<tr><td colspan="5" class="text-center text-muted py-5">' +
                    '<i class="fas fa-folder-open me-2"></i>' + escapeHtml(emptyMsg) + '</td></tr>');
                return;
            }

            // Render folders first
            childFolders.forEach(function (cat) {
                var folderCount = scope.allCategories.filter(function (c) { return c.parent_id === cat.id; }).length;
                var fileCount = scope.allDocuments.filter(function (d) { return d.category_id === cat.id; }).length;
                var hint = [];
                if (folderCount) hint.push(folderCount + ' folder' + (folderCount !== 1 ? 's' : ''));
                if (fileCount) hint.push(fileCount + ' file' + (fileCount !== 1 ? 's' : ''));
                var hintStr = hint.length ? ' <span class="text-muted fw-normal small">(' + escapeHtml(hint.join(', ')) + ')</span>' : '';
                var dateStr = cat.created_at ? cat.created_at.slice(0, 10) : '—';
                var row = '<tr class="doc-folder-row">' +
                    '<td><a class="doc-folder-name" href="#" data-folder-navigate="' + escapeHtml(cat.id) + '">' +
                        '<i class="fas fa-folder doc-folder-icon"></i>' + escapeHtml(cat.name) + '</a>' + hintStr + '</td>' +
                    '<td><span class="badge bg-warning text-dark">Folder</span></td>' +
                    '<td>—</td>' +
                    '<td>' + escapeHtml(dateStr) + '</td>' +
                    '<td class="mac-table-actions-col">' + MacTableActions.render({
                        id: 'docFolderActions' + cat.id,
                        items: [{ label: 'Delete', danger: true, icon: 'fas fa-trash', attrs: { 'data-folder-delete': cat.id } }]
                    }) + '</td>' +
                    '</tr>';
                tbody.append(row);
            });

            // Render files
            childDocs.forEach(function (doc) {
                var dateStr = doc.created_at ? (doc.created_at.slice(0, 10) + ' ' + (doc.created_at.slice(11, 16) || '')).trim() : 'N/A';
                var row = '<tr>' +
                    '<td><span class="d-inline-flex align-items-center gap-2">' +
                        '<i class="' + escapeHtml(fileIconClass(doc.file_name)) + ' doc-file-icon"></i>' +
                        escapeHtml(doc.document_name || doc.file_name || 'N/A') +
                    '</span></td>' +
                    '<td><span class="badge bg-secondary">File</span></td>' +
                    '<td>' + escapeHtml(doc.uploaded_by_name || 'N/A') + '</td>' +
                    '<td>' + escapeHtml(dateStr) + '</td>' +
                    '<td class="mac-table-actions-col">' + MacTableActions.render({
                        id: 'docFileActions' + doc.id,
                        items: [
                            { label: 'View', icon: 'fas fa-eye', attrs: { 'data-document-action': 'view', 'data-document-id': doc.id } },
                            { label: 'Download', icon: 'fas fa-download', attrs: { 'data-document-action': 'download', 'data-document-id': doc.id } },
                            { label: 'Delete', danger: true, icon: 'fas fa-trash', attrs: { 'data-document-action': 'delete', 'data-document-id': doc.id } }
                        ]
                    }) + '</td></tr>';
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('documentsTable'));
        },

        renderSearchResults: function (q) {
            var scope = _documentManagementGrid;
            var tbody = $('#documentsTableBody');
            tbody.empty();

            var lq = q.toLowerCase();
            var matchDocs = scope.allDocuments.filter(function (d) {
                return (d.document_name || '').toLowerCase().indexOf(lq) !== -1 ||
                       (d.file_name || '').toLowerCase().indexOf(lq) !== -1 ||
                       (d.folder_path || '').toLowerCase().indexOf(lq) !== -1;
            });
            var matchFolders = scope.allCategories.filter(function (c) {
                return (c.name || '').toLowerCase().indexOf(lq) !== -1;
            });

            if (matchFolders.length === 0 && matchDocs.length === 0) {
                tbody.html('<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-search me-2"></i>No results for &ldquo;' + escapeHtml(q) + '&rdquo;</td></tr>');
                return;
            }

            matchFolders.forEach(function (cat) {
                var row = '<tr class="doc-folder-row">' +
                    '<td><a class="doc-folder-name" href="#" data-folder-navigate="' + escapeHtml(cat.id) + '">' +
                        '<i class="fas fa-folder doc-folder-icon"></i>' + escapeHtml(cat.name) + '</a></td>' +
                    '<td><span class="badge bg-warning text-dark">Folder</span></td>' +
                    '<td>—</td>' +
                    '<td>' + escapeHtml(cat.created_at ? cat.created_at.slice(0, 10) : '—') + '</td>' +
                    '<td class="mac-table-actions-col">' + MacTableActions.render({
                        id: 'docFolderActions' + cat.id,
                        items: [{ label: 'Delete', danger: true, icon: 'fas fa-trash', attrs: { 'data-folder-delete': cat.id } }]
                    }) + '</td>' +
                    '</tr>';
                tbody.append(row);
            });

            matchDocs.forEach(function (doc) {
                var dateStr = doc.created_at ? doc.created_at.slice(0, 10) : 'N/A';
                var pathHtml = doc.folder_path
                    ? '<div class="doc-folder-path"><i class="fas fa-folder me-1"></i>' + escapeHtml(doc.folder_path) + '</div>'
                    : '';
                var row = '<tr>' +
                    '<td><span class="d-inline-flex align-items-start gap-2">' +
                        '<i class="' + escapeHtml(fileIconClass(doc.file_name)) + ' doc-file-icon mt-1"></i>' +
                        '<span>' + escapeHtml(doc.document_name || doc.file_name || 'N/A') + pathHtml + '</span>' +
                    '</span></td>' +
                    '<td><span class="badge bg-secondary">File</span></td>' +
                    '<td>' + escapeHtml(doc.uploaded_by_name || 'N/A') + '</td>' +
                    '<td>' + escapeHtml(dateStr) + '</td>' +
                    '<td class="mac-table-actions-col">' + MacTableActions.render({
                        id: 'docFileActions' + doc.id,
                        items: [
                            { label: 'View', icon: 'fas fa-eye', attrs: { 'data-document-action': 'view', 'data-document-id': doc.id } },
                            { label: 'Download', icon: 'fas fa-download', attrs: { 'data-document-action': 'download', 'data-document-id': doc.id } },
                            { label: 'Delete', danger: true, icon: 'fas fa-trash', attrs: { 'data-document-action': 'delete', 'data-document-id': doc.id } }
                        ]
                    }) + '</td></tr>';
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('documentsTable'));
        },

        // ── Upload modal helpers ──────────────────────────────────────────────

        /**
         * Open the upload modal.
         * @param {string|null} [targetFolderId] – Override the upload destination.
         *        undefined = use currentFolderId (normal toolbar button).
         *        null      = upload to Home (root).
         *        string    = upload to that specific folder id.
         * @param {boolean} [autoOpenFolder] – Immediately open the folder picker after the modal appears.
         */
        openUploadModal: function (targetFolderId, autoOpenFolder) {
            var scope = _documentManagementGrid;
            // Store the upload target (may differ from where we're currently browsing)
            scope.uploadTargetFolderId = (targetFolderId !== undefined) ? targetFolderId : scope.currentFolderId;
            var locationLabel = scope.folderIdToLabel(scope.uploadTargetFolderId);
            $('#docUploadLocationLabel').text(locationLabel);

            var modal = document.getElementById('uploadDocumentModal');
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal && modal) {
                var bsModal = bootstrap.Modal.getOrCreateInstance(modal);
                bsModal.show();
                if (autoOpenFolder) {
                    modal.addEventListener('shown.bs.modal', function handler() {
                        modal.removeEventListener('shown.bs.modal', handler);
                        scope.openFolderPicker();
                    });
                }
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#uploadDocumentModal').modal('show');
                if (autoOpenFolder) {
                    $('#uploadDocumentModal').one('shown.bs.modal', function () {
                        scope.openFolderPicker();
                    });
                }
            }
        },

        /** Close the upload modal (if open), then run a callback — avoids aria-hidden vs SweetAlert focus conflict. */
        afterUploadModalClosed: function (callback) {
            var modal = document.getElementById('uploadDocumentModal');
            if (!modal || typeof callback !== 'function') {
                if (typeof callback === 'function') callback();
                return;
            }
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal && modal.classList.contains('show')) {
                var inst = bootstrap.Modal.getInstance(modal);
                if (inst) {
                    modal.addEventListener('hidden.bs.modal', function handler() {
                        modal.removeEventListener('hidden.bs.modal', handler);
                        callback();
                    });
                    inst.hide();
                    return;
                }
            }
            if (typeof $ !== 'undefined' && $(modal).hasClass('show')) {
                $(modal).one('hidden.bs.modal', callback).modal('hide');
                return;
            }
            callback();
        },

        openFolderPicker: function () {
            var el = document.getElementById('docUploadFolder');
            if (el) el.click();
        },

        // ── Context menu ──────────────────────────────────────────────────────

        showContextMenu: function (x, y, folderId) {
            var scope = _documentManagementGrid;
            scope.contextMenuFolderId = folderId;
            var menu = document.getElementById('docContextMenu');
            var label = document.getElementById('docContextMenuLabel');
            if (!menu) return;
            var locationName = scope.folderIdToLabel(folderId);
            if (label) label.textContent = locationName;
            // Position menu, keeping it within viewport
            menu.style.display = 'block';
            var menuW = menu.offsetWidth || 210;
            var menuH = menu.offsetHeight || 100;
            var left = Math.min(x, window.innerWidth - menuW - 8);
            var top = Math.min(y, window.innerHeight - menuH - 8);
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
        },

        hideContextMenu: function () {
            var menu = document.getElementById('docContextMenu');
            if (menu) menu.style.display = 'none';
        },

        /**
         * Build a display path string for a folder id, e.g. "Safety Docs / 2025".
         * Returns "Home" for null/undefined.
         */
        folderIdToLabel: function (folderId) {
            var scope = _documentManagementGrid;
            if (folderId == null) return 'Home';
            var segments = [];
            var current = folderId;
            var safety = 0;
            while (current && safety++ < 20) {
                var cat = scope.allCategories.find(function (c) { return c.id === current; });
                if (!cat) break;
                segments.unshift(cat.name);
                current = cat.parent_id || null;
            }
            return segments.length ? segments.join(' / ') : 'Home';
        },

        onFilesSelected: function (fileList) {
            var files = fileList ? Array.from(fileList) : [];
            var submitBtn = document.getElementById('docUploadSubmitBtn');
            var nameWrap = document.getElementById('docUploadNameWrap');
            var nameInput = document.getElementById('docUploadName');
            var listEl = document.getElementById('docUploadFileList');

            var hasPaths = files.length > 0 && files[0].webkitRelativePath;
            var oversized = files.filter(function (f) { return f.size > MAX_UPLOAD_BYTES; });

            function fileSizeWarning(f) {
                return f.size > MAX_UPLOAD_BYTES
                    ? ' <span class="badge bg-danger ms-1" title="Exceeds 6 MB limit">Too large</span>'
                    : '';
            }

            if (hasPaths) {
                // Folder upload — render mini tree preview
                var tree = _documentManagementGrid.buildFolderTreeFromPaths(files);
                if (listEl) listEl.innerHTML = _documentManagementGrid.renderTreePreview(tree);
                if (nameWrap) nameWrap.style.display = 'none';
                var label = 'Upload folder (' + files.length + ' file' + (files.length !== 1 ? 's' : '') + ')';
                if (oversized.length) label += ' \u2014 ' + oversized.length + ' too large';
                if (submitBtn) submitBtn.textContent = label;
            } else if (files.length === 1) {
                if (listEl) listEl.innerHTML =
                    '<div class="d-flex justify-content-between px-1 py-1">' +
                    '<span><i class="' + fileIconClass(files[0].name) + ' me-2"></i>' + escapeHtml(files[0].name) +
                    fileSizeWarning(files[0]) + '</span>' +
                    '<span class="text-muted">' + escapeHtml(formatFileSize(files[0].size)) + '</span></div>';
                if (nameWrap) nameWrap.style.display = '';
                if (nameInput && !nameInput.value.trim()) {
                    nameInput.value = filenameWithoutExtension(files[0].name);
                }
                if (submitBtn) submitBtn.textContent = 'Upload';
            } else if (files.length > 1) {
                if (listEl) listEl.innerHTML = files.map(function (f) {
                    return '<div class="d-flex justify-content-between px-1 py-1 border-bottom">' +
                        '<span class="text-truncate me-2" title="' + escapeHtml(f.name) + '"><i class="' +
                        fileIconClass(f.name) + ' me-2"></i>' + escapeHtml(f.name) + fileSizeWarning(f) + '</span>' +
                        '<span class="text-muted text-nowrap">' + escapeHtml(formatFileSize(f.size)) + '</span></div>';
                }).join('');
                if (nameWrap) nameWrap.style.display = 'none';
                var multiLabel = 'Upload ' + files.length + ' files';
                if (oversized.length) multiLabel += ' \u2014 ' + oversized.length + ' too large';
                if (submitBtn) submitBtn.textContent = multiLabel;
            } else {
                if (listEl) listEl.innerHTML = '';
                if (nameWrap) nameWrap.style.display = '';
                if (submitBtn) submitBtn.textContent = 'Upload';
            }
        },

        /**
         * Parse FileList with webkitRelativePath into a nested tree structure.
         * Returns { name, children: {}, files: [] } for each folder node.
         */
        buildFolderTreeFromPaths: function (files) {
            var root = { name: '', children: {}, files: [] };
            files.forEach(function (file) {
                var parts = file.webkitRelativePath.split('/');
                var node = root;
                // All but last segment are folder names
                for (var i = 0; i < parts.length - 1; i++) {
                    var seg = parts[i];
                    if (!node.children[seg]) {
                        node.children[seg] = { name: seg, children: {}, files: [] };
                    }
                    node = node.children[seg];
                }
                node.files.push(file);
            });
            return root;
        },

        /** Render the folder tree as an HTML string for the upload preview. */
        renderTreePreview: function (node, depth) {
            depth = depth || 0;
            var html = '';
            var childKeys = Object.keys(node.children);
            childKeys.forEach(function (key) {
                var child = node.children[key];
                var indent = 'padding-left:' + (depth * 16 + 8) + 'px';
                var subCount = child.files.length + Object.keys(child.children).length;
                html += '<div class="py-1 border-bottom" style="' + indent + '">' +
                    '<span class="tree-folder"><i class="fas fa-folder doc-folder-icon me-1"></i>' +
                    escapeHtml(child.name) + ' <span class="text-muted fw-normal small">(' + subCount + ')</span></span></div>';
                html += _documentManagementGrid.renderTreePreview(child, depth + 1);
            });
            node.files.forEach(function (f) {
                var indent = 'padding-left:' + (depth * 16 + 8) + 'px';
                html += '<div class="d-flex justify-content-between py-1 border-bottom" style="' + indent + '">' +
                    '<span class="text-truncate me-2"><i class="' + fileIconClass(f.name) + ' me-1 doc-file-icon"></i>' + escapeHtml(f.name) + '</span>' +
                    '<span class="text-muted text-nowrap file-size">' + escapeHtml(formatFileSize(f.size)) + '</span></div>';
            });
            return html;
        },

        // ── Upload logic ──────────────────────────────────────────────────────

        submitUpload: async function () {
            var scope = _documentManagementGrid;
            var statusEl = document.getElementById('docUploadStatus');
            var btn = document.getElementById('docUploadSubmitBtn');

            // Use the target set by openUploadModal (may differ from currentFolderId via right-click)
            var effectiveFolderId = scope.uploadTargetFolderId !== undefined
                ? scope.uploadTargetFolderId
                : scope.currentFolderId;

            var fileInput = document.getElementById('docUploadFile');
            var folderInput = document.getElementById('docUploadFolder');
            var fileFiles = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
            var folderFiles = folderInput && folderInput.files ? Array.from(folderInput.files) : [];
            var files = fileFiles.length ? fileFiles : folderFiles;
            var isFolderUpload = folderFiles.length > 0 && folderFiles[0].webkitRelativePath;

            if (files.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please select at least one file to upload.', 'warning');
                return;
            }

            var singleName = '';
            if (!isFolderUpload && files.length === 1) {
                singleName = ($('#docUploadName').val() || '').trim();
                if (!singleName) {
                    if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please enter a document name.', 'warning');
                    return;
                }
            }

            if (btn) btn.disabled = true;
            var resourceFolder = 'Macavation/Documents';
            var userId = getCurrentUserId();
            var succeeded = 0;
            var failed = [];

            if (isFolderUpload) {
                // Folder upload: resolve folder chain for each file, save to leaf folder
                var folderIdCache = {};
                for (var i = 0; i < files.length; i++) {
                    var file = files[i];
                    var parts = file.webkitRelativePath.split('/');
                    var folderSegments = parts.slice(0, -1);

                    if (statusEl) statusEl.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + ' \u2014 ' + file.name;

                    try {
                        var leafFolderId = await scope.ensureFolderChain(folderSegments, effectiveFolderId, folderIdCache);
                        var result = await scope.uploadOneFile(file, leafFolderId, null, resourceFolder, userId);
                        if (result.ok) succeeded++;
                        else failed.push({ name: file.name, error: result.error });
                    } catch (e) {
                        failed.push({ name: file.name, error: e && e.message ? e.message : 'Unknown error' });
                    }
                }
            } else {
                // Regular file/multi-file upload into effective folder
                for (var j = 0; j < files.length; j++) {
                    var f = files[j];
                    var docName = files.length === 1 ? singleName : filenameWithoutExtension(f.name);
                    if (statusEl) statusEl.textContent = 'Uploading ' + (j + 1) + ' of ' + files.length + ' \u2014 ' + f.name;
                    try {
                        var res = await scope.uploadOneFile(f, effectiveFolderId, docName, resourceFolder, userId);
                        if (res.ok) succeeded++;
                        else failed.push({ name: f.name, error: res.error });
                    } catch (e) {
                        failed.push({ name: f.name, error: e && e.message ? e.message : 'Unknown error' });
                    }
                }
            }

            if (statusEl) statusEl.textContent = '';
            if (btn) btn.disabled = false;

            // Reload both categories and documents so new folders appear
            var catList = (typeof dataFunctions !== 'undefined' && dataFunctions.getDocumentCategories)
                ? await dataFunctions.getDocumentCategories().catch(function () { return []; })
                : [];
            var docList = (typeof dataFunctions !== 'undefined' && dataFunctions.getDocuments)
                ? await dataFunctions.getDocuments(null, true).catch(function () { return []; })
                : [];
            scope.allCategories = Array.isArray(catList) ? catList : [];
            scope.allDocuments = Array.isArray(docList) ? docList : [];
            scope.renderExplorer();

            if (failed.length === 0) {
                var title = succeeded === 1 ? 'Document uploaded' : succeeded + ' documents uploaded';
                scope.afterUploadModalClosed(function () {
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'success', title: title, timer: 2000, showConfirmButton: false });
                    }
                });
            } else {
                var failList = failed.map(function (x) { return '\u2022 ' + x.name + ': ' + x.error; }).join('\n');
                var summaryTitle = succeeded > 0
                    ? succeeded + ' uploaded, ' + failed.length + ' failed'
                    : failed.length + ' file(s) failed to upload';
                scope.afterUploadModalClosed(function () {
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'warning', title: summaryTitle, text: failList, confirmButtonText: 'OK' });
                    }
                });
            }
        },

        /**
         * Ensure every folder in segments[] exists (creating if needed) and
         * return the leaf folder's id. Uses folderIdCache to avoid duplicate calls
         * within the same upload batch.
         */
        ensureFolderChain: async function (segments, rootParentId, folderIdCache) {
            var parentId = rootParentId || null;
            for (var i = 0; i < segments.length; i++) {
                // Cache key encodes full path from root so same-named folders at different levels are distinct
                var cacheKey = JSON.stringify(parentId) + '::' + segments[i];
                if (folderIdCache[cacheKey] !== undefined) {
                    parentId = folderIdCache[cacheKey];
                    continue;
                }
                var rawResult = (typeof dataFunctions !== 'undefined' && dataFunctions.getOrCreateDocumentCategory)
                    ? await dataFunctions.getOrCreateDocumentCategory(segments[i], parentId)
                    : null;
                var result = unwrapRpcResult(rawResult, 'get_or_create_document_category');
                if (!result || !result.success) {
                    throw new Error('Could not create folder "' + segments[i] + '": ' + (result && result.error || 'unknown'));
                }
                parentId = result.id;
                folderIdCache[cacheKey] = parentId;
            }
            return parentId;
        },

        /** Upload a single file to S3 and save a document record. */
        uploadOneFile: async function (file, categoryId, documentName, resourceFolder, userId) {
            if (file.size > MAX_UPLOAD_BYTES) {
                return { ok: false, error: uploadSizeErrorMessage(file.size) };
            }

            var docName = documentName || filenameWithoutExtension(file.name);
            // Include random suffix so rapid sequential uploads never share the same S3 key
            var safeName = (file.name || 'file').replace(/[^\w.-]/g, '_');
            var fileId = 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + safeName;

            var uploadResult = (typeof _common !== 'undefined' && _common.uploadFile)
                ? await _common.uploadFile({ file: file, resourceFolder: resourceFolder, fileId: fileId })
                : { Success: false, LastErrorDescription: 'Upload not available' };

            if (!uploadResult || !uploadResult.Success) {
                return { ok: false, error: (uploadResult && uploadResult.LastErrorDescription) || 'Upload failed' };
            }

            var data = uploadResult.Data;
            var fileIdStored = (data && data[0] && (data[0].fileId || data[0].key)) || (data && data.fileId) || fileId;
            var fileLink = (data && data[0] && data[0].fileLink) || (data && data.fileLink) || null;

            if (typeof dataFunctions === 'undefined' || !dataFunctions.createDocument) {
                return { ok: false, error: 'Save document not available' };
            }

            var rawCreate = await dataFunctions.createDocument({
                document_name: docName,
                category_id: categoryId,
                file_name: file.name,
                file_id: fileIdStored,
                file_link: fileLink,
                uploaded_by: userId
            });
            var createResult = unwrapRpcResult(rawCreate, 'create_document_simple');

            if (createResult && (createResult.success === true || createResult.id)) {
                return { ok: true };
            }
            return { ok: false, error: (createResult && createResult.error) || 'Failed to save record' };
        },

        // ── Document actions ──────────────────────────────────────────────────

        viewDocument: function (docId) {
            var scope = _documentManagementGrid;
            var doc = scope.allDocuments.find(function (d) { return d.id === docId; });
            if (doc && doc.file_link) {
                window.open(doc.file_link, '_blank');
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'View link not available for this document.', 'info');
            }
        },

        downloadDocument: function (docId) {
            var scope = _documentManagementGrid;
            var doc = scope.allDocuments.find(function (d) { return d.id === docId; });
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
                    scope.allDocuments = scope.allDocuments.filter(function (d) { return d.id !== docId; });
                    scope.renderExplorer();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Document deleted', timer: 1500, showConfirmButton: false });
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Delete failed', 'error');
                }
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Delete failed', 'error');
            });
        },

        // ── Folder actions ────────────────────────────────────────────────────

        promptCreateFolder: function (parentFolderId) {
            var scope = _documentManagementGrid;
            var locationLabel = scope.folderIdToLabel(parentFolderId);
            if (typeof Swal === 'undefined') {
                var name = window.prompt('New folder name (in ' + locationLabel + '):');
                if (name && name.trim()) scope.doCreateFolder(name.trim(), parentFolderId);
                return;
            }
            Swal.fire({
                title: 'New folder',
                html: 'Create inside <strong>' + escapeHtml(locationLabel) + '</strong>',
                input: 'text',
                inputPlaceholder: 'Folder name',
                inputAttributes: { maxlength: 200 },
                showCancelButton: true,
                confirmButtonText: 'Create',
                inputValidator: function (value) {
                    if (!value || !value.trim()) return 'Enter a folder name';
                }
            }).then(function (res) {
                if (res.isConfirmed && res.value) {
                    scope.doCreateFolder(res.value.trim(), parentFolderId);
                }
            });
        },

        doCreateFolder: function (name, parentFolderId) {
            var scope = _documentManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createDocumentCategory) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create folder not available', 'error');
                return;
            }
            var parentId = parentFolderId || null;
            var dup = scope.allCategories.some(function (c) {
                return (c.name || '').toLowerCase() === name.toLowerCase() &&
                    ((parentId == null && c.parent_id == null) || c.parent_id === parentId);
            });
            if (dup) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'A folder with this name already exists at this location.', 'warning');
                return;
            }
            dataFunctions.createDocumentCategory({
                name: name,
                parent_id: parentId
            }).then(function (raw) {
                var result = unwrapRpcResult(raw, 'create_document_category_simple');
                if (!result || result.success === false || !result.id) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Could not create folder', 'error');
                    return;
                }
                return dataFunctions.getDocumentCategories().then(function (cats) {
                    scope.allCategories = Array.isArray(cats) ? cats : [];
                    if (scope.docSearchQuery) {
                        scope.docSearchQuery = '';
                        $('#docSearchInput').val('');
                        $('#docSearchClear').hide();
                    }
                    scope.renderExplorer();
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'success', title: 'Folder created', timer: 1500, showConfirmButton: false });
                    }
                });
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Could not create folder', 'error');
            });
        },

        deleteFolder: function (folderId) {
            var scope = _documentManagementGrid;
            var cat = scope.allCategories.find(function (c) { return c.id === folderId; });
            var name = cat ? cat.name : 'this folder';
            var hasChildren = scope.allCategories.some(function (c) { return c.parent_id === folderId; }) ||
                              scope.allDocuments.some(function (d) { return d.category_id === folderId; });
            var msg = hasChildren
                ? 'Delete "' + name + '" and everything inside it? This cannot be undone.'
                : 'Delete folder "' + name + '"? This cannot be undone.';
            if (typeof Swal === 'undefined') {
                if (confirm(msg)) scope.doDeleteFolder(folderId);
                return;
            }
            Swal.fire({
                title: 'Delete folder?',
                text: msg,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#dc3545',
                confirmButtonText: 'Yes, delete'
            }).then(function (res) {
                if (res.isConfirmed) scope.doDeleteFolder(folderId);
            });
        },

        doDeleteFolder: function (folderId) {
            var scope = _documentManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.deleteDocumentFolderRecursive) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Delete folder not available', 'error');
                return;
            }
            dataFunctions.deleteDocumentFolderRecursive(folderId).then(function (result) {
                if (result && result.success !== false) {
                    // Remove deleted folder and all its descendants from local state
                    var removedIds = scope.collectDescendantIds(folderId);
                    removedIds.push(folderId);
                    scope.allCategories = scope.allCategories.filter(function (c) { return removedIds.indexOf(c.id) === -1; });
                    scope.allDocuments = scope.allDocuments.filter(function (d) { return removedIds.indexOf(d.category_id) === -1; });
                    var msg = (result.documents_deleted || 0) > 0
                        ? 'Folder deleted (' + result.documents_deleted + ' document' + (result.documents_deleted !== 1 ? 's' : '') + ' removed)'
                        : 'Folder deleted';
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: msg, timer: 2000, showConfirmButton: false });
                    scope.renderExplorer();
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Delete folder failed', 'error');
                }
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Delete folder failed', 'error');
            });
        },

        /** Return all descendant category ids for a given root folder id. */
        collectDescendantIds: function (folderId) {
            var scope = _documentManagementGrid;
            var result = [];
            var queue = [folderId];
            while (queue.length) {
                var current = queue.shift();
                var children = scope.allCategories.filter(function (c) { return c.parent_id === current; });
                children.forEach(function (c) {
                    result.push(c.id);
                    queue.push(c.id);
                });
            }
            return result;
        }
    };
})();

function initializeDocumentManagementGrid() {
    if (typeof _documentManagementGrid !== 'undefined') _documentManagementGrid.init();
}
