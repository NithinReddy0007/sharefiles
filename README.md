# Qshare

> Lightweight, zero-account temporary file-sharing web application built with React, Vite, TypeScript, Cloudflare Workers, Cloudflare D1, and Cloudflare R2.

---

## Architecture Overview

- **Frontend**: Single-page application built with React 19, TypeScript, and Vite. Styled with clean, responsive modern CSS.
- **Backend API**: Cloudflare Worker handling room creation, credential validation, file streaming to R2, and scheduled cleanup cron jobs.
- **Database**: Cloudflare D1 (serverless SQLite) storing room codes, salted passcode hashes, file metadata, and expiration timestamps.
- **Storage**: Cloudflare R2 bucket storing uploaded file objects.
- **Frontend Hosting**: Static hosting via GitHub Pages with GitHub Actions CI/CD.

---

## Free-Tier Allowances & Cloudflare Limits

*(Verified from official Cloudflare documentation as of October 2024)*

1. **Cloudflare Workers (Free Plan)**:
   - 100,000 requests per day across all Workers.
   - Max 10ms CPU time per request.
   - Cron Triggers supported.
   - [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)

2. **Cloudflare D1 (Free Plan)**:
   - 5 million rows read per month.
   - 100,000 rows written per month.
   - 5 GB total database storage across account.
   - [Cloudflare D1 Pricing & Limits](https://developers.cloudflare.com/d1/platform/pricing/)

3. **Cloudflare R2 (Free Plan)**:
   - 10 GB-months of stored data per month.
   - 1,000,000 Class A operations (create/upload/write) per month.
   - 10,000,000 Class B operations (read/download) per month.
   - **Zero egress bandwidth charges** (no egress fees for downloads).
   - [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)

---

## Local Development Setup

### 1. Prerequisites
- **Node.js** v18+ or v20+ installed.
- **npm** v9+ installed.

### 2. Install Dependencies
```bash
# Install frontend dependencies
npm --prefix frontend install

# Install worker dependencies
npm --prefix worker install
```

### 3. Configure Local Environment
Create a `.env` file in the `frontend` folder:
```bash
cp .env.example frontend/.env
```
Ensure `frontend/.env` contains:
```env
VITE_API_BASE_URL=http://127.0.0.1:8787
```

### 4. Initialize Local D1 Database
In the `worker` directory, apply the database migration locally:
```bash
cd worker
npx wrangler d1 execute qshare-db --local --file=./migrations/0001_initial_schema.sql
cd ..
```

### 5. Run the Application Locally

In terminal 1 (start Cloudflare Worker API locally):
```bash
npm run dev:worker
# Or: cd worker && npx wrangler dev
```
The Worker will run on `http://127.0.0.1:8787`.

In terminal 2 (start Vite React frontend):
```bash
npm run dev:frontend
# Or: cd frontend && npm run dev
```
Open `http://localhost:5173` in your browser.

---

## Cloudflare Deployment

### 1. Log in to Wrangler
```bash
npx wrangler login
```

### 2. Create the Cloudflare D1 Database
```bash
npx wrangler d1 create qshare-db
```
Wrangler will output configuration information with a `database_id`.
Open `worker/wrangler.toml` and replace `database_id = "local-qshare-db"` with your actual D1 ID:
```toml
[[d1_databases]]
binding = "DB"
database_name = "qshare-db"
database_id = "<YOUR_ACTUAL_D1_DATABASE_ID>"
migrations_dir = "migrations"
```

Apply migrations to production:
```bash
cd worker
npx wrangler d1 migrations apply qshare-db --remote
cd ..
```

### 3. Create the Cloudflare R2 Bucket
```bash
npx wrangler r2 bucket create qshare-files
```

### 4. Deploy the Worker
```bash
cd worker
npx wrangler deploy
cd ..
```
Note your deployed Worker URL (e.g., `https://qshare-api.<your-subdomain>.workers.dev`).

---

## GitHub Pages Deployment

The repository includes the official GitHub Pages deployment workflow at `.github/workflows/deploy.yml`.

### 1. Configure GitHub Repository Settings
1. Go to your repository on GitHub: `https://github.com/NithinReddy0007/sharefile`.
2. Navigate to **Settings** > **Pages**.
3. Under **Build and deployment** > **Source**, select **GitHub Actions** (do NOT choose "Deploy from a branch").
4. (Optional) In **Settings** > **Secrets and variables** > **Actions** > **Variables**, configure:
   - Name: `VITE_API_BASE_URL`
   - Value: `https://qshare-api.<your-subdomain>.workers.dev` (your deployed Worker API URL)

### 2. Automatic Deployment
Every push to the `main` branch triggers `.github/workflows/deploy.yml`, which:
- Installs dependencies in `frontend/`
- Builds the React app with `base: "/sharefile/"`
- Uploads `frontend/dist/` directly as the Pages artifact (with `index.html` at the root)
- Deploys the actual React application to: `https://nithinreddy0007.github.io/sharefile/`

---

## Scheduled Cleanup Mechanism

Rooms expire exactly 30 minutes after creation.
The Cloudflare Worker includes an automatic Cron trigger defined in `worker/wrangler.toml`:
```toml
[triggers]
crons = ["*/10 * * * *"]
```
Every 10 minutes, the Cloudflare scheduler executes `cleanupExpiredRooms(env)`. This:
1. Queries all rooms where `expires_at <= current_time`.
2. Issues `env.BUCKET.delete(keys)` for all associated R2 files.
3. Deletes room and file records from D1 in a batch transaction.

In addition, rooms are immediately blocked from downloads and uploads upon expiration via real-time timestamp checks on every API request.

---

## Running Tests
Run the automated test suite for backend room generation, hashing, capacity limits, and expiration:
```bash
npm run test:worker
```
