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
export async function createDriveFolder(restaurantName) {
  const token = getToken()
  const res = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `SyncSign — ${restaurantName}`,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  })
  if (!res.ok) throw new Error(`Drive folder creation failed: ${res.status}`)
  const data = await res.json()
  localStorage.setItem(FOLDER_KEY, data.id)
  localStorage.setItem(RESTAURANT_KEY, restaurantName)
  return data.id
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
 * Upload an image file to the SyncSign Drive folder.
 * Returns { id, url } where url is the public thumbnail URL.
 */
export async function uploadImageToDrive(file, folderId) {
  const token = getToken()

  // Multipart upload: metadata + file data
  const metadata = {
    name: file.name,
    parents: [folderId],
  }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', file)

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`)
  const data = await res.json()

  // Make the file publicly readable so TVs can fetch it without auth
  await setPublicReadable(data.id, token)

  return {
    id: data.id,
    name: data.name,
    url: driveImageUrl(data.id),
  }
}

/**
 * Set a Drive file to public readable (anyone with link can view).
 */
async function setPublicReadable(fileId, token) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  })
  if (!res.ok) throw new Error(`Drive permission set failed: ${res.status}`)
}

/**
 * List all images in the SyncSign folder.
 * Returns array of { id, name, url }.
 */
export async function listDriveImages(folderId) {
  const token = getToken()
  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`
  )
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name)&orderBy=createdTime desc`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`)
  const data = await res.json()
  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    url: driveImageUrl(f.id),
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
 */
export function driveImageUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`
}
