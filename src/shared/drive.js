/**
 * Google Drive API helpers.
 * All requests use the owner's OAuth access token stored in sessionStorage.
 * TVs never call these — only the controller does.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_KEY = 'syncsign_folder_id'
const RESTAURANT_KEY = 'syncsign_restaurant_name'

function getToken() {
  const token = sessionStorage.getItem('syncsign_access_token')
  if (!token) throw new Error('No access token — user must sign in')
  return token
}

/**
 * Create the SyncSign folder in the owner's Drive.
 * Returns the folder ID.
 */
/**
 * Find an existing "SyncSign — <name>" folder in Drive, or create it.
 * Stores the result in localStorage and returns the folder ID.
 */
export async function findOrCreateDriveFolder(restaurantName) {
  const token = getToken()
  const folderName = `SyncSign — ${restaurantName}`

  // Search for an existing folder with this exact name (drive.file scope
  // only returns files created by this app's OAuth client).
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`
  )
  const searchRes = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (searchRes.ok) {
    const data = await searchRes.json()
    if (data.files && data.files.length > 0) {
      const existing = data.files[0]
      localStorage.setItem(FOLDER_KEY, existing.id)
      localStorage.setItem(RESTAURANT_KEY, restaurantName)
      return existing.id
    }
  }

  // Not found — create it.
  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }),
  })
  if (!createRes.ok) throw new Error(`Drive folder creation failed: ${createRes.status}`)
  const created = await createRes.json()
  localStorage.setItem(FOLDER_KEY, created.id)
  localStorage.setItem(RESTAURANT_KEY, restaurantName)
  return created.id
}

/** @deprecated Use findOrCreateDriveFolder instead */
export async function createDriveFolder(restaurantName) {
  return findOrCreateDriveFolder(restaurantName)
}

/**
 * Store a folder selected via the Picker (or any other means).
 */
export function setStoredFolder(folderId, folderName) {
  localStorage.setItem(FOLDER_KEY, folderId)
  localStorage.setItem(RESTAURANT_KEY, folderName)
}

/**
 * Get the stored folder ID, or null if not set up yet.
 */
export function getStoredFolderId() {
  return localStorage.getItem(FOLDER_KEY)
}

export function getStoredRestaurantName() {
  return localStorage.getItem(RESTAURANT_KEY) || ''
}

/**
 * Search Drive for an existing "SyncSign — <name>" folder.
 * Returns { id, name } or null. Does NOT create anything.
 */
export async function findDriveFolderByName(restaurantName) {
  const token = getToken()
  const folderName = `SyncSign — ${restaurantName}`
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`
  )
  const res = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.files && data.files.length > 0 ? data.files[0] : null
}

/**
 * Upload an image file to the SyncSign Drive folder.
 * Returns { id, url, thumbnailUrl }.
 */
export async function uploadImageToDrive(file, folderId) {
  const token = getToken()

  const metadata = { name: file.name, parents: [folderId] }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', file)

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,thumbnailLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`)
  const data = await res.json()

  await setPublicReadable(data.id, token)

  return {
    id: data.id,
    name: data.name,
    url: driveImageUrl(data.id),
    thumbnailUrl: data.thumbnailLink || driveImageUrl(data.id),
  }
}

async function setPublicReadable(fileId, token) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  })
  if (!res.ok) throw new Error(`Drive permission set failed: ${res.status}`)
}

/**
 * List all images in the SyncSign folder.
 * Returns array of { id, name, url, thumbnailUrl }.
 */
export async function listDriveImages(folderId) {
  const token = getToken()
  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`
  )
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name,thumbnailLink)&orderBy=createdTime desc`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`)
  const data = await res.json()
  console.log('[listDriveImages] raw response:', JSON.stringify(data))
  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    url: driveImageUrl(f.id),
    thumbnailUrl: f.thumbnailLink || driveImageUrl(f.id),
  }))
}

/**
 * Delete a file from Drive.
 */
export async function deleteDriveFile(fileId) {
  const token = getToken()
  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 204) throw new Error(`Drive delete failed: ${res.status}`)
}

/**
 * Public URL for a Drive image — used by TVs to fetch without auth.
 * lh3 is Google's image CDN; not subject to the /uc?export=view deprecation.
 */
export function driveImageUrl(fileId) {
  return `https://lh3.googleusercontent.com/d/${fileId}`
}

// ── Google Picker API ─────────────────────────────────────────────
let gapiReady = false
let pickerReady = false

function loadGapiScript() {
  return new Promise((resolve) => {
    if (window.gapi) { gapiReady = true; return resolve() }
    const existing = document.querySelector('script[src="https://apis.google.com/js/api.js"]')
    if (existing) {
      existing.addEventListener('load', () => { gapiReady = true; resolve() })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.onload = () => { gapiReady = true; resolve() }
    document.head.appendChild(script)
  })
}

function loadPickerModule() {
  return new Promise((resolve) => {
    if (pickerReady) return resolve()
    window.gapi.load('picker', () => { pickerReady = true; resolve() })
  })
}

/**
 * Open the Google Picker filtered to folders only.
 * Calls onPicked({ id, name }) when the user selects a folder.
 * Requires drive.readonly scope so the user can browse all their folders.
 *
 * @param {string} accessToken - OAuth access token (from sessionStorage)
 * @param {string} apiKey - VITE_GOOGLE_PICKER_API_KEY
 * @param {function} onPicked - called with { id, name }
 */
export async function openFolderPicker(accessToken, apiKey, onPicked) {
  await loadGapiScript()
  await loadPickerModule()

  const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
    .setSelectFolderEnabled(true)
    .setMimeTypes('application/vnd.google-apps.folder')

  new window.google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessToken)
    .setDeveloperKey(apiKey)
    .setCallback((data) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const doc = data.docs[0]
        onPicked({ id: doc.id, name: doc.name })
      }
    })
    .build()
    .setVisible(true)
}
