
-- MCP tokens
CREATE TABLE public.mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['read']::text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.mcp_tokens TO authenticated;
GRANT ALL ON public.mcp_tokens TO service_role;

ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own mcp tokens" ON public.mcp_tokens
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own mcp tokens" ON public.mcp_tokens
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own mcp tokens" ON public.mcp_tokens
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX mcp_tokens_user_idx ON public.mcp_tokens(user_id);
CREATE INDEX mcp_tokens_hash_idx ON public.mcp_tokens(token_hash);

-- MCP audit
CREATE TABLE public.mcp_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id uuid,
  token_id uuid,
  tool text NOT NULL,
  status text NOT NULL,
  latency_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.mcp_audit TO authenticated;
GRANT ALL ON public.mcp_audit TO service_role;

ALTER TABLE public.mcp_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own mcp audit" ON public.mcp_audit
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX mcp_audit_user_idx ON public.mcp_audit(user_id, created_at DESC);
