// Macavation Admin Portal - Common Utilities
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

    // Format Date or ISO string as dd/mm/yyyy (use for display; see SEPARATING_LARGE_JS_FILES.md)
    formatDateDDMMYYYY: function (value) {
        if (!value) return '';
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) return '';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
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

    // Strict HTML escape for interpolation into markup, including attribute values.
    // Escapes all five characters: & < > " '. Prefer this over sanitizeHtml, which
    // uses textContent/innerHTML and therefore does NOT escape quotes — unsafe when
    // the result lands inside an attribute. Ampersand must be replaced first.
    escapeHtml: function (value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
            if (typeof dataFunctions !== 'undefined' && dataFunctions && typeof dataFunctions.getContacts === 'function') {
                return dataFunctions;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        throw new Error('dataFunctions not available after waiting');
    },

    /**
     * Safely call a dataFunctions method with authentication error handling
     * @param {Function} dataFunction - The dataFunctions method to call
     * @param {*} defaultValue - Default value to return on authentication error
     * @param {string} authMessage - Message to show on authentication error
     * @returns {Promise<*>} The result or defaultValue on auth error
     */
    safeDataCall: async function (dataFunction, defaultValue = null, authMessage = 'Please log in to access this data') {
        try {
            return await dataFunction();
        } catch (error) {
            // Handle authentication errors gracefully
            if (error.message && (error.message.includes('token') || error.message.includes('Unauthorized') || error.status === 401)) {
                console.warn('Authentication required:', authMessage);
                return defaultValue;
            }
            // Re-throw other errors
            throw error;
        }
    },

    /**
     * Upload a file to S3 via the fileupload API (FormData).
     * See S3-UPLOAD-GUIDE.md for API contract.
     * @param {Object} params
     * @param {File} params.file - File object to upload
     * @param {string} [params.resourceFolder='EFS Assist/PreInspections/'] - S3 resource folder
     * @param {string} [params.fileId] - Filename / identifier (defaults to file.name)
     * @returns {Promise<{Success: boolean, LastErrorDescription: string, Data: object}>}
     */
    uploadFile: async function (params) {
        const file = params && params.file;
        const resourceFolder = (params && params.resourceFolder) || 'Macavation';
        const fileId = (params && params.fileId) || (file && file.name) || 'upload';
        const FILE_UPLOAD_URL = 'https://yzz5sh6s74.execute-api.af-south-1.amazonaws.com/v1/fileupload';
        const MAX_FILE_BYTES = 6 * 1024 * 1024; // 6 MB — API Gateway REST payload limit
        const MAX_FILE_MB = 6;

        function sizeErrorMessage(bytes) {
            return 'File too large (' + (bytes / (1024 * 1024)).toFixed(1) + ' MB). Maximum upload size is ' + MAX_FILE_MB + ' MB.';
        }

        if (!file || !(file instanceof File)) {
            return { Success: false, LastErrorDescription: 'No file provided', Data: [] };
        }

        if (file.size > MAX_FILE_BYTES) {
            return { Success: false, LastErrorDescription: sizeErrorMessage(file.size), Data: [] };
        }

        const formdata = new FormData();
        formdata.append('files', file);
        formdata.append('resourceFolder', resourceFolder);
        formdata.append('fileId', fileId);
        formdata.append('fileSize', String(file.size));
        formdata.append('chunkCount', '1');
        formdata.append('chunkIndex', '0');

        try {
            const response = await fetch(FILE_UPLOAD_URL, {
                method: 'POST',
                body: formdata,
                redirect: 'follow'
            });
            if (response.status === 413) {
                return { Success: false, LastErrorDescription: sizeErrorMessage(file.size), Data: [] };
            }
            if (!response.ok) {
                return { Success: false, LastErrorDescription: 'Upload server returned error ' + response.status + '.', Data: [] };
            }
            const text = await response.text();
            const result = JSON.parse(text);
            if (result.error) {
                return { Success: false, LastErrorDescription: result.error, Data: [] };
            }
            return { Success: true, LastErrorDescription: '', Data: result };
        } catch (err) {
            const msg = err && err.message ? err.message : '';
            // "Failed to fetch" in a CORS context usually means the server rejected (e.g. 413) but
            // the browser could not read the error response due to missing CORS headers.
            if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')) {
                return { Success: false, LastErrorDescription: sizeErrorMessage(file.size), Data: [] };
            }
            return { Success: false, LastErrorDescription: msg || 'Upload failed', Data: [] };
        }
    },

    /**
     * Force-close any stuck Bootstrap modals/backdrops and restore page scroll.
     * This is a safety hatch for cases where a modal fails to close cleanly and leaves the UI "dark".
     */
    forceCloseAllModals: function () {
        try {
            // Close via Bootstrap API if available
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                document.querySelectorAll('.modal').forEach((modalEl) => {
                    const instance = bootstrap.Modal.getInstance(modalEl);
                    if (instance) {
                        try { instance.hide(); } catch (e) { /* ignore */ }
                    }
                });
            }

            // Hard cleanup: hide any visible modals
            document.querySelectorAll('.modal.show').forEach((modalEl) => {
                modalEl.classList.remove('show');
                modalEl.style.display = 'none';
                modalEl.setAttribute('aria-hidden', 'true');
            });

            // Remove backdrops
            document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.remove());

            // Restore body state
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        } catch (e) {
            console.warn('[Common] forceCloseAllModals failed:', e);
        }
    }
};

// Make _common available globally
window._common = _common;
const common = _common;
// Provide a simple global alias for emergency cleanup
window.forceCloseAllModals = function () {
    if (window._common && typeof window._common.forceCloseAllModals === 'function') {
        window._common.forceCloseAllModals();
    }
};

// Also add waitForDataFunctions as a standalone global function for convenience
window.waitForDataFunctions = async function (maxRetries = 50, delay = 100) {
    for (let i = 0; i < maxRetries; i++) {
        if (typeof dataFunctions !== 'undefined' && dataFunctions && typeof dataFunctions.getContacts === 'function') {
            return dataFunctions;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('dataFunctions not available after waiting');
};
