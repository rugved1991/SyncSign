import {
  initiateOAuthRedirect,
  checkOAuthReturn,
  fetchUserInfo,
  storeSession,
  getStoredSession,
} from '@shared/auth.js'
import {
  firebaseSignInWithGoogle,
  pushRoomState,
  subscribePresenceCount,
  resolvePairing,
  database,
  auth,
} from '@shared/firebase.js'
import {
  createDriveFolder,
  getStoredFolderId,
  getStoredRestaurantName,
  setStoredFolder,
  uploadImageToDrive,
  listDriveImages,
  deleteDriveFile,
  openFolderPicker,
} from '@shared/drive.js'
import { broadcastState } from '@shared/broadcast.js'
import { ref as dbRef, onDisconnect } from 'firebase/database'

// ── State ─────────────────────────────────────────────────────────
let session = null   // { uid, email, name, accessToken }
let playlist = []    // Array of { id, url, title?, description?, price? }
let intervalSeconds = 10
let transition = 'fade'
let editingSlideIndex = null
let dragSrcIndex = null
let presenceUnsub = null

const BASE_URL = window.location.origin + import.meta.env.BASE_URL

// ── Screen management ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

// ── Sign-in ───────────────────────────────────────────────────────
// Redirect flow — navigates away to Google, returns via checkOAuthReturn()
document.getElementById('btn-signin').addEventListener('click', () => {
  initiateOAuthRedirect(import.meta.env.VITE_GOOGLE_CLIENT_ID)
})

function onSignedIn() {
  const folderId = getStoredFolderId()
  if (folderId) {
    loadMainScreen()
  } else {
    showScreen('screen-setup')
  }
}

// ── Restaurant setup ──────────────────────────────────────────────
document.getElementById('btn-setup').addEventListener('click', async () => {
  const name = document.getElementById('input-restaurant-name').value.trim()
  if (!name) return

  const btn = document.getElementById('btn-setup')
  btn.disabled = true
  btn.textContent = 'Setting up…'

  try {
    await createDriveFolder(name)
    loadMainScreen()
  } catch (err) {
    console.error('Setup error:', err)
    const errEl = document.getElementById('setup-error')
    errEl.textContent = 'Could not create Drive folder. Check your permissions and try again.'
    errEl.classList.remove('hidden')
    btn.disabled = false
    btn.textContent = 'Get started →'
  }
})

document.getElementById('input-restaurant-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-setup').click()
})

// ── Change folder (Picker) ────────────────────────────────────────
document.getElementById('btn-change-folder').addEventListener('click', async () => {
  const apiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY
  const btn = document.getElementById('btn-change-folder')
  btn.disabled = true

  try {
    const accessToken = sessionStorage.getItem('syncsign_access_token')
    openFolderPicker(accessToken, apiKey, async ({ id, name }) => {
      setStoredFolder(id, name)
      document.getElementById('header-restaurant-name').textContent = name

      // Reload playlist from newly selected folder
      playlist = []
      renderPlaylist()
      try {
        const images = await listDriveImages(id)
        playlist = images.map(img => ({ id: img.id, url: img.url, thumbnailUrl: img.thumbnailUrl || img.url }))
        renderPlaylist()
        showToast(`Switched to "${name}"`)
      } catch (err) {
        console.warn('Could not load images from new folder:', err)
      }
    })
  } catch (err) {
    console.error('Picker error:', err)
    showToast('Could not open folder picker.')
  } finally {
    btn.disabled = false
  }
})

// ── Main screen load ──────────────────────────────────────────────
async function loadMainScreen() {
  showScreen('screen-main')

  const restaurantName = getStoredRestaurantName()
  document.getElementById('header-restaurant-name').textContent = restaurantName || 'SyncSign'

  // Watch TV presence count
  if (presenceUnsub) presenceUnsub()
  presenceUnsub = subscribePresenceCount(session.uid, (count) => {
    document.getElementById('tv-count-num').textContent = count
    document.getElementById('tv-count-s').textContent = count === 1 ? '' : 's'
  })

  // Load existing images from Drive
  try {
    const images = await listDriveImages(getStoredFolderId())
    playlist = images.map(img => ({ id: img.id, url: img.url, thumbnailUrl: img.thumbnailUrl || img.url }))
    renderPlaylist()
  } catch (err) {
    console.warn('Could not load Drive images:', err)
  }
}

// ── Playlist rendering ────────────────────────────────────────────
function renderPlaylist() {
  const strip = document.getElementById('playlist-strip')
  const empty = document.getElementById('playlist-empty')
  const countEl = document.getElementById('slide-count-num')

  countEl.textContent = playlist.length

  if (playlist.length === 0) {
    strip.innerHTML = ''
    strip.appendChild(empty)
    empty.classList.remove('hidden')
    return
  }

  empty.classList.add('hidden')
  strip.innerHTML = ''

  playlist.forEach((item, i) => {
    const el = document.createElement('div')
    el.className = 'playlist-item'
    el.dataset.index = i
    el.innerHTML = `
      <img src="${item.thumbnailUrl || item.url}" alt="${item.title || 'Slide ' + (i + 1)}" loading="lazy" />
      <span class="playlist-item-index">${i + 1}</span>
    `

    // Tap to edit
    el.addEventListener('click', () => openSlideModal(i))

    // Touch drag-and-drop (Pointer Events API)
    el.addEventListener('pointerdown', onDragStart)

    strip.appendChild(el)
  })
}

// ── Drag to reorder (Pointer Events) ─────────────────────────────
let dragEl = null
let dragStartX = 0

function onDragStart(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const item = e.currentTarget
  dragSrcIndex = parseInt(item.dataset.index)
  dragEl = item

  dragStartX = e.clientX
  item.classList.add('dragging')
  item.setPointerCapture(e.pointerId)

  item.addEventListener('pointermove', onDragMove)
  item.addEventListener('pointerup', onDragEnd)
  item.addEventListener('pointercancel', onDragEnd)
}

function onDragMove(e) {
  const strip = document.getElementById('playlist-strip')
  const items = [...strip.querySelectorAll('.playlist-item:not(.dragging)')]
  items.forEach(el => el.classList.remove('drag-over'))

  const target = items.find(el => {
    const rect = el.getBoundingClientRect()
    return e.clientX >= rect.left && e.clientX <= rect.right
  })
  if (target) target.classList.add('drag-over')
}

function onDragEnd(e) {
  const strip = document.getElementById('playlist-strip')
  const items = [...strip.querySelectorAll('.playlist-item')]
  const targetEl = items.find(el => el.classList.contains('drag-over'))

  if (targetEl && dragEl) {
    const targetIndex = parseInt(targetEl.dataset.index)
    const moved = playlist.splice(dragSrcIndex, 1)[0]
    playlist.splice(targetIndex, 0, moved)
    renderPlaylist()
  }

  if (dragEl) {
    dragEl.classList.remove('dragging')
    dragEl.removeEventListener('pointermove', onDragMove)
    dragEl.removeEventListener('pointerup', onDragEnd)
    dragEl.removeEventListener('pointercancel', onDragEnd)
  }

  items.forEach(el => el.classList.remove('drag-over'))
  dragEl = null
  dragSrcIndex = null
}

// ── Upload ────────────────────────────────────────────────────────
document.getElementById('btn-upload').addEventListener('click', () => {
  document.getElementById('file-input').click()
})

document.getElementById('file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files]
  if (!files.length) return
  e.target.value = ''

  const folderId = getStoredFolderId()
  showToast(`Uploading ${files.length} image${files.length > 1 ? 's' : ''}…`)

  const results = await Promise.allSettled(
    files.map(file => uploadImageToDrive(file, folderId))
  )

  let added = 0
  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      playlist.push({ id: r.value.id, url: r.value.url, thumbnailUrl: r.value.thumbnailUrl || r.value.url })
      added++
    } else {
      console.error('Upload error:', r.reason)
    }
  })

  renderPlaylist()

  // Scroll the strip to show the newly added thumbnails
  const strip = document.getElementById('playlist-strip')
  strip.scrollTo({ left: strip.scrollWidth, behavior: 'smooth' })

  if (added === files.length) {
    showToast(`${added} image${added > 1 ? 's' : ''} added!`)
  } else {
    showToast(`${added} of ${files.length} uploaded — some failed.`)
  }
})

// ── Paste URL modal ───────────────────────────────────────────────
document.getElementById('btn-paste-url').addEventListener('click', () => {
  document.getElementById('modal-url').classList.remove('hidden')
  document.getElementById('input-url').focus()
})

document.getElementById('btn-url-cancel').addEventListener('click', closeUrlModal)
document.getElementById('modal-url').querySelector('.modal-backdrop').addEventListener('click', closeUrlModal)

document.getElementById('btn-url-add').addEventListener('click', () => {
  const url = document.getElementById('input-url').value.trim()
  if (!url) return

  playlist.push({ id: crypto.randomUUID(), url })
  renderPlaylist()
  closeUrlModal()
})

document.getElementById('input-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-url-add').click()
})

function closeUrlModal() {
  document.getElementById('modal-url').classList.add('hidden')
  document.getElementById('input-url').value = ''
}

// ── Slide edit modal ──────────────────────────────────────────────
function openSlideModal(index) {
  editingSlideIndex = index
  const item = playlist[index]
  document.getElementById('modal-slide-img').src = item.thumbnailUrl || item.url
  document.getElementById('slide-title').value = item.title || ''
  document.getElementById('slide-description').value = item.description || ''
  document.getElementById('slide-price').value = item.price || ''
  document.getElementById('modal-slide').classList.remove('hidden')
}

document.getElementById('btn-slide-save').addEventListener('click', () => {
  if (editingSlideIndex === null) return
  playlist[editingSlideIndex].title = document.getElementById('slide-title').value.trim()
  playlist[editingSlideIndex].description = document.getElementById('slide-description').value.trim()
  playlist[editingSlideIndex].price = document.getElementById('slide-price').value.trim()
  renderPlaylist()
  closeSlideModal()
})

document.getElementById('btn-slide-delete').addEventListener('click', async () => {
  if (editingSlideIndex === null) return
  const item = playlist[editingSlideIndex]
  playlist.splice(editingSlideIndex, 1)
  renderPlaylist()
  closeSlideModal()

  // Best-effort delete from Drive (may fail for pasted URLs)
  try {
    if (item.id && !item.url.startsWith('http')) await deleteDriveFile(item.id)
  } catch {}
})

document.getElementById('modal-slide').querySelector('.modal-backdrop').addEventListener('click', closeSlideModal)

function closeSlideModal() {
  document.getElementById('modal-slide').classList.add('hidden')
  editingSlideIndex = null
}

// ── Controls ──────────────────────────────────────────────────────
const slider = document.getElementById('slider-interval')
const sliderValue = document.getElementById('slider-value')

slider.addEventListener('input', () => {
  sliderValue.textContent = slider.value + 's'
  intervalSeconds = parseInt(slider.value)
})

// Debounce: only push on release
slider.addEventListener('change', () => {
  intervalSeconds = parseInt(slider.value)
})

document.getElementById('transition-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn')
  if (!btn) return
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  transition = btn.dataset.value
})

// ── Push live ─────────────────────────────────────────────────────
document.getElementById('btn-push').addEventListener('click', async () => {
  if (playlist.length === 0) {
    showToast('Add at least one slide first.')
    return
  }

  const btn = document.getElementById('btn-push')
  btn.disabled = true
  btn.textContent = 'Pushing…'

  const state = {
    playlist: playlist.map(({ id, url, title, description, price }) => ({
      id,
      url,
      ...(title && { title }),
      ...(description && { description }),
      ...(price && { price }),
    })),
    interval_seconds: intervalSeconds,
    transition,
  }

  try {
    broadcastState(state)
    console.log('[push] auth.currentUser:', auth.currentUser?.uid, '| session.uid:', session.uid)
    await pushRoomState(session.uid, state)

    const tvCount = parseInt(document.getElementById('tv-count-num').textContent) || 0
    showToast(`${tvCount} screen${tvCount === 1 ? '' : 's'} updated`)
  } catch (err) {
    console.error('Push failed:', err)
    showToast(`Push failed: ${err.code || err.message || 'unknown'}`)
  } finally {
    btn.disabled = false
    btn.textContent = 'Push live'
  }
})

// ── Preview modal ─────────────────────────────────────────────────
let previewIndex = 0

document.getElementById('btn-preview').addEventListener('click', () => {
  if (playlist.length === 0) { showToast('Add at least one slide first.'); return }
  previewIndex = 0
  openPreview()
})

function openPreview() {
  document.getElementById('modal-preview').classList.remove('hidden')
  renderPreviewSlide()
}

function renderPreviewSlide() {
  const item = playlist[previewIndex]
  document.getElementById('preview-img').src = item.url
  document.getElementById('preview-counter').textContent = `${previewIndex + 1} / ${playlist.length}`

  const hasOverlay = item.title || item.description || item.price
  const overlay = document.getElementById('preview-overlay')
  if (hasOverlay) {
    document.getElementById('preview-title').textContent = item.title || ''
    document.getElementById('preview-description').textContent = item.description || ''
    document.getElementById('preview-price').textContent = item.price || ''
    overlay.classList.remove('hidden')
  } else {
    overlay.classList.add('hidden')
  }
}

document.getElementById('preview-prev').addEventListener('click', () => {
  previewIndex = (previewIndex - 1 + playlist.length) % playlist.length
  renderPreviewSlide()
})
document.getElementById('preview-next').addEventListener('click', () => {
  previewIndex = (previewIndex + 1) % playlist.length
  renderPreviewSlide()
})
document.getElementById('preview-close').addEventListener('click', () => {
  document.getElementById('modal-preview').classList.add('hidden')
})
document.getElementById('modal-preview').querySelector('.modal-backdrop').addEventListener('click', () => {
  document.getElementById('modal-preview').classList.add('hidden')
})

// ── Add screen modal ──────────────────────────────────────────────
document.getElementById('btn-add-screen').addEventListener('click', async () => {
  const roomUrl = `${BASE_URL}display/?room=${session.uid}`
  document.getElementById('room-url-text').textContent = roomUrl
  document.getElementById('modal-screen').classList.remove('hidden')

  // Generate QR code using a CDN library loaded on demand
  const container = document.getElementById('qr-container')
  container.innerHTML = ''
  await renderQR(roomUrl, container)
})

document.getElementById('btn-screen-close').addEventListener('click', () => {
  document.getElementById('modal-screen').classList.add('hidden')
})
document.getElementById('modal-screen').querySelector('.modal-backdrop').addEventListener('click', () => {
  document.getElementById('modal-screen').classList.add('hidden')
})

document.getElementById('btn-copy-url').addEventListener('click', async () => {
  const url = document.getElementById('room-url-text').textContent
  await navigator.clipboard.writeText(url)
  showToast('URL copied!')
})

async function renderQR(text, container) {
  // Load qrcode.js from CDN lazily
  return new Promise((resolve) => {
    if (window.QRCode) return doRender()

    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
    script.onload = doRender
    script.onerror = () => {
      container.innerHTML = `<p style="font-size:0.8rem;color:#666;text-align:center">QR unavailable<br>Copy the URL above</p>`
      resolve()
    }
    document.head.appendChild(script)

    function doRender() {
      new window.QRCode(container, {
        text,
        width: 180,
        height: 180,
        colorDark: '#000',
        colorLight: '#fff',
        correctLevel: window.QRCode.CorrectLevel.M,
      })
      resolve()
    }
  })
}

// ── Toast ─────────────────────────────────────────────────────────
let toastTimeout = null
function showToast(msg) {
  const toast = document.getElementById('toast')
  toast.textContent = msg
  toast.classList.remove('hidden')
  if (toastTimeout) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000)
}

// ── Boot ──────────────────────────────────────────────────────────
;(async function boot() {
  // ── 1. Returning from Google OAuth redirect? ──────────────────────
  const oauthReturn = checkOAuthReturn()
  if (oauthReturn) {
    const { accessToken, idToken } = oauthReturn
    try {
      const info = await fetchUserInfo(accessToken)
      storeSession(info.sub, info.email, info.name || info.email, accessToken)
      session = { uid: info.sub, email: info.email, name: info.name || info.email }
      await firebaseSignInWithGoogle(idToken, accessToken)
      onSignedIn()
    } catch (err) {
      console.error('Sign-in completion failed:', err)
      showScreen('screen-signin')
    }

    // Handle pairing stored before the redirect
    const pendingPair = sessionStorage.getItem('syncsign_pending_pair')
    if (pendingPair) {
      sessionStorage.removeItem('syncsign_pending_pair')
      waitForSessionThenPair(pendingPair)
    }
    return
  }

  // ── 2. Existing session? ──────────────────────────────────────────
  const stored = getStoredSession()
  if (stored) {
    session = stored
    // auth.currentUser is null synchronously on page load even when Firebase
    // has a cached credential. Wait for the first auth state event before
    // deciding whether to proceed or force a re-login.
    await new Promise(resolve => {
      const unsub = auth.onAuthStateChanged(() => { unsub(); resolve() })
    })
    if (auth.currentUser) {
      onSignedIn()
    } else {
      // Firebase session expired — clear stored session and re-authenticate.
      showScreen('screen-signin')
    }
  } else {
    showScreen('screen-signin')
  }

  // ── 3. Opened from QR scan (?pair=ID) ────────────────────────────
  const pairingId = new URLSearchParams(window.location.search).get('pair')
  if (pairingId) waitForSessionThenPair(pairingId)
})()

async function waitForSessionThenPair(pairingId) {
  // Poll until session exists (sign-in may take a moment)
  while (!session) {
    await new Promise(r => setTimeout(r, 300))
  }
  try {
    await resolvePairing(pairingId, session.uid)
    showToast('Screen connected!')
    // Clean up URL so refreshing doesn't re-pair
    const url = new URL(window.location)
    url.searchParams.delete('pair')
    window.history.replaceState({}, '', url)
  } catch (err) {
    console.error('Pairing failed:', err)
    showToast('Could not connect screen. Try scanning again.')
  }
}
