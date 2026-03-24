# Supplier Intake — oil supplier list (no MCP migration)

**Supplier Intake → Receiver checklist** supplier dropdown is filtered in the frontend. **No Supabase migration** is required.

## Behaviour

- **Included** `contacts.contact_type`: `supplier`, `both`, `oil_processor` (oil / general supply chain in CRM).
- **Excluded**: `nis_supplier` (kernel NIS list), `kernel_customer`.

Implementation: `WebPortal/modules/modals/modal-supplier-receiver-checklist/js/modal_supplier_receiver_checklist.js` (`filterContactsForOilIntake`).

**Add supplier** (same modal): **+** next to the Supplier select → inline form → `createContact` with `supplier` or `oil_processor`; list refreshes and the new contact is selected. No extra migration.

## Optional: verify contact mix in SQL

```sql
SELECT contact_type, COUNT(*)::int AS n
FROM public.contacts
GROUP BY contact_type
ORDER BY contact_type;
```

Reclassify contacts in **Contact Database Management** if a company should appear under Oil vs NIS (change `contact_type` on the contact record).
