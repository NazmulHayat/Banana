# Backend API

This directory contains the real backend logic for the Banana app.
All business logic, encryption, and database access lives here.

## Architecture

```
backend/
├── functions/
│   ├── encrypt-and-save/     # Save encrypted data
│   │   └── index.ts
│   ├── fetch-and-decrypt/    # Fetch and decrypt data
│   │   └── index.ts
│   └── _shared/              # Shared utilities
│       ├── crypto.ts         # Encryption/decryption
│       ├── auth.ts           # Authentication
│       ├── db.ts             # Database operations
│       └── types.ts          # TypeScript types
└── README.md
```

## API Contracts

### POST `/functions/v1/encrypt-and-save`

Encrypts data server-side and stores it in the database.

**Request Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "table": "entries" | "habits" | "habit_logs",
  "data": { ... },           // Plaintext data to encrypt
  "owner_id": "uuid",
  "day_bucket": "string",    // Optional, required for entries/habit_logs
  "month_bucket": "string"   // Optional, required for entries/habit_logs
}
```

**Response (200):**
```json
{ "success": true }
```

**Errors:**
- `400`: Invalid table or missing params
- `401`: No/invalid authorization
- `403`: User doesn't own resource
- `500`: Server error

---

### GET `/functions/v1/fetch-and-decrypt`

Fetches encrypted data and returns decrypted plaintext.

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `table` (required): `entries` | `habits` | `habit_logs`
- `owner_id` (required): User UUID
- `day_bucket` (optional): Filter by day
- `month_bucket` (optional): Filter by month

**Response (200):**
```json
{
  "data": [
    { ...decrypted_data, "_id": "row_id", "_day_bucket": "bucket" }
  ]
}
```

**Errors:**
- `400`: Missing required params
- `401`: No/invalid authorization
- `403`: User doesn't own resource
- `500`: Server error

---

## Environment Variables

Required in Supabase Edge Function secrets:

| Variable | Description |
|----------|-------------|
| `APP_ENCRYPTION_KEY` | 64-char hex string (32 bytes) for AES-256-GCM |
| `SUPABASE_URL` | Auto-provided by Supabase |
| `SUPABASE_ANON_KEY` | Auto-provided by Supabase |

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Deployment

Functions are deployed via Supabase CLI. The `supabase/functions` directory
symlinks to `backend/functions` for CLI compatibility.

```bash
# Deploy all functions
supabase functions deploy encrypt-and-save
supabase functions deploy fetch-and-decrypt

# Or deploy all at once
supabase functions deploy
```

## Security Model

1. **Auth Enforcement**: Every request must include a valid JWT
2. **Ownership Verification**: Users can only access their own data
3. **Server-Side Encryption**: Encryption key never leaves the server
4. **No Direct DB Access**: Frontend only calls Edge Functions

## Frontend Integration

Frontend must call these endpoints via HTTP:

```typescript
// lib/db/entries.ts example
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=entries&owner_id=${userId}`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
```

Frontend should NEVER:
- Use `supabase.from()` for app data
- Access encryption keys
- Perform encryption/decryption
