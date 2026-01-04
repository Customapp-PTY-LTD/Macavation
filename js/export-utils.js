/**
 * Export Utilities
 * Provides CSV and Excel export functionality for data grids
 */

var _exportUtils = function () {
    return {
        /**
         * Export data to CSV
         * @param {Array} data - Array of objects to export
         * @param {String} filename - Filename for the export
         * @param {Array} columns - Array of column definitions [{key: 'field', label: 'Display Name'}]
         */
        exportToCSV: function (data, filename, columns) {
            if (!data || data.length === 0) {
                Swal.fire('Info', 'No data to export', 'info');
                return;
            }

            // Build CSV header
            const headers = columns.map(col => col.label || col.key).join(',');
            
            // Build CSV rows
            const rows = data.map(item => {
                return columns.map(col => {
                    let value = item[col.key];
                    
                    // Handle nested properties
                    if (col.key.includes('.')) {
                        const keys = col.key.split('.');
                        value = keys.reduce((obj, key) => obj && obj[key], item);
                    }
                    
                    // Format value
                    if (value === null || value === undefined) {
                        value = '';
                    } else if (typeof value === 'object') {
                        value = JSON.stringify(value);
                    } else if (typeof value === 'boolean') {
                        value = value ? 'Yes' : 'No';
                    }
                    
                    // Escape commas and quotes
                    value = String(value).replace(/"/g, '""');
                    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                        value = `"${value}"`;
                    }
                    
                    return value;
                }).join(',');
            });
            
            // Combine header and rows
            const csvContent = [headers, ...rows].join('\n');
            
            // Create blob and download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            link.setAttribute('href', url);
            link.setAttribute('download', `${filename || 'export'}_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            Swal.fire('Success', 'Data exported successfully', 'success');
        },

        /**
         * Export data to Excel (using CSV format with .xlsx extension)
         * Note: For true Excel format, a library like SheetJS would be needed
         * @param {Array} data - Array of objects to export
         * @param {String} filename - Filename for the export
         * @param {Array} columns - Array of column definitions
         */
        exportToExcel: function (data, filename, columns) {
            // For now, use CSV format but with .xlsx extension
            // In production, consider using SheetJS (xlsx library)
            this.exportToCSV(data, filename, columns);
        },

        /**
         * Export table to CSV (from HTML table element)
         * @param {String} tableId - ID of the table element
         * @param {String} filename - Filename for the export
         */
        exportTableToCSV: function (tableId, filename) {
            const table = document.getElementById(tableId);
            if (!table) {
                Swal.fire('Error', 'Table not found', 'error');
                return;
            }

            const rows = table.querySelectorAll('tr');
            if (rows.length === 0) {
                Swal.fire('Info', 'No data to export', 'info');
                return;
            }

            let csvContent = [];
            
            rows.forEach(row => {
                const cols = row.querySelectorAll('td, th');
                const rowData = Array.from(cols).map(col => {
                    let text = col.textContent.trim();
                    // Remove action buttons text
                    text = text.replace(/Edit|Delete|View/gi, '').trim();
                    // Escape commas and quotes
                    text = text.replace(/"/g, '""');
                    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
                        text = `"${text}"`;
                    }
                    return text;
                });
                csvContent.push(rowData.join(','));
            });
            
            const blob = new Blob([csvContent.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            link.setAttribute('href', url);
            link.setAttribute('download', `${filename || 'export'}_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            Swal.fire('Success', 'Table exported successfully', 'success');
        }
    };
}();

// Make available globally
window.exportUtils = _exportUtils;

