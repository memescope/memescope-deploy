// Web Worker for DexScreener price polling
// Runs in a separate thread — not throttled when tab is in background

var _activeSubs = {}; // guid -> { ca, interval }
var _dexCache = {};   // ca -> { data, ts }
var CACHE_TTL = 1500; // 1.5s dedup window

function fetchDex(ca) {
  var now = Date.now();
  if (_dexCache[ca] && (now - _dexCache[ca].ts) < CACHE_TTL) {
    return Promise.resolve(_dexCache[ca].data);
  }
  return fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      _dexCache[ca] = { data: d, ts: Date.now() };
      return d;
    });
}

self.onmessage = function(e) {
  var msg = e.data;

  if (msg.type === 'subscribe') {
    // Start polling for a token
    var guid = msg.guid;
    var ca = msg.ca;
    var intervalMs = msg.interval || 2000;

    // Clear existing if re-subscribing same guid
    if (_activeSubs[guid]) {
      clearInterval(_activeSubs[guid].interval);
    }

    var iv = setInterval(function() {
      fetchDex(ca).then(function(d) {
        self.postMessage({ type: 'tick', guid: guid, data: d });
      }).catch(function() {});
    }, intervalMs);

    // Fire immediately too
    fetchDex(ca).then(function(d) {
      self.postMessage({ type: 'tick', guid: guid, data: d });
    }).catch(function() {});

    _activeSubs[guid] = { ca: ca, interval: iv };
  }

  if (msg.type === 'unsubscribe') {
    var sub = _activeSubs[msg.guid];
    if (sub) {
      clearInterval(sub.interval);
      delete _activeSubs[msg.guid];
    }
  }

  if (msg.type === 'unsubscribeAll') {
    Object.keys(_activeSubs).forEach(function(guid) {
      clearInterval(_activeSubs[guid].interval);
    });
    _activeSubs = {};
  }
};
