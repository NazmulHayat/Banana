// Polyfills + mocks for running RN-targeted code in Node.

import { webcrypto } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// 0. Load .env.local (gitignored — holds SUPABASE_SERVICE_ROLE_KEY for
//    tests/e2e.test.ts) into process.env, same simple parse as
//    tests/e2e.test.ts uses for .env. Silent no-op if the file is absent;
//    never logs the parsed values.
const envLocalPath = path.join(__dirname, "..", ".env.local");
try {
  const envLocalText = fs.readFileSync(envLocalPath, "utf-8");
  for (const line of envLocalText.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim();
    }
  }
} catch {
  // .env.local not present — fine, e2e tests will report what's missing.
}

// 1. crypto.getRandomValues — Node 19+ has globalThis.crypto, older needs polyfill
if (!globalThis.crypto) {
  // @ts-expect-error — assigning webcrypto to globalThis.crypto
  globalThis.crypto = webcrypto;
}

// 2. fetch — already global in Node 18+, no-op
// 3. TextEncoder / TextDecoder — already global in Node 18+
// 4. btoa / atob — already global in Node 16+

// 5. __DEV__ — Metro injects this global; Node does not, so `if (__DEV__)`
//    dev-log branches throw ReferenceError under tsx. Default false: the
//    branches are reachable (no crash) but stay silent during tests.
if (typeof (globalThis as { __DEV__?: boolean }).__DEV__ === "undefined") {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
}
