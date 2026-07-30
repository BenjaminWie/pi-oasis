ALTER TABLE public.mcp_tokens ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE public.mcp_tokens ALTER COLUMN token_prefix SET DEFAULT '';