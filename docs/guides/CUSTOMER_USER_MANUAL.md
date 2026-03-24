# Macavation — User manual

**Macavation** is a web portal for managing macadamia **kernel** processing and **oil & protein** operations: from intake and production through stock and dispatch, with contacts, quality, and reporting in one place.

This guide is for **end users** going live. Technical setup and database notes live elsewhere in the project documentation.

---

## Table of contents

1. [Getting started](#1-getting-started)
2. [How navigation works](#2-how-navigation-works)
3. [Dashboard and My Day](#3-dashboard-and-my-day)
4. [CRM — Contact database](#4-crm--contact-database)
5. [Kernel stream (nuts in shell → packed kernel)](#5-kernel-stream-nuts-in-shell--packed-kernel)
6. [Oil & protein stream](#6-oil--protein-stream)
7. [Quality assurance](#7-quality-assurance)
8. [Stock management](#8-stock-management)
9. [Dispatch](#9-dispatch)
10. [Business, documents, and integrations](#10-business-documents-and-integrations)
11. [Batch Journey](#11-batch-journey)
12. [Who can see what (roles)](#12-who-can-see-what-roles)
13. [Tips and support](#13-tips-and-support)
14. [Glossary](#14-glossary)

---

## 1. Getting started

### Signing in

- Open the **Macavation** web address your organisation gives you (bookmark it on your PC or tablet).
- Sign in using the method your administrator configured (for example **Google** or **email and password**).
- If sign-in fails, check caps lock, try a password reset if available, or contact your **system administrator** — the support team cannot see your password.

### Top bar

- **My Day** (calendar icon): quick snapshot of tasks relevant to you; you can open the full **My Day** page from there.
- **Profile** (avatar): your name, email, role, **change password**, and **sign out**.

### Sidebar

- The **left menu** lists the areas you are allowed to use. If a section is missing, your role does not include it (see [Who can see what](#12-who-can-see-what-roles)).
- Some headings **expand** (chevron): click the heading to show sub-pages (e.g. **Kernel** → Grower Intake, Kernel Production, …).

---

## 2. How navigation works

| Area in the menu | What it is for |
|------------------|----------------|
| **Dashboard** | Overview and KPI-style views (what you see may depend on role). |
| **Batch Journey** | Cross-cutting view of batches across the system. |
| **CRM** | Customers, suppliers, growers, and related contact types. |
| **Kernel** | Everything for **nut-in-shell / kernel** production and dispatch. |
| **Oil & protein** | **Raw ingredient intake**, oil production, oil/protein stock, dispatch. |
| **Quality** | Quality assurance and food safety records. |
| **Business** | Sales forecasting and financial management (if enabled). |
| **Document management** | Stored documents and records. |
| **Palladium integration** | Connection to Palladium ERP (if your site uses it). |
| **User management** | Users, roles, permissions (administrators only). |
| **System administration** | Advanced system settings (restricted). |
| **Test management** | Internal test tools (usually hidden for normal users). |

---

## 3. Dashboard and My Day

### Dashboard

- May include **unified** or role-specific views (e.g. material journey, executive summaries).
- Use it as a **starting point**; detailed work happens in the Kernel, Oil & protein, and CRM sections.

### My Day

- Summarises **what needs attention** for your role (approvals, batches, tasks — depending on configuration).
- Open **View full My Day** for the dedicated page.

---

## 4. CRM — Contact database

**CRM → Contacts** (sometimes labelled **Contact Database Management**) holds the people and organisations you work with.

### Tabs / contact types (typical)

- **Customers** — buyers of your products.
- **Suppliers** — general suppliers (including many **oil & protein** raw-material suppliers).
- **NIS suppliers** — **kernel / nut-in-shell** grower list (numbered suppliers used with kernel intake and statistics).
- **Oil processors** — organisations classified as oil processors.
- **Kernel customers** — kernel sales customers.

### Common actions

- **Search** and **filter** the grid.
- **Add** a contact: use the add/new control and fill in company name, type, and optional phone, email, address, notes.
- **Edit** or **deactivate** contacts as your permissions allow.

*Note: **Supplier Intake** (oil) uses only certain contact types in its supplier dropdown (suppliers, oil processors, and “both”); NIS kernel suppliers are managed under CRM but are not mixed into that oil intake list by design.*

---

## 5. Kernel stream (nuts in shell → packed kernel)

This follows material from **grower delivery** through **processing** to **warehouse** and **dispatch**.

### 5.1 Grower intake

- Records **incoming NIS** (nuts in shell) from growers.
- Typical flow: create or link **samples**, capture weights and delivery data, run through **quality** where required, then progress toward **production batches**.
- You may use **receiving checklists** and **create kernel batch** actions from this area (exact buttons depend on your screen).
- **Grower / supplier** is often chosen from contacts (including **NIS suppliers**).

### 5.2 Kernel production

- Tracks each **kernel batch** through production **stages** (e.g. receiving, cracking, drying, sorting, packing, QA steps — as configured).
- Open a batch to record **production stages**, **job cards**, and related details.
- Status moves forward as work is completed; some steps may require **QA** or **release**.

### 5.3 Stock (kernel)

- Shows **finished / in-process kernel stock** positions (cartons, styles, locations — as configured).
- Used for **warehouse** visibility and often links to **dispatch** and **send to dispatch** style actions from stock tools.

### 5.4 Kernel dispatch

- Builds and processes **dispatch** of kernel product to customers.
- Usually includes **inspection** and **dispatch documentation** steps before goods leave the site.

---

## 6. Oil & protein stream

This follows **raw ingredients** (oil kernel, cracker dust, kernel dust, crush, cake, etc.) from **supplier delivery** through **production** to **stock** and **dispatch**.

### 6.1 Supplier intake

- **Receiver checklist**: one of the main ways to **register a delivery**. You enter:
  - Date received, delivery note / PO, **supplier** (from the oil-side supplier list).
  - Vehicle and receiving checks (clean truck, pallets, pests, etc.).
  - One or more **bag rows**: each row can become its own **batch** with product type, batch number, quantity (kg), and optional dates.
- **Add supplier**: next to the supplier dropdown, **+** opens a short form to create a **supplier** or **oil processor** contact without leaving the page.
- After creation, batches appear in **Awaiting tests** until quality steps are done, then **Ready for oil production** when released.
- Views often include **board (Kanban)**, **table**, **weekly**, and **overview** — use the toggles on the page.

### 6.2 Oil production

- Manages **oil production** work: linking **raw ingredient batches**, recording **production** data, **oil bins / shifts** (if your site uses them), and moving work toward completion.
- Exact steps match your **standard operating procedures**; the system stores batch IDs, quantities, and audit-friendly timestamps.

### 6.3 Stock (oil & protein)

- **Oil and protein stock** (lots, locations, grades — as configured).
- May support **import** of lots from spreadsheets, **adjustments**, and **release to production** where applicable.

### 6.4 Oil & protein dispatch

- Similar idea to kernel dispatch: **orders / baskets**, **inspection**, and **dispatch** paperwork for oil and protein products.
- From **Stock (Oil & protein)** → **Send to Dispatch (Oil & protein)**, step 1 lets you pick a buyer from contacts or type a name; **+** next to *Buyer (from contacts)* opens a form to add a **Customer** or **Customer & supplier** in CRM and select them immediately.

---

## 7. Quality assurance

**Quality → Quality assurance** (and related modals such as **quality tests**):

- Record **tests** (moisture, FFA, peroxide, organoleptic, etc. — depending on form).
- From **supplier intake**, **sample test** actions can move batches toward **ready for production** when criteria are met.
- Follow your **QA sign-off** process; the system keeps a trail of who did what and when.

---

## 8. Stock management

There are separate entry points for **kernel** and **oil & protein** stock (sidebar under each stream). A generic **stock management** route may also exist.

Typical capabilities:

- View **on-hand** balances and **locations**.
- **Stock take** and **raw material issued** (where implemented).
- **Send to dispatch** (kernel) or **send to dispatch (oil)** to prepare goods for the dispatch modules.

---

## 9. Dispatch

- **Kernel dispatch** and **oil & protein dispatch** are separate menus.
- Use them to **pick**, **check**, and **complete** outbound loads against customer orders or internal transfers (per your process).

---

## 10. Business, documents, and integrations

| Module | Purpose |
|--------|---------|
| **Sales forecasting** | Demand and forecast inputs for planning. |
| **Financial management** | Financial views and workflows (as configured). |
| **Document management** | Central file and document store. |
| **Palladium integration** | Sync or hand-off with Palladium ERP. |
| **Data import** | Bulk import from Excel (administrative use). |

---

## 11. Batch Journey

- **Batch Journey** provides an **across-the-system** list or view of batches so you can trace status without opening each module separately.

---

## 12. Who can see what (roles)

- Access is controlled by **roles** (e.g. administrator, production, QA, read-only).
- If you get **“not authorised”** or a missing menu item, your account needs a **role** or **permission** update from an administrator.
- **User management** (users, roles, database permissions, features) is only for trained **admin** staff.

---

## 13. Tips and support

### Good habits

- **Save** forms before closing the browser; use on-screen **success** messages as confirmation.
- After CRM changes, **refresh** or reopen a page if a dropdown looks out of date.
- Use **consistent batch numbering** conventions your site agrees on (oil vs kernel rules may differ).

### Browsers

- Use a **current** version of Chrome, Edge, or Firefox.  
- Clear cache or try a private window if the app behaves oddly after an update.

### Getting help

- **Day-to-day process questions** → your **internal super user** or **production manager**.
- **Login, roles, new users** → **system administrator**.
- **Bugs or change requests** → your **software supplier / Macavation project contact** with a screenshot, URL, time, and what you clicked.

---

## 14. Glossary

| Term | Meaning |
|------|---------|
| **NIS** | Nut in shell (whole macadamia with shell on). |
| **Kernel** | Processed macadamia kernel (packed product stream). |
| **Batch** | A tracked lot of product with an ID through intake, production, stock, or dispatch. |
| **Grower intake** | Kernel-side intake from growers / NIS suppliers. |
| **Supplier intake** | Oil & protein raw material intake from suppliers (not the NIS grower list). |
| **CRM** | Contact database (customers, suppliers, NIS list, etc.). |
| **Dispatch** | Final shipping step to customer or transfer. |
| **RBAC** | Role-based access control — who can open which screens. |

---

*Document version: aligned with Macavation WebPortal navigation and modules. Custom labels or extra fields your organisation adds may differ slightly — use this manual together with your internal SOPs.*
