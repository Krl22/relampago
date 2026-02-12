import { createClient } from '@supabase/supabase-js'
// import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Note: During initial setup, these might be undefined.
// We handle this gracefully to avoid crashing the app immediately,
// but Supabase calls will fail until they are set.
export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || ''
)
