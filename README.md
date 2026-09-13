<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Lolly's Product Shoot App

AI product photography, model shots, Veo/Seedance video, a CapCut-style editor, and Movie Flow — backed by real user accounts and a Cloud Functions proxy so no API key ever reaches the browser.

## Architecture

- **Frontend**: Vite + React, this repo's root.
- **Backend**: Firebase Cloud Functions (`functions/`) — every Gemini/Veo/fal.ai call happens here, using secrets that never leave the server. The client calls these by name via `firebase/functions`.
- **Auth**: Firebase Authentication (email/password). Every callable function requires a signed-in user.
- **Data**: Firestore for usage history + per-user daily rate limits (`firestore.rules`); Firebase Storage for generated videos, served back as time-limited signed URLs (`storage.rules`).

## Run Locally

**Prerequisites:** Node.js, a Firebase project (see Setup below), the [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`).

1. Install dependencies: `npm install`
2. `firebase login`
3. Run the app: `npm run dev`

The frontend needs no API keys of its own — it only talks to your Firebase project's public config (already in `firebase-applet-config.json`) and your deployed Cloud Functions.

## One-time setup (new Firebase project)

1. **Upgrade to the Blaze (pay-as-you-go) plan.** Cloud Functions can't make outbound calls to Gemini/fal.ai on the free Spark plan. Blaze still has a generous free tier.
2. **Enable Email/Password sign-in**: Firebase Console → Authentication → Sign-in method → Email/Password.
3. **Set the server-side secrets** (the actual API keys now live only here):
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY    # from https://aistudio.google.com/apikey
   firebase functions:secrets:set FAL_API_KEY       # optional, powers both Seedance and Kling
   firebase functions:secrets:set MAGNIFIC_API_KEY  # optional, powers the "Enhance" upscale button
   ```
4. **Deploy everything**:
   ```bash
   firebase deploy --only functions,firestore:rules,storage
   ```
5. **Allow the browser to read generated videos** — Veo/Seedance/Kling clips are stored in Firebase Storage and handed back as signed URLs, which is a different origin than the app; without CORS the browser can't extract preview frames, download, or re-edit them. One-time setup (needs [gsutil](https://cloud.google.com/storage/docs/gsutil_install), part of the `gcloud` CLI):
   ```bash
   gsutil cors set cors.json gs://<your-storage-bucket>   # bucket name is storageBucket in firebase-applet-config.json
   ```
6. **Create your account** — open the app and use the "Sign up" link on the login screen (this replaces the old hardcoded `box`/`lolly`/`faisal` logins).

Re-run step 4 whenever you change `functions/src/index.ts`, `firestore.rules`, or `storage.rules`.

## Features

- **Generate**: AI product photography, model shots, and Veo ad videos.
- **Editors**: every generated image and video has an **Edit** button — a built-in CapCut-style editor:
  - Images: crop, rotate/flip, filters, text, stickers, undo/redo, and an AI eraser (paint over an object to remove it) + one-click background removal.
  - Videos: a real multi-clip timeline — split/reorder/delete segments, per-clip speed (0.25x–2x), filters, burned-in text overlays, and background music mixing.
  - Edited results replace the asset in place (and can still be re-downloaded, or sent to CapCut's web editor for further edits).
- **Movie Flow**: one prompt + up to 5 reference images → a long-form video (up to 60s), generated as chained ~8–10s scenes and stitched into one clip.
  - **Veo** engine: 1 reference image for continuity.
  - **Seedance** and **Kling** engines (optional): up to 5 reference images per scene (Seedance) or 1 (Kling) for stronger character/product consistency. Both require the `FAL_API_KEY` secret above — same key, no separate account needed.
- **Enhance**: a one-click upscale button (via [Magnific](https://www.magnific.com/api)'s precision upscaler, up to 16x) on every generated image, next to Edit/4K Export/CapCut. Requires the `MAGNIFIC_API_KEY` secret above; the button still renders without it, but the request will fail with a clear error until the secret is set.
- **Server-enforced usage caps**: each account gets a daily image/video generation limit (`functions/src/index.ts`'s `DAILY_LIMITS`), tracked in Firestore — not a client-editable number.

## Testing & CI

- `npm test` runs the unit suite (Vitest) — pure logic only (usage-cost math, Movie Flow segment-chaining math, CapCut filename/MIME helpers). It deliberately never imports `services/firebase.ts`: that module opens live Firestore/Auth connections at import time, which hang a test process instead of exiting.
- `.github/workflows/ci.yml` runs `npm run lint` (tsc), `npm test`, and `npm run build` for the frontend, plus a typecheck + build for `functions/`, on every push/PR once this repo has a GitHub remote. Needs no secrets — it never touches your real Firebase project.
- `npm audit` is clean (0 vulnerabilities) in both the root project and `functions/` as of the last dependency pass.

## Error monitoring (optional)

`services/monitoring.ts` wires up [Sentry](https://sentry.io) for the `ErrorBoundary` (client) and is completely inert (not even downloaded) unless you set `VITE_SENTRY_DSN`. Create a Sentry project, then:
```bash
echo "VITE_SENTRY_DSN=https://...@o0.ingest.sentry.io/0" >> .env.local
```
For the same DSN in production, add `VITE_SENTRY_DSN` as a Vercel environment variable (Project Settings → Environment Variables) instead of `.env.local`.

Cloud Functions report crashes to the same Sentry project (`functions/src/index.ts`'s `reportServerError`, wired into every AI-calling function's error path). Set it once as a Functions secret:
```bash
firebase functions:secrets:set SENTRY_DSN
```
Leave it unset to skip server-side reporting entirely.

## Rate limiting

`functions/src/index.ts`'s `checkAndIncrementRateLimit` enforces two layers per signed-in user, both server-side (a client can't bypass either by calling the function directly):
- **Daily cap** — 200 images / 20 videos per day for free, then spends purchased credits (see Billing below), rejecting with `resource-exhausted` once both are exhausted.
- **Burst cap** — 6 images / 2 videos per rolling 60-second window (`checkBurstLimit`), independent of the daily cap, to stop a buggy client or script from firing dozens of requests in a few seconds.

Burst-limit documents live in the `rate_limit_bursts` Firestore collection with a short `expiresAt`. Set a [TTL policy](https://firebase.google.com/docs/firestore/ttl) on that field once in the Firebase console (Firestore → TTL Policies) so they clean themselves up automatically — otherwise they just accumulate as small, harmless documents.

## Feature flags

`services/featureFlags.ts` subscribes to a single Firestore document (`feature_flags/config`) that gates the Dashboard tab, Movie Flow tab, Custom Model Studio, and the per-result Image/Video editors — flip any of them off for everyone without a redeploy. There's no admin UI yet; edit the document directly in the Firebase console:

```json
// Firestore → feature_flags → config
{ "dashboard": true, "movieFlow": true, "customModelStudio": true, "imageEditor": true, "videoEditor": true }
```

Any field you omit defaults to `true` (see `DEFAULT_FLAGS`); the document itself is optional — if it doesn't exist, every flag defaults on. `firestore.rules` makes this collection world-readable (even signed out) but client-write-denied, since it's meant to be public config, not per-user data.

## Staging environment

Two layers, independent of each other:

- **Vercel Preview deployments** happen automatically for every branch/PR once this repo is connected to a Git remote — no setup needed beyond that. Each gets its own throwaway URL.
- **A separate Firebase project** keeps staging's Auth/Firestore/Storage/Functions fully isolated from production, so test data and test users never touch real records. One-time setup:
  1. Create a second Firebase project (console.firebase.google.com or `firebase projects:create`), enable Authentication (Email/Password), Firestore, Storage, and Functions on it — same as the "One-time setup" section above, pointed at the new project.
  2. Add it to `.firebaserc` (already scaffolded here as the `staging` alias — replace the placeholder project ID), then deploy rules/functions to it: `firebase deploy --only firestore:rules,storage:rules,functions --project staging`.
  3. Copy that project's web config (Firebase console → Project settings → your web app) into Vercel's **Preview** environment variables only (never Production): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` (see `services/firebase.ts`, which prefers these over the committed `firebase-applet-config.json` whenever they're set).
  4. Set the same API secrets on the staging project too: `firebase functions:secrets:set GEMINI_API_KEY --project staging` (and `FAL_API_KEY`, `SENTRY_DSN`, etc. as needed).

Production keeps using the committed `firebase-applet-config.json` untouched; only Preview builds pick up the staging overrides.

## Legal

`legal/TERMS_OF_SERVICE.md` and `legal/PRIVACY_POLICY.md` are structural **templates**, not finished documents — every bracketed field needs your real business details, and both need a lawyer's review (especially the liability/warranty sections and anything covering GDPR/CCPA) before they govern real users.

## Security notes

- No API key of any kind ships in the browser bundle. If you ever see a `VITE_`-prefixed secret referenced from `import.meta.env` in this codebase again, that's a regression — Vite inlines those into the public JS.
- `firestore.rules` and `storage.rules` default-deny everything except the specific paths the app uses. Don't add a catch-all `allow read, write: if true` — that's what let anyone with the deployed site's public config read/write the entire database (the original state of this file, before it was hardened).
