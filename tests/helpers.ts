// Tiny test runner + assertion helpers — no extra deps.
//
// usage:
//   import { test, run } from "./helpers";
//   test("...", () => { ... });
//   await run();

import { performance } from "node:perf_hooks";

type TestFn = () => void | Promise<void>;

interface Test {
  name: string;
  fn: TestFn;
  only?: boolean;
}

const _tests: Test[] = [];
let _currentSuite = "";

export function suite(name: string): void {
  _currentSuite = name;
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

export function test(name: string, fn: TestFn): void {
  _tests.push({ name: _currentSuite ? `${_currentSuite}: ${name}` : name, fn });
}

export function only(name: string, fn: TestFn): void {
  _tests.push({
    name: _currentSuite ? `${_currentSuite}: ${name}` : name,
    fn,
    only: true,
  });
}

export function assertEq<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      `${msg ?? "assertEq failed"}: expected ${e}, got ${a}`,
    );
  }
}

export function assertBytesEq(
  actual: Uint8Array,
  expected: Uint8Array,
  msg?: string,
): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `${msg ?? "assertBytesEq failed"}: length ${actual.length} vs ${expected.length}`,
    );
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `${msg ?? "assertBytesEq failed"}: byte ${i} differs (${actual[i]} vs ${expected[i]})`,
      );
    }
  }
}

export function assertThrows(fn: () => unknown, expectedMsgPart?: string): void {
  try {
    fn();
  } catch (e) {
    if (expectedMsgPart) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes(expectedMsgPart)) {
        throw new Error(
          `Expected error containing "${expectedMsgPart}", got: ${msg}`,
        );
      }
    }
    return;
  }
  throw new Error("Expected fn to throw, but it didn't");
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  expectedMsgPart?: string,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (expectedMsgPart) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes(expectedMsgPart)) {
        throw new Error(
          `Expected error containing "${expectedMsgPart}", got: ${msg}`,
        );
      }
    }
    return;
  }
  throw new Error("Expected fn to reject, but it didn't");
}

export function assertTrue(v: unknown, msg?: string): asserts v {
  if (!v) throw new Error(msg ?? "assertTrue failed");
}

export async function run(): Promise<void> {
  const hasOnly = _tests.some((t) => t.only);
  const toRun = hasOnly ? _tests.filter((t) => t.only) : _tests;

  let pass = 0;
  let fail = 0;
  const failures: { name: string; err: string }[] = [];
  const slowest: { name: string; ms: number }[] = [];

  for (const t of toRun) {
    const t0 = performance.now();
    try {
      await t.fn();
      const elapsed = performance.now() - t0;
      slowest.push({ name: t.name, ms: elapsed });
      console.log(`  \x1b[32m✓\x1b[0m ${t.name} \x1b[90m(${elapsed.toFixed(0)}ms)\x1b[0m`);
      pass++;
    } catch (e) {
      const elapsed = performance.now() - t0;
      const msg = e instanceof Error ? e.stack || e.message : String(e);
      console.log(`  \x1b[31m✗\x1b[0m ${t.name} \x1b[90m(${elapsed.toFixed(0)}ms)\x1b[0m`);
      console.log(`    \x1b[31m${msg.split("\n").slice(0, 4).join("\n    ")}\x1b[0m`);
      fail++;
      failures.push({ name: t.name, err: msg.split("\n")[0] });
    }
  }

  console.log(
    `\n\x1b[1m${pass}/${pass + fail} passed\x1b[0m${fail > 0 ? `, \x1b[31m${fail} failed\x1b[0m` : ""}`,
  );

  // Top 5 slowest (only if positive)
  const top = slowest.sort((a, b) => b.ms - a.ms).slice(0, 5);
  if (top.length > 0 && top[0].ms > 50) {
    console.log("\nSlowest:");
    for (const s of top) {
      console.log(`  ${s.ms.toFixed(0)}ms  ${s.name}`);
    }
  }

  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  ✗ ${f.name}\n      ${f.err}`);
    }
    process.exit(1);
  }
}

export function bench(name: string, fn: () => unknown, iterations = 5): {
  name: string;
  mean: number;
  min: number;
  max: number;
} {
  // Warmup
  fn();
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { name, mean, min, max };
}
