/**
 * Offline Helpers for Modules
 * Utility functions to easily integrate offline capabilities into modules
 */

var _offlineHelpers = function () {
    return {
        /**
         * Save form data as draft when user is typing (auto-save)
         */
        autoSaveFormDraft: function (module, formId, formData, debounceMs = 2000) {
            let timeoutId = null;

            return function () {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(async () => {
                    if (typeof offlineStorage !== 'undefined') {
                        try {
                            await offlineStorage.saveFormDraft(module, formId, formData);
                            console.log(`[Offline Helper] Auto-saved draft for ${module}:${formId}`);
                        } catch (error) {
                            console.error('[Offline Helper] Failed to save draft:', error);
                        }
                    }
                }, debounceMs);
            };
        },

        /**
         * Load form draft when form is opened
         */
        loadFormDraft: async function (module, formId, formElement) {
            if (typeof offlineStorage === 'undefined') {
                return null;
            }

            try {
                const draft = await offlineStorage.getFormDraft(module, formId);
                
                if (draft && draft.formData) {
                    // Populate form fields
                    Object.keys(draft.formData).forEach(key => {
                        const field = formElement.querySelector(`[name="${key}"], #${key}`);
                        if (field) {
                            if (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA') {
                                field.value = draft.formData[key];
                            } else if (field.tagName === 'SELECT') {
                                field.value = draft.formData[key];
                            }
                        }
                    });

                    // Show notification
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'info',
                            title: 'Draft Restored',
                            text: 'Your previous form data has been restored.',
                            timer: 3000,
                            showConfirmButton: false,
                            toast: true,
                            position: 'top-end'
                        });
                    }

                    return draft.formData;
                }
            } catch (error) {
                console.error('[Offline Helper] Failed to load draft:', error);
            }

            return null;
        },

        /**
         * Clear form draft after successful save
         */
        clearFormDraft: async function (module, formId) {
            if (typeof offlineStorage === 'undefined') {
                return;
            }

            try {
                await offlineStorage.deleteFormDraft(module, formId);
                console.log(`[Offline Helper] Cleared draft for ${module}:${formId}`);
            } catch (error) {
                console.error('[Offline Helper] Failed to clear draft:', error);
            }
        },

        /**
         * Show offline warning in form
         */
        showOfflineWarning: function (containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const warning = document.createElement('div');
            warning.className = 'form-offline-warning';
            warning.id = 'offline-form-warning';
            warning.innerHTML = `
                <i class="fas fa-wifi-slash"></i>
                <p>You are offline. Your data will be saved locally and synced when you're back online.</p>
            `;

            // Remove existing warning if any
            const existing = container.querySelector('#offline-form-warning');
            if (existing) {
                existing.remove();
            }

            container.insertBefore(warning, container.firstChild);
        },

        /**
         * Hide offline warning
         */
        hideOfflineWarning: function () {
            const warning = document.getElementById('offline-form-warning');
            if (warning) {
                warning.remove();
            }
        },

        /**
         * Validate form data before saving
         */
        validateFormData: function (formData, validationRules) {
            const errors = [];

            Object.keys(validationRules).forEach(field => {
                const rules = validationRules[field];
                const value = formData[field];

                if (typeof dataValidation !== 'undefined') {
                    const validation = dataValidation.validateField(field, value, rules);
                    if (!validation.valid) {
                        errors.push(...validation.errors);
                    }
                }
            });

            return {
                valid: errors.length === 0,
                errors: errors
            };
        },

        /**
         * Save data with offline support
         */
        saveDataWithOfflineSupport: async function (module, saveFunction, formData, validationRules = null) {
            // Validate if rules provided
            if (validationRules) {
                const validation = this.validateFormData(formData, validationRules);
                if (!validation.valid) {
                    if (typeof dataValidation !== 'undefined') {
                        dataValidation.showValidationErrors(validation.errors);
                    }
                    return {
                        success: false,
                        errors: validation.errors
                    };
                }
            }

            // Check if offline
            const isOffline = !navigator.onLine;

            if (isOffline) {
                // Show offline warning
                this.showOfflineWarning('content-area');
            } else {
                this.hideOfflineWarning();
            }

            try {
                // Call save function (which will queue if offline)
                const result = await saveFunction(formData);

                // If queued, save to offline storage as well
                if (result && result.queued) {
                    if (typeof offlineStorage !== 'undefined') {
                        await offlineStorage.saveOfflineData(module, formData, {
                            functionName: saveFunction.name || 'save',
                            timestamp: Date.now()
                        });
                    }

                    // Show success message
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Data Saved',
                            html: `
                                <p>Your data has been saved locally.</p>
                                <p class="text-muted small mt-2">It will be synced when you're back online.</p>
                            `,
                            timer: 4000,
                            showConfirmButton: true
                        });
                    }
                }

                return result;
            } catch (error) {
                console.error('[Offline Helper] Error saving data:', error);
                
                // If offline, try to save locally anyway
                if (isOffline && typeof offlineStorage !== 'undefined') {
                    try {
                        await offlineStorage.saveOfflineData(module, formData, {
                            functionName: saveFunction.name || 'save',
                            timestamp: Date.now(),
                            error: error.message
                        });

                        if (typeof Swal !== 'undefined') {
                            Swal.fire({
                                icon: 'info',
                                title: 'Saved Offline',
                                text: 'Your data has been saved locally and will be synced when online.',
                                timer: 4000,
                                showConfirmButton: true
                            });
                        }

                        return {
                            success: true,
                            offline: true,
                            queued: true
                        };
                    } catch (storageError) {
                        console.error('[Offline Helper] Failed to save offline:', storageError);
                    }
                }

                throw error;
            }
        },

        /**
         * Get offline data count for a module
         */
        getOfflineDataCount: async function (module) {
            if (typeof offlineStorage === 'undefined') {
                return 0;
            }

            try {
                const data = await offlineStorage.getOfflineData(module, false);
                return data ? data.length : 0;
            } catch (error) {
                console.error('[Offline Helper] Failed to get offline data count:', error);
                return 0;
            }
        },

        /**
         * Show sync status badge
         */
        showSyncStatusBadge: function (containerId, status) {
            const container = document.getElementById(containerId);
            if (!container) return;

            let badge = container.querySelector('.sync-status-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'sync-status-badge';
                container.appendChild(badge);
            }

            badge.className = `sync-status-badge ${status}`;

            switch (status) {
                case 'syncing':
                    badge.innerHTML = '<i class="fas fa-sync fa-spin"></i> Syncing...';
                    break;
                case 'success':
                    badge.innerHTML = '<i class="fas fa-check-circle"></i> Synced';
                    setTimeout(() => badge.remove(), 3000);
                    break;
                case 'error':
                    badge.innerHTML = '<i class="fas fa-exclamation-circle"></i> Sync Failed';
                    break;
            }
        }
    };
}();

// Create global instance
const offlineHelpers = _offlineHelpers;
window.offlineHelpers = offlineHelpers;

