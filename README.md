# AutoSDLC

Autonomous Software Development Orchestrator. Sprint 1 delivers authentication and the user foundation.

## Stack

- Backend: NestJS + TypeScript + PostgreSQL + Prisma (`backend/`)
- Frontend: React + TypeScript + Vite (`frontend/`)
- Database: PostgreSQL via Docker (`docker-compose.yml`)

## Setup

```bash
# 1. Start Postgres
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env   # adjust if needed
npm install
npx prisma migrate deploy
npm run start:dev       # http://localhost:3001

# 3. Frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
npm run dev              # http://localhost:5173
```

## Sprint 1 — Authentication & Users

Endpoints (`backend/src/auth`):

- `POST /auth/register` — create account, returns `{ user, accessToken, refreshToken }`
- `POST /auth/login` — returns the same shape
- `POST /auth/refresh` — rotates access + refresh tokens
- `GET /auth/me` — protected, returns the current user
- `POST /auth/logout` — protected, revokes the stored refresh token

### Security decisions

- Passwords hashed with bcrypt (cost factor 12).
- Refresh tokens are JWTs; only a bcrypt hash of the current refresh token is stored on the `User` row (`refreshTokenHash`), never the raw token. Each successful login/refresh rotates it, so a reused/old refresh token no longer matches the stored hash and is rejected. This is single-session per user by design — logging in elsewhere invalidates the previous refresh token. Logging out clears the hash.
- Access and refresh tokens use separate secrets/expirations (`JWT_ACCESS_*`, `JWT_REFRESH_*` in `backend/.env`).
- Frontend stores tokens in `localStorage`, isolated behind `frontend/src/auth/tokenStorage.ts` so it can be swapped for cookie-based auth later without touching the rest of the app. Trade-off: readable by page scripts (XSS exposure) in exchange for MVP simplicity.
- The frontend's HTTP client (`frontend/src/api/http.ts`) auto-refreshes the access token once on a 401, de-duplicating concurrent refresh attempts, and clears auth state if the refresh itself fails.

### Assumptions

- No Sprint 0 existed in this repository; the NestJS/Prisma backend and Vite/React frontend scaffolding were created as part of this sprint to give Sprint 1 something to build on.
- Registration returns tokens immediately (auto-login) rather than requiring a separate login step.
- An inactive user with correct credentials gets a distinct 403 ("account inactive"); unknown email or wrong password both return a generic 401 so credential guessing can't distinguish the two.
