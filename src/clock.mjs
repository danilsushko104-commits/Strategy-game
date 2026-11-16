// One shared notion of "now" for every device in the room.
// Device clocks drift, and a round that closes early writes an irreversible default decision.
// The page's own web server already knows the time: its HTTP `Date` header is the reference,
// so no extra service is needed. Opened from a file (no server), the device clock is used as is.

const SAMPLES = 3;
const state = {offset: 0, synced: false, error: "", rtt: null};

export function trueNow() {
  return Date.now() + state.offset;
}

export function clockStatus() {
  return {...state};
}

// Offset between the server and this device from one HEAD request.
// The Date header has 1 s resolution (the real time is header + [0, 1 s)), so add half a second.
// A cached response (CDN) ages: add the Age header. Assume a symmetric network delay.
export function offsetFromResponse(response, sentAt, receivedAt) {
  const header = Date.parse(response.headers.get("Date"));
  if (!Number.isFinite(header)) throw new Error("The server did not send a Date header.");
  const age = Number(response.headers.get("Age")) || 0;
  const serverTime = header + age * 1000 + 500;
  return {offset: serverTime - (sentAt + receivedAt) / 2, rtt: receivedAt - sentAt};
}

export async function syncClock({url = globalThis.location?.href, request = globalThis.fetch, now = Date.now} = {}) {
  if (!url || !/^https?:/.test(url) || typeof request !== "function") {
    state.error = "Open the page from the web to synchronize the clock.";
    throw new Error(state.error);
  }
  try {
    const samples = [];
    for (let index = 0; index < SAMPLES; index++) {
      const sentAt = now();
      const response = await request(url, {method: "HEAD", cache: "no-store"});
      samples.push(offsetFromResponse(response, sentAt, now()));
    }
    // The sample with the shortest round trip has the smallest delay uncertainty.
    const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    Object.assign(state, {offset: best.offset, rtt: best.rtt, synced: true, error: ""});
    return clockStatus();
  } catch (error) {
    state.error = error.message || "Clock synchronization failed.";
    throw error;
  }
}

export function resetClock() {
  Object.assign(state, {offset: 0, synced: false, error: "", rtt: null});
}
