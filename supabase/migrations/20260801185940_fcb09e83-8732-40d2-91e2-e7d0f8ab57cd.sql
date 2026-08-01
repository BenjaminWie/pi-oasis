UPDATE public.mcp_tokens
SET scopes = ARRAY['read','control']
WHERE source = 'alexa'
  AND NOT ('read' = ANY(scopes));

UPDATE public.alexa_oauth_codes
SET scope = 'read control'
WHERE used_at IS NULL
  AND (scope IS NULL OR scope NOT LIKE '%read%');