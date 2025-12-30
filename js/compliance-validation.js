/**
 * Embedded Compliance Validation
 * Implements Process-Driven Design: Embedded Compliance
 * Provides inline validation and blocking of non-compliant actions
 */

var _complianceValidation = function () {
    return {
        /**
         * Check compliance requirements for an action
         */
        checkCompliance: async function (entityType, action, data) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const result = await dataFunctions.callFunction('check_compliance', {
                        p_entity_type: entityType,
                        p_action: action,
                        p_data: JSON.stringify(data)
                    }, null, { useCache: false });
                    return result || { compliant: true, violations: [] };
                }
                return { compliant: true, violations: [] };
            } catch (error) {
                console.error('Error checking compliance:', error);
                return { compliant: true, violations: [] };
            }
        },

        /**
         * Get expiring certifications
         */
        getExpiringCertifications: async function (daysAhead = 30) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const certs = await dataFunctions.callFunction('get_expiring_certifications', {
                        p_days_ahead: daysAhead
                    }, null, {
                        cacheKey: `expiring_certs_${daysAhead}`,
                        useCache: true,
                        cacheTtl: 3600000 // 1 hour
                    });
                    return certs || [];
                }
                return [];
            } catch (error) {
                console.error('Error getting expiring certifications:', error);
                return [];
            }
        },

        /**
         * Validate form before submission
         */
        validateForm: async function (formId, entityType, action) {
            const form = document.getElementById(formId);
            if (!form) return { valid: false, message: 'Form not found' };

            // Get form data
            const formData = new FormData(form);
            const data = {};
            for (const [key, value] of formData.entries()) {
                data[key] = value;
            }

            // Check compliance
            const compliance = await this.checkCompliance(entityType, action, data);

            if (!compliance.compliant) {
                // Show violations
                this.showComplianceViolations(compliance.violations, formId);
                return {
                    valid: false,
                    compliant: false,
                    violations: compliance.violations
                };
            }

            return {
                valid: true,
                compliant: true,
                violations: []
            };
        },

        /**
         * Show compliance violations
         */
        showComplianceViolations: function (violations, formId) {
            const form = document.getElementById(formId);
            if (!form) return;

            // Remove existing violation panel
            const existingPanel = document.getElementById('compliance-violations-panel');
            if (existingPanel) {
                existingPanel.remove();
            }

            if (!violations || violations.length === 0) return;

            // Create violation panel
            const panel = document.createElement('div');
            panel.id = 'compliance-violations-panel';
            panel.className = 'alert alert-danger mt-3';
            panel.innerHTML = `
                <h6 class="alert-heading">
                    <i class="bi bi-shield-exclamation-fill me-2"></i>
                    Compliance Violations Detected
                </h6>
                <p class="mb-2">The following compliance requirements are not met:</p>
                <ul class="mb-0">
                    ${violations.map(violation => `
                        <li>
                            <strong>${violation.requirement || 'Requirement'}:</strong> 
                            ${violation.message || violation.description}
                            ${violation.resolution ? `
                                <div class="mt-1">
                                    <small><strong>Resolution:</strong> ${violation.resolution}</small>
                                </div>
                            ` : ''}
                        </li>
                    `).join('')}
                </ul>
                <hr>
                <p class="mb-0 small">
                    <strong>Action:</strong> Please resolve these violations before proceeding.
                </p>
            `;

            // Insert before form submit button or at end of form
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.parentNode.insertBefore(panel, submitButton);
            } else {
                form.appendChild(panel);
            }

            // Scroll to violations
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        },

        /**
         * Block non-compliant action
         */
        blockAction: function (violations, actionName) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'Compliance Violation',
                    html: `
                        <p>The action "${actionName}" cannot be performed due to compliance violations:</p>
                        <ul class="text-start">
                            ${violations.map(v => `<li>${v.message || v.description}</li>`).join('')}
                        </ul>
                        <p class="mt-3">Please resolve these issues before proceeding.</p>
                    `,
                    confirmButtonText: 'OK'
                });
            } else {
                alert(`Compliance violation: ${violations.map(v => v.message).join(', ')}`);
            }
        },

        /**
         * Show expiring certifications
         */
        showExpiringCertifications: async function (containerId, daysAhead = 30) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const certs = await this.getExpiringCertifications(daysAhead);

            if (!certs || certs.length === 0) {
                container.innerHTML = '<div class="alert alert-success">No certifications expiring soon.</div>';
                return;
            }

            const html = `
                <div class="expiring-certifications">
                    <h6 class="mb-3">
                        <i class="bi bi-calendar-x me-2"></i>
                        Certifications Expiring (${daysAhead} days)
                    </h6>
                    <div class="cert-list">
                        ${certs.map(cert => `
                            <div class="cert-item cert-${this.getCertSeverity(cert.days_until_expiry)}" data-cert-id="${cert.id}">
                                <div class="d-flex justify-content-between align-items-start">
                                    <div>
                                        <strong>${cert.name || cert.title}</strong>
                                        <div class="text-muted small">${cert.description || ''}</div>
                                        <div class="text-muted small">
                                            <i class="bi bi-calendar me-1"></i>
                                            Expires: ${new Date(cert.expiry_date).toLocaleDateString()}
                                            (${cert.days_until_expiry} days)
                                        </div>
                                    </div>
                                    <button class="btn btn-sm btn-outline-warning" 
                                            onclick="complianceValidation.renewCertification('${cert.id}')">
                                        Renew
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        /**
         * Get certification severity
         */
        getCertSeverity: function (daysUntilExpiry) {
            if (daysUntilExpiry <= 7) return 'critical';
            if (daysUntilExpiry <= 30) return 'warning';
            return 'info';
        },

        /**
         * Renew certification
         */
        renewCertification: function (certId) {
            // Navigate to certification renewal
            if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                _appRouter.loadContent('certifications-grid', { id: certId, action: 'renew' });
            }
        },

        /**
         * Add compliance check to form submit
         */
        attachComplianceCheck: function (formId, entityType, action) {
            const form = document.getElementById(formId);
            if (!form) return;

            form.addEventListener('submit', async (e) => {
                e.preventDefault();

                // Validate compliance
                const validation = await this.validateForm(formId, entityType, action);

                if (!validation.compliant) {
                    // Block submission
                    this.blockAction(validation.violations, action);
                    return false;
                }

                // If compliant, proceed with form submission
                // You may need to call the original submit handler here
                return true;
            });
        },

        /**
         * Check field-level compliance
         */
        checkFieldCompliance: async function (fieldName, value, entityType) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const result = await dataFunctions.callFunction('check_field_compliance', {
                        p_field_name: fieldName,
                        p_value: value,
                        p_entity_type: entityType
                    }, null, { useCache: false });
                    return result || { compliant: true, message: null };
                }
                return { compliant: true, message: null };
            } catch (error) {
                console.error('Error checking field compliance:', error);
                return { compliant: true, message: null };
            }
        },

        /**
         * Show field-level compliance feedback
         */
        showFieldComplianceFeedback: function (fieldId, compliant, message) {
            const field = document.getElementById(fieldId);
            if (!field) return;

            // Remove existing feedback
            const existingFeedback = field.parentNode.querySelector('.compliance-feedback');
            if (existingFeedback) {
                existingFeedback.remove();
            }

            // Remove existing classes
            field.classList.remove('is-valid', 'is-invalid');

            if (!compliant && message) {
                // Add invalid class
                field.classList.add('is-invalid');

                // Add feedback element
                const feedback = document.createElement('div');
                feedback.className = 'compliance-feedback invalid-feedback';
                feedback.textContent = message;
                field.parentNode.appendChild(feedback);
            } else {
                field.classList.add('is-valid');
            }
        }
    };
}();

// Create global instance
const complianceValidation = _complianceValidation;
window.complianceValidation = complianceValidation;

