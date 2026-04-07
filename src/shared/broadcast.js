/**
 * BroadcastChannel wrapper — same-network fast path.
 * Controller pushes state locally via BroadcastChannel AND to Firebase.
 * Display listens to both; Firebase is always the source of truth.
 */

const CHANNEL = 'syncsign'
let bc = null

function getChannel() {
  if (!bc) bc = new BroadcastChannel(CHANNEL)
  return bc
}

/**
 * Send state over BroadcastChannel (display pages on the same device/network
 * receive this instantly, before Firebase propagates).
 */
export function broadcastState(state) {
  try {
    getChannel().postMessage({ type: 'state', payload: state })
  } catch (e) {
    // BroadcastChannel not available in some embedded contexts — safe to ignore
  }
}

/**
 * Listen for state broadcasts. Returns an unsubscribe function.
 */
export function onBroadcastState(callback) {
  const channel = getChannel()
  const handler = (e) => {
    if (e.data && e.data.type === 'state') {
      callback(e.data.payload)
    }
  }
  channel.addEventListener('message', handler)
  return () => channel.removeEventListener('message', handler)
}
