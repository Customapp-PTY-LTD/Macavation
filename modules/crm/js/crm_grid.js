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

        init: function () {
            this.setupEventListeners();
            this.loadContacts();
            this.loadAccountManagers();
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
                scope.processImport();
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
        },

        handleFileSelect: async function (file) {
            if (!file) return;

            try {
                const data = await this.parseExcelFile(file);
                this.importData = data;
                
                if (data && data.length > 0) {
                    this.showImportPreview(data);
                    $('#processImportBtn').prop('disabled', false);
                } else {
                    Swal.fire('Error', 'No data found in Excel file', 'error');
                }
            } catch (error) {
                console.error('Error parsing Excel:', error);
                Swal.fire('Error', 'Failed to parse Excel file: ' + error.message, 'error');
            }
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
            if (!this.importData || this.importData.length < 2) {
                Swal.fire('Error', 'No data to import', 'error');
                return;
            }

            const contactType = $('#importContactType').val();
            if (!contactType) {
                Swal.fire('Error', 'Please select a contact type', 'error');
                return;
            }

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

                const headers = this.importData[0];
                const rows = this.importData.slice(1);
                
                // Map Excel columns to database fields based on contact type
                const mappedContacts = rows.map(row => {
                    const contact = { contact_type: contactType };
                    
                    // Map based on contact type
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
                        contact.company_name = this.getColumnValue(row, headers, 'Supplier Name');
                        contact.physical_province = this.getColumnValue(row, headers, 'Province');
                        contact.physical_area = this.getColumnValue(row, headers, 'Area');
                        contact.primary_contact_name = this.getColumnValue(row, headers, 'Contact #1');
                        contact.secondary_contact_name = this.getColumnValue(row, headers, 'Contact #2');
                        contact.primary_contact_mobile = this.getColumnValue(row, headers, 'Cell #1');
                        contact.secondary_contact_mobile = this.getColumnValue(row, headers, 'Cell #2');
                        contact.primary_contact_email = this.getColumnValue(row, headers, 'Email #1');
                        contact.secondary_contact_email = this.getColumnValue(row, headers, 'Email #2');
                        contact.rate_crude_kernel = this.parseRate(this.getColumnValue(row, headers, 'Crude Kernel Rate/kg'));
                        contact.rate_food_kernel = this.parseRate(this.getColumnValue(row, headers, 'Food Kernel Rate/kg'));
                        contact.rate_kernel_dust = this.parseRate(this.getColumnValue(row, headers, 'Kernel Dust Rate/kg'));
                        contact.rate_cracker_dust = this.parseRate(this.getColumnValue(row, headers, 'Cracker Dust Rate/kg'));
                        contact.rate_crush = this.parseRate(this.getColumnValue(row, headers, 'Crush Rate/kg'));
                    } else if (contactType === 'kernel_customer') {
                        contact.company_name = this.getColumnValue(row, headers, 'Customer Name');
                        contact.physical_province = this.getColumnValue(row, headers, 'Province');
                        contact.physical_area = this.getColumnValue(row, headers, 'Area');
                        contact.primary_contact_name = this.getColumnValue(row, headers, 'Contact #1');
                        contact.primary_contact_mobile = this.getColumnValue(row, headers, 'Cell #1');
                        contact.primary_contact_email = this.getColumnValue(row, headers, 'Email #1');
                        contact.notes = this.getColumnValue(row, headers, 'Note/s');
                        contact.status = 'active';
                    }
                    
                    return contact;
                }).filter(c => c.company_name); // Filter out empty rows

                // Import contacts in batches
                let successCount = 0;
                let errorCount = 0;
                
                for (const contactData of mappedContacts) {
                    try {
                        const params = {
                            p_contact_type: contactData.contact_type,
                            p_company_name: contactData.company_name,
                            p_trading_name: contactData.trading_name || null,
                            p_primary_contact_name: contactData.primary_contact_name || null,
                            p_primary_contact_email: contactData.primary_contact_email || null,
                            p_primary_contact_mobile: contactData.primary_contact_mobile || null,
                            p_secondary_contact_name: contactData.secondary_contact_name || null,
                            p_secondary_contact_phone: contactData.secondary_contact_phone || null,
                            p_secondary_contact_mobile: contactData.secondary_contact_mobile || null,
                            p_secondary_contact_email: contactData.secondary_contact_email || null,
                            p_preferred_styles: contactData.preferred_styles || null,
                            p_physical_area: contactData.physical_area || null,
                            p_physical_province: contactData.physical_province || null,
                            p_status: contactData.status || 'active',
                            p_notes: contactData.notes || null
                        };
                        
                        await dataFunctions.createContact(params);
                        successCount++;
                    } catch (error) {
                        console.error('Error importing contact:', contactData.company_name, error);
                        errorCount++;
                    }
                }

                Swal.fire({
                    icon: 'success',
                    title: 'Import Complete',
                    html: `${successCount} contacts imported successfully${errorCount > 0 ? `<br>${errorCount} contacts failed to import` : ''}`,
                    timer: 3000
                });

                $('#importContactsModal').modal('hide');
                this.loadContacts(true);
            } catch (error) {
                console.error('Error processing import:', error);
                Swal.fire('Error', 'Failed to import contacts: ' + error.message, 'error');
            }
        },

        getColumnValue: function (row, headers, columnName) {
            const index = headers.findIndex(h => h && h.toString().trim() === columnName);
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
