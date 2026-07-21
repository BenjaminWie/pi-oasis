
ALTER TABLE public.mcp_tokens
  ADD COLUMN IF NOT EXISTS refresh_token_hash text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS mcp_tokens_refresh_hash_idx
  ON public.mcp_tokens(refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;
