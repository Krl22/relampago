export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'staff' | 'courier' | 'client'
export type OrderStatus = 'pending' | 'in_transit' | 'delivered'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          role: UserRole
          company_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          role?: UserRole
          company_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          role?: UserRole
          company_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      companies: {
        Row: {
          id: string
          name: string
          ruc: string | null
          address: string | null
          district: string | null
          phone: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          ruc?: string | null
          address?: string | null
          district?: string | null
          phone?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          ruc?: string | null
          address?: string | null
          district?: string | null
          phone?: string | null
          created_at?: string
        }
      }
      orders: {
        Row: {
          id: string
          company_id: string | null
          sender_name: string | null
          assigned_courier: string | null
          created_by: string | null
          status: OrderStatus
          destination_address: string
          destination_district: string | null
          recipient_name: string
          recipient_phone: string
          packages_count: number | null
          amount_to_collect: number | null
          product_details: string | null
          comments: string | null
          payment_method: string | null
          tariff: string | null
          total_amount: number | null
          delivery_notes: string | null
          delivered_at: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          company_id?: string | null
          sender_name?: string | null
          assigned_courier?: string | null
          created_by?: string | null
          status?: OrderStatus
          destination_address: string
          destination_district?: string | null
          recipient_name: string
          recipient_phone: string
          packages_count?: number | null
          amount_to_collect?: number | null
          product_details?: string | null
          comments?: string | null
          payment_method?: string | null
          tariff?: string | null
          total_amount?: number | null
          delivery_notes?: string | null
          delivered_at?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          company_id?: string | null
          sender_name?: string | null
          assigned_courier?: string | null
          created_by?: string | null
          status?: OrderStatus
          destination_address?: string
          destination_district?: string | null
          recipient_name?: string
          recipient_phone?: string
          packages_count?: number | null
          amount_to_collect?: number | null
          product_details?: string | null
          comments?: string | null
          payment_method?: string | null
          tariff?: string | null
          total_amount?: number | null
          delivery_notes?: string | null
          delivered_at?: string | null
          created_at?: string
          updated_at?: string | null
        }
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_name: string
          quantity: number
        }
        Insert: {
          id?: string
          order_id: string
          product_name: string
          quantity: number
        }
        Update: {
          id?: string
          order_id?: string
          product_name?: string
          quantity?: number
        }
      }
      stock: {
        Row: {
          id: string
          company_id: string
          product_name: string
          quantity: number
          unit: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          product_name: string
          quantity: number
          unit?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          product_name?: string
          quantity?: number
          unit?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      deliveries: {
        Row: {
          id: string
          order_id: string
          courier_id: string
          proof_image_url: string | null
          delivered_at: string | null
        }
        Insert: {
          id?: string
          order_id: string
          courier_id: string
          proof_image_url?: string | null
          delivered_at?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          courier_id?: string
          proof_image_url?: string | null
          delivered_at?: string | null
        }
      }
    }
  }
}
