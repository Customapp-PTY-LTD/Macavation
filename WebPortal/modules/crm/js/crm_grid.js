/**
 * CRM Grid Module
 * Handles NIS Suppliers, Oil Processors, Oil Ingredient Suppliers, Oil & Protein Customers, Kernel Customers
 * Pattern: IIFE, single global _crmGrid, arrow methods, const scope for same-module calls.
 */
var _crmGrid = function () {
    'use strict';

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    return {
        contacts: [],
        nisSuppliers: [],
        oilProcessors: [],
        oilIngredientSuppliers: [],
        oilProteinCustomers: [],
        kernelCustomers: [],
        currentContactType: 'nis_supplier',
        searchTimeout: null,
        importData: null,
        importWorkbook: null,

        contactActionsCell: (contactId) => {
            return '<td class="mac-table-actions-col text-nowrap">' + MacTableActions.render({
                items: [
                    { label: 'WhatsApp', className: 'whatsapp-contact-btn', icon: 'fab fa-whatsapp', dataAttrs: { 'contact-id': contactId } },
                    { label: 'Edit', className: 'edit-contact-btn', icon: 'fas fa-edit', dataAttrs: { 'contact-id': contactId } },
                    { label: 'Delete', className: 'delete-contact-btn', danger: true, icon: 'fas fa-trash', dataAttrs: { 'contact-id': contactId } }
                ]
            }) + '</td>';
        },

        init: async () => {
            const scope = _crmGrid;
            console.log('[CRM] Initializing CRM Grid module...');
            var modalContainers = document.querySelectorAll('.modal[route-name]');
            var loadPromises = [];
            modalContainers.forEach(function (el) {
                var routeName = el.getAttribute('route-name');
                if (routeName && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + el.id }));
                }
            });
            if (loadPromises.length) await Promise.all(loadPromises);
            if (typeof _modal_crm_contact !== 'undefined' && _modal_crm_contact.init) _modal_crm_contact.init();
            scope.setupEventListeners();
            await scope.loadContacts();
            console.log('[CRM] CRM Grid module initialized');
        },

        setupEventListeners: () => {
            const scope = _crmGrid;

            // Tab switching
            $('button[data-bs-toggle="tab"]').on('shown.bs.tab', function (e) {
                const contactType = $(e.target).data('contact-type');
                scope.currentContactType = contactType;
                scope.loadContactsByType(contactType);
            });

            // Import button
            $('#importContactsBtn').on('click', function () {
                scope.showImportModal();
            });

            // Import file change
            $('#importExcelFile').on('change', function (e) {
                scope.handleFileSelect(e.target.files[0]);
            });

            // Process import
            $('#processImportBtn').on('click', function () {
                console.log('[CRM Import] *** IMPORT BUTTON CLICKED ***');
                scope.processImport();
            });
            
            // Also add native DOM listener as fallback
            const processBtn = document.getElementById('processImportBtn');
            if (processBtn) {
                processBtn.addEventListener('click', function() {
                    console.log('[CRM Import] *** IMPORT BUTTON CLICKED (native) ***');
                    scope.processImport();
                });
            }

            // Import all sheets toggle
            $('#importAllSheets').on('change', function () {
                const checked = $(this).is(':checked');
                // If importing all sheets, disable manual type selection
                $('#importContactType').prop('disabled', checked);
            });

            // NIS Suppliers filters
            $('#nisSearchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterNISSuppliers();
                }, 300);
            });
            $('#nisFilterProvince, #nisFilterStatus').on('change', function () {
                scope.filterNISSuppliers();
            });
            $('#nisClearFiltersBtn').on('click', function () {
                $('#nisSearchInput').val('');
                $('#nisFilterProvince').val('');
                $('#nisFilterStatus').val('');
                scope.filterNISSuppliers();
            });

            // Oil Processors filters
            $('#oilSearchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterOilProcessors();
                }, 300);
            });
            $('#oilFilterProvince').on('change', function () {
                scope.filterOilProcessors();
            });
            $('#oilClearFiltersBtn').on('click', function () {
                $('#oilSearchInput').val('');
                $('#oilFilterProvince').val('');
                scope.filterOilProcessors();
            });

            // Kernel Customers filters
            $('#customerSearchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterKernelCustomers();
                }, 300);
            });
            $('#customerFilterProvince').on('change', function () {
                scope.filterKernelCustomers();
            });
            $('#customerClearFiltersBtn').on('click', function () {
                $('#customerSearchInput').val('');
                $('#customerFilterProvince').val('');
                scope.filterKernelCustomers();
            });

            $('#oiSearchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => { scope.filterOilIngredientSuppliers(); }, 300);
            });
            $('#oiFilterProvince, #oiFilterStatus').on('change', function () { scope.filterOilIngredientSuppliers(); });
            $('#oiClearFiltersBtn').on('click', function () {
                $('#oiSearchInput').val('');
                $('#oiFilterProvince').val('');
                $('#oiFilterStatus').val('');
                scope.filterOilIngredientSuppliers();
            });

            $('#opcSearchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => { scope.filterOilProteinCustomers(); }, 300);
            });
            $('#opcFilterProvince').on('change', function () { scope.filterOilProteinCustomers(); });
            $('#opcClearFiltersBtn').on('click', function () {
                $('#opcSearchInput').val('');
                $('#opcFilterProvince').val('');
                scope.filterOilProteinCustomers();
            });

            // Add contact button
            $('#addContactBtn').on('click', function () {
                if (typeof _modal_crm_contact !== 'undefined' && _modal_crm_contact.show) _modal_crm_contact.show(null, scope.currentContactType);
            });

            // WhatsApp contact
            $(document).on('click', '.whatsapp-contact-btn', async function () {
                const contactId = $(this).data('contact-id');
                await scope.whatsappContact(contactId);
            });

            // Edit contact
            $(document).on('click', '.edit-contact-btn', function () {
                const contactId = $(this).data('contact-id');
                scope.editContact(contactId);
            });

            // Delete contact
            $(document).on('click', '.delete-contact-btn', function () {
                const contactId = $(this).data('contact-id');
                scope.deleteContact(contactId);
            });
        },

        loadContacts: async (forceRefresh = false) => {
            const scope = _crmGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) {
                    console.error('dataFunctions.getContacts not available');
                    return;
                }
                const startTime = performance.now();
                let contacts = [];

                try {
                    contacts = await dataFunctions.getContacts(null, forceRefresh);
                } catch (error) {
                    if (error.message && error.message.includes('token')) {
                        console.warn('Authentication required for contacts');
                        scope.contacts = [];
                        scope.separateContactsByType();
                        scope.renderCurrentTab();
                        return;
                    }
                    throw error;
                }

                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Contacts loaded in ${loadTime.toFixed(2)}ms`);

                scope.contacts = contacts || [];
                scope.separateContactsByType();
                scope.renderCurrentTab();
            } catch (error) {
                console.error('Error loading contacts:', error);
                scope.showError('Error loading contacts: ' + error.message);
            }
        },

        /** Numeric supplier code (0–99) for NIS list sort; missing/invalid codes sort last. */
        nisSupplierCodeSort: (contact) => {
            const sn = contact && contact.supplier_number;
            if (sn === null || sn === undefined || sn === '') return 1000;
            const n = typeof sn === 'number' ? sn : parseInt(String(sn), 10);
            return isNaN(n) ? 1000 : n;
        },

        nisSupplierCompare: (a, b) => {
            const scope = _crmGrid;
            const ca = scope.nisSupplierCodeSort(a);
            const cb = scope.nisSupplierCodeSort(b);
            if (ca !== cb) return ca - cb;
            const na = (a.company_name || '').toLowerCase();
            const nb = (b.company_name || '').toLowerCase();
            return na.localeCompare(nb, undefined, { sensitivity: 'base' });
        },

        separateContactsByType: () => {
            const scope = _crmGrid;
            scope.nisSuppliers = scope.contacts
                .filter(c => c.contact_type === 'nis_supplier')
                .sort((a, b) => scope.nisSupplierCompare(a, b));
            scope.oilProcessors = scope.contacts.filter(c => c.contact_type === 'oil_processor');
            scope.oilIngredientSuppliers = scope.contacts.filter(c => c.contact_type === 'oil_ingredient_supplier');
            scope.oilProteinCustomers = scope.contacts.filter(c => c.contact_type === 'oil_protein_customer');
            scope.kernelCustomers = scope.contacts.filter(c => c.contact_type === 'kernel_customer');
        },

        loadContactsByType: (contactType) => {
            const scope = _crmGrid;
            scope.currentContactType = contactType;
            scope.renderCurrentTab();
        },

        renderCurrentTab: () => {
            const scope = _crmGrid;
            switch (scope.currentContactType) {
                case 'nis_supplier':
                    scope.renderNISSuppliers();
                    break;
                case 'oil_processor':
                    scope.renderOilProcessors();
                    break;
                case 'oil_ingredient_supplier':
                    scope.renderOilIngredientSuppliers();
                    break;
                case 'oil_protein_customer':
                    scope.renderOilProteinCustomers();
                    break;
                case 'kernel_customer':
                    scope.renderKernelCustomers();
                    break;
            }
        },

        filterNISSuppliers: () => {
            const scope = _crmGrid;
            const searchTerm = $('#nisSearchInput').val().toLowerCase();
            const provinceFilter = $('#nisFilterProvince').val();
            const statusFilter = $('#nisFilterStatus').val();

            let filtered = scope.nisSuppliers.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm)) ||
                    (contact.physical_area && contact.physical_area.toLowerCase().includes(searchTerm)) ||
                    (contact.notes && contact.notes.toLowerCase().includes(searchTerm));

                const matchesProvince = !provinceFilter || contact.physical_province === provinceFilter;
                const matchesStatus = !statusFilter || contact.status === statusFilter;

                return matchesSearch && matchesProvince && matchesStatus;
            });

            scope.renderNISSuppliers(filtered);
        },

        filterOilProcessors: () => {
            const scope = _crmGrid;
            const searchTerm = $('#oilSearchInput').val().toLowerCase();
            const provinceFilter = $('#oilFilterProvince').val();

            let filtered = scope.oilProcessors.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm)) ||
                    (contact.notes && contact.notes.toLowerCase().includes(searchTerm));
                
                const matchesProvince = !provinceFilter || contact.physical_province === provinceFilter;
                
                return matchesSearch && matchesProvince;
            });

            scope.renderOilProcessors(filtered);
        },

        filterKernelCustomers: () => {
            const scope = _crmGrid;
            const searchTerm = $('#customerSearchInput').val().toLowerCase();
            const provinceFilter = $('#customerFilterProvince').val();

            let filtered = scope.kernelCustomers.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm)) ||
                    (contact.notes && contact.notes.toLowerCase().includes(searchTerm));
                
                const matchesProvince = !provinceFilter || contact.physical_province === provinceFilter;
                
                return matchesSearch && matchesProvince;
            });

            scope.renderKernelCustomers(filtered);
        },

        filterOilIngredientSuppliers: () => {
            const scope = _crmGrid;
            const searchTerm = $('#oiSearchInput').val().toLowerCase();
            const provinceFilter = $('#oiFilterProvince').val();
            const statusFilter = $('#oiFilterStatus').val();
            let filtered = scope.oilIngredientSuppliers.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm)) ||
                    (contact.physical_area && contact.physical_area.toLowerCase().includes(searchTerm)) ||
                    (contact.notes && contact.notes.toLowerCase().includes(searchTerm));
                const matchesProvince = !provinceFilter || contact.physical_province === provinceFilter;
                const matchesStatus = !statusFilter || contact.status === statusFilter;
                return matchesSearch && matchesProvince && matchesStatus;
            });
            scope.renderOilIngredientSuppliers(filtered);
        },

        filterOilProteinCustomers: () => {
            const scope = _crmGrid;
            const searchTerm = $('#opcSearchInput').val().toLowerCase();
            const provinceFilter = $('#opcFilterProvince').val();
            let filtered = scope.oilProteinCustomers.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm)) ||
                    (contact.notes && contact.notes.toLowerCase().includes(searchTerm));
                const matchesProvince = !provinceFilter || contact.physical_province === provinceFilter;
                return matchesSearch && matchesProvince;
            });
            scope.renderOilProteinCustomers(filtered);
        },

        renderNISSuppliers: (suppliers = null) => {
            const scope = _crmGrid;
            let data = suppliers || scope.nisSuppliers;
            data = [...data].sort((a, b) => scope.nisSupplierCompare(a, b));
            const tbody = $('#nisSuppliersTableBody');
            tbody.empty();

            if (data.length === 0) {
                tbody.html('<tr><td colspan="13" class="text-center py-4 text-muted">No NIS suppliers found</td></tr>');
                return;
            }

            data.forEach(contact => {
                const notesText = contact.notes || '';
                const notesDisplay = notesText.length > 50 ? notesText.substring(0, 50) + '...' : notesText;
                const codeFromNotes = (notesText.match(/Supplier #(\d+)/) || [])[1];
                const sn = contact.supplier_number;
                const supplierNum =
                    sn !== null && sn !== undefined && sn !== ''
                        ? sn
                        : (codeFromNotes || '–');
                const row = `
                    <tr>
                        <td class="text-end">${supplierNum}</td>
                        <td><strong>${contact.company_name || 'N/A'}</strong></td>
                        <td>${contact.physical_province || 'N/A'}</td>
                        <td>${contact.physical_area || 'N/A'}</td>
                        <td>${contact.primary_contact_name || 'N/A'}</td>
                        <td>${contact.secondary_contact_name || 'N/A'}</td>
                        <td>${contact.primary_contact_mobile || 'N/A'}</td>
                        <td>${contact.secondary_contact_mobile || 'N/A'}</td>
                        <td>${contact.primary_contact_email || 'N/A'}</td>
                        <td>${contact.secondary_contact_email || 'N/A'}</td>
                        <td><span class="badge ${contact.status === 'active' ? 'bg-success' : 'bg-secondary'}">${contact.status || 'N/A'}</span></td>
                        <td title="${notesText.replace(/"/g, '&quot;')}" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${notesDisplay || 'N/A'}
                        </td>
                        <td class="mac-table-actions-col text-nowrap">${MacTableActions.render({
                            items: [
                                { label: 'Edit', className: 'edit-contact-btn', icon: 'fas fa-edit', dataAttrs: { 'contact-id': contact.id } },
                                { label: 'Delete', className: 'delete-contact-btn', danger: true, icon: 'fas fa-trash', dataAttrs: { 'contact-id': contact.id } }
                            ]
                        })}</td>
                    </tr>
                `;
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('nisSuppliersTable'));
        },

        renderOilProcessors: (processors = null) => {
            const scope = _crmGrid;
            const data = processors || scope.oilProcessors;
            const tbody = $('#oilProcessorsTableBody');
            tbody.empty();

            if (data.length === 0) {
                tbody.html('<tr><td colspan="16" class="text-center py-4 text-muted">No oil processors found</td></tr>');
                return;
            }

            data.forEach(contact => {
                const notesText = contact.notes || '';
                const notesDisplay = notesText.length > 50 ? notesText.substring(0, 50) + '...' : notesText;
                const formatRate = (rate) => {
                    if (!rate && rate !== 0) return 'N/A';
                    const num = typeof rate === 'string' ? parseFloat(rate.replace(/[R\s,]/g, '')) : rate;
                    return isNaN(num) ? 'N/A' : `R ${num.toFixed(2)}`;
                };
                const row = `
                    <tr>
                        <td><strong>${contact.company_name || 'N/A'}</strong></td>
                        <td>${contact.physical_province || 'N/A'}</td>
                        <td>${contact.physical_area || 'N/A'}</td>
                        <td>${contact.primary_contact_name || 'N/A'}</td>
                        <td>${contact.secondary_contact_name || 'N/A'}</td>
                        <td>${contact.primary_contact_mobile || 'N/A'}</td>
                        <td>${contact.secondary_contact_mobile || 'N/A'}</td>
                        <td>${contact.primary_contact_email || 'N/A'}</td>
                        <td>${contact.secondary_contact_email || 'N/A'}</td>
                        <td>${formatRate(contact.rate_crude_kernel)}</td>
                        <td>${formatRate(contact.rate_food_kernel)}</td>
                        <td>${formatRate(contact.rate_kernel_dust)}</td>
                        <td>${formatRate(contact.rate_cracker_dust)}</td>
                        <td>${formatRate(contact.rate_crush)}</td>
                        <td title="${notesText.replace(/"/g, '&quot;')}" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${notesDisplay || 'N/A'}
                        </td>
                        <td class="mac-table-actions-col text-nowrap">${MacTableActions.render({
                            items: [
                                { label: 'Edit', className: 'edit-contact-btn', icon: 'fas fa-edit', dataAttrs: { 'contact-id': contact.id } },
                                { label: 'Delete', className: 'delete-contact-btn', danger: true, icon: 'fas fa-trash', dataAttrs: { 'contact-id': contact.id } }
                            ]
                        })}</td>
                    </tr>
                `;
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('oilProcessorsTable'));
        },

        renderOilIngredientSuppliers: (suppliers = null) => {
            const scope = _crmGrid;
            const data = suppliers || scope.oilIngredientSuppliers;
            const tbody = $('#oilIngredientSuppliersTableBody');
            tbody.empty();
            if (data.length === 0) {
                tbody.html('<tr><td colspan="12" class="text-center py-4 text-muted">No oil ingredient suppliers found</td></tr>');
                return;
            }
            data.forEach(contact => {
                const notesText = contact.notes || '';
                const notesDisplay = notesText.length > 50 ? notesText.substring(0, 50) + '...' : notesText;
                const row = `
                    <tr>
                        <td><strong>${scope.escapeHtml(contact.company_name || 'N/A')}</strong></td>
                        <td>${scope.escapeHtml(contact.physical_province || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.physical_area || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.primary_contact_name || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.secondary_contact_name || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.primary_contact_mobile || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.secondary_contact_mobile || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.primary_contact_email || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.secondary_contact_email || 'N/A')}</td>
                        <td><span class="badge ${contact.status === 'active' ? 'bg-success' : 'bg-secondary'}">${scope.escapeHtml(contact.status || 'N/A')}</span></td>
                        <td title="${notesText.replace(/"/g, '&quot;')}" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${notesDisplay || 'N/A'}
                        </td>
                        <td class="mac-table-actions-col text-nowrap">${MacTableActions.render({
                            items: [
                                { label: 'Edit', className: 'edit-contact-btn', icon: 'fas fa-edit', dataAttrs: { 'contact-id': contact.id } },
                                { label: 'Delete', className: 'delete-contact-btn', danger: true, icon: 'fas fa-trash', dataAttrs: { 'contact-id': contact.id } }
                            ]
                        })}</td>
                    </tr>
                `;
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('oilIngredientSuppliersTable'));
        },

        renderOilProteinCustomers: (customers = null) => {
            const scope = _crmGrid;
            const data = customers || scope.oilProteinCustomers;
            const tbody = $('#oilProteinCustomersTableBody');
            tbody.empty();
            if (data.length === 0) {
                tbody.html('<tr><td colspan="9" class="text-center py-4 text-muted">No oil &amp; protein customers found</td></tr>');
                return;
            }
            data.forEach(contact => {
                const preferredStyles = contact.preferred_styles || 'N/A';
                const notesText = contact.notes || '';
                const notesDisplay = notesText.length > 50 ? notesText.substring(0, 50) + '...' : notesText;
                const row = `
                    <tr>
                        <td><strong>${scope.escapeHtml(contact.company_name || 'N/A')}</strong></td>
                        <td>${scope.escapeHtml(contact.physical_province || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.physical_area || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.primary_contact_name || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.primary_contact_mobile || 'N/A')}</td>
                        <td>${scope.escapeHtml(contact.primary_contact_email || 'N/A')}</td>
                        <td><small>${scope.escapeHtml(String(preferredStyles))}</small></td>
                        <td title="${notesText.replace(/"/g, '&quot;')}" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${notesDisplay || 'N/A'}
                        </td>
                        <td class="mac-table-actions-col text-nowrap">${MacTableActions.render({
                            items: [
                                { label: 'Edit', className: 'edit-contact-btn', icon: 'fas fa-edit', dataAttrs: { 'contact-id': contact.id } },
                                { label: 'Delete', className: 'delete-contact-btn', danger: true, icon: 'fas fa-trash', dataAttrs: { 'contact-id': contact.id } }
                            ]
                        })}</td>
                    </tr>
                `;
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('oilProteinCustomersTable'));
        },

        escapeHtml: (text) => {
            if (text == null || text === '') return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        renderKernelCustomers: (customers = null) => {
            const scope = _crmGrid;
            const data = customers || scope.kernelCustomers;
            const tbody = $('#kernelCustomersTableBody');
            tbody.empty();

            if (data.length === 0) {
                tbody.html('<tr><td colspan="9" class="text-center py-4 text-muted">No kernel customers found</td></tr>');
                return;
            }

            data.forEach(contact => {
                const preferredStyles = contact.preferred_styles || 'N/A';
                const notesText = contact.notes || '';
                const notesDisplay = notesText.length > 50 ? notesText.substring(0, 50) + '...' : notesText;
                
                const row = `
                    <tr>
                        <td><strong>${contact.company_name || 'N/A'}</strong></td>
                        <td>${contact.physical_province || 'N/A'}</td>
                        <td>${contact.physical_area || 'N/A'}</td>
                        <td>${contact.primary_contact_name || 'N/A'}</td>
                        <td>${contact.primary_contact_mobile || 'N/A'}</td>
                        <td>${contact.primary_contact_email || 'N/A'}</td>
                        <td><small>${preferredStyles}</small></td>
                        <td title="${notesText.replace(/"/g, '&quot;')}" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${notesDisplay || 'N/A'}
                        </td>
                        <td class="mac-table-actions-col text-nowrap">${MacTableActions.render({
                            items: [
                                { label: 'Edit', className: 'edit-contact-btn', icon: 'fas fa-edit', dataAttrs: { 'contact-id': contact.id } },
                                { label: 'Delete', className: 'delete-contact-btn', danger: true, icon: 'fas fa-trash', dataAttrs: { 'contact-id': contact.id } }
                            ]
                        })}</td>
                    </tr>
                `;
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('kernelCustomersTable'));
        },

        editContact: async (contactId) => {
            const scope = _crmGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getContactById) {
                    scope.showError('Data functions not available');
                    return;
                }
                const contact = await dataFunctions.getContactById(contactId);
                if (contact && typeof _modal_crm_contact !== 'undefined' && _modal_crm_contact.show) _modal_crm_contact.show(contact);
            } catch (error) {
                console.error('Error loading contact:', error);
                scope.showError('Error loading contact: ' + error.message);
            }
        },

        deleteContact: async (contactId) => {
            const scope = _crmGrid;
            const result = await Swal.fire({
                title: 'Are you sure?',
                text: 'This will deactivate the contact. This action can be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, deactivate it!'
            });

            if (result.isConfirmed) {
                try {
                    if (typeof dataFunctions === 'undefined' || !dataFunctions.deleteContact) {
                        scope.showError('Data functions not available');
                        return;
                    }
                    await dataFunctions.deleteContact(contactId);
                    if (typeof Swal !== 'undefined') Swal.fire('Deactivated!', 'Contact has been deactivated.', 'success');
                    scope.loadContacts(true);
                } catch (error) {
                    console.error('Error deleting contact:', error);
                    if (typeof Swal !== 'undefined') Swal.fire('Error!', 'Failed to deactivate contact: ' + error.message, 'error');
                }
            }
        },

        whatsappContact: async (contactId) => {
            const scope = _crmGrid;
            try {
                // Get current user
                const user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
                if (!user || !user.id) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'You must be logged in to use WhatsApp.', 'error');
                    return;
                }

                // Start conversation
                const result = await dataFunctions.chatStartContactConversation(contactId, user.id);

                if (!result || !result.conversation_id) {
                    const errorMsg = result?.error || 'Failed to start conversation';
                    if (errorMsg.includes('no phone')) {
                        if (typeof Swal !== 'undefined') {
                            Swal.fire('No Phone Number', 'This contact has no WhatsApp number on file.', 'warning');
                        }
                    } else {
                        throw new Error(errorMsg);
                    }
                    return;
                }

                // Hand off to WhatsApp module using sessionStorage pattern
                const handoffContext = {
                    route: 'crm-whatsapp-grid',
                    openConversationId: result.conversation_id
                };
                sessionStorage.setItem('macavation_pending_route_context', JSON.stringify(handoffContext));

                // Navigate to WhatsApp module
                if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
                    _appRouter.routeTo('crm-whatsapp-grid');
                }
            } catch (error) {
                console.error('Error opening WhatsApp conversation:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Failed to open WhatsApp conversation: ' + error.message, 'error');
                }
            }
        },

        showImportModal: () => {
            const scope = _crmGrid;
            $('#importContactsModal').modal('show');
            $('#importExcelFile').val('');
            $('#importPreview').hide();
            $('#processImportBtn').prop('disabled', true);
            scope.importData = null;
            scope.importWorkbook = null;
            $('#importAllSheets').prop('checked', false);
            $('#importContactType').prop('disabled', false);
        },

        handleFileSelect: async (file) => {
            const scope = _crmGrid;
            if (!file) return;

            try {
                console.log('[CRM Import] Parsing file:', file.name);
                // Parse workbook (for multi-sheet import) + keep first sheet as default preview
                const workbook = await scope.parseExcelWorkbook(file);
                scope.importWorkbook = workbook;
                console.log('[CRM Import] Workbook loaded, sheets:', workbook?.SheetNames);

                const firstSheetName = workbook?.SheetNames?.[0];
                const data = firstSheetName ? scope.sheetToRows(workbook, firstSheetName) : [];
                scope.importData = data;
                console.log('[CRM Import] First sheet data rows:', data?.length);
                
                if (data && data.length > 0) {
                    scope.showImportPreview(data);
                    $('#processImportBtn').prop('disabled', false);
                } else {
                    Swal.fire('Error', 'No data found in Excel file', 'error');
                }
            } catch (error) {
                console.error('[CRM Import] Error parsing Excel:', error);
                Swal.fire('Error', 'Failed to parse Excel file: ' + error.message, 'error');
            }
        },

        parseExcelWorkbook: (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        resolve(workbook);
                    } catch (error) {
                        reject(error);
                    }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
        },

        sheetToRows: (workbook, sheetName) => {
            const sheet = workbook?.Sheets?.[sheetName];
            if (!sheet) return [];
            return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        },

        normalizeSheetName: (name) => {
            return String(name || '').trim().toLowerCase();
        },

        detectContactTypeForSheet: (sheetName) => {
            const scope = _crmGrid;
            const n = scope.normalizeSheetName(sheetName);
            if (n.includes('ingredient')) return 'oil_ingredient_supplier';
            if ((n.includes('oil') && n.includes('protein')) || n.includes('oil & protein') || n.includes('oil and protein')) {
                return 'oil_protein_customer';
            }
            if (n.includes('protein') && n.includes('customer')) return 'oil_protein_customer';
            if (n.includes('nut in shell') || (n.includes('nis') && !n.includes('ingredient'))) return 'nis_supplier';
            if (n.includes('kernel') && n.includes('customer')) return 'kernel_customer';
            if (n.includes('oil') && n.includes('processor')) return 'oil_processor';
            if (n.includes('processor')) return 'oil_processor';
            if (n.includes('supplier') && !n.includes('oil')) return 'nis_supplier';
            return null;
        },

        mapRowsToContacts: (contactType, importData, isInactive) => {
            const scope = _crmGrid;
            const headers = importData[0] || [];
            const rows = importData.slice(1);

            return rows.map(row => {
                const contact = { contact_type: contactType };

                if (contactType === 'nis_supplier') {
                    contact.company_name = scope.getColumnValue(row, headers, 'Supplier Name');
                    contact.physical_province = scope.getColumnValue(row, headers, 'Province');
                    contact.physical_area = scope.getColumnValue(row, headers, 'Area');
                    contact.primary_contact_name = scope.getColumnValue(row, headers, 'Contact #1');
                    contact.secondary_contact_name = scope.getColumnValue(row, headers, 'Contact #2');
                    contact.primary_contact_mobile = scope.getColumnValue(row, headers, 'Cell #1');
                    contact.secondary_contact_mobile = scope.getColumnValue(row, headers, 'Cell #2');
                    contact.primary_contact_email = scope.getColumnValue(row, headers, 'Email #1');
                    contact.secondary_contact_email = scope.getColumnValue(row, headers, 'Email #2');
                    // Try both "Note/s" and "Notes" column names
                    contact.notes = scope.getColumnValue(row, headers, 'Note/s') || scope.getColumnValue(row, headers, 'Notes');
                    contact.status = isInactive ? 'inactive' : 'active';
                } else if (contactType === 'oil_ingredient_supplier') {
                    contact.company_name = scope.getColumnValue(row, headers, 'Supplier Name');
                    contact.physical_province = scope.getColumnValue(row, headers, 'Province');
                    contact.physical_area = scope.getColumnValue(row, headers, 'Area');
                    contact.primary_contact_name = scope.getColumnValue(row, headers, 'Contact #1');
                    contact.secondary_contact_name = scope.getColumnValue(row, headers, 'Contact #2');
                    contact.primary_contact_mobile = scope.getColumnValue(row, headers, 'Cell #1');
                    contact.secondary_contact_mobile = scope.getColumnValue(row, headers, 'Cell #2');
                    contact.primary_contact_email = scope.getColumnValue(row, headers, 'Email #1');
                    contact.secondary_contact_email = scope.getColumnValue(row, headers, 'Email #2');
                    contact.notes = scope.getColumnValue(row, headers, 'Note/s') || scope.getColumnValue(row, headers, 'Notes');
                    contact.status = isInactive ? 'inactive' : 'active';
                } else if (contactType === 'oil_processor') {
                    // Oil Processors sheet has contact info in one table and rates in another
                    // We'll map from the "Oil Kernel Suppliers" table (contact info)
                    contact.company_name = scope.getColumnValue(row, headers, 'Supplier Name');
                    contact.physical_province = scope.getColumnValue(row, headers, 'Province');
                    contact.physical_area = scope.getColumnValue(row, headers, 'Area');
                    contact.primary_contact_name = scope.getColumnValue(row, headers, 'Contact #1');
                    contact.secondary_contact_name = scope.getColumnValue(row, headers, 'Contact #2');
                    contact.primary_contact_mobile = scope.getColumnValue(row, headers, 'Cell #1');
                    contact.secondary_contact_mobile = scope.getColumnValue(row, headers, 'Cell #2');
                    contact.primary_contact_email = scope.getColumnValue(row, headers, 'Email #1');
                    contact.secondary_contact_email = scope.getColumnValue(row, headers, 'Email #2');
                    // Try both "Note/s" and "Notes" column names
                    contact.notes = scope.getColumnValue(row, headers, 'Note/s') || scope.getColumnValue(row, headers, 'Notes');
                    
                    // Try to get rates from same row (if rates table is merged) or from separate rates lookup
                    contact.rate_crude_kernel = scope.parseRate(scope.getColumnValue(row, headers, 'Crude Kernel Rate/kg'));
                    contact.rate_food_kernel = scope.parseRate(scope.getColumnValue(row, headers, 'Food Kernel Rate/kg'));
                    contact.rate_kernel_dust = scope.parseRate(scope.getColumnValue(row, headers, 'Kernel Dust Rate/kg'));
                    contact.rate_cracker_dust = scope.parseRate(scope.getColumnValue(row, headers, 'Cracker Dust Rate/kg'));
                    contact.rate_crush = scope.parseRate(scope.getColumnValue(row, headers, 'Crush Rate/kg'));
                    contact.status = 'active';
                } else if (contactType === 'oil_protein_customer') {
                    contact.company_name = scope.getColumnValue(row, headers, 'Customer Name');
                    contact.physical_province = scope.getColumnValue(row, headers, 'Province');
                    contact.physical_area = scope.getColumnValue(row, headers, 'Area');
                    contact.primary_contact_name = scope.getColumnValue(row, headers, 'Contact #1');
                    contact.primary_contact_mobile = scope.getColumnValue(row, headers, 'Cell #1') || null;
                    contact.primary_contact_email = scope.getColumnValue(row, headers, 'Email #1') || null;
                    const notes = scope.getColumnValue(row, headers, 'Note/s') || scope.getColumnValue(row, headers, 'Notes');
                    if (notes) {
                        const stylesMatch = notes.match(/^(Style\s+[^-\n]+|.*?)(?:\s*-\s*|$)/i);
                        contact.preferred_styles = stylesMatch ? stylesMatch[1].trim() : notes.trim();
                        contact.notes = notes;
                    }
                    contact.status = 'active';
                } else if (contactType === 'kernel_customer') {
                    // Kernel Customers sheet: Customer Name, Province, Area, Contact #1, Note/s (preferred styles)
                    contact.company_name = scope.getColumnValue(row, headers, 'Customer Name');
                    contact.physical_province = scope.getColumnValue(row, headers, 'Province');
                    contact.physical_area = scope.getColumnValue(row, headers, 'Area');
                    contact.primary_contact_name = scope.getColumnValue(row, headers, 'Contact #1');
                    // Cell #1 and Email #1 might not exist in this sheet, so make them optional
                    contact.primary_contact_mobile = scope.getColumnValue(row, headers, 'Cell #1') || null;
                    contact.primary_contact_email = scope.getColumnValue(row, headers, 'Email #1') || null;
                    // Note/s or Notes column contains preferred styles (e.g., "Style SP", "Style 5 & 6 - Small")
                    const notes = scope.getColumnValue(row, headers, 'Note/s') || scope.getColumnValue(row, headers, 'Notes');
                    if (notes) {
                        // Extract preferred styles - usually everything before " - " or the whole note
                        const stylesMatch = notes.match(/^(Style\s+[^-\n]+|.*?)(?:\s*-\s*|$)/i);
                        contact.preferred_styles = stylesMatch ? stylesMatch[1].trim() : notes.trim();
                        // Keep full note for reference
                        contact.notes = notes;
                    }
                    contact.status = 'active';
                }

                return contact;
            }).filter(c => c.company_name);
        },

        parseExcelFile: (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                        resolve(jsonData);
                    } catch (error) {
                        reject(error);
                    }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
        },

        showImportPreview: (data) => {
            const scope = _crmGrid;
            const preview = $('#importPreview');
            const table = $('#importPreviewTable');
            const thead = table.find('thead');
            const tbody = table.find('tbody');
            
            thead.empty();
            tbody.empty();
            
            if (data.length === 0) return;
            
            // Header row
            const headers = data[0];
            const headerRow = $('<tr></tr>');
            headers.forEach(header => {
                headerRow.append($('<th></th>').text(header || ''));
            });
            thead.append(headerRow);
            
            // Preview rows (max 5)
            const previewRows = data.slice(1, 6);
            previewRows.forEach(row => {
                const tr = $('<tr></tr>');
                headers.forEach((_, index) => {
                    tr.append($('<td></td>').text(row[index] || ''));
                });
                tbody.append(tr);
            });
            
            preview.show();
        },

        processImport: async () => {
            const scope = _crmGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createContact) {
                scope.showError('Data functions not available');
                return;
            }
            console.log('[CRM Import] ========== STARTING IMPORT ==========');
            console.log('[CRM Import] importData?', !!scope.importData, 'length:', scope.importData?.length);
            console.log('[CRM Import] importWorkbook?', !!scope.importWorkbook);
            
            if (!scope.importData || scope.importData.length < 2) {
                console.error('[CRM Import] ERROR: No data to import');
                Swal.fire('Error', 'No data to import. Please select a file first.', 'error');
                return;
            }

            const importAll = $('#importAllSheets').is(':checked');
            console.log('[CRM Import] Import all sheets?', importAll);

            try {
                Swal.fire({
                    title: 'Importing...',
                    text: 'Please wait while contacts are imported',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                let importBatches = [];
                if (importAll) {
                    if (!scope.importWorkbook || !scope.importWorkbook.SheetNames || scope.importWorkbook.SheetNames.length === 0) {
                        console.error('[CRM Import] ERROR: Workbook not loaded');
                        Swal.fire('Error', 'Workbook not loaded. Please re-select the file.', 'error');
                        return;
                    }

                    console.log('[CRM Import] Found sheets:', scope.importWorkbook.SheetNames);

                    scope.importWorkbook.SheetNames.forEach(sheetName => {
                        console.log(`[CRM Import] --- Processing sheet: "${sheetName}" ---`);
                        const contactType = scope.detectContactTypeForSheet(sheetName);
                        console.log(`[CRM Import]   → Detected type: ${contactType}`);
                        if (!contactType) {
                            console.warn(`[CRM Import]   → SKIPPED (no matching type)`);
                            return;
                        }
                        
                        let data = scope.sheetToRows(scope.importWorkbook, sheetName);
                        console.log(`[CRM Import]   → Parsed ${data?.length || 0} rows`);
                        if (data && data.length > 0) {
                            console.log(`[CRM Import]   → Headers:`, data[0]);
                            if (data.length > 1) {
                                console.log(`[CRM Import]   → Sample row:`, data[1]);
                            }
                        }
                        
                        if (!data || data.length < 2) {
                            console.warn(`[CRM Import]   → SKIPPED (not enough data)`);
                            return;
                        }
                        
                        // Determine status based on sheet name for NIS Suppliers
                        const sheetNameLower = sheetName.toLowerCase().trim();
                        const isInactive = sheetNameLower.includes('inactive');
                        
                        // Special handling for Oil Processors: merge contact table with rates table
                        if (contactType === 'oil_processor') {
                            console.log(`[CRM Import]   → Merging Oil Processor tables...`);
                            data = scope.mergeOilProcessorTables(data);
                            console.log(`[CRM Import]   → After merge: ${data?.length || 0} rows`);
                        }
                        
                        importBatches.push({ sheetName, contactType, importData: data, isInactive });
                        console.log(`[CRM Import]   → ✓ Added to import queue (status: ${isInactive ? 'inactive' : 'active'})`);
                    });

                    console.log(`[CRM Import] Total batches to import: ${importBatches.length}`);

                    if (!importBatches.length) {
                        const sheetList = scope.importWorkbook.SheetNames.join(', ');
                        console.error('[CRM Import] ERROR: No matching sheets found');
                        Swal.fire('Error', `No matching sheets found in: ${sheetList}<br><br>Expected names like "NIS Suppliers", "Oil Processors", "Oil Ingredient Suppliers", "Oil & Protein Customers", "Kernel Customers".`, 'error');
                        return;
                    }
                } else {
                    const contactType = $('#importContactType').val();
                    console.log('[CRM Import] Single sheet import, type:', contactType);
                    if (!contactType) {
                        console.error('[CRM Import] ERROR: No contact type selected');
                        Swal.fire('Error', 'Please select a contact type (or enable Import all sheets)', 'error');
                        return;
                    }
                    importBatches = [{ sheetName: 'Selected Sheet', contactType, importData: scope.importData }];
                }

                // Import contacts in batches
                let successCount = 0;
                let errorCount = 0;
                const perSheet = [];
                const errors = [];
                
                console.log(`[CRM Import] ========== IMPORTING ${importBatches.length} BATCH(ES) ==========`);
                
                for (const batch of importBatches) {
                    console.log(`[CRM Import] ===== BATCH: ${batch.sheetName} (${batch.contactType}) =====`);
                    const mappedContacts = scope.mapRowsToContacts(batch.contactType, batch.importData, batch.isInactive);
                    console.log(`[CRM Import] Mapped ${mappedContacts.length} contacts`);
                    
                    let ok = 0;
                    let fail = 0;

                    for (let i = 0; i < mappedContacts.length; i++) {
                        const contactData = mappedContacts[i];
                        try {
                            console.log(`[CRM Import] [${i+1}/${mappedContacts.length}] Importing: ${contactData.company_name}`);
                            console.log(`[CRM Import]   Data:`, contactData);
                            const result = await dataFunctions.createContact(contactData);
                            console.log(`[CRM Import]   ✓ SUCCESS:`, result);
                            successCount++;
                            ok++;
                        } catch (error) {
                            console.error(`[CRM Import]   ✗ FAILED: ${contactData.company_name}`);
                            console.error(`[CRM Import]   Error:`, error.message);
                            console.error(`[CRM Import]   Stack:`, error.stack);
                            errorCount++;
                            fail++;
                            errors.push({ company: contactData.company_name, error: error.message });
                        }
                    }

                    perSheet.push({ sheetName: batch.sheetName, contactType: batch.contactType, ok, fail });
                    console.log(`[CRM Import] Batch complete: ${ok} OK, ${fail} failed`);
                }

                console.log('[CRM Import] ========== IMPORT COMPLETE ==========');
                console.log('[CRM Import] Success:', successCount, 'Errors:', errorCount);
                if (errors.length > 0) {
                    console.error('[CRM Import] Failed contacts:', errors);
                }

                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: successCount > 0 ? 'success' : 'error',
                        title: 'Import Complete',
                        html: `${successCount} contacts imported successfully${errorCount > 0 ? `<br>${errorCount} contacts failed to import` : ''}` +
                            (perSheet.length > 1 ? `<hr class="my-2"/>` + perSheet.map(s => `<div><strong>${s.sheetName}</strong> (${s.contactType}): ${s.ok} OK${s.fail ? `, ${s.fail} failed` : ''}</div>`).join('') : '') +
                            (errors.length > 0 && errors.length <= 5 ? `<hr class="my-2"/><small>Errors: ${errors.map(e => `${e.company}: ${e.error}`).join('<br>')}</small>` : ''),
                        timer: successCount > 0 ? 3000 : undefined
                    });
                }

                $('#importContactsModal').modal('hide');
                scope.loadContacts(true);
            } catch (error) {
                console.error('[CRM Import] FATAL ERROR:', error);
                console.error('[CRM Import] Stack:', error.stack);
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Failed to import contacts: ' + error.message, 'error');
                else scope.showError('Failed to import contacts: ' + error.message);
            }
        },

        mergeOilProcessorTables: (allRows) => {
            const scope = _crmGrid;
            // Oil Processors sheet has two tables: "Oil Kernel Suppliers" and "Rates"
            // Find where "Rates" table starts (look for "Rates" in first column or "Crude Kernel Rate/kg" header)
            let ratesStartIndex = -1;
            for (let i = 0; i < allRows.length; i++) {
                const firstCell = allRows[i]?.[0]?.toString().toLowerCase().trim();
                if (firstCell === 'rates' || firstCell?.includes('crude kernel rate')) {
                    ratesStartIndex = i;
                    break;
                }
            }
            
            if (ratesStartIndex < 0) {
                // No rates table found, return contact data as-is
                return allRows;
            }
            
            // Split into contact table and rates table
            const contactRows = allRows.slice(0, ratesStartIndex);
            const ratesRows = allRows.slice(ratesStartIndex);
            
            // Find rates header row (look for "Supplier Name" and rate columns)
            let ratesHeaderIndex = -1;
            for (let i = 0; i < ratesRows.length; i++) {
                const row = ratesRows[i] || [];
                const hasSupplierName = row.some(cell => cell?.toString().toLowerCase().includes('supplier name'));
                const hasRateColumn = row.some(cell => cell?.toString().toLowerCase().includes('crude kernel rate'));
                if (hasSupplierName && hasRateColumn) {
                    ratesHeaderIndex = i;
                    break;
                }
            }
            
            if (ratesHeaderIndex < 0) {
                return contactRows; // Can't find rates header, return contact data only
            }
            
            // Build a map of supplier name -> rates
            const ratesMap = {};
            const ratesHeaders = ratesRows[ratesHeaderIndex] || [];
            for (let i = ratesHeaderIndex + 1; i < ratesRows.length; i++) {
                const row = ratesRows[i] || [];
                const supplierName = scope.getColumnValue(row, ratesHeaders, 'Supplier Name');
                if (!supplierName) continue;
                
                // Store raw rate values (with R prefix if present) for merging
                ratesMap[supplierName.toLowerCase().trim()] = {
                    'rate_crude_kernel': scope.getColumnValue(row, ratesHeaders, 'Crude Kernel Rate/kg') || '',
                    'rate_food_kernel': scope.getColumnValue(row, ratesHeaders, 'Food Kernel Rate/kg') || '',
                    'rate_kernel_dust': scope.getColumnValue(row, ratesHeaders, 'Kernel Dust Rate/kg') || '',
                    'rate_cracker_dust': scope.getColumnValue(row, ratesHeaders, 'Cracker Dust Rate/kg') || '',
                    'rate_crush': scope.getColumnValue(row, ratesHeaders, 'Crush Rate/kg') || ''
                };
            }
            
            // Merge rates into contact rows
            const contactHeaders = contactRows[0] || [];
            const mergedRows = [contactHeaders]; // Start with header row
            
            // Add rate columns to header if not present
            const rateColumns = ['Crude Kernel Rate/kg', 'Food Kernel Rate/kg', 'Kernel Dust Rate/kg', 'Cracker Dust Rate/kg', 'Crush Rate/kg'];
            rateColumns.forEach(col => {
                if (!contactHeaders.some(h => h?.toString().trim() === col)) {
                    contactHeaders.push(col);
                }
            });
            
            // Merge data rows
            for (let i = 1; i < contactRows.length; i++) {
                const row = contactRows[i] || [];
                const supplierName = scope.getColumnValue(row, contactHeaders, 'Supplier Name');
                const rates = supplierName ? ratesMap[supplierName.toLowerCase().trim()] : null;
                
                const mergedRow = [...row];
                // Add rate columns (pad with empty if not present)
                rateColumns.forEach(col => {
                    const colIndex = contactHeaders.indexOf(col);
                    if (colIndex >= 0) {
                        // Column exists in header, ensure row has value
                        while (mergedRow.length <= colIndex) {
                            mergedRow.push('');
                        }
                        if (rates) {
                            // Map rate key: "Crude Kernel Rate/kg" -> "rate_crude_kernel"
                            const rateKey = col.toLowerCase()
                                .replace(/kernel/g, 'kernel')
                                .replace(/rate\/kg/g, '')
                                .replace(/\s+/g, '_')
                                .replace(/^/, 'rate_');
                            const rateValue = rates[rateKey] || '';
                            mergedRow[colIndex] = rateValue ? (rateValue.toString().startsWith('R') ? rateValue : `R ${rateValue}`) : '';
                        }
                    } else {
                        // Add new rate column at end
                        if (rates) {
                            const rateKey = col.toLowerCase()
                                .replace(/kernel/g, 'kernel')
                                .replace(/rate\/kg/g, '')
                                .replace(/\s+/g, '_')
                                .replace(/^/, 'rate_');
                            const rateValue = rates[rateKey] || '';
                            mergedRow.push(rateValue ? (rateValue.toString().startsWith('R') ? rateValue : `R ${rateValue}`) : '');
                        } else {
                            mergedRow.push('');
                        }
                    }
                });
                
                mergedRows.push(mergedRow);
            }
            
            return mergedRows;
        },

        getColumnValue: (row, headers, columnName) => {
            // Try exact match first
            let index = headers.findIndex(h => h && h.toString().trim() === columnName);
            
            // If not found, try case-insensitive match
            if (index < 0) {
                const normalizedName = columnName.toLowerCase().trim();
                index = headers.findIndex(h => h && h.toString().toLowerCase().trim() === normalizedName);
            }
            
            // Log if column not found (for debugging)
            if (index < 0) {
                console.warn(`[CRM Import] Column "${columnName}" not found in headers:`, headers);
            }
            
            return index >= 0 && row[index] ? String(row[index]).trim() : null;
        },

        parseRate: (value) => {
            if (!value) return null;
            // Remove R symbol and parse
            const cleaned = String(value).replace(/[R\s,]/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? null : parsed;
        },

        showError: (message) => {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                console.error('Error:', message);
            }
        },

        addCommunication: () => {
            if (typeof _common !== 'undefined' && _common.showInfoToast) _common.showInfoToast('Add communication coming soon');
            else if (typeof Swal !== 'undefined') Swal.fire('Info', 'Add communication coming soon', 'info');
            else console.log('Add communication coming soon');
        },

        createQuote: () => {
            if (typeof _common !== 'undefined' && _common.showInfoToast) _common.showInfoToast('Create quote coming soon');
            else if (typeof Swal !== 'undefined') Swal.fire('Info', 'Create quote coming soon', 'info');
            else console.log('Create quote coming soon');
        }
    };
}();

_crmGrid.init();
