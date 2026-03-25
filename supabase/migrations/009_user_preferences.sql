-- Migration to add JSONB preferences block to the user settings table
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
