
-- OAuth2 authorization server for Alexa Account Linking
CREATE TABLE public.alexa_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.devices(id) ON DELETE CASCADE,
  client_id text UNIQUE NOT NULL,
  client_secret_hash text NOT NULL,
  name text NOT NULL DEFAULT 'Alexa Skill',
  redirect_uris text[] NOT NULL DEFAULT ARRAY[
    'https://alexa.amazon.co.jp/api/skill/link/',
    'https://layla.amazon.com/api/skill/link/',
    'https://pitangui.amazon.com/api/skill/link/'
  ],
  scopes text[] NOT NULL DEFAULT ARRAY['control','read'],
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alexa_oauth_clients TO authenticated;
GRANT ALL ON public.alexa_oauth_clients TO service_role;

ALTER TABLE public.alexa_oauth_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own clients read"
  ON public.alexa_oauth_clients FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "own clients write"
  ON public.alexa_oauth_clients FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own clients update"
  ON public.alexa_oauth_clients FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own clients delete"
  ON public.alexa_oauth_clients FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE public.alexa_oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL,
  user_id uuid NOT NULL,
  device_id uuid,
  redirect_uri text NOT NULL,
  scope text NOT NULL DEFAULT 'control',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No app roles need direct access; only service_role via edge server functions.
GRANT ALL ON public.alexa_oauth_codes TO service_role;
ALTER TABLE public.alexa_oauth_codes ENABLE ROW LEVEL SECURITY;
-- No policies: deny by default to anon/authenticated (service_role bypasses).
