import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { requireJsonContentType } from "@/lib/http/require-json";

function req(contentType?: string): NextRequest {
  const headers = new Headers();
  if (contentType !== undefined) headers.set("content-type", contentType);
  return new NextRequest("https://tokenboard.sh/api/v1/profile", { method: "POST", headers });
}

test("accepts application/json (returns null = proceed)", () => {
  assert.equal(requireJsonContentType(req("application/json")), null);
});

test("accepts application/json with charset param", () => {
  assert.equal(requireJsonContentType(req("application/json; charset=utf-8")), null);
  assert.equal(requireJsonContentType(req("Application/JSON")), null); // case-insensitive media type
});

test("rejects the content-types a cross-site <form> can send (CSRF vectors) with 415", () => {
  for (const ct of [
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "text/plain",
    "text/plain;charset=UTF-8", // the default fetch() body content-type for a string
  ]) {
    const res = requireJsonContentType(req(ct));
    assert.ok(res, `expected a rejection for '${ct}'`);
    assert.equal(res!.status, 415);
  }
});

test("rejects a missing content-type with 415", () => {
  const res = requireJsonContentType(req(undefined));
  assert.ok(res);
  assert.equal(res!.status, 415);
});
