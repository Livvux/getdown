import test from "node:test";
import assert from "node:assert/strict";
import { parseProgressLine } from "../src/lib/progress.ts";

test("parses byte progress, speed and ETA", () => {
  assert.deepEqual(parseProgressLine("DL|256|1024|NA|512.2|3"), {
    percent: 25, speedBytesPerSecond: 512.2, etaSeconds: 3,
  });
  assert.deepEqual(parseProgressLine("download:DL|100|NA|200|NA|NA"), {
    percent: 50, speedBytesPerSecond: null, etaSeconds: null,
  });
});

test("handles unknown values and invalid output", () => {
  assert.deepEqual(parseProgressLine("DL|NA|NA|NA|NA|NA"), {
    percent: null, speedBytesPerSecond: null, etaSeconds: null,
  });
  assert.deepEqual(parseProgressLine("DL|9999|1000|NA|0|0"), {
    percent: 100, speedBytesPerSecond: 0, etaSeconds: 0,
  });
  assert.equal(parseProgressLine("random output"), null);
  assert.equal(parseProgressLine("DL|1|2|3"), null);
});
