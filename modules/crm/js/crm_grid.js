/**
 * CRM Grid Module
 * Handles NIS Suppliers, Oil Processors, and Kernel Customers management
 */

var _crmGrid = function () {
    return {
        contacts: [],
        nisSuppliers: [],
        oilProcessors: [],
        kernelCustomers: [],
        currentContactType: 'nis_supplier',
        editingContact: null,
        searchTimeout: null,
        importData: null,
        importWorkbook: null,

        init: function () {
            console.log('[CRM] Initializing CRM Grid module...');
            this.setupEventListeners();
            this.loadContacts();
            this.loadAccountManagers();
            console.log('[CRM] CRM Grid module initialized');
        },

        setupEventListeners: function () {
            const scope = this;

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

            // Contact type change - show/hide type-specific sections
            $('#contactType').on('change', function () {
                const type = $(this).val();
                if (type === 'oil_processor') {
                    $('#oilProcessorRatesSection').show();
                    $('#kernelCustomerPreferencesSection').hide();
                } else if (type === 'kernel_customer') {
                    $('#oilProcessorRatesSection').hide();
                    $('#kernelCustomerPreferencesSection').show();
                } else {
                    $('#oilProcessorRatesSection').hide();
                    $('#kernelCustomerPreferencesSection').hide();
                }
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
            $('#nisApplyFiltersBtn').on('click', function () {
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
            $('#oilApplyFiltersBtn').on('click', function () {
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
            $('#customerApplyFiltersBtn').on('click', function () {
                scope.filterKernelCustomers();
            });
            $('#customerClearFiltersBtn').on('click', function () {
                $('#customerSearchInput').val('');
                $('#customerFilterProvince').val('');
                scope.filterKernelCustomers();
            });

            // Add contact button
            $('#addContactBtn').on('click', function () {
                scope.showAddContactModal();
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

            // Save contact form
            $('#saveContactBtn').on('click', function () {
                scope.saveContact();
            });

            // Modal events
            $('#contactModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });

            // Ensure long modal content is scrollable (theme-safe)
            $('#contactModal').on('shown.bs.modal', function () {
                scope.ensureContactModalScrollable();
            });
            $(window).on('resize', function () {
                if ($('#contactModal').hasClass('show')) {
                    scope.ensureContactModalScrollable();
                }
            });
        },

        loadContacts: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                let contacts = [];
                
                try {
                    contacts = await dataFunctions.getContacts(null, forceRefresh);
                } catch (error) {
                    if (error.message && error.message.includes('token')) {
                        console.warn('Authentication required for contacts');
                        this.contacts = [];
                        this.separateContactsByType();
                        this.renderCurrentTab();
                        return;
                    }
                    throw error;
                }
                
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Contacts loaded in ${loadTime.toFixed(2)}ms`);
                
                this.contacts = contacts || [];
                this.separateContactsByType();
                this.renderCurrentTab();
            } catch (error) {
                console.error('Error loading contacts:', error);
                this.showError('Error loading contacts: ' + error.message);
            }
        },

        separateContactsByType: function () {
            this.nisSuppliers = this.contacts.filter(c => c.contact_type === 'nis_supplier');
            this.oilProcessors = this.contacts.filter(c => c.contact_type === 'oil_processor');
            this.kernelCustomers = this.contacts.filter(c => c.contact_type === 'kernel_customer');
        },

        loadContactsByType: function (contactType) {
            this.currentContactType = contactType;
            this.renderCurrentTab();
        },

        renderCurrentTab: function () {
            switch (this.currentContactType) {
                case 'nis_supplier':
                    this.renderNISSuppliers();
                    break;
                case 'oil_processor':
                    this.renderOilProcessors();
                    break;
                case 'kernel_customer':
                    this.renderKernelCustomers();
                    break;
            }
        },

        filterNISSuppliers: function () {
            const searchTerm = $('#nisSearchInput').val().toLowerCase();
            const provinceFilter = $('#nisFilterProvince').val();
            const statusFilter = $('#nisFilterStatus').val();

            let filtered = this.nisSuppliers.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm)) ||
                    (contact.physical_area && contact.physical_area.toLowerCase().includes(searchTerm));

                const matchesProvince = !provinceFilter || contact.physical_province === provinceFilter;
                const matchesStatus = !statusFilter || contact.status === statusFilter;
                
                return matchesSearch && matchesProvince && matchesStatus;
            });

            this.renderNISSuppliers(filtered);
        },

        filterOilProcessors: function () {
            const searchTerm = $('#oilSearchInput').val().toLowerCase();
            const provinceFilter = $('#oilFilterProvince').val();

            let filtered = this.oilProcessors.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm));
                
                const matchesProvince = !provinceFilter || contact.physical_province === provinceFilter;
                
                return matchesSearch && matchesProvince;
            });

            this.renderOilProcessors(filtered);
        },

        filterKernelCustomers: function () {
            const searchTerm = $('#customerSearchInput').val().toLowerCase();
            const provinceFilter = $('#customerFilterProvince').val();

            let filtered = this.kernelCustomers.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm));
                
                const matchesProvince = !provinceFilter || contact.physical_province === provinceFilter;
                
                return matchesSearch && matchesProvince;
            });

            this.renderKernelCustomers(filtered);
        },

        renderNISSuppliers: function (suppliers = null) {
            const data = suppliers || this.nisSuppliers;
            const tbody = $('#nisSuppliersTableBody');
            tbody.empty();

            if (data.length === 0) {
                tbody.html('<tr><td colspan="11" class="text-center py-4 text-muted">No NIS suppliers found</td></tr>');
                return;
            }

            data.forEach(contact => {
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
                        <td><span class="badge ${contact.status === 'active' ? 'bg-success' : 'bg-secondary'}">${contact.status || 'N/A'}</span></td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary edit-contact-btn" data-contact-id="${contact.id}" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger delete-contact-btn" data-contact-id="${contact.id}" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
                tbody.append(row);
            });
        },

        renderOilProcessors: function (processors = null) {
            const data = processors || this.oilProcessors;
            const tbody = $('#oilProcessorsTableBody');
            tbody.empty();

            if (data.length === 0) {
                tbody.html('<tr><td colspan="10" class="text-center py-4 text-muted">No oil processors found</td></tr>');
                return;
            }

            data.forEach(contact => {
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
                        <td>
                                <button class="btn btn-sm btn-outline-primary edit-contact-btn" data-contact-id="${contact.id}" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger delete-contact-btn" data-contact-id="${contact.id}" title="Delete">
                                    <i class="fas fa-trash"></i>
                                </button>
                        </td>
                    </tr>
                `;
                tbody.append(row);
            });
        },

        renderKernelCustomers: function (customers = null) {
            const data = customers || this.kernelCustomers;
            const tbody = $('#kernelCustomersTableBody');
            tbody.empty();

            if (data.length === 0) {
                tbody.html('<tr><td colspan="8" class="text-center py-4 text-muted">No kernel customers found</td></tr>');
                return;
            }

            data.forEach(contact => {
                const preferredStyles = contact.preferred_styles || 'N/A';
                
                const row = `
                    <tr>
                        <td><strong>${contact.company_name || 'N/A'}</strong></td>
                        <td>${contact.physical_province || 'N/A'}</td>
                        <td>${contact.physical_area || 'N/A'}</td>
                        <td>${contact.primary_contact_name || 'N/A'}</td>
                        <td>${contact.primary_contact_mobile || 'N/A'}</td>
                        <td>${contact.primary_contact_email || 'N/A'}</td>
                        <td><small>${preferredStyles}</small></td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary edit-contact-btn" data-contact-id="${contact.id}" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger delete-contact-btn" data-contact-id="${contact.id}" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
                tbody.append(row);
            });
        },

        loadAccountManagers: async function () {
            try {
                let users = [];
                
                try {
                    users = await dataFunctions.getUsers();
                } catch (error) {
                    if (error.message && error.message.includes('token')) {
                        console.warn('Authentication required for account managers');
                        return;
                    }
                    throw error;
                }
                
                const select = $('#accountManagerId');
                let html = '<option value="">Select Account Manager</option>';
                
                if (users && Array.isArray(users)) {
                    users.forEach(user => {
                        const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || user.email;
                        html += `<option value="${user.id}">${name}</option>`;
                    });
                }
                
                select.html(html);
            } catch (error) {
                console.error('Error loading account managers:', error);
            }
        },

        showAddContactModal: function () {
            $('#contactModalLabel').text('Add New Contact');
            $('#contactId').val('');
            this.clearForm();
            
            // Set contact type based on current tab
            $('#contactType').val(this.currentContactType);
            if (this.currentContactType === 'oil_processor') {
                $('#oilProcessorRatesSection').show();
                $('#kernelCustomerPreferencesSection').hide();
            } else if (this.currentContactType === 'kernel_customer') {
                $('#oilProcessorRatesSection').hide();
                $('#kernelCustomerPreferencesSection').show();
            } else {
                $('#oilProcessorRatesSection').hide();
                $('#kernelCustomerPreferencesSection').hide();
            }
            
            $('#contactModal').modal('show');
        },

        editContact: async function (contactId) {
            try {
                const contact = await dataFunctions.getContactById(contactId);
                
                if (contact) {
                    this.editingContact = contact;
                    this.populateForm(contact);
                    $('#contactModalLabel').text('Edit Contact');
                    $('#contactModal').modal('show');
                }
            } catch (error) {
                console.error('Error loading contact:', error);
                this.showError('Error loading contact: ' + error.message);
            }
        },

        populateForm: function (contact) {
            $('#contactId').val(contact.id || '');
            $('#contactType').val(contact.contact_type || '');
            $('#companyName').val(contact.company_name || '');
            $('#tradingName').val(contact.trading_name || '');
            $('#status').val(contact.status || 'active');
            $('#keyAccount').prop('checked', contact.key_account || false);
            $('#primaryContactName').val(contact.primary_contact_name || '');
            $('#primaryContactEmail').val(contact.primary_contact_email || '');
            $('#primaryContactPhone').val(contact.primary_contact_phone || '');
            $('#primaryContactMobile').val(contact.primary_contact_mobile || '');
            $('#secondaryContactName').val(contact.secondary_contact_name || '');
            $('#secondaryContactPhone').val(contact.secondary_contact_phone || '');
            $('#secondaryContactMobile').val(contact.secondary_contact_mobile || '');
            $('#secondaryContactEmail').val(contact.secondary_contact_email || '');
            $('#physicalArea').val(contact.physical_area || '');
            $('#physicalCity').val(contact.physical_city || '');
            $('#physicalProvince').val(contact.physical_province || '');
            $('#physicalPostalCode').val(contact.physical_postal_code || '');
            $('#preferredStyles').val(contact.preferred_styles || '');
            $('#notes').val(contact.notes || '');
            
            // Oil processor rates
            if (contact.contact_type === 'oil_processor') {
                $('#oilProcessorRatesSection').show();
                $('#rateCrudeKernel').val(contact.rate_crude_kernel || '');
                $('#rateFoodKernel').val(contact.rate_food_kernel || '');
                $('#rateKernelDust').val(contact.rate_kernel_dust || '');
                $('#rateCrackerDust').val(contact.rate_cracker_dust || '');
                $('#rateCrush').val(contact.rate_crush || '');
            } else {
                $('#oilProcessorRatesSection').hide();
            }
            
            // Kernel customer preferences
            if (contact.contact_type === 'kernel_customer') {
                $('#kernelCustomerPreferencesSection').show();
            } else {
                $('#kernelCustomerPreferencesSection').hide();
            }
        },

        saveContact: async function () {
            try {
                const form = $('#contactForm')[0];
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }

                const contactData = {
                    contact_type: $('#contactType').val(),
                    company_name: $('#companyName').val(),
                    trading_name: $('#tradingName').val(),
                    status: $('#status').val(),
                    key_account: $('#keyAccount').is(':checked'),
                    primary_contact_name: $('#primaryContactName').val(),
                    primary_contact_email: $('#primaryContactEmail').val(),
                    primary_contact_phone: $('#primaryContactPhone').val(),
                    primary_contact_mobile: $('#primaryContactMobile').val(),
                    secondary_contact_name: $('#secondaryContactName').val() || null,
                    secondary_contact_phone: $('#secondaryContactPhone').val() || null,
                    secondary_contact_mobile: $('#secondaryContactMobile').val() || null,
                    secondary_contact_email: $('#secondaryContactEmail').val() || null,
                    preferred_styles: $('#preferredStyles').val() || null,
                    physical_area: $('#physicalArea').val() || null,
                    physical_city: $('#physicalCity').val() || null,
                    physical_province: $('#physicalProvince').val() || null,
                    physical_postal_code: $('#physicalPostalCode').val() || null,
                    notes: $('#notes').val() || null
                };

                // Add rates for oil processors
                if (contactData.contact_type === 'oil_processor') {
                    contactData.rate_crude_kernel = $('#rateCrudeKernel').val() ? parseFloat($('#rateCrudeKernel').val()) : null;
                    contactData.rate_food_kernel = $('#rateFoodKernel').val() ? parseFloat($('#rateFoodKernel').val()) : null;
                    contactData.rate_kernel_dust = $('#rateKernelDust').val() ? parseFloat($('#rateKernelDust').val()) : null;
                    contactData.rate_cracker_dust = $('#rateCrackerDust').val() ? parseFloat($('#rateCrackerDust').val()) : null;
                    contactData.rate_crush = $('#rateCrush').val() ? parseFloat($('#rateCrush').val()) : null;
                }

                const contactId = $('#contactId').val();
                let result;

                // Map to database function parameters
                const params = {
                    p_contact_type: contactData.contact_type,
                    p_company_name: contactData.company_name,
                    p_trading_name: contactData.trading_name || null,
                    p_primary_contact_name: contactData.primary_contact_name || null,
                    p_primary_contact_email: contactData.primary_contact_email || null,
                    p_primary_contact_phone: contactData.primary_contact_phone || null,
                    p_primary_contact_mobile: contactData.primary_contact_mobile || null,
                    p_secondary_contact_name: contactData.secondary_contact_name || null,
                    p_secondary_contact_phone: contactData.secondary_contact_phone || null,
                    p_secondary_contact_mobile: contactData.secondary_contact_mobile || null,
                    p_secondary_contact_email: contactData.secondary_contact_email || null,
                    p_preferred_styles: contactData.preferred_styles || null,
                    p_physical_area: contactData.physical_area || null,
                    p_physical_city: contactData.physical_city || null,
                    p_physical_province: contactData.physical_province || null,
                    p_physical_postal_code: contactData.physical_postal_code || null,
                    p_account_manager_id: $('#accountManagerId').val() || null,
                    p_status: contactData.status || 'active',
                    p_key_account: contactData.key_account || false,
                    p_notes: contactData.notes || null
                };

                if (contactId) {
                    result = await dataFunctions.updateContact(contactId, params);
                } else {
                    result = await dataFunctions.createContact(params);
                }

                if (result && result.success !== false) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: contactId ? 'Contact updated successfully' : 'Contact created successfully',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    $('#contactModal').modal('hide');
                    this.loadContacts(true);
                } else {
                    throw new Error(result?.message || 'Failed to save contact');
                }
            } catch (error) {
                console.error('Error saving contact:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to save contact: ' + error.message
                });
            }
        },

        deleteContact: async function (contactId) {
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
                    await dataFunctions.deleteContact(contactId);
                    Swal.fire('Deactivated!', 'Contact has been deactivated.', 'success');
                    this.loadContacts(true);
                } catch (error) {
                    console.error('Error deleting contact:', error);
                    Swal.fire('Error!', 'Failed to deactivate contact: ' + error.message, 'error');
                }
            }
        },

        showImportModal: function () {
            $('#importContactsModal').modal('show');
            $('#importExcelFile').val('');
            $('#importPreview').hide();
            $('#processImportBtn').prop('disabled', true);
            this.importData = null;
            this.importWorkbook = null;
            $('#importAllSheets').prop('checked', false);
            $('#importContactType').prop('disabled', false);
        },

        handleFileSelect: async function (file) {
            if (!file) return;

            try {
                console.log('[CRM Import] Parsing file:', file.name);
                // Parse workbook (for multi-sheet import) + keep first sheet as default preview
                const workbook = await this.parseExcelWorkbook(file);
                this.importWorkbook = workbook;
                console.log('[CRM Import] Workbook loaded, sheets:', workbook?.SheetNames);

                const firstSheetName = workbook?.SheetNames?.[0];
                const data = firstSheetName ? this.sheetToRows(workbook, firstSheetName) : [];
                this.importData = data;
                console.log('[CRM Import] First sheet data rows:', data?.length);
                
                if (data && data.length > 0) {
                    this.showImportPreview(data);
                    $('#processImportBtn').prop('disabled', false);
                } else {
                    Swal.fire('Error', 'No data found in Excel file', 'error');
                }
            } catch (error) {
                console.error('[CRM Import] Error parsing Excel:', error);
                Swal.fire('Error', 'Failed to parse Excel file: ' + error.message, 'error');
            }
        },

        parseExcelWorkbook: function (file) {
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

        sheetToRows: function (workbook, sheetName) {
            const sheet = workbook?.Sheets?.[sheetName];
            if (!sheet) return [];
            return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        },

        normalizeSheetName: function (name) {
            return String(name || '').trim().toLowerCase();
        },

        detectContactTypeForSheet: function (sheetName) {
            const n = this.normalizeSheetName(sheetName);
            // Match common variations in your workbook tabs
            if (n.includes('nis') || n.includes('supplier')) return 'nis_supplier';
            if (n.includes('oil') || n.includes('processor')) return 'oil_processor';
            if (n.includes('kernel') || n.includes('customer')) return 'kernel_customer';
            return null;
        },

        mapRowsToContacts: function (contactType, importData) {
            const headers = importData[0] || [];
            const rows = importData.slice(1);

            return rows.map(row => {
                const contact = { contact_type: contactType };

                if (contactType === 'nis_supplier') {
                    contact.company_name = this.getColumnValue(row, headers, 'Supplier Name');
                    contact.physical_province = this.getColumnValue(row, headers, 'Province');
                    contact.physical_area = this.getColumnValue(row, headers, 'Area');
                    contact.primary_contact_name = this.getColumnValue(row, headers, 'Contact #1');
                    contact.secondary_contact_name = this.getColumnValue(row, headers, 'Contact #2');
                    contact.primary_contact_mobile = this.getColumnValue(row, headers, 'Cell #1');
                    contact.secondary_contact_mobile = this.getColumnValue(row, headers, 'Cell #2');
                    contact.primary_contact_email = this.getColumnValue(row, headers, 'Email #1');
                    contact.secondary_contact_email = this.getColumnValue(row, headers, 'Email #2');
                    contact.notes = this.getColumnValue(row, headers, 'Note/s');
                    contact.status = 'active';
                } else if (contactType === 'oil_processor') {
                    // Oil Processors sheet has contact info in one table and rates in another
                    // We'll map from the "Oil Kernel Suppliers" table (contact info)
                    contact.company_name = this.getColumnValue(row, headers, 'Supplier Name');
                    contact.physical_province = this.getColumnValue(row, headers, 'Province');
                    contact.physical_area = this.getColumnValue(row, headers, 'Area');
                    contact.primary_contact_name = this.getColumnValue(row, headers, 'Contact #1');
                    contact.secondary_contact_name = this.getColumnValue(row, headers, 'Contact #2');
                    contact.primary_contact_mobile = this.getColumnValue(row, headers, 'Cell #1');
                    contact.secondary_contact_mobile = this.getColumnValue(row, headers, 'Cell #2');
                    contact.primary_contact_email = this.getColumnValue(row, headers, 'Email #1');
                    contact.secondary_contact_email = this.getColumnValue(row, headers, 'Email #2');
                    contact.notes = this.getColumnValue(row, headers, 'Note/s');
                    
                    // Try to get rates from same row (if rates table is merged) or from separate rates lookup
                    contact.rate_crude_kernel = this.parseRate(this.getColumnValue(row, headers, 'Crude Kernel Rate/kg'));
                    contact.rate_food_kernel = this.parseRate(this.getColumnValue(row, headers, 'Food Kernel Rate/kg'));
                    contact.rate_kernel_dust = this.parseRate(this.getColumnValue(row, headers, 'Kernel Dust Rate/kg'));
                    contact.rate_cracker_dust = this.parseRate(this.getColumnValue(row, headers, 'Cracker Dust Rate/kg'));
                    contact.rate_crush = this.parseRate(this.getColumnValue(row, headers, 'Crush Rate/kg'));
                    contact.status = 'active';
                } else if (contactType === 'kernel_customer') {
                    // Kernel Customers sheet: Customer Name, Province, Area, Contact #1, Note/s (preferred styles)
                    contact.company_name = this.getColumnValue(row, headers, 'Customer Name');
                    contact.physical_province = this.getColumnValue(row, headers, 'Province');
                    contact.physical_area = this.getColumnValue(row, headers, 'Area');
                    contact.primary_contact_name = this.getColumnValue(row, headers, 'Contact #1');
                    // Cell #1 and Email #1 might not exist in this sheet, so make them optional
                    contact.primary_contact_mobile = this.getColumnValue(row, headers, 'Cell #1') || null;
                    contact.primary_contact_email = this.getColumnValue(row, headers, 'Email #1') || null;
                    // Note/s column contains preferred styles (e.g., "Style SP", "Style 5 & 6 - Small")
                    const notes = this.getColumnValue(row, headers, 'Note/s');
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

        parseExcelFile: function (file) {
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

        showImportPreview: function (data) {
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

        processImport: async function () {
            console.log('[CRM Import] ========== STARTING IMPORT ==========');
            console.log('[CRM Import] importData?', !!this.importData, 'length:', this.importData?.length);
            console.log('[CRM Import] importWorkbook?', !!this.importWorkbook);
            
            if (!this.importData || this.importData.length < 2) {
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
                    if (!this.importWorkbook || !this.importWorkbook.SheetNames || this.importWorkbook.SheetNames.length === 0) {
                        console.error('[CRM Import] ERROR: Workbook not loaded');
                        Swal.fire('Error', 'Workbook not loaded. Please re-select the file.', 'error');
                        return;
                    }

                    console.log('[CRM Import] Found sheets:', this.importWorkbook.SheetNames);

                    this.importWorkbook.SheetNames.forEach(sheetName => {
                        console.log(`[CRM Import] --- Processing sheet: "${sheetName}" ---`);
                        const contactType = this.detectContactTypeForSheet(sheetName);
                        console.log(`[CRM Import]   → Detected type: ${contactType}`);
                        if (!contactType) {
                            console.warn(`[CRM Import]   → SKIPPED (no matching type)`);
                            return;
                        }
                        
                        let data = this.sheetToRows(this.importWorkbook, sheetName);
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
                        
                        // Special handling for Oil Processors: merge contact table with rates table
                        if (contactType === 'oil_processor') {
                            console.log(`[CRM Import]   → Merging Oil Processor tables...`);
                            data = this.mergeOilProcessorTables(data);
                            console.log(`[CRM Import]   → After merge: ${data?.length || 0} rows`);
                        }
                        
                        importBatches.push({ sheetName, contactType, importData: data });
                        console.log(`[CRM Import]   → ✓ Added to import queue`);
                    });

                    console.log(`[CRM Import] Total batches to import: ${importBatches.length}`);

                    if (!importBatches.length) {
                        const sheetList = this.importWorkbook.SheetNames.join(', ');
                        console.error('[CRM Import] ERROR: No matching sheets found');
                        Swal.fire('Error', `No matching sheets found in: ${sheetList}<br><br>Expected names like "NIS Suppliers", "Oil Processors", "Kernel Customers".`, 'error');
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
                    importBatches = [{ sheetName: 'Selected Sheet', contactType, importData: this.importData }];
                }

                // Import contacts in batches
                let successCount = 0;
                let errorCount = 0;
                const perSheet = [];
                const errors = [];
                
                console.log(`[CRM Import] ========== IMPORTING ${importBatches.length} BATCH(ES) ==========`);
                
                for (const batch of importBatches) {
                    console.log(`[CRM Import] ===== BATCH: ${batch.sheetName} (${batch.contactType}) =====`);
                    const mappedContacts = this.mapRowsToContacts(batch.contactType, batch.importData);
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

                Swal.fire({
                    icon: successCount > 0 ? 'success' : 'error',
                    title: 'Import Complete',
                    html: `${successCount} contacts imported successfully${errorCount > 0 ? `<br>${errorCount} contacts failed to import` : ''}` +
                        (perSheet.length > 1 ? `<hr class="my-2"/>` + perSheet.map(s => `<div><strong>${s.sheetName}</strong> (${s.contactType}): ${s.ok} OK${s.fail ? `, ${s.fail} failed` : ''}</div>`).join('') : '') +
                        (errors.length > 0 && errors.length <= 5 ? `<hr class="my-2"/><small>Errors: ${errors.map(e => `${e.company}: ${e.error}`).join('<br>')}</small>` : ''),
                    timer: successCount > 0 ? 3000 : undefined
                });

                $('#importContactsModal').modal('hide');
                this.loadContacts(true);
            } catch (error) {
                console.error('[CRM Import] FATAL ERROR:', error);
                console.error('[CRM Import] Stack:', error.stack);
                Swal.fire('Error', 'Failed to import contacts: ' + error.message, 'error');
            }
        },

        mergeOilProcessorTables: function (allRows) {
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
                const supplierName = this.getColumnValue(row, ratesHeaders, 'Supplier Name');
                if (!supplierName) continue;
                
                // Store raw rate values (with R prefix if present) for merging
                ratesMap[supplierName.toLowerCase().trim()] = {
                    'rate_crude_kernel': this.getColumnValue(row, ratesHeaders, 'Crude Kernel Rate/kg') || '',
                    'rate_food_kernel': this.getColumnValue(row, ratesHeaders, 'Food Kernel Rate/kg') || '',
                    'rate_kernel_dust': this.getColumnValue(row, ratesHeaders, 'Kernel Dust Rate/kg') || '',
                    'rate_cracker_dust': this.getColumnValue(row, ratesHeaders, 'Cracker Dust Rate/kg') || '',
                    'rate_crush': this.getColumnValue(row, ratesHeaders, 'Crush Rate/kg') || ''
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
                const supplierName = this.getColumnValue(row, contactHeaders, 'Supplier Name');
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

        getColumnValue: function (row, headers, columnName) {
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

        parseRate: function (value) {
            if (!value) return null;
            // Remove R symbol and parse
            const cleaned = String(value).replace(/[R\s,]/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? null : parsed;
        },

        clearForm: function () {
            $('#contactForm')[0].reset();
            $('#contactId').val('');
            this.editingContact = null;
            $('#oilProcessorRatesSection').hide();
            $('#kernelCustomerPreferencesSection').hide();
        },

        ensureContactModalScrollable: function () {
            const modalEl = document.getElementById('contactModal');
            if (!modalEl) return;

            const bodyEl = modalEl.querySelector('.modal-body');
            if (!bodyEl) return;

            const headerEl = modalEl.querySelector('.modal-header');
            const footerEl = modalEl.querySelector('.modal-footer');

            const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
            const footerH = footerEl ? footerEl.getBoundingClientRect().height : 0;
            const verticalPadding = 32; // ~1rem top + 1rem bottom

            const maxH = Math.max(200, window.innerHeight - headerH - footerH - verticalPadding);
            bodyEl.style.overflowY = 'auto';
            bodyEl.style.maxHeight = `${maxH}px`;
        },

        showError: function (message) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: message
            });
        }
    };
}();

// Global instance
const crmGrid = _crmGrid;

// Initialize function for router
function initializeCrmGrid() {
    if (typeof crmGrid !== 'undefined') {
        crmGrid.init();
    }
}
