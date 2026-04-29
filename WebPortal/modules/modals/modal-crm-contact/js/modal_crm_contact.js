/**
 * Modal: Add/Edit CRM Contact. Parent calls show() or show(contact) or show(null, defaultContactType).
 * Modal owns init, show, clearForm, save, loadAccountManagers, ensureContactModalScrollable.
 */
var _modal_crm_contact = (function () {
    'use strict';

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveContactBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('contactModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
                $(modalEl).on('shown.bs.modal', function () { api.ensureContactModalScrollable(); });
            }
            if (typeof $ !== 'undefined') {
                $('#contactType').on('change', function () {
                    var type = $(this).val();
                    if (type === 'oil_processor') {
                        $('#oilProcessorRatesSection').show();
                        $('#kernelCustomerPreferencesSection').hide();
                    } else if (type === 'kernel_customer' || type === 'oil_protein_customer') {
                        $('#oilProcessorRatesSection').hide();
                        $('#kernelCustomerPreferencesSection').show();
                    } else {
                        $('#oilProcessorRatesSection').hide();
                        $('#kernelCustomerPreferencesSection').hide();
                    }
                    api.toggleSupplierNumberVisibility();
                });
                var addCommBtn = document.getElementById('crmAddCommunicationBtn');
                if (addCommBtn) addCommBtn.addEventListener('click', function () {
                    if (typeof _crmGrid !== 'undefined' && _crmGrid.addCommunication) _crmGrid.addCommunication();
                });
                var createQuoteBtn = document.getElementById('crmCreateQuoteBtn');
                if (createQuoteBtn) createQuoteBtn.addEventListener('click', function () {
                    if (typeof _crmGrid !== 'undefined' && _crmGrid.createQuote) _crmGrid.createQuote();
                });
            }
            if (typeof $(window) !== 'undefined') {
                $(window).on('resize', function () {
                    if ($('#contactModal').hasClass('show')) api.ensureContactModalScrollable();
                });
            }
        },

        show: async function (contact, defaultContactType) {
            var title = document.getElementById('contactModalLabel');
            if (title) title.textContent = contact ? 'Edit Contact' : 'Add New Contact';
            api.clearForm();
            if (contact) {
                api.populateForm(contact);
            } else if (defaultContactType && typeof $ !== 'undefined') {
                $('#contactType').val(defaultContactType);
                if (defaultContactType === 'oil_processor') {
                    $('#oilProcessorRatesSection').show();
                    $('#kernelCustomerPreferencesSection').hide();
                } else if (defaultContactType === 'kernel_customer' || defaultContactType === 'oil_protein_customer') {
                    $('#oilProcessorRatesSection').hide();
                    $('#kernelCustomerPreferencesSection').show();
                } else {
                    $('#oilProcessorRatesSection').hide();
                    $('#kernelCustomerPreferencesSection').hide();
                }
                api.toggleSupplierNumberVisibility();
            }
            try {
                await api.loadAccountManagers();
                if (contact && typeof $ !== 'undefined') $('#accountManagerId').val(contact.account_manager_id || '');
            } catch (e) { console.error('Error loading account managers:', e); }
            var modalEl = document.getElementById('contactModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#contactModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('contactForm');
            if (form) form.reset();
            if (typeof $ !== 'undefined') {
                $('#contactId').val('');
                $('#supplierNumber').val('');
                $('#oilProcessorRatesSection').hide();
                $('#kernelCustomerPreferencesSection').hide();
                $('#crmSupplierNumberGroup').hide();
            }
        },

        /** Show supplier code field for NIS / legacy supplier types (batch number SS segment). */
        toggleSupplierNumberVisibility: function () {
            if (typeof $ === 'undefined') return;
            var type = ($('#contactType').val() || '').trim();
            var show = type === 'nis_supplier' || type === 'supplier' || type === 'both';
            $('#crmSupplierNumberGroup').toggle(show);
        },

        populateForm: function (contact) {
            if (typeof $ === 'undefined') return;
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
            $('#accountManagerId').val(contact.account_manager_id || '');
            $('#supplierNumber').val(contact.supplier_number != null && contact.supplier_number !== '' ? contact.supplier_number : '');
            api.toggleSupplierNumberVisibility();
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
            if (contact.contact_type === 'kernel_customer' || contact.contact_type === 'oil_protein_customer') {
                $('#kernelCustomerPreferencesSection').show();
            } else {
                $('#kernelCustomerPreferencesSection').hide();
            }
        },

        loadAccountManagers: async function () {
            if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined' || !dataFunctions.getUsers) return;
            try {
                var users = await dataFunctions.getUsers();
                var select = $('#accountManagerId');
                var html = '<option value="">Select Account Manager</option>';
                if (users && Array.isArray(users)) {
                    users.forEach(function (user) {
                        var name = ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || user.username || user.email;
                        html += '<option value="' + (user.id || '') + '">' + (name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option>';
                    });
                }
                select.html(html);
            } catch (e) { console.error('Error loading account managers:', e); }
        },

        ensureContactModalScrollable: function () {
            var modalEl = document.getElementById('contactModal');
            if (!modalEl) return;
            var bodyEl = modalEl.querySelector('.modal-body');
            if (!bodyEl) return;
            var headerEl = modalEl.querySelector('.modal-header');
            var footerEl = modalEl.querySelector('.modal-footer');
            var headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
            var footerH = footerEl ? footerEl.getBoundingClientRect().height : 0;
            var verticalPadding = 32;
            var maxH = Math.max(200, window.innerHeight - headerH - footerH - verticalPadding);
            bodyEl.style.overflowY = 'auto';
            bodyEl.style.maxHeight = maxH + 'px';
        },

        save: async function () {
            if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined' || !dataFunctions.createContact) return;
            var form = document.getElementById('contactForm');
            if (!form || !form.checkValidity()) {
                form.reportValidity();
                return;
            }
            var contactData = {
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
            if (contactData.contact_type === 'oil_processor') {
                contactData.rate_crude_kernel = $('#rateCrudeKernel').val() ? parseFloat($('#rateCrudeKernel').val(), 10) : null;
                contactData.rate_food_kernel = $('#rateFoodKernel').val() ? parseFloat($('#rateFoodKernel').val(), 10) : null;
                contactData.rate_kernel_dust = $('#rateKernelDust').val() ? parseFloat($('#rateKernelDust').val(), 10) : null;
                contactData.rate_cracker_dust = $('#rateCrackerDust').val() ? parseFloat($('#rateCrackerDust').val(), 10) : null;
                contactData.rate_crush = $('#rateCrush').val() ? parseFloat($('#rateCrush').val(), 10) : null;
            }
            var contactId = $('#contactId').val();
            var params = {
                contact_type: contactData.contact_type,
                company_name: contactData.company_name,
                trading_name: contactData.trading_name || null,
                primary_contact_name: contactData.primary_contact_name || null,
                primary_contact_email: contactData.primary_contact_email || null,
                primary_contact_phone: contactData.primary_contact_phone || null,
                primary_contact_mobile: contactData.primary_contact_mobile || null,
                secondary_contact_name: contactData.secondary_contact_name || null,
                secondary_contact_phone: contactData.secondary_contact_phone || null,
                secondary_contact_mobile: contactData.secondary_contact_mobile || null,
                secondary_contact_email: contactData.secondary_contact_email || null,
                preferred_styles: contactData.preferred_styles || null,
                physical_area: contactData.physical_area || null,
                physical_city: contactData.physical_city || null,
                physical_province: contactData.physical_province || null,
                physical_postal_code: contactData.physical_postal_code || null,
                account_manager_id: $('#accountManagerId').val() || null,
                status: contactData.status || 'active',
                key_account: contactData.key_account || false,
                notes: contactData.notes || null
            };
            if (contactData.contact_type === 'oil_processor') {
                params.rate_crude_kernel = contactData.rate_crude_kernel || null;
                params.rate_food_kernel = contactData.rate_food_kernel || null;
                params.rate_kernel_dust = contactData.rate_kernel_dust || null;
                params.rate_cracker_dust = contactData.rate_cracker_dust || null;
                params.rate_crush = contactData.rate_crush || null;
            }
            var ct = contactData.contact_type || '';
            if (ct === 'nis_supplier' || ct === 'supplier' || ct === 'both') {
                var snRaw = $('#supplierNumber').val();
                params.supplier_number = snRaw === '' || snRaw === undefined ? null : parseInt(snRaw, 10);
                if (params.supplier_number !== null && isNaN(params.supplier_number)) {
                    if (typeof Swal !== 'undefined') Swal.fire('Validation', 'Supplier code must be a whole number (0–99).', 'warning');
                    return;
                }
            }
            try {
                var result = contactId
                    ? await dataFunctions.updateContact(contactId, params)
                    : await dataFunctions.createContact(params);
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'success', title: 'Success', text: contactId ? 'Contact updated successfully' : 'Contact created successfully', timer: 2000, showConfirmButton: false });
                    }
                    var modalEl = document.getElementById('contactModal');
                    if (modalEl && typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#contactModal').modal('hide');
                    if (typeof _crmGrid !== 'undefined' && _crmGrid.loadContacts) _crmGrid.loadContacts(true);
                } else {
                    throw new Error((result && result.error) || (result && result.message) || 'Failed to save contact');
                }
            } catch (error) {
                console.error('Error saving contact:', error);
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save contact: ' + (error.message || error) });
            }
        }
    };
    return api;
})();
_modal_crm_contact.init();
