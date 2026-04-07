/**
 * Google Identity Services (GSI) auth helpers.
 * Scopes: openid, email, drive.file
 * Tokens stored in sessionStorage only — never transmitted to any server.
 */

const TOKEN_KEY = 'syncsign_access_token'
const UID_KEY = 'syncsign_uid'
const EMAIL_KEY = 'syncsign_email'
const NAME_KEY = 'syncsign_name'

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

let tokenClient = null
let tokenClientId = null

/**
 * Load the GSI script dynamically.
 */
function loadGSIScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve()
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

/**
 * Initialize the OAuth token client (for Drive access token).
 * Must be called after GSI script loads.
 */
function initTokenClient(clientId, callback) {
  tokenClientId = clientId
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback,
  })
}

/**
 * Request an additional OAuth scope incrementally (e.g. drive.readonly).
 * Call after the initial sign-in. Shows a consent popup only if the scope
 * hasn't been granted yet.
 */
export async function requestAdditionalScope(scope) {
  await loadGSIScript()
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: tokenClientId,
      scope,
      callback: (response) => {
        if (response.error) return reject(new Error(response.error))
        sessionStorage.setItem(TOKEN_KEY, response.access_token)
        resolve(response.access_token)
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

/**
 * Decode a JWT without verifying — safe because we only use the payload
 * for the UID (sub claim). Firebase verifies the token on its side.
 */
function decodeJWT(token) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT')
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
  return payload
}

/**
 * Full sign-in flow:
 * 1. Show Google One Tap (or fallback to token client popup)
 * 2. Decode the ID token to extract uid, email, name
 * 3. Request an access token for Drive API
 * 4. Call onSuccess({ uid, email, name, idToken, accessToken })
 *
 * @param {string} clientId - Google OAuth client ID
 * @param {function} onSuccess - called with user info on success
 * @param {function} onError - called with Error on failure
 */
export async function signIn(clientId, onSuccess, onError) {
  try {
    await loadGSIScript()

    // Step 1: Get ID token via One Tap / popup
    const idToken = await getIdToken(clientId)
    const payload = decodeJWT(idToken)
    const uid = payload.sub
    const email = payload.email
    const name = payload.name || email

    // Step 2: Request Drive access token
    await new Promise((resolve, reject) => {
      initTokenClient(clientId, (response) => {
        if (response.error) return reject(new Error(response.error))
        sessionStorage.setItem(TOKEN_KEY, response.access_token)
        resolve()
      })
      tokenClient.requestAccessToken({ prompt: '' })
    })

    // Persist session info
    sessionStorage.setItem(UID_KEY, uid)
    sessionStorage.setItem(EMAIL_KEY, email)
    sessionStorage.setItem(NAME_KEY, name)

    onSuccess({ uid, email, name, idToken, accessToken: sessionStorage.getItem(TOKEN_KEY) })
  } catch (err) {
    onError(err)
  }
}

/**
 * Get an ID token using Google One Tap.
 * Falls back gracefully if One Tap is not available.
 */
function getIdToken(clientId) {
  return new Promise((resolve, reject) => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response.credential) resolve(response.credential)
        else reject(new Error('No credential returned'))
      },
      auto_select: true,
      cancel_on_tap_outside: false,
    })

    // Try One Tap first; if not shown (e.g. user dismissed before), prompt manually
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // Render a regular sign-in button as fallback
        renderSignInButton(clientId, resolve, reject)
      }
    })
  })
}

/**
 * Render a Google Sign-In button as fallback for One Tap.
 */
function renderSignInButton(clientId, resolve, reject) {
  const container = document.getElementById('g_id_signin')
  if (!container) return reject(new Error('No sign-in button container found'))
  window.google.accounts.id.renderButton(container, {
    theme: 'outline',
    size: 'large',
    width: 280,
    text: 'sign_in_with',
  })
}

/**
 * Check if the user has an active session (token in sessionStorage).
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
 * Sign out — clear sessionStorage.
 */
export function signOut() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(UID_KEY)
  sessionStorage.removeItem(EMAIL_KEY)
  sessionStorage.removeItem(NAME_KEY)
}
