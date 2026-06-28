CREATE TABLE public.appliance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  name text NOT NULL,
  match_component text,
  min_watts numeric NOT NULL DEFAULT 150,
  min_runtime_min integer NOT NULL DEFAULT 10,
  idle_watts numeric NOT NULL DEFAULT 5,
  idle_after_min integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appliance_profiles TO authenticated;
GRANT ALL ON public.appliance_profiles TO service_role;
ALTER TABLE public.appliance_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their appliance profiles"
  ON public.appliance_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER appliance_profiles_touch
  BEFORE UPDATE ON public.appliance_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();