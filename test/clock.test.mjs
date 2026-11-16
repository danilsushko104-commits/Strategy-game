import test from 'node:test';
import assert from 'node:assert/strict';
import { syncClock, offsetFromResponse, clockStatus, trueNow, resetClock } from '../src/clock.mjs';

const response = (date, age) => ({headers: {get: name => ({Date: date, Age: age})[name] ?? null}});

test("The offset uses the server Date header, half a second of rounding and the middle of the round trip", () => {
  const server = Date.parse("2026-11-14T15:30:00Z");
  // The device believes it is 30 s earlier than the server; the request took 200 ms.
  const sentAt = server - 30_000 - 100;
  const {offset, rtt} = offsetFromResponse(response(new Date(server).toUTCString()), sentAt, sentAt + 200);
  assert.equal(rtt, 200);
  assert.equal(offset, 30_000 + 500);
});

test("A cached CDN response is aged by its Age header", () => {
  const server = Date.parse("2026-11-14T15:30:00Z");
  const {offset} = offsetFromResponse(response(new Date(server).toUTCString(), "20"), server, server);
  assert.equal(offset, 20_000 + 500);
});

test("A response without a usable Date header is rejected", () => {
  assert.throws(() => offsetFromResponse(response(null), 0, 1), /Date header/);
  assert.throws(() => offsetFromResponse(response("not a date"), 0, 1), /Date header/);
});

test("syncClock keeps the sample with the shortest round trip and trueNow follows it", async () => {
  resetClock();
  const serverNow = Date.parse("2026-11-14T15:30:00Z");
  const deviceBehind = 45_000;
  let device = serverNow - deviceBehind;
  const delays = [900, 40, 400];
  let call = 0;
  const request = async () => {
    const delay = delays[call++];
    device += delay / 2;                       // request travels
    const date = new Date(Math.floor((device + deviceBehind) / 1000) * 1000).toUTCString();
    device += delay / 2;                       // response travels
    return response(date);
  };
  const status = await syncClock({url: "https://example.org/game", request, now: () => device});
  assert.equal(call, 3);
  assert.equal(status.synced, true);
  assert.equal(status.rtt, 40);
  // After the best sample the estimate is within the 1 s Date resolution of the real offset.
  assert.ok(Math.abs(status.offset - deviceBehind) <= 1000, "offset " + status.offset);
  assert.ok(Math.abs(trueNow() - (Date.now() + deviceBehind)) <= 1000);
  resetClock();
});

test("Without a web server the device clock stays in charge and the failure is reported", async () => {
  resetClock();
  await assert.rejects(syncClock({url: "file:///game.html", request: async () => { throw new Error("unreachable"); }}), /web/);
  assert.equal(clockStatus().synced, false);
  assert.ok(Math.abs(trueNow() - Date.now()) < 50);
  await assert.rejects(syncClock({url: "https://example.org/", request: async () => { throw new Error("offline"); }}), /offline/);
  assert.equal(clockStatus().error, "offline");
  assert.equal(clockStatus().offset, 0);
});
