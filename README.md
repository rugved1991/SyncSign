# SyncSign

Free, open-source digital signage for restaurants. Sync image slideshows across multiple TVs simultaneously — no app installs, no monthly fees, no data stored on your servers.

**Cost: $0/month** until 100+ simultaneous restaurants.

---

## How it works

- **Controller** (`/controller`) — owner opens on their phone to manage content
- **Display** (`/display?room=ROOM_ID`) — TV opens this URL in any browser, taps fullscreen once, runs forever

TVs sync using a clock-based formula — no coordinator device needed. Close the controller at any time; displays keep running.

---

## Setup (one time, ~15 minutes)

### 1. Firebase

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Create a project**
2. **Realtime Database** → Create database → Start in **test mode** (you'll lock it down in step 2)
3. **Authentication** → Sign-in method → Enable **Google** and **Anonymous**
4. Copy your Firebase config — you'll need: `apiKey`, `authDomain`, `databaseURL`, `projectId`

### 2. Paste security rules

In Firebase Console → Realtime Database → **Rules**, paste:

```json
{
  "rules": {
    "rooms": {
      "$uid": {
        ".read": true,
        ".write": "auth.uid === $uid"
      }
    }
  }
}
```

Click **Publish**.

### 3. Google Cloud — Drive API + OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → Create a project (or use the one Firebase made)
2. **APIs & Services** → **Enable APIs** → search for **Google Drive API** → Enable it
3. **OAuth consent screen**:
   - User type: **External**
   - Fill in app name (e.g. "SyncSign"), your email
   - Scopes: add `https://www.googleapis.com/auth/drive.file`
   - Test users: add your Google account email
4. **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorised JavaScript origins: add your Vercel domain (e.g. `https://syncsign.vercel.app`)
   - Copy the **Client ID**

### 4. Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo
3. Vercel detects the `vercel.json` and `package.json` automatically — no framework preset needed
4. Under **Environment Variables**, add these five values:

   | Name | Where to find it |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | Firebase project settings |
   | `VITE_FIREBASE_AUTH_DOMAIN` | Firebase project settings |
   | `VITE_FIREBASE_DATABASE_URL` | Firebase Realtime Database URL |
   | `VITE_FIREBASE_PROJECT_ID` | Firebase project settings |
   | `VITE_GOOGLE_CLIENT_ID` | Google Cloud → Credentials → OAuth client |

5. Click **Deploy** — Vercel runs `npm run build` and publishes `dist/`

Every subsequent push to `main` redeploys automatically.

### 5. Open the controller on your phone

```
https://your-project.vercel.app/controller
```

Sign in with Google → enter your restaurant name → upload photos → tap **Push live**.

### 6. Set up your TVs

```
https://your-project.vercel.app/display?room=ROOM_ID
```

The room ID appears in the **Add a screen** dialog in the controller. Open this URL on your TV's browser → tap anywhere → fullscreen slideshow starts.

For auto-start on a Raspberry Pi or dedicated device:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  'https://your-project.vercel.app/display?room=ROOM_ID'
```

---

## Features

- **Zero-cost infrastructure** — Vercel free tier + Firebase Spark free tier + owner's Google Drive
- **Clock-based sync** — TVs compute the current slide independently using wall-clock time; no coordinator needed
- **Offline resilience** — Service Worker caches images and last state; displays keep running through network interruptions
- **BroadcastChannel fast path** — changes appear instantly on displays on the same device/network, before Firebase propagates
- **Wake lock** — displays stay on without screen saver interference
- **Presence counter** — controller shows how many TVs are connected in real time
- **Optional metadata** — add title, description, price to each slide; displayed as a gradient overlay

---

## Architecture

```
Owner phone
  → Google Sign-In (GSI SDK)
  → uploads images to their own Google Drive (drive.file scope only)
  → pushes playlist state to Firebase RTDB (scoped to their Google UID)

TVs (any browser, any network)
  → connect to Firebase RTDB anonymously (read-only)
  → fetch images directly from Google Drive CDN
  → compute current slide using clock formula
  → run autonomously — no controller needed once running
```

No backend server. No database you manage. No file storage you pay for.

---

## Local development

```bash
cp .env.example .env
# Fill in your Firebase + Google credentials in .env

npm install
npm run dev
```

Controller: http://localhost:5173/controller
Display: http://localhost:5173/display?room=YOUR_UID

---

## V1 scope (not included)

- Scheduled playlists (time-of-day switching)
- Multiple rooms per owner
- Video support
- Analytics
- Any backend server or paid infrastructure

---

## License

MIT
