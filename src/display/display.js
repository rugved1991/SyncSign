import { inject } from '@vercel/analytics'
import {
  firebaseSignInAnonymously,
  subscribeRoomState,
  registerPresence,
  getServerTimeOffset,
  registerPairingRequest,
  onPairingResolved,
  database,
} from '@shared/firebase.js'
import { onBroadcastState } from '@shared/broadcast.js'
import { scheduleNext } from '@shared/sync.js'
import { ref as dbRef, onValue } from 'firebase/database'

// Initialize Vercel Web Analytics
inject()

// ── Parse room ID from URL ────────────────────────────────────────
const params = new URLSearchParams(window.location.search)
let roomId = params.get('room') || ''

const CONTROLLER_URL = window.location.origin + '/controller'

// ── State ─────────────────────────────────────────────────────────
let currentState = null
let clockOffset = 0
let cancelSlide = null          // cancel function for current scheduleNext
let activeImg = 'a'             // which <img> is currently visible
let disconnectTimer = null
let wakeLock = null
let progressAnimation = null
let presenceRegistered = false

const imgA = document.getElementById('slide-a')
const imgB = document.getElementById('slide-b')
const overlay = document.getElementById('overlay')
const progressBar = document.getElementById('progress-bar')
const statusDot = document.getElementById('status-dot')

// ── Screen helpers ────────────────────────────────────────────────
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'))
  document.getElementById(id).classList.remove('hidden')
}

// ── Slide rendering ───────────────────────────────────────────────
function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = img.onerror = () => resolve()
    img.src = url
  })
}

async function showSlide(index) {
  if (!currentState || !currentState.playlist.length) return

  const playlist = currentState.playlist
  const item = playlist[index]
  const nextIndex = (index + 1) % playlist.length
  const nextItem = playlist[nextIndex]

  // Preload next image in background
  preloadImage(nextItem.url)

  const transition = currentState.transition || 'fade'
  const duration = currentState.interval_seconds * 1000

  if (transition === 'fade') {
    // Cross-fade: alternate between img-a and img-b
    if (activeImg === 'a') {
      imgB.src = item.url
      imgB.classList.remove('hidden')
      requestAnimationFrame(() => {
        imgA.classList.add('hidden')
      })
      activeImg = 'b'
    } else {
      imgA.src = item.url
      imgA.classList.remove('hidden')
      requestAnimationFrame(() => {
        imgB.classList.add('hidden')
      })
      activeImg = 'a'
    }
  } else {
    // Instant switch
    const front = activeImg === 'a' ? imgA : imgB
    front.src = item.url
    front.classList.remove('hidden')
    const back = activeImg === 'a' ? imgB : imgA
    back.classList.add('hidden')
  }

  // Update overlay
  const hasOverlay = item.title || item.description || item.price
  if (hasOverlay) {
    document.getElementById('overlay-title').textContent = item.title || ''
    document.getElementById('overlay-description').textContent = item.description || ''
    document.getElementById('overlay-price').textContent = item.price || ''
    overlay.classList.remove('hidden')
  } else {
    overlay.classList.add('hidden')
  }

  // Progress bar animation
  animateProgressBar(duration, clockOffset, currentState.interval_seconds)
}

function animateProgressBar(totalMs, clockOffset, intervalSeconds) {
  // Cancel any running animation
  if (progressAnimation) {
    progressAnimation.cancel()
    progressAnimation = null
  }

  const nowMs = Date.now() + clockOffset
  const intervalMs = intervalSeconds * 1000
  const elapsed = nowMs % intervalMs
  const remaining = intervalMs - elapsed
  const startPct = ((elapsed / intervalMs) * 100).toFixed(2)

  progressBar.style.transition = 'none'
  progressBar.style.width = `${startPct}%`

  // Force reflow then animate
  progressBar.getBoundingClientRect()
  progressBar.style.transition = `width ${remaining}ms linear`
  progressBar.style.width = '100%'

  // Reset after completion
  const t = setTimeout(() => {
    progressBar.style.transition = 'none'
    progressBar.style.width = '0%'
  }, remaining)

  progressAnimation = { cancel: () => clearTimeout(t) }
}

// ── Apply new state ───────────────────────────────────────────────
function applyState(state) {
  if (!state || !state.playlist || !state.playlist.length) return

  // Cancel previous cycle
  if (cancelSlide) { cancelSlide(); cancelSlide = null }

  currentState = state

  cancelSlide = scheduleNext(state, clockOffset, (index) => showSlide(index))

  // Persist state for offline use
  cacheState(state)
}

// ── Firebase connection monitoring ────────────────────────────────
function watchConnection() {
  const connRef = dbRef(database, '.info/connected')
  onValue(connRef, (snap) => {
    const connected = snap.val() === true
    statusDot.className = 'status-dot ' + (connected ? 'online' : 'offline')

    if (connected) {
      // Clear any pending reload timer
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null }
    } else {
      // Reload after 60s of disconnection
      disconnectTimer = setTimeout(() => {
        location.reload()
      }, 60_000)
    }
  })
}

// ── Wake lock ─────────────────────────────────────────────────────
async function requestWakeLock() {
  if (!navigator.wakeLock) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock()
})

// ── Service Worker registration ───────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {})
  }
}

// ── Cache state for offline use ───────────────────────────────────
async function cacheState(state) {
  try {
    const cache = await caches.open('syncsign-state-v1')
    const body = JSON.stringify(state)
    await cache.put('state', new Response(body, { headers: { 'Content-Type': 'application/json' } }))
  } catch {}
}

async function loadCachedState() {
  try {
    const cache = await caches.open('syncsign-state-v1')
    const res = await cache.match('state')
    if (!res) return null
    return await res.json()
  } catch {
    return null
  }
}

// ── Pairing screen ────────────────────────────────────────────────
async function showPairingScreen() {
  show('screen-pairing')

  // Stable pairing ID for this device session
  let pairingId = sessionStorage.getItem('syncsign_pairing_id')
  if (!pairingId) {
    pairingId = crypto.randomUUID()
    sessionStorage.setItem('syncsign_pairing_id', pairingId)
  }

  // Sign in anonymously so we can read/write Firebase
  await firebaseSignInAnonymously()

  // Advertise this pairing request in Firebase
  registerPairingRequest(pairingId)

  // Generate QR code pointing to the controller with the pairing ID
  const pairUrl = `${CONTROLLER_URL}?pair=${pairingId}`
  await renderPairingQR(pairUrl)

  // When the controller resolves the pairing, navigate to the display
  onPairingResolved(pairingId, (resolvedRoomId) => {
    roomId = resolvedRoomId
    const url = new URL(window.location)
    url.searchParams.set('room', roomId)
    window.history.replaceState({}, '', url)
    showFullscreenPrompt()
  })
}

function renderPairingQR(text) {
  return new Promise((resolve) => {
    const container = document.getElementById('pairing-qr')
    container.innerHTML = ''

    function doRender() {
      new window.QRCode(container, {
        text,
        width: 240,
        height: 240,
        colorDark: '#000',
        colorLight: '#fff',
        correctLevel: window.QRCode.CorrectLevel.M,
      })
      resolve()
    }

    if (window.QRCode) return doRender()
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
    script.onload = doRender
    script.onerror = resolve   // silently skip — URL still readable on screen
    document.head.appendChild(script)
  })
}

// ── Fullscreen prompt ─────────────────────────────────────────────
function showFullscreenPrompt() {
  show('screen-fullscreen')

  function handleTap() {
    document.documentElement.requestFullscreen?.().catch(() => {})
    startListening()
  }

  document.getElementById('screen-fullscreen').addEventListener('click', handleTap, { once: true })
}

// ── Main display boot ─────────────────────────────────────────────
async function startListening() {
  show('screen-loading')

  try {
    await firebaseSignInAnonymously()
  } catch (err) {
    console.error('Anonymous sign-in failed:', err)
    // Try to load cached state and run offline
    const cached = await loadCachedState()
    if (cached) {
      show('screen-display')
      applyState(cached)
    }
    return
  }

  clockOffset = await getServerTimeOffset()
  watchConnection()

  // Register presence (random device ID persisted in sessionStorage)
  let deviceId = sessionStorage.getItem('syncsign_device_id')
  if (!deviceId) {
    deviceId = crypto.randomUUID()
    sessionStorage.setItem('syncsign_device_id', deviceId)
  }
  if (!presenceRegistered) {
    registerPresence(roomId, deviceId)
    presenceRegistered = true
  }

  // Subscribe to Firebase state
  subscribeRoomState(roomId, (state) => {
    if (state) {
      show('screen-display')
      applyState(state)
    }
  })

  // Listen to BroadcastChannel (same-network fast path)
  onBroadcastState((state) => {
    if (state) applyState(state)
  })

  // Try offline cached state while waiting for Firebase
  const cached = await loadCachedState()
  if (cached && !currentState) {
    show('screen-display')
    applyState(cached)
  }

  requestWakeLock()
  registerSW()
}

// ── Entry point ───────────────────────────────────────────────────
function startDisplay() {
  if (!roomId) {
    showPairingScreen()
    return
  }
  showFullscreenPrompt()
}

startDisplay()
