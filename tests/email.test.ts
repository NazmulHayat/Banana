// Email sanity checks — pure, no network, no crypto.
//
// The suite that matters most here is "real addresses survive": the typo
// matcher's failure mode is telling someone their perfectly good address is
// wrong, which is worse than the typo it was meant to catch. Every domain in
// that block is a real, valid one that sits close to a common domain.

import "./setup";

import { checkEmail, isEmailShaped, normalizeEmail } from "../lib/email";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

suite("structure: only nonsense is rejected");

test("ordinary addresses pass clean", () => {
  for (const email of [
    "nazmul@gmail.com",
    "first.last@company.co.uk",
    "user+tag@fastmail.com",
    "a@b.io",
    "someone@sub.domain.org",
  ]) {
    const result = checkEmail(email);
    assertTrue(result.valid, `${email} should be valid`);
    assertEq(result.problem, undefined, `${email} should have no problem`);
  }
});

test("structural nonsense is invalid", () => {
  for (const email of [
    "",
    "   ",
    "notanemail",
    "no@tld",
    "@nolocal.com",
    "spaces in@gmail.com",
    "two@@at.com",
    "trailing@dot.com.",
    "double..dot@gmail.com",
    "dot.@gmail.com",
    "@.com",
    "dash@-leading.com",
  ]) {
    const result = checkEmail(email);
    assertEq(result.valid, false, `${email} should be invalid`);
    assertEq(result.problem, "invalid");
  }
});

test("normalize trims and lowercases", () => {
  assertEq(normalizeEmail("  Nazmul@GMAIL.com \n"), "nazmul@gmail.com");
  // The check itself normalizes, so casing never reaches a comparison.
  assertEq(checkEmail("  NAZMUL@GMAIL.COM ").valid, true);
});

suite("typos: the check that actually saves accounts");

test("common domain misspellings are caught with a fix", () => {
  const cases: [string, string][] = [
    ["me@gmial.com", "me@gmail.com"],
    ["me@gmai.com", "me@gmail.com"],
    ["me@gmail.con", "me@gmail.com"],
    ["me@gmail.cmo", "me@gmail.com"],
    ["me@yaho.com", "me@yahoo.com"],
    ["me@hotmial.com", "me@hotmail.com"],
    ["me@outlok.com", "me@outlook.com"],
    ["me@iclould.com", "me@icloud.com"],
  ];
  for (const [typed, expected] of cases) {
    const result = checkEmail(typed);
    assertEq(result.problem, "typo", `${typed} should read as a typo`);
    assertEq(result.suggestion, expected);
    // A warning is never a block — the user may know better than we do.
    assertTrue(result.valid, "a typo warning stays valid");
  }
});

test("the local part is preserved in the suggestion", () => {
  assertEq(
    checkEmail("first.last+tag@gmial.com").suggestion,
    "first.last+tag@gmail.com",
  );
});

test("real addresses near a common domain survive untouched", () => {
  // Each of these is a genuine domain that a sloppier matcher would "fix".
  for (const email of [
    "me@gmx.net", // not a broken gmx.com
    "me@mail.ru", // not a broken mail.com
    "me@live.co.uk", // not a broken live.com
    "me@zoho.eu",
    "me@aol.de",
    "me@hey.co",
    "me@me.co", // short domains only get one edit of slack
    "me@proton.me", // exact match on the list
    "me@icloud.com",
    "me@company.com",
    "me@yale.edu",
  ]) {
    const result = checkEmail(email);
    assertTrue(result.valid, `${email} should stay valid`);
    assertEq(
      result.problem,
      undefined,
      `${email} should not be flagged as a typo`,
    );
  }
});

suite("warnings: flagged, never blocked");

test("throwaway inboxes warn but pass", () => {
  const result = checkEmail("me@mailinator.com");
  assertTrue(result.valid, "disposable addresses are allowed");
  assertEq(result.problem, "disposable");
  assertTrue(!!result.message, "a warning needs copy to show");
});

test("outbound-only addresses warn but pass", () => {
  const result = checkEmail("noreply@gmail.com");
  assertTrue(result.valid);
  assertEq(result.problem, "undeliverable");
});

test("isEmailShaped only cares about structure", () => {
  assertEq(isEmailShaped("me@mailinator.com"), true);
  assertEq(isEmailShaped("me@gmial.com"), true);
  assertEq(isEmailShaped("nope"), false);
});

run();
