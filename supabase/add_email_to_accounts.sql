-- Add email column to accounts for username-based sign-in lookup
-- Run this in Supabase SQL Editor after the initial schema.sql

-- Add email column
alter table public.accounts 
  add column if not exists email text;

-- Create index for email lookups
create index if not exists idx_accounts_email on public.accounts (email);

-- Update RLS to allow reading email for the account owner
-- (existing policies already handle this since they check id = auth.uid())
