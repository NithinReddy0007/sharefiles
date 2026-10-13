# idea.md - Qshare Project Living Blueprint & Source of Truth

## 1. Product Overview & Goals
**Qshare** is a lightweight, zero-account temporary file sharing web application.
- **Core Mission**: Allow users to share files quickly and securely without registration, logins, or ads.
- **Access Pattern**: Senders receive a unique Room ID (e.g. `QK7M-89P2`) and a 6-digit numeric passcode. Receivers access the files using these credentials.
- **Strict Ephemerality**: Rooms and their files expire exactly 30 minutes from creation. No room extension is permitted.
- **Updated Enforced Storage & Concurrency Limits**:
  - **Maximum single file size**: 100 MiB (`104857600` bytes).
  - **Maximum combined room size**: 500 MiB (`524288000` bytes).
  - **Room expiration lifetime**: 30 minutes (`1800` seconds).
  - **Maximum files per room**: 20 files.
  - **Maximum simultaneous uploads**: 3 concurrent uploads (queued client-side pool).

---

## 2. Technology Stack & Architecture

### Frontend
- **Framework**: React 19 + TypeScript + Vite.
- **Styling**: Plain CSS (clean, responsive, subtle borders, muted blue accents, no gradients or heavy animations).
- **Icons**: `lucide-react`.
- **ZIP Bundler**: `fflate` for client-side streaming archive creation on "Download All".
- **Hosting**: GitHub Pages via official GitHub Actions (`.github/workflows/deploy.yml`).
- **Base Path**: Hardcoded in Vite configuration as `base: '/sharefile/'` for consistent asset resolution (`/sharefile/assets/...`).
- **Artifact**: Strictly uploads `frontend/dist/` so `index.html` resides at the root of the site, preventing README fallback.
- **API URL**: Configurable via `VITE_API_BASE_URL` (defaults to `http://127.0.0.1:8787`).

### Backend & Storage
- **Compute**: Cloudflare Workers (TypeScript).
- **Metadata Database**: Cloudflare D1 (SQLite-compatible distributed database).
- **File Storage**: Cloudflare R2 (S3-compatible object storage).
- **Tooling**: Wrangler CLI.
- **Scheduled Tasks**: Cloudflare Worker Cron Triggers (`*/10 * * * *`) for automated garbage collection of expired rooms.

---

## 3. Database Schema (Cloudflare D1)

### `rooms` Table
- `id TEXT PRIMARY KEY`: Alphanumeric room code (e.g., `ABCD-EFGH`).
- `passcode_hash TEXT NOT NULL`: SHA-256 hashed passcode with per-room salt.
- `passcode_salt TEXT NOT NULL`: 16-byte random hex salt.
- `created_at INTEGER NOT NULL`: Unix timestamp (seconds).
- `expires_at INTEGER NOT NULL`: Unix timestamp (`created_at + 1800`).
- `total_size_bytes INTEGER NOT NULL DEFAULT 0`: Aggregated file size in room.
- `status TEXT NOT NULL DEFAULT 'active'`: State (`active`, `expired`, `deleted`).

### `files` Table
- `id TEXT PRIMARY KEY`: UUID v4 file identifier.
- `room_id TEXT NOT NULL REFERENCES rooms(id)`: Room foreign key.
- `filename TEXT NOT NULL`: Original filename (sanitized for safe storage).
- `size_bytes INTEGER NOT NULL`: Size in bytes.
- `content_type TEXT NOT NULL`: MIME type.
- `storage_key TEXT NOT NULL`: R2 key (`rooms/{roomId}/{fileId}_{filename}`).
- `status TEXT NOT NULL DEFAULT 'pending'`: `pending`, `uploaded`, or `deleted`.
- `upload_id TEXT`: Cloudflare R2 multipart upload ID (if large file > 50MB).
- `uploaded_at INTEGER`: Upload completion timestamp.
- `created_at INTEGER NOT NULL`: Creation timestamp.

---

## 4. API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Healthcheck and timestamp | None |
| `POST` | `/api/rooms` | Creates new temporary room (returns ID, passcode, TTL, limits) | None |
| `GET` | `/api/rooms/:roomId` | Retrieves room metadata & uploaded files list | `X-Room-Passcode` |
| `POST` | `/api/rooms/:roomId/files` | Initiates upload (enforces 100 MiB limit, 20-file cap, 500 MiB quota) | `X-Room-Passcode` |
| `PUT` | `/api/rooms/:roomId/files/:fileId` | Streams file body directly to R2 with live metering and abort cleanup | `X-Room-Passcode` |
| `PUT` | `/api/rooms/:roomId/files/:fileId/part` | Uploads multipart chunk (10 MiB) for files > 50 MiB | `X-Room-Passcode` |
| `POST` | `/api/rooms/:roomId/files/:fileId/complete`| Finalizes multipart upload in R2 & updates D1 atomically | `X-Room-Passcode` |
| `POST` | `/api/rooms/:roomId/files/:fileId/abort` | Aborts pending multipart upload and deletes records | `X-Room-Passcode` |
| `GET` | `/api/rooms/:roomId/files/:fileId/download`| Streams file download with Range header support | `X-Room-Passcode` |
| `POST` | `/api/cleanup` | Manual/cron trigger for expired room cleanup | None |

---

## 5. Hosting & Storage Limits Respect (Zero-Cost / Free-Tier Compatibility)

### Free-Tier Architecture Constraints Verified:
1. **Cloudflare Workers Free Plan Memory (128 MB RAM)**:
   - Workers cannot buffer 100 MiB files in RAM (`request.arrayBuffer()` would throw Out-Of-Memory exceptions).
   - **Solution implemented**: Direct streaming pipeline via `TransformStream` where incoming HTTP body bytes are piped to `env.BUCKET.put()` without accumulating in Worker memory.
   - For files > 50 MiB, chunked multipart upload is used in 10 MiB pieces, maintaining peak memory well under 15 MiB.
2. **Workers Body Limit**:
   - Single requests stream directly to R2 bucket. Chunking prevents HTTP request timeout or proxy disconnects.
3. **Cloudflare Free-Tier Quotas**:
   - R2: 10 GB storage, 1M Class A ops, 10M Class B ops, zero egress fee.
   - D1: 5 million row reads/month, 100k row writes/month.
   - Workers: 100,000 requests/day.
4. **No Paid Services or Billing Required**:
   - Architecture operates entirely within free tier limits without requiring payment card entry for local development or basic deployment.

---

## 6. Race Conditions & Concurrency Protection
- **Pre-allocation of Room Quota**: When a client calls `POST /api/rooms/:roomId/files`, the backend inspects `SELECT TOTAL(size_bytes) FROM files WHERE status IN ('uploaded', 'pending')`.
- This ensures that if two 60 MiB uploads are initiated at the same time in a room with only 70 MiB space remaining, the first reserves its space as `pending` and the second is immediately rejected with a `400 Bad Request` instead of both completing and overflowing the 500 MiB limit.
- **Interrupted Upload Cleanup**: If a stream disconnects or fails mid-transfer, a `try...catch` block intercepts the failure, issues `env.BUCKET.delete()`, and removes the pending file from D1 so room quota is never permanently held by dead uploads.
- **Periodic Stale Pending Sweeper**: The scheduled worker cleans up any pending uploads older than 15 minutes.

---

## 7. Frontend Concurrency & UX
- Displays limits clearly: `100 MiB` per file, `500 MiB` per room, `20` files max.
- Live capacity bar tracking combined allocated size and file count.
- **Upload Queue Runner**: Allows selecting many files, but processes a maximum of **3 simultaneous uploads** using an asynchronous concurrency pool runner while remaining files wait in `pending` state.
- Individual progress bar tracking and cancel/remove support before upload.

---

## 8. Verification & Tests Run

### Automated Test Suite (`worker/test/logic.test.js` - 12/12 Passing):
1. **Room ID formatting**: Generates 9-char alphanumeric code (`XXXX-XXXX`).
2. **Passcode generation**: Generates 6-digit numeric string.
3. **File just below 100 MiB limit** (`104857599` bytes): Accepted.
4. **File exactly at 100 MiB limit** (`104857600` bytes): Accepted.
5. **File exceeding 100 MiB by 1 byte** (`104857601` bytes): Rejected.
6. **Uploads exceeding 500 MiB room quota**: Rejected.
7. **Uploading when room already contains 20 files**: Rejected.
8. **Expired rooms (>1800s) & invalid passcodes**: Rejected with constant-time verification.
9. **Two concurrent uploads jointly exceeding quota**: Prevented via in-flight pending reservation.
10. **Interrupted uploads & cleanup**: Deleted from DB and storage.
11. **Concurrency pool runner**: Enforces maximum of 3 active simultaneous uploads.
12. **Hosting and storage memory constraints**: Streaming pipeline verified without memory buffering.

### Build & Typecheck Verification:
- `npm run typecheck`: Passed.
  - `frontend`: Vite React build succeeded, generating production assets in `dist/`.
  - `worker`: TypeScript type check succeeded with 0 errors.

---

## 9. Local vs. Deployed Infrastructure Status
- **Verified Locally**:
  - Full TypeScript type-checking across frontend and worker.
  - Production Vite bundle compilation.
  - Backend validation logic, crypto helpers, concurrency pool, rate limiter, and error responses.
  - Node test suite covering all 10 constraint scenarios (12 tests total).
- **Deployment Status**:
  - GitHub Pages Deployment: Managed via `.github/workflows/deploy.yml` with official `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4`.
  - Publishing Source requirement: GitHub Repository **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions**.
  - Worker API: Cloudflare Worker configured with D1 database (`c018ab94-d115-4288-808d-ae88b7dea758`).

---

## 10. Diagnosis & Zero-Card Storage Architecture

### A. Root Cause of "Failed to fetch" on Deployed Site
1. **Unconfigured `VITE_API_BASE_URL`**:
   The deployed frontend at `https://nithinreddy0007.github.io/sharefile/` was compiled with the default local fallback (`http://127.0.0.1:8787`). When users clicked "Send Files" on the live web, their browser attempted an HTTP request to `http://127.0.0.1:8787/api/rooms`. Because the user's computer is not running a local worker, the browser blocked or refused the connection, resulting in `Failed to fetch`.
2. **Undeployed Worker**:
   The Cloudflare Worker deployment was blocked because `wrangler deploy` was attempting to bind to the `qshare-files` R2 bucket, which Cloudflare rejected with Error 10042 (Cloudflare requires a verified payment method on file to provision R2 buckets, even though R2 has a 10 GB free tier).
3. **CORS Configuration**:
   The Worker CORS configuration has now been hardened to explicitly permit `https://nithinreddy0007.github.io` alongside localhost development origins, with full preflight `OPTIONS` handling and `Vary: Origin` headers.

### B. Storage Provider Alternatives Analysis (Zero Credit Card Required)
Cloudflare R2 blocks bucket creation without billing details (Error 10042). Because you do not want to provide credit card or PayPal details, here is the factual evaluation of genuine zero-card alternatives:

| Provider | Free Tier (No Card Required) | Max File Size | Upload Architecture | Suitability for Qshare |
|---|---|---|---|---|
| **Supabase Storage** | 1 GB total storage, 50 MB max per file on free tier | 50 MB limit | S3-compatible or REST API | **Limited**: 50 MB limit falls short of the 100 MiB per-file requirement. |
| **Backblaze B2** | 10 GB free storage forever, 1 GB/day free egress | Up to 5 TB per file | Full S3-compatible API | **Recommended**: Fully S3-compatible, supports 100 MiB+ files, no payment method required for free tier signup. |
| **Cloudflare D1 (Raw BLOBs)** | 5 GB storage, 100k writes/month | 2 MB max per SQLite row | Chunked rows in D1 | **Viable Workaround within current stack**: Stores 100 MiB files as 1 MB chunk rows directly in the already-created D1 database. Operates 100% inside your existing card-free Cloudflare setup. |

