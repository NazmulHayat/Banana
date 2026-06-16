# Aight Bet — Privacy Policy

_Last updated: June 12, 2026_

> **DRAFT — review before publishing.** Publish this on GitHub Pages, Notion, or any public URL, then point `PRIVACY_URL` in the app at it. Replace the contact email at the bottom.

Aight Bet is a private habit tracker and journal. Privacy isn't a feature we added — it's the architecture.

## The short version

- Your journal entries, habits, and habit history are **end-to-end encrypted on your device** before they ever reach our servers. We cannot read them. Nobody at Aight Bet can, even if we wanted to.
- Photos you attach are stored privately and are only accessible by your account, but are **not yet end-to-end encrypted**. Full photo encryption is planned for an upcoming release.
- We don't sell data, we don't run ads, and we don't use third-party analytics or trackers.

## What we store

| Data | How it's stored |
|---|---|
| Email address | Plaintext (needed for login and account recovery) |
| Password | Never stored — only a cryptographic hash, handled by our auth provider (Supabase) |
| Journal entries, habits, habit logs | Encrypted on your device with AES-256-GCM before upload. Even the dates of your entries are hidden from the server. |
| Photos | Stored in a private bucket only your account can access; encrypted at rest by our infrastructure, but not end-to-end encrypted yet |
| Username | Plaintext (so we can check availability) |

## How encryption works

When you create an account, your device generates a master encryption key. That key is locked with your password and a recovery key shown to you once. All journal and habit data is encrypted with this key **before leaving your phone**. The server only ever sees ciphertext.

This has a real consequence: **if you lose both your password and your recovery key, your data cannot be recovered — by you or by us.** That's not a policy choice; it's math.

## Where data lives

Data is hosted on Supabase infrastructure. Encrypted data is unreadable to Supabase and to us. Your email and account metadata are subject to Supabase's own security practices.

## What we don't do

- No ads, no ad networks
- No selling or sharing data with third parties
- No third-party analytics or tracking SDKs
- No reading your content — we can't

## Deleting your account

You can delete your account from the app (Profile → account settings). This permanently removes your account, all encrypted data, and all photos from our servers.

## Changes

If this policy changes materially, we'll note it in the app and update the date above.

## Contact

Questions: **support@YOURDOMAIN.com** _(replace before publishing)_
