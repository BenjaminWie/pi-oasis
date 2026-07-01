ALTER TABLE public.agent_commands DROP CONSTRAINT IF EXISTS agent_commands_kind_check;
ALTER TABLE public.agent_commands ADD CONSTRAINT agent_commands_kind_check
  CHECK (kind = ANY (ARRAY[
    'status','container_action','mqtt_publish','mqtt_subscribe',
    'terminal','system_reboot',
    'plugin_list','plugin_get','plugin_create','plugin_update','plugin_delete',
    'plugin_run_planner','plugin_manual','plugin_eco_pause'
  ]));