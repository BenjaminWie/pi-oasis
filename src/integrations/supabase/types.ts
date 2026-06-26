export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agent_commands: {
        Row: {
          completed_at: string | null;
          created_at: string;
          delivered_at: string | null;
          device_id: string;
          id: string;
          kind: string;
          payload: Json;
          result: Json | null;
          source: string;
          status: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          device_id: string;
          id?: string;
          kind: string;
          payload?: Json;
          result?: Json | null;
          source?: string;
          status?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          device_id?: string;
          id?: string;
          kind?: string;
          payload?: Json;
          result?: Json | null;
          source?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_commands_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
      cloud_pairings: {
        Row: {
          claimed_at: string | null;
          created_at: string;
          device_id: string;
          device_name: string;
          device_token: string;
          expires_at: string;
          id: string;
          nonce_hash: string;
          user_id: string;
        };
        Insert: {
          claimed_at?: string | null;
          created_at?: string;
          device_id: string;
          device_name: string;
          device_token: string;
          expires_at?: string;
          id?: string;
          nonce_hash: string;
          user_id: string;
        };
        Update: {
          claimed_at?: string | null;
          created_at?: string;
          device_id?: string;
          device_name?: string;
          device_token?: string;
          expires_at?: string;
          id?: string;
          nonce_hash?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cloud_pairings_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
      device_events: {
        Row: {
          component: string;
          created_at: string;
          device_id: string;
          device_label: string;
          id: string;
          metrics: Json;
          occurred_at: string;
          status: string;
        };
        Insert: {
          component: string;
          created_at?: string;
          device_id: string;
          device_label: string;
          id?: string;
          metrics?: Json;
          occurred_at: string;
          status: string;
        };
        Update: {
          component?: string;
          created_at?: string;
          device_id?: string;
          device_label?: string;
          id?: string;
          metrics?: Json;
          occurred_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "device_events_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
      devices: {
        Row: {
          created_at: string;
          device_token_hash: string | null;
          id: string;
          last_seen_at: string | null;
          last_snapshot: Json | null;
          name: string;
          pairing_code: string | null;
          pairing_expires_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          device_token_hash?: string | null;
          id?: string;
          last_seen_at?: string | null;
          last_snapshot?: Json | null;
          name: string;
          pairing_code?: string | null;
          pairing_expires_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          device_token_hash?: string | null;
          id?: string;
          last_seen_at?: string | null;
          last_snapshot?: Json | null;
          name?: string;
          pairing_code?: string | null;
          pairing_expires_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          telegram_bot_token: string | null;
          telegram_bot_username: string | null;
          telegram_chat_id: number | null;
          telegram_link_code: string | null;
          telegram_linked_at: string | null;
          telegram_webhook_secret: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          telegram_bot_token?: string | null;
          telegram_bot_username?: string | null;
          telegram_chat_id?: number | null;
          telegram_link_code?: string | null;
          telegram_linked_at?: string | null;
          telegram_webhook_secret?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          telegram_bot_token?: string | null;
          telegram_bot_username?: string | null;
          telegram_chat_id?: number | null;
          telegram_link_code?: string | null;
          telegram_linked_at?: string | null;
          telegram_webhook_secret?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      telegram_audit: {
        Row: {
          chat_id: number | null;
          command: string;
          created_at: string;
          device_id: string | null;
          id: string;
          result: string | null;
          user_id: string;
        };
        Insert: {
          chat_id?: number | null;
          command: string;
          created_at?: string;
          device_id?: string | null;
          id?: string;
          result?: string | null;
          user_id: string;
        };
        Update: {
          chat_id?: number | null;
          command?: string;
          created_at?: string;
          device_id?: string | null;
          id?: string;
          result?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "telegram_audit_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
