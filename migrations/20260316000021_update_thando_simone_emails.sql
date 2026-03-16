-- Update Thando's email to macadamia-kernel@macavation.co.za and Simone's to simone@macavation.co.za

UPDATE public.users SET email = 'macadamia-kernel@macavation.co.za', updated_at = now() WHERE email = 'thando@macavation.co.za';

UPDATE public.users SET email = 'simone@macavation.co.za', updated_at = now() WHERE email = 'samone@macavation.co.za';
