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
        loadTests: async function () {
            try {
                const tests = await dataFunctions.callFunction('get_quality_tests', {});
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
        }
    };
}();
const qualityAssuranceGrid = _qualityAssuranceGrid;
function initializeQualityAssuranceGrid() {
    if (typeof qualityAssuranceGrid !== 'undefined') {
        qualityAssuranceGrid.init();
    }
}

