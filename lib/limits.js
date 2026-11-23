// Per-visitor limit for routes that call a paid model or write a row.
// The count lives in this process. A restart clears it.

function createLimiter(max, windowMs) {
  var hits = new Map();
  var cap = Number(max);
  var span = Number(windowMs);
  return function allow(key, now) {
    var time = now == null ? Date.now() : now;
    var id = String(key || "unknown");
    var bucket = hits.get(id);
    if (!bucket || time - bucket.start >= span) {
      bucket = { start: time, count: 0 };
      hits.set(id, bucket);
    }
    bucket.count += 1;
    return bucket.count <= cap;
  };
}

function clientKey(request) {
  var forwarded = request && request.headers && request.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim() || "unknown";
  var socket = request && request.socket;
  return (socket && socket.remoteAddress) || "unknown";
}

module.exports = {
  createLimiter: createLimiter,
  clientKey: clientKey
};
