
-- One-shot cloud→Pi pairing handoff. The cloud server function inserts a row
-- keyed by sha256(nonce); the Pi (running locally) polls a public endpoint
-- with the raw nonce, claims the row, stores the device token, and starts
-- its bridge loop. Nonces expire in 10 minutes; rows are single-use.

CREATE TABLE public.cloud_pairings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nonce_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  device_token text NOT NULL,
  device_name text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only admin / server functions touch this; never expose to anon/authenticated.
GRANT ALL ON public.cloud_pairings TO service_role;

ALTER TABLE public.cloud_pairings ENABLE ROW LEVEL SECURITY;

-- No policies = no access for anon/authenticated. Service role bypasses RLS.

CREATE INDEX idx_cloud_pairings_expires ON public.cloud_pairings (expires_at);
