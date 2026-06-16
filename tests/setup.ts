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

// 5. __DEV__ — Metro injects this global; Node does not, so `if (__DEV__)`
//    dev-log branches throw ReferenceError under tsx. Default false: the
//    branches are reachable (no crash) but stay silent during tests.
if (typeof (globalThis as { __DEV__?: boolean }).__DEV__ === "undefined") {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
}
