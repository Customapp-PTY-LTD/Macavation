/**
 * [MODULE_NAME_DISPLAY] Grid Module
 * Handles [MODULE_NAME] management functionality
 * 
 * IMPORTANT: Replace [MODULE_NAME] with your module name (e.g., "items", "products")
 * Replace [MODULE_NAME_DISPLAY] with display name (e.g., "Item", "Product")
 * Replace [MODULE_NAME_UPPER] with uppercase name for constants
 * 
 * File location: modules/[MODULE_NAME]/js/[MODULE_NAME]_grid.js
 */

let [MODULE_NAME]Data = [];
let filtered[MODULE_NAME]Data = [];
let currentEditing[MODULE_NAME] = null;

/**
 * Initialize [MODULE_NAME_DISPLAY] Grid
 * This function is called automatically by appRouter when the module loads
 */
async function initialize[MODULE_NAME_UPPER]Grid() {
    try {
        // CRITICAL: Wait for dataFunctions to be available
        if (typeof waitForDataFunctions === 'function') {
            await waitForDataFunctions(50, 100);
        } else if (typeof dataFunctions === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (typeof dataFunctions === 'undefined') {
                throw new Error('dataFunctions is not available');
            }
        }
        
        console.log('Initializing [MODULE_NAME_DISPLAY] Grid...');
        
        // Set up event listeners
        setupEventListeners();
        
        // Load initial data
        await load[MODULE_NAME_UPPER]Data();
        
    } catch (error) {
        console.error('Error initializing [MODULE_NAME_DISPLAY] Grid:', error);
        showError('Failed to initialize [MODULE_NAME_DISPLAY] Grid: ' + error.message);
    }
}

/**
 * Set up event listeners for the module
 */
function setupEventListeners() {
    // Add button
    $('#btnAdd[MODULE_NAME]').on('click', function() {
        showAddModal();
    });
    
    // Save button
    $('#btnSave[MODULE_NAME]').on('click', function() {
        save[MODULE_NAME_UPPER]();
    });
    
    // Delete confirmation
    $('#btnConfirmDelete[MODULE_NAME]').on('click', function() {
        if (currentEditing[MODULE_NAME]) {
            delete[MODULE_NAME_UPPER](currentEditing[MODULE_NAME].id);
        }
    });
    
    // Search filter
    $('#filterSearch').on('input', debounce(function() {
        filter[MODULE_NAME_UPPER]Data();
    }, 300));
    
    // Status filter
    $('#filterStatus').on('change', function() {
        filter[MODULE_NAME_UPPER]Data();
    });
    
    // Clear filters
    $('#btnClearFilters').on('click', function() {
        $('#filterSearch').val('');
        $('#filterStatus').val('');
        $('#filterDate').val('');
        filter[MODULE_NAME_UPPER]Data();
    });
    
    // Edit row click
    $(document).on('click', '.btn-edit-[MODULE_NAME]', function() {
        const id = $(this).data('id');
        edit[MODULE_NAME_UPPER](id);
    });
    
    // Delete row click
    $(document).on('click', '.btn-delete-[MODULE_NAME]', function() {
        const id = $(this).data('id');
        const name = $(this).data('name');
        showDeleteModal(id, name);
    });
    
    // Modal close - clear form
    $('#modal[MODULE_NAME]Form').on('hidden.bs.modal', function() {
        clearForm();
    });
}

/**
 * Load [MODULE_NAME] data from API
 * IMPORTANT: Update function name in data-functions.js
 */
async function load[MODULE_NAME_UPPER]Data() {
    try {
        showLoading();
        
        // Replace 'get_[MODULE_NAME]s' with your actual function name
        const result = await dataFunctions.get[MODULE_NAME_UPPER]s();
        
        // Handle response format (array or object with data property)
        [MODULE_NAME]Data = Array.isArray(result) ? result : (result.data || result.items || []);
        filtered[MODULE_NAME]Data = [MODULE_NAME]Data;
        
        render[MODULE_NAME_UPPER]Table();
        hideLoading();
        
    } catch (error) {
        console.error('Error loading [MODULE_NAME] data:', error);
        showError('Failed to load [MODULE_NAME] data: ' + error.message);
        hideLoading();
    }
}

/**
 * Render [MODULE_NAME] data table
 */
function render[MODULE_NAME_UPPER]Table() {
    const tbody = $('#table[MODULE_NAME]Body');
    
    if (filtered[MODULE_NAME]Data.length === 0) {
        tbody.html(`
            <tr>
                <td colspan="5" class="text-center text-muted">
                    No [MODULE_NAME_DISPLAY] found
                </td>
            </tr>
        `);
        return;
    }
    
    const rows = filtered[MODULE_NAME]Data.map(item => {
        return `
            <tr>
                <td>${escapeHtml(item.id?.substring(0, 8) || 'N/A')}</td>
                <td>${escapeHtml(item.name || '')}</td>
                <td>
                    <span class="badge bg-${item.is_active ? 'success' : 'secondary'}">
                        ${item.is_active ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>${formatDate(item.created_at)}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary btn-edit-[MODULE_NAME]" 
                            data-id="${item.id}" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger btn-delete-[MODULE_NAME]" 
                            data-id="${item.id}" 
                            data-name="${escapeHtml(item.name || '')}" 
                            title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    tbody.html(rows);
}

/**
 * Show add modal
 */
function showAddModal() {
    currentEditing[MODULE_NAME] = null;
    $('#modal[MODULE_NAME]FormTitle').text('Add [MODULE_NAME_DISPLAY]');
    clearForm();
    new bootstrap.Modal(document.getElementById('modal[MODULE_NAME]Form')).show();
}

/**
 * Edit [MODULE_NAME]
 */
async function edit[MODULE_NAME_UPPER](id) {
    try {
        showLoading();
        
        // Replace 'get_[MODULE_NAME]_by_id' with your actual function name
        const result = await dataFunctions.get[MODULE_NAME_UPPER]ById(id);
        const item = Array.isArray(result) ? result[0] : (result.data || result);
        
        if (!item) {
            throw new Error('[MODULE_NAME_DISPLAY] not found');
        }
        
        currentEditing[MODULE_NAME] = item;
        populateForm(item);
        
        $('#modal[MODULE_NAME]FormTitle').text('Edit [MODULE_NAME_DISPLAY]');
        new bootstrap.Modal(document.getElementById('modal[MODULE_NAME]Form')).show();
        
        hideLoading();
        
    } catch (error) {
        console.error('Error loading [MODULE_NAME] for edit:', error);
        showError('Failed to load [MODULE_NAME]: ' + error.message);
        hideLoading();
    }
}

/**
 * Populate form with [MODULE_NAME] data
 */
function populateForm(item) {
    $('#form[MODULE_NAME]Id').val(item.id || '');
    $('#form[MODULE_NAME]Name').val(item.name || '');
    $('#form[MODULE_NAME]Description').val(item.description || '');
    $('#form[MODULE_NAME]Status').val(item.is_active !== undefined ? item.is_active.toString() : 'true');
}

/**
 * Clear form
 */
function clearForm() {
    $('#form[MODULE_NAME]')[0].reset();
    $('#form[MODULE_NAME]Id').val('');
    currentEditing[MODULE_NAME] = null;
}

/**
 * Save [MODULE_NAME] (create or update)
 */
async function save[MODULE_NAME_UPPER]() {
    try {
        // Validate form
        const form = document.getElementById('form[MODULE_NAME]');
        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            return;
        }
        
        const formData = {
            name: $('#form[MODULE_NAME]Name').val().trim(),
            description: $('#form[MODULE_NAME]Description').val().trim(),
            is_active: $('#form[MODULE_NAME]Status').val() === 'true'
        };
        
        showLoading();
        
        let result;
        if (currentEditing[MODULE_NAME]) {
            // Update existing
            // Replace 'update_[MODULE_NAME]_simple' with your actual function name
            result = await dataFunctions.update[MODULE_NAME_UPPER](
                currentEditing[MODULE_NAME].id, 
                formData
            );
        } else {
            // Create new
            // Replace 'create_[MODULE_NAME]_simple' with your actual function name
            result = await dataFunctions.create[MODULE_NAME_UPPER](formData);
        }
        
        if (result.success !== false) {
            showSuccess(`${currentEditing[MODULE_NAME] ? 'Updated' : 'Created'} [MODULE_NAME_DISPLAY] successfully`);
            bootstrap.Modal.getInstance(document.getElementById('modal[MODULE_NAME]Form')).hide();
            await load[MODULE_NAME_UPPER]Data(); // Reload data
        } else {
            throw new Error(result.message || 'Failed to save [MODULE_NAME]');
        }
        
        hideLoading();
        
    } catch (error) {
        console.error('Error saving [MODULE_NAME]:', error);
        showError('Failed to save [MODULE_NAME]: ' + error.message);
        hideLoading();
    }
}

/**
 * Show delete confirmation modal
 */
function showDeleteModal(id, name) {
    currentEditing[MODULE_NAME] = { id: id, name: name };
    $('#modal[MODULE_NAME]DeleteName').text(name);
    new bootstrap.Modal(document.getElementById('modal[MODULE_NAME]Delete')).show();
}

/**
 * Delete [MODULE_NAME]
 */
async function delete[MODULE_NAME_UPPER](id) {
    try {
        showLoading();
        
        // Replace 'delete_[MODULE_NAME]_hard' with your actual function name
        const result = await dataFunctions.delete[MODULE_NAME_UPPER](id);
        
        if (result.success !== false) {
            showSuccess('[MODULE_NAME_DISPLAY] deleted successfully');
            bootstrap.Modal.getInstance(document.getElementById('modal[MODULE_NAME]Delete')).hide();
            await load[MODULE_NAME_UPPER]Data(); // Reload data
        } else {
            throw new Error(result.message || 'Failed to delete [MODULE_NAME]');
        }
        
        hideLoading();
        
    } catch (error) {
        console.error('Error deleting [MODULE_NAME]:', error);
        showError('Failed to delete [MODULE_NAME]: ' + error.message);
        hideLoading();
    }
}

/**
 * Filter [MODULE_NAME] data
 */
function filter[MODULE_NAME_UPPER]Data() {
    const searchTerm = $('#filterSearch').val().toLowerCase();
    const statusFilter = $('#filterStatus').val();
    
    filtered[MODULE_NAME]Data = [MODULE_NAME]Data.filter(item => {
        const matchesSearch = !searchTerm || 
            (item.name && item.name.toLowerCase().includes(searchTerm)) ||
            (item.description && item.description.toLowerCase().includes(searchTerm));
        
        const matchesStatus = !statusFilter || 
            (statusFilter === 'active' && item.is_active) ||
            (statusFilter === 'inactive' && !item.is_active);
        
        return matchesSearch && matchesStatus;
    });
    
    render[MODULE_NAME_UPPER]Table();
}

/**
 * Utility: Show loading indicator
 */
function showLoading() {
    // Implement your loading indicator
    // Example: $('#loadingIndicator').show();
}

/**
 * Utility: Hide loading indicator
 */
function hideLoading() {
    // Implement your loading indicator
    // Example: $('#loadingIndicator').hide();
}

/**
 * Utility: Show success message
 */
function showSuccess(message) {
    if (typeof _common !== 'undefined' && _common.showSuccessToast) {
        _common.showSuccessToast(message);
    } else if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'success',
            title: 'Success',
            text: message,
            timer: 2000,
            showConfirmButton: false
        });
    } else {
        alert(message);
    }
}

/**
 * Utility: Show error message
 */
function showError(message) {
    if (typeof _common !== 'undefined' && _common.showErrorToast) {
        _common.showErrorToast(message);
    } else if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: message
        });
    } else {
        alert(message);
    }
}

/**
 * Utility: Escape HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Utility: Format date
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString();
    } catch (e) {
        return dateString;
    }
}

/**
 * Utility: Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

