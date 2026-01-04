/**
 * Quality Assurance Grid Module
 */
var _qualityAssuranceGrid = function () {
    return {
        tests: [],
        init: function () {
            this.setupEventListeners();
            this.loadTests();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#addTestBtn').on('click', function () {
                Swal.fire('Info', 'New quality test form coming soon', 'info');
            });
        },
        loadTests: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                const tests = await dataFunctions.getQualityTests(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Quality tests loaded in ${loadTime.toFixed(2)}ms`);
                
                this.tests = tests || [];
                this.renderTests();
            } catch (error) {
                console.error('Error loading tests:', error);
            }
        },
        renderTests: function () {
            const tbody = $('#testsTableBody');
            tbody.empty();
            if (this.tests.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center text-muted">No quality tests found</td></tr>');
                return;
            }
            this.tests.forEach(test => {
                const badgeClass = test.overall_result === 'pass' ? 'bg-success' : 
                                 test.overall_result === 'fail' ? 'bg-danger' : 'bg-warning';
                const row = `<tr>
                    <td>${test.test_number || 'N/A'}</td>
                    <td>${test.test_type || 'N/A'}</td>
                    <td>${test.product_type || 'N/A'}</td>
                    <td>${test.batch_number || 'N/A'}</td>
                    <td>${test.test_date || 'N/A'}</td>
                    <td><span class="badge ${badgeClass}">${test.overall_result || 'pending'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="qualityAssuranceGrid.viewTest('${test.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        viewTest: function (testId) {
            Swal.fire('Info', 'Test details view coming soon', 'info');
        },
        
        exportTests: function () {
            if (!this.tests || this.tests.length === 0) {
                Swal.fire('Info', 'No tests to export', 'info');
                return;
            }
            
            const columns = [
                { key: 'test_number', label: 'Test Number' },
                { key: 'test_type', label: 'Test Type' },
                { key: 'product_type', label: 'Product Type' },
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'test_date', label: 'Test Date' },
                { key: 'overall_result', label: 'Result' },
                { key: 'moisture_percentage', label: 'Moisture %' },
                { key: 'ffa_percentage', label: 'FFA %' }
            ];
            
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(this.tests, 'quality_tests', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();
const qualityAssuranceGrid = _qualityAssuranceGrid;
function initializeQualityAssuranceGrid() {
    if (typeof qualityAssuranceGrid !== 'undefined') {
        qualityAssuranceGrid.init();
    }
}

