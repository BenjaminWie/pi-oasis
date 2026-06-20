
-- Profiles: 1:1 mit auth.users, hält Telegram-Bot-Konfig pro User
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  telegram_bot_token TEXT,
  telegram_bot_username TEXT,
  telegram_chat_id BIGINT,
  telegram_webhook_secret TEXT,
  telegram_link_code TEXT,
  telegram_linked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Devices: registrierte Pis
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pairing_code TEXT UNIQUE,
  pairing_expires_at TIMESTAMPTZ,
  device_token_hash TEXT,
  last_seen_at TIMESTAMPTZ,
  last_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX devices_user_id_idx ON public.devices(user_id);
CREATE INDEX devices_pairing_code_idx ON public.devices(pairing_code) WHERE pairing_code IS NOT NULL;
CREATE INDEX devices_token_hash_idx ON public.devices(device_token_hash) WHERE device_token_hash IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own devices" ON public.devices
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Agent-Commands: vom UI/Bot in die Queue, Pi pollt
CREATE TABLE public.agent_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('status','container_action','mqtt_publish','mqtt_subscribe')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','done','failed')),
  result JSONB,
  source TEXT NOT NULL DEFAULT 'ui' CHECK (source IN ('ui','telegram','api')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX agent_commands_device_pending_idx
  ON public.agent_commands(device_id, created_at)
  WHERE status = 'pending';
CREATE INDEX agent_commands_user_idx ON public.agent_commands(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_commands TO authenticated;
GRANT ALL ON public.agent_commands TO service_role;
ALTER TABLE public.agent_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own commands" ON public.agent_commands
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own commands" ON public.agent_commands
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Telegram Audit
CREATE TABLE public.telegram_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id BIGINT,
  command TEXT NOT NULL,
  device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX telegram_audit_user_idx ON public.telegram_audit(user_id, created_at DESC);

GRANT SELECT, INSERT ON public.telegram_audit TO authenticated;
GRANT ALL ON public.telegram_audit TO service_role;
ALTER TABLE public.telegram_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own audit" ON public.telegram_audit
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Trigger: bei Signup Profile anlegen
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at Trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
