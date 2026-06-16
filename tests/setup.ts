// Polyfills + mocks for running RN-targeted code in Node.

import { webcrypto } from "node:crypto";

// 1. crypto.getRandomValues — Node 19+ has globalThis.crypto, older needs polyfill
if (!globalThis.crypto) {
  // @ts-expect-error — assigning webcrypto to globalThis.crypto
  globalThis.crypto = webcrypto;
}

// 2. fetch — already global in Node 18+, no-op
// 3. TextEncoder / TextDecoder — already global in Node 18+
// 4. btoa / atob — already global in Node 16+
