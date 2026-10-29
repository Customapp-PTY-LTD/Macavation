-- ============================================================================
-- Recon sheet row 90 (Golden Macadamias, 18 Jul 2026) is a real load, not a repeat of row 80.
-- Henry, 29 Oct 2026: keep it. The check_duplicate flag is cleared; the note records the decision.
-- Down: UPDATE oil_raw_receipts SET flag = 'check_duplicate' WHERE id = 'a0106a2d-ef2b-5a3e-ae5f-46964ffd3cb5';
-- ============================================================================

UPDATE public.oil_raw_receipts
   SET flag = NULL,
       note = 'Second Golden Macadamias load on 18 Jul 2026, same 9,525.6 kg kernel dust as sheet row 80. Confirmed as a separate load (Henry, 29 Oct 2026).'
 WHERE id = 'a0106a2d-ef2b-5a3e-ae5f-46964ffd3cb5'
   AND flag = 'check_duplicate';
