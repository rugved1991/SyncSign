/**
 * Auth — OAuth 2.0 implicit grant redirect flow.
 *
 * Why redirect instead of popup:
 *   Mobile browsers (Safari iOS, Chrome Android) block popups that aren't
 *   opened synchronously from a user gesture. GSI's One Tap and
 *   tokenClient.requestAccessToken() both open popups asynchronously,
 *   so they silently fail on mobile. A full-page redirect to Google's
 *   OAuth endpoint works on every browser, every device.
 *
 * Flow:
 *   1. User taps "Sign in" → initiateOAuthRedirect() navigates to Google
 *   2. Google redirects back to /controller#access_token=TOKEN&...
 *   3. checkOAuthReturn() parses the hash, returns the token
 *   4. fetchUserInfo() gets uid/email/name from Google's userinfo endpoint
 *   5. storeSession() persists to sessionStorage
 */

const TOKEN_KEY = 'syncsign_access_token'
const UID_KEY   = 'syncsign_uid'
const EMAIL_KEY = 'syncsign_email'
const NAME_KEY  = 'syncsign_name'

// Include drive.readonly upfront so the Picker can browse all folders
// without needing a second OAuth round-trip.
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ')

/**
 * Redirect the browser to Google's OAuth consent screen.
 * Stores any pending ?pair= value so it survives the redirect.
 */
export function initiateOAuthRedirect(clientId) {
  // Preserve pending pairing ID through the redirect
  const pendingPair = new URLSearchParams(window.location.search).get('pair')
  if (pendingPair) sessionStorage.setItem('syncsign_pending_pair', pendingPair)

  const redirectUri = window.location.origin + '/controller'
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: SCOPES,
    include_granted_scopes: 'true',
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/**
 * Call once on page load. If returning from an OAuth redirect, parses the
 * access token from the URL hash, cleans the hash, and returns the token.
 * Returns null if this is not an OAuth return.
 */
export function checkOAuthReturn() {
  const hash = window.location.hash.slice(1)
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const accessToken = params.get('access_token')
  if (!accessToken) return null
  // Remove the hash so refresh doesn't re-process it
  window.history.replaceState({}, '', window.location.pathname + window.location.search)
  return accessToken
}

/**
 * Fetch the signed-in user's profile from Google's userinfo endpoint.
 * Returns { sub, email, name }.
 */
export async function fetchUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to fetch user info')
  return res.json()
}

/**
 * Persist session to sessionStorage.
 * Access token is never written to localStorage or transmitted to any server.
 */
export function storeSession(uid, email, name, accessToken) {
  sessionStorage.setItem(TOKEN_KEY, accessToken)
  sessionStorage.setItem(UID_KEY, uid)
  sessionStorage.setItem(EMAIL_KEY, email)
  sessionStorage.setItem(NAME_KEY, name)
}

/**
 * Return the current session if one exists in sessionStorage, null otherwise.
 */
export function getStoredSession() {
  const uid = sessionStorage.getItem(UID_KEY)
  const accessToken = sessionStorage.getItem(TOKEN_KEY)
  if (!uid || !accessToken) return null
  return {
    uid,
    email: sessionStorage.getItem(EMAIL_KEY),
    name: sessionStorage.getItem(NAME_KEY),
    accessToken,
  }
}

/**
 * Sign out — clear all session data from sessionStorage.
 */
export function signOut() {
  [TOKEN_KEY, UID_KEY, EMAIL_KEY, NAME_KEY].forEach(k => sessionStorage.removeItem(k))
}
