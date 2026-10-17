import test from "node:test";
import assert from "node:assert/strict";
import { InputError, parseDownloadOptions, safeFilename, validateMediaUrl } from "../src/lib/validation.ts";

test("supports known platforms and removes unsafe fragments", () => {
  assert.equal(
    validateMediaUrl("http://www.youtube.com/watch?v=abc123#chapter"),
    "https://www.youtube.com/watch?v=abc123",
  );
  assert.equal(
    validateMediaUrl("https://m.tiktok.com/@example/video/123"),
    "https://m.tiktok.com/@example/video/123",
  );
});

test("rejects private, custom-port, credential and unrelated URLs", () => {
  for (const url of [
    "file:///etc/passwd", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data",
    "https://localhost/private", "https://youtube.com.evil.example/video",
    "https://user:password@youtube.com/", "https://youtube.com:8443/",
    "https://evil.example/?next=youtube.com", "not-a-url", "",
  ]) assert.throws(() => validateMediaUrl(url), InputError, url);
});

test("accepts known formats and rejects arbitrary options", () => {
  const value = parseDownloadOptions({
    url: "https://youtu.be/abc", format: "mp3", quality: "720", title: "Song",
  });
  assert.equal(value.format, "mp3");
  assert.equal(value.quality, "720");
  assert.equal(value.title, "Song");
  assert.throws(() => parseDownloadOptions({ url: value.url, format: "exe" }), InputError);
  assert.throws(() => parseDownloadOptions({ url: value.url, quality: "9999" }), InputError);
  assert.throws(() => parseDownloadOptions(null), InputError);
});

test("sanitizes filenames", () => {
  assert.equal(safeFilename("../Dangerous: name? / .."), "Dangerous name ..");
  assert.equal(safeFilename(".."), "download");
  assert.equal(safeFilename("   "), "download");
  assert.equal(safeFilename("My song (live)"), "My song (live)");
});
