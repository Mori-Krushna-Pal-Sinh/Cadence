import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Auth simply won't work until these are set — the rest of Cadence (local-first
  // planner + habit tracker) is unaffected, since nothing else imports this module.
  console.warn('Supabase environment variables are missing — sign-in is disabled until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.')
}

export const supabase = createClient(url ?? '', anonKey ?? '')
