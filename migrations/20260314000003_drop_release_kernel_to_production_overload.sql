-- Remove the overload release_kernel_to_production(p_kernel_id uuid, p_silos integer[])
-- so only release_kernel_to_production(p_kernel_id uuid) remains. The app calls release
-- with just kernel_id, then assign_kernel_to_silos(kernel_id, silo_numbers) separately.
DROP FUNCTION IF EXISTS public.release_kernel_to_production(uuid, integer[]);
