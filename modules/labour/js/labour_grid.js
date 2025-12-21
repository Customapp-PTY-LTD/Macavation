/**
 * Labour Allocation Module
 * Manage daily worker allocations, attendance, and task tracking
 */

let labourData = {
    workers: [],
    filteredWorkers: [],
    currentPage: 1,
    pageSize: 10,
    filters: {
        farm: '',
        block: '',
        task: '',
        status: '',
        search: ''
    }
};

/**
 * Initialize Labour Module
 */
async function initializeLabourGrid() {
    try {
        // Wait for dataFunctions to be available
        if (typeof waitForDataFunctions === 'function') {
            try {
                await waitForDataFunctions(50, 100);
            } catch (error) {
                console.error('dataFunctions not available:', error);
                throw new Error('Data functions not available');
            }
        } else if (typeof dataFunctions === 'undefined') {
            // Fallback: wait a bit and check again
            await new Promise(resolve => setTimeout(resolve, 500));
            if (typeof dataFunctions === 'undefined') {
                throw new Error('dataFunctions is not available');
            }
        }
        
        // Set current date
        setCurrentDate();
        
        // Check if utility functions are available
        if (typeof populateFarmSelector === 'undefined') {
            console.error('populateFarmSelector is not defined. Make sure farm-selector-utils.js is loaded.');
            return;
        }
        
        // Load and populate farm and block selectors
        try {
            await populateFarmSelector('farmFilter', localStorage.getItem('selectedFarmId') || 'all', true);
            await populateBlockSelector('blockFilter', null, null, true);
            
            // Setup farm selector to update block selector when changed
            if (typeof setupFarmSelectorWithBlocks === 'function') {
                setupFarmSelectorWithBlocks('farmFilter', 'blockFilter', async (farmId) => {
                    // Save farm selection to localStorage
                    if (farmId && farmId !== 'all') {
                        localStorage.setItem('selectedFarmId', farmId);
                    } else {
                        localStorage.removeItem('selectedFarmId');
                    }
                    
                    // Update farm filter in labourData
                    labourData.filters.farm = farmId || '';
                    
                    // Update farm info display
                    updateFarmInfoDisplay();
                    
                    // Reload data when farm changes to update all metrics
                    try {
                        await loadLabourData();
                        loadSummaryStats();
                    } catch (err) {
                        console.error('Error reloading data after farm change:', err);
                    }
                });
            }
            
            // Also add event listener to farm selector to update display and save selection
            const farmSelector = document.getElementById('farmFilter');
            if (farmSelector) {
                farmSelector.addEventListener('change', async () => {
                    const farmId = farmSelector.value;
                    // Save farm selection to localStorage
                    if (farmId && farmId !== '' && farmId !== 'all') {
                        localStorage.setItem('selectedFarmId', farmId);
                    } else {
                        localStorage.removeItem('selectedFarmId');
                    }
                    
                    // Update farm filter in labourData
                    labourData.filters.farm = farmId || '';
                    
                    updateFarmInfoDisplay();
                    
                    // Reload data to update all metrics when farm changes
                    try {
                        await loadLabourData();
                        loadSummaryStats();
                    } catch (err) {
                        console.error('Error reloading data after farm change:', err);
                    }
                });
            }
        } catch (error) {
            console.error('Error setting up farm/block selectors:', error);
            // Continue anyway - data loading might still work
        }
        
        // Load data (async)
        await loadLabourData();
        loadSummaryStats();
    } catch (error) {
        console.error('Error initializing Labour Grid:', error);
        // Show user-friendly error message
        const container = document.querySelector('.labour-container');
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <h4 class="alert-heading">Error Loading Labour Module</h4>
                    <p>There was an error initializing the labour allocation module. Please refresh the page.</p>
                    <hr>
                    <p class="mb-0"><small>Error: ${error.message}</small></p>
                </div>
            `;
        }
    }
}

/**
 * Set current date display
 */
function setCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateString = now.toLocaleDateString('en-US', options);
    
    const dateElement = document.getElementById('currentDate');
    if (dateElement) {
        dateElement.textContent = dateString;
    }
    
    // Update farm info display
    updateFarmInfoDisplay();
}

/**
 * Update farm info badge display (shows selected farm name or nothing)
 */
function updateFarmInfoDisplay() {
    const farmInfo = document.getElementById('farmInfo');
    if (!farmInfo) return;
    
    const farmSelector = document.getElementById('farmFilter');
    if (farmSelector && farmSelector.value && farmSelector.value !== 'all') {
        const selectedOption = farmSelector.options[farmSelector.selectedIndex];
        if (selectedOption && selectedOption.text) {
            farmInfo.innerHTML = `<span class="badge" style="background-color: #7fa84f;">${selectedOption.text}</span>`;
        } else {
            farmInfo.innerHTML = '';
        }
    } else {
        farmInfo.innerHTML = '';
    }
}

/**
 * Load labour data
 */
async function loadLabourData() {
    try {
        // Check if dataFunctions is available
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getWorkers) {
            console.error('dataFunctions.getWorkers is not available');
            throw new Error('Data functions not available');
        }
        
        // Load workers and allocations with filters
        // Get farm ID from selector if available, otherwise from localStorage
        const farmSelector = document.getElementById('farmFilter');
        let farmId = 'all';
        if (farmSelector && farmSelector.value) {
            farmId = farmSelector.value;
        } else {
            farmId = localStorage.getItem('selectedFarmId') || 'all';
        }
        const filters = farmId && farmId !== '' && farmId !== 'all' ? { farmId: farmId } : {};
        
        // Add today's date to allocation filters to get today's allocations
        const today = new Date().toISOString().split('T')[0];
        const allocationFilters = { ...filters, allocationDate: today };
        
        const [workers, allocations] = await Promise.all([
            dataFunctions.getWorkers(filters).catch(err => {
                console.error('Error loading workers:', err);
                return [];
            }),
            dataFunctions.getWorkerAllocations(allocationFilters).catch(err => {
                console.error('Error loading allocations:', err);
                return [];
            })
        ]);
        
        // Handle different response structures
        let workersArray = workers;
        if (workers && !Array.isArray(workers)) {
            // Try to extract array from response object
            if (workers.workers && Array.isArray(workers.workers)) {
                workersArray = workers.workers;
            } else if (workers.data && Array.isArray(workers.data)) {
                workersArray = workers.data;
            } else if (workers.result && Array.isArray(workers.result)) {
                workersArray = workers.result;
            } else {
                console.warn('Workers response is not in expected format:', workers);
                workersArray = [];
            }
        }
        
        let allocationsArray = allocations;
        if (allocations && !Array.isArray(allocations)) {
            if (allocations.allocations && Array.isArray(allocations.allocations)) {
                allocationsArray = allocations.allocations;
            } else if (allocations.data && Array.isArray(allocations.data)) {
                allocationsArray = allocations.data;
            } else if (allocations.result && Array.isArray(allocations.result)) {
                allocationsArray = allocations.result;
            } else {
                console.warn('Allocations response is not in expected format:', allocations);
                allocationsArray = [];
            }
        }
        
        // Get farms and blocks for name lookup
        let farmsMap = new Map();
        let blocksMap = new Map();
        try {
            const farms = await dataFunctions.getFarms();
            if (farms && Array.isArray(farms)) {
                farms.forEach(f => {
                    if (f.id) farmsMap.set(f.id, f.name || 'Unknown Farm');
                });
            }
            
            // Get blocks if needed (optional - can be done per farm)
            // Only try to get blocks if we have a valid token
            try {
                const blocks = await dataFunctions.getBlocks(); // Don't pass {} - let it use default token parameter
                if (blocks && Array.isArray(blocks)) {
                    blocks.forEach(b => {
                        if (b.id) blocksMap.set(b.id, b.name || 'Unknown Block');
                    });
                }
            } catch (blockError) {
                // Silently fail for blocks - not critical for worker display
                console.debug('Could not load blocks for name lookup (non-critical):', blockError.message);
            }
        } catch (error) {
            // Only log error if it's not a token/auth issue (which might be expected)
            if (error.message && !error.message.includes('token') && !error.message.includes('Unauthorized') && !error.message.includes('401')) {
                console.warn('Could not load farms/blocks for name lookup:', error);
            } else {
                console.debug('Authentication issue loading farms/blocks:', error.message);
            }
        }
        
        // Map workers with their allocations
        if (workersArray && Array.isArray(workersArray) && workersArray.length > 0) {
            labourData.workers = workersArray.map(worker => {
                // Find today's allocation for this worker
                const today = new Date().toISOString().split('T')[0];
                
                // Try multiple date format matches (handles different date formats from API)
                const todayAllocation = allocationsArray && Array.isArray(allocationsArray) 
                    ? allocationsArray.find(a => {
                        // Handle both snake_case and camelCase
                        const allocWorkerId = a.worker_id || a.workerId;
                        if (!allocWorkerId || allocWorkerId !== worker.id) return false;
                        
                        // Handle different date formats
                        const allocDate = a.allocation_date || a.allocationDate;
                        if (!allocDate) return false;
                        
                        // Convert to ISO date string for comparison
                        let dateStr;
                        if (typeof allocDate === 'string') {
                            dateStr = allocDate.split('T')[0]; // Remove time if present
                        } else if (allocDate instanceof Date) {
                            dateStr = allocDate.toISOString().split('T')[0];
                        } else {
                            dateStr = new Date(allocDate).toISOString().split('T')[0];
                        }
                        
                        return dateStr === today;
                    })
                    : null;
                
                // Get farm name from map or allocation
                const farmId = todayAllocation?.farm_id || todayAllocation?.farmId || worker.current_farm_id;
                const farmName = todayAllocation?.farm_name || todayAllocation?.farmName || 
                                (farmId ? farmsMap.get(farmId) || 'Farm ' + farmId.substring(0, 8) : 'Not Allocated');
                
                // Get block name from map or allocation
                const blockId = todayAllocation?.block_id || todayAllocation?.blockId;
                const blockName = todayAllocation?.block_name || todayAllocation?.blockName ||
                                (blockId ? blocksMap.get(blockId) || 'Block ' + blockId.substring(0, 8) : '-');
                
                // Store original farm IDs for shared worker detection
                const homeFarmId = worker.home_farm_id || worker.homeFarmId;
                const currentFarmId = worker.current_farm_id || worker.currentFarmId;
                
                // Get home farm name
                const homeFarmName = homeFarmId ? (farmsMap.get(homeFarmId) || 'Farm ' + homeFarmId.substring(0, 8)) : 'Not Assigned';
                
                return {
                    id: worker.id,
                    name: `${worker.first_name} ${worker.last_name}`,
                    idNumber: worker.id_number || 'N/A',
                    status: todayAllocation ? (todayAllocation.status || 'completed' || 'Present') : 'Unallocated',
                    farm: farmName, // Current allocation farm (for filtering)
                    farmId: farmId, // Store farm ID for filtering
                    homeFarm: homeFarmName, // Home farm name for display
                    block: blockName,
                    blockId: blockId, // Store block ID for filtering
                    variety: todayAllocation?.variety_name || todayAllocation?.varietyName || 
                            (todayAllocation?.variety_id || todayAllocation?.varietyId ? 'Variety' : '-'),
                    task: todayAllocation?.task_type || todayAllocation?.taskType || '-',
                    employmentType: worker.employment_type || 'permanent',
                    rowStart: null,
                    rowEnd: null,
                    teamLeader: todayAllocation?.induna_id || todayAllocation?.indunaId ? 'Supervisor' : '-',
                    employeeNumber: worker.employee_number,
                    hourlyRate: worker.hourly_rate,
                    // Store original IDs for shared worker detection
                    _homeFarmId: homeFarmId,
                    _currentFarmId: currentFarmId
                };
            });
        } else {
            labourData.workers = [];
        }
        
        // Initialize filtered workers with all workers
        labourData.filteredWorkers = [...labourData.workers];
        
        // Apply any existing filters
        filterWorkers();
        
        // Update summary stats based on filtered workers
        loadSummaryStats();
        
        loadWorkersList();
        
    } catch (error) {
        console.error('Error loading labour data:', error);
        // Fallback to mock data
        labourData.workers = [
            {
                id: 1,
                name: 'John Smith',
                idNumber: '9201054321083',
                status: 'Present',
                farm: 'Main Farm',
                block: 'Block A3',
                variety: 'Granny Smith',
                task: 'Pruning',
                rowStart: 12,
                rowEnd: 15,
                teamLeader: 'James'
            }
        ];
        labourData.filteredWorkers = [...labourData.workers];
        loadWorkersList();
    }
}

/**
 * Load summary statistics
 */
function loadSummaryStats() {
    // Get selected farm ID
    const farmSelector = document.getElementById('farmFilter');
    const selectedFarmId = farmSelector ? farmSelector.value : '';
    const selectedFarmName = farmSelector && farmSelector.selectedIndex > 0 
        ? farmSelector.options[farmSelector.selectedIndex].text 
        : 'Selected Farm';
    
    // Calculate stats from all workers (not filtered)
    const allWorkers = labourData.workers;
    
    // Calculate stats
    const stats = {
        totalFromFarm: 0,  // Workers whose home farm matches selected farm
        allocatedToFarm: 0,  // Workers allocated to selected farm
        unallocatedFromFarm: 0,  // Workers from selected farm who are not allocated
        allocatedToOtherFarms: 0,  // Workers allocated to farms other than selected farm
        pruningAllocated: 0,
        mowingAllocated: 0,
        weedingAllocated: 0,
        harvestingAllocated: 0
    };
    
    // Count workers
    allWorkers.forEach(worker => {
        const homeFarmId = worker._homeFarmId;
        const isAllocated = worker.farm && worker.farm !== 'Not Allocated' && worker.farm !== '-' && worker.task && worker.task !== '-';
        
        // Total workers from selected farm (home farm matches)
        if (selectedFarmId && selectedFarmId !== '' && selectedFarmId !== 'all') {
            if (homeFarmId === selectedFarmId) {
                stats.totalFromFarm++;
                
                // Check if allocated
                if (isAllocated && worker.farmId === selectedFarmId) {
                    stats.allocatedToFarm++;
                    
                    // Count by task type
                    const task = worker.task;
                    if (task && task !== '-') {
                        const taskLower = task.toLowerCase();
                        if (taskLower.includes('pruning')) {
                            stats.pruningAllocated++;
                        } else if (taskLower.includes('mowing')) {
                            stats.mowingAllocated++;
                        } else if (taskLower.includes('weeding')) {
                            stats.weedingAllocated++;
                        } else if (taskLower.includes('harvesting')) {
                            stats.harvestingAllocated++;
                        }
                    }
                } else {
                    // Not allocated from selected farm
                    stats.unallocatedFromFarm++;
                }
            }
            
            // Workers allocated to other farms (not the selected farm)
            if (isAllocated && worker.farmId && worker.farmId !== selectedFarmId) {
                stats.allocatedToOtherFarms++;
            }
        }
    });
    
    // Helper function to safely set text content
    const setTextContent = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        } else {
            console.warn(`Element with id '${id}' not found`);
        }
    };
    
    // Update totals
    setTextContent('totalStaff', stats.totalFromFarm);
    const staffBreakdown = document.getElementById('staffBreakdown');
    if (staffBreakdown) {
        staffBreakdown.textContent = selectedFarmId && selectedFarmId !== '' && selectedFarmId !== 'all' 
            ? `From ${selectedFarmName}` 
            : 'Select a farm';
    }
    
    // Update allocated to farm count
    setTextContent('allocatedCount', stats.allocatedToFarm);
    const allocatedBreakdown = document.getElementById('allocatedBreakdown');
    if (allocatedBreakdown) {
        allocatedBreakdown.textContent = selectedFarmId && selectedFarmId !== '' && selectedFarmId !== 'all' 
            ? selectedFarmName 
            : 'Select a farm';
    }
    
    // Update unallocated from farm count
    setTextContent('unallocatedCount', stats.unallocatedFromFarm);
    const unallocatedBreakdown = document.getElementById('unallocatedBreakdown');
    if (unallocatedBreakdown) {
        unallocatedBreakdown.textContent = selectedFarmId && selectedFarmId !== '' && selectedFarmId !== 'all' 
            ? `From ${selectedFarmName}` 
            : 'Select a farm';
    }
    
    // Update allocated to other farms count
    setTextContent('allocatedToOtherFarmsCount', stats.allocatedToOtherFarms);
    
    // Update task type allocated counts
    setTextContent('pruningAllocatedCount', stats.pruningAllocated);
    setTextContent('mowingAllocatedCount', stats.mowingAllocated);
    setTextContent('weedingAllocatedCount', stats.weedingAllocated);
    setTextContent('harvestingAllocatedCount', stats.harvestingAllocated);
    
    // Calculate and show shared workers alert
    const sharedWorkers = allWorkers.filter(worker => {
        const homeFarmId = worker._homeFarmId;
        const currentFarmId = worker._currentFarmId;
        
        if (homeFarmId && currentFarmId && homeFarmId !== currentFarmId) {
            return true;
        }
        
        const empType = (worker.employmentType || '').toLowerCase();
        return empType.includes('shared');
    });
    
    if (sharedWorkers.length > 0) {
        const alert = document.getElementById('sharedWorkersAlert');
        const count = document.getElementById('sharedWorkerCount');
        const details = document.getElementById('sharedWorkerDetails');
        
        if (alert && count && details) {
            alert.style.display = 'block';
            count.textContent = sharedWorkers.length;
            
            const farms = new Set();
            sharedWorkers.forEach(w => {
                if (w.farm && w.farm !== 'Not Allocated') farms.add(w.farm);
            });
            const farmList = Array.from(farms).join(', ');
            
            details.textContent = `${sharedWorkers.length} worker(s) shared${farmList ? ` | Currently at: ${farmList}` : ''}`;
        }
    } else {
        const alert = document.getElementById('sharedWorkersAlert');
        if (alert) {
            alert.style.display = 'none';
        }
    }
}

/**
 * Load workers list
 */
function loadWorkersList() {
    const tbody = document.getElementById('workersTableBody');
    if (!tbody) return;
    
    if (labourData.filteredWorkers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-3"></i>
                    <p class="mb-0 mt-2">No workers found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    const startIndex = (labourData.currentPage - 1) * labourData.pageSize;
    const endIndex = startIndex + labourData.pageSize;
    const pageWorkers = labourData.filteredWorkers.slice(startIndex, endIndex);
    
    tbody.innerHTML = pageWorkers.map(worker => {
        const statusBadgeClass = getStatusBadgeClass(worker.status);
        const rows = worker.rowStart && worker.rowEnd ? `${worker.rowStart}-${worker.rowEnd}` : '-';
        const isAbsent = worker.status === 'Absent';
        
        return `
            <tr>
                <td class="fw-bold">${worker.name}</td>
                <td>${worker.idNumber}</td>
                <td><span class="badge ${statusBadgeClass}">${worker.status}</span></td>
                <td>${worker.homeFarm || 'Not Assigned'}</td>
                <td>${worker.block}</td>
                <td>${worker.variety}</td>
                <td>${worker.task}</td>
                <td>${rows}</td>
                <td>${worker.teamLeader}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" 
                            onclick="editWorkerAllocation('${worker.id}')"
                            ${isAbsent ? 'disabled' : ''}>
                        <i class="bi bi-pencil"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    updatePagination();
}

/**
 * Get status badge class
 */
function getStatusBadgeClass(status) {
    switch (status) {
        case 'Present': return 'badge-present';
        case 'Absent': return 'badge-absent';
        case 'Late': return 'badge-late';
        case 'Not Allocated': return 'badge-not-allocated';
        default: return 'badge-secondary';
    }
}

/**
 * Apply filters
 */
async function applyFilters() {
    const farmFilter = document.getElementById('farmFilter').value;
    const blockFilter = document.getElementById('blockFilter').value;
    const taskFilter = document.getElementById('taskFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;
    
    // Save farm selection to localStorage
    if (farmFilter && farmFilter !== '' && farmFilter !== 'all') {
        localStorage.setItem('selectedFarmId', farmFilter);
    } else {
        localStorage.removeItem('selectedFarmId');
    }
    
    // Store previous farm filter to detect changes
    const previousFarmFilter = labourData.filters.farm;
    
    labourData.filters = {
        farm: farmFilter,
        block: blockFilter,
        task: taskFilter,
        status: statusFilter,
        search: labourData.filters.search
    };
    
    // Update farm info display when filters change
    updateFarmInfoDisplay();
    
    // Reset grid title when filters change
    resetWorkerAllocationsGrid();
    
    // If farm filter changed, reload data from API to get accurate metrics
    if (previousFarmFilter !== farmFilter) {
        try {
            await loadLabourData();
        } catch (error) {
            console.error('Error reloading data after farm change:', error);
            // Continue with filtering existing data if reload fails
            filterWorkers();
            labourData.currentPage = 1;
            loadSummaryStats();
            loadWorkersList();
        }
    } else {
        // Farm didn't change, just apply filters to existing data
        filterWorkers();
        labourData.currentPage = 1;
        
        // Update summary stats and quick actions to reflect filtered data
        loadSummaryStats();
        
        loadWorkersList();
    }
}

/**
 * Search workers
 */
function searchWorkers() {
    const searchTerm = document.getElementById('workerSearch').value.toLowerCase();
    labourData.filters.search = searchTerm;
    
    // Reset grid title when searching
    if (!searchTerm) {
        resetWorkerAllocationsGrid();
    } else {
        const titleEl = document.getElementById('workerAllocationsTitle');
        if (titleEl) {
            titleEl.textContent = `Worker Allocations - Search: "${searchTerm}"`;
        }
    }
    
    filterWorkers();
    labourData.currentPage = 1;
    
    // Update summary stats to reflect search filter
    loadSummaryStats();
    
    loadWorkersList();
}

/**
 * Filter workers based on active filters
 */
function filterWorkers() {
    labourData.filteredWorkers = labourData.workers.filter(worker => {
        // Search filter
        if (labourData.filters.search) {
            const searchMatch = 
                worker.name.toLowerCase().includes(labourData.filters.search) ||
                worker.idNumber.includes(labourData.filters.search);
            if (!searchMatch) return false;
        }
        
        // Farm filter
        if (labourData.filters.farm && worker.farm !== labourData.filters.farm) {
            return false;
        }
        
        // Block filter
        if (labourData.filters.block && worker.block !== labourData.filters.block) {
            return false;
        }
        
        // Task filter (case-insensitive partial match)
        if (labourData.filters.task) {
            const workerTask = (worker.task || '').toLowerCase().trim();
            const filterTask = labourData.filters.task.toLowerCase().trim();
            
            // Handle "General" as catch-all for non-specific tasks
            if (filterTask === 'general' || filterTask === '') {
                // Show workers without specific task types or with generic tasks
                const specificTasks = ['pruning', 'mowing', 'weeding', 'harvesting', 'spraying'];
                const hasSpecificTask = specificTasks.some(task => workerTask.includes(task));
                if (hasSpecificTask) return false;
            } else {
                // Match specific task types (allows partial matching)
                // Normalize task names (e.g., "Pruning" matches "pruning")
                if (workerTask === '-' || workerTask === '' || !workerTask.includes(filterTask)) {
                    return false;
                }
            }
        }
        
        // Status filter
        if (labourData.filters.status && worker.status !== labourData.filters.status) {
            return false;
        }
        
        return true;
    });
}

/**
 * Update pagination
 */
function updatePagination() {
    const totalPages = Math.ceil(labourData.filteredWorkers.length / labourData.pageSize);
    const paginationInfo = document.getElementById('paginationInfo');
    const pagination = document.getElementById('pagination');
    
    if (paginationInfo) {
        const startIndex = (labourData.currentPage - 1) * labourData.pageSize + 1;
        const endIndex = Math.min(labourData.currentPage * labourData.pageSize, labourData.filteredWorkers.length);
        paginationInfo.textContent = `Showing ${startIndex}-${endIndex} of ${labourData.filteredWorkers.length} workers`;
    }
    
    if (pagination) {
        let html = '';
        
        // Previous button
        html += `<li class="page-item ${labourData.currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${labourData.currentPage - 1})">Previous</a>
        </li>`;
        
        // Page numbers
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= labourData.currentPage - 1 && i <= labourData.currentPage + 1)) {
                html += `<li class="page-item ${i === labourData.currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="changePage(${i})">${i}</a>
                </li>`;
            } else if (i === labourData.currentPage - 2 || i === labourData.currentPage + 2) {
                html += '<li class="page-item disabled"><a class="page-link">...</a></li>';
            }
        }
        
        // Next button
        html += `<li class="page-item ${labourData.currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${labourData.currentPage + 1})">Next</a>
        </li>`;
        
        pagination.innerHTML = html;
    }
}

/**
 * Change page
 */
function changePage(page) {
    event.preventDefault();
    const totalPages = Math.ceil(labourData.filteredWorkers.length / labourData.pageSize);
    
    if (page < 1 || page > totalPages) return;
    
    labourData.currentPage = page;
    loadWorkersList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Edit worker allocation
 */
function editWorkerAllocation(workerId) {
    const worker = labourData.workers.find(w => String(w.id) === String(workerId));
    if (!worker) {
        console.error('Worker not found:', workerId);
        return;
    }
    
    // Populate modal
    const editWorkerIdEl = document.getElementById('editWorkerId');
    const editWorkerNameEl = document.getElementById('editWorkerName');
    const editFarmEl = document.getElementById('editFarm');
    const editBlockEl = document.getElementById('editBlock');
    const editVarietyEl = document.getElementById('editVariety');
    const editTaskEl = document.getElementById('editTask');
    const editRowStartEl = document.getElementById('editRowStart');
    const editRowEndEl = document.getElementById('editRowEnd');
    
    if (editWorkerIdEl) editWorkerIdEl.value = worker.id;
    if (editWorkerNameEl) editWorkerNameEl.value = worker.name;
    if (editFarmEl) editFarmEl.value = worker.farm;
    if (editBlockEl) editBlockEl.value = worker.block;
    if (editVarietyEl) editVarietyEl.value = worker.variety;
    if (editTaskEl) editTaskEl.value = worker.task;
    if (editRowStartEl) editRowStartEl.value = worker.rowStart || '';
    if (editRowEndEl) editRowEndEl.value = worker.rowEnd || '';
    
    // Show modal
    const modalElement = document.getElementById('editAllocationModal');
    if (modalElement) {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

/**
 * Save allocation
 */
async function saveAllocation() {
    try {
        const workerId = document.getElementById('editWorkerId').value;
        const allocationId = document.getElementById('editAllocationId').value;
        const farmId = document.getElementById('editFarm').value;
        const blockId = document.getElementById('editBlock').value;
        const taskType = document.getElementById('editTask').value;
        const startTime = document.getElementById('editStartTime')?.value || '07:00';
        const endTime = document.getElementById('editEndTime')?.value || '16:00';
        
        if (!workerId || !farmId) {
            showErrorMessage('Worker and Farm are required');
            return;
        }
        
        const allocationData = {
            worker_id: workerId,
            farm_id: farmId,
            block_id: blockId || null,
            task_type: taskType || null,
            start_time: startTime,
            end_time: endTime,
            status: 'planned'
        };
        
        let result;
        if (allocationId) {
            // Update existing allocation
            result = await dataFunctions.updateWorkerAllocation(allocationId, allocationData);
            showSuccessMessage('Allocation updated successfully');
        } else {
            // Create new allocation
            const allocationDate = document.getElementById('editAllocationDate')?.value || new Date().toISOString().split('T')[0];
            allocationData.allocation_date = allocationDate;
            result = await dataFunctions.createWorkerAllocation(allocationData);
            showSuccessMessage('Allocation created successfully');
        }
        
        // Reload data
        await loadLabourData();
        loadSummaryStats();
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('editAllocationModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving allocation:', error);
        showErrorMessage('Failed to save allocation: ' + error.message);
    }
}

/**
 * Save bulk allocation
 */
async function saveBulkAllocation() {
    try {
        const selectedWorkers = document.querySelectorAll('#bulkWorkerList input[type="checkbox"]:checked');
        if (selectedWorkers.length === 0) {
            showErrorMessage('Please select at least one worker');
            return;
        }
        
        const farmId = document.getElementById('bulkFarm').value;
        const blockId = document.getElementById('bulkBlock').value;
        const variety = document.getElementById('bulkVariety').value;
        const taskType = document.getElementById('bulkTask').value;
        
        if (!farmId || !taskType) {
            showErrorMessage('Farm and Task are required');
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        const workerIds = Array.from(selectedWorkers).map(cb => cb.value);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (const workerId of workerIds) {
            try {
                const allocationData = {
                    worker_id: workerId,
                    farm_id: farmId,
                    block_id: blockId || null,
                    variety_id: null, // Would need variety ID lookup if needed
                    task_type: taskType,
                    allocation_date: today,
                    status: 'planned'
                };
                
                await dataFunctions.createWorkerAllocation(allocationData);
                successCount++;
            } catch (error) {
                console.error(`Error allocating worker ${workerId}:`, error);
                errorCount++;
            }
        }
        
        if (successCount > 0) {
            showSuccessMessage(`Successfully allocated ${successCount} worker(s)${errorCount > 0 ? ` (${errorCount} failed)` : ''}`);
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('bulkAllocationModal'));
            if (modal) modal.hide();
            
            // Reload data
            await loadLabourData();
            loadSummaryStats();
        } else {
            showErrorMessage('Failed to allocate workers. Please try again.');
        }
        
    } catch (error) {
        console.error('Error saving bulk allocation:', error);
        showErrorMessage('Error saving bulk allocation: ' + error.message);
    }
}

/**
 * Open team view - filters workers by task type
 */
function openTeam(team) {
    // Map team names to task type filter values
    const taskTypeMap = {
        'pruning': 'Pruning',
        'mowing': 'Mowing',
        'weeding': 'Weeding',
        'general': 'General' // or empty string for all general tasks
    };
    
    const taskType = taskTypeMap[team.toLowerCase()] || team;
    
    // Set task filter
    const taskFilter = document.getElementById('taskFilter');
    if (taskFilter) {
        taskFilter.value = taskType;
    }
    
    // Apply filters to show only workers in this team
    labourData.filters.task = taskType;
    filterWorkers();
    labourData.currentPage = 1;
    
    // Update summary stats to reflect team filter
    loadSummaryStats();
    
    loadWorkersList();
    
    // Scroll to worker list
    const workerListCard = document.querySelector('.card');
    if (workerListCard) {
        workerListCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Load shared workers data
 */
async function loadSharedWorkers() {
    try {
        const sharedWorkersList = document.getElementById('sharedWorkersList');
        if (!sharedWorkersList) return;
        
        sharedWorkersList.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-hourglass-split fs-3"></i>
                <p class="mb-0 mt-2">Loading shared workers...</p>
            </div>
        `;
        
        // Get all workers to identify shared ones
        const allWorkers = await dataFunctions.getWorkers({});
        if (!allWorkers || !Array.isArray(allWorkers)) {
            sharedWorkersList.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-3"></i>
                    <p class="mb-0 mt-2">No workers found</p>
                </div>
            `;
            return;
        }
        
        // Filter for shared workers
        const sharedWorkers = allWorkers.filter(worker => {
            const homeFarmId = worker.home_farm_id || worker.homeFarmId;
            const currentFarmId = worker.current_farm_id || worker.currentFarmId;
            return homeFarmId && currentFarmId && homeFarmId !== currentFarmId && worker.is_active !== false;
        });
        
        if (sharedWorkers.length === 0) {
            sharedWorkersList.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="bi bi-people fs-3"></i>
                    <p class="mb-0 mt-2">No shared workers currently</p>
                    <small class="text-muted">Workers are shared when their home farm differs from their current farm</small>
                </div>
            `;
            return;
        }
        
        // Get farms for name lookup
        const farms = await dataFunctions.getFarms();
        const farmsMap = new Map();
        if (farms && Array.isArray(farms)) {
            farms.forEach(f => {
                if (f.id) farmsMap.set(f.id, f.name || 'Unknown Farm');
            });
        }
        
        // Render shared workers
        sharedWorkersList.innerHTML = sharedWorkers.map(worker => {
            const homeFarmId = worker.home_farm_id || worker.homeFarmId;
            const currentFarmId = worker.current_farm_id || worker.currentFarmId;
            const homeFarmName = farmsMap.get(homeFarmId) || 'Unknown Farm';
            const currentFarmName = farmsMap.get(currentFarmId) || 'Unknown Farm';
            
            return `
                <div class="list-group-item">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="flex-grow-1">
                            <h6 class="mb-1">${worker.first_name} ${worker.last_name}</h6>
                            <p class="mb-1 text-muted small">
                                <i class="bi bi-person-badge me-1"></i>${worker.employee_number || 'N/A'}
                            </p>
                            <div class="d-flex gap-3 mt-2">
                                <div>
                                    <small class="text-muted d-block">Home Farm</small>
                                    <strong>${homeFarmName}</strong>
                                </div>
                                <div>
                                    <i class="bi bi-arrow-right text-primary"></i>
                                </div>
                                <div>
                                    <small class="text-muted d-block">Current Farm</small>
                                    <strong class="text-primary">${currentFarmName}</strong>
                                </div>
                            </div>
                        </div>
                        <div class="ms-3">
                            <button class="btn btn-sm btn-outline-danger" onclick="revertWorkerTransfer('${worker.id}', '${homeFarmId}')" title="Return to home farm">
                                <i class="bi bi-arrow-return-left me-1"></i>Return
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading shared workers:', error);
        const sharedWorkersList = document.getElementById('sharedWorkersList');
        if (sharedWorkersList) {
            sharedWorkersList.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>Error loading shared workers: ${error.message}
                </div>
            `;
        }
    }
}

/**
 * Manage shared workers - opens modal and loads data
 */
function manageSharedWorkers() {
    const modalElement = document.getElementById('sharedWorkersModal');
    if (!modalElement) {
        console.error('Shared workers modal not found');
        return;
    }
    
    const modal = new bootstrap.Modal(modalElement);
    
    // Load shared workers when modal is shown
    const handleShown = async function() {
        await loadSharedWorkers();
        modalElement.removeEventListener('shown.bs.modal', handleShown);
    };
    
    modalElement.addEventListener('shown.bs.modal', handleShown, { once: true });
    modal.show();
}

/**
 * Open create transfer modal
 */
async function openCreateTransferModal() {
    const modalElement = document.getElementById('createTransferModal');
    if (!modalElement) {
        console.error('Create transfer modal not found');
        return;
    }
    
    // Clear previous selections
    const originSelect = document.getElementById('transferOriginFarm');
    const destSelect = document.getElementById('transferDestinationFarm');
    const workerList = document.getElementById('transferWorkerList');
    const notesField = document.getElementById('transferNotes');
    
    if (originSelect) originSelect.value = '';
    if (destSelect) destSelect.value = '';
    if (workerList) workerList.innerHTML = '<div class="text-center text-muted py-3">Select origin farm to load workers</div>';
    if (notesField) notesField.value = '';
    
    // Populate farm dropdowns
    try {
        const farmsResponse = await dataFunctions.getFarms();
        let farms = farmsResponse;
        if (farmsResponse && !Array.isArray(farmsResponse)) {
            if (farmsResponse.farms && Array.isArray(farmsResponse.farms)) {
                farms = farmsResponse.farms;
            } else if (farmsResponse.data && Array.isArray(farmsResponse.data)) {
                farms = farmsResponse.data;
            } else {
                farms = [];
            }
        }
        
        if (farms && Array.isArray(farms) && farms.length > 0) {
            if (originSelect && destSelect) {
                originSelect.innerHTML = '<option value="">Select Origin Farm</option>';
                destSelect.innerHTML = '<option value="">Select Destination Farm</option>';
                
                farms.forEach(farm => {
                    if (farm.id && farm.name) {
                        const originOption = document.createElement('option');
                        originOption.value = farm.id;
                        originOption.textContent = farm.name;
                        originSelect.appendChild(originOption);
                        
                        const destOption = document.createElement('option');
                        destOption.value = farm.id;
                        destOption.textContent = farm.name;
                        destSelect.appendChild(destOption);
                    }
                });
            }
            
            // Remove existing event listeners and add new one
            if (originSelect) {
                // Clone and replace to remove old listeners
                const newOriginSelect = originSelect.cloneNode(true);
                originSelect.parentNode.replaceChild(newOriginSelect, originSelect);
                
                newOriginSelect.addEventListener('change', async function() {
                    const farmId = this.value;
                    if (farmId) {
                        await loadWorkersForTransfer(farmId);
                    } else {
                        const workerList = document.getElementById('transferWorkerList');
                        if (workerList) {
                            workerList.innerHTML = '<div class="text-center text-muted py-3">Select origin farm to load workers</div>';
                        }
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error loading farms for transfer:', error);
        showErrorMessage('Error loading farms: ' + error.message);
    }
    
    // Set default start date to today
    const startDateInput = document.getElementById('transferStartDate');
    if (startDateInput) {
        startDateInput.value = new Date().toISOString().split('T')[0];
    }
    
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

/**
 * Load workers for transfer from selected farm
 */
async function loadWorkersForTransfer(farmId) {
    const workerList = document.getElementById('transferWorkerList');
    if (!workerList) return;
    
    workerList.innerHTML = `
        <div class="text-center text-muted py-3">
            <i class="bi bi-hourglass-split fs-4"></i>
            <p class="mb-0 mt-2">Loading workers...</p>
        </div>
    `;
    
    try {
        const workers = await dataFunctions.getWorkers({ farmId: farmId });
        if (!workers || !Array.isArray(workers) || workers.length === 0) {
            workerList.innerHTML = `
                <div class="text-center text-muted py-3">
                    <i class="bi bi-inbox fs-4"></i>
                    <p class="mb-0 mt-2">No workers found for this farm</p>
                </div>
            `;
            return;
        }
        
        // Filter for active workers
        const activeWorkers = workers.filter(w => w.is_active !== false);
        
        workerList.innerHTML = activeWorkers.map(worker => {
            const workerId = worker.id;
            const workerName = `${worker.first_name || ''} ${worker.last_name || ''}`.trim();
            const empNumber = worker.employee_number || 'N/A';
            
            return `
                <div class="form-check mb-2">
                    <input class="form-check-input" type="checkbox" value="${workerId}" id="worker_${workerId}">
                    <label class="form-check-label" for="worker_${workerId}">
                        <strong>${workerName}</strong> <span class="text-muted">(${empNumber})</span>
                    </label>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading workers for transfer:', error);
        workerList.innerHTML = `
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle me-2"></i>Error loading workers: ${error.message}
            </div>
        `;
    }
}

/**
 * Save transfer - update worker current_farm_id
 */
async function saveTransfer() {
    try {
        const originFarmId = document.getElementById('transferOriginFarm').value;
        const destFarmId = document.getElementById('transferDestinationFarm').value;
        const startDate = document.getElementById('transferStartDate').value;
        const endDate = document.getElementById('transferEndDate').value;
        const notes = document.getElementById('transferNotes').value;
        
        if (!originFarmId || !destFarmId || !startDate) {
            showErrorMessage('Please fill in all required fields');
            return;
        }
        
        // Get selected workers
        const workerCheckboxes = document.querySelectorAll('#transferWorkerList input[type="checkbox"]:checked');
        if (workerCheckboxes.length === 0) {
            showErrorMessage('Please select at least one worker to transfer');
            return;
        }
        
        const workerIds = Array.from(workerCheckboxes).map(cb => cb.value);
        
        // Update each worker's current_farm_id
        let successCount = 0;
        let errorCount = 0;
        
        for (const workerId of workerIds) {
            try {
                await dataFunctions.updateWorker(workerId, {
                    current_farm_id: destFarmId
                });
                successCount++;
            } catch (error) {
                console.error(`Error transferring worker ${workerId}:`, error);
                errorCount++;
            }
        }
        
        if (successCount > 0) {
            showSuccessMessage(`Successfully transferred ${successCount} worker(s)${errorCount > 0 ? ` (${errorCount} failed)` : ''}`);
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('createTransferModal'));
            if (modal) modal.hide();
            
            // Reload data
            await loadLabourData();
            loadSummaryStats();
            
            // Reload shared workers list if modal is open
            const sharedModal = bootstrap.Modal.getInstance(document.getElementById('sharedWorkersModal'));
            if (sharedModal) {
                await loadSharedWorkers();
            }
        } else {
            showErrorMessage('Failed to transfer workers. Please try again.');
        }
        
    } catch (error) {
        console.error('Error saving transfer:', error);
        showErrorMessage('Failed to create transfer: ' + error.message);
    }
}

/**
 * Revert worker transfer - return worker to home farm
 */
async function revertWorkerTransfer(workerId, homeFarmId) {
    try {
        if (!confirm('Return this worker to their home farm?')) {
            return;
        }
        
        await dataFunctions.updateWorker(workerId, {
            current_farm_id: homeFarmId
        });
        
        showSuccessMessage('Worker returned to home farm');
        
        // Reload data
        await loadLabourData();
        loadSummaryStats();
        
        // Reload shared workers list
        await loadSharedWorkers();
        
    } catch (error) {
        console.error('Error reverting transfer:', error);
        showErrorMessage('Failed to return worker: ' + error.message);
    }
}

/**
 * Manage workers - opens modal and loads worker list
 */
function manageWorkers(selectedFarmId = null) {
    const modalElement = document.getElementById('manageWorkersModal');
    if (!modalElement) {
        console.error('Manage workers modal not found');
        return;
    }
    
    // Store selected farm ID for use when loading filters
    if (selectedFarmId) {
        workerManagementState.selectedFarmId = selectedFarmId;
    }
    
    const modal = new bootstrap.Modal(modalElement);
    
    // Load workers when modal is shown
    const handleShown = async function() {
        await loadWorkersManagementList();
        modalElement.removeEventListener('shown.bs.modal', handleShown);
    };
    
    modalElement.addEventListener('shown.bs.modal', handleShown, { once: true });
    modal.show();
}

/**
 * Manage workers with selected farm from Labour Allocation page
 */
function manageWorkersWithSelectedFarm() {
    // Get selected farm from farm filter
    const farmSelector = document.getElementById('farmFilter');
    const selectedFarmId = farmSelector ? farmSelector.value : null;
    
    // Only pass farm ID if a specific farm is selected (not "all" or empty)
    const farmIdToPass = selectedFarmId && selectedFarmId !== '' && selectedFarmId !== 'all' 
        ? selectedFarmId 
        : null;
    
    manageWorkers(farmIdToPass);
}

// Worker Management State
const workerManagementState = {
    currentPage: 1,
    itemsPerPage: 20,
    currentView: localStorage.getItem('workerViewPreference') || 'table', // 'table' or 'card' - default to table
    allWorkers: [],
    filteredWorkers: [],
    selectedFarmId: null, // Farm ID passed from Labour Allocation page
    filters: {
        search: localStorage.getItem('workerFilterSearch') || '',
        farm: localStorage.getItem('workerFilterFarm') || '',
        employmentType: localStorage.getItem('workerFilterEmployment') || '',
        position: localStorage.getItem('workerFilterPosition') || '',
        status: localStorage.getItem('workerFilterStatus') || ''
    }
};

/**
 * Restore worker filters from localStorage to UI elements
 */
function restoreWorkerFilters() {
    try {
        const searchInput = document.getElementById('workerSearchInput');
        const farmFilter = document.getElementById('workerFilterFarm');
        const employmentFilter = document.getElementById('workerFilterEmployment');
        const positionFilter = document.getElementById('workerFilterPosition');
        const statusFilter = document.getElementById('workerFilterStatus');
        
        // Restore values from state (which is initialized from localStorage)
        if (searchInput && workerManagementState.filters.search) {
            searchInput.value = workerManagementState.filters.search;
        }
        
        // Farm filter is set in loadWorkerFilterOptions after options are populated
        if (farmFilter && workerManagementState.filters.farm) {
            // Try to set it now, but it might not have options yet
            if (farmFilter.options.length > 1) {
                farmFilter.value = workerManagementState.filters.farm;
            }
        }
        
        if (employmentFilter && workerManagementState.filters.employmentType) {
            employmentFilter.value = workerManagementState.filters.employmentType;
        }
        
        // Position filter is set in loadWorkerFilterOptions after options are populated
        if (positionFilter && workerManagementState.filters.position) {
            // Try to set it now, but it might not have options yet
            if (positionFilter.options.length > 1) {
                positionFilter.value = workerManagementState.filters.position;
            }
        }
        
        if (statusFilter && workerManagementState.filters.status) {
            statusFilter.value = workerManagementState.filters.status;
        }
    } catch (error) {
        console.error('Error restoring worker filters:', error);
        // Don't throw - just log the error
    }
}

/**
 * Load workers list for management modal with filtering and pagination
 */
async function loadWorkersManagementList() {
    try {
        showWorkerLoadingState();
        
        // Get all workers
        const workersResponse = await dataFunctions.getWorkers({});
        let allWorkers = workersResponse;
        
        // Handle response unwrapping
        if (workersResponse && !Array.isArray(workersResponse)) {
            if (workersResponse.workers && Array.isArray(workersResponse.workers)) {
                allWorkers = workersResponse.workers;
            } else if (workersResponse.data && Array.isArray(workersResponse.data)) {
                allWorkers = workersResponse.data;
            } else {
                allWorkers = [];
            }
        }
        
        if (!allWorkers || !Array.isArray(allWorkers)) {
            allWorkers = [];
        }
        
        workerManagementState.allWorkers = allWorkers;
        
        // Get farms for filters and name lookup
        await loadWorkerFilterOptions();
        
        // Restore filters to UI (they're already in state, but need to restore to form fields)
        restoreWorkerFilters();
        
        // If a farm was passed from Labour Allocation page, apply it after filters are loaded
        if (workerManagementState.selectedFarmId) {
            // The farm filter will be set in loadWorkerFilterOptions, but we need to apply the filter
            // This will happen after loadWorkerFilterOptions completes
            setTimeout(() => {
                applyWorkerFilters();
            }, 100);
        } else {
            // Apply filters (this will use the restored filter values)
            applyWorkerFilters();
        }
        
    } catch (error) {
        console.error('Error loading workers management list:', error);
        showWorkerErrorState(error.message);
    }
}

/**
 * Load filter options (farms, positions)
 */
async function loadWorkerFilterOptions() {
    try {
        // Load farms
        const farmsResponse = await dataFunctions.getFarms();
        let farms = farmsResponse;
        if (farmsResponse && !Array.isArray(farmsResponse)) {
            if (farmsResponse.farms && Array.isArray(farmsResponse.farms)) {
                farms = farmsResponse.farms;
            } else if (farmsResponse.data && Array.isArray(farmsResponse.data)) {
                farms = farmsResponse.data;
            } else {
                farms = [];
            }
        }
        
        // Populate farm filter
        const farmFilter = document.getElementById('workerFilterFarm');
        if (farmFilter && farms && Array.isArray(farms)) {
            // Priority: 1. Selected farm from Labour Allocation page, 2. Saved filter value, 3. Empty
            const defaultFarmId = workerManagementState.selectedFarmId || workerManagementState.filters.farm || '';
            farmFilter.innerHTML = '<option value="">All Farms</option>';
            farms.forEach(farm => {
                if (farm.id && farm.name) {
                    const option = document.createElement('option');
                    option.value = farm.id;
                    option.textContent = farm.name;
                    if (defaultFarmId === farm.id) option.selected = true;
                    farmFilter.appendChild(option);
                }
            });
            
            // If a farm was selected from Labour Allocation page, update the filter state and apply it
            if (workerManagementState.selectedFarmId) {
                workerManagementState.filters.farm = workerManagementState.selectedFarmId;
                // Clear the selectedFarmId after using it so it doesn't persist
                workerManagementState.selectedFarmId = null;
            }
        }
        
        // Get unique positions from workers
        const positions = [...new Set(workerManagementState.allWorkers
            .map(w => w.position)
            .filter(p => p && p.trim() !== ''))].sort();
        
        const positionFilter = document.getElementById('workerFilterPosition');
        if (positionFilter) {
            // Use saved filter value from state
            const savedValue = workerManagementState.filters.position || '';
            positionFilter.innerHTML = '<option value="">All Positions</option>';
            positions.forEach(position => {
                const option = document.createElement('option');
                option.value = position;
                option.textContent = position;
                if (savedValue === position) option.selected = true;
                positionFilter.appendChild(option);
            });
        }
        
    } catch (error) {
        console.error('Error loading filter options:', error);
    }
}

/**
 * Apply filters and render workers
 */
function applyWorkerFilters() {
    const searchInput = document.getElementById('workerSearchInput');
    const searchTerm = (searchInput?.value || '').trim();
    const farmFilter = document.getElementById('workerFilterFarm')?.value || '';
    const employmentFilter = document.getElementById('workerFilterEmployment')?.value || '';
    const positionFilter = document.getElementById('workerFilterPosition')?.value || '';
    const statusFilter = document.getElementById('workerFilterStatus')?.value || '';
    
    workerManagementState.filters = {
        search: searchTerm.toLowerCase(),
        farm: farmFilter,
        employmentType: employmentFilter,
        position: positionFilter,
        status: statusFilter
    };
    
    // Save filters to localStorage
    if (searchTerm) {
        localStorage.setItem('workerFilterSearch', searchTerm);
    } else {
        localStorage.removeItem('workerFilterSearch');
    }
    if (farmFilter) {
        localStorage.setItem('workerFilterFarm', farmFilter);
    } else {
        localStorage.removeItem('workerFilterFarm');
    }
    if (employmentFilter) {
        localStorage.setItem('workerFilterEmployment', employmentFilter);
    } else {
        localStorage.removeItem('workerFilterEmployment');
    }
    if (positionFilter) {
        localStorage.setItem('workerFilterPosition', positionFilter);
    } else {
        localStorage.removeItem('workerFilterPosition');
    }
    if (statusFilter) {
        localStorage.setItem('workerFilterStatus', statusFilter);
    } else {
        localStorage.removeItem('workerFilterStatus');
    }
    
    // Filter workers
    let filtered = [...workerManagementState.allWorkers];
    
    const searchTermLower = searchTerm.toLowerCase();
    if (searchTermLower) {
        filtered = filtered.filter(w => {
            const fullName = `${w.first_name || ''} ${w.last_name || ''}`.toLowerCase();
            const empNum = (w.employee_number || '').toLowerCase();
            return fullName.includes(searchTermLower) || empNum.includes(searchTermLower);
        });
    }
    
    if (farmFilter) {
        filtered = filtered.filter(w => {
            const homeFarmId = w.home_farm_id || w.homeFarmId;
            const currentFarmId = w.current_farm_id || w.currentFarmId;
            return homeFarmId === farmFilter || currentFarmId === farmFilter;
        });
    }
    
    if (employmentFilter) {
        filtered = filtered.filter(w => (w.employment_type || '').toLowerCase() === employmentFilter.toLowerCase());
    }
    
    if (positionFilter) {
        filtered = filtered.filter(w => (w.position || '') === positionFilter);
    }
    
    if (statusFilter) {
        if (statusFilter === 'active') {
            filtered = filtered.filter(w => w.is_active !== false && w.status !== 'inactive');
        } else if (statusFilter === 'inactive') {
            filtered = filtered.filter(w => w.is_active === false || w.status === 'inactive');
        }
    }
    
    workerManagementState.filteredWorkers = filtered;
    workerManagementState.currentPage = 1;
    
    renderWorkers();
}
// Make globally accessible
if (typeof window !== 'undefined') window.applyWorkerFilters = applyWorkerFilters;

/**
 * Render workers based on current view and page
 */
async function renderWorkers() {
    const workers = workerManagementState.filteredWorkers;
    const totalWorkers = workers.length;
    const itemsPerPage = workerManagementState.itemsPerPage;
    const currentPage = workerManagementState.currentPage;
    const totalPages = Math.ceil(totalWorkers / itemsPerPage);
    
    // Update results info
    const start = (currentPage - 1) * itemsPerPage + 1;
    const end = Math.min(currentPage * itemsPerPage, totalWorkers);
    const infoEl = document.getElementById('workerResultsInfo');
    if (infoEl) {
        infoEl.textContent = `Showing ${start}-${end} of ${totalWorkers} workers`;
    }
    
    // Get paginated workers
    const paginatedWorkers = workers.slice(start - 1, end);
    
    // Get farms map
    const farmsResponse = await dataFunctions.getFarms();
    let farms = farmsResponse;
    if (farmsResponse && !Array.isArray(farmsResponse)) {
        if (farmsResponse.farms && Array.isArray(farmsResponse.farms)) {
            farms = farmsResponse.farms;
        } else if (farmsResponse.data && Array.isArray(farmsResponse.data)) {
            farms = farmsResponse.data;
        } else {
            farms = [];
        }
    }
    
    const farmsMap = new Map();
    if (farms && Array.isArray(farms)) {
        farms.forEach(f => {
            if (f.id) farmsMap.set(f.id, f.name || 'Unknown Farm');
        });
    }
    
    // Ensure view is set correctly before rendering
    const currentView = workerManagementState.currentView || 'table';
    if (currentView === 'table') {
        renderWorkersTable(paginatedWorkers, farmsMap);
    } else {
        renderWorkersCards(paginatedWorkers, farmsMap);
    }
    
    renderWorkerPagination(totalPages);
}

/**
 * Render workers table
 */
function renderWorkersTable(workers, farmsMap) {
    const tbody = document.getElementById('workersManagementTableBody');
    if (!tbody) return;
    
    if (workers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-3"></i>
                    <p class="mb-0 mt-2">No workers found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = workers.map(worker => {
        const homeFarmId = worker.home_farm_id || worker.homeFarmId;
        const currentFarmId = worker.current_farm_id || worker.currentFarmId;
        const homeFarmName = homeFarmId ? (farmsMap.get(homeFarmId) || 'Unknown') : '-';
        const currentFarmName = currentFarmId ? (farmsMap.get(currentFarmId) || 'Unknown') : '-';
        const displayFarm = currentFarmName !== '-' ? currentFarmName : homeFarmName;
        const isShared = homeFarmId && currentFarmId && homeFarmId !== currentFarmId;
        const isActive = worker.is_active !== false && worker.status !== 'inactive';
        const statusBadge = isActive 
            ? '<span class="badge bg-success">Active</span>' 
            : '<span class="badge bg-secondary">Inactive</span>';
        const empTypeBadge = worker.employment_type 
            ? `<span class="badge bg-info">${worker.employment_type.charAt(0).toUpperCase() + worker.employment_type.slice(1)}</span>`
            : '-';
        const fullName = `${worker.first_name || ''} ${worker.last_name || ''}`.trim();
        const contactInfo = `${worker.phone || '-'}<br><small class="text-muted">${worker.email || ''}</small>`;
        
        return `
            <tr>
                <td><strong>${worker.employee_number || '-'}</strong></td>
                <td>
                    <strong>${fullName}</strong><br>
                    <small class="text-muted">${worker.id_number || 'No ID'}</small><br>
                    ${worker.position ? `<small><span class="badge bg-secondary">${worker.position}</span></small>` : ''}
                </td>
                <td><small>${contactInfo}</small></td>
                <td>
                    ${displayFarm}${isShared ? ' <i class="bi bi-diagram-3 text-primary" title="Shared Worker"></i>' : ''}<br>
                    ${empTypeBadge}
                </td>
                <td>${worker.hourly_rate ? '<strong>R ' + parseFloat(worker.hourly_rate).toFixed(2) + '</strong>' : '-'}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="editWorker('${worker.id}')" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteWorkerConfirm('${worker.id}', '${fullName.replace(/'/g, "\\'")}')" title="Deactivate">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Render workers cards
 */
function renderWorkersCards(workers, farmsMap) {
    const cardBody = document.getElementById('workersManagementCardBody');
    if (!cardBody) return;
    
    if (workers.length === 0) {
        cardBody.innerHTML = `
            <div class="col-12 text-center text-muted py-4">
                <i class="bi bi-inbox fs-3"></i>
                <p class="mb-0 mt-2">No workers found</p>
            </div>
        `;
        return;
    }
    
    cardBody.innerHTML = workers.map(worker => {
        const homeFarmId = worker.home_farm_id || worker.homeFarmId;
        const currentFarmId = worker.current_farm_id || worker.currentFarmId;
        const homeFarmName = homeFarmId ? (farmsMap.get(homeFarmId) || 'Unknown') : '-';
        const currentFarmName = currentFarmId ? (farmsMap.get(currentFarmId) || 'Unknown') : '-';
        const displayFarm = currentFarmName !== '-' ? currentFarmName : homeFarmName;
        const isShared = homeFarmId && currentFarmId && homeFarmId !== currentFarmId;
        const isActive = worker.is_active !== false && worker.status !== 'inactive';
        const statusBadge = isActive 
            ? '<span class="badge bg-success">Active</span>' 
            : '<span class="badge bg-secondary">Inactive</span>';
        const empTypeBadge = worker.employment_type 
            ? `<span class="badge bg-info">${worker.employment_type.charAt(0).toUpperCase() + worker.employment_type.slice(1)}</span>`
            : '';
        const fullName = `${worker.first_name || ''} ${worker.last_name || ''}`.trim();
        
        return `
            <div class="col-md-4 col-lg-3">
                <div class="card h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                                <h6 class="card-title mb-1">${fullName}</h6>
                                <small class="text-muted">${worker.employee_number || '-'}</small>
                            </div>
                            ${statusBadge}
                        </div>
                        <hr class="my-2">
                        <div class="small">
                            <p class="mb-1"><strong>Position:</strong> ${worker.position || '-'}</p>
                            <p class="mb-1"><strong>Farm:</strong> ${displayFarm}${isShared ? ' <i class="bi bi-diagram-3 text-primary" title="Shared"></i>' : ''}</p>
                            <p class="mb-1"><strong>Type:</strong> ${empTypeBadge}</p>
                            <p class="mb-1"><strong>Rate:</strong> ${worker.hourly_rate ? 'R ' + parseFloat(worker.hourly_rate).toFixed(2) : '-'}</p>
                            ${worker.phone ? `<p class="mb-1"><strong>Phone:</strong> ${worker.phone}</p>` : ''}
                        </div>
                    </div>
                    <div class="card-footer bg-white">
                        <div class="btn-group w-100" role="group">
                            <button class="btn btn-sm btn-outline-primary" onclick="editWorker('${worker.id}')" title="Edit">
                                <i class="bi bi-pencil me-1"></i>Edit
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteWorkerConfirm('${worker.id}', '${fullName.replace(/'/g, "\\'")}')" title="Deactivate">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Render pagination
 */
function renderWorkerPagination(totalPages) {
    const paginationEl = document.getElementById('workerPagination');
    if (!paginationEl || totalPages <= 1) {
        if (paginationEl) paginationEl.innerHTML = '';
        return;
    }
    
    const currentPage = workerManagementState.currentPage;
    let html = '';
    
    // Previous button
    html += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changeWorkerPage(${currentPage - 1}); return false;">Previous</a>
        </li>
    `;
    
    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            html += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="changeWorkerPage(${i}); return false;">${i}</a>
                </li>
            `;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }
    
    // Next button
    html += `
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changeWorkerPage(${currentPage + 1}); return false;">Next</a>
        </li>
    `;
    
    paginationEl.innerHTML = html;
}

/**
 * Change worker page
 */
function changeWorkerPage(page) {
    const totalPages = Math.ceil(workerManagementState.filteredWorkers.length / workerManagementState.itemsPerPage);
    if (page < 1 || page > totalPages) return;
    
    workerManagementState.currentPage = page;
    renderWorkers();
    
    // Scroll to top of modal body
    const modalBody = document.querySelector('#manageWorkersModal .modal-body');
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
}
// Make globally accessible
if (typeof window !== 'undefined') {
    window.changeWorkerPage = changeWorkerPage;
    window.confirmDeactivateWorker = confirmDeactivateWorker;
}


/**
 * Set worker view (table or card)
 * @param {string} view - 'table' or 'card'
 * @param {boolean} render - Whether to render workers after changing view (default: true)
 */
function setWorkerView(view, render = true) {
    workerManagementState.currentView = view;
    
    // Save view preference to localStorage
    localStorage.setItem('workerViewPreference', view);
    
    const tableView = document.getElementById('workersTableView');
    const cardView = document.getElementById('workersCardView');
    const tableBtn = document.getElementById('viewTableBtn');
    const cardBtn = document.getElementById('viewCardBtn');
    
    if (view === 'table') {
        if (tableView) tableView.style.display = 'block';
        if (cardView) cardView.style.display = 'none';
        if (tableBtn) tableBtn.classList.add('active');
        if (cardBtn) cardBtn.classList.remove('active');
    } else {
        if (tableView) tableView.style.display = 'none';
        if (cardView) cardView.style.display = 'block';
        if (tableBtn) tableBtn.classList.remove('active');
        if (cardBtn) cardBtn.classList.add('active');
    }
    
    if (render) {
        renderWorkers();
    }
}
// Make globally accessible
if (typeof window !== 'undefined') window.setWorkerView = setWorkerView;


/**
 * Show loading state
 */
function showWorkerLoadingState() {
    const tbody = document.getElementById('workersManagementTableBody');
    const cardBody = document.getElementById('workersManagementCardBody');
    
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-4">
                    <i class="bi bi-hourglass-split fs-3"></i>
                    <p class="mb-0 mt-2">Loading workers...</p>
                </td>
            </tr>
        `;
    }
    
    if (cardBody) {
        cardBody.innerHTML = `
            <div class="col-12 text-center text-muted py-4">
                <i class="bi bi-hourglass-split fs-3"></i>
                <p class="mb-0 mt-2">Loading workers...</p>
            </div>
        `;
    }
}

/**
 * Show error state
 */
function showWorkerErrorState(message) {
    const tbody = document.getElementById('workersManagementTableBody');
    const cardBody = document.getElementById('workersManagementCardBody');
    
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-danger py-4">
                    <i class="bi bi-exclamation-triangle fs-3"></i>
                    <p class="mb-0 mt-2">Error loading workers: ${message}</p>
                </td>
            </tr>
        `;
    }
    
    if (cardBody) {
        cardBody.innerHTML = `
            <div class="col-12 text-center text-danger py-4">
                <i class="bi bi-exclamation-triangle fs-3"></i>
                <p class="mb-0 mt-2">Error loading workers: ${message}</p>
            </div>
        `;
    }
}

/**
 * Open add worker modal
 */
async function openAddWorkerModal() {
    const modalElement = document.getElementById('workerFormModal');
    if (!modalElement) {
        console.error('Worker form modal not found');
        return;
    }
    
    // Reset form
    const form = document.getElementById('workerForm');
    if (form) form.reset();
    
    // Clear edit ID
    const editIdField = document.getElementById('editWorkerId');
    if (editIdField) editIdField.value = '';
    
    // Update title and icon
    const titleEl = document.getElementById('workerFormTitle');
    const iconEl = document.getElementById('workerFormIcon');
    if (titleEl) titleEl.textContent = 'Add Worker';
    if (iconEl) {
        iconEl.className = 'bi bi-person-plus me-2';
    }
    
    // Hide status field for new workers
    const statusField = document.getElementById('workerStatusField');
    if (statusField) statusField.style.display = 'none';
    
    // Populate farm dropdowns
    try {
        const farmsResponse = await dataFunctions.getFarms();
        let farms = farmsResponse;
        if (farmsResponse && !Array.isArray(farmsResponse)) {
            if (farmsResponse.farms && Array.isArray(farmsResponse.farms)) {
                farms = farmsResponse.farms;
            } else if (farmsResponse.data && Array.isArray(farmsResponse.data)) {
                farms = farmsResponse.data;
            } else {
                farms = [];
            }
        }
        
        const homeFarmSelect = document.getElementById('workerHomeFarm');
        const currentFarmSelect = document.getElementById('workerCurrentFarm');
        
        if (homeFarmSelect && currentFarmSelect && farms && Array.isArray(farms)) {
            homeFarmSelect.innerHTML = '<option value="">Select Home Farm</option>';
            currentFarmSelect.innerHTML = '<option value="">Select Current Farm</option>';
            
            farms.forEach(farm => {
                if (farm.id && farm.name) {
                    const homeOption = document.createElement('option');
                    homeOption.value = farm.id;
                    homeOption.textContent = farm.name;
                    homeFarmSelect.appendChild(homeOption);
                    
                    const currentOption = document.createElement('option');
                    currentOption.value = farm.id;
                    currentOption.textContent = farm.name;
                    currentFarmSelect.appendChild(currentOption);
                }
            });
        }
    } catch (error) {
        console.error('Error loading farms:', error);
    }
    
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

/**
 * Edit worker - load data and open modal
 */
async function editWorker(workerId) {
    try {
        // Get all workers and find the one we want to edit
        const workersResponse = await dataFunctions.getWorkers({});
        let workers = workersResponse;
        
        if (workersResponse && !Array.isArray(workersResponse)) {
            if (workersResponse.workers && Array.isArray(workersResponse.workers)) {
                workers = workersResponse.workers;
            } else if (workersResponse.data && Array.isArray(workersResponse.data)) {
                workers = workersResponse.data;
            } else {
                workers = [];
            }
        }
        
        const worker = workers && Array.isArray(workers) 
            ? workers.find(w => (w.id || w.worker_id) === workerId)
            : null;
        
        if (!worker) {
            showErrorMessage('Worker not found');
            return;
        }
        
        // Populate form fields
        document.getElementById('editWorkerId').value = worker.id || worker.worker_id;
        document.getElementById('workerEmployeeNumber').value = worker.employee_number || '';
        document.getElementById('workerIdNumber').value = worker.id_number || '';
        document.getElementById('workerFirstName').value = worker.first_name || '';
        document.getElementById('workerLastName').value = worker.last_name || '';
        document.getElementById('workerPhone').value = worker.phone || '';
        document.getElementById('workerEmail').value = worker.email || '';
        document.getElementById('workerEmploymentType').value = worker.employment_type || '';
        document.getElementById('workerPosition').value = worker.position || '';
        document.getElementById('workerHourlyRate').value = worker.hourly_rate || '';
        document.getElementById('workerHireDate').value = worker.hire_date || '';
        document.getElementById('workerBankName').value = worker.bank_name || '';
        document.getElementById('workerBankAccount').value = worker.bank_account_number || '';
        document.getElementById('workerBankBranch').value = worker.bank_branch_code || '';
        document.getElementById('workerIsActive').checked = worker.is_active !== false;
        
        // Populate farm dropdowns
        const farmsResponse = await dataFunctions.getFarms();
        let farms = farmsResponse;
        if (farmsResponse && !Array.isArray(farmsResponse)) {
            if (farmsResponse.farms && Array.isArray(farmsResponse.farms)) {
                farms = farmsResponse.farms;
            } else if (farmsResponse.data && Array.isArray(farmsResponse.data)) {
                farms = farmsResponse.data;
            } else {
                farms = [];
            }
        }
        
        const homeFarmSelect = document.getElementById('workerHomeFarm');
        const currentFarmSelect = document.getElementById('workerCurrentFarm');
        
        if (homeFarmSelect && currentFarmSelect && farms && Array.isArray(farms)) {
            homeFarmSelect.innerHTML = '<option value="">Select Home Farm</option>';
            currentFarmSelect.innerHTML = '<option value="">Select Current Farm</option>';
            
            farms.forEach(farm => {
                if (farm.id && farm.name) {
                    const homeOption = document.createElement('option');
                    homeOption.value = farm.id;
                    homeOption.textContent = farm.name;
                    if ((worker.home_farm_id || worker.homeFarmId) === farm.id) {
                        homeOption.selected = true;
                    }
                    homeFarmSelect.appendChild(homeOption);
                    
                    const currentOption = document.createElement('option');
                    currentOption.value = farm.id;
                    currentOption.textContent = farm.name;
                    if ((worker.current_farm_id || worker.currentFarmId) === farm.id) {
                        currentOption.selected = true;
                    }
                    currentFarmSelect.appendChild(currentOption);
                }
            });
        }
        
        // Update title and icon
        const titleEl = document.getElementById('workerFormTitle');
        const iconEl = document.getElementById('workerFormIcon');
        if (titleEl) titleEl.textContent = 'Edit Worker';
        if (iconEl) {
            iconEl.className = 'bi bi-person-check me-2';
        }
        
        // Show status field for editing
        const statusField = document.getElementById('workerStatusField');
        if (statusField) statusField.style.display = 'block';
        
        // Open modal
        const modal = new bootstrap.Modal(document.getElementById('workerFormModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error loading worker for edit:', error);
        showErrorMessage('Error loading worker: ' + error.message);
    }
}

/**
 * Save worker (create or update)
 */
async function saveWorker() {
    try {
        const form = document.getElementById('workerForm');
        if (!form || !form.checkValidity()) {
            form.reportValidity();
            return;
        }
        
        const editId = document.getElementById('editWorkerId').value;
        const isEdit = !!editId;
        
        const workerData = {
            employee_number: document.getElementById('workerEmployeeNumber').value.trim(),
            first_name: document.getElementById('workerFirstName').value.trim(),
            last_name: document.getElementById('workerLastName').value.trim(),
            id_number: document.getElementById('workerIdNumber').value.trim() || null,
            phone: document.getElementById('workerPhone').value.trim() || null,
            email: document.getElementById('workerEmail').value.trim() || null,
            home_farm_id: document.getElementById('workerHomeFarm').value || null,
            current_farm_id: document.getElementById('workerCurrentFarm').value || null,
            employment_type: document.getElementById('workerEmploymentType').value || null,
            position: document.getElementById('workerPosition').value.trim() || null,
            hourly_rate: document.getElementById('workerHourlyRate').value ? parseFloat(document.getElementById('workerHourlyRate').value) : null,
            hire_date: document.getElementById('workerHireDate').value || null,
            bank_name: document.getElementById('workerBankName').value.trim() || null,
            bank_account_number: document.getElementById('workerBankAccount').value.trim() || null,
            bank_branch_code: document.getElementById('workerBankBranch').value.trim() || null
        };
        
        if (isEdit) {
            workerData.is_active = document.getElementById('workerIsActive').checked;
            await dataFunctions.updateWorker(editId, workerData);
            showSuccessMessage('Worker updated successfully');
        } else {
            await dataFunctions.createWorker(workerData);
            showSuccessMessage('Worker created successfully');
        }
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('workerFormModal'));
        if (modal) modal.hide();
        
        // Reload workers list
        await loadWorkersManagementList();
        
        // Reload main labour data if on labour page
        if (typeof loadLabourData === 'function') {
            await loadLabourData();
            loadSummaryStats();
        }
        
    } catch (error) {
        console.error('Error saving worker:', error);
        showErrorMessage('Error saving worker: ' + error.message);
    }
}

/**
 * Confirm and delete worker - shows modern confirmation modal
 */
function deleteWorkerConfirm(workerId, workerName) {
    // Set worker details in modal
    const modalElement = document.getElementById('deactivateWorkerModal');
    const workerNameEl = document.getElementById('deactivateWorkerName');
    const workerIdEl = document.getElementById('deactivateWorkerId');
    
    if (!modalElement) {
        // Fallback to basic confirm if modal not found
        if (!confirm(`Are you sure you want to deactivate ${workerName}? This action cannot be undone.`)) {
            return;
        }
        performWorkerDeactivation(workerId);
        return;
    }
    
    if (workerNameEl) {
        workerNameEl.innerHTML = `Are you sure you want to deactivate <strong>${escapeHtml(workerName)}</strong>?`;
    }
    if (workerIdEl) {
        workerIdEl.value = workerId;
    }
    
    // Show modal
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

/**
 * Confirm deactivation and proceed
 */
async function confirmDeactivateWorker() {
    const workerIdEl = document.getElementById('deactivateWorkerId');
    if (!workerIdEl || !workerIdEl.value) {
        showErrorMessage('Worker ID not found');
        return;
    }
    
    const workerId = workerIdEl.value;
    
    // Close modal
    const modalElement = document.getElementById('deactivateWorkerModal');
    const modal = bootstrap.Modal.getInstance(modalElement);
    if (modal) {
        modal.hide();
    }
    
    // Perform deactivation
    await performWorkerDeactivation(workerId);
}

/**
 * Perform the actual worker deactivation
 */
async function performWorkerDeactivation(workerId) {
    try {
        await dataFunctions.deleteWorker(workerId);
        showSuccessMessage('Worker deactivated successfully');
        
        // Reload workers list
        await loadWorkersManagementList();
        
        // Reload main labour data if on labour page
        if (typeof loadLabourData === 'function') {
            await loadLabourData();
            loadSummaryStats();
        }
        
    } catch (error) {
        console.error('Error deleting worker:', error);
        showErrorMessage('Error deactivating worker: ' + error.message);
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Print summary
 */
function printSummary() {
    window.print();
}

/**
 * Show success message
 */
function showSuccessMessage(message) {
    if (typeof _common !== 'undefined' && _common.showSuccessToast) {
        _common.showSuccessToast(message);
    } else if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'success',
            title: 'Success',
            text: message,
            timer: 3000,
            showConfirmButton: false,
            toast: true,
            position: 'top-end'
        });
    } else {
        alert(message);
    }
}

/**
 * Show error message
 */
function showErrorMessage(message) {
    if (typeof _common !== 'undefined' && _common.showErrorToast) {
        _common.showErrorToast(message);
    } else if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: message,
            timer: 5000,
            showConfirmButton: true
        });
    } else {
        console.error('Error:', message);
        alert('Error: ' + message);
    }
}

/**
 * Show info message
 */
function showInfoMessage(message) {
    if (typeof _common !== 'undefined' && _common.showInfoToast) {
        _common.showInfoToast(message);
    } else if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'info',
            title: 'Info',
            text: message,
            timer: 3000,
            showConfirmButton: false,
            toast: true,
            position: 'top-end'
        });
    } else {
        alert(message);
    }
}

/**
 * Show workers in grid based on filter type or task
 */
function showWorkersInGrid(filterType, taskType = null) {
    let filteredWorkers = [];
    let title = 'Worker Allocations';
    
    const farmSelector = document.getElementById('farmFilter');
    const selectedFarmId = farmSelector ? farmSelector.value : '';
    const selectedFarmName = farmSelector && farmSelector.selectedIndex > 0 
        ? farmSelector.options[farmSelector.selectedIndex].text 
        : 'Selected Farm';
    
    if (taskType) {
        // Show workers by task type
        if (!selectedFarmId || selectedFarmId === '' || selectedFarmId === 'all') {
            showErrorMessage('Please select a farm first to view task allocations');
            return;
        }
        
        filteredWorkers = labourData.workers.filter(worker => {
            // Must be allocated to selected farm
            const isAllocatedToFarm = worker.farmId === selectedFarmId || 
                                      (worker.farm && worker.farm !== 'Not Allocated' && worker.farm !== '-');
            
            if (!isAllocatedToFarm) return false;
            
            // Must have matching task type
            const workerTask = (worker.task || '').toLowerCase();
            const taskTypeLower = taskType.toLowerCase();
            return workerTask.includes(taskTypeLower);
        });
        
        title = `Workers Allocated to ${taskType} - ${selectedFarmName}`;
    } else {
        // Show workers by filter type
        switch(filterType) {
            case 'total':
                // Workers whose home farm matches selected farm
                if (!selectedFarmId || selectedFarmId === '' || selectedFarmId === 'all') {
                    showErrorMessage('Please select a farm first');
                    return;
                }
                filteredWorkers = labourData.workers.filter(worker => {
                    return worker._homeFarmId === selectedFarmId;
                });
                title = `All Workers from ${selectedFarmName}`;
                break;
                
            case 'allocated':
                // Workers allocated to selected farm
                if (!selectedFarmId || selectedFarmId === '' || selectedFarmId === 'all') {
                    showErrorMessage('Please select a farm first');
                    return;
                }
                filteredWorkers = labourData.workers.filter(worker => {
                    const isAllocated = worker.farm && worker.farm !== 'Not Allocated' && worker.farm !== '-' && worker.task && worker.task !== '-';
                    return isAllocated && worker.farmId === selectedFarmId;
                });
                title = `Workers Allocated to ${selectedFarmName}`;
                break;
                
            case 'unallocated':
                // Workers from selected farm who are not allocated
                if (!selectedFarmId || selectedFarmId === '' || selectedFarmId === 'all') {
                    showErrorMessage('Please select a farm first');
                    return;
                }
                filteredWorkers = labourData.workers.filter(worker => {
                    const isFromFarm = worker._homeFarmId === selectedFarmId;
                    const isAllocated = worker.farm && worker.farm !== 'Not Allocated' && worker.farm !== '-' && worker.task && worker.task !== '-';
                    return isFromFarm && !isAllocated;
                });
                title = `Unallocated Workers from ${selectedFarmName}`;
                break;
                
            case 'allocatedToOtherFarms':
                // Workers allocated to farms other than selected farm
                if (!selectedFarmId || selectedFarmId === '' || selectedFarmId === 'all') {
                    showErrorMessage('Please select a farm first');
                    return;
                }
                filteredWorkers = labourData.workers.filter(worker => {
                    const isAllocated = worker.farm && worker.farm !== 'Not Allocated' && worker.farm !== '-' && worker.task && worker.task !== '-';
                    return isAllocated && worker.farmId && worker.farmId !== selectedFarmId;
                });
                title = `Workers Allocated to Other Farms (Not ${selectedFarmName})`;
                break;
                
            default:
                filteredWorkers = labourData.workers;
        }
    }
    
    // Update the grid with filtered workers
    updateWorkerAllocationsGrid(filteredWorkers, title);
}

/**
 * Update worker allocations grid
 */
function updateWorkerAllocationsGrid(workers, title) {
    // Update title
    const titleEl = document.getElementById('workerAllocationsTitle');
    if (titleEl) {
        titleEl.textContent = title;
    }
    
    // Update filtered workers and reload grid
    labourData.filteredWorkers = workers;
    labourData.currentPage = 1;
    loadWorkersList();
    
    // Scroll to grid
    const gridCard = document.querySelector('.card');
    if (gridCard) {
        gridCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Reset worker allocations grid to default view
 */
function resetWorkerAllocationsGrid() {
    const titleEl = document.getElementById('workerAllocationsTitle');
    if (titleEl) {
        titleEl.textContent = 'Worker Allocations';
    }
    
    // Reset to show all workers (respecting current filters)
    filterWorkers();
    labourData.currentPage = 1;
    loadWorkersList();
}

/**
 * Show worker details modal
 */
function showWorkerDetailsModal(workers, title, badgeText) {
    const modalElement = document.getElementById('workerDetailsModal');
    if (!modalElement) {
        console.error('Worker details modal not found');
        return;
    }
    
    // Update title and badge
    const titleEl = document.getElementById('workerDetailsTitle');
    const badgeEl = document.getElementById('workerDetailsFilterBadge');
    if (titleEl) titleEl.textContent = title;
    if (badgeEl) badgeEl.textContent = badgeText;
    
    // Render workers table
    renderWorkerDetailsTable(workers);
    
    // Show modal
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

/**
 * Render worker details table
 */
function renderWorkerDetailsTable(workers) {
    const tbody = document.getElementById('workerDetailsTableBody');
    if (!tbody) return;
    
    if (workers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-3"></i>
                    <p class="mb-0 mt-2">No workers found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = workers.map(worker => {
        const statusBadgeClass = getStatusBadgeClass(worker.status);
        const isAllocated = worker.farm && worker.farm !== 'Not Allocated' && worker.farm !== '-';
        
        return `
            <tr>
                <td>
                    <input type="checkbox" class="worker-checkbox" value="${worker.id}" data-worker-id="${worker.id}">
                </td>
                <td class="fw-bold">${worker.name}</td>
                <td>${worker.employeeNumber || 'N/A'}</td>
                <td>${worker.idNumber || 'N/A'}</td>
                <td>${worker.farm || 'Not Allocated'}</td>
                <td>${worker.block || '-'}</td>
                <td>${worker.task || '-'}</td>
                <td><span class="badge ${statusBadgeClass}">${worker.status}</span></td>
                <td>
                    <div class="btn-group btn-group-sm" role="group">
                        ${isAllocated ? `
                            <button class="btn btn-outline-primary" onclick="editWorkerAllocationFromDetails('${worker.id}')" title="Change Allocation">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-outline-danger" onclick="removeWorkerAllocation('${worker.id}', '${escapeHtml(worker.name)}')" title="Remove Allocation">
                                <i class="bi bi-x-circle"></i>
                            </button>
                        ` : `
                            <button class="btn btn-outline-success" onclick="setWorkerAllocation('${worker.id}', '${escapeHtml(worker.name)}')" title="Set Allocation">
                                <i class="bi bi-plus-circle"></i>
                            </button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Toggle select all workers
 */
function toggleSelectAllWorkers() {
    const selectAll = document.getElementById('selectAllWorkers');
    const checkboxes = document.querySelectorAll('.worker-checkbox');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
    });
}

/**
 * Bulk allocate selected workers
 */
async function bulkAllocateWorkers() {
    const selectedCheckboxes = document.querySelectorAll('.worker-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
        showErrorMessage('Please select at least one worker');
        return;
    }
    
    const workerIds = Array.from(selectedCheckboxes).map(cb => cb.value);
    
    // Use the existing bulk allocation modal
    const bulkModal = document.getElementById('bulkAllocationModal');
    if (bulkModal) {
        // Store selected worker IDs for bulk allocation
        bulkModal.dataset.selectedWorkerIds = JSON.stringify(workerIds);
        
        const modal = new bootstrap.Modal(bulkModal);
        modal.show();
    } else {
        showErrorMessage('Bulk allocation modal not found');
    }
}

/**
 * Edit worker allocation from details modal
 */
function editWorkerAllocationFromDetails(workerId) {
    // Close worker details modal
    const detailsModal = bootstrap.Modal.getInstance(document.getElementById('workerDetailsModal'));
    if (detailsModal) {
        detailsModal.hide();
    }
    
    // Open edit allocation modal
    editWorkerAllocation(workerId);
}

/**
 * Remove worker allocation
 */
async function removeWorkerAllocation(workerId, workerName) {
    if (!confirm(`Remove allocation for ${workerName}?`)) {
        return;
    }
    
    try {
        // Get today's date
        const today = new Date().toISOString().split('T')[0];
        
        // Find the allocation for this worker
        const allocations = await dataFunctions.getWorkerAllocations({
            workerId: workerId,
            allocationDate: today
        });
        
        let allocationArray = allocations;
        if (allocations && !Array.isArray(allocations)) {
            if (allocations.allocations && Array.isArray(allocations.allocations)) {
                allocationArray = allocations.allocations;
            } else if (allocations.data && Array.isArray(allocations.data)) {
                allocationArray = allocations.data;
            } else {
                allocationArray = [];
            }
        }
        
        if (allocationArray.length === 0) {
            showErrorMessage('No allocation found for this worker');
            return;
        }
        
        // Delete the allocation
        const allocation = allocationArray[0];
        const allocationId = allocation.id || allocation.allocation_id;
        
        if (allocationId) {
            await dataFunctions.deleteWorkerAllocation(allocationId);
            showSuccessMessage('Allocation removed successfully');
            
            // Reload data
            await loadLabourData();
            loadSummaryStats();
            
            // Refresh worker details modal if open
            const detailsModal = bootstrap.Modal.getInstance(document.getElementById('workerDetailsModal'));
            if (detailsModal) {
                // Re-show the current filter
                const badgeEl = document.getElementById('workerDetailsFilterBadge');
                if (badgeEl) {
                    const badgeText = badgeEl.textContent;
                    if (badgeText.includes('Allocated')) {
                        showWorkersByFilter('allocated');
                    } else if (badgeText.includes('Pruning')) {
                        showWorkersByTask('Pruning');
                    } else if (badgeText.includes('Mowing')) {
                        showWorkersByTask('Mowing');
                    } else if (badgeText.includes('Weeding')) {
                        showWorkersByTask('Weeding');
                    } else if (badgeText.includes('Harvesting')) {
                        showWorkersByTask('Harvesting');
                    }
                }
            }
        } else {
            showErrorMessage('Could not find allocation ID');
        }
        
    } catch (error) {
        console.error('Error removing allocation:', error);
        showErrorMessage('Error removing allocation: ' + error.message);
    }
}

/**
 * Set worker allocation
 */
function setWorkerAllocation(workerId, workerName) {
    // Close worker details modal
    const detailsModal = bootstrap.Modal.getInstance(document.getElementById('workerDetailsModal'));
    if (detailsModal) {
        detailsModal.hide();
    }
    
    // Open edit allocation modal with worker pre-selected
    editWorkerAllocation(workerId);
}

// Make functions globally accessible
if (typeof window !== 'undefined') {
    window.showWorkersInGrid = showWorkersInGrid;
    window.updateWorkerAllocationsGrid = updateWorkerAllocationsGrid;
    window.resetWorkerAllocationsGrid = resetWorkerAllocationsGrid;
    window.toggleSelectAllWorkers = toggleSelectAllWorkers;
    window.bulkAllocateWorkers = bulkAllocateWorkers;
    window.editWorkerAllocationFromDetails = editWorkerAllocationFromDetails;
    window.removeWorkerAllocation = removeWorkerAllocation;
    window.setWorkerAllocation = setWorkerAllocation;
}

// Auto-initialize when loaded via router
if (typeof window !== 'undefined') {
    // Module loaded and ready
}

