/**
 * Data Validation Utilities
 * Ensures accuracy of data captured in various modules
 */

var _dataValidation = function () {
    return {
        /**
         * Validate email address
         */
        validateEmail: function (email) {
            if (!email) return { valid: true, message: '' }; // Optional field
            
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const isValid = emailRegex.test(email);
            
            return {
                valid: isValid,
                message: isValid ? '' : 'Please enter a valid email address'
            };
        },

        /**
         * Validate phone number (South African format)
         */
        validatePhone: function (phone) {
            if (!phone) return { valid: true, message: '' }; // Optional field
            
            // Remove spaces and dashes
            const cleaned = phone.replace(/[\s-]/g, '');
            
            // South African phone format: +27XXXXXXXXX or 0XXXXXXXXX
            const phoneRegex = /^(\+27|0)[0-9]{9}$/;
            const isValid = phoneRegex.test(cleaned);
            
            return {
                valid: isValid,
                message: isValid ? '' : 'Please enter a valid phone number (e.g., +27123456789 or 0123456789)'
            };
        },

        /**
         * Validate required field
         */
        validateRequired: function (value, fieldName = 'This field') {
            const isValid = value !== null && value !== undefined && value !== '';
            
            return {
                valid: isValid,
                message: isValid ? '' : `${fieldName} is required`
            };
        },

        /**
         * Validate number range
         */
        validateNumberRange: function (value, min, max, fieldName = 'Value') {
            if (value === null || value === undefined || value === '') {
                return { valid: true, message: '' }; // Optional field
            }

            const num = parseFloat(value);
            const isValid = !isNaN(num) && num >= min && num <= max;
            
            return {
                valid: isValid,
                message: isValid ? '' : `${fieldName} must be between ${min} and ${max}`
            };
        },

        /**
         * Validate positive number
         */
        validatePositiveNumber: function (value, fieldName = 'Value') {
            if (value === null || value === undefined || value === '') {
                return { valid: true, message: '' }; // Optional field
            }

            const num = parseFloat(value);
            const isValid = !isNaN(num) && num > 0;
            
            return {
                valid: isValid,
                message: isValid ? '' : `${fieldName} must be a positive number`
            };
        },

        /**
         * Validate date
         */
        validateDate: function (date, fieldName = 'Date') {
            if (!date) return { valid: true, message: '' }; // Optional field
            
            const dateObj = new Date(date);
            const isValid = dateObj instanceof Date && !isNaN(dateObj.getTime());
            
            return {
                valid: isValid,
                message: isValid ? '' : `Please enter a valid ${fieldName.toLowerCase()}`
            };
        },

        /**
         * Validate date range
         */
        validateDateRange: function (startDate, endDate, fieldName = 'Date range') {
            if (!startDate || !endDate) {
                return { valid: true, message: '' }; // Optional fields
            }

            const start = new Date(startDate);
            const end = new Date(endDate);
            
            const isValid = start <= end;
            
            return {
                valid: isValid,
                message: isValid ? '' : `End ${fieldName.toLowerCase()} must be after start date`
            };
        },

        /**
         * Validate percentage (0-100)
         */
        validatePercentage: function (value, fieldName = 'Percentage') {
            return this.validateNumberRange(value, 0, 100, fieldName);
        },

        /**
         * Validate weight (positive number, reasonable max)
         */
        validateWeight: function (value, maxWeight = 100000, fieldName = 'Weight') {
            if (value === null || value === undefined || value === '') {
                return { valid: true, message: '' }; // Optional field
            }

            const num = parseFloat(value);
            const isValid = !isNaN(num) && num > 0 && num <= maxWeight;
            
            return {
                valid: isValid,
                message: isValid ? '' : `${fieldName} must be between 0 and ${maxWeight} kg`
            };
        },

        /**
         * Validate moisture content (0-100%)
         */
        validateMoistureContent: function (value) {
            return this.validatePercentage(value, 'Moisture content');
        },

        /**
         * Validate batch number format
         */
        validateBatchNumber: function (batchNumber) {
            if (!batchNumber) return { valid: true, message: '' }; // Optional field
            
            // Batch number should be alphanumeric, reasonable length
            const batchRegex = /^[A-Z0-9-]{3,50}$/i;
            const isValid = batchRegex.test(batchNumber);
            
            return {
                valid: isValid,
                message: isValid ? '' : 'Batch number must be 3-50 alphanumeric characters'
            };
        },

        /**
         * Validate grower intake data
         */
        validateGrowerIntake: function (data) {
            const errors = [];

            // Validate required fields
            if (!data.grower_name || data.grower_name.trim() === '') {
                errors.push('Grower name is required');
            }

            if (!data.delivery_date) {
                errors.push('Delivery date is required');
            } else {
                const dateValidation = this.validateDate(data.delivery_date, 'Delivery date');
                if (!dateValidation.valid) {
                    errors.push(dateValidation.message);
                }
            }

            // Validate weight
            if (data.wet_nut_in_shell_kg !== undefined && data.wet_nut_in_shell_kg !== null) {
                const weightValidation = this.validateWeight(data.wet_nut_in_shell_kg, 100000, 'Wet nut weight');
                if (!weightValidation.valid) {
                    errors.push(weightValidation.message);
                }
            }

            // Validate moisture content
            if (data.moisture_content_percentage !== undefined && data.moisture_content_percentage !== null) {
                const moistureValidation = this.validateMoistureContent(data.moisture_content_percentage);
                if (!moistureValidation.valid) {
                    errors.push(moistureValidation.message);
                }
            }

            return {
                valid: errors.length === 0,
                errors: errors
            };
        },

        /**
         * Validate quality test data
         */
        validateQualityTest: function (data) {
            const errors = [];

            if (!data.test_type || data.test_type.trim() === '') {
                errors.push('Test type is required');
            }

            if (!data.batch_number || data.batch_number.trim() === '') {
                errors.push('Batch number is required');
            } else {
                const batchValidation = this.validateBatchNumber(data.batch_number);
                if (!batchValidation.valid) {
                    errors.push(batchValidation.message);
                }
            }

            if (data.test_date) {
                const dateValidation = this.validateDate(data.test_date, 'Test date');
                if (!dateValidation.valid) {
                    errors.push(dateValidation.message);
                }
            }

            return {
                valid: errors.length === 0,
                errors: errors
            };
        },

        /**
         * Validate stock item data
         */
        validateStockItem: function (data) {
            const errors = [];

            if (!data.item_name || data.item_name.trim() === '') {
                errors.push('Item name is required');
            }

            if (data.quantity !== undefined && data.quantity !== null) {
                const quantityValidation = this.validatePositiveNumber(data.quantity, 'Quantity');
                if (!quantityValidation.valid) {
                    errors.push(quantityValidation.message);
                }
            }

            if (data.unit_price !== undefined && data.unit_price !== null) {
                const priceValidation = this.validatePositiveNumber(data.unit_price, 'Unit price');
                if (!priceValidation.valid) {
                    errors.push(priceValidation.message);
                }
            }

            return {
                valid: errors.length === 0,
                errors: errors
            };
        },

        /**
         * Validate form field in real-time
         */
        validateField: function (field, value, rules) {
            const errors = [];

            // Required validation
            if (rules.required) {
                const requiredValidation = this.validateRequired(value, rules.fieldName || field);
                if (!requiredValidation.valid) {
                    errors.push(requiredValidation.message);
                }
            }

            // Type-specific validations
            if (value && value !== '') {
                if (rules.type === 'email') {
                    const emailValidation = this.validateEmail(value);
                    if (!emailValidation.valid) {
                        errors.push(emailValidation.message);
                    }
                }

                if (rules.type === 'phone') {
                    const phoneValidation = this.validatePhone(value);
                    if (!phoneValidation.valid) {
                        errors.push(phoneValidation.message);
                    }
                }

                if (rules.type === 'number' || rules.type === 'weight') {
                    const numValidation = rules.type === 'weight' 
                        ? this.validateWeight(value, rules.max, rules.fieldName)
                        : this.validatePositiveNumber(value, rules.fieldName);
                    if (!numValidation.valid) {
                        errors.push(numValidation.message);
                    }
                }

                if (rules.type === 'percentage') {
                    const percentageValidation = this.validatePercentage(value, rules.fieldName);
                    if (!percentageValidation.valid) {
                        errors.push(percentageValidation.message);
                    }
                }

                if (rules.minLength && value.length < rules.minLength) {
                    errors.push(`${rules.fieldName || field} must be at least ${rules.minLength} characters`);
                }

                if (rules.maxLength && value.length > rules.maxLength) {
                    errors.push(`${rules.fieldName || field} must be no more than ${rules.maxLength} characters`);
                }
            }

            return {
                valid: errors.length === 0,
                errors: errors
            };
        },

        /**
         * Show validation errors in UI
         */
        showValidationErrors: function (errors, containerId = null) {
            if (errors.length === 0) return;

            const errorMessage = errors.join('<br>');
            
            if (containerId) {
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = `<div class="alert alert-danger">${errorMessage}</div>`;
                    return;
                }
            }

            // Use SweetAlert if available
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'Validation Error',
                    html: errorMessage
                });
            } else {
                alert(errorMessage);
            }
        },

        /**
         * Clear validation errors from UI
         */
        clearValidationErrors: function (containerId) {
            if (containerId) {
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = '';
                }
            }
        }
    };
}();

// Create global instance
const dataValidation = _dataValidation;
window.dataValidation = dataValidation;

