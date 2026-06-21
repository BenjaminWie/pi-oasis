
-- Profiles: prevent client from writing telegram_* sensitive fields
CREATE OR REPLACE FUNCTION public.profiles_protect_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- service_role bypasses (used by server functions via admin client)
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.telegram_bot_token := NULL;
    NEW.telegram_bot_username := NULL;
    NEW.telegram_webhook_secret := NULL;
    NEW.telegram_chat_id := NULL;
    NEW.telegram_link_code := NULL;
    NEW.telegram_linked_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: preserve sensitive fields from OLD
  NEW.telegram_bot_token := OLD.telegram_bot_token;
  NEW.telegram_bot_username := OLD.telegram_bot_username;
  NEW.telegram_webhook_secret := OLD.telegram_webhook_secret;
  NEW.telegram_chat_id := OLD.telegram_chat_id;
  NEW.telegram_link_code := OLD.telegram_link_code;
  NEW.telegram_linked_at := OLD.telegram_linked_at;
  NEW.id := OLD.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_sensitive_trg ON public.profiles;
CREATE TRIGGER profiles_protect_sensitive_trg
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_sensitive();

-- agent_commands: force safe defaults on client INSERT
CREATE OR REPLACE FUNCTION public.agent_commands_protect_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.status := 'pending';
  NEW.source := 'ui';
  NEW.result := NULL;
  NEW.delivered_at := NULL;
  NEW.completed_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_commands_protect_insert_trg ON public.agent_commands;
CREATE TRIGGER agent_commands_protect_insert_trg
BEFORE INSERT ON public.agent_commands
FOR EACH ROW EXECUTE FUNCTION public.agent_commands_protect_insert();

-- agent_commands: prevent client UPDATE/DELETE (no policies exist; ensure no future grants accidentally allow). RLS with no UPDATE/DELETE policy already blocks; no-op here.
