# Aight bet (formerly Banana) - Complete Data Flow Explanation

> ⚠️ **May be partially out of date.** This walkthrough predates some refactors —
> e.g. it describes a separate `bucketKey`/`wrapped_bucket_key` and setting the
> privacy password from the Profile screen. Current code derives buckets via
> HMAC (`lib/crypto/buckets.ts`, no stored bucketKey) and sets up the master key
> at signup (`keyring.setupNewUser`). Trust `lib/crypto/` + `supabase/migrations/`
> over this doc where they disagree; refresh this file when you next touch crypto.

## 📋 Table of Contents

1. [Initial Setup Flow](#initial-setup-flow)
2. [Unlock Flow](#unlock-flow)
3. [Save Data Flow](#save-data-flow)
4. [Load Data Flow](#load-data-flow)
5. [Key Concepts](#key-concepts)

---

## 🔐 Initial Setup Flow

**When user first sets privacy password:**

```
User enters password in Profile screen
    ↓
keyring.setupMasterKey(password)
    ↓
1. Generate random masterKey (256-bit)
2. Generate random bucketKey (256-bit)
3. Generate random salt
    ↓
4. Derive KEK (Key Encryption Key) from password using scrypt
   KEK = scrypt(password, salt, params)
    ↓
5. Encrypt masterKey with KEK → wrapped_master_key
6. Encrypt bucketKey with KEK → wrapped_bucket_key
    ↓
7. Store in Supabase `profiles` table:
   - wrapped_master_key (encrypted master key)
   - wrapped_master_key_nonce
   - wrapped_bucket_key (encrypted bucket key)
   - wrapped_bucket_key_nonce
   - kdf_salt (for password derivation)
   - kdf_params (scrypt parameters)
    ↓
8. Store keys in memory (masterKey, bucketKey)
9. Cache keys in SecureStore (for app restarts)
    ↓
✅ Keyring is now UNLOCKED
```

**Key Point:** The password is NEVER stored. Only the encrypted master key is stored.

---

## 🔓 Unlock Flow

**When user unlocks keyring (app restart or manual unlock):**

```
User enters password in Profile screen
    ↓
keyring.unlock(password)
    ↓
1. Fetch wrapped keys from Supabase `profiles` table
    ↓
2. Derive KEK from password:
   KEK = scrypt(password, salt_from_db, params_from_db)
    ↓
3. Decrypt wrapped_master_key with KEK → masterKey
4. Decrypt wrapped_bucket_key with KEK → bucketKey
    ↓
5. Store keys in memory (masterKey, bucketKey)
6. Cache keys in SecureStore
    ↓
✅ Keyring is now UNLOCKED
```

**Auto-restore on app start:**

```
App starts → auth-context.tsx
    ↓
keyring.tryRestoreFromCache()
    ↓
1. Check SecureStore for cached keys
2. If found → load into memory
3. If not found → keyring stays LOCKED
    ↓
✅ If cached: Keyring auto-unlocked
❌ If not cached: User must manually unlock
```

---

## 💾 Save Data Flow

### Saving a Daily Entry

```
User types entry and clicks save
    ↓
handleSaveEntry() in index.tsx
    ↓
saveEncryptedEntry(entry)
    ↓
┌─────────────────────────────────────┐
│ STEP 1: Always save locally first   │
│ storage.saveDailyEntry(entry)       │
│ → AsyncStorage (plaintext)          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ STEP 2: Check if keyring unlocked  │
│ if (!isKeyringUnlocked())           │
│   → return (save locally only)     │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ STEP 3: Get all entries for date   │
│ (to aggregate multiple entries/day) │
│ allEntriesForDate = [...]           │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ STEP 4: Generate buckets            │
│ dayBucket = HMAC(bucketKey, date)   │
│ monthBucket = HMAC(bucketKey, YYYY-MM) │
│ (buckets hide actual dates)         │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ STEP 5: Encrypt payload            │
│ payload = {                         │
│   date: "2026-01-20",               │
│   entries: [{id, text, createdAt}]  │
│ }                                   │
│ ciphertext = AES-GCM(payload, masterKey) │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ STEP 6: Save to Supabase           │
│ supabase.from('entries').upsert({   │
│   owner_id: user.id,                │
│   day_bucket: "abc123...",          │
│   month_bucket: "def456...",        │
│   ciphertext: "encrypted_data",     │
│   nonce: "random_nonce"             │
│ })                                  │
└─────────────────────────────────────┘
    ↓
✅ Data saved locally AND in cloud
```

### Saving Habits

```
User adds/edits habit
    ↓
saveEncryptedHabits(habits)
    ↓
1. Save locally first (AsyncStorage)
2. If keyring unlocked:
   a. Delete all existing habits from Supabase
   b. For each habit:
      - Encrypt: {id, name, createdAt}
      - Insert into Supabase `habits` table
```

### Toggling Habit Log

```
User clicks habit checkbox
    ↓
toggleEncryptedHabitLog(habitId, date)
    ↓
1. Toggle locally first
2. If keyring unlocked:
   a. Generate dayBucket = HMAC(bucketKey, "habitId:date")
   b. Encrypt: {habitId, date, completed}
   c. Check if log exists in Supabase
   d. Update or Insert into `habit_logs` table
```

---

## 📥 Load Data Flow

### Loading Habits

```
App loads / User navigates to tracker
    ↓
loadEncryptedHabits()
    ↓
┌─────────────────────────────────────┐
│ Check keyring status                 │
│ if (!isKeyringUnlocked())            │
│   → return storage.getHabits()       │
│   (local only)                       │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Fetch from Supabase                 │
│ supabase.from('habits')             │
│   .select('ciphertext, nonce')      │
│   .eq('owner_id', user.id)          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Decrypt each habit                   │
│ for each row:                        │
│   payload = decrypt(ciphertext, masterKey, nonce) │
│   habit = {id, name, createdAt}    │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Update local cache                   │
│ storage.saveHabits(habits)           │
│ (so it works offline)                │
└─────────────────────────────────────┘
    ↓
✅ Return decrypted habits
```

### Loading Habit Logs

```
loadEncryptedHabitLogs(month, year)
    ↓
1. Generate monthBucket = HMAC(bucketKey, "YYYY-MM")
2. Query Supabase: WHERE month_bucket = ...
3. Decrypt each log
4. Return decrypted logs
```

### Loading Entries

```
loadEncryptedEntriesForMonth(year, month)
    ↓
1. Generate monthBucket = HMAC(bucketKey, "YYYY-MM")
2. Query Supabase: WHERE month_bucket = ...
3. Decrypt each entry (handles both old & new format)
4. Return decrypted entries
```

---

## 🔑 Key Concepts

### 1. **Two-Layer Encryption**

```
Layer 1: Master Key Encryption
- Master key encrypts your actual data (entries, habits)
- Master key is stored encrypted in Supabase

Layer 2: Password-Based Encryption
- Your password encrypts the master key
- Password is NEVER stored anywhere
```

### 2. **Buckets (Privacy Feature)**

Buckets hide actual dates from Supabase:

```
Actual date: "2026-01-20"
    ↓
HMAC-SHA256(bucketKey, "day:2026-01-20")
    ↓
Bucket: "a3f5b2c1d4e6f7a8b9c0d1e2f3a4b5c6"
```

**Why?** Supabase can't see your actual dates, only hashed buckets. This provides additional privacy.

### 3. **Local-First Architecture**

```
Every operation:
1. ✅ Save locally FIRST (AsyncStorage)
2. ✅ Then sync to cloud (if keyring unlocked)

This means:
- Works offline
- Fast local access
- Cloud sync is optional
```

### 4. **Keyring States**

```
🔒 LOCKED:
- masterKey = null
- bucketKey = null
- Data saved locally only
- No cloud sync

🔓 UNLOCKED:
- masterKey = <256-bit key>
- bucketKey = <256-bit key>
- Data syncs to cloud
- Can encrypt/decrypt
```

### 5. **Storage Locations**

```
┌─────────────────────────────────────┐
│ AsyncStorage (Local)                │
│ - Plaintext data                    │
│ - Fast access                       │
│ - Works offline                     │
│ - Lost if app deleted               │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ SecureStore (Local)                 │
│ - Cached masterKey/bucketKey        │
│ - Encrypted by OS                   │
│ - For app restart convenience       │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Supabase (Cloud)                    │
│ - Encrypted data only (ciphertext)  │
│ - Wrapped keys (encrypted master)   │
│ - Persists across devices           │
│ - Zero-knowledge (can't read data)  │
└─────────────────────────────────────┘
```

---

## 🔄 Complete Example: Saving an Entry

```
1. User types: "Had a great day!"
   ↓
2. Clicks Save
   ↓
3. handleSaveEntry() called
   ↓
4. Create entry object:
   {
     id: "1705785600000",
     date: "2026-01-20",
     text: "Had a great day!",
     mediaUrls: [],
     createdAt: "2026-01-20T12:00:00Z"
   }
   ↓
5. storage.saveDailyEntry(entry)
   → Saved to AsyncStorage (plaintext)
   ↓
6. Check: isKeyringUnlocked()?
   ✅ YES → Continue
   ❌ NO → Stop (saved locally only)
   ↓
7. Get all entries for "2026-01-20"
   → [entry1, entry2] (if multiple)
   ↓
8. Generate buckets:
   dayBucket = HMAC(bucketKey, "day:2026-01-20")
   monthBucket = HMAC(bucketKey, "month:2026-01")
   ↓
9. Create payload:
   {
     date: "2026-01-20",
     entries: [
       {id: "...", text: "...", createdAt: "..."}
     ]
   }
   ↓
10. Encrypt payload:
    {ciphertext, nonce} = AES-GCM(payload, masterKey)
    ↓
11. Save to Supabase:
    INSERT INTO entries (
      owner_id,
      day_bucket,
      month_bucket,
      ciphertext,
      nonce
    )
    ↓
12. ✅ Done!
    - Saved locally (fast access)
    - Saved to cloud (backup & sync)
```

---

## 🛡️ Security Guarantees

1. **Zero-Knowledge**: Supabase can't read your data (only ciphertext)
2. **Password Never Stored**: Only encrypted master key stored
3. **End-to-End Encryption**: Data encrypted before leaving device
4. **Bucket Privacy**: Dates are hashed, not stored in plaintext
5. **Local-First**: Works even if cloud is down

---

## 🐛 Debugging Tips

**Check keyring status:**

```javascript
import { isKeyringUnlocked } from "@/lib/e2ee/keyring";
console.log("Keyring unlocked?", isKeyringUnlocked());
```

**Check Supabase config:**

```javascript
import { isSupabaseConfigured } from "@/lib/supabase";
console.log("Supabase configured?", isSupabaseConfigured());
```

**View console logs:**

- `[DB]` = Database operations
- `[Keyring]` = Keyring operations
- Look for error messages with details

---

## 📊 Data Flow Diagram

```
┌─────────────┐
│   User      │
│  Action     │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  UI Component   │
│ (index.tsx)     │
└──────┬──────────┘
       │
       ▼
┌─────────────────────────┐
│ encrypted-storage.ts     │
│ saveEncryptedEntry()     │
└──────┬───────────────────┘
       │
       ├──────────────────┐
       │                  │
       ▼                  ▼
┌──────────────┐   ┌──────────────┐
│ Local Storage│   │   Keyring    │
│ (AsyncStorage│   │   Check      │
│  plaintext)  │   │              │
└──────────────┘   └──────┬────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  Encrypt     │
                  │  (crypto.ts) │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  Supabase   │
                  │  (ciphertext)│
                  └──────────────┘
```

---

This is the complete flow! Every piece of data goes through this encryption pipeline before hitting the cloud. 🚀
