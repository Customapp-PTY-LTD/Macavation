# CRM System Module

## Overview
Manages customer and supplier relationships, tracks communication history, handles quotes and orders, and maintains key account information for Macavation's operations.

---

## Database Entities

### 1. contacts
Main contacts table for both customers and suppliers
```sql
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_type VARCHAR(20) NOT NULL CHECK (contact_type IN ('customer', 'supplier', 'both')),
    company_name VARCHAR(255) NOT NULL,
    trading_name VARCHAR(255),
    registration_number VARCHAR(100),
    vat_number VARCHAR(100),
    
    -- Primary Contact Person
    primary_contact_name VARCHAR(255),
    primary_contact_title VARCHAR(100),
    primary_contact_email VARCHAR(255),
    primary_contact_phone VARCHAR(20),
    primary_contact_mobile VARCHAR(20),
    
    -- Address Information
    physical_address_line1 VARCHAR(255),
    physical_address_line2 VARCHAR(255),
    physical_city VARCHAR(100),
    physical_province VARCHAR(100),
    physical_postal_code VARCHAR(20),
    physical_country VARCHAR(100) DEFAULT 'South Africa',
    
    postal_address_line1 VARCHAR(255),
    postal_address_line2 VARCHAR(255),
    postal_city VARCHAR(100),
    postal_province VARCHAR(100),
    postal_postal_code VARCHAR(20),
    postal_country VARCHAR(100) DEFAULT 'South Africa',
    
    -- Business Information
    industry VARCHAR(100),
    website VARCHAR(255),
    
    -- Relationship Management
    account_manager_id UUID REFERENCES users(id),
    key_account BOOLEAN DEFAULT false,
    credit_limit DECIMAL(15,2),
    payment_terms INTEGER DEFAULT 30, -- days
    currency VARCHAR(3) DEFAULT 'ZAR',
    
    -- Status and Tags
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'prospect')),
    tags TEXT[],
    notes TEXT,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    
    -- Soft delete
    deleted_at TIMESTAMP WITH TIME ZONE,
    deleted_by UUID REFERENCES users(id)
);

CREATE INDEX idx_contacts_type ON contacts(contact_type);
CREATE INDEX idx_contacts_company ON contacts(company_name);
CREATE INDEX idx_contacts_status ON contacts(status);
CREATE INDEX idx_contacts_account_manager ON contacts(account_manager_id);
CREATE INDEX idx_contacts_key_account ON contacts(key_account);
CREATE INDEX idx_contacts_deleted ON contacts(deleted_at) WHERE deleted_at IS NULL;
```

### 2. contact_persons
Additional contact persons for each contact
```sql
CREATE TABLE contact_persons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    job_title VARCHAR(100),
    department VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(20),
    mobile VARCHAR(20),
    is_primary BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_contact_persons_contact ON contact_persons(contact_id);
CREATE INDEX idx_contact_persons_primary ON contact_persons(is_primary);
```

### 3. contact_communications
Communication history with contacts
```sql
CREATE TABLE contact_communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    communication_type VARCHAR(20) NOT NULL CHECK (communication_type IN ('email', 'phone', 'meeting', 'whatsapp', 'note')),
    direction VARCHAR(10) CHECK (direction IN ('inbound', 'outbound')),
    subject VARCHAR(255),
    content TEXT,
    communication_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Related entities
    related_quote_id UUID,
    related_order_id UUID,
    related_batch_id UUID,
    
    -- Participants
    user_id UUID REFERENCES users(id),
    contact_person_id UUID REFERENCES contact_persons(id),
    
    -- Attachments
    attachment_urls TEXT[],
    
    -- Follow-up
    requires_followup BOOLEAN DEFAULT false,
    followup_date DATE,
    followup_completed BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_contact_communications_contact ON contact_communications(contact_id);
CREATE INDEX idx_contact_communications_date ON contact_communications(communication_date DESC);
CREATE INDEX idx_contact_communications_type ON contact_communications(communication_type);
CREATE INDEX idx_contact_communications_followup ON contact_communications(requires_followup, followup_date) WHERE requires_followup = true;
```

### 4. quotes
Sales quotes to customers or purchase quotes from suppliers
```sql
CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_number VARCHAR(50) UNIQUE NOT NULL,
    quote_type VARCHAR(20) NOT NULL CHECK (quote_type IN ('sales', 'purchase')),
    contact_id UUID REFERENCES contacts(id),
    
    -- Quote Details
    quote_date DATE NOT NULL,
    valid_until DATE NOT NULL,
    delivery_date DATE,
    
    -- Financial
    subtotal DECIMAL(15,2) NOT NULL,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',
    
    -- Status
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
    
    -- Terms and Conditions
    payment_terms VARCHAR(255),
    delivery_terms TEXT,
    special_instructions TEXT,
    notes TEXT,
    
    -- Relationships
    converted_to_order_id UUID,
    sales_person_id UUID REFERENCES users(id),
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_quotes_number ON quotes(quote_number);
CREATE INDEX idx_quotes_contact ON quotes(contact_id);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_date ON quotes(quote_date DESC);
CREATE INDEX idx_quotes_type ON quotes(quote_type);
```

### 5. quote_items
Line items for quotes
```sql
CREATE TABLE quote_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    
    product_type VARCHAR(20) CHECK (product_type IN ('kernel', 'oil', 'other')),
    product_code VARCHAR(100),
    description TEXT NOT NULL,
    
    -- Quantity and Pricing
    quantity DECIMAL(15,3) NOT NULL,
    unit_of_measure VARCHAR(20) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    tax_percentage DECIMAL(5,2) DEFAULT 15,
    line_total DECIMAL(15,2) NOT NULL,
    
    -- Product Specifications (for kernels)
    style VARCHAR(50), -- SP, 0, 1, 1S, 4L, 5, 6, 7/8
    grade VARCHAR(50),
    
    -- Delivery
    delivery_date DATE,
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_quote_items_quote ON quote_items(quote_id);
CREATE INDEX idx_quote_items_product ON quote_items(product_type, product_code);
```

### 6. customer_preferences
Store customer-specific preferences and requirements
```sql
CREATE TABLE customer_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    
    -- Product Preferences
    preferred_kernel_styles TEXT[],
    preferred_kernel_grades TEXT[],
    preferred_oil_types TEXT[],
    
    -- Quality Requirements
    max_ffa_percentage DECIMAL(5,2),
    max_moisture_percentage DECIMAL(5,2),
    min_kernel_size VARCHAR(50),
    
    -- Packaging Preferences
    preferred_packaging TEXT[],
    labeling_requirements TEXT,
    
    -- Delivery Preferences
    preferred_delivery_method VARCHAR(100),
    delivery_instructions TEXT,
    
    -- Communication Preferences
    preferred_contact_method VARCHAR(50),
    language_preference VARCHAR(50) DEFAULT 'English',
    
    -- Special Requirements
    certification_requirements TEXT[],
    allergen_declarations BOOLEAN DEFAULT false,
    halal_certified BOOLEAN DEFAULT false,
    kosher_certified BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_customer_preferences_contact ON customer_preferences(contact_id);
```

### 7. supplier_ratings
Rate and track supplier performance
```sql
CREATE TABLE supplier_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    rating_date DATE NOT NULL,
    
    -- Rating Categories (1-5 scale)
    quality_rating INTEGER CHECK (quality_rating BETWEEN 1 AND 5),
    delivery_rating INTEGER CHECK (delivery_rating BETWEEN 1 AND 5),
    communication_rating INTEGER CHECK (communication_rating BETWEEN 1 AND 5),
    pricing_rating INTEGER CHECK (pricing_rating BETWEEN 1 AND 5),
    
    -- Overall
    overall_rating DECIMAL(3,2),
    
    -- Comments
    strengths TEXT,
    areas_for_improvement TEXT,
    notes TEXT,
    
    -- Related Batch
    batch_id UUID,
    
    rated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_supplier_ratings_contact ON supplier_ratings(contact_id);
CREATE INDEX idx_supplier_ratings_date ON supplier_ratings(rating_date DESC);
```

---

## Frontend Implementation

### HTML Structure (CRM Dashboard)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CRM - Macavation</title>
    <link rel="stylesheet" href="/css/main.css">
</head>
<body>
    <div class="app-container">
        <!-- Navigation -->
        <nav class="sidebar">
            <!-- Include navigation component -->
        </nav>

        <!-- Main Content -->
        <main class="main-content">
            <header class="page-header">
                <h1>Customer Relationship Management</h1>
                <div class="header-actions">
                    <button class="btn btn-primary" onclick="crmManager.openNewContactModal()">
                        <span>➕</span> Add Contact
                    </button>
                </div>
            </header>

            <!-- Filters -->
            <div class="filters-section">
                <div class="filter-group">
                    <label>Contact Type:</label>
                    <select id="filterType" onchange="crmManager.applyFilters()">
                        <option value="">All</option>
                        <option value="customer">Customers</option>
                        <option value="supplier">Suppliers</option>
                        <option value="both">Both</option>
                    </select>
                </div>

                <div class="filter-group">
                    <label>Status:</label>
                    <select id="filterStatus" onchange="crmManager.applyFilters()">
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="prospect">Prospect</option>
                    </select>
                </div>

                <div class="filter-group">
                    <label>Key Accounts Only:</label>
                    <input type="checkbox" id="filterKeyAccounts" onchange="crmManager.applyFilters()">
                </div>

                <div class="filter-group">
                    <label>Search:</label>
                    <input type="text" id="searchInput" placeholder="Search company name..." onkeyup="crmManager.search()">
                </div>
            </div>

            <!-- Contacts Table -->
            <div class="table-container">
                <table id="contactsTable" class="data-table">
                    <thead>
                        <tr>
                            <th>Company Name</th>
                            <th>Type</th>
                            <th>Primary Contact</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Account Manager</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="contactsTableBody">
                        <!-- Populated by JavaScript -->
                    </tbody>
                </table>
            </div>

            <!-- Pagination -->
            <div class="pagination" id="pagination"></div>
        </main>
    </div>

    <!-- Contact Detail Modal -->
    <div id="contactModal" class="modal">
        <div class="modal-content large">
            <div class="modal-header">
                <h2 id="modalTitle">Contact Details</h2>
                <button class="modal-close" onclick="crmManager.closeModal()">&times;</button>
            </div>

            <div class="modal-body">
                <div class="tabs">
                    <button class="tab-button active" onclick="crmManager.switchTab('details')">Details</button>
                    <button class="tab-button" onclick="crmManager.switchTab('communications')">Communications</button>
                    <button class="tab-button" onclick="crmManager.switchTab('quotes')">Quotes</button>
                    <button class="tab-button" onclick="crmManager.switchTab('orders')">Orders</button>
                    <button class="tab-button" onclick="crmManager.switchTab('preferences')">Preferences</button>
                </div>

                <!-- Details Tab -->
                <div id="detailsTab" class="tab-content active">
                    <form id="contactForm">
                        <input type="hidden" id="contactId">

                        <div class="form-row">
                            <div class="form-group">
                                <label>Contact Type *</label>
                                <select id="contactType" required>
                                    <option value="customer">Customer</option>
                                    <option value="supplier">Supplier</option>
                                    <option value="both">Both</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Status *</label>
                                <select id="status" required>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                    <option value="prospect">Prospect</option>
                                    <option value="suspended">Suspended</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Key Account</label>
                                <input type="checkbox" id="keyAccount">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Company Name *</label>
                                <input type="text" id="companyName" required>
                            </div>

                            <div class="form-group">
                                <label>Trading Name</label>
                                <input type="text" id="tradingName">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Registration Number</label>
                                <input type="text" id="registrationNumber">
                            </div>

                            <div class="form-group">
                                <label>VAT Number</label>
                                <input type="text" id="vatNumber">
                            </div>
                        </div>

                        <h3>Primary Contact Person</h3>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Full Name</label>
                                <input type="text" id="primaryContactName">
                            </div>

                            <div class="form-group">
                                <label>Title</label>
                                <input type="text" id="primaryContactTitle">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Email</label>
                                <input type="email" id="primaryContactEmail">
                            </div>

                            <div class="form-group">
                                <label>Phone</label>
                                <input type="tel" id="primaryContactPhone">
                            </div>

                            <div class="form-group">
                                <label>Mobile</label>
                                <input type="tel" id="primaryContactMobile">
                            </div>
                        </div>

                        <h3>Physical Address</h3>
                        <div class="form-row">
                            <div class="form-group full-width">
                                <label>Address Line 1</label>
                                <input type="text" id="physicalAddressLine1">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group full-width">
                                <label>Address Line 2</label>
                                <input type="text" id="physicalAddressLine2">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>City</label>
                                <input type="text" id="physicalCity">
                            </div>

                            <div class="form-group">
                                <label>Province</label>
                                <select id="physicalProvince">
                                    <option value="">Select Province</option>
                                    <option value="Eastern Cape">Eastern Cape</option>
                                    <option value="Free State">Free State</option>
                                    <option value="Gauteng">Gauteng</option>
                                    <option value="KwaZulu-Natal">KwaZulu-Natal</option>
                                    <option value="Limpopo">Limpopo</option>
                                    <option value="Mpumalanga">Mpumalanga</option>
                                    <option value="Northern Cape">Northern Cape</option>
                                    <option value="North West">North West</option>
                                    <option value="Western Cape">Western Cape</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Postal Code</label>
                                <input type="text" id="physicalPostalCode">
                            </div>
                        </div>

                        <h3>Business Information</h3>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Account Manager</label>
                                <select id="accountManagerId">
                                    <option value="">Select Account Manager</option>
                                    <!-- Populated by JavaScript -->
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Credit Limit (ZAR)</label>
                                <input type="number" id="creditLimit" step="0.01">
                            </div>

                            <div class="form-group">
                                <label>Payment Terms (Days)</label>
                                <input type="number" id="paymentTerms" value="30">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group full-width">
                                <label>Notes</label>
                                <textarea id="notes" rows="4"></textarea>
                            </div>
                        </div>
                    </form>
                </div>

                <!-- Communications Tab -->
                <div id="communicationsTab" class="tab-content">
                    <div class="communications-header">
                        <button class="btn btn-primary" onclick="crmManager.addCommunication()">
                            <span>➕</span> Log Communication
                        </button>
                    </div>

                    <div id="communicationsList" class="communications-list">
                        <!-- Populated by JavaScript -->
                    </div>
                </div>

                <!-- Quotes Tab -->
                <div id="quotesTab" class="tab-content">
                    <div class="quotes-header">
                        <button class="btn btn-primary" onclick="crmManager.createQuote()">
                            <span>➕</span> Create Quote
                        </button>
                    </div>

                    <div id="quotesList">
                        <!-- Populated by JavaScript -->
                    </div>
                </div>

                <!-- Orders Tab -->
                <div id="ordersTab" class="tab-content">
                    <div id="ordersList">
                        <!-- Populated by JavaScript -->
                    </div>
                </div>

                <!-- Preferences Tab -->
                <div id="preferencesTab" class="tab-content">
                    <form id="preferencesForm">
                        <!-- Customer/Supplier specific preferences -->
                    </form>
                </div>
            </div>

            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="crmManager.closeModal()">Cancel</button>
                <button class="btn btn-primary" onclick="crmManager.saveContact()">Save Contact</button>
            </div>
        </div>
    </div>

    <script src="/js/crm.js"></script>
</body>
</html>
```

### JavaScript Implementation (crm.js)

```javascript
class CRMManager {
    constructor() {
        this.contacts = [];
        this.filteredContacts = [];
        this.currentContact = null;
        this.currentPage = 1;
        this.pageSize = 20;
        this.init();
    }

    async init() {
        await this.loadContacts();
        await this.loadAccountManagers();
        this.renderTable();
    }

    async loadContacts() {
        try {
            const { data, error } = await supabase
                .from('contacts')
                .select(`
                    *,
                    account_manager:users!account_manager_id(first_name, last_name)
                `)
                .is('deleted_at', null)
                .order('company_name');

            if (error) throw error;

            this.contacts = data;
            this.filteredContacts = data;
        } catch (error) {
            console.error('Error loading contacts:', error);
            this.showError('Failed to load contacts');
        }
    }

    async loadAccountManagers() {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id, first_name, last_name')
                .eq('is_active', true)
                .order('first_name');

            if (error) throw error;

            const select = document.getElementById('accountManagerId');
            select.innerHTML = '<option value="">Select Account Manager</option>';
            
            data.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = `${user.first_name} ${user.last_name}`;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading account managers:', error);
        }
    }

    applyFilters() {
        const type = document.getElementById('filterType').value;
        const status = document.getElementById('filterStatus').value;
        const keyAccountsOnly = document.getElementById('filterKeyAccounts').checked;

        this.filteredContacts = this.contacts.filter(contact => {
            if (type && contact.contact_type !== type) return false;
            if (status && contact.status !== status) return false;
            if (keyAccountsOnly && !contact.key_account) return false;
            return true;
        });

        this.currentPage = 1;
        this.renderTable();
    }

    search() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        
        this.filteredContacts = this.contacts.filter(contact => {
            return contact.company_name.toLowerCase().includes(searchTerm) ||
                   (contact.trading_name && contact.trading_name.toLowerCase().includes(searchTerm)) ||
                   (contact.primary_contact_name && contact.primary_contact_name.toLowerCase().includes(searchTerm));
        });

        this.currentPage = 1;
        this.renderTable();
    }

    renderTable() {
        const tbody = document.getElementById('contactsTableBody');
        tbody.innerHTML = '';

        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        const pageContacts = this.filteredContacts.slice(start, end);

        pageContacts.forEach(contact => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${contact.company_name}</td>
                <td><span class="badge badge-${contact.contact_type}">${contact.contact_type}</span></td>
                <td>${contact.primary_contact_name || '-'}</td>
                <td>${contact.primary_contact_email || '-'}</td>
                <td>${contact.primary_contact_phone || '-'}</td>
                <td>${contact.account_manager ? `${contact.account_manager.first_name} ${contact.account_manager.last_name}` : '-'}</td>
                <td><span class="badge badge-${contact.status}">${contact.status}</span></td>
                <td>
                    <button class="btn-icon" onclick="crmManager.viewContact('${contact.id}')" title="View">👁️</button>
                    <button class="btn-icon" onclick="crmManager.editContact('${contact.id}')" title="Edit">✏️</button>
                    <button class="btn-icon" onclick="crmManager.deleteContact('${contact.id}')" title="Delete">🗑️</button>
                </td>
            `;
        });

        this.renderPagination();
    }

    renderPagination() {
        const totalPages = Math.ceil(this.filteredContacts.length / this.pageSize);
        const pagination = document.getElementById('pagination');
        
        pagination.innerHTML = '';
        
        for (let i = 1; i <= totalPages; i++) {
            const button = document.createElement('button');
            button.textContent = i;
            button.className = i === this.currentPage ? 'active' : '';
            button.onclick = () => {
                this.currentPage = i;
                this.renderTable();
            };
            pagination.appendChild(button);
        }
    }

    openNewContactModal() {
        this.currentContact = null;
        document.getElementById('modalTitle').textContent = 'New Contact';
        document.getElementById('contactForm').reset();
        document.getElementById('contactModal').style.display = 'flex';
    }

    async viewContact(contactId) {
        await this.loadContactDetails(contactId);
        document.getElementById('modalTitle').textContent = 'Contact Details';
        this.populateForm();
        this.switchTab('details');
        document.getElementById('contactModal').style.display = 'flex';
    }

    async editContact(contactId) {
        await this.loadContactDetails(contactId);
        document.getElementById('modalTitle').textContent = 'Edit Contact';
        this.populateForm();
        document.getElementById('contactModal').style.display = 'flex';
    }

    async loadContactDetails(contactId) {
        try {
            const { data, error } = await supabase
                .from('contacts')
                .select(`
                    *,
                    contact_persons(*),
                    contact_communications(*),
                    customer_preferences(*)
                `)
                .eq('id', contactId)
                .single();

            if (error) throw error;

            this.currentContact = data;
        } catch (error) {
            console.error('Error loading contact details:', error);
            this.showError('Failed to load contact details');
        }
    }

    populateForm() {
        if (!this.currentContact) return;

        const fields = [
            'contactId', 'contactType', 'status', 'keyAccount',
            'companyName', 'tradingName', 'registrationNumber', 'vatNumber',
            'primaryContactName', 'primaryContactTitle', 'primaryContactEmail',
            'primaryContactPhone', 'primaryContactMobile',
            'physicalAddressLine1', 'physicalAddressLine2',
            'physicalCity', 'physicalProvince', 'physicalPostalCode',
            'accountManagerId', 'creditLimit', 'paymentTerms', 'notes'
        ];

        fields.forEach(field => {
            const element = document.getElementById(field);
            if (element) {
                const value = this.currentContact[this.camelToSnake(field)];
                
                if (element.type === 'checkbox') {
                    element.checked = value;
                } else {
                    element.value = value || '';
                }
            }
        });
    }

    async saveContact() {
        try {
            const formData = this.getFormData();
            
            if (this.currentContact) {
                // Update existing contact
                const { error } = await supabase
                    .from('contacts')
                    .update(formData)
                    .eq('id', this.currentContact.id);

                if (error) throw error;

                // Create audit log
                await this.createAuditLog('update', 'contacts', this.currentContact.id);
            } else {
                // Create new contact
                const { data, error } = await supabase
                    .from('contacts')
                    .insert(formData)
                    .select()
                    .single();

                if (error) throw error;

                // Create audit log
                await this.createAuditLog('create', 'contacts', data.id);
            }

            this.showSuccess('Contact saved successfully');
            this.closeModal();
            await this.loadContacts();
            this.renderTable();
        } catch (error) {
            console.error('Error saving contact:', error);
            this.showError('Failed to save contact');
        }
    }

    getFormData() {
        return {
            contact_type: document.getElementById('contactType').value,
            status: document.getElementById('status').value,
            key_account: document.getElementById('keyAccount').checked,
            company_name: document.getElementById('companyName').value,
            trading_name: document.getElementById('tradingName').value,
            registration_number: document.getElementById('registrationNumber').value,
            vat_number: document.getElementById('vatNumber').value,
            primary_contact_name: document.getElementById('primaryContactName').value,
            primary_contact_title: document.getElementById('primaryContactTitle').value,
            primary_contact_email: document.getElementById('primaryContactEmail').value,
            primary_contact_phone: document.getElementById('primaryContactPhone').value,
            primary_contact_mobile: document.getElementById('primaryContactMobile').value,
            physical_address_line1: document.getElementById('physicalAddressLine1').value,
            physical_address_line2: document.getElementById('physicalAddressLine2').value,
            physical_city: document.getElementById('physicalCity').value,
            physical_province: document.getElementById('physicalProvince').value,
            physical_postal_code: document.getElementById('physicalPostalCode').value,
            account_manager_id: document.getElementById('accountManagerId').value || null,
            credit_limit: document.getElementById('creditLimit').value || null,
            payment_terms: document.getElementById('paymentTerms').value,
            notes: document.getElementById('notes').value,
            updated_at: new Date().toISOString(),
            updated_by: window.authManager.currentUser.id
        };
    }

    async deleteContact(contactId) {
        if (!confirm('Are you sure you want to delete this contact? This action cannot be undone.')) {
            return;
        }

        try {
            // Soft delete
            const { error } = await supabase
                .from('contacts')
                .update({
                    deleted_at: new Date().toISOString(),
                    deleted_by: window.authManager.currentUser.id
                })
                .eq('id', contactId);

            if (error) throw error;

            // Create audit log
            await this.createAuditLog('delete', 'contacts', contactId);

            this.showSuccess('Contact deleted successfully');
            await this.loadContacts();
            this.renderTable();
        } catch (error) {
            console.error('Error deleting contact:', error);
            this.showError('Failed to delete contact');
        }
    }

    async addCommunication() {
        // Open communication modal
        // Implementation depends on communication modal design
    }

    async createQuote() {
        // Redirect to quote creation with pre-filled contact
        window.location.href = `/quotes/new?contactId=${this.currentContact.id}`;
    }

    switchTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });

        // Show selected tab
        document.getElementById(`${tabName}Tab`).classList.add('active');
        event.target.classList.add('active');

        // Load tab-specific data
        if (tabName === 'communications') {
            this.loadCommunications();
        } else if (tabName === 'quotes') {
            this.loadQuotes();
        } else if (tabName === 'orders') {
            this.loadOrders();
        }
    }

    async loadCommunications() {
        if (!this.currentContact) return;

        try {
            const { data, error } = await supabase
                .from('contact_communications')
                .select('*, users(first_name, last_name)')
                .eq('contact_id', this.currentContact.id)
                .order('communication_date', { ascending: false });

            if (error) throw error;

            this.renderCommunications(data);
        } catch (error) {
            console.error('Error loading communications:', error);
        }
    }

    renderCommunications(communications) {
        const container = document.getElementById('communicationsList');
        container.innerHTML = '';

        if (communications.length === 0) {
            container.innerHTML = '<p class="no-data">No communications recorded yet.</p>';
            return;
        }

        communications.forEach(comm => {
            const div = document.createElement('div');
            div.className = 'communication-item';
            div.innerHTML = `
                <div class="comm-header">
                    <span class="comm-type badge badge-${comm.communication_type}">${comm.communication_type}</span>
                    <span class="comm-date">${new Date(comm.communication_date).toLocaleDateString()}</span>
                    <span class="comm-user">${comm.users.first_name} ${comm.users.last_name}</span>
                </div>
                <div class="comm-subject">${comm.subject || 'No subject'}</div>
                <div class="comm-content">${comm.content || ''}</div>
                ${comm.requires_followup ? `<div class="comm-followup">Follow-up required by ${new Date(comm.followup_date).toLocaleDateString()}</div>` : ''}
            `;
            container.appendChild(div);
        });
    }

    closeModal() {
        document.getElementById('contactModal').style.display = 'none';
        this.currentContact = null;
    }

    async createAuditLog(action, entityType, entityId) {
        try {
            await supabase
                .from('audit_log')
                .insert({
                    user_id: window.authManager.currentUser.id,
                    action: action,
                    entity_type: entityType,
                    entity_id: entityId
                });
        } catch (error) {
            console.error('Error creating audit log:', error);
        }
    }

    camelToSnake(str) {
        return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    }

    showSuccess(message) {
        // Implement toast notification
        alert(message);
    }

    showError(message) {
        // Implement toast notification
        alert(message);
    }
}

// Initialize CRM Manager
const crmManager = new CRMManager();
```

---

## Business Rules

### Contact Management

1. **Contact Creation**
   - Company name is required and must be unique
   - At least one contact type (customer/supplier/both) must be selected
   - VAT number must be validated if provided
   - New contacts default to 'prospect' status

2. **Contact Validation**
   - Email addresses must be valid format
   - Phone numbers should follow South African format
   - Registration numbers must be unique
   - Credit limit cannot be negative

3. **Contact Status Workflow**
   - Prospect → Active (after first order/delivery)
   - Active → Inactive (manual change)
   - Active → Suspended (credit issues, quality issues)
   - Inactive → Active (manual reactivation)

4. **Key Account Management**
   - Key accounts must have an assigned account manager
   - Account manager receives notifications for all key account activities
   - Key accounts require approval for status changes
   - Key accounts have priority in order fulfillment

### Communication Tracking

1. **Communication Logging**
   - All customer/supplier communications must be logged
   - Email communications automatically captured
   - Phone calls manually logged with summary
   - Meetings require attendees and minutes

2. **Follow-up Management**
   - Communications marked for follow-up appear in dashboard
   - Follow-up notifications sent 1 day before due date
   - Overdue follow-ups escalated to account manager
   - Follow-ups automatically marked complete when actioned

3. **Communication Priority**
   - Customer complaints flagged as high priority
   - Quality issues require immediate response
   - Quote requests require response within 24 hours
   - General inquiries require response within 48 hours

### Quote Management

1. **Quote Creation**
   - Quotes automatically numbered (format: Q-YYYY-MM-NNNNN)
   - Valid until date defaults to 30 days from quote date
   - Quotes include current pricing from price list
   - Special pricing requires approval

2. **Quote Workflow**
   - Draft → Sent (manual action)
   - Sent → Accepted/Rejected (customer response)
   - Accepted → Converted (creates sales order)
   - Auto-expire after valid until date

3. **Quote Pricing**
   - Base prices from product master
   - Volume discounts automatically applied
   - Key account discounts require approval
   - All prices in ZAR, currency conversion if needed

4. **Quote Conversion**
   - Accepted quotes converted to sales orders
   - Original quote retained for reference
   - Quote items transferred to order items
   - Stock availability checked before conversion

### Supplier Rating

1. **Rating Frequency**
   - Suppliers rated after each major delivery
   - Minimum one rating per quarter
   - Annual comprehensive rating review

2. **Rating Categories**
   - Quality: Product quality, consistency
   - Delivery: On-time delivery, condition
   - Communication: Responsiveness, clarity
   - Pricing: Competitive pricing, payment terms

3. **Rating Actions**
   - Ratings below 3.0 trigger review meeting
   - Consistent low ratings (3 months) → supplier warning
   - Ratings below 2.0 → supplier suspension
   - Top-rated suppliers (4.5+) eligible for preferred status

### Credit Management

1. **Credit Limit Assignment**
   - New customers: R0 (cash on delivery)
   - Established customers: Based on financial assessment
   - Key accounts: Higher limits with approval
   - Credit limits reviewed quarterly

2. **Credit Hold**
   - Orders blocked if exceeding credit limit
   - Automatic hold if 60+ days overdue
   - Manual hold for quality issues
   - Release requires management approval

3. **Payment Terms**
   - Standard: 30 days from invoice
   - Key accounts: Up to 60 days
   - New customers: COD or prepayment
   - Early payment discount: 2% if paid within 7 days

---

## Integration Points

### Palladium ERP Integration

1. **Customer Master Data Sync**
   - New customers created in CRM sync to Palladium
   - Customer updates (address, contact, credit limit) sync bidirectionally
   - Account numbers assigned in Palladium reflected in CRM

2. **Order Integration**
   - Sales orders created from CRM quotes sync to Palladium
   - Order status updates from Palladium reflected in CRM
   - Invoice generation in Palladium triggers CRM notification

3. **Payment Integration**
   - Payments recorded in Palladium update customer account in CRM
   - Outstanding balance visible in CRM
   - Payment history accessible from customer record

### Email Integration

1. **Automated Emails**
   - Quote sent notifications
   - Order confirmation emails
   - Invoice emails
   - Payment reminders
   - Follow-up reminders

2. **Email Tracking**
   - Sent emails logged in communication history
   - Email opens and clicks tracked
   - Replies automatically captured
   - Attachments stored in document management

### WhatsApp Business Integration

1. **Customer Communications**
   - Order status updates via WhatsApp
   - Delivery notifications
   - Quick queries and responses
   - Payment confirmations

2. **Message Templates**
   - Pre-approved templates for common communications
   - Personalized with customer and order data
   - Multilingual support (English, Afrikaans, Zulu)

---

## Reporting Requirements

### Standard Reports

1. **Customer List Report**
   - All active customers with contact details
   - Filterable by type, status, account manager
   - Export to Excel

2. **Sales Pipeline Report**
   - Open quotes by customer
   - Quote value and age
   - Conversion rate statistics

3. **Communication Activity Report**
   - Communications by type and date range
   - Response time metrics
   - Follow-up compliance

4. **Supplier Performance Report**
   - Ratings by supplier
   - Trends over time
   - Quality issues summary

5. **Key Account Report**
   - Key account list with account manager
   - Sales value and margin
   - Activity summary

### Dashboard Metrics

1. **Customer Metrics**
   - Total active customers
   - New customers this month
   - Customers by type and status
   - Credit utilization

2. **Quote Metrics**
   - Open quotes count and value
   - Quote conversion rate
   - Average quote value
   - Quotes by status

3. **Communication Metrics**
   - Communications logged today
   - Pending follow-ups
   - Overdue follow-ups
   - Response time average

---

## Testing Checklist

- [ ] Create new customer contact
- [ ] Create new supplier contact
- [ ] Edit existing contact
- [ ] Soft delete contact
- [ ] Search contacts by name
- [ ] Filter contacts by type, status, key account
- [ ] Add communication to contact
- [ ] Log follow-up for communication
- [ ] Create quote for customer
- [ ] Convert quote to order
- [ ] Rate supplier performance
- [ ] Assign account manager to contact
- [ ] Update customer credit limit
- [ ] Suspend customer account
- [ ] Reactivate suspended account
- [ ] View communication history
- [ ] Export contact list to Excel
- [ ] Sync customer to Palladium
- [ ] Send automated email
- [ ] WhatsApp notification delivery

---

## Future Enhancements

1. **Advanced Analytics**
   - Customer lifetime value calculation
   - Churn prediction
   - Sales forecasting based on historical data

2. **Marketing Automation**
   - Email campaigns
   - Customer segmentation
   - Automated follow-up sequences

3. **Mobile App**
   - Field sales access to CRM
   - Offline contact management
   - Mobile communication logging

4. **AI Features**
   - Sentiment analysis on communications
   - Automated response suggestions
   - Next best action recommendations
