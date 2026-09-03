/**
 * Modal: Add/Edit User. Parent calls show() or show(user). Modal owns init, show, clearForm, save.
 */
var _modal_user = (function () {
    'use strict';

    function escapeHtml(text) {
        if (!text) return '';
        return _common.escapeHtml(text);
    }

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveUserBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            // Guarded against a double attach: init() runs from two places - the bottom of this
            // file, and appRouter.js's 'user-modal' initializer (appRouter.js:282) - and whether
            // both find the button depends on whether the fragment is in the DOM yet. Two
            // listeners here would send the staff member TWO enrolment codes, and because
            // whatsapp_start_enrolment upserts on phone, only the second would still work.
            var enrolBtn = document.getElementById('btnSendEnrolCode');
            if (enrolBtn && enrolBtn.getAttribute('data-listener-bound') !== 'true') {
                enrolBtn.setAttribute('data-listener-bound', 'true');
                enrolBtn.addEventListener('click', function (e) { e.preventDefault(); api.sendEnrolmentCode(); });
            }
            var modalEl = document.getElementById('userModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        /**
         * Renders the read-only WhatsApp enrolment state for the user being edited.
         *
         * Hidden entirely while ADDING: a code is bound to an existing user id, so there is
         * nothing to enrol against until Save has created the row.
         *
         * Deliberately does NOT compare the enrolled number against the Mobile Number box. Both
         * are shown instead, so a mismatch is visible without this file carrying a second copy
         * of the repo's phone normaliser - the canonical form is the database's
         * chat_normalize_phone, and scripts/verify-report-whatsapp-parity.mjs exists precisely to
         * stop that function being re-implemented in more places.
         */
        renderEnrolmentStatus: function (user) {
            var section = document.getElementById('whatsappEnrolSection');
            var statusEl = document.getElementById('whatsappEnrolStatus');
            var helpEl = document.getElementById('whatsappEnrolHelp');
            if (!section) return;

            if (!user || !user.id) {
                section.style.display = 'none';
                return;
            }
            section.style.display = '';

            var verifiedAt = user.whatsapp_phone_verified_at || null;
            var enrolledPhone = user.whatsapp_phone || '';
            var pill = function (state, label) {
                return (typeof MacStatus !== 'undefined' && MacStatus.pill)
                    ? MacStatus.pill(state, label)
                    : '<span class="mac-pill mac-pill-neutral">' + escapeHtml(label) + '</span>';
            };

            if (verifiedAt && enrolledPhone) {
                // pill() escapes its own label; enrolledPhone goes in as text, never as markup.
                if (statusEl) statusEl.innerHTML = pill('active', 'Enrolled');
                if (helpEl) {
                    helpEl.textContent = 'This person can use WhatsApp from ' + enrolledPhone +
                        '. Sending a new code re-links their access to the Mobile Number above.';
                }
            } else {
                if (statusEl) statusEl.innerHTML = pill('none', 'Not enrolled');
                if (helpEl) {
                    helpEl.textContent = 'They cannot use WhatsApp yet. Ask them to send any ' +
                        'message to the Macavation WhatsApp number, then send them a code - they ' +
                        'reply with the 6 digits to finish.';
                }
            }
        },

        /**
         * Texts a fresh enrolment code to the Mobile Number on screen.
         *
         * Sends the number as typed and lets the database canonicalise it (see
         * renderEnrolmentStatus). The code itself never reaches this browser.
         */
        sendEnrolmentCode: async function () {
            var form = document.getElementById('userForm');
            var editingId = form && form.getAttribute('data-editing-id');
            if (!editingId) {
                api.showError('Save the user first, then send an enrolment code.');
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.sendWhatsappEnrolmentCode) {
                api.showError('WhatsApp enrolment is not available in this build.');
                return;
            }

            var phone = ((document.getElementById('txtMobile') || {}).value || '').trim();
            if (!phone) {
                api.showError('Enter a Mobile Number first - that is the number the code is sent to.');
                return;
            }

            var btn = document.getElementById('btnSendEnrolCode');
            var originalHtml = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Sending...';
            }

            try {
                var result = await dataFunctions.sendWhatsappEnrolmentCode(editingId, phone);
                if (result && result.success) {
                    api.showSuccess('Code sent to ' + (result.phone_masked || phone) +
                        '. They have ' + (result.expires_in_minutes || 15) +
                        ' minutes to reply with the 6 digits.');
                } else {
                    // window_closed is the common, actionable refusal: WhatsApp will not let us
                    // message someone who has not messaged us in the last 24 hours, and this
                    // channel has no approved template to open a window with. The edge function's
                    // error text already says what to do, so show it rather than a generic
                    // failure.
                    api.showError((result && result.error) || 'Could not send the enrolment code.');
                }
            } catch (e) {
                console.error('Error sending enrolment code:', e);
                api.showError('Could not send the enrolment code: ' + (e.message || ''));
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            }
        },

        show: async function (user) {
            if (user && typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageUser(user)) {
                api.showError('You do not have permission to manage this user.');
                return;
            }
            var title = document.getElementById('userModalLabel');
            if (title) title.textContent = user ? 'Edit User' : 'Add User';
            api.clearForm();
            var form = document.getElementById('userForm');
            if (form) form.removeAttribute('data-editing-id');
            if (user) {
                if (form && user.id) form.setAttribute('data-editing-id', user.id);
                if (typeof $ !== 'undefined') {
                    $('#email').val(((user.email || user.email_address || '') + '').trim().toLowerCase());
                    $('#firstName').val(user.first_name || user.firstName || user.firstname || '');
                    $('#lastName').val(user.last_name || user.lastName || user.lastname || '');
                    $('#txtMobile').val(user.mobile_number || user.mobileNumber || '');
                    $('#cboRole').val(user.role_id || user.roleId || '');
                    $('#isActive').prop('checked', user.is_active !== undefined ? user.is_active : true);
                    $('#password').val('');
                    $('#txtConfirmPassword').val('');
                }
            }
            // After the fields are populated, and for the add case too (which hides it).
            api.renderEnrolmentStatus(user);
            try {
                await api.loadRolesForDropdown();
                if (user && typeof $ !== 'undefined') {
                    $('#cboRole').val(user.role_id || user.roleId || '');
                }
            } catch (e) { console.error('Error loading roles:', e); }
            if (typeof $ !== 'undefined') {
                if (user) {
                    $('#passwordSection').show();
                    $('#confirmPasswordSection').show();
                    $('#password').prop('required', false);
                    $('#txtConfirmPassword').prop('required', false);
                    $('#passwordLabel').removeClass('required');
                    $('#confirmPasswordLabel').removeClass('required');
                    $('#passwordHelp').text('Leave blank to keep current password');
                } else {
                    $('#passwordSection').show();
                    $('#confirmPasswordSection').show();
                    $('#password').prop('required', true);
                    $('#txtConfirmPassword').prop('required', true);
                    $('#passwordLabel').addClass('required');
                    $('#confirmPasswordLabel').addClass('required');
                    $('#passwordHelp').text('Password is required for new users');
                }
            }
            var modalEl = document.getElementById('userModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#userModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('userForm');
            if (form) { form.reset(); form.removeAttribute('data-editing-id'); }
            if (typeof $ !== 'undefined') $('#isActive').prop('checked', true);
            // form.reset() only restores input values; it does not clear script-set innerHTML or
            // an inline display style. Left as-is, a stale "Enrolled" pill from the last user
            // edited would show on the next one opened.
            var section = document.getElementById('whatsappEnrolSection');
            if (section) section.style.display = 'none';
            var statusEl = document.getElementById('whatsappEnrolStatus');
            if (statusEl) statusEl.textContent = '';
            var helpEl = document.getElementById('whatsappEnrolHelp');
            if (helpEl) helpEl.textContent = '';
        },

        loadRolesForDropdown: async function () {
            var select = document.getElementById('cboRole');
            if (!select || typeof dataFunctions === 'undefined' || !dataFunctions.getRoles) return;
            var roles = await (dataFunctions.getRolesForAssignment
                ? dataFunctions.getRolesForAssignment()
                : dataFunctions.getRoles());
            var html = '<option value="">Select Role</option>';
            if (roles && Array.isArray(roles)) {
                roles.forEach(function (role) {
                    html += '<option value="' + escapeHtml(role.id) + '" data-role-name="' + escapeHtml(role.role_name || '') + '">' + escapeHtml(window.formatRoleName(role.role_name || '')) + '</option>';
                });
            }
            select.innerHTML = html;
        },

        save: async function () {
            if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined') return;
            var password = $('#password').val().trim();
            var confirmPassword = $('#txtConfirmPassword').val().trim();
            var emailRaw = $('#email').val().trim();
            var email = emailRaw.toLowerCase();
            $('#email').val(email);
            var formData = {
                email: email,
                first_name: $('#firstName').val().trim(),
                last_name: $('#lastName').val().trim(),
                // Always send the box, even empty - an empty string is how the
                // RPC is told to clear a number, not to leave the old one.
                mobile_number: ($('#txtMobile').val() || '').trim(),
                role_id: $('#cboRole').val(),
                is_active: $('#isActive').is(':checked')
            };
            if (!formData.first_name) {
                api.showError('First name is required');
                return;
            }
            if (!formData.email) {
                api.showError('Email is required');
                return;
            }
            var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(formData.email)) {
                api.showError('Please enter a valid email address');
                return;
            }
            var form = document.getElementById('userForm');
            var editingId = form && form.getAttribute('data-editing-id');
            if (!editingId) {
                if (!password) {
                    api.showError('Password is required for new users');
                    return;
                }
                if (password !== confirmPassword) {
                    api.showError('Passwords do not match');
                    return;
                }
                formData.password = password;
            } else {
                if (password) {
                    if (password !== confirmPassword) {
                        api.showError('Passwords do not match');
                        return;
                    }
                    formData.password = password;
                }
            }
            if (!formData.role_id) {
                api.showError('Role is required');
                return;
            }
            try {
                if (editingId) {
                    await dataFunctions.updateUser(editingId, formData);
                    api.showSuccess('User updated successfully');
                    // If the updated user is the current logged-in user, refresh their feature keys and sidebar
                    var currentUser = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
                    var isCurrentUser = false;
                    if (currentUser && formData.role_id) {
                        var a = String(editingId);
                        if ((currentUser.id && String(currentUser.id) === a) || (currentUser.user_id && String(currentUser.user_id) === a)) {
                            isCurrentUser = true;
                        }
                        if (!isCurrentUser && currentUser.email && formData.email && String(currentUser.email).toLowerCase() === String(formData.email).toLowerCase()) {
                            isCurrentUser = true;
                        }
                    }
                    if (isCurrentUser) {
                        if (currentUser) {
                            currentUser.role_id = formData.role_id;
                            var selectedOption = $('#cboRole option:selected');
                            if (selectedOption.length) currentUser.role_name = (selectedOption.attr('data-role-name') || selectedOption.text()).trim() || currentUser.role_name;
                            if (typeof Session !== 'undefined' && Session.set) Session.set('user', currentUser);
                        }
                        if (typeof authService !== 'undefined' && authService.userInfo) {
                            authService.userInfo.role_id = formData.role_id;
                            if (currentUser && currentUser.role_name) authService.userInfo.role_name = currentUser.role_name;
                        }
                        if (typeof authService !== 'undefined' && authService.fetchAndCacheFeatures) {
                            await authService.fetchAndCacheFeatures(formData.role_id);
                        }
                        if (typeof menuFilter !== 'undefined' && menuFilter.refresh) menuFilter.refresh();
                        if (typeof updateUserDisplay === 'function') updateUserDisplay();
                    }
                } else {
                    await dataFunctions.createUser(formData);
                    api.showSuccess('User created successfully');
                }
                var modalEl = document.getElementById('userModal');
                if (modalEl && typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#userModal').modal('hide');
                if (typeof _usersGrid !== 'undefined' && _usersGrid.loadUsers) _usersGrid.loadUsers();
                if (typeof _adminGrid !== 'undefined' && _adminGrid.loadUsers) _adminGrid.loadUsers();
            } catch (error) {
                console.error('Error saving user:', error);
                api.showError('Error saving user: ' + (error.message || ''));
            }
        },

        showError: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(message, 'error');
            else alert(message);
        },

        showSuccess: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(message, 'success');
            else alert(message);
        }
    };

    return api;
})();
_modal_user.init();
