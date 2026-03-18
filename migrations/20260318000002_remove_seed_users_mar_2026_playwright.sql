-- Remove Playwright seed users (2026-03-17). Re-run safe only if ids/emails still exist.
DELETE FROM public.users WHERE id IN (
  '76886885-dbb5-4413-889b-f509cd2f7af4',
  '59b1850a-cf29-4b5a-9618-a924020edca2',
  '55502c84-de8e-42b1-9897-87d8dc490f9e',
  '5ec09b57-3f7e-4033-bb89-294d21528297',
  '066edf4f-b499-4d17-8843-9baa484355b3'
);
DELETE FROM auth.users WHERE email IN (
  'jon.walters@macavation.co.za',
  'joslyn.pillay@macavation.co.za',
  'mark.payne@macavation.co.za',
  'peter.symons@macavation.co.za',
  'simone.naidu@macavation.co.za'
);
