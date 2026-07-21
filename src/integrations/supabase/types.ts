export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_commands: {
        Row: {
          completed_at: string | null
          created_at: string
          delivered_at: string | null
          device_id: string
          id: string
          kind: string
          payload: Json
          result: Json | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          device_id: string
          id?: string
          kind: string
          payload?: Json
          result?: Json | null
          source?: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          device_id?: string
          id?: string
          kind?: string
          payload?: Json
          result?: Json | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      alexa_oauth_clients: {
        Row: {
          client_id: string
          client_secret_hash: string
          created_at: string
          device_id: string | null
          id: string
          last_used_at: string | null
          name: string
          redirect_uris: string[]
          scopes: string[]
          user_id: string
        }
        Insert: {
          client_id: string
          client_secret_hash: string
          created_at?: string
          device_id?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          redirect_uris?: string[]
          scopes?: string[]
          user_id: string
        }
        Update: {
          client_id?: string
          client_secret_hash?: string
          created_at?: string
          device_id?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          redirect_uris?: string[]
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alexa_oauth_clients_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      alexa_oauth_codes: {
        Row: {
          client_id: string
          code_hash: string
          created_at: string
          device_id: string | null
          expires_at: string
          redirect_uri: string
          scope: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          client_id: string
          code_hash: string
          created_at?: string
          device_id?: string | null
          expires_at: string
          redirect_uri: string
          scope?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          client_id?: string
          code_hash?: string
          created_at?: string
          device_id?: string | null
          expires_at?: string
          redirect_uri?: string
          scope?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      anomaly_baselines: {
        Row: {
          device_id: string
          mean: number
          metric: string
          sample_count: number
          stddev: number
          updated_at: string
          window_days: number
        }
        Insert: {
          device_id: string
          mean: number
          metric: string
          sample_count: number
          stddev: number
          updated_at?: string
          window_days?: number
        }
        Update: {
          device_id?: string
          mean?: number
          metric?: string
          sample_count?: number
          stddev?: number
          updated_at?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_baselines_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      appliance_profiles: {
        Row: {
          created_at: string
          device_id: string
          id: string
          idle_after_min: number
          idle_watts: number
          match_component: string | null
          min_runtime_min: number
          min_watts: number
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          idle_after_min?: number
          idle_watts?: number
          match_component?: string | null
          min_runtime_min?: number
          min_watts?: number
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          idle_after_min?: number
          idle_watts?: number
          match_component?: string | null
          min_runtime_min?: number
          min_watts?: number
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appliance_profiles_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_pairings: {
        Row: {
          claimed_at: string | null
          created_at: string
          device_id: string
          device_name: string
          device_token: string
          expires_at: string
          id: string
          nonce_hash: string
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          device_id: string
          device_name: string
          device_token: string
          expires_at?: string
          id?: string
          nonce_hash: string
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          device_id?: string
          device_name?: string
          device_token?: string
          expires_at?: string
          id?: string
          nonce_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_pairings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_events: {
        Row: {
          component: string
          created_at: string
          device_id: string
          device_label: string
          id: string
          message: string | null
          metrics: Json
          occurred_at: string
          sample_count: number
          status: string
          strategy_applied: string | null
        }
        Insert: {
          component: string
          created_at?: string
          device_id: string
          device_label: string
          id?: string
          message?: string | null
          metrics?: Json
          occurred_at: string
          sample_count?: number
          status: string
          strategy_applied?: string | null
        }
        Update: {
          component?: string
          created_at?: string
          device_id?: string
          device_label?: string
          id?: string
          message?: string | null
          metrics?: Json
          occurred_at?: string
          sample_count?: number
          status?: string
          strategy_applied?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_events_daily: {
        Row: {
          avg_outside_temp: number | null
          criticals: number
          day: string
          device_id: string
          pump_cycles: number
          pump_kwh: number
          pump_minutes: number
          pv_covered_pct: number | null
          rain_mm: number | null
          updated_at: string
          warnings: number
        }
        Insert: {
          avg_outside_temp?: number | null
          criticals?: number
          day: string
          device_id: string
          pump_cycles?: number
          pump_kwh?: number
          pump_minutes?: number
          pv_covered_pct?: number | null
          rain_mm?: number | null
          updated_at?: string
          warnings?: number
        }
        Update: {
          avg_outside_temp?: number | null
          criticals?: number
          day?: string
          device_id?: string
          pump_cycles?: number
          pump_kwh?: number
          pump_minutes?: number
          pv_covered_pct?: number | null
          rain_mm?: number | null
          updated_at?: string
          warnings?: number
        }
        Relationships: [
          {
            foreignKeyName: "device_events_daily_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_events_hourly: {
        Row: {
          bucket: string
          component: string
          created_at: string
          device_id: string
          event_count: number
          pump_cycles: number | null
          pump_kwh: number | null
          pump_minutes: number | null
          pumping_allowed_ratio: number | null
          pv_surplus_avg: number | null
          rain_past_night_max: number | null
          rain_sum: number | null
          status: string
          temp_avg: number | null
          watts_avg: number | null
          watts_max: number | null
          watts_min: number | null
        }
        Insert: {
          bucket: string
          component: string
          created_at?: string
          device_id: string
          event_count?: number
          pump_cycles?: number | null
          pump_kwh?: number | null
          pump_minutes?: number | null
          pumping_allowed_ratio?: number | null
          pv_surplus_avg?: number | null
          rain_past_night_max?: number | null
          rain_sum?: number | null
          status: string
          temp_avg?: number | null
          watts_avg?: number | null
          watts_max?: number | null
          watts_min?: number | null
        }
        Update: {
          bucket?: string
          component?: string
          created_at?: string
          device_id?: string
          event_count?: number
          pump_cycles?: number | null
          pump_kwh?: number | null
          pump_minutes?: number | null
          pumping_allowed_ratio?: number | null
          pv_surplus_avg?: number | null
          rain_past_night_max?: number | null
          rain_sum?: number | null
          status?: string
          temp_avg?: number | null
          watts_avg?: number | null
          watts_max?: number | null
          watts_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "device_events_hourly_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_state_latest: {
        Row: {
          device_id: string
          last_alarm_at: string | null
          last_alarm_message: string | null
          last_alarm_status: string | null
          last_reason: string | null
          outside_temp_c: number | null
          pump_on: boolean
          pump_started_at: string | null
          pv_surplus_w: number | null
          rain_next_24h_mm: number | null
          strategy_applied: string | null
          updated_at: string
          watts_current: number | null
        }
        Insert: {
          device_id: string
          last_alarm_at?: string | null
          last_alarm_message?: string | null
          last_alarm_status?: string | null
          last_reason?: string | null
          outside_temp_c?: number | null
          pump_on?: boolean
          pump_started_at?: string | null
          pv_surplus_w?: number | null
          rain_next_24h_mm?: number | null
          strategy_applied?: string | null
          updated_at?: string
          watts_current?: number | null
        }
        Update: {
          device_id?: string
          last_alarm_at?: string | null
          last_alarm_message?: string | null
          last_alarm_status?: string | null
          last_reason?: string | null
          outside_temp_c?: number | null
          pump_on?: boolean
          pump_started_at?: string | null
          pv_surplus_w?: number | null
          rain_next_24h_mm?: number | null
          strategy_applied?: string | null
          updated_at?: string
          watts_current?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "device_state_latest_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          device_token_hash: string | null
          id: string
          last_seen_at: string | null
          last_snapshot: Json | null
          name: string
          pairing_code: string | null
          pairing_expires_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_token_hash?: string | null
          id?: string
          last_seen_at?: string | null
          last_snapshot?: Json | null
          name: string
          pairing_code?: string | null
          pairing_expires_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_token_hash?: string | null
          id?: string
          last_seen_at?: string | null
          last_snapshot?: Json | null
          name?: string
          pairing_code?: string | null
          pairing_expires_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mcp_audit: {
        Row: {
          created_at: string
          device_id: string | null
          error: string | null
          id: string
          latency_ms: number | null
          status: string
          token_id: string | null
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          error?: string | null
          id?: string
          latency_ms?: number | null
          status: string
          token_id?: string | null
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          error?: string | null
          id?: string
          latency_ms?: number | null
          status?: string
          token_id?: string | null
          tool?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_tokens: {
        Row: {
          created_at: string
          device_id: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          scopes: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          scopes?: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          scopes?: string[]
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tokens_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          telegram_bot_token: string | null
          telegram_bot_username: string | null
          telegram_chat_id: number | null
          telegram_link_code: string | null
          telegram_linked_at: string | null
          telegram_webhook_secret: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          telegram_bot_token?: string | null
          telegram_bot_username?: string | null
          telegram_chat_id?: number | null
          telegram_link_code?: string | null
          telegram_linked_at?: string | null
          telegram_webhook_secret?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          telegram_bot_token?: string | null
          telegram_bot_username?: string | null
          telegram_chat_id?: number | null
          telegram_link_code?: string | null
          telegram_linked_at?: string | null
          telegram_webhook_secret?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pump_sessions: {
        Row: {
          avg_watts: number | null
          created_at: string
          device_id: string
          duration_s: number
          id: string
          kwh: number | null
          pv_covered_pct: number | null
          reason: string | null
          started_at: string
          stopped_at: string
          trigger: string
        }
        Insert: {
          avg_watts?: number | null
          created_at?: string
          device_id: string
          duration_s: number
          id?: string
          kwh?: number | null
          pv_covered_pct?: number | null
          reason?: string | null
          started_at: string
          stopped_at: string
          trigger?: string
        }
        Update: {
          avg_watts?: number | null
          created_at?: string
          device_id?: string
          duration_s?: number
          id?: string
          kwh?: number | null
          pv_covered_pct?: number | null
          reason?: string | null
          started_at?: string
          stopped_at?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "pump_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_profiles: {
        Row: {
          created_at: string
          device_id: string
          eco_paused: boolean
          params: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          eco_paused?: boolean
          params?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          eco_paused?: boolean
          params?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_profiles_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_audit: {
        Row: {
          chat_id: number | null
          command: string
          created_at: string
          device_id: string | null
          id: string
          result: string | null
          user_id: string
        }
        Insert: {
          chat_id?: number | null
          command: string
          created_at?: string
          device_id?: string | null
          id?: string
          result?: string | null
          user_id: string
        }
        Update: {
          chat_id?: number | null
          command?: string
          created_at?: string
          device_id?: string | null
          id?: string
          result?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_audit_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aggregate_device_events:
        | { Args: never; Returns: undefined }
        | { Args: { _since?: string }; Returns: undefined }
      aggregate_device_events_daily:
        | { Args: never; Returns: undefined }
        | { Args: { _since?: string }; Returns: undefined }
      recompute_anomaly_baselines: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
