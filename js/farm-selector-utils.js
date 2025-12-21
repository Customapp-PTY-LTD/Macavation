/**
 * Farm and Crop Selection Utilities
 * Reusable functions for populating farm, block, and variety selectors
 */

/**
 * Wait for an element to appear in the DOM
 * @param {string} elementId - ID of the element to wait for
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Delay between retries in milliseconds
 * @returns {Promise<HTMLElement|null>} The element or null if not found
 */
async function waitForElement(elementId, maxRetries = 10, delay = 100) {
    for (let i = 0; i < maxRetries; i++) {
        const element = document.getElementById(elementId);
        if (element) {
            return element;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    return null;
}

/**
 * Populate farm selector dropdown
 * @param {string} selectorId - ID of the select element
 * @param {string|null} selectedFarmId - ID of farm to select (or 'all' for all farms)
 * @param {boolean} includeAllFarms - Whether to include "All Farms" option
 */
async function populateFarmSelector(selectorId, selectedFarmId = null, includeAllFarms = true) {
    const selector = await waitForElement(selectorId);
    if (!selector) {
        console.warn(`Farm selector with ID "${selectorId}" not found after retries`);
        return;
    }
    
    try {
        // Ensure dataFunctions is available
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getFarms) {
            console.error('dataFunctions.getFarms is not available');
            selector.innerHTML = '<option value="">Error loading farms</option>';
            return;
        }
        
        const farms = await dataFunctions.getFarms();
        
        // Clear existing options
        selector.innerHTML = '';
        
        // Add "All Farms" option if requested
        if (includeAllFarms) {
            const allOption = document.createElement('option');
            allOption.value = 'all';
            allOption.textContent = 'All Farms';
            selector.appendChild(allOption);
        }
        
        // Populate with farms
        if (farms && farms.length > 0) {
            farms.forEach(farm => {
                const option = document.createElement('option');
                option.value = farm.id;
                option.textContent = farm.name;
                selector.appendChild(option);
            });
            
            // Set selected value
            if (selectedFarmId) {
                selector.value = selectedFarmId;
            } else if (includeAllFarms) {
                selector.value = 'all';
            } else if (farms.length > 0) {
                selector.value = farms[0].id;
            }
        } else {
            const noFarmsOption = document.createElement('option');
            noFarmsOption.value = '';
            noFarmsOption.textContent = 'No farms available';
            selector.appendChild(noFarmsOption);
        }
    } catch (error) {
        console.error('Error populating farm selector:', error);
        selector.innerHTML = '<option value="">Error loading farms</option>';
    }
}

/**
 * Populate block selector dropdown based on selected farm
 * @param {string} selectorId - ID of the select element
 * @param {string|null} farmId - ID of farm to filter blocks (null or 'all' for all blocks)
 * @param {string|null} selectedBlockId - ID of block to select
 * @param {boolean} includeAllBlocks - Whether to include "All Blocks" option
 */
async function populateBlockSelector(selectorId, farmId = null, selectedBlockId = null, includeAllBlocks = true) {
    const selector = await waitForElement(selectorId);
    if (!selector) {
        console.warn(`Block selector with ID "${selectorId}" not found after retries`);
        return;
    }
    
    try {
        // Wait for dataFunctions if not available
        if (typeof dataFunctions === 'undefined') {
            if (typeof waitForDataFunctions === 'function') {
                try {
                    await waitForDataFunctions(20, 100);
                } catch (error) {
                    console.warn('Could not wait for dataFunctions:', error);
                }
            } else {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getBlocks) {
            console.error('dataFunctions.getBlocks is not available');
            selector.innerHTML = '<option value="">Data functions not available</option>';
            return;
        }
        
        const blocks = await dataFunctions.getBlocks();
        
        // Clear existing options
        selector.innerHTML = '';
        
        // Add "All Blocks" option if requested
        if (includeAllBlocks) {
            const allOption = document.createElement('option');
            allOption.value = '';
            allOption.textContent = 'All Blocks';
            selector.appendChild(allOption);
        }
        
        // Filter blocks by farm if farmId is provided and not 'all'
        let filteredBlocks = blocks || [];
        if (farmId && farmId !== 'all' && farmId !== '') {
            filteredBlocks = blocks.filter(block => block.farm_id === farmId);
        }
        
        // Populate with blocks
        if (filteredBlocks && filteredBlocks.length > 0) {
            filteredBlocks.forEach(block => {
                const option = document.createElement('option');
                option.value = block.id;
                option.textContent = block.name || `Block ${block.id.substring(0, 8)}`;
                selector.appendChild(option);
            });
            
            // Set selected value
            if (selectedBlockId) {
                selector.value = selectedBlockId;
            } else if (includeAllBlocks) {
                selector.value = '';
            }
        } else {
            const noBlocksOption = document.createElement('option');
            noBlocksOption.value = '';
            noBlocksOption.textContent = farmId && farmId !== 'all' ? 'No blocks for this farm' : 'No blocks available';
            selector.appendChild(noBlocksOption);
        }
    } catch (error) {
        console.error('Error populating block selector:', error);
        selector.innerHTML = '<option value="">Error loading blocks</option>';
    }
}

/**
 * Populate variety selector dropdown
 * @param {string} selectorId - ID of the select element
 * @param {string|null} selectedVarietyId - ID of variety to select
 * @param {boolean} includeAllVarieties - Whether to include "All Varieties" option
 */
async function populateVarietySelector(selectorId, selectedVarietyId = null, includeAllVarieties = true) {
    const selector = await waitForElement(selectorId);
    if (!selector) {
        console.warn(`Variety selector with ID "${selectorId}" not found after retries`);
        return;
    }
    
            try {
                // Wait for dataFunctions if not available
                if (typeof dataFunctions === 'undefined') {
                    if (typeof waitForDataFunctions === 'function') {
                        await waitForDataFunctions(20, 100);
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
                
        // Wait for dataFunctions if not available
        if (typeof dataFunctions === 'undefined') {
            if (typeof waitForDataFunctions === 'function') {
                await waitForDataFunctions(20, 100);
            } else {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getVarieties) {
            console.error('dataFunctions.getVarieties is not available');
            selector.innerHTML = '<option value="">Data functions not available</option>';
            return;
        }
        
        const varieties = await dataFunctions.getVarieties();
        
        // Clear existing options
        selector.innerHTML = '';
        
        // Add "All Varieties" option if requested
        if (includeAllVarieties) {
            const allOption = document.createElement('option');
            allOption.value = '';
            allOption.textContent = 'All Varieties';
            selector.appendChild(allOption);
        }
        
        // Populate with varieties
        if (varieties && varieties.length > 0) {
            varieties.forEach(variety => {
                const option = document.createElement('option');
                option.value = variety.id;
                option.textContent = variety.name || variety.variety_name || `Variety ${variety.id.substring(0, 8)}`;
                selector.appendChild(option);
            });
            
            // Set selected value
            if (selectedVarietyId) {
                selector.value = selectedVarietyId;
            } else if (includeAllVarieties) {
                selector.value = '';
            }
        } else {
            const noVarietiesOption = document.createElement('option');
            noVarietiesOption.value = '';
            noVarietiesOption.textContent = 'No varieties available';
            selector.appendChild(noVarietiesOption);
        }
    } catch (error) {
        console.error('Error populating variety selector:', error);
        selector.innerHTML = '<option value="">Error loading varieties</option>';
    }
}

/**
 * Setup farm selector with change handler that updates block selector
 * @param {string} farmSelectorId - ID of farm select element
 * @param {string} blockSelectorId - ID of block select element (optional)
 * @param {Function} onChangeCallback - Optional callback when farm changes
 */
function setupFarmSelectorWithBlocks(farmSelectorId, blockSelectorId = null, onChangeCallback = null) {
    const farmSelector = document.getElementById(farmSelectorId);
    if (!farmSelector) return;
    
    farmSelector.addEventListener('change', async function() {
        const selectedFarmId = this.value;
        
        // Update block selector if provided
        if (blockSelectorId) {
            await populateBlockSelector(blockSelectorId, selectedFarmId === 'all' ? null : selectedFarmId);
        }
        
        // Call custom callback if provided
        if (onChangeCallback && typeof onChangeCallback === 'function') {
            onChangeCallback(selectedFarmId);
        }
    });
}
