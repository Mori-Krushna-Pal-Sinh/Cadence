import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

interface AuthState {
  status: AuthStatus
  userId: string | null
  email: string | null
}

export const useAuth = create<AuthState>(() => ({ status: 'loading', userId: null, email: null }))

/**
 * Resolves once the initial session is known (or confirmed absent), and returns the
 * user id to load — or null for the signed-out/local namespace. Call this before
 * persist.startPersistence() and before the app renders, so the app never briefly
 * shows one account's data while auth is still resolving.
 *
 * Also subscribes to future auth changes (sign-in, sign-out, token refresh) so
 * `useAuth` stays live for the rest of the session.
 */
export async function initAuth(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user.id ?? null
  useAuth.setState({ status: userId ? 'signedIn' : 'signedOut', userId, email: session?.user.email ?? null })

  supabase.auth.onAuthStateChange((_event, session) => {
    const nextId = session?.user.id ?? null
    useAuth.setState({ status: nextId ? 'signedIn' : 'signedOut', userId: nextId, email: session?.user.email ?? null })
  })

  return userId
}

export async function signInWithGoogle() {
  await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } })
}

export async function signInWithMagicLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } })
  if (error) throw error
}

export async function signOut() {
  await supabase.auth.signOut()
}
