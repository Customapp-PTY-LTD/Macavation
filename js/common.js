// FruitLive Admin Portal - Common Utilities
// Following WebPortals module pattern

var _common = {
    // Initialize common utilities
    init: function () {
        console.log('Common utilities initialized');
    },

    // Get URL parameters
    getUrlParams: function () {
        const urlParams = new URLSearchParams(window.location.search);
        const params = {};
        for (const [key, value] of urlParams) {
            params[key] = value;
        }
        return params;
    },

    // Show toast message
    showToastMessage: function (message, type = 'info', duration = 3000) {
        if (typeof Swal !== 'undefined') {
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: duration,
                timerProgressBar: true,
                didOpen: (toast) => {
                    toast.addEventListener('mouseenter', Swal.stopTimer);
                    toast.addEventListener('mouseleave', Swal.resumeTimer);
                }
            });

            Toast.fire({
                icon: type,
                title: message
            });
        } else {
            // Fallback to alert
            alert(message);
        }
    },

    // Show success toast
    showSuccessToast: function (message) {
        this.showToastMessage(message, 'success');
    },

    // Show error toast
    showErrorToast: function (message) {
        this.showToastMessage(message, 'error', 5000);
    },

    // Show warning toast
    showWarningToast: function (message) {
        this.showToastMessage(message, 'warning');
    },

    // Show info toast
    showInfoToast: function (message) {
        this.showToastMessage(message, 'info');
    },

    // Validate email
    isValidEmail: function (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    // Validate South African ID number
    isValidSAIdNumber: function (idNumber) {
        // Remove any spaces or dashes
        idNumber = idNumber.replace(/[\s-]/g, '');

        // Check if it's 13 digits
        if (!/^\d{13}$/.test(idNumber)) {
            return false;
        }

        // Luhn algorithm validation
        let sum = 0;
        let isEven = false;

        for (let i = idNumber.length - 1; i >= 0; i--) {
            let digit = parseInt(idNumber[i]);

            if (isEven) {
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }

            sum += digit;
            isEven = !isEven;
        }

        return sum % 10 === 0;
    },

    // Extract date of birth from SA ID number
    extractDateOfBirthFromId: function (idNumber) {
        if (!this.isValidSAIdNumber(idNumber)) {
            return null;
        }

        const year = parseInt(idNumber.substring(0, 2));
        const month = parseInt(idNumber.substring(2, 4));
        const day = parseInt(idNumber.substring(4, 6));

        // Determine century
        const currentYear = new Date().getFullYear();
        const currentCentury = Math.floor(currentYear / 100) * 100;
        const fullYear = year > 50 ? currentCentury - 100 + year : currentCentury + year;

        return new Date(fullYear, month - 1, day);
    },

    // Extract gender from SA ID number
    extractGenderFromId: function (idNumber) {
        if (!this.isValidSAIdNumber(idNumber)) {
            return null;
        }

        const genderDigit = parseInt(idNumber.substring(6, 10));
        return genderDigit >= 5000 ? 'Male' : 'Female';
    },

    // Validate South African mobile number
    isValidSAMobileNumber: function (mobileNumber) {
        // Remove any spaces, dashes, or parentheses
        mobileNumber = mobileNumber.replace(/[\s\-\(\)]/g, '');

        // Check format: +27XXXXXXXXX or 0XXXXXXXXX
        const mobileRegex = /^(\+27|0)[0-9]{9}$/;
        return mobileRegex.test(mobileNumber);
    },

    // Format mobile number
    formatMobileNumber: function (mobileNumber) {
        if (!this.isValidSAMobileNumber(mobileNumber)) {
            return mobileNumber;
        }

        // Remove any spaces, dashes, or parentheses
        mobileNumber = mobileNumber.replace(/[\s\-\(\)]/g, '');

        // Convert to standard format
        if (mobileNumber.startsWith('+27')) {
            return mobileNumber;
        } else if (mobileNumber.startsWith('0')) {
            return '+27' + mobileNumber.substring(1);
        }

        return mobileNumber;
    },

    // Format date for display
    formatDate: function (date, format = 'short') {
        if (!date) return '';

        const d = new Date(date);
        if (isNaN(d.getTime())) return '';

        switch (format) {
            case 'short':
                return d.toLocaleDateString();
            case 'long':
                return d.toLocaleDateString('en-ZA', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            case 'datetime':
                return d.toLocaleString();
            default:
                return d.toLocaleDateString();
        }
    },

    // Format currency
    formatCurrency: function (amount, currency = 'ZAR') {
        if (amount === null || amount === undefined) return '';

        return new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: currency
        }).format(amount);
    },

    // Debounce function
    debounce: function (func, wait, immediate) {
        let timeout;
        return function executedFunction() {
            const context = this;
            const args = arguments;
            const later = function () {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    },

    // Throttle function
    throttle: function (func, limit) {
        let inThrottle;
        return function () {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // Generate GUID
    generateGUID: function () {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // Sanitize HTML
    sanitizeHtml: function (html) {
        const temp = document.createElement('div');
        temp.textContent = html;
        return temp.innerHTML;
    },

    // Copy to clipboard
    copyToClipboard: function (text) {
        if (navigator.clipboard) {
            return navigator.clipboard.writeText(text);
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                return Promise.resolve();
            } catch (err) {
                return Promise.reject(err);
            } finally {
                document.body.removeChild(textArea);
            }
        }
    },

    // Show loading spinner
    showLoading: function (element) {
        if (element) {
            element.classList.add('loading');
            element.style.pointerEvents = 'none';
        }
    },

    // Hide loading spinner
    hideLoading: function (element) {
        if (element) {
            element.classList.remove('loading');
            element.style.pointerEvents = 'auto';
        }
    },

    // Get query parameter
    getQueryParam: function (name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    },

    // Set query parameter
    setQueryParam: function (name, value) {
        const url = new URL(window.location);
        url.searchParams.set(name, value);
        window.history.replaceState({}, '', url);
    },

    // Remove query parameter
    removeQueryParam: function (name) {
        const url = new URL(window.location);
        url.searchParams.delete(name);
        window.history.replaceState({}, '', url);
    },

    // Wait for dataFunctions to be available
    waitForDataFunctions: async function (maxRetries = 50, delay = 100) {
        for (let i = 0; i < maxRetries; i++) {
            if (typeof dataFunctions !== 'undefined' && dataFunctions && typeof dataFunctions.getFarms === 'function') {
                return dataFunctions;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        throw new Error('dataFunctions not available after waiting');
    }
};

// Make _common available globally
window._common = _common;
const common = _common;

// Also add waitForDataFunctions as a standalone global function for convenience
window.waitForDataFunctions = async function (maxRetries = 50, delay = 100) {
    for (let i = 0; i < maxRetries; i++) {
        if (typeof dataFunctions !== 'undefined' && dataFunctions && typeof dataFunctions.getFarms === 'function') {
            return dataFunctions;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('dataFunctions not available after waiting');
};
