// Generado con: supabase gen types typescript --linked --schema public
// No editar a mano: regenerar tras cada migración (ver README). Los alias del final sí son manuales.
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
      announcements: {
        Row: {
          active: boolean
          body: string
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          title: string
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          title: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string | null
          district: string | null
          email: string | null
          id: string
          intake_token: string
          invoice_igv: boolean
          name: string
          phone: string | null
          registered_by: string | null
          ruc: string | null
          skip_cutoff: boolean
          t1_rate: number | null
          yape_holder: string | null
          yape_number: string | null
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string | null
          district?: string | null
          email?: string | null
          id?: string
          intake_token?: string
          invoice_igv?: boolean
          name: string
          phone?: string | null
          registered_by?: string | null
          ruc?: string | null
          skip_cutoff?: boolean
          t1_rate?: number | null
          yape_holder?: string | null
          yape_number?: string | null
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string | null
          district?: string | null
          email?: string | null
          id?: string
          intake_token?: string
          invoice_igv?: boolean
          name?: string
          phone?: string | null
          registered_by?: string | null
          ruc?: string | null
          skip_cutoff?: boolean
          t1_rate?: number | null
          yape_holder?: string | null
          yape_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_district_fkey"
            columns: ["district"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "companies_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_addresses: {
        Row: {
          address: string
          company_id: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          district: string | null
          id: string
          is_default: boolean
          label: string | null
          lat: number | null
          lng: number | null
          notes: string | null
        }
        Insert: {
          address: string
          company_id: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          district?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
        }
        Update: {
          address?: string
          company_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          district?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_addresses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_addresses_district_fkey"
            columns: ["district"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["name"]
          },
        ]
      }
      courier_location_history: {
        Row: {
          accuracy: number | null
          courier_id: string
          heading: number | null
          id: number
          lat: number
          lng: number
          recorded_at: string
          speed: number | null
        }
        Insert: {
          accuracy?: number | null
          courier_id: string
          heading?: number | null
          id?: never
          lat: number
          lng: number
          recorded_at?: string
          speed?: number | null
        }
        Update: {
          accuracy?: number | null
          courier_id?: string
          heading?: number | null
          id?: never
          lat?: number
          lng?: number
          recorded_at?: string
          speed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_location_history_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_locations: {
        Row: {
          accuracy: number | null
          courier_id: string
          heading: number | null
          lat: number
          lng: number
          recorded_at: string
          speed: number | null
          updated_at: string
        }
        Insert: {
          accuracy?: number | null
          courier_id: string
          heading?: number | null
          lat: number
          lng: number
          recorded_at?: string
          speed?: number | null
          updated_at?: string
        }
        Update: {
          accuracy?: number | null
          courier_id?: string
          heading?: number | null
          lat?: number
          lng?: number
          recorded_at?: string
          speed?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_locations_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          courier_id: string | null
          delivered_at: string | null
          id: string
          order_id: string
          proof_image_url: string | null
        }
        Insert: {
          courier_id?: string | null
          delivered_at?: string | null
          id?: string
          order_id: string
          proof_image_url?: string | null
        }
        Update: {
          courier_id?: string | null
          delivered_at?: string | null
          id?: string
          order_id?: string
          proof_image_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      districts: {
        Row: {
          active: boolean
          aliases: string[]
          kind: string
          name: string
          prices: number[]
          sort_order: number
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          kind?: string
          name: string
          prices: number[]
          sort_order?: number
        }
        Update: {
          active?: boolean
          aliases?: string[]
          kind?: string
          name?: string
          prices?: number[]
          sort_order?: number
        }
        Relationships: []
      }
      impersonation_log: {
        Row: {
          admin_id: string | null
          ended_at: string | null
          id: string
          started_at: string
          target_id: string | null
          target_role: Database["public"]["Enums"]["user_role"] | null
        }
        Insert: {
          admin_id?: string | null
          ended_at?: string | null
          id?: string
          started_at?: string
          target_id?: string | null
          target_role?: Database["public"]["Enums"]["user_role"] | null
        }
        Update: {
          admin_id?: string | null
          ended_at?: string | null
          id?: string
          started_at?: string
          target_id?: string | null
          target_role?: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_log_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_id: string | null
          courier_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: number
          lat: number | null
          lng: number | null
          order_id: string
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          courier_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: never
          lat?: number | null
          lng?: number | null
          order_id: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          courier_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: never
          lat?: number | null
          lng?: number | null
          order_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_name: string
          quantity: number
          stock_id: string | null
        }
        Insert: {
          id?: string
          order_id: string
          product_name: string
          quantity: number
          stock_id?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          product_name?: string
          quantity?: number
          stock_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          agency_destination: string | null
          agency_name: string | null
          amount_collected: number | null
          amount_to_collect: number | null
          assigned_courier: string | null
          call_before: boolean
          comments: string | null
          company_id: string | null
          created_at: string | null
          created_by: string | null
          deliver_after: string | null
          deliver_before: string | null
          delivered_at: string | null
          delivery_notes: string | null
          destination_address: string
          destination_approx: boolean
          destination_district: string
          destination_lat: number | null
          destination_lng: number | null
          district: string | null
          id: string
          order_number: number
          origin_type: Database["public"]["Enums"]["origin_type"]
          packages_count: number | null
          payment_method: string | null
          pickup_id: string | null
          product_details: string | null
          recipient_dni: string | null
          recipient_name: string | null
          recipient_payment: Database["public"]["Enums"]["payment_form"]
          recipient_phone: string | null
          scheduled_date: string
          sender_email: string | null
          sender_name: string | null
          service_type: Database["public"]["Enums"]["service_type"]
          settlement_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          surcharge: number
          tariff: string | null
          tariff_zone: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          agency_destination?: string | null
          agency_name?: string | null
          amount_collected?: number | null
          amount_to_collect?: number | null
          assigned_courier?: string | null
          call_before?: boolean
          comments?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deliver_after?: string | null
          deliver_before?: string | null
          delivered_at?: string | null
          delivery_notes?: string | null
          destination_address: string
          destination_approx?: boolean
          destination_district: string
          destination_lat?: number | null
          destination_lng?: number | null
          district?: string | null
          id?: string
          order_number?: number
          origin_type?: Database["public"]["Enums"]["origin_type"]
          packages_count?: number | null
          payment_method?: string | null
          pickup_id?: string | null
          product_details?: string | null
          recipient_dni?: string | null
          recipient_name?: string | null
          recipient_payment?: Database["public"]["Enums"]["payment_form"]
          recipient_phone?: string | null
          scheduled_date?: string
          sender_email?: string | null
          sender_name?: string | null
          service_type?: Database["public"]["Enums"]["service_type"]
          settlement_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          surcharge?: number
          tariff?: string | null
          tariff_zone?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          agency_destination?: string | null
          agency_name?: string | null
          amount_collected?: number | null
          amount_to_collect?: number | null
          assigned_courier?: string | null
          call_before?: boolean
          comments?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deliver_after?: string | null
          deliver_before?: string | null
          delivered_at?: string | null
          delivery_notes?: string | null
          destination_address?: string
          destination_approx?: boolean
          destination_district?: string
          destination_lat?: number | null
          destination_lng?: number | null
          district?: string | null
          id?: string
          order_number?: number
          origin_type?: Database["public"]["Enums"]["origin_type"]
          packages_count?: number | null
          payment_method?: string | null
          pickup_id?: string | null
          product_details?: string | null
          recipient_dni?: string | null
          recipient_name?: string | null
          recipient_payment?: Database["public"]["Enums"]["payment_form"]
          recipient_phone?: string | null
          scheduled_date?: string
          sender_email?: string | null
          sender_name?: string | null
          service_type?: Database["public"]["Enums"]["service_type"]
          settlement_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          surcharge?: number
          tariff?: string | null
          tariff_zone?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_assigned_courier_fkey"
            columns: ["assigned_courier"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_destination_district_fkey"
            columns: ["destination_district"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "orders_pickup_id_fkey"
            columns: ["pickup_id"]
            isOneToOne: false
            referencedRelation: "pickups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_assignments: {
        Row: {
          assigned_at: string
          courier_id: string
          packages_count: number | null
          picked_up_at: string | null
          pickup_id: string
        }
        Insert: {
          assigned_at?: string
          courier_id: string
          packages_count?: number | null
          picked_up_at?: string | null
          pickup_id: string
        }
        Update: {
          assigned_at?: string
          courier_id?: string
          packages_count?: number | null
          picked_up_at?: string | null
          pickup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_assignments_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_assignments_pickup_id_fkey"
            columns: ["pickup_id"]
            isOneToOne: false
            referencedRelation: "pickups"
            referencedColumns: ["id"]
          },
        ]
      }
      pickups: {
        Row: {
          address: string
          company_address_id: string | null
          company_id: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          district: string | null
          id: string
          lat: number | null
          legacy_courier_name: string | null
          lng: number | null
          notes: string | null
          packages_count: number | null
          pickup_after: string | null
          pickup_before: string | null
          pickup_number: number
          scheduled_date: string
          status: Database["public"]["Enums"]["pickup_status"]
          updated_at: string
        }
        Insert: {
          address: string
          company_address_id?: string | null
          company_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          id?: string
          lat?: number | null
          legacy_courier_name?: string | null
          lng?: number | null
          notes?: string | null
          packages_count?: number | null
          pickup_after?: string | null
          pickup_before?: string | null
          pickup_number?: never
          scheduled_date?: string
          status?: Database["public"]["Enums"]["pickup_status"]
          updated_at?: string
        }
        Update: {
          address?: string
          company_address_id?: string | null
          company_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          id?: string
          lat?: number | null
          legacy_courier_name?: string | null
          lng?: number | null
          notes?: string | null
          packages_count?: number | null
          pickup_after?: string | null
          pickup_before?: string | null
          pickup_number?: never
          scheduled_date?: string
          status?: Database["public"]["Enums"]["pickup_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickups_company_address_id_fkey"
            columns: ["company_address_id"]
            isOneToOne: false
            referencedRelation: "company_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickups_district_fkey"
            columns: ["district"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["name"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          is_courier: boolean
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_courier?: boolean
          role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_courier?: boolean
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          balance: number
          collected: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          orders_count: number
          paid_at: string | null
          paid_reference: string | null
          period_from: string
          period_to: string
          service: number
          settlement_number: number
        }
        Insert: {
          balance?: number
          collected?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          orders_count?: number
          paid_at?: string | null
          paid_reference?: string | null
          period_from: string
          period_to: string
          service?: number
          settlement_number?: never
        }
        Update: {
          balance?: number
          collected?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          orders_count?: number
          paid_at?: string | null
          paid_reference?: string | null
          period_from?: string
          period_to?: string
          service?: number
          settlement_number?: never
        }
        Relationships: [
          {
            foreignKeyName: "settlements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          product_name: string
          quantity: number
          unit: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          product_name: string
          quantity?: number
          unit?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          product_name?: string
          quantity?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          delta: number
          id: string
          order_id: string | null
          quantity_after: number
          reason: string
          stock_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          order_id?: string | null
          quantity_after: number
          reason: string
          stock_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          order_id?: string | null
          quantity_after?: number
          reason?: string
          stock_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      stock_availability: {
        Row: {
          available: number | null
          company_id: string | null
          created_at: string | null
          id: string | null
          product_name: string | null
          quantity: number | null
          reserved: number | null
          unit: string | null
        }
        Insert: {
          available?: never
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          product_name?: string | null
          quantity?: number | null
          reserved?: never
          unit?: string | null
        }
        Update: {
          available?: never
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          product_name?: string | null
          quantity?: number | null
          reserved?: never
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      canonical_district: { Args: { p: string }; Returns: string }
      company_activity: {
        Args: never
        Returns: {
          accounts: number
          company_id: string
          last_order_at: string
          orders_30d: number
        }[]
      }
      company_addresses_by_name: { Args: { p_name: string }; Returns: Json }
      courier_serves_company: { Args: { p_company: string }; Returns: boolean }
      district_key: { Args: { p: string }; Returns: string }
      intake_context: { Args: { p_token: string }; Returns: Json }
      is_staff: { Args: never; Returns: boolean }
      my_company_id: { Args: never; Returns: string }
      next_business_day: { Args: { d: string }; Returns: string }
      public_form_open: { Args: never; Returns: boolean }
      register_my_company: { Args: { p: Json }; Returns: string }
      schedule_date_for: {
        Args: { p_at?: string; p_origin: string; p_skip_cutoff: boolean }
        Returns: string
      }
      search_company_names: { Args: { p_q: string }; Returns: string[] }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stock_reserved: { Args: { p_stock: string }; Returns: number }
      submit_order: { Args: { p: Json }; Returns: Json }
      submit_orders_bulk: { Args: { p_items: Json }; Returns: Json }
      tariff_from_district: { Args: { p_district: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
      update_my_company: { Args: { p: Json }; Returns: undefined }
    }
    Enums: {
      order_status:
        | "pending"
        | "in_transit"
        | "delivered"
        | "picked_up"
        | "failed"
        | "cancelled"
      origin_type: "warehouse" | "pickup"
      payment_form: "none" | "cash" | "yape" | "plin"
      pickup_status:
        | "pending"
        | "assigned"
        | "picked_up"
        | "failed"
        | "cancelled"
      service_type: "delivery" | "exchange" | "return" | "agency"
      user_role: "client" | "staff" | "courier" | "admin"
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
  public: {
    Enums: {
      order_status: [
        "pending",
        "in_transit",
        "delivered",
        "picked_up",
        "failed",
        "cancelled",
      ],
      origin_type: ["warehouse", "pickup"],
      payment_form: ["none", "cash", "yape", "plin"],
      pickup_status: [
        "pending",
        "assigned",
        "picked_up",
        "failed",
        "cancelled",
      ],
      service_type: ["delivery", "exchange", "return", "agency"],
      user_role: ["client", "staff", "courier", "admin"],
    },
  },
} as const

// ---------------------------------------------------------------------------
// Alias manuales usados por la app (mantener al regenerar)
// ---------------------------------------------------------------------------
export type UserRole = Database["public"]["Enums"]["user_role"]
export type OrderStatus = Database["public"]["Enums"]["order_status"]
export type OrderEventType = "created" | "status_change" | "assigned"
export type OriginType = Database["public"]["Enums"]["origin_type"]
export type ServiceType = Database["public"]["Enums"]["service_type"]
export type PaymentForm = Database["public"]["Enums"]["payment_form"]
export type PickupStatus = Database["public"]["Enums"]["pickup_status"]
