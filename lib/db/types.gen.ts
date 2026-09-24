export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_kind: string
          actor_user_id: string | null
          created_at: string
          detail: Json
          event_id: string | null
          id: number
          subject_id: string | null
        }
        Insert: {
          action: string
          actor_kind: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string | null
          id?: never
          subject_id?: string | null
        }
        Update: {
          action?: string
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string | null
          id?: never
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      checkpoints: {
        Row: {
          capacity: number | null
          event_id: string
          id: string
          is_open: boolean
          kind: Database["public"]["Enums"]["checkpoint_kind"]
          name: string
          requires_checkin: boolean
          sort_order: number
          starts_at: string | null
        }
        Insert: {
          capacity?: number | null
          event_id: string
          id?: string
          is_open?: boolean
          kind: Database["public"]["Enums"]["checkpoint_kind"]
          name: string
          requires_checkin?: boolean
          sort_order?: number
          starts_at?: string | null
        }
        Update: {
          capacity?: number | null
          event_id?: string
          id?: string
          is_open?: boolean
          kind?: Database["public"]["Enums"]["checkpoint_kind"]
          name?: string
          requires_checkin?: boolean
          sort_order?: number
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkpoints_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_until: string | null
          next_attempt_at: string
          participant_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["outbox_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          participant_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          participant_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_staff: {
        Row: {
          added_at: string
          event_id: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Insert: {
          added_at?: string
          event_id: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Update: {
          added_at?: string
          event_id?: string
          role?: Database["public"]["Enums"]["staff_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_staff_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          name: string
          sheet_id: string | null
          slug: string
          starts_at: string
          timezone: string
          venue: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          name: string
          sheet_id?: string | null
          slug: string
          starts_at: string
          timezone?: string
          venue: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          name?: string
          sheet_id?: string | null
          slug?: string
          starts_at?: string
          timezone?: string
          venue?: string
        }
        Relationships: []
      }
      participants: {
        Row: {
          created_at: string
          deleted_at: string | null
          dietary_notes: string | null
          email: string
          event_id: string
          external_id: string | null
          first_name: string
          id: string
          is_test: boolean
          last_name: string
          linkedin_url: string | null
          photo_path: string | null
          photo_updated_at: string | null
          search_text: string
          source: string
          status: Database["public"]["Enums"]["participant_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          dietary_notes?: string | null
          email: string
          event_id: string
          external_id?: string | null
          first_name: string
          id?: string
          is_test?: boolean
          last_name?: string
          linkedin_url?: string | null
          photo_path?: string | null
          photo_updated_at?: string | null
          search_text: string
          source: string
          status: Database["public"]["Enums"]["participant_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          dietary_notes?: string | null
          email?: string
          event_id?: string
          external_id?: string | null
          first_name?: string
          id?: string
          is_test?: boolean
          last_name?: string
          linkedin_url?: string | null
          photo_path?: string | null
          photo_updated_at?: string | null
          search_text?: string
          source?: string
          status?: Database["public"]["Enums"]["participant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      passes: {
        Row: {
          id: string
          issued_at: string
          participant_id: string
          revoke_reason: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          id?: string
          issued_at?: string
          participant_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          id?: string
          issued_at?: string
          participant_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "passes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        Insert: {
          hits?: number
          key: string
          window_start: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      scan_attempts: {
        Row: {
          checkpoint_id: string | null
          created_at: string
          event_id: string | null
          id: number
          latency_ms: number | null
          participant_id: string | null
          result_code: string
          staff_user_id: string | null
        }
        Insert: {
          checkpoint_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: never
          latency_ms?: number | null
          participant_id?: string | null
          result_code: string
          staff_user_id?: string | null
        }
        Update: {
          checkpoint_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: never
          latency_ms?: number | null
          participant_id?: string | null
          result_code?: string
          staff_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_attempts_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      scans: {
        Row: {
          checkpoint_id: string
          client_scan_id: string
          client_scanned_at: string | null
          event_id: string
          id: string
          method: Database["public"]["Enums"]["scan_method"]
          participant_id: string
          pass_id: string | null
          scanned_at: string
          scanned_by: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          checkpoint_id: string
          client_scan_id: string
          client_scanned_at?: string | null
          event_id: string
          id?: string
          method: Database["public"]["Enums"]["scan_method"]
          participant_id: string
          pass_id?: string | null
          scanned_at?: string
          scanned_by: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          checkpoint_id?: string
          client_scan_id?: string
          client_scanned_at?: string | null
          event_id?: string
          id?: string
          method?: Database["public"]["Enums"]["scan_method"]
          participant_id?: string
          pass_id?: string | null
          scanned_at?: string
          scanned_by?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scans_checkpoint_id_event_id_fkey"
            columns: ["checkpoint_id", "event_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "scans_participant_id_event_id_fkey"
            columns: ["participant_id", "event_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "scans_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "passes"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invites: {
        Row: {
          email: string
          event_id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          email: string
          event_id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          email?: string
          event_id?: string
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          display_name: string
          user_id: string
        }
        Insert: {
          display_name: string
          user_id: string
        }
        Update: {
          display_name?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _prior: {
        Args: { me: string; s: Database["public"]["Tables"]["scans"]["Row"] }
        Returns: Json
      }
      _who: {
        Args: {
          k: Database["public"]["Enums"]["checkpoint_kind"]
          pa: Database["public"]["Tables"]["participants"]["Row"]
        }
        Returns: Json
      }
      issue_pass: {
        Args: { p_participant_id: string; p_token_hash: string }
        Returns: string
      }
      record_scan: {
        Args: {
          p_checkpoint_id: string
          p_client_scan_id: string
          p_client_scanned_at: string
          p_method: Database["public"]["Enums"]["scan_method"]
          p_participant_id: string
          p_staff_user_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      void_scan: {
        Args: { p_reason: string; p_scan_id: string; p_staff_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      checkpoint_kind: "door" | "meal" | "session" | "custom"
      outbox_status: "pending" | "sending" | "sent" | "failed" | "cancelled"
      participant_status:
        | "pending"
        | "accepted"
        | "waitlisted"
        | "rejected"
        | "withdrawn"
      scan_method: "qr" | "manual"
      staff_role: "organizer" | "volunteer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      checkpoint_kind: ["door", "meal", "session", "custom"],
      outbox_status: ["pending", "sending", "sent", "failed", "cancelled"],
      participant_status: [
        "pending",
        "accepted",
        "waitlisted",
        "rejected",
        "withdrawn",
      ],
      scan_method: ["qr", "manual"],
      staff_role: ["organizer", "volunteer"],
    },
  },
} as const

