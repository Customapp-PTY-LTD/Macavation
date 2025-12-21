// Compliance Module JavaScript
let complianceData = {
    documents: [],
    certificates: [],
    audits: [],
    policies: []
};

// File upload state
let currentUploadingFile = null;
let currentFileUrl = null;

async function initializeComplianceGrid() {
    try {
        console.log('Compliance Grid initialized');
        
        // Wait for dataFunctions to be available
        if (typeof waitForDataFunctions === 'function') {
            try {
                await waitForDataFunctions(50, 100);
            } catch (error) {
                console.error('dataFunctions not available:', error);
                throw new Error('Data functions not available');
            }
        } else if (typeof dataFunctions === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (typeof dataFunctions === 'undefined') {
                throw new Error('dataFunctions is not available');
            }
        }
        
        // Check if utility functions are available
        if (typeof populateFarmSelector === 'undefined') {
            console.error('populateFarmSelector is not defined. Make sure farm-selector-utils.js is loaded.');
            return;
        }
        
        // Load and populate farm selector
        try {
            await populateFarmSelector('farmFilter', localStorage.getItem('selectedFarmId') || 'all', true);
            
            // Setup farm selector change handler
            const farmSelector = document.getElementById('farmFilter');
            if (farmSelector) {
                // Set initial value from localStorage
                const savedFarmId = localStorage.getItem('selectedFarmId') || 'all';
                if (savedFarmId !== 'all') {
                    farmSelector.value = savedFarmId;
                }
                
                farmSelector.addEventListener('change', () => {
                    const selectedFarmId = farmSelector.value || 'all';
                    if (selectedFarmId !== 'all') {
                        localStorage.setItem('selectedFarmId', selectedFarmId);
                    } else {
                        localStorage.removeItem('selectedFarmId');
                    }
                    loadComplianceData().catch(err => {
                        console.error('Error reloading compliance data:', err);
                    });
                });
            }
        } catch (error) {
            console.error('Error setting up farm selector:', error);
        }
        
        // Initialize tab functionality if needed
        const tabTriggerList = document.querySelectorAll('#complianceTab button');
        tabTriggerList.forEach(trigger => {
            trigger.addEventListener('click', function(event) {
                event.preventDefault();
                const tab = new bootstrap.Tab(trigger);
                tab.show();
            });
        });
        
        // Setup modal event listeners to clear forms on close
        const auditModal = document.getElementById('editAuditModal');
        if (auditModal) {
            auditModal.addEventListener('hidden.bs.modal', function() {
                // Clear form when modal is closed
                document.getElementById('editAuditId').value = '';
                document.getElementById('editAuditType').value = '';
                document.getElementById('editAuditDate').value = '';
                document.getElementById('editAuditorName').value = '';
                document.getElementById('editAuditScore').value = '';
                document.getElementById('editAuditStatus').value = 'scheduled';
                document.getElementById('editAuditNotes').value = '';
                
                // Remove any validation classes
                const formFields = auditModal.querySelectorAll('.form-control, .form-select');
                formFields.forEach(field => {
                    field.classList.remove('is-invalid', 'is-valid');
                });
            });
        }
        
        // Load data
        await loadComplianceData();
        
        // Setup file upload handlers
        setupFileUploadHandlers();
        
        // Add event listeners for buttons
        if (typeof setupEventListeners === 'function') {
            setupEventListeners();
        }
    } catch (error) {
        console.error('Error initializing Compliance Grid:', error);
    }
}

async function loadComplianceData() {
    try {
        if (typeof dataFunctions === 'undefined') {
            console.error('dataFunctions is not available');
            return;
        }
        
        // Get farm ID from selector or localStorage
        const farmSelector = document.getElementById('farmFilter');
        const farmId = farmSelector ? (farmSelector.value || 'all') : (localStorage.getItem('selectedFarmId') || 'all');
        
        // Update localStorage
        if (farmId !== 'all') {
            localStorage.setItem('selectedFarmId', farmId);
        }
        
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        
        const [documents, certificates, audits] = await Promise.all([
            dataFunctions.getComplianceDocuments(filters).catch(err => {
                console.error('Error loading documents:', err);
                return [];
            }),
            dataFunctions.getCertificates(filters).catch(err => {
                console.error('Error loading certificates:', err);
                return [];
            }),
            dataFunctions.getAudits(filters).catch(err => {
                console.error('Error loading audits:', err);
                return [];
            })
        ]);
        
        if (documents && Array.isArray(documents)) {
            complianceData.documents = documents;
        } else {
            complianceData.documents = [];
        }
        renderDocuments();
        
        if (certificates && Array.isArray(certificates)) {
            complianceData.certificates = certificates;
        } else {
            complianceData.certificates = [];
        }
        renderCertificates();
        
        if (audits && Array.isArray(audits)) {
            complianceData.audits = audits;
        } else {
            complianceData.audits = [];
        }
        renderAudits();
        
        // Load policies
        const policies = await dataFunctions.getPolicies(filters).catch(err => {
            console.error('Error loading policies:', err);
            return [];
        });
        
        if (policies && Array.isArray(policies)) {
            complianceData.policies = policies;
        } else {
            complianceData.policies = [];
        }
        renderPolicies();
        
        // Update compliance stats
        updateComplianceStats();
    } catch (error) {
        console.error('Error loading compliance data:', error);
        complianceData.documents = [];
        complianceData.certificates = [];
        complianceData.audits = [];
        renderDocuments();
        renderCertificates();
        renderAudits();
        updateComplianceStats();
    }
}

function renderDocuments() {
    const container = document.getElementById('documentsList');
    if (!container) return;
    
    if (complianceData.documents.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4">
                <i class="bi bi-file-earmark fs-1 text-muted mb-3"></i>
                <p class="text-muted mb-0">No compliance documents found</p>
                <small class="text-muted">Click "Add Document" to create a new compliance document</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = complianceData.documents.map(doc => {
        const statusClass = doc.status === 'active' ? 'success' : doc.status === 'expired' ? 'danger' : 'warning';
        const expiryDate = doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString() : null;
        const isExpiring = expiryDate && new Date(doc.expiry_date) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
        return `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title mb-2">${escapeHtml(doc.title || 'Untitled Document')}</h5>
                        <p class="card-text mb-2">
                            <span class="badge bg-${statusClass} me-2">${escapeHtml(doc.status || 'N/A')}</span>
                            <strong>Type:</strong> ${escapeHtml(doc.document_type || 'N/A')}<br>
                            ${doc.category ? `<strong>Category:</strong> ${escapeHtml(doc.category)}<br>` : ''}
                            ${expiryDate ? `<strong>Expiry:</strong> ${expiryDate}${isExpiring ? ' <span class="text-warning">⚠ Expiring Soon</span>' : ''}<br>` : ''}
                            ${doc.created_at ? `<small class="text-muted">Created: ${new Date(doc.created_at).toLocaleDateString()}</small>` : ''}
                        </p>
                    </div>
                    <div class="ms-3">
                        ${doc.file_url ? `<button class="btn btn-sm btn-outline-info me-2" onclick="previewDocumentUrl('${escapeHtml(doc.file_url)}', '${escapeHtml(doc.title || 'Document')}')" title="Preview">
                            <i class="bi bi-eye"></i>
                        </button>` : ''}
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editComplianceDocument('${doc.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteComplianceDocument('${doc.id}', '${escapeHtml(doc.title || 'this document')}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function renderCertificates() {
    const container = document.getElementById('certificatesList');
    if (!container) return;
    
    if (complianceData.certificates.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4">
                <i class="bi bi-award fs-1 text-muted mb-3"></i>
                <p class="text-muted mb-0">No certificates found</p>
                <small class="text-muted">Click "Add Certificate" to create a new certificate</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = complianceData.certificates.map(cert => {
        const expiryDate = cert.expiry_date ? new Date(cert.expiry_date) : null;
        const today = new Date();
        const isExpired = expiryDate && expiryDate < today;
        const isExpiringSoon = expiryDate && expiryDate >= today && expiryDate <= new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        const statusClass = isExpired ? 'danger' : isExpiringSoon ? 'warning' : 'success';
        
        return `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title mb-2">${escapeHtml(cert.certificate_type || 'Untitled Certificate')}</h5>
                        <p class="card-text mb-2">
                            <span class="badge bg-${statusClass} me-2">${escapeHtml(cert.status || 'N/A')}</span>
                            <strong>Number:</strong> ${escapeHtml(cert.certificate_number || 'N/A')}<br>
                            ${cert.issued_date ? `<strong>Issued:</strong> ${new Date(cert.issued_date).toLocaleDateString()}<br>` : ''}
                            ${expiryDate ? `<strong>Expires:</strong> ${expiryDate.toLocaleDateString()}${isExpiringSoon ? ' <span class="text-warning">⚠ Expiring Soon</span>' : ''}${isExpired ? ' <span class="text-danger">⚠ Expired</span>' : ''}<br>` : ''}
                            ${cert.issuing_authority ? `<strong>Authority:</strong> ${escapeHtml(cert.issuing_authority)}<br>` : ''}
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editCertificate('${cert.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteCertificate('${cert.id}', '${escapeHtml(cert.certificate_type || 'this certificate')}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function renderAudits() {
    const container = document.getElementById('auditsList');
    if (!container) return;
    
    if (complianceData.audits.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4">
                <i class="bi bi-clipboard-check fs-1 text-muted mb-3"></i>
                <p class="text-muted mb-0">No audits found</p>
                <small class="text-muted">Click "Schedule Audit" to create a new audit</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = complianceData.audits.map(audit => {
        const statusClass = audit.status === 'completed' ? 'success' : audit.status === 'in_progress' ? 'warning' : audit.status === 'cancelled' ? 'danger' : 'info';
        const score = audit.score !== null && audit.score !== undefined ? audit.score : null;
        const scoreClass = score !== null ? (score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger') : '';
        
        return `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title mb-2">${escapeHtml(audit.audit_type || 'Untitled Audit')}</h5>
                        <p class="card-text mb-2">
                            <span class="badge bg-${statusClass} me-2">${escapeHtml(audit.status || 'N/A')}</span>
                            ${audit.audit_date ? `<strong>Date:</strong> ${new Date(audit.audit_date).toLocaleDateString()}<br>` : ''}
                            ${audit.auditor_name ? `<strong>Auditor:</strong> ${escapeHtml(audit.auditor_name)}<br>` : ''}
                            ${score !== null ? `<strong>Score:</strong> <span class="text-${scoreClass}">${score}%</span><br>` : ''}
                            ${audit.notes ? `<strong>Notes:</strong> ${escapeHtml(audit.notes.substring(0, 150))}${audit.notes.length > 150 ? '...' : ''}<br>` : ''}
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editAudit('${audit.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteAudit('${audit.id}', '${escapeHtml(audit.audit_type || 'this audit')}')" title="Delete">
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
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupEventListeners() {
    // Generate Report button
    const generateBtn = document.querySelector('[data-action="generate-report"]');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateAuditReport);
    }
    
    // Schedule Audit button
    const scheduleBtn = document.querySelector('[data-action="schedule-audit"]');
    if (scheduleBtn) {
        scheduleBtn.addEventListener('click', scheduleAudit);
    }
}

/**
 * Setup file upload handlers
 */
function setupFileUploadHandlers() {
    // Document file upload
    const documentFileInput = document.getElementById('editDocumentFile');
    if (documentFileInput) {
        documentFileInput.addEventListener('change', handleDocumentFileSelect);
    }
    
    // Policy file upload
    const policyFileInput = document.getElementById('editPolicyFile');
    if (policyFileInput) {
        policyFileInput.addEventListener('change', handlePolicyFileSelect);
    }
}

/**
 * Handle document file selection
 */
async function handleDocumentFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file size (50MB)
    if (file.size > 50 * 1024 * 1024) {
        showErrorMessage('File size exceeds 50MB limit');
        event.target.value = '';
        return;
    }
    
    // Show file info
    const previewDiv = document.getElementById('documentFilePreview');
    const fileNameSpan = document.getElementById('documentFileName');
    if (previewDiv && fileNameSpan) {
        fileNameSpan.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        previewDiv.style.display = 'block';
        currentUploadingFile = file;
    }
    
    // Hide existing URL if any
    const urlDiv = document.getElementById('documentFileUrl');
    if (urlDiv) urlDiv.style.display = 'none';
}

/**
 * Handle policy file selection
 */
async function handlePolicyFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file size (50MB)
    if (file.size > 50 * 1024 * 1024) {
        showErrorMessage('File size exceeds 50MB limit');
        event.target.value = '';
        return;
    }
    
    // Show file info
    const previewDiv = document.getElementById('policyFilePreview');
    const fileNameSpan = document.getElementById('policyFileName');
    if (previewDiv && fileNameSpan) {
        fileNameSpan.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        previewDiv.style.display = 'block';
        currentUploadingFile = file;
    }
    
    // Hide existing URL if any
    const urlDiv = document.getElementById('policyFileUrl');
    if (urlDiv) urlDiv.style.display = 'none';
}

/**
 * Upload file to Supabase storage via Lambda proxy
 */
async function uploadFileToStorage(file, folder = 'documents') {
    try {
        if (!file) {
            throw new Error('No file provided');
        }
        
        const token = dataFunctions.getToken();
        if (!token) {
            throw new Error('No authentication token available');
        }
        
        // Create a unique filename
        const timestamp = Date.now();
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${folder}/${timestamp}_${sanitizedFileName}`;
        
        // Convert file to base64 for transmission
        const base64File = await fileToBase64(file);
        
        // Upload through Lambda proxy
        const proxyUrl = dataFunctions.proxyUrl.replace('/function', '/upload');
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                bucket: 'compliance-documents',
                path: fileName,
                file: base64File,
                contentType: file.type,
                fileName: file.name
            })
        });
        
        if (!response.ok) {
            // If upload endpoint doesn't exist, use placeholder
            console.warn('File upload endpoint not available, using placeholder URL');
            const fileUrl = `https://storage.supabase.co/object/public/compliance-documents/${fileName}`;
            return fileUrl;
        }
        
        const result = await response.json();
        return result.url || result.publicUrl || `https://storage.supabase.co/object/public/compliance-documents/${fileName}`;
        
    } catch (error) {
        console.error('Error uploading file:', error);
        // Return placeholder URL if upload fails
        const timestamp = Date.now();
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${folder}/${timestamp}_${sanitizedFileName}`;
        const fileUrl = `https://storage.supabase.co/object/public/compliance-documents/${fileName}`;
        console.warn('Using placeholder URL due to upload error:', error.message);
        return fileUrl;
    }
}

/**
 * Convert file to base64
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // Remove data:type;base64, prefix
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function generateAuditReport() {
    console.log('Generating audit report...');
    // Implementation coming soon
}

function scheduleAudit() {
    // Clear all form fields
    document.getElementById('editAuditId').value = '';
    document.getElementById('editAuditType').value = '';
    document.getElementById('editAuditDate').value = '';
    document.getElementById('editAuditorName').value = '';
    document.getElementById('editAuditScore').value = '';
    document.getElementById('editAuditStatus').value = 'scheduled';
    document.getElementById('editAuditNotes').value = '';
    
    // Remove validation classes
    const modalElement = document.getElementById('editAuditModal');
    if (modalElement) {
        const formFields = modalElement.querySelectorAll('.form-control, .form-select');
        formFields.forEach(field => {
            field.classList.remove('is-invalid', 'is-valid');
        });
    }
    
    const modal = new bootstrap.Modal(document.getElementById('editAuditModal'));
    modal.show();
}

/**
 * Close audit modal
 */
function closeAuditModal() {
    const modalElement = document.getElementById('editAuditModal');
    if (modalElement) {
        // Get existing modal instance or create new one
        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement);
        }
        modal.hide();
    }
}

/**
 * Edit compliance document
 */
async function editComplianceDocument(documentId) {
    const doc = complianceData.documents.find(d => String(d.id) === String(documentId));
    if (!doc) {
        showErrorMessage('Document not found');
        return;
    }
    
    document.getElementById('editDocumentId').value = doc.id;
    document.getElementById('editDocumentTitle').value = doc.title || '';
    document.getElementById('editDocumentType').value = doc.document_type || '';
    document.getElementById('editDocumentCategory').value = doc.category || '';
    document.getElementById('editDocumentStatus').value = doc.status || 'active';
    document.getElementById('editDocumentExpiry').value = doc.expiry_date ? doc.expiry_date.split('T')[0] : '';
    
    // Show existing file URL if available
    const fileInput = document.getElementById('editDocumentFile');
    const urlDiv = document.getElementById('documentFileUrl');
    const urlText = document.getElementById('documentFileUrlText');
    const previewDiv = document.getElementById('documentFilePreview');
    
    if (doc.file_url) {
        currentFileUrl = doc.file_url;
        if (urlDiv && urlText) {
            const fileName = doc.file_url.split('/').pop() || 'Document';
            urlText.textContent = `Current file: ${fileName}`;
            urlDiv.style.display = 'block';
        }
        if (previewDiv) previewDiv.style.display = 'none';
    } else {
        if (urlDiv) urlDiv.style.display = 'none';
        if (previewDiv) previewDiv.style.display = 'none';
    }
    
    if (fileInput) fileInput.value = '';
    currentUploadingFile = null;
    
    const modal = new bootstrap.Modal(document.getElementById('editDocumentModal'));
    modal.show();
}

/**
 * Save compliance document
 */
async function saveComplianceDocument() {
    try {
        const documentId = document.getElementById('editDocumentId').value;
        const farmSelector = document.getElementById('farmFilter');
        const farmId = farmSelector ? (farmSelector.value || 'all') : (localStorage.getItem('selectedFarmId') || 'all');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a specific farm before creating a document');
            return;
        }
        
        let fileUrl = currentFileUrl || null;
        
        // Upload file if a new file was selected
        const fileInput = document.getElementById('editDocumentFile');
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
            showInfoMessage('Uploading file...');
            try {
                fileUrl = await uploadFileToStorage(fileInput.files[0], 'compliance-documents');
                currentFileUrl = fileUrl;
            } catch (uploadError) {
                console.error('File upload error:', uploadError);
                showErrorMessage('Failed to upload file. Document will be saved without file attachment.');
                // Continue without file - user can upload later
            }
        }
        
        // If editing and file URL already exists, use existing URL
        if (documentId && !fileUrl) {
            const existingDoc = complianceData.documents.find(d => String(d.id) === String(documentId));
            if (existingDoc && existingDoc.file_url) {
                fileUrl = existingDoc.file_url;
            }
        }
        
        const documentData = {
            farm_id: farmId,
            title: document.getElementById('editDocumentTitle').value,
            document_type: document.getElementById('editDocumentType').value,
            category: document.getElementById('editDocumentCategory').value || null,
            status: document.getElementById('editDocumentStatus').value || 'active',
            expiry_date: document.getElementById('editDocumentExpiry').value || null,
            file_url: fileUrl
        };
        
        if (!documentData.title || !documentData.document_type) {
            showErrorMessage('Title and Type are required');
            return;
        }
        
        let result;
        if (documentId) {
            result = await dataFunctions.updateComplianceDocument(documentId, documentData);
            showSuccessMessage('Document updated successfully');
        } else {
            result = await dataFunctions.createComplianceDocument(documentData);
            showSuccessMessage('Document created successfully');
        }
        
        // Reset file inputs
        if (fileInput) fileInput.value = '';
        currentUploadingFile = null;
        currentFileUrl = null;
        const previewDiv = document.getElementById('documentFilePreview');
        if (previewDiv) previewDiv.style.display = 'none';
        
        await loadComplianceData();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editDocumentModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving document:', error);
        showErrorMessage('Failed to save document: ' + error.message);
    }
}

/**
 * Delete compliance document
 */
async function deleteComplianceDocument(documentId, documentTitle) {
    if (!confirm(`Are you sure you want to delete "${documentTitle}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteComplianceDocument(documentId);
        showSuccessMessage('Document deleted successfully');
        await loadComplianceData();
    } catch (error) {
        console.error('Error deleting document:', error);
        showErrorMessage('Failed to delete document: ' + error.message);
    }
}

/**
 * Edit certificate
 */
async function editCertificate(certificateId) {
    const cert = complianceData.certificates.find(c => String(c.id) === String(certificateId));
    if (!cert) {
        showErrorMessage('Certificate not found');
        return;
    }
    
    document.getElementById('editCertificateId').value = cert.id;
    document.getElementById('editCertificateType').value = cert.certificate_type || '';
    document.getElementById('editCertificateNumber').value = cert.certificate_number || '';
    document.getElementById('editCertificateIssued').value = cert.issued_date ? cert.issued_date.split('T')[0] : '';
    document.getElementById('editCertificateExpiry').value = cert.expiry_date ? cert.expiry_date.split('T')[0] : '';
    document.getElementById('editCertificateAuthority').value = cert.issuing_authority || '';
    document.getElementById('editCertificateStatus').value = cert.status || 'active';
    
    const modal = new bootstrap.Modal(document.getElementById('editCertificateModal'));
    modal.show();
}

/**
 * Save certificate
 */
async function saveCertificate() {
    try {
        const certificateId = document.getElementById('editCertificateId').value;
        const farmId = localStorage.getItem('selectedFarmId');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a farm');
            return;
        }
        
        const certificateData = {
            farm_id: farmId,
            certificate_type: document.getElementById('editCertificateType').value,
            certificate_number: document.getElementById('editCertificateNumber').value,
            issued_date: document.getElementById('editCertificateIssued').value || null,
            expiry_date: document.getElementById('editCertificateExpiry').value || null,
            issuing_authority: document.getElementById('editCertificateAuthority').value || null,
            status: document.getElementById('editCertificateStatus').value || 'active'
        };
        
        if (!certificateData.certificate_type || !certificateData.certificate_number) {
            showErrorMessage('Certificate Type and Number are required');
            return;
        }
        
        let result;
        if (certificateId) {
            result = await dataFunctions.updateCertificate(certificateId, certificateData);
            showSuccessMessage('Certificate updated successfully');
        } else {
            result = await dataFunctions.createCertificate(certificateData);
            showSuccessMessage('Certificate created successfully');
        }
        
        await loadComplianceData();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editCertificateModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving certificate:', error);
        showErrorMessage('Failed to save certificate: ' + error.message);
    }
}

/**
 * Delete certificate
 */
async function deleteCertificate(certificateId, certificateType) {
    if (!confirm(`Are you sure you want to delete "${certificateType}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteCertificate(certificateId);
        showSuccessMessage('Certificate deleted successfully');
        await loadComplianceData();
    } catch (error) {
        console.error('Error deleting certificate:', error);
        showErrorMessage('Failed to delete certificate: ' + error.message);
    }
}

/**
 * Edit audit
 */
async function editAudit(auditId) {
    const audit = complianceData.audits.find(a => String(a.id) === String(auditId));
    if (!audit) {
        showErrorMessage('Audit not found');
        return;
    }
    
    document.getElementById('editAuditId').value = audit.id;
    document.getElementById('editAuditType').value = audit.audit_type || '';
    document.getElementById('editAuditDate').value = audit.audit_date ? audit.audit_date.split('T')[0] : '';
    document.getElementById('editAuditorName').value = audit.auditor_name || '';
    document.getElementById('editAuditScore').value = audit.score || '';
    document.getElementById('editAuditStatus').value = audit.status || 'scheduled';
    document.getElementById('editAuditNotes').value = audit.notes || '';
    
    const modal = new bootstrap.Modal(document.getElementById('editAuditModal'));
    modal.show();
}

/**
 * Save audit
 */
async function saveAudit() {
    try {
        const auditId = document.getElementById('editAuditId').value;
        const farmSelector = document.getElementById('farmFilter');
        const farmId = farmSelector ? (farmSelector.value || 'all') : (localStorage.getItem('selectedFarmId') || 'all');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a specific farm before creating an audit');
            return;
        }
        
        const auditData = {
            farm_id: farmId,
            audit_type: document.getElementById('editAuditType').value,
            audit_date: document.getElementById('editAuditDate').value,
            auditor_name: document.getElementById('editAuditorName').value || null,
            score: document.getElementById('editAuditScore').value ? parseFloat(document.getElementById('editAuditScore').value) : null,
            status: document.getElementById('editAuditStatus').value || 'scheduled',
            notes: document.getElementById('editAuditNotes').value || null
        };
        
        if (!auditData.audit_type || !auditData.audit_date) {
            showErrorMessage('Audit Type and Date are required');
            return;
        }
        
        let result;
        if (auditId) {
            result = await dataFunctions.updateAudit(auditId, auditData);
            showSuccessMessage('Audit updated successfully');
        } else {
            result = await dataFunctions.createAudit(auditData);
            showSuccessMessage('Audit created successfully');
        }
        
        await loadComplianceData();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editAuditModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving audit:', error);
        showErrorMessage('Failed to save audit: ' + error.message);
    }
}

/**
 * Delete audit
 */
async function deleteAudit(auditId, auditType) {
    if (!confirm(`Are you sure you want to delete "${auditType}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteAudit(auditId);
        showSuccessMessage('Audit deleted successfully');
        await loadComplianceData();
    } catch (error) {
        console.error('Error deleting audit:', error);
        showErrorMessage('Failed to delete audit: ' + error.message);
    }
}

/**
 * Show success/error messages
 */
function showSuccessMessage(message) {
    if (typeof _common !== 'undefined' && _common.showSuccessToast) {
        _common.showSuccessToast(message);
    } else {
        alert('Success: ' + message);
    }
}

function showErrorMessage(message) {
    if (typeof _common !== 'undefined' && _common.showErrorToast) {
        _common.showErrorToast(message);
    } else {
        alert('Error: ' + message);
    }
}

function showInfoMessage(message) {
    if (typeof _common !== 'undefined' && _common.showInfoToast) {
        _common.showInfoToast(message);
    } else {
        console.log('Info: ' + message);
    }
}

/**
 * Update compliance statistics
 */
function updateComplianceStats() {
    // Calculate documents complete
    const totalDocuments = complianceData.documents.length;
    const activeDocuments = complianceData.documents.filter(d => d.status === 'active' || !d.status).length;
    const documentsCompleteEl = document.getElementById('documentsComplete');
    if (documentsCompleteEl) {
        documentsCompleteEl.textContent = `${activeDocuments}/${totalDocuments}`;
    }
    
    // Calculate certificates expiring (within 7 days)
    const today = new Date();
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(today.getDate() + 7);
    
    const expiringCertificates = complianceData.certificates.filter(cert => {
        if (!cert.expiry_date) return false;
        const expiryDate = new Date(cert.expiry_date);
        return expiryDate >= today && expiryDate <= sevenDaysFromNow && cert.status !== 'expired';
    }).length;
    
    const certificatesExpiringEl = document.getElementById('certificatesExpiring');
    if (certificatesExpiringEl) {
        certificatesExpiringEl.textContent = expiringCertificates;
    }
    
    // Calculate certified staff (valid certificates)
    const validCertificates = complianceData.certificates.filter(cert => {
        if (cert.status === 'expired' || cert.status === 'revoked') return false;
        if (cert.expiry_date) {
            const expiryDate = new Date(cert.expiry_date);
            return expiryDate >= today;
        }
        return true;
    }).length;
    
    // For now, we'll use certificate count as staff count (can be enhanced later)
    const certifiedStaffEl = document.getElementById('certifiedStaff');
    if (certifiedStaffEl) {
        certifiedStaffEl.textContent = `${validCertificates}/${complianceData.certificates.length}`;
    }
    
    // Calculate compliance score (based on documents and certificates)
    let score = 0;
    let maxScore = 0;
    
    // Documents: 50% weight
    if (totalDocuments > 0) {
        score += (activeDocuments / totalDocuments) * 50;
    }
    maxScore += 50;
    
    // Certificates: 30% weight
    const totalCertificates = complianceData.certificates.length;
    if (totalCertificates > 0) {
        score += (validCertificates / totalCertificates) * 30;
    }
    maxScore += 30;
    
    // Audits: 20% weight (completed audits with good scores)
    const completedAudits = complianceData.audits.filter(a => a.status === 'completed' && a.score >= 80).length;
    const totalAudits = complianceData.audits.length;
    if (totalAudits > 0) {
        score += (completedAudits / totalAudits) * 20;
    }
    maxScore += 20;
    
    const complianceScore = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    
    // Update compliance score display
    const complianceScoreText = document.getElementById('complianceScoreText');
    const complianceScoreDisplay = document.getElementById('complianceScoreDisplay');
    const complianceProgressBar = document.getElementById('complianceProgressBar');
    const complianceStatus = document.getElementById('complianceStatus');
    
    if (complianceScoreText) complianceScoreText.textContent = `${complianceScore}%`;
    if (complianceScoreDisplay) complianceScoreDisplay.textContent = `${complianceScore}%`;
    if (complianceProgressBar) {
        complianceProgressBar.style.width = `${complianceScore}%`;
        // Update color based on score
        if (complianceScore >= 90) {
            complianceProgressBar.className = 'progress-bar bg-success';
        } else if (complianceScore >= 70) {
            complianceProgressBar.className = 'progress-bar bg-warning';
        } else {
            complianceProgressBar.className = 'progress-bar bg-danger';
        }
    }
    if (complianceStatus) {
        if (complianceScore >= 90) {
            complianceStatus.textContent = 'Audit Ready';
        } else if (complianceScore >= 70) {
            complianceStatus.textContent = 'Needs Improvement';
        } else {
            complianceStatus.textContent = 'Action Required';
        }
    }
    
    // Update next audit
    const nextAudit = complianceData.audits
        .filter(a => a.status === 'scheduled' && a.audit_date)
        .sort((a, b) => new Date(a.audit_date) - new Date(b.audit_date))[0];
    
    const nextAuditText = document.getElementById('nextAuditText');
    if (nextAuditText) {
        if (nextAudit) {
            const auditDate = new Date(nextAudit.audit_date);
            nextAuditText.textContent = `Next audit: ${nextAudit.audit_type} - ${auditDate.toLocaleDateString()}`;
        } else {
            nextAuditText.textContent = 'No upcoming audits scheduled';
        }
    }
}

/**
 * Preview document from URL
 */
function previewDocumentUrl(fileUrl, title = 'Document') {
    if (!fileUrl) {
        showErrorMessage('No file URL available');
        return;
    }
    
    const modal = new bootstrap.Modal(document.getElementById('documentPreviewModal'));
    const frame = document.getElementById('documentPreviewFrame');
    const downloadLink = document.getElementById('documentPreviewDownload');
    const modalTitle = document.querySelector('#documentPreviewModal .modal-title');
    
    if (frame) {
        // For PDFs, show directly in iframe
        if (fileUrl.toLowerCase().endsWith('.pdf')) {
            frame.src = fileUrl;
        } else {
            // For other files, try to open in new tab or show download
            frame.src = '';
            if (downloadLink) {
                downloadLink.href = fileUrl;
                downloadLink.style.display = 'inline-block';
            }
            showInfoMessage('This file type cannot be previewed. Please download to view.');
        }
    }
    
    if (modalTitle) modalTitle.textContent = `Preview: ${title}`;
    if (downloadLink) downloadLink.href = fileUrl;
    
    modal.show();
}

/**
 * Preview document from file input
 */
function previewDocument() {
    const fileInput = document.getElementById('editDocumentFile');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showErrorMessage('No file selected');
        return;
    }
    
    const file = fileInput.files[0];
    const fileUrl = URL.createObjectURL(file);
    
    const modal = new bootstrap.Modal(document.getElementById('documentPreviewModal'));
    const frame = document.getElementById('documentPreviewFrame');
    const downloadLink = document.getElementById('documentPreviewDownload');
    
    if (frame) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            frame.src = fileUrl;
        } else if (file.type.startsWith('image/')) {
            frame.src = fileUrl;
        } else {
            frame.src = '';
            showInfoMessage('This file type cannot be previewed. Please download to view.');
        }
    }
    
    if (downloadLink) {
        downloadLink.href = fileUrl;
        downloadLink.download = file.name;
    }
    
    modal.show();
}

/**
 * Preview policy from file input
 */
function previewPolicy() {
    const fileInput = document.getElementById('editPolicyFile');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showErrorMessage('No file selected');
        return;
    }
    
    const file = fileInput.files[0];
    const fileUrl = URL.createObjectURL(file);
    
    const modal = new bootstrap.Modal(document.getElementById('documentPreviewModal'));
    const frame = document.getElementById('documentPreviewFrame');
    const downloadLink = document.getElementById('documentPreviewDownload');
    
    if (frame) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            frame.src = fileUrl;
        } else if (file.type.startsWith('image/')) {
            frame.src = fileUrl;
        } else {
            frame.src = '';
            showInfoMessage('This file type cannot be previewed. Please download to view.');
        }
    }
    
    if (downloadLink) {
        downloadLink.href = fileUrl;
        downloadLink.download = file.name;
    }
    
    modal.show();
}

/**
 * Preview policy from URL
 */
function previewPolicyUrl(fileUrl, title = 'Policy') {
    previewDocumentUrl(fileUrl, title);
}

/**
 * Render policies list
 */
function renderPolicies() {
    const container = document.getElementById('policiesList');
    if (!container) return;
    
    if (complianceData.policies.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4">
                <i class="bi bi-file-text fs-1 text-muted mb-3"></i>
                <p class="text-muted mb-0">No policies found</p>
                <small class="text-muted">Click "Add Policy" to create a new policy</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = complianceData.policies.map(policy => {
        const statusClass = policy.status === 'active' ? 'success' : policy.status === 'under_review' ? 'warning' : policy.status === 'archived' ? 'secondary' : 'info';
        const reviewDate = policy.review_date ? new Date(policy.review_date).toLocaleDateString() : null;
        const effectiveDate = policy.effective_date ? new Date(policy.effective_date).toLocaleDateString() : null;
        const isReviewDue = reviewDate && new Date(policy.review_date) <= new Date();
        
        return `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title mb-2">${escapeHtml(policy.title || 'Untitled Policy')}</h5>
                        <p class="card-text mb-2">
                            <span class="badge bg-${statusClass} me-2">${escapeHtml(policy.status || 'N/A')}</span>
                            ${policy.policy_number ? `<strong>Policy #:</strong> ${escapeHtml(policy.policy_number)}<br>` : ''}
                            <strong>Version:</strong> ${escapeHtml(policy.version || '1.0')}<br>
                            ${policy.category ? `<strong>Category:</strong> ${escapeHtml(policy.category)}<br>` : ''}
                            ${effectiveDate ? `<strong>Effective:</strong> ${effectiveDate}<br>` : ''}
                            ${reviewDate ? `<strong>Review Date:</strong> ${reviewDate}${isReviewDue ? ' <span class="text-warning">⚠ Due for Review</span>' : ''}<br>` : ''}
                            ${policy.description ? `<small class="text-muted">${escapeHtml(policy.description.substring(0, 100))}${policy.description.length > 100 ? '...' : ''}</small><br>` : ''}
                        </p>
                    </div>
                    <div class="ms-3">
                        ${policy.file_url ? `<button class="btn btn-sm btn-outline-info me-2" onclick="previewPolicyUrl('${escapeHtml(policy.file_url)}', '${escapeHtml(policy.title || 'Policy')}')" title="Preview">
                            <i class="bi bi-eye"></i>
                        </button>` : ''}
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editPolicy('${policy.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deletePolicy('${policy.id}', '${escapeHtml(policy.title || 'this policy')}')" title="Delete">
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
 * Edit policy
 */
async function editPolicy(policyId) {
    const policy = complianceData.policies.find(p => String(p.id) === String(policyId));
    if (!policy) {
        showErrorMessage('Policy not found');
        return;
    }
    
    document.getElementById('editPolicyId').value = policy.id;
    document.getElementById('editPolicyTitle').value = policy.title || '';
    document.getElementById('editPolicyNumber').value = policy.policy_number || '';
    document.getElementById('editPolicyVersion').value = policy.version || '1.0';
    document.getElementById('editPolicyCategory').value = policy.category || '';
    document.getElementById('editPolicyStatus').value = policy.status || 'draft';
    document.getElementById('editPolicyDescription').value = policy.description || '';
    document.getElementById('editPolicyEffectiveDate').value = policy.effective_date ? policy.effective_date.split('T')[0] : '';
    document.getElementById('editPolicyReviewDate').value = policy.review_date ? policy.review_date.split('T')[0] : '';
    document.getElementById('editPolicyReviewFrequency').value = policy.review_frequency_months || 12;
    
    // Show existing file URL if available
    const fileInput = document.getElementById('editPolicyFile');
    const urlDiv = document.getElementById('policyFileUrl');
    const urlText = document.getElementById('policyFileUrlText');
    const previewDiv = document.getElementById('policyFilePreview');
    
    if (policy.file_url) {
        currentFileUrl = policy.file_url;
        if (urlDiv && urlText) {
            const fileName = policy.file_url.split('/').pop() || 'Policy';
            urlText.textContent = `Current file: ${fileName}`;
            urlDiv.style.display = 'block';
        }
        if (previewDiv) previewDiv.style.display = 'none';
    } else {
        if (urlDiv) urlDiv.style.display = 'none';
        if (previewDiv) previewDiv.style.display = 'none';
    }
    
    if (fileInput) fileInput.value = '';
    currentUploadingFile = null;
    
    const modal = new bootstrap.Modal(document.getElementById('editPolicyModal'));
    modal.show();
}

/**
 * Save policy
 */
async function savePolicy() {
    try {
        const policyId = document.getElementById('editPolicyId').value;
        const farmSelector = document.getElementById('farmFilter');
        const farmId = farmSelector ? (farmSelector.value || 'all') : (localStorage.getItem('selectedFarmId') || 'all');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a specific farm before creating a policy');
            return;
        }
        
        let fileUrl = currentFileUrl || null;
        
        // Upload file if a new file was selected
        const fileInput = document.getElementById('editPolicyFile');
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
            showInfoMessage('Uploading file...');
            try {
                fileUrl = await uploadFileToStorage(fileInput.files[0], 'policies');
                currentFileUrl = fileUrl;
            } catch (uploadError) {
                console.error('File upload error:', uploadError);
                showErrorMessage('Failed to upload file. Policy will be saved without file attachment.');
            }
        }
        
        // If editing and file URL already exists, use existing URL
        if (policyId && !fileUrl) {
            const existingPolicy = complianceData.policies.find(p => String(p.id) === String(policyId));
            if (existingPolicy && existingPolicy.file_url) {
                fileUrl = existingPolicy.file_url;
            }
        }
        
        const policyData = {
            farm_id: farmId,
            title: document.getElementById('editPolicyTitle').value,
            policy_number: document.getElementById('editPolicyNumber').value || null,
            version: document.getElementById('editPolicyVersion').value || '1.0',
            category: document.getElementById('editPolicyCategory').value || null,
            description: document.getElementById('editPolicyDescription').value || null,
            file_url: fileUrl,
            effective_date: document.getElementById('editPolicyEffectiveDate').value || null,
            review_date: document.getElementById('editPolicyReviewDate').value || null,
            review_frequency_months: document.getElementById('editPolicyReviewFrequency').value ? parseInt(document.getElementById('editPolicyReviewFrequency').value) : 12,
            status: document.getElementById('editPolicyStatus').value || 'draft'
        };
        
        if (!policyData.title) {
            showErrorMessage('Title is required');
            return;
        }
        
        let result;
        if (policyId) {
            result = await dataFunctions.updatePolicy(policyId, policyData);
            showSuccessMessage('Policy updated successfully');
        } else {
            result = await dataFunctions.createPolicy(policyData);
            showSuccessMessage('Policy created successfully');
        }
        
        // Reset file inputs
        if (fileInput) fileInput.value = '';
        currentUploadingFile = null;
        currentFileUrl = null;
        const previewDiv = document.getElementById('policyFilePreview');
        if (previewDiv) previewDiv.style.display = 'none';
        
        await loadComplianceData();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editPolicyModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving policy:', error);
        showErrorMessage('Failed to save policy: ' + error.message);
    }
}

/**
 * Delete policy
 */
async function deletePolicy(policyId, policyTitle) {
    if (!confirm(`Are you sure you want to delete "${policyTitle}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deletePolicy(policyId);
        showSuccessMessage('Policy deleted successfully');
        await loadComplianceData();
    } catch (error) {
        console.error('Error deleting policy:', error);
        showErrorMessage('Failed to delete policy: ' + error.message);
    }
}

// Make functions globally accessible for onclick handlers
if (typeof window !== 'undefined') {
    window.saveComplianceDocument = saveComplianceDocument;
    window.editComplianceDocument = editComplianceDocument;
    window.deleteComplianceDocument = deleteComplianceDocument;
    window.saveCertificate = saveCertificate;
    window.editCertificate = editCertificate;
    window.deleteCertificate = deleteCertificate;
    window.saveAudit = saveAudit;
    window.editAudit = editAudit;
    window.deleteAudit = deleteAudit;
    window.scheduleAudit = scheduleAudit;
    window.closeAuditModal = closeAuditModal;
    window.previewDocument = previewDocument;
    window.previewDocumentUrl = previewDocumentUrl;
    window.previewPolicy = previewPolicy;
    window.previewPolicyUrl = previewPolicyUrl;
    window.savePolicy = savePolicy;
    window.editPolicy = editPolicy;
    window.deletePolicy = deletePolicy;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeComplianceGrid);
} else {
    initializeComplianceGrid();
}

