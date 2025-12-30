-- Example Table Template
-- Copy and modify for your new table

CREATE TABLE public.example_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    code varchar(50) UNIQUE,
    category_id uuid REFERENCES public.categories(id),
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Add your custom fields here
    -- custom_field1 text,
    -- custom_field2 integer,
    -- custom_field3 boolean
);

-- Add indexes
CREATE INDEX idx_example_items_is_active ON public.example_items(is_active);
CREATE INDEX idx_example_items_created_at ON public.example_items(created_at DESC);
CREATE INDEX idx_example_items_category_id ON public.example_items(category_id);

-- Enable Row Level Security (if needed)
-- ALTER TABLE public.example_items ENABLE ROW LEVEL SECURITY;

-- Add comments for documentation
COMMENT ON TABLE public.example_items IS 'Stores example items';
COMMENT ON COLUMN public.example_items.name IS 'Item name';
COMMENT ON COLUMN public.example_items.is_active IS 'Soft delete flag';

