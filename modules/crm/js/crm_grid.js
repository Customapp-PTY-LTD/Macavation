/**
 * CRM Grid Module
 * Handles customer and supplier relationship management
 */

var _crmGrid = function () {
    return {
        contacts: [],
        filteredContacts: [],
        currentPage: 1,
        itemsPerPage: 20,
        editingContact: null,
        searchTimeout: null,

        init: function () {
            this.setupEventListeners();
            this.loadContacts();
            this.loadAccountManagers();
        },

        setupEventListeners: function () {
            const scope = this;

            // Search functionality with debouncing (300ms)
            $('#searchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterContacts();
                }, 300);
            });

            // Filter functionality
            $('#filterType, #filterStatus, #filterAccountManager, #filterKeyAccounts').on('change', function () {
                scope.filterContacts();
            });

            $('#applyFiltersBtn').on('click', function () {
                scope.filterContacts();
            });

            $('#clearFiltersBtn').on('click', function () {
                scope.clearFilters();
            });

            // Pagination
            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const page = parseInt($(this).data('page'));
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderContacts();
                }
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
                this.showLoading();
                const startTime = performance.now();
                let contacts = [];
                
                try {
                    contacts = await dataFunctions.getContacts(null, forceRefresh);
                } catch (error) {
                    // Handle authentication errors gracefully
                    if (error.message && error.message.includes('token')) {
                        console.warn('Authentication required for contacts');
                        this.contacts = [];
                        this.filteredContacts = [];
                        this.renderContacts();
                        this.hideLoading();
                        // Show user-friendly message
                        // Show user-friendly message
                        this.showInfo('Please log in to view contacts');
                        return;
                    }
                    throw error; // Re-throw if it's a different error
                }
                
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Contacts loaded in ${loadTime.toFixed(2)}ms`);
                
                this.contacts = contacts || [];
                this.filteredContacts = this.contacts;
                this.renderContacts();
                this.hideLoading();
            } catch (error) {
                console.error('Error loading contacts:', error);
                this.showError('Error loading contacts: ' + error.message);
                this.hideLoading();
            }
        },

        loadAccountManagers: async function () {
            try {
                let users = [];
                
                try {
                    users = await dataFunctions.getUsers();
                } catch (error) {
                    // Handle authentication errors gracefully
                    if (error.message && error.message.includes('token')) {
                        console.warn('Authentication required for account managers');
                        // Set empty options
                        const select = $('#accountManagerId');
                        const filterSelect = $('#filterAccountManager');
                        select.html('<option value="">Please log in</option>');
                        filterSelect.html('<option value="">All Managers</option>');
                        return;
                    }
                    throw error; // Re-throw if it's a different error
                }
                
                const select = $('#accountManagerId');
                const filterSelect = $('#filterAccountManager');
                
                let html = '<option value="">Select Account Manager</option>';
                let filterHtml = '<option value="">All Managers</option>';
                
                if (users && Array.isArray(users)) {
                    users.forEach(user => {
                        const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || user.email;
                        html += `<option value="${user.id}">${name}</option>`;
                        filterHtml += `<option value="${user.id}">${name}</option>`;
                    });
                }
                
                select.html(html);
                filterSelect.html(filterHtml);
            } catch (error) {
                console.error('Error loading account managers:', error);
                // Set empty options on error
                const select = $('#accountManagerId');
                const filterSelect = $('#filterAccountManager');
                select.html('<option value="">Error loading managers</option>');
                filterSelect.html('<option value="">All Managers</option>');
            }
        },

        filterContacts: function () {
            const searchTerm = $('#searchInput').val().toLowerCase();
            const typeFilter = $('#filterType').val();
            const statusFilter = $('#filterStatus').val();
            const accountManagerFilter = $('#filterAccountManager').val();
            const keyAccountsOnly = $('#filterKeyAccounts').is(':checked');

            this.filteredContacts = this.contacts.filter(contact => {
                const matchesSearch = !searchTerm ||
                    (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm)) ||
                    (contact.primary_contact_email && contact.primary_contact_email.toLowerCase().includes(searchTerm));

                const matchesType = !typeFilter || contact.contact_type === typeFilter;
                const matchesStatus = !statusFilter || contact.status === statusFilter;
                const matchesAccountManager = !accountManagerFilter || contact.account_manager_id === accountManagerFilter;
                const matchesKeyAccount = !keyAccountsOnly || contact.key_account === true;

                return matchesSearch && matchesType && matchesStatus && matchesAccountManager && matchesKeyAccount;
            });

            this.currentPage = 1;
            this.renderContacts();
        },

        clearFilters: function () {
            $('#searchInput').val('');
            $('#filterType').val('');
            $('#filterStatus').val('');
            $('#filterAccountManager').val('');
            $('#filterKeyAccounts').prop('checked', false);
            this.filterContacts();
        },

        renderContacts: function () {
            const tbody = $('#contactsTableBody');
            tbody.empty();

            if (this.filteredContacts.length === 0) {
                $('#contactsEmpty').show();
                $('#contactsTable').hide();
                return;
            }

            $('#contactsEmpty').hide();
            $('#contactsTable').show();

            const start = (this.currentPage - 1) * this.itemsPerPage;
            const end = start + this.itemsPerPage;
            const pageContacts = this.filteredContacts.slice(start, end);

            pageContacts.forEach(contact => {
                const row = `
                    <tr>
                        <td>
                            <strong>${contact.company_name || 'N/A'}</strong>
                            ${contact.key_account ? '<span class="badge bg-warning ms-2">Key Account</span>' : ''}
                        </td>
                        <td><span class="badge bg-info">${contact.contact_type || 'N/A'}</span></td>
                        <td>${contact.primary_contact_name || 'N/A'}</td>
                        <td>${contact.primary_contact_email || 'N/A'}</td>
                        <td>${contact.primary_contact_phone || 'N/A'}</td>
                        <td>${contact.account_manager_name || 'N/A'}</td>
                        <td><span class="badge ${this.getStatusBadgeClass(contact.status)}">${contact.status || 'N/A'}</span></td>
                        <td>
                            <div class="grid-actions">
                                <button class="btn btn-sm btn-outline-primary edit-contact-btn" data-contact-id="${contact.id}" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger delete-contact-btn" data-contact-id="${contact.id}" title="Delete">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
                tbody.append(row);
            });

            this.renderPagination();
        },

        renderPagination: function () {
            const totalPages = Math.ceil(this.filteredContacts.length / this.itemsPerPage);
            const pagination = $('#pagination');
            pagination.empty();

            if (totalPages <= 1) return;

            let html = '';
            if (this.currentPage > 1) {
                html += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage - 1}">Previous</a></li>`;
            }

            for (let i = 1; i <= totalPages; i++) {
                if (i === 1 || i === totalPages || (i >= this.currentPage - 2 && i <= this.currentPage + 2)) {
                    html += `<li class="page-item ${i === this.currentPage ? 'active' : ''}">
                        <a class="page-link" href="#" data-page="${i}">${i}</a>
                    </li>`;
                } else if (i === this.currentPage - 3 || i === this.currentPage + 3) {
                    html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
                }
            }

            if (this.currentPage < totalPages) {
                html += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage + 1}">Next</a></li>`;
            }

            pagination.html(html);
        },

        showAddContactModal: function () {
            $('#contactModalLabel').text('Add New Contact');
            $('#contactId').val('');
            this.clearForm();
            $('#contactModal').modal('show');
        },

        editContact: async function (contactId) {
            try {
                this.showLoading();
                // TODO: Implement getContactById function
                const contact = await dataFunctions.callFunction('get_contact_by_id', { p_id: contactId });
                
                if (contact) {
                    this.editingContact = contact;
                    this.populateForm(contact);
                    $('#contactModalLabel').text('Edit Contact');
                    $('#contactModal').modal('show');
                }
                this.hideLoading();
            } catch (error) {
                console.error('Error loading contact:', error);
                this.showError('Error loading contact: ' + error.message);
                this.hideLoading();
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
            $('#primaryContactTitle').val(contact.primary_contact_title || '');
            $('#primaryContactEmail').val(contact.primary_contact_email || '');
            $('#primaryContactPhone').val(contact.primary_contact_phone || '');
            $('#primaryContactMobile').val(contact.primary_contact_mobile || '');
            $('#primaryContactBirthday').val(contact.primary_contact_birthday || '');
            $('#registrationNumber').val(contact.registration_number || '');
            $('#vatNumber').val(contact.vat_number || '');
            $('#accountManagerId').val(contact.account_manager_id || '');
            $('#creditLimit').val(contact.credit_limit || '');
            $('#paymentTerms').val(contact.payment_terms || 30);
            $('#physicalAddressLine1').val(contact.physical_address_line1 || '');
            $('#physicalAddressLine2').val(contact.physical_address_line2 || '');
            $('#physicalCity').val(contact.physical_city || '');
            $('#physicalProvince').val(contact.physical_province || '');
            $('#physicalPostalCode').val(contact.physical_postal_code || '');
            $('#notes').val(contact.notes || '');
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
                    primary_contact_title: $('#primaryContactTitle').val(),
                    primary_contact_email: $('#primaryContactEmail').val(),
                    primary_contact_phone: $('#primaryContactPhone').val(),
                    primary_contact_mobile: $('#primaryContactMobile').val(),
                    primary_contact_birthday: $('#primaryContactBirthday').val() || null,
                    registration_number: $('#registrationNumber').val(),
                    vat_number: $('#vatNumber').val(),
                    account_manager_id: $('#accountManagerId').val() || null,
                    credit_limit: $('#creditLimit').val() ? parseFloat($('#creditLimit').val()) : null,
                    payment_terms: $('#paymentTerms').val() ? parseInt($('#paymentTerms').val()) : 30,
                    physical_address_line1: $('#physicalAddressLine1').val(),
                    physical_address_line2: $('#physicalAddressLine2').val(),
                    physical_city: $('#physicalCity').val(),
                    physical_province: $('#physicalProvince').val(),
                    physical_postal_code: $('#physicalPostalCode').val(),
                    notes: $('#notes').val()
                };

                const contactId = $('#contactId').val();
                let result;

                // Map contactData to database function parameters with p_ prefix
                const params = {
                    p_contact_type: contactData.contact_type,
                    p_company_name: contactData.company_name,
                    p_trading_name: contactData.trading_name || null,
                    p_primary_contact_name: contactData.primary_contact_name || null,
                    p_primary_contact_email: contactData.primary_contact_email || null,
                    p_primary_contact_phone: contactData.primary_contact_phone || null,
                    p_primary_contact_mobile: contactData.primary_contact_mobile || null,
                    p_primary_contact_birthday: contactData.primary_contact_birthday || null,
                    p_account_manager_id: contactData.account_manager_id || null,
                    p_status: contactData.status || 'active',
                    p_key_account: contactData.key_account || false
                };

                if (contactId) {
                    // Update existing
                    result = await dataFunctions.callFunction('update_contact_simple', {
                        p_contact_id: contactId,
                        ...params
                    });
                } else {
                    // Create new
                    result = await dataFunctions.callFunction('create_contact_simple', params);
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
                    this.loadContacts();
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
                    await dataFunctions.callFunction('deactivate_contact', { p_contact_id: contactId });
                    Swal.fire('Deactivated!', 'Contact has been deactivated.', 'success');
                    this.loadContacts();
                } catch (error) {
                    console.error('Error deleting contact:', error);
                    Swal.fire('Error!', 'Failed to deactivate contact: ' + error.message, 'error');
                }
            }
        },

        addCommunication: function () {
            // TODO: Implement communication logging
            Swal.fire('Info', 'Communication logging feature coming soon', 'info');
        },

        createQuote: function () {
            // TODO: Implement quote creation
            Swal.fire('Info', 'Quote creation feature coming soon', 'info');
        },

        clearForm: function () {
            $('#contactForm')[0].reset();
            $('#contactId').val('');
            this.editingContact = null;
        },

        getStatusBadgeClass: function (status) {
            const classes = {
                'active': 'bg-success',
                'inactive': 'bg-secondary',
                'prospect': 'bg-info',
                'suspended': 'bg-danger'
            };
            return classes[status] || 'bg-secondary';
        },

        showLoading: function () {
            $('#contactsLoading').show();
            $('#contactsTable').hide();
            $('#contactsEmpty').hide();
        },

        hideLoading: function () {
            $('#contactsLoading').hide();
        },

        showError: function (message) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: message
            });
        },

        showInfo: function (message) {
            Swal.fire({
                icon: 'info',
                title: 'Information',
                text: message,
                timer: 3000,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
            });
        },

        refreshContacts: function () {
            this.loadContacts(true); // Force refresh bypasses cache
        },

        exportContacts: function () {
            if (!this.contacts || this.contacts.length === 0) {
                Swal.fire('Info', 'No contacts to export', 'info');
                return;
            }
            
            const columns = [
                { key: 'company_name', label: 'Company Name' },
                { key: 'trading_name', label: 'Trading Name' },
                { key: 'contact_type', label: 'Contact Type' },
                { key: 'primary_contact_name', label: 'Primary Contact' },
                { key: 'primary_contact_email', label: 'Email' },
                { key: 'primary_contact_phone', label: 'Phone' },
                { key: 'account_manager_name', label: 'Account Manager' },
                { key: 'status', label: 'Status' },
                { key: 'key_account', label: 'Key Account' }
            ];
            
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(this.contacts, 'contacts', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
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

