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

    // Kernel shelf life in months. Single source of truth for Best Before: the job card,
    // the production-stages roll-up and the get_kernel_batches fallback must all agree.
    // Change it here only, and keep the SQL fallback in step (see migrations, get_kernel_batches).
    KERNEL_BEST_BEFORE_MONTHS: 24,

    // Add whole months to a YYYY-MM-DD string using local date parts only. Deliberately avoids
    // toISOString(), which turns a local-midnight Date into the previous day in SAST (UTC+2).
    // Returns YYYY-MM-DD or null.
    addMonthsToISODate: function (isoStr, months) {
        if (!isoStr) return null;
        const s = String(isoStr).trim().split('T')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        const parts = s.split('-');
        let y = parseInt(parts[0], 10);
        let m = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const add = parseInt(months, 10);
        if (isNaN(y) || isNaN(m) || isNaN(day) || isNaN(add)) return null;
        m += add;
        y += Math.floor(m / 12);
        m = m % 12;
        if (m < 0) { m += 12; y -= 1; }
        const d = new Date(y, m, day);
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },

    // Best Before for a kernel batch = packing start date + KERNEL_BEST_BEFORE_MONTHS.
    // Returns YYYY-MM-DD or null.
    kernelBestBeforeFromPackingStart: function (packingStartISO) {
        return _common.addMonthsToISODate(packingStartISO, _common.KERNEL_BEST_BEFORE_MONTHS);
    },

    // ---- Kernel pipeline config (shelf life, spec limits, Time Left bands) ----
    // Cached in memory. Resolves to the config object or null on ANY failure (old DB, no permission).
    _kernelPipelineConfigPromise: null,
    loadKernelPipelineConfig: function (force) {
        if (_common._kernelPipelineConfigPromise && !force) return _common._kernelPipelineConfigPromise;
        const p = Promise.resolve().then(function () {
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.getKernelPipelineConfig !== 'function') return null;
            return dataFunctions.getKernelPipelineConfig();
        }).then(function (cfg) {
            if (!cfg || cfg.success === false) return null;
            const m = cfg.settings ? parseInt(cfg.settings.kernel_best_before_months, 10) : NaN;
            if (!isNaN(m) && m >= 1 && m <= 60) _common.KERNEL_BEST_BEFORE_MONTHS = m;
            return cfg;
        }).catch(function () { return null; });
        _common._kernelPipelineConfigPromise = p;
        // Do not cache a failure: the next caller retries.
        p.then(function (cfg) { if (!cfg && _common._kernelPipelineConfigPromise === p) _common._kernelPipelineConfigPromise = null; });
        return p;
    },

    // Spec limit check (FFA / moisture / PV). Returns 'ok' | 'warn' | 'bad' | 'noLimits' | '' (no value).
    classifySpec: function (spec, value) {
        if (value == null) return '';
        if (!spec || spec.green_limit == null || spec.yellow_limit == null) return 'noLimits';
        const g = Number(spec.green_limit), y = Number(spec.yellow_limit);
        if (isNaN(g) || isNaN(y)) return 'noLimits';
        if (spec.direction === 'min') return value >= g ? 'ok' : (value >= y ? 'warn' : 'bad');
        return value <= g ? 'ok' : (value <= y ? 'warn' : 'bad');
    },

    // Calendar-correct time from today until a YYYY-MM-DD date (whole months, then remaining days).
    // Month-end safe: adding a month to the 31st clamps to the last day of the shorter month.
    // Returns { expired, years, months, days, totalMonths, label } or null for missing/invalid input.
    timeUntil: function (dateISO, todayISO) {
        function parse(v) {
            if (!v) return null;
            const s = String(v).trim().split('T')[0];
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
            const a = s.split('-');
            const y = +a[0], m = +a[1], d = +a[2];
            const chk = new Date(y, m - 1, d);
            if (chk.getFullYear() !== y || chk.getMonth() !== m - 1 || chk.getDate() !== d) return null;
            return { y: y, m: m - 1, d: d };
        }
        function key(o) { return o.y * 10000 + (o.m + 1) * 100 + o.d; }
        function addM(o, n) {
            const t = o.y * 12 + o.m + n;
            const y = Math.floor(t / 12), m = t - y * 12;
            const last = new Date(y, m + 1, 0).getDate();
            return { y: y, m: m, d: Math.min(o.d, last) };
        }
        function dayNum(o) { return Math.round(Date.UTC(o.y, o.m, o.d) / 86400000); }
        let target = parse(dateISO);
        if (!target) return null;
        let today = parse(todayISO);
        if (!today) { const n = new Date(); today = { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; }
        const expired = key(target) < key(today);
        const from = expired ? target : today;
        const to = expired ? today : target;
        let n = 0;
        while (key(addM(from, n + 1)) <= key(to)) n++;
        const days = dayNum(to) - dayNum(addM(from, n));
        const years = Math.floor(n / 12), months = n % 12;
        const parts = [];
        if (years) parts.push(years + 'y');
        if (months) parts.push(months + 'm');
        if (days || !parts.length) parts.push(days + 'd');
        const core = parts.join(' ');
        return { expired: expired, years: years, months: months, days: days, totalMonths: n, label: expired ? 'Expired ' + core : core };
    },

    // Colour class for a timeUntil() result. bands = { green: months, yellow: months } (default 12 / 6).
    // Red below yellow months (or expired); yellow from yellow months up to and including green months;
    // green only when MORE than green months remain.
    bestBeforeBandClass: function (tu, bands) {
        if (!tu) return '';
        let g = bands ? parseInt(bands.green, 10) : NaN;
        let y = bands ? parseInt(bands.yellow, 10) : NaN;
        if (isNaN(g) || isNaN(y) || g <= y) { g = 12; y = 6; }
        if (tu.expired || tu.totalMonths < y) return 'danger';
        if (tu.totalMonths < g || (tu.totalMonths === g && tu.days === 0)) return 'warning';
        return 'success';
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

    /**
     * Kilogram (or gram) display: comma thousands separator, fixed decimals (default 2).
     * formatKg(1234.5) -> "1,234.50". Returns '' for null/blank/non-numeric (Mike 1.a.i.4.c).
     */
    formatKg: function (value, decimals = 2) {
        if (value === null || value === undefined || value === '') return '';
        var n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
        if (!isFinite(n)) return '';
        return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    },

    /** Reads a typed weight that may carry thousands commas ("1,000.00" -> 1000); null when blank or not a number. */
    parseKg: function (value) {
        var t = String(value == null ? '' : value).replace(/,/g, '').trim();
        if (t === '') return null;
        var n = parseFloat(t);
        return isFinite(n) ? n : null;
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

// Weight boxes (class js-kg-input, type="text" inputmode="decimal"): the plain number while typing,
// "1,000.00" once you leave the box. Readers must use _common.parseKg, since parseFloat("1,000.00") is 1.
document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('js-kg-input')) return;
    t.value = t.value.replace(/,/g, '');
});
document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('js-kg-input')) return;
    var n = _common.parseKg(t.value);
    if (n != null) t.value = _common.formatKg(n);
});

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
