import { initializeApp } from 'firebase/app'
import { getDatabase, ref, set, onValue, onDisconnect } from 'firebase/database'
import { getAuth, signInWithCredential, GoogleAuthProvider, signInAnonymously } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
}

const app = initializeApp(firebaseConfig)
export const database = getDatabase(app)
export const auth = getAuth(app)

/**
 * Sign in to Firebase using a Google ID token (from GSI).
 * Required so the owner can write to their room.
 */
export async function firebaseSignInWithGoogle(idToken) {
  const credential = GoogleAuthProvider.credential(idToken)
  return signInWithCredential(auth, credential)
}

/**
 * Sign in anonymously — used by display TVs (read-only).
 */
export async function firebaseSignInAnonymously() {
  return signInAnonymously(auth)
}

/**
 * Write playlist state to rooms/{uid}/state
 */
export async function pushRoomState(uid, state) {
  const roomRef = ref(database, `rooms/${uid}/state`)
  return set(roomRef, { ...state, updated_at: Date.now() })
}

/**
 * Subscribe to rooms/{uid}/state — calls callback on every change.
 * Returns unsubscribe function.
 */
export function subscribeRoomState(uid, callback) {
  const roomRef = ref(database, `rooms/${uid}/state`)
  return onValue(roomRef, (snap) => callback(snap.val()))
}

/**
 * Register TV presence at rooms/{uid}/presence/{deviceId}
 */
export function registerPresence(uid, deviceId) {
  const presenceRef = ref(database, `rooms/${uid}/presence/${deviceId}`)
  set(presenceRef, { connectedAt: Date.now() })

  // Remove presence on disconnect
  onDisconnect(presenceRef).remove()
}

/**
 * Subscribe to connected TV count for a room.
 */
export function subscribePresenceCount(uid, callback) {
  const presenceRef = ref(database, `rooms/${uid}/presence`)
  return onValue(presenceRef, (snap) => {
    callback(snap.exists() ? Object.keys(snap.val()).length : 0)
  })
}

/**
 * Get Firebase server time offset (ms). Used for clock sync.
 */
export async function getServerTimeOffset() {
  const offsetRef = ref(database, '.info/serverTimeOffset')
  return new Promise((resolve) => {
    onValue(offsetRef, (snap) => resolve(snap.val() || 0), { onlyOnce: true })
  })
}

// ── Pairing ───────────────────────────────────────────────────────

/**
 * Write a pairing request from the display. The display advertises its
 * pairingId; the controller reads it and writes back the roomId.
 * Auto-removed on disconnect.
 */
export function registerPairingRequest(pairingId) {
  const pairRef = ref(database, `pairing/${pairingId}`)
  set(pairRef, { waiting: true, createdAt: Date.now() })
  onDisconnect(pairRef).remove()
}

/**
 * Listen for a roomId to be written to pairing/{pairingId}.
 * Calls callback(roomId) once when the controller pairs it.
 * Returns unsubscribe function.
 */
export function onPairingResolved(pairingId, callback) {
  const pairRef = ref(database, `pairing/${pairingId}`)
  return onValue(pairRef, (snap) => {
    const data = snap.val()
    if (data && data.roomId) callback(data.roomId)
  })
}

/**
 * Controller calls this to pair a display — writes the roomId to
 * pairing/{pairingId}, then removes it after 10s.
 */
export async function resolvePairing(pairingId, roomId) {
  const pairRef = ref(database, `pairing/${pairingId}`)
  await set(pairRef, { roomId, resolvedAt: Date.now() })
  setTimeout(() => set(pairRef, null), 10_000)
}
