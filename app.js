
var APP_VERSION = '2.5.133';

// Image proxy — shrinks token images so they load fast even on bad wifi.
// DexScreener's CDN (98%+ of token images) natively resizes via query params,
// allowed buckets are 64/128/256. We rewrite the URL so the browser pulls a tiny
// webp straight from their fast CDN — no proxy hop, far fewer bytes.
function imgProxy(url, w, h) {
  if (!url) return '';
  var reqW = w || 64;
  if (url.indexOf('cdn.dexscreener.com') !== -1 || url.indexOf('dd.dexscreener.com') !== -1) {
    var bucket = reqW <= 48 ? 64 : (reqW <= 96 ? 128 : 256);
    try {
      var u = new URL(url);
      u.searchParams.set('width', bucket);
      u.searchParams.set('height', bucket);
      u.searchParams.set('quality', '70');
      u.searchParams.set('format', 'webp');
      return u.toString();
    } catch (e) { /* fall through to edge proxy */ }
  }
  // Other origins (coingecko, etc.) — route through our edge proxy for caching.
  return '/api/img?url=' + encodeURIComponent(url) + '&w=' + reqW + '&h=' + (h || reqW) + '&v=2';
}

var _scrollLockY = 0;
function lockScroll() {
  _scrollLockY = window.scrollY;
  document.body.classList.add('modal-open');
  document.body.style.top = -_scrollLockY + 'px';
}
function unlockScroll() {
  if (!document.body.classList.contains('modal-open')) return;
  // Keep the page locked while the multichart is still open — otherwise
  // closing a modal opened on top of it (wallet/ENS) releases the lock and
  // a scrollbar appears behind the overlay.
  if (document.body.classList.contains('mc-open')) return;
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, _scrollLockY);
}

// M3 animated modal close helper
// Adds .closing class, waits for animation/transition end, then removes both .open and .closing
function m3CloseOverlay(el, cb) {
  if (!el) { if (cb) cb(); return; }
  if (!el.classList.contains('open')) { if (cb) cb(); return; }
  var _fired = false;
  el.classList.add('closing');
  var onDone = function() {
    if (_fired) return;
    _fired = true;
    el.removeEventListener('animationend', onDone);
    el.removeEventListener('transitionend', onDone);
    el.classList.remove('open');
    el.classList.remove('closing');
    if (cb) cb();
  };
  el.addEventListener('animationend', onDone);
  el.addEventListener('transitionend', onDone);
  // Safety fallback — if neither event fires, clean up after 250ms
  setTimeout(function() {
    if (!_fired) onDone();
  }, 250);
}
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var meta = document.querySelector('meta[name="version"]');
    if (meta) meta.setAttribute('content', APP_VERSION);
    var footers = document.querySelectorAll('[data-version]');
    footers.forEach(function(el) { el.textContent = 'v' + APP_VERSION; });
  });
})();

// Sidebar nav pill animation (M3 style — grows from center)
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var allLinks = document.querySelectorAll('.ms-nav-link');
    allLinks.forEach(function(link){
      link.addEventListener('click', function(){
        allLinks.forEach(function(l){
          l.classList.remove('pill-animate');
          if(l !== link) l.classList.remove('active');
        });
        void link.offsetWidth;
        link.classList.add('pill-animate');
      });
    });
  });
})();

// Mechanical lock/unlock latch sound (synthesized — no audio assets).
// A short filtered-noise "click" (the latch) plus a low "thunk" (the bolt).
// Locking = firmer ka-chunk; unlocking = a single crisp click.
var _lockAudioCtx = null;
var _lockSoundEnabled = (function(){ try { return localStorage.getItem('lockSoundEnabled') !== '0'; } catch(e){ return true; } })();
function toggleLockSound(){
  _lockSoundEnabled = !_lockSoundEnabled;
  try { localStorage.setItem('lockSoundEnabled', _lockSoundEnabled ? '1' : '0'); } catch(e){}
  var btn = document.getElementById('msSoundToggle');
  if(btn){
    btn.classList.toggle('muted', !_lockSoundEnabled);
    btn.title = _lockSoundEnabled ? 'Sound effects on' : 'Sound effects off';
  }
  if(_lockSoundEnabled) _playLockSound(false); // preview when turning on
}
document.addEventListener('DOMContentLoaded', function(){
  var btn = document.getElementById('msSoundToggle');
  if(btn){
    btn.classList.toggle('muted', !_lockSoundEnabled);
    btn.title = _lockSoundEnabled ? 'Sound effects on' : 'Sound effects off';
  }
});
function _playLockSound(locked){
  try {
    if(!_lockSoundEnabled) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    if(!_lockAudioCtx) _lockAudioCtx = new AC();
    var ctx = _lockAudioCtx;
    if(ctx.state === 'suspended') ctx.resume();
    var now = ctx.currentTime;

    // A clean iPhone-style "tick": a very short noise impulse, lowpassed (not
    // ringy) with a high-pass to cut rumble, plus an optional short damped
    // "tock" tone that gives the click its body. Kept tiny and smooth.
    function tick(t, vol, cutoff, bodyFreq, bodyVol){
      var dur = 0.035;
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for(var i=0;i<len;i++){ data[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 2); }
      var src = ctx.createBufferSource(); src.buffer = buf;
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.7;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(ctx.destination);
      src.start(t); src.stop(t + dur);
      // Short damped tone for the "tock" body.
      if(bodyFreq){
        var osc = ctx.createOscillator();
        var og = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(bodyFreq, t);
        osc.frequency.exponentialRampToValueAtTime(bodyFreq * 0.7, t + 0.03);
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(bodyVol, t + 0.003);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
        osc.connect(og); og.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.05);
      }
    }

    if(locked){
      // Lock — the iPhone "tk-tunk": a light bright click, then a fuller one.
      tick(now,         0.095, 6500, 0,    0);     // crisp first tap
      tick(now + 0.055, 0.120, 4200, 720, 0.045);  // fuller second tap (with tock)
    } else {
      // Unlock — a single, slightly brighter clean click (matched level/tock).
      tick(now, 0.120, 7000, 900, 0.045);
    }
  } catch(e){}
}

// Sidebar lock toggle
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var btn = document.getElementById('sidebarLockBtn');
    if(!btn) return;
    var sidebar = btn.closest('.ms-sidebar');
    if(localStorage.getItem('sidebarLocked') === '1'){
      sidebar.classList.add('sidebar-locked');
      btn.title = 'Unlock sidebar';
    }
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      btn.classList.add('lock-animate');
      sidebar.classList.toggle('sidebar-locked');
      var locked = sidebar.classList.contains('sidebar-locked');
      btn.title = locked ? 'Unlock sidebar' : 'Lock sidebar';
      localStorage.setItem('sidebarLocked', locked ? '1' : '0');
      _playLockSound(locked);
      setTimeout(function(){ btn.classList.remove('lock-animate'); }, 600);
    });
  });
})();

// --- Admin Boost Check (server-side via Cloudflare KV) ---
var _serverBoosts = {}; // { ca_lowercase: { ca, sym, count, expiresAt } }
var _boostsFetched = false;

function _getAdminBoosts() {
  return _serverBoosts;
}

function _applyAdminBoosts(tokens) {
  var adminBoosts = _getAdminBoosts();
  for (var i = 0; i < tokens.length; i++) {
    var ca = (tokens[i].ca || '').toLowerCase();
    if (adminBoosts[ca]) {
      tokens[i].boosted = true;
      tokens[i].boostCount = adminBoosts[ca].count;
      tokens[i].boostCreatedAt = adminBoosts[ca].createdAt || 0;
    } else {
      tokens[i].boosted = false;
      tokens[i].boostCount = 0;
      tokens[i].boostCreatedAt = 0;
    }
  }
}

// Check if a specific token is admin-boosted (used at render time)
function _isAdminBoosted(ca) {
  var boosts = _getAdminBoosts();
  return boosts[(ca || '').toLowerCase()] || null;
}

// Fetch boosts from server API
function _fetchServerBoosts() {
  return fetch('/api/boosts')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var active = {};
      var boosts = data.boosts || [];
      var now = Date.now();
      for (var i = 0; i < boosts.length; i++) {
        if (boosts[i].expiresAt > now) {
          active[boosts[i].ca.toLowerCase()] = boosts[i];
        }
      }
      _serverBoosts = active;
      _boostsFetched = true;
      // Re-apply to current tokens if any loaded
      if (typeof LIVE_TOKENS !== 'undefined' && LIVE_TOKENS.length > 0) {
        _applyAdminBoosts(LIVE_TOKENS);
        _injectMissingBoostedTokens();
      }
      return active;
    })
    .catch(function(e) {
      console.log('MemeScope: Boost fetch error', e);
      return _serverBoosts;
    });
}

// Inject boosted tokens that aren't in LIVE_TOKENS by fetching from DexScreener
function _injectMissingBoostedTokens() {
  var boosts = _getAdminBoosts();
  var cas = Object.keys(boosts);
  if (!cas.length || typeof LIVE_TOKENS === 'undefined') return Promise.resolve();

  var missing = [];
  for (var i = 0; i < cas.length; i++) {
    var found = false;
    for (var j = 0; j < LIVE_TOKENS.length; j++) {
      if ((LIVE_TOKENS[j].ca || '').toLowerCase() === cas[i]) { found = true; break; }
    }
    if (!found) missing.push(boosts[cas[i]]);
  }

  if (!missing.length) return Promise.resolve();

  var fetches = missing.map(function(b) {
    var chain = b.chain || 'solana';
    return fetch('https://api.dexscreener.com/tokens/v1/' + chain + '/' + b.ca)
      .then(function(r) { return r.json(); })
      .then(function(pairs) {
        if (!pairs || !pairs.length) return null;
        // Pick the pair with highest liquidity
        var pair = pairs[0];
        for (var k = 1; k < pairs.length; k++) {
          if ((pairs[k].liquidity && pairs[k].liquidity.usd || 0) > (pair.liquidity && pair.liquidity.usd || 0)) {
            pair = pairs[k];
          }
        }
        var pc = pair.priceChange || {};
        var vol = pair.volume || {};
        var netMap = { solana: 'solana', ethereum: 'eth', base: 'base', bsc: 'bsc', sui: 'sui', tron: 'tron', arbitrum: 'arbitrum', avalanche: 'avalanche', polygon: 'polygon', optimism: 'optimism', blast: 'blast', ton: 'ton', seiv2: 'seiv2', pulsechain: 'pulsechain', sonic: 'sonic', hyperliquid: 'hyperliquid', berachain: 'berachain', monad: 'monad', cronos: 'cronos', aptos: 'aptos', linea: 'linea', zksync: 'zksync', fantom: 'fantom', mantle: 'mantle', scroll: 'scroll', manta: 'manta', starknet: 'starknet' };
        var token = {
          sym: pair.baseToken ? pair.baseToken.symbol : (b.sym || ''),
          name: pair.baseToken ? pair.baseToken.name : '',
          img: pair.info && pair.info.imageUrl ? pair.info.imageUrl : '',
          price: parseFloat(pair.priceUsd) || 0,
          mcap: pair.marketCap || pair.fdv || 0,
          vol: vol.h24 || 0,
          liq: pair.liquidity ? pair.liquidity.usd : 0,
          p5m: pc.m5 || 0,
          p1h: pc.h1 || 0,
          p6h: pc.h6 || 0,
          p24h: pc.h24 || 0,
          age: pair.pairCreatedAt ? _calcAge(pair.pairCreatedAt) : '?',
          txn: pair.txns ? (pair.txns.h24 ? pair.txns.h24.buys + pair.txns.h24.sells : 0) : 0,
          net: netMap[pair.chainId] || pair.chainId || 'solana',
          dex: pair.dexId || '',
          ca: pair.baseToken ? pair.baseToken.address : b.ca,
          pairAddress: pair.pairAddress || '',
          boosted: true,
          boostCount: b.count,
          social: 0,
          website: pair.info && pair.info.websites && pair.info.websites.length ? pair.info.websites[0].url : '',
          twitter: pair.info && pair.info.socials ? (pair.info.socials.find(function(s) { return s.type === 'twitter'; }) || {}).url || '' : ''
        };
        return token;
      })
      .catch(function(e) {
        console.log('MemeScope: Failed to fetch boosted token', b.ca, e);
        return null;
      });
  });

  return Promise.all(fetches).then(function(results) {
    var injected = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i]) {
        LIVE_TOKENS.push(results[i]);
        injected++;
      }
    }
    if (injected > 0) {
      console.log('MemeScope: Injected ' + injected + ' boosted token(s)');
      if (typeof loadData === 'function') loadData();
      if (typeof init === 'function') init();
    }
  });
}

// Helper to calc age string from timestamp
function _calcAge(ts) {
  var diff = Date.now() - ts;
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  var days = Math.floor(hrs / 24);
  if (days < 365) return days + 'd';
  return Math.floor(days / 365) + 'y';
}

// Fetch boosts on page load
_fetchServerBoosts();

// --- Price Worker (background thread for DexScreener polling) ---
var _priceWorker = null;
var _priceWorkerCallbacks = {};
try {
  _priceWorker = new Worker('/price-worker.js');
  _priceWorker.onmessage = function(e) {
    var msg = e.data;
    if (msg.type === 'tick' && _priceWorkerCallbacks[msg.guid]) {
      _priceWorkerCallbacks[msg.guid](msg.data);
    }
  };
} catch(e) { console.warn('Price worker failed to init:', e); }

// --- GeckoTerminal Pro API via server proxy (key stays server-side) ---
var _geckoQueue = [];
var _geckoRunning = 0;
var _geckoMaxConcurrent = 8; // Pro plan: 300 req/min — safe to run 8 concurrent
function geckoFetch(url, opts) {
  // Rewrite api.geckoterminal.com/api/v2/ → /api/gecko/ (our proxy)
  var proxyUrl = url.replace('https://api.geckoterminal.com/api/v2/', '/api/gecko/');
  return new Promise(function(resolve, reject) {
    _geckoQueue.push({ url: proxyUrl, opts: opts, resolve: resolve, reject: reject });
    _drainGeckoQueue();
  });
}
function _drainGeckoQueue() {
  while (_geckoRunning < _geckoMaxConcurrent && _geckoQueue.length > 0) {
    var item = _geckoQueue.shift();
    _geckoRunning++;
    fetch(item.url, item.opts).then(item.resolve).catch(item.reject).finally(function() {
      _geckoRunning--;
      _drainGeckoQueue();
    });
  }
}

// --- DexScreener API cache layer (3s TTL, deduplicates in-flight requests) ---
var _dexCache = {};
var _dexInflight = {};
var DEX_CACHE_TTL = 3000;
function fetchDexToken(ca) {
  var now = Date.now();
  if (_dexCache[ca] && (now - _dexCache[ca].ts) < DEX_CACHE_TTL) {
    return Promise.resolve(_dexCache[ca].data);
  }
  if (_dexInflight[ca]) return _dexInflight[ca];
  _dexInflight[ca] = fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      _dexCache[ca] = { data: d, ts: Date.now() };
      delete _dexInflight[ca];
      return d;
    })
    .catch(function(e) {
      delete _dexInflight[ca];
      throw e;
    });
  return _dexInflight[ca];
}

const CHAIN_ICONS = {
  'solana': '/img/chain_solana.png',
  'eth': '/img/chain_eth.png',
  'base': 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="264" height="264" viewBox="0 0 264 264" fill="none"><path d="M131.706 263.876C204.705 263.876 263.876 204.81 263.876 131.938C263.876 59.066 204.705 0 131.706 0C62.4541 0 5.64694 53.1764 0 120.845H174.697V143.032H0C5.64694 210.7 62.4541 263.876 131.706 263.876Z" fill="#0052FF"/></svg>'),
  'bsc': '/img/chain_bsc.png',
  'sui': 'https://dd.dexscreener.com/ds-data/chains/sui.png',
  'tron': 'https://dd.dexscreener.com/ds-data/chains/tron.png',
  'arbitrum': 'https://dd.dexscreener.com/ds-data/chains/arbitrum.png',
  'avalanche': 'https://dd.dexscreener.com/ds-data/chains/avalanche.png',
  'polygon': 'https://dd.dexscreener.com/ds-data/chains/polygon.png',
  'optimism': 'https://dd.dexscreener.com/ds-data/chains/optimism.png',
  'blast': 'https://dd.dexscreener.com/ds-data/chains/blast.png',
  'ton': 'https://dd.dexscreener.com/ds-data/chains/ton.png',
  'pulsechain': 'https://dd.dexscreener.com/ds-data/chains/pulsechain.png',
  'seiv2': 'https://dd.dexscreener.com/ds-data/chains/seiv2.png',
  'sonic': 'https://dd.dexscreener.com/ds-data/chains/sonic.png',
  'hyperliquid': 'https://dd.dexscreener.com/ds-data/chains/hyperliquid.png',
  'berachain': 'https://dd.dexscreener.com/ds-data/chains/berachain.png',
  'monad': 'https://dd.dexscreener.com/ds-data/chains/monad.png',
  'cronos': 'https://dd.dexscreener.com/ds-data/chains/cronos.png',
  'aptos': 'https://dd.dexscreener.com/ds-data/chains/aptos.png',
  'linea': 'https://dd.dexscreener.com/ds-data/chains/linea.png',
  'zksync': 'https://dd.dexscreener.com/ds-data/chains/zksync.png',
  'fantom': 'https://dd.dexscreener.com/ds-data/chains/fantom.png',
  'mantle': 'https://dd.dexscreener.com/ds-data/chains/mantle.png',
  'scroll': 'https://dd.dexscreener.com/ds-data/chains/scroll.png',
  'manta': 'https://dd.dexscreener.com/ds-data/chains/manta.png',
  'starknet': 'https://dd.dexscreener.com/ds-data/chains/starknet.png',
};
const CHAIN_COLORS = {
  'solana': '#3dc0bc',
  'eth': '#62688f',
  'base': '#0052ff',
  'bsc': '#f0b90b',
  'sui': '#4ca3ff',
  'tron': '#ff0014',
  'arbitrum': '#7d9db7',
  'avalanche': '#e84142',
  'polygon': '#8247e5',
  'optimism': '#ff0420',
  'blast': '#fbfd0e',
  'ton': '#0099e8',
  'pulsechain': '#ec11a5',
  'seiv2': '#9c1d18',
  'sonic': '#1db1f5',
  'hyperliquid': '#00e676',
  'berachain': '#d4a24e',
  'monad': '#836EF9',
  'cronos': '#002D74',
  'aptos': '#2dd8a3',
  'linea': '#61dfff',
  'zksync': '#8c8dfc',
  'fantom': '#1969ff',
  'mantle': '#000000',
  'scroll': '#ffeeda',
  'manta': '#1e7cdb',
  'starknet': '#ec796b',
};
const DEX_ICONS = {
  'raydium': 'https://dd.dexscreener.com/ds-data/dexes/raydium.png',
  'pumpswap': 'https://dd.dexscreener.com/ds-data/dexes/pumpswap.png',
  'uniswap': 'https://dd.dexscreener.com/ds-data/dexes/uniswap.png',
  'pancakeswap': 'https://dd.dexscreener.com/ds-data/dexes/pancakeswap.png',
  'meteora': 'https://dd.dexscreener.com/ds-data/dexes/meteora.png',
};
const GRADIENTS = [
  '#FF6B6B,#FF8E53','#4ECDC4,#44B09E','#A18CD1,#FBC2EB','#FF9A9E,#FAD0C4',
  '#667EEA,#764BA2','#F093FB,#F5576C','#4FACFE,#00F2FE','#43E97B,#38F9D7',
  '#FA709A,#FEE140','#A1C4FD,#C2E9FB','#D4FC79,#96E6A1','#84FAB0,#8FD3F4',
  '#FCCB90,#D57EEB','#E0C3FC,#8EC5FC','#F5576C,#FF6B6B','#667EEA,#43E97B',
  '#4FACFE,#FA709A','#FF9A9E,#A18CD1','#FEE140,#4ECDC4','#C2E9FB,#F093FB',
];

function fmt(n) {
  if (!n || isNaN(n)) return '-';
  if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}
function fmtNum(n) {
  if (!n || isNaN(n)) return '-';
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}
function fmtPrice(n) {
  if (!n || isNaN(n)) return '-';
  if (n < 0.0001) return '$' + n.toFixed(8);
  if (n < 0.01) return '$' + n.toFixed(6);
  if (n < 1) return '$' + n.toFixed(4);
  if (n < 1000) return '$' + n.toFixed(2);
  return '$' + n.toLocaleString(undefined, {maximumFractionDigits:2});
}
function pctCell(val) {
  if (val === null || val === undefined || isNaN(val)) return {bg:'transparent', color:'rgba(255,255,255,0.35)', text:'-'};
  var v = Math.max(-9999, Math.min(9999, parseFloat(val)));
  var textColor;
  if (v >= 0) {
    textColor = 'var(--green)';
  } else {
    textColor = 'var(--red)';
  }
  if (Math.abs(v) < 0.5) {
    textColor = 'rgba(255,255,255,0.4)';
  }
  var text = (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  return {bg: 'transparent', color: textColor, text: text};
}

function pctTd(val) {
  var d = pctCell(val);
  return '<td style="background:' + d.bg + ';color:' + d.color + ';text-align:right;font-weight:600;font-size:13.5px;padding:3px 14px">' + d.text + '</td>';
}

const LIVE_TOKENS = [];

// ========== FILTER STATE ==========
let currentTimeframe = '1h';
let currentCategory = 'trending';
let currentChain = 'all';
let currentSort = { col: null, asc: false };

// Age string to hours for sorting
function ageToHours(a) {
  const n = parseFloat(a);
  if (a.includes('y')) return n * 8760;
  if (a.includes('mo')) return n * 720;
  if (a.includes('w')) return n * 168;
  if (a.includes('d')) return n * 24;
  if (a.includes('h')) return n;
  if (a.includes('m')) return n / 60;
  return 9999;
}
function fmtAge(a) {
  if (!a) return '\u2014';
  if (a.includes('mo')) {
    var n = parseInt(a);
    if (n >= 12) {
      var y = Math.floor(n / 12);
      var rem = n % 12;
      return rem > 0 ? y + 'y ' + rem + 'mo' : y + 'y';
    }
  }
  return a;
}

function setTimeframe(tf) {
  currentTimeframe = tf;
  var group = document.getElementById('tfGroup');
  group.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  updateTfSlider();
  // Collapse mobile dropdown after selection
  var fg = document.querySelector('.filter-group');
  if(fg) fg.classList.remove('mobile-expanded');
  loadData();
  if(typeof init === 'function') init();
}
function updateTfSlider() {
  var group = document.getElementById('tfGroup');
  var slider = document.getElementById('tfSlider');
  if (!group || !slider) return;
  var active = group.querySelector('.filter-btn.active');
  if (!active) { slider.style.opacity = '0'; return; }
  var gRect = group.getBoundingClientRect();
  var aRect = active.getBoundingClientRect();
  slider.style.left = (aRect.left - gRect.left) + 'px';
  slider.style.width = aRect.width + 'px';
  slider.style.opacity = '1';
}
// Position the slider at the preset timeframe immediately (transitions are
// off until #tfGroup gets .tf-anim), so on refresh it appears directly under
// the active pill instead of sliding in from the first one. We reposition on
// load to stay aligned once web fonts settle, then enable click animations.
function _enableTfAnim() {
  var group = document.getElementById('tfGroup');
  if (group) requestAnimationFrame(function() { group.classList.add('tf-anim'); });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateTfSlider);
} else {
  updateTfSlider();
}
window.addEventListener('load', function() {
  updateTfSlider();          // re-align after fonts/layout settle (still instant)
  _enableTfAnim();           // enable click animations only after settling
});
window.addEventListener('resize', updateTfSlider);

// Mobile: tap active timeframe to expand/collapse options
document.addEventListener('click', function(e) {
  if(window.innerWidth > 768) return;
  var btn = e.target.closest('.filter-group .filter-btn.active');
  if(btn) {
    var fg = btn.closest('.filter-group');
    if(fg && !fg.classList.contains('mobile-expanded')) {
      e.preventDefault();
      e.stopPropagation();
      fg.classList.add('mobile-expanded');
      return;
    }
  }
  // Click outside collapses
  var fg = document.querySelector('.filter-group.mobile-expanded');
  if(fg && !fg.contains(e.target)) fg.classList.remove('mobile-expanded');
});


function setCategory(el, cat) {
  currentCategory = cat;
  currentPage = 1;
  _lastRowOrder = null;
  document.querySelectorAll('.filter-chip').forEach(function(b) { b.classList.remove('active-chip'); b.classList.remove('chip-animate'); });
  void el.offsetWidth;
  el.classList.add('chip-animate');
  el.classList.add('active-chip');
  // Sync leaf icon active state
  var leaf = document.getElementById('navNewPairs');
  if (leaf) leaf.classList.toggle('active', cat === 'new');
  loadData();
  if(typeof init === 'function') init();
}

function toggleNewPairs() {
  var leaf = document.getElementById('navNewPairs');
  var mobileLeaf = document.getElementById('mobileNavNewPairs');
  if (currentCategory === 'new') {
    // Turn off — go back to trending
    currentCategory = 'trending';
    if (leaf) leaf.classList.remove('active');
    if (mobileLeaf) mobileLeaf.classList.remove('active');
    // Re-activate the Top chip
    var chips = document.querySelectorAll('.filter-chip');
    chips.forEach(function(c) {
      c.classList.remove('active-chip');
      if (c.textContent.trim().indexOf('Top') !== -1 || c.getAttribute('onclick')?.includes("'trending'")) c.classList.add('active-chip');
    });
  } else {
    // Turn on — filter to new pairs (< 1h old)
    currentCategory = 'new';
    if (leaf) leaf.classList.add('active');
    if (mobileLeaf) mobileLeaf.classList.add('active');
    // Remove active from filter chips
    document.querySelectorAll('.filter-chip').forEach(function(b) { b.classList.remove('active-chip'); });
    // Reset chain to all and deactivate chain icons
    currentChain = 'all';
    document.querySelectorAll('.ms-nav-link[onclick*="toggleChain"], .ms-mobile-item[onclick*="toggleChain"]').forEach(function(b) { b.classList.remove('active'); });
    var btn = document.querySelector('.topbar-btn[onclick*="toggleChainFilter"]');
    if (btn) btn.innerHTML = _chainLinkSvg + 'Hot Chains ▾';
  }
  currentPage = 1;
  _lastRowOrder = null;
  loadData();
  if (typeof init === 'function') init();
}

function toggleChainFilter() {
  const dd = document.getElementById('chain-dropdown-menu');
  const ldd = document.getElementById('launchpad-dropdown-menu');
  // Rebuild dropdown with only chains that have active tokens
  var activeChains = {};
  if (typeof LIVE_TOKENS !== 'undefined') {
    LIVE_TOKENS.forEach(function(t) {
      if (t.net) activeChains[t.net] = (activeChains[t.net] || 0) + 1;
    });
  }
  var chainOrder = ['solana','eth','base','bsc','sui','tron','arbitrum','avalanche','polygon','optimism','blast','ton','pulsechain','seiv2','sonic','hyperliquid','berachain','monad','cronos','aptos','linea','zksync','fantom','mantle','scroll','manta','starknet'];
  var chainNames = {'solana':'Solana','eth':'Ethereum','base':'Base','bsc':'BSC','sui':'Sui','tron':'Tron','arbitrum':'Arbitrum','avalanche':'Avalanche','polygon':'Polygon','optimism':'Optimism','blast':'Blast','ton':'TON','pulsechain':'Pulsechain','seiv2':'Sei','sonic':'Sonic','hyperliquid':'Hyperliquid','berachain':'Berachain','monad':'Monad','cronos':'Cronos','aptos':'Aptos','linea':'Linea','zksync':'zkSync','fantom':'Fantom','mantle':'Mantle','scroll':'Scroll','manta':'Manta','starknet':'Starknet'};
  var chainDexImg = {'solana':'solana','eth':'ethereum','base':'base','bsc':'bsc','sui':'sui','tron':'tron','arbitrum':'arbitrum','avalanche':'avalanche','polygon':'polygon','optimism':'optimism','blast':'blast','ton':'ton','pulsechain':'pulsechain','seiv2':'seiv2','sonic':'sonic','hyperliquid':'hyperliquid','berachain':'berachain','monad':'monad','cronos':'cronos','aptos':'aptos','linea':'linea','zksync':'zksync','fantom':'fantom','mantle':'mantle','scroll':'scroll','manta':'manta','starknet':'starknet'};
  var html = '<button class="dropdown-item' + (currentChain === 'all' ? ' active' : '') + '" onclick="toggleChain(this,\'all\')">All Chains</button>';
  var baseLogoSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='264' height='264' viewBox='0 0 264 264' fill='none'%3E%3Cpath d='M131.706 263.876C204.705 263.876 263.876 204.81 263.876 131.938C263.876 59.066 204.705 0 131.706 0C62.4541 0 5.64694 53.1764 0 120.845H174.697V143.032H0C5.64694 210.7 62.4541 263.876 131.706 263.876Z' fill='%230052FF'/%3E%3C/svg%3E";
  chainOrder.forEach(function(c) {
    if (!activeChains[c]) return;
    var imgSrc = c === 'base' ? baseLogoSvg : 'https://dd.dexscreener.com/ds-data/chains/' + (chainDexImg[c] || c) + '.png';
    html += '<button class="dropdown-item' + (currentChain === c ? ' active' : '') + '" onclick="toggleChain(this,\'' + c + '\')">' +
      '<img src="' + imgSrc + '" width="16" height="16" style="border-radius:50%"> ' +
      (chainNames[c] || c) + '</button>';
  });
  dd.innerHTML = html;
  dd.classList.toggle('open');
  if (ldd) ldd.classList.remove('open');
}

// On mobile, move chain dropdown to document.body so it escapes all overflow clipping
if (window.innerWidth <= 768) {
  setTimeout(function() {
    var dd = document.getElementById('chain-dropdown-menu');
    if (dd) {
      document.body.appendChild(dd);
    }
    // Replace the button's onclick directly to bypass function declaration scoping
    var btn = document.querySelector('.topbar-btn[onclick*="toggleChainFilter"]');
    if (btn) {
      btn.removeAttribute('onclick');
      btn.addEventListener('click', function() {
        var dd = document.getElementById('chain-dropdown-menu');
        if (!dd) return;
        // Rebuild dropdown content (same logic as original toggleChainFilter)
        var activeChains = {};
        if (typeof LIVE_TOKENS !== 'undefined') {
          LIVE_TOKENS.forEach(function(t) { if (t.net) activeChains[t.net] = (activeChains[t.net] || 0) + 1; });
        }
        var chainOrder = ['solana','eth','base','bsc','sui','tron','arbitrum','avalanche','polygon','optimism','blast','ton','pulsechain','seiv2','sonic','hyperliquid','berachain','monad','cronos','aptos','linea','zksync','fantom','mantle','scroll','manta','starknet'];
        var chainNames = {'solana':'Solana','eth':'Ethereum','base':'Base','bsc':'BSC','sui':'Sui','tron':'Tron','arbitrum':'Arbitrum','avalanche':'Avalanche','polygon':'Polygon','optimism':'Optimism','blast':'Blast','ton':'TON','pulsechain':'Pulsechain','seiv2':'Sei','sonic':'Sonic','hyperliquid':'Hyperliquid','berachain':'Berachain','monad':'Monad','cronos':'Cronos','aptos':'Aptos','linea':'Linea','zksync':'zkSync','fantom':'Fantom','mantle':'Mantle','scroll':'Scroll','manta':'Manta','starknet':'Starknet'};
        var chainDexImg = {'solana':'solana','eth':'ethereum','base':'base','bsc':'bsc','sui':'sui','tron':'tron','arbitrum':'arbitrum','avalanche':'avalanche','polygon':'polygon','optimism':'optimism','blast':'blast','ton':'ton','pulsechain':'pulsechain','seiv2':'seiv2','sonic':'sonic','hyperliquid':'hyperliquid','berachain':'berachain','monad':'monad','cronos':'cronos','aptos':'aptos','linea':'linea','zksync':'zksync','fantom':'fantom','mantle':'mantle','scroll':'scroll','manta':'manta','starknet':'starknet'};
        var baseLogoSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='264' height='264' viewBox='0 0 264 264' fill='none'%3E%3Cpath d='M131.706 263.876C204.705 263.876 263.876 204.81 263.876 131.938C263.876 59.066 204.705 0 131.706 0C62.4541 0 5.64694 53.1764 0 120.845H174.697V143.032H0C5.64694 210.7 62.4541 263.876 131.706 263.876Z' fill='%230052FF'/%3E%3C/svg%3E";
        var html = '<button class="dropdown-item' + (currentChain === 'all' ? ' active' : '') + '" onclick="toggleChain(this,\'all\')">All Chains</button>';
        chainOrder.forEach(function(c) {
          if (!activeChains[c]) return;
          var imgSrc = c === 'base' ? baseLogoSvg : 'https://dd.dexscreener.com/ds-data/chains/' + (chainDexImg[c] || c) + '.png';
          html += '<button class="dropdown-item' + (currentChain === c ? ' active' : '') + '" onclick="toggleChain(this,\'' + c + '\')">' +
            '<img src="' + imgSrc + '" width="16" height="16" style="border-radius:50%"> ' + (chainNames[c] || c) + '</button>';
        });
        dd.innerHTML = html;
        var isOpen = dd.classList.contains('open');
        if (!isOpen) {
          var r = btn.getBoundingClientRect();
          dd.style.position = 'fixed';
          dd.style.top = (r.bottom + 4) + 'px';
          dd.style.right = '16px';
          dd.style.left = 'auto';
          dd.style.zIndex = '9999';
          dd.classList.add('open');
          dd.style.display = 'flex';
          dd.style.flexDirection = 'column';
          var ldd = document.getElementById('launchpad-dropdown-menu');
          if (ldd) ldd.classList.remove('open');
          // Close on scroll
          var scrollHandler = function() {
            dd.classList.remove('open');
            dd.style.display = 'none';
            window.removeEventListener('scroll', scrollHandler);
          };
          window.addEventListener('scroll', scrollHandler, { passive: true });
        } else {
          dd.classList.remove('open');
          dd.style.display = 'none';
        }
      });
    }
  }, 100);
}

function toggleLaunchpadFilter() {
  const ldd = document.getElementById('launchpad-dropdown-menu');
  const dd = document.getElementById('chain-dropdown-menu');
  ldd.classList.toggle('open');
  dd.classList.remove('open');
}

var _chainLinkSvg = '<svg width="14" height="14" viewBox="0 0 100 100" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M34.971 61.094l-11.303 11.303c-1.087 1.087-2.85 1.087-3.937 0l-4.497-4.497c-1.087-1.087-1.087-2.85 0-3.937l24.364-24.364c1.087-1.087 2.85-1.087 3.937 0l14.709 14.71c3.874-5.72 3.283-13.583-1.779-18.646l-4.497-4.497c-5.735-5.735-15.067-5.735-20.803 0L6.802 55.53c-5.735 5.735-5.735 15.067 0 20.803l4.497 4.497c5.735 5.735 15.067 5.735 20.803 0l10.027-10.027-2.53-2.53c-2.09-2.09-3.638-4.546-4.627-7.18z"/><path d="M93.198 23.668l-4.497-4.497c-5.735-5.735-15.067-5.735-20.803 0L57.872 29.197l2.53 2.53c2.09 2.09 3.637 4.547 4.627 7.18l11.303-11.303c1.087-1.087 2.85-1.087 3.937 0l4.497 4.497c1.087 1.087 1.087 2.85 0 3.937L60.402 60.401c-1.087 1.087-2.85 1.087-3.937 0l-14.709-14.71c-3.874 5.72-3.284 13.583 1.779 18.646l4.497 4.497c5.735 5.735 15.068 5.735 20.803 0l24.364-24.364c5.735-5.735 5.735-15.067 0-20.803z"/></svg>';

function toggleChain(el, chain) {
  currentChain = chain;
  _lastRowOrder = null;
  // Deactivate leaf if active
  if (currentCategory === 'new') {
    currentCategory = 'trending';
    var leaf = document.getElementById('navNewPairs');
    if (leaf) leaf.classList.remove('active');
    var mobileLeaf = document.getElementById('mobileNavNewPairs');
    if (mobileLeaf) mobileLeaf.classList.remove('active');
    var chips = document.querySelectorAll('.filter-chip');
    chips.forEach(function(c) {
      c.classList.remove('active-chip');
      if (c.getAttribute('onclick')?.includes("'trending'") || c.textContent.trim().indexOf('Top') !== -1) c.classList.add('active-chip');
    });
  }
  document.getElementById('chain-dropdown-menu').querySelectorAll('.dropdown-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.ms-nav-link[onclick*="toggleChain"], .ms-mobile-item[onclick*="toggleChain"]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  // Sync sidebar active state when chain is selected from dropdown
  var sidebarMatch = document.querySelector('.ms-nav-link[onclick*="toggleChain(this,\'' + chain + '\')"]');
  if (sidebarMatch) sidebarMatch.classList.add('active');
  var ddEl = document.getElementById('chain-dropdown-menu');
  ddEl.classList.remove('open');
  ddEl.style.display = '';
  // Update button label to show selected chain with logo
  var chainNames = {'all':'Hot Chains','solana':'Solana','eth':'Ethereum','base':'Base','bsc':'BSC','sui':'Sui','arbitrum':'Arbitrum','avalanche':'Avalanche','polygon':'Polygon','optimism':'Optimism','blast':'Blast','ton':'TON','tron':'Tron','pulsechain':'Pulsechain','seiv2':'Sei','sonic':'Sonic','hyperliquid':'Hyperliquid','berachain':'Berachain','monad':'Monad','cronos':'Cronos','aptos':'Aptos','linea':'Linea','zksync':'zkSync','fantom':'Fantom','mantle':'Mantle','scroll':'Scroll','manta':'Manta','starknet':'Starknet'};
  var _clogo = function(c){ return '<img src="https://dd.dexscreener.com/ds-data/chains/'+c+'.png" width="14" height="14" style="border-radius:50%;vertical-align:-2px;margin-right:4px">'; };
  var chainLogos = {
    'solana':_clogo('solana'),'eth':_clogo('ethereum'),'base':'<img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'264\' height=\'264\' viewBox=\'0 0 264 264\' fill=\'none\'%3E%3Cpath d=\'M131.706 263.876C204.705 263.876 263.876 204.81 263.876 131.938C263.876 59.066 204.705 0 131.706 0C62.4541 0 5.64694 53.1764 0 120.845H174.697V143.032H0C5.64694 210.7 62.4541 263.876 131.706 263.876Z\' fill=\'%230052FF\'/%3E%3C/svg%3E" width="14" height="14" style="border-radius:50%;vertical-align:-2px;margin-right:4px">',
    'bsc':_clogo('bsc'),'sui':_clogo('sui'),
    'arbitrum':_clogo('arbitrum'),'avalanche':_clogo('avalanche'),
    'polygon':_clogo('polygon'),'optimism':_clogo('optimism'),
    'blast':_clogo('blast'),'ton':_clogo('ton'),
    'tron':_clogo('tron'),'pulsechain':_clogo('pulsechain'),'seiv2':_clogo('seiv2'),
    'sonic':_clogo('sonic'),'hyperliquid':_clogo('hyperliquid'),'berachain':_clogo('berachain'),
    'monad':_clogo('monad'),'cronos':_clogo('cronos'),'aptos':_clogo('aptos'),
    'linea':_clogo('linea'),'zksync':_clogo('zksync'),'fantom':_clogo('fantom'),
    'mantle':_clogo('mantle'),'scroll':_clogo('scroll'),'manta':_clogo('manta'),'starknet':_clogo('starknet')
  };
  var btn = document.querySelector('.topbar-btn[onclick*="toggleChainFilter"]');
  if(btn) {
    var prefix = chain === 'all' ? _chainLinkSvg : (chainLogos[chain] || '');
    btn.innerHTML = prefix + (chainNames[chain] || 'Hot Chains') + ' ▾';
  }
  currentPage = 1;
  loadData();
  if(typeof init === 'function') init();
}

let currentLaunchpad = 'all';
function toggleLaunchpad(el, pad) {
  currentLaunchpad = pad;
  document.getElementById('launchpad-dropdown-menu').querySelectorAll('.dropdown-item').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('launchpad-dropdown-menu').classList.remove('open');
  if(typeof init === 'function') init();
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.filter-dropdown-wrap')) {
    document.querySelectorAll('.filter-dropdown-menu').forEach(m => m.classList.remove('open'));
  }
});

// ═══ TABLE CUSTOMIZER ═══
var TC_DEFAULT_COLS = [
  { key: 'price', label: 'Price', locked: false, visible: true },
  { key: 'age', label: 'Age', locked: false, visible: true },
  { key: 'vol', label: 'Volume', locked: false, visible: true },
  { key: 'p5m', label: '5M', locked: false, visible: true },
  { key: 'p1h', label: '1H', locked: false, visible: true },
  { key: 'p6h', label: '6H', locked: false, visible: true },
  { key: 'p24h', label: '24H', locked: false, visible: true },
  { key: 'mcap', label: 'MCap', locked: false, visible: true }
];
var _tcCols = null;
function _tcLoad() {
  try {
    var s = localStorage.getItem('ms-table-cols-v3');
    if (s) return JSON.parse(s);
  } catch(e) {}
  return null;
}
function _tcSave(cols) {
  try { localStorage.setItem('ms-table-cols-v3', JSON.stringify(cols)); } catch(e) {}
}
function _tcGetCols() {
  if (!_tcCols) _tcCols = _tcLoad() || TC_DEFAULT_COLS.map(function(c) { return {key:c.key, label:c.label, locked:c.locked, visible:c.visible}; });
  return _tcCols;
}

function openTableCustomizer() {
  // Toggle filled icon
  var btn = document.querySelector('.table-edit-btn');
  if (btn) {
    var outline = btn.querySelector('.table-edit-outline');
    var filled = btn.querySelector('.table-edit-filled');
    if (outline) outline.style.display = 'none';
    if (filled) filled.style.display = '';
  }
  _tcCols = _tcGetCols();
  _tcRender();
  document.getElementById('tcOverlay').classList.add('open');
  lockScroll();
}
function closeTableCustomizer() {
  var ov = document.getElementById('tcOverlay');
  m3CloseOverlay(ov, function() {
    unlockScroll();
    var btn = document.querySelector('.table-edit-btn');
    if (btn) {
      var outline = btn.querySelector('.table-edit-outline');
      var filled = btn.querySelector('.table-edit-filled');
      if (outline) outline.style.display = '';
      if (filled) filled.style.display = 'none';
    }
  });
}
function _tcRender() {
  var list = document.getElementById('tcList');
  var html = '';
  // Token is always first & locked
  html += '<div class="tc-row" style="opacity:0.35;cursor:default"><div class="tc-drag-handle"><svg width="12" height="12" viewBox="0 -960 960 960" fill="currentColor"><path d="M360-160q-33 0-56.5-23.5T280-240q0-33 23.5-56.5T360-320q33 0 56.5 23.5T440-240q0 33-23.5 56.5T360-160Zm240 0q-33 0-56.5-23.5T520-240q0-33 23.5-56.5T600-320q33 0 56.5 23.5T680-240q0 33-23.5 56.5T600-160ZM360-400q-33 0-56.5-23.5T280-480q0-33 23.5-56.5T360-560q33 0 56.5 23.5T440-480q0 33-23.5 56.5T360-400Zm240 0q-33 0-56.5-23.5T520-480q0-33 23.5-56.5T600-560q33 0 56.5 23.5T680-480q0 33-23.5 56.5T600-400ZM360-640q-33 0-56.5-23.5T280-720q0-33 23.5-56.5T360-800q33 0 56.5 23.5T440-720q0 33-23.5 56.5T360-640Zm240 0q-33 0-56.5-23.5T520-720q0-33 23.5-56.5T600-800q33 0 56.5 23.5T680-720q0 33-23.5 56.5T600-640Z"/></svg></div><span class="tc-num">1</span><span class="tc-col-name">Token</span><span class="tc-locked">Pinned</span></div>';
  html += '<div class="tc-sep"></div>';
  _tcCols.forEach(function(col, i) {
    html += '<div class="tc-row' + (col.visible ? '' : ' disabled') + '" draggable="true" data-idx="' + i + '">';
    html += '<div class="tc-drag-handle"><svg width="12" height="12" viewBox="0 -960 960 960" fill="currentColor"><path d="M360-160q-33 0-56.5-23.5T280-240q0-33 23.5-56.5T360-320q33 0 56.5 23.5T440-240q0 33-23.5 56.5T360-160Zm240 0q-33 0-56.5-23.5T520-240q0-33 23.5-56.5T600-320q33 0 56.5 23.5T680-240q0 33-23.5 56.5T600-160ZM360-400q-33 0-56.5-23.5T280-480q0-33 23.5-56.5T360-560q33 0 56.5 23.5T440-480q0 33-23.5 56.5T360-400Zm240 0q-33 0-56.5-23.5T520-480q0-33 23.5-56.5T600-560q33 0 56.5 23.5T680-480q0 33-23.5 56.5T600-400ZM360-640q-33 0-56.5-23.5T280-720q0-33 23.5-56.5T360-800q33 0 56.5 23.5T440-720q0 33-23.5 56.5T360-640Zm240 0q-33 0-56.5-23.5T520-720q0-33 23.5-56.5T600-800q33 0 56.5 23.5T680-720q0 33-23.5 56.5T600-640Z"/></svg></div>';
    html += '<span class="tc-num">' + (i + 2) + '</span>';
    html += '<span class="tc-col-name">' + col.label + '</span>';
    html += '<label class="tc-toggle"><input type="checkbox"' + (col.visible ? ' checked' : '') + ' onchange="_tcToggle(' + i + ',this.checked)"><span class="tc-toggle-track"></span></label>';
    html += '</div>';
  });
  list.innerHTML = html;
  _tcBindDrag();
}
function _tcToggle(idx, val) {
  _tcCols[idx].visible = val;
  _tcRender();
}
function _tcBindDrag() {
  var list = document.getElementById('tcList');
  var rows = list.querySelectorAll('.tc-row[data-idx]');
  rows.forEach(function(row) {
    row.removeAttribute('draggable');
    function startDrag(row, startY) {
      var idx = parseInt(row.dataset.idx);
      var rect = row.getBoundingClientRect();
      var offsetY = startY - rect.top;
      var rowH = rect.height;
      var placeholder = document.createElement('div');
      placeholder.className = 'tc-row tc-placeholder-gap';
      placeholder.style.height = rowH + 'px';
      var clone = row.cloneNode(true);
      clone.classList.add('tc-dragging');
      clone.style.width = rect.width + 'px';
      clone.style.left = rect.left + 'px';
      clone.style.top = (startY - offsetY) + 'px';
      document.body.appendChild(clone);
      row.style.display = 'none';
      row.parentNode.insertBefore(placeholder, row);
      list.classList.add('is-dragging');

      function onMove(clientY) {
        clone.style.top = (clientY - offsetY) + 'px';
        var draggableRows = Array.from(list.querySelectorAll('.tc-row[data-idx]'));
        var targetRow = null;
        var insertAfter = false;
        for (var i = 0; i < draggableRows.length; i++) {
          var r = draggableRows[i];
          if (r === row) continue;
          var rr = r.getBoundingClientRect();
          if (rr.height === 0) continue;
          var mid = rr.top + rr.height / 2;
          if (clientY < mid) { targetRow = r; insertAfter = false; break; }
          targetRow = r;
          insertAfter = true;
        }
        if (targetRow) {
          if (insertAfter && targetRow.nextSibling !== placeholder) {
            targetRow.parentNode.insertBefore(placeholder, targetRow.nextSibling);
          } else if (!insertAfter && targetRow.previousSibling !== placeholder) {
            targetRow.parentNode.insertBefore(placeholder, targetRow);
          }
        }
      }

      function onUp() {
        clone.remove();
        list.classList.remove('is-dragging');
        var siblings = Array.from(list.children).filter(function(c) { return c.dataset.idx || c === placeholder; });
        var dataOnlySiblings = siblings.filter(function(c) { return c.dataset.idx || c === placeholder; });
        var dropPos = dataOnlySiblings.indexOf(placeholder);
        placeholder.remove();
        row.style.display = '';
        if (dropPos !== idx && dropPos >= 0) {
          var item = _tcCols.splice(idx, 1)[0];
          if (dropPos > idx) dropPos--;
          _tcCols.splice(dropPos, 0, item);
        }
        _tcRender();
      }
      return { onMove: onMove, onUp: onUp };
    }
    row.addEventListener('mousedown', function(e) {
      if (e.target.closest('.tc-toggle')) return;
      e.preventDefault();
      var drag = startDrag(row, e.clientY);
      function mm(ev) { drag.onMove(ev.clientY); }
      function mu() { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); drag.onUp(); }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
    row.addEventListener('touchstart', function(e) {
      if (e.target.closest('.tc-toggle')) return;
      var touch = e.touches[0];
      var drag = startDrag(row, touch.clientY);
      function tm(ev) { ev.preventDefault(); drag.onMove(ev.touches[0].clientY); }
      function te() { document.removeEventListener('touchmove', tm); document.removeEventListener('touchend', te); drag.onUp(); }
      document.addEventListener('touchmove', tm, { passive: false });
      document.addEventListener('touchend', te);
    }, { passive: true });
  });
}
function resetTableColumns() {
  _tcCols = TC_DEFAULT_COLS.map(function(c) { return {key:c.key, label:c.label, locked:c.locked, visible:c.visible}; });
  _tcSave(_tcCols);
  closeTableCustomizer();
  _tcApplyToDOM();
  var toast = document.createElement('div');
  toast.id = 'bmCopyToast';
  toast.textContent = 'Table reset to default';
  toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-60px);background:#2b2930;color:#fff;padding:10px 24px;border-radius:14px;font-size:14px;font-weight:600;z-index:100000;transition:transform 0.3s ease;white-space:nowrap;box-shadow:none;';
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(function() { toast.style.transform = 'translateX(-50%) translateY(-60px)'; setTimeout(function() { toast.remove(); }, 300); }, 2000);
}
function applyTableColumns() {
  _tcSave(_tcCols);
  closeTableCustomizer();
  _tcApplyToDOM();
  var toast = document.createElement('div');
  toast.id = 'bmCopyToast';
  toast.textContent = 'Table layout saved';
  toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-60px);background:#2b2930;color:#fff;padding:10px 24px;border-radius:14px;font-size:14px;font-weight:600;z-index:100000;transition:transform 0.3s ease;white-space:nowrap;box-shadow:none;';
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(function() { toast.style.transform = 'translateX(-50%) translateY(-60px)'; setTimeout(function() { toast.remove(); }, 300); }, 2000);
}

// Default td index → col key (for tagging new rows)
var TC_DEFAULT_ORDER = ['token', 'price', 'age', 'vol', 'p5m', 'p1h', 'p6h', 'p24h', 'mcap', 'dots'];
// Class-based lookup for tds
var TC_TD_CLASS = { 'price-col': 'price', 'age-col': 'age', 'vol-col': 'vol', 'mcap-col': 'mcap', 'row-dots-col': 'dots' };

function _tcTagRow(tr) {
  if (tr.dataset.tcTagged) return;
  var tds = Array.from(tr.children);
  tds.forEach(function(td, i) {
    if (td.dataset.col) return;
    // Try class-based lookup first
    var found = false;
    for (var cls in TC_TD_CLASS) {
      if (td.classList.contains(cls)) { td.dataset.col = TC_TD_CLASS[cls]; found = true; break; }
    }
    if (!found && i === 0) td.dataset.col = 'token';
    if (!found && !td.dataset.col && i < TC_DEFAULT_ORDER.length) td.dataset.col = TC_DEFAULT_ORDER[i];
  });
  tr.dataset.tcTagged = '1';
}

function _tcApplyToDOM() {
  var cols = _tcGetCols();
  // Build desired order: token first, then user config, dots last
  var order = ['token'];
  var hidden = {};
  cols.forEach(function(c) {
    order.push(c.key);
    if (!c.visible) hidden[c.key] = true;
  });
  order.push('dots');

  // Reorder header
  var headerRow = document.querySelector('thead tr');
  if (headerRow) {
    // Tag headers if they don't have data-col yet (cached HTML)
    if (!headerRow.dataset.tcTagged) {
      var ths = Array.from(headerRow.children);
      ths.forEach(function(th, i) {
        if (!th.dataset.col && i < TC_DEFAULT_ORDER.length) th.dataset.col = TC_DEFAULT_ORDER[i];
      });
      headerRow.dataset.tcTagged = '1';
    }
    order.forEach(function(key) {
      var th = headerRow.querySelector('[data-col="' + key + '"]');
      if (th) {
        th.style.display = hidden[key] ? 'none' : '';
        headerRow.appendChild(th);
      }
    });
  }

  // Reorder each body row
  var rows = document.querySelectorAll('tbody tr');
  rows.forEach(function(tr) {
    if (tr.classList.contains('skeleton-row')) return;
    _tcTagRow(tr);
    order.forEach(function(key) {
      var td = tr.querySelector('[data-col="' + key + '"]');
      if (td) {
        td.style.display = hidden[key] ? 'none' : '';
        tr.appendChild(td);
      }
    });
  });
}

// Apply saved column config after data renders
(function() {
  var tbody = document.querySelector('tbody');
  if (!tbody) return;
  var _tcDebounce = null;
  var observer = new MutationObserver(function() {
    var saved = _tcLoad();
    if (!saved) return;
    clearTimeout(_tcDebounce);
    _tcDebounce = setTimeout(function() {
      var rows = tbody.querySelectorAll('tr:not(.skeleton-row)');
      if (rows.length > 0) _tcApplyToDOM();
    }, 100);
  });
  observer.observe(tbody, { childList: true });
})();

window._priceColMode = 'price';
function togglePriceCol() {
  if(window._priceColMode === 'price') {
    window._priceColMode = 'mcap';
    document.getElementById('priceColLabel').textContent = 'MCap';
    document.getElementById('mcapColLabel').textContent = 'Price';
  } else {
    window._priceColMode = 'price';
    document.getElementById('priceColLabel').textContent = 'Price';
    document.getElementById('mcapColLabel').textContent = 'MCap';
  }
  loadData();
}

function sortByColumn(col) {
  if (currentSort.col === col) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.col = col;
    currentSort.asc = false;
  }
  // Update header indicators
  document.querySelectorAll('th').forEach(th => th.classList.remove('sort-asc','sort-desc'));
  // Find the th that was clicked and add the right class
  var allTh = document.querySelectorAll('th.sortable');
  allTh.forEach(function(th) {
    var onclick = th.getAttribute('onclick') || '';
    if (onclick.indexOf("'" + col + "'") !== -1) {
      th.classList.add(currentSort.asc ? 'sort-asc' : 'sort-desc');
    }
  });
  window._userSortTriggered = true;
  _lastRowOrder = null;
  loadData();
}

function getTimeframeField() {
  return { '5m':'p5m', '1h':'p1h', '4h':'p6h', '24h':'p24h' }[currentTimeframe] || 'p6h';
}

// Helper: get timeframe value for a token, with safe fallback
function getTfVal(token, tfField) {
  var v = token[tfField];
  if(v !== undefined && v !== null) {
    // Clamp to ±9999% to prevent garbage API data from breaking display
    return Math.max(-9999, Math.min(9999, v));
  }
  var fallback = token.p24h || 0;
  return Math.max(-9999, Math.min(9999, fallback));
}

// ========== SHARED BUBBLE SIZING ==========
// Single source of truth — used by both init() and resizeBubbles()
// ========== BUBBLE SIZING ==========
// Under 100%: sqrt curve (spreads mid-range tokens well).
// Over 100%: log curve (still grows but won't eat the screen).
// Auto-scales to fill screen.

function calcBubbleWeight(absPct) {
  if (absPct <= 100) {
    // sqrt curve: 0%→1.8, 5%→2.18, 25%→2.65, 50%→3.0, 100%→3.5
    return 1.8 + 1.7 * Math.sqrt(absPct / 100);
  } else {
    // log growth capped at 4.3 so outliers don't crush other bubbles
    return Math.min(4.3, 3.5 + 0.6 * Math.log2(absPct / 100));
  }
}

function calcBubbleSizes(items, W, H, tfField, getToken) {
  var minDim = Math.min(W, H);
  var weights = items.map(function(item) {
    var t = getToken ? getToken(item) : item;
    var pct = Math.abs(getTfVal(t, tfField));
    var w = calcBubbleWeight(pct);
    if (t.boosted) w = Math.max(w, 3.5);
    return w;
  });
  var screenArea = W * H;
  var totalW2 = 0;
  weights.forEach(function(w) { totalW2 += w * w; });
  var scaleFactor = Math.sqrt(0.70 * screenArea / (Math.PI * totalW2));
  var mobShrink = (W <= 768) ? 0.95 : 1;
  var maxCap = (W <= 768) ? minDim * 0.13 : minDim * 0.16;
  // Clamp scaleFactor using median weight so one outlier (e.g. 1700%)
  // doesn't shrink every other bubble. Outliers still get individually
  // capped at maxCap on the per-bubble line below.
  var sorted = weights.slice().sort(function(a, b) { return a - b; });
  var medianW = sorted[Math.floor(sorted.length / 2)] || 1;
  if (medianW > 0) scaleFactor = Math.min(scaleFactor, maxCap / medianW);
  var radii = weights.map(function(w) {
    var r = w * scaleFactor;
    return Math.max(minDim * 0.032, Math.min(r, maxCap)) * mobShrink;
  });
  return radii;
}


var _CHAIN_LABELS = {'all':'this filter','solana':'Solana','eth':'Ethereum','base':'Base','bsc':'BSC','sui':'Sui','tron':'Tron','arbitrum':'Arbitrum','avalanche':'Avalanche','polygon':'Polygon','optimism':'Optimism','blast':'Blast','ton':'TON','pulsechain':'Pulsechain','seiv2':'Sei','sonic':'Sonic','hyperliquid':'Hyperliquid','berachain':'Berachain','monad':'Monad','cronos':'Cronos','aptos':'Aptos','linea':'Linea','zksync':'zkSync','fantom':'Fantom','mantle':'Mantle','scroll':'Scroll','manta':'Manta','starknet':'Starknet'};
function showEmptyBubbleState() {
  var world = document.getElementById('bubbleWorld');
  if (!world) return;
  bubs = [];
  var label = _CHAIN_LABELS[currentChain] || currentChain || 'this chain';
  world.innerHTML = '<div class="bubble-empty-state">' +
    '<div class="bubble-empty-shrug">' +
      '<span class="shrug-arm shrug-left">¯\\_</span>' +
      '<span class="shrug-face">(ツ)</span>' +
      '<span class="shrug-arm shrug-right">_/¯</span>' +
    '</div>' +
    '<div class="bubble-empty-text">No trending scopes detected</div>' +
    '<div class="bubble-empty-sub">Try another chain or filter</div>' +
    '</div>';
}

var SCANNER_ICONS = {
  'solana': "/img/scan_solana.svg",
  'eth': "/img/scan_eth.png",
  'base': "/img/scan_base.png",
  'bsc': "/img/scan_bsc.png"
};
var SCANNER_URLS = {
  'solana': 'https://solscan.io/token/',
  'eth': 'https://etherscan.io/token/',
  'base': 'https://basescan.org/token/',
  'bsc': 'https://bscscan.com/token/',
  'sui': 'https://suiscan.xyz/mainnet/coin/',
  'tron': 'https://tronscan.org/#/token20/',
  'arbitrum': 'https://arbiscan.io/token/',
  'avalanche': 'https://snowtrace.io/token/',
  'polygon': 'https://polygonscan.com/token/',
  'optimism': 'https://optimistic.etherscan.io/token/',
  'blast': 'https://blastscan.io/token/',
  'ton': 'https://tonviewer.com/',
  'pulsechain': 'https://scan.pulsechain.com/token/',
  'seiv2': 'https://seitrace.com/token/',
  'sonic': 'https://sonicscan.org/token/',
  'hyperliquid': 'https://hyperscan.xyz/token/',
  'berachain': 'https://berascan.com/token/',
  'monad': 'https://monadscan.com/token/',
  'cronos': 'https://cronoscan.com/token/',
  'aptos': 'https://explorer.aptoslabs.com/account/',
  'linea': 'https://lineascan.build/token/',
  'zksync': 'https://explorer.zksync.io/address/',
  'fantom': 'https://ftmscan.com/token/',
  'mantle': 'https://mantlescan.xyz/token/',
  'scroll': 'https://scrollscan.com/token/',
  'manta': 'https://pacific-explorer.manta.network/token/',
  'starknet': 'https://starkscan.co/token/'
};



function updateBubblesSmooth() {
  var tfField = getTimeframeField();
  // During the brief window right after first load, refresh data but DON'T resize
  // or shove bubbles — otherwise the first background verify causes a 2nd settle
  // right after the entrance. Sizes catch up on the next normal refresh.
  var _suppress = Date.now() < (window._suppressResettleUntil || 0);
  var tokens = (typeof getFilteredTokens === 'function') ? getFilteredTokens() : LIVE_TOKENS;

  // Filter out truly dead tokens and show empty state if nothing matches
  tokens = tokens.filter(function(t) {
    return t.boosted || (t.p5m || 0) !== 0 || (t.p1h || 0) !== 0 || (t.p6h || 0) !== 0 || (t.p24h || 0) !== 0 || (t.mcap || 0) > 0;
  });
  if (!tokens.length && liveDataLoaded) {
    showEmptyBubbleState();
    return;
  }

  // Build set of current filtered token syms for quick lookup
  var currentSyms = {};
  for(var k = 0; k < tokens.length; k++) currentSyms[tokens[k].sym] = true;

  // Remove bubbles for tokens no longer in filtered list
  for(var i = bubs.length - 1; i >= 0; i--) {
    if(!currentSyms[bubs[i].token.sym]) {
      bubs.splice(i, 1);
    }
  }

  // Update existing bubbles with new data
  for(var i = 0; i < bubs.length; i++) {
    var b = bubs[i];
    // Find matching token by symbol
    var newToken = null;
    for(var j = 0; j < tokens.length; j++) {
      if(tokens[j].sym === b.token.sym) {
        newToken = tokens[j];
        break;
      }
    }
    if(newToken) {
      b.token = newToken; // BubbleCanvas redraws from the token every frame
    }
  }

  // Add new bubbles if count dropped below 50
  var maxBubbles = 50;
  if (bubs.length < maxBubbles) {
    var existingSyms = {};
    for (var ei = 0; ei < bubs.length; ei++) existingSyms[bubs[ei].token.sym] = true;

    var tfField2 = getTimeframeField();
    var candidates = tokens.filter(function(t) {
      if (existingSyms[t.sym]) return false;
      return t.boosted || (t.p5m || 0) !== 0 || (t.p1h || 0) !== 0 || (t.p6h || 0) !== 0 || (t.p24h || 0) !== 0 || (t.mcap || 0) > 0;
    });
    candidates.sort(function(a, b) { return Math.abs(getTfVal(b, tfField2)) - Math.abs(getTfVal(a, tfField2)); });
    var needed = Math.min(maxBubbles - bubs.length, candidates.length);

    var bubbleWorld = document.getElementById('bubbleWorld');
    if (needed > 0 && bubbleWorld) {
      var W2 = bubbleWorld.offsetWidth;
      var H2 = bubbleWorld.offsetHeight;

      for (var ni = 0; ni < needed; ni++) {
        var nt = candidates[ni];
        var tfVal2 = getTfVal(nt, tfField2);
        var styles2 = computeBubbleStyles(tfVal2);
        var newR = 15;

        // Find a spot that doesn't overlap existing bubbles
        var px = 0, py = 0, placed = false;
        for (var tries = 0; tries < 2000; tries++) {
          px = newR + 4 + Math.random() * (W2 - newR * 2 - 8);
          py = newR + 4 + Math.random() * (H2 - newR * 2 - 8);
          var ok = true;
          for (var ci = 0; ci < bubs.length; ci++) {
            if (Math.hypot(bubs[ci].x - px, bubs[ci].y - py) < bubs[ci].r + newR + 1) {
              ok = false; break;
            }
          }
          if (ok) { placed = true; break; }
        }
        if (!placed) continue;

        if(nt.img) BubbleCanvas.img(imgProxy(nt.img, 80, 80)); // preload logo for canvas

        // Push existing bubbles away from the new one's spawn point (skipped during
        // the post-load settle window so the field stays put).
        if (!_suppress) {
          for (var pi = 0; pi < bubs.length; pi++) {
            var pb = bubs[pi];
            var pdx = pb.x - px, pdy = pb.y - py;
            var pDist = Math.sqrt(pdx * pdx + pdy * pdy);
            var pushZone = pb.r + newR + 20;
            if (pDist < pushZone && pDist > 0.1) {
              var pushForce = (pushZone - pDist) * 0.05;
              pb.vx += (pdx / pDist) * pushForce;
              pb.vy += (pdy / pDist) * pushForce;
            }
          }
        }

        var spd2 = 0.03 + Math.random() * 0.05;
        var ang2 = Math.random() * Math.PI * 2;
        bubs.push({
          x: px, y: py, r: newR, targetR: newR,
          vx: Math.cos(ang2) * spd2, vy: Math.sin(ang2) * spd2,
          token: nt,
          entStart: performance.now(), entScale: 0
        });
      }
    }
  }

  // Recalculate sizes based on new data — skipped during the post-load settle
  // window so the first verify refreshes colors/text without a second settle.
  if(!_suppress) resizeBubbles();
  if(typeof wakeBubbles === 'function') wakeBubbles();
}

function resizeBubbles() {
  if(typeof bubs === 'undefined' || !bubs || bubs.length === 0) return;
  var tfField = getTimeframeField();
  var W = document.getElementById('bubbleWorld').offsetWidth;
  var H = document.getElementById('bubbleWorld').offsetHeight;
  if(W <= 0 || H <= 0) return;   // world hidden/unmeasured — don't collapse radii to 0
  var radii = calcBubbleSizes(bubs, W, H, tfField, function(b){ return b.token; });
  
  for(var i = 0; i < bubs.length; i++) {
    var newR = radii[i];
    var growDelta = newR - bubs[i].r;
    bubs[i].targetR = newR;
    // If bubble is growing, push neighbors away
    if(growDelta > 2) {
      for(var gi = 0; gi < bubs.length; gi++) {
        if(gi === i) continue;
        var gb = bubs[gi];
        var gdx = gb.x - bubs[i].x, gdy = gb.y - bubs[i].y;
        var gDist = Math.sqrt(gdx * gdx + gdy * gdy);
        var gZone = gb.r + newR + 10;
        if(gDist < gZone && gDist > 0.1) {
          var gForce = (gZone - gDist) * 0.04;
          gb.vx += (gdx / gDist) * gForce;
          gb.vy += (gdy / gDist) * gForce;
        }
      }
    }
    // Visuals are drawn from token + radius by BubbleCanvas every frame — no DOM work here.
  }
  BubbleCanvas.resize(W, H);
}

var _lastRowOrder = null; // preserve row order between refreshes
function loadData() {
  const tbody = document.querySelector('tbody');

  // Don't show mock data before live data loads
  if(LIVE_MODE && !liveDataLoaded) {
    tbody.innerHTML = '';
    var skeletonRows = '';
    for(var sk = 0; sk < 15; sk++) {
      skeletonRows += '<tr class="skeleton-row"><td><div class="token-cell" style="gap:8px"><div class="skeleton-box" style="width:28px;height:28px;border-radius:6px"></div><div class="skeleton-box" style="width:' + (60 + Math.random()*40) + 'px;height:14px;border-radius:4px"></div></div></td><td><div class="skeleton-box" style="width:70px;height:14px;border-radius:4px;margin-left:auto"></div></td><td><div class="skeleton-box" style="width:30px;height:14px;border-radius:4px;margin-left:auto"></div></td><td><div class="skeleton-box" style="width:60px;height:14px;border-radius:4px;margin-left:auto"></div></td><td><div class="skeleton-box" style="width:45px;height:14px;border-radius:4px;margin-left:auto"></div></td><td><div class="skeleton-box" style="width:45px;height:14px;border-radius:4px;margin-left:auto"></div></td><td><div class="skeleton-box" style="width:45px;height:14px;border-radius:4px;margin-left:auto"></div></td><td><div class="skeleton-box" style="width:45px;height:14px;border-radius:4px;margin-left:auto"></div></td><td><div class="skeleton-box" style="width:60px;height:14px;border-radius:4px;margin-left:auto"></div></td></tr>';
    }
    tbody.innerHTML = skeletonRows;
    return;
  }

  let tokens = (typeof getFilteredTokens === 'function') ? getFilteredTokens() : [...LIVE_TOKENS];

  if (tokens.length === 0) {
    renderPagination(0);
    return;
  }

  // Pagination
  var totalItems = tokens.length;
  var totalPages = Math.ceil(totalItems / rowsPerPage);
  if (currentPage > totalPages) currentPage = totalPages;
  var startIdx = (currentPage - 1) * rowsPerPage;
  var pagedTokens = tokens.slice(startIdx, startIdx + rowsPerPage);
  renderPagination(totalItems);

  // Keep row order stable between refreshes — only re-sort on first load or user sort action
  var existingRows = tbody.querySelectorAll('tr:not(.skeleton-row)');
  if (_lastRowOrder && existingRows.length > 0 && !window._userSortTriggered) {
    // Reorder pagedTokens to match last known row order
    var tokenByCa = {};
    for (var oi = 0; oi < pagedTokens.length; oi++) {
      var okey = pagedTokens[oi].ca || pagedTokens[oi].sym;
      tokenByCa[okey] = pagedTokens[oi];
    }
    var reordered = [];
    // First: tokens in their previous order
    for (var li = 0; li < _lastRowOrder.length; li++) {
      if (tokenByCa[_lastRowOrder[li]]) {
        reordered.push(tokenByCa[_lastRowOrder[li]]);
        delete tokenByCa[_lastRowOrder[li]];
      }
    }
    // Then: any new tokens that weren't in the last order
    for (var nk in tokenByCa) {
      if (tokenByCa.hasOwnProperty(nk)) reordered.push(tokenByCa[nk]);
    }
    // Always keep boosted tokens at the top even with stable ordering
    var stableBoosted = reordered.filter(function(t){ return t.boosted; });
    var stableNotBoosted = reordered.filter(function(t){ return !t.boosted; });
    stableBoosted.sort(function(a, b) {
      var countDiff = (b.boostCount || 0) - (a.boostCount || 0);
      if (countDiff !== 0) return countDiff;
      return (b.boostCreatedAt || 0) - (a.boostCreatedAt || 0);
    });
    pagedTokens = stableBoosted.concat(stableNotBoosted);
  }
  window._userSortTriggered = false;

  // Save current order
  _lastRowOrder = pagedTokens.map(function(t) { return t.ca || t.sym; });

  existingRows = tbody.querySelectorAll('tr:not(.skeleton-row)');

  // Helper: silently update cell value
  function flashCell(td, oldText, newText) {
    if (oldText !== newText) td.textContent = newText;
  }

  // Helper: silently update pct cell value and color
  function flashPctCell(td, oldText, newText, val) {
    td.innerHTML = newText;
    td.style.color = val >= 0 ? 'var(--green)' : 'var(--red)';
  }

  // Update rows in place whenever possible (skip full rebuild)
  if (existingRows.length > 0) {
    // Update existing rows
    var updateCount = Math.min(existingRows.length, pagedTokens.length);
    for (var ui = 0; ui < updateCount; ui++) {
      var t = pagedTokens[ui];
      var tr = existingRows[ui];
      var tds = tr.querySelectorAll('td');
      var _ca = (t.ca || '').replace(/'/g, "\\'");
      tr.setAttribute('onclick', "openTokenModal('" + _ca + "')");
      var numEl = tr.querySelector('.row-num');
      if (numEl) numEl.textContent = startIdx + ui + 1;
      var dots = tr.querySelector('.token-dots');
      if (dots) dots.setAttribute('onclick', 'event.stopPropagation();showRowMenu(this, ' + (startIdx + ui) + ')');
      var symEl = tr.querySelector('.token-symbol');
      if (symEl && symEl.textContent !== t.sym) {
        symEl.textContent = t.sym;
        var imgEl = tr.querySelector('.token-avatar-img');
        if (imgEl && t.img) imgEl.src = imgProxy(t.img, 56, 56);
      }
      var pairEl = tr.querySelector('.token-pair');
      if (pairEl) {
        var pairText = '/' + (t.pair||t.quoteSymbol||({solana:'SOL',eth:'WETH',base:'WETH',bsc:'BNB',sui:'SUI',tron:'TRX',arbitrum:'WETH',avalanche:'WAVAX',polygon:'WMATIC',optimism:'WETH',blast:'WETH',ton:'TON',sonic:'S',hyperliquid:'WHYPE',berachain:'WBERA',monad:'MON',cronos:'WCRO',aptos:'APT',linea:'WETH',zksync:'WETH',fantom:'WFTM',mantle:'WMNT',scroll:'WETH',manta:'WETH',starknet:'ETH'}[t.net])||'SOL');
        if (pairEl.textContent !== pairText) pairEl.textContent = pairText;
      }
      var badgeImg = tr.querySelector('.token-badge-icon');
      if (badgeImg) {
        var correctChainImg = CHAIN_ICONS[t.net] || CHAIN_ICONS['solana'];
        if (badgeImg.src !== correctChainImg) badgeImg.src = correctChainImg;
      }
      var avatarImg = tr.querySelector('.token-avatar-img');
      if (avatarImg) {
        var correctChainColor = CHAIN_COLORS[t.net] || CHAIN_COLORS['solana'];
        avatarImg.style.outline = '1px solid ' + correctChainColor;
      }
      var avatarWrap = tr.querySelector('.token-avatar-wrap');
      if (avatarWrap) {
        if (t.boosted) avatarWrap.classList.add('boosted-avatar');
        else avatarWrap.classList.remove('boosted-avatar');
      }
      if (tds[1]) { var newPrice = window._priceColMode === 'mcap' ? fmt(t.mcap) : fmtPrice(t.price); flashCell(tds[1], tds[1].textContent, newPrice); }
      if (tds[2]) { tds[2].textContent = fmtAge(t.age); }
      if (tds[3]) { var newVol = fmt(t.vol); flashCell(tds[3], tds[3].textContent, newVol); }
      var pctVals = [t.p5m, t.p1h, t.p6h, t.p24h];
      for (var pi = 0; pi < pctVals.length; pi++) {
        var ptd = tds[4 + pi];
        if (!ptd) continue;
        var pv = pctVals[pi] || 0;
        var newPct = (pv >= 0 ? '+' : '') + pv.toFixed(2) + '%';
        flashPctCell(ptd, ptd.textContent, newPct, pv);
      }
      if (tds[8]) { var newMcap = window._priceColMode === 'mcap' ? fmtPrice(t.price) : fmt(t.mcap); flashCell(tds[8], tds[8].textContent, newMcap); }
      // --- Sync boosted visual state on every in-place update ---
      var _rab = _isAdminBoosted(t.ca);
      t.boosted = !!_rab;
      t.boostCount = _rab ? _rab.count : 0;
      if (tds[0]) {
        if (t.boosted) { tds[0].classList.add('boosted-cell'); } else { tds[0].classList.remove('boosted-cell'); }
      }
      if (t.boosted) { tr.classList.add('boosted-row'); } else { tr.classList.remove('boosted-row'); }
      var existingBadge = tr.querySelector('.boost-badge');
      if (t.boosted && !existingBadge) {
        var topRow = tr.querySelector('.token-top-row');
        if (topRow) topRow.insertAdjacentHTML('beforeend', '<span class="boost-badge"><svg class="boost-badge-icon" viewBox="0 0 500 500" fill="none" stroke-linecap="round" stroke-linejoin="round"><g class="boost-bob"><g transform="translate(312.32 204.14) rotate(45) translate(-116.42 -151.35)"><g transform="translate(116.78 283.83) translate(-54.13 -30)"><g class="boost-fire"><g transform="translate(54.13 64.96)"><path d="M24.13-10.83C24.13 2.5 0 34.96 0 34.96S-24.13 2.5-24.13-10.83C-24.13-24.15-13.33-34.96 0-34.96 13.33-34.96 24.13-24.15 24.13-10.83Z" stroke="#ffb627" stroke-width="12"/></g></g></g><g transform="translate(47.31 232.35)"><path d="M14.22-40.34L-17.31-18.18-14.58 40.34 17.31 18.66Z" stroke="#ffb627" stroke-width="12"/></g><g transform="translate(185.53 232.35)"><path d="M-14.22-40.34L17.31-18.18 14.58 40.34-17.31 18.66Z" stroke="#ffb627" stroke-width="12"/></g><g transform="translate(116.56 146.22)"><path d="M0-116.22C3.97-116.22 7.83-114.81 10.84-112.22 23.12-101.62 53.64-69.63 55.4-12.18 57.09 43.31 51.08 116.22 51.08 116.22H-51.08S-57.09 43.31-55.4-12.18C-53.64-69.63-23.12-101.62-10.84-112.22-7.83-114.81-3.97-116.22 0-116.22Z" stroke="#ffd539" stroke-width="12"/><path class="boost-shine" d="M0-116.22C3.97-116.22 7.83-114.81 10.84-112.22 23.12-101.62 53.64-69.63 55.4-12.18 57.09 43.31 51.08 116.22 51.08 116.22H-51.08S-57.09 43.31-55.4-12.18C-53.64-69.63-23.12-101.62-10.84-112.22-7.83-114.81-3.97-116.22 0-116.22Z"/><g transform="translate(0 -116.22)"><g class="boost-sparkle"><path d="M0,-22 L4,-4 L22,0 L4,4 L0,22 L-4,4 L-22,0 L-4,-4 Z" fill="#fff8d1"/><path d="M0,-12 L2,-2 L12,0 L2,2 L0,12 L-2,2 L-12,0 L-2,-2 Z" fill="#fff"/></g></g></g><g transform="translate(116.56 273.13)"><path d="M32.09 10.7H-32.09V-10.7H32.09Z" stroke="#ffd539" stroke-width="12"/></g><circle cx="116.56" cy="105.92" r="23.48" stroke="#ffb627" stroke-width="12"/></g></g></svg>' + (t.boostCount || '') + '</span>');
      } else if (t.boosted && existingBadge) {
        // Update count text if it changed
        var badgeText = existingBadge.lastChild;
        if (badgeText && badgeText.nodeType === 3) badgeText.textContent = t.boostCount || '';
      } else if (!t.boosted && existingBadge) {
        existingBadge.remove();
      }
    }
    // Remove extra rows if we have more rows than tokens
    for (var ri = existingRows.length - 1; ri >= pagedTokens.length; ri--) {
      existingRows[ri].remove();
    }
    // Add new rows if we have more tokens than rows
    for (var ai = existingRows.length; ai < pagedTokens.length; ai++) {
      var at = pagedTokens[ai];
      var _ab = _isAdminBoosted(at.ca);
      at.boosted = !!_ab;
      at.boostCount = _ab ? _ab.count : 0;
      var aIdx = startIdx + ai;
      var aGrad = GRADIENTS[aIdx % GRADIENTS.length];
      var aLetter = at.sym.charAt(0).toUpperCase();
      var aChainImg = CHAIN_ICONS[at.net] || CHAIN_ICONS['solana'];
      var aChainColor = CHAIN_COLORS[at.net] || CHAIN_COLORS['solana'];
      var aCa = (at.ca || '').replace(/'/g, "\\'");
      var aRowNum = aIdx + 1;
      var aRow = '<tr' + (at.boosted ? ' class="boosted-row"' : '') + ' style="cursor:pointer" onclick="openTokenModal(\'' + aCa + '\')"><td' + (at.boosted ? ' class="boosted-cell"' : '') + '><div class="token-cell"><span class="row-num">' + aRowNum + '</span><div class="token-badges"><img class="token-badge-icon" src="' + aChainImg + '"></div><div class="token-avatar-wrap' + (at.boosted ? ' boosted-avatar' : '') + '"><img class="token-avatar-img" style="outline:1px solid ' + aChainColor + '" loading="lazy" decoding="async" src="' + imgProxy(at.img, 56, 56) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="token-avatar" style="display:' + (at.img ? 'none' : 'flex') + ';background:linear-gradient(135deg,' + aGrad + ')">' + aLetter + '</div></div><div class="token-info"><div class="token-top-row"><span class="token-symbol">' + at.sym + '</span><span class="token-pair" style="color:rgba(255,255,255,0.3);font-size:14px;font-weight:400">/' + (at.pair||at.quoteSymbol||({solana:'SOL',eth:'WETH',base:'WETH',bsc:'BNB',sui:'SUI',tron:'TRX',arbitrum:'WETH',avalanche:'WAVAX',polygon:'WMATIC',optimism:'WETH',blast:'WETH',ton:'TON',sonic:'S',hyperliquid:'WHYPE',berachain:'WBERA',monad:'MON',cronos:'WCRO',aptos:'APT',linea:'WETH',zksync:'WETH',fantom:'WFTM',mantle:'WMNT',scroll:'WETH',manta:'WETH',starknet:'ETH'}[at.net])||'SOL') + '</span>' + (at.boosted ? '<span class="boost-badge"><svg class="boost-badge-icon" viewBox="0 0 500 500" fill="none" stroke-linecap="round" stroke-linejoin="round"><g class="boost-bob"><g transform="translate(312.32 204.14) rotate(45) translate(-116.42 -151.35)"><g transform="translate(116.78 283.83) translate(-54.13 -30)"><g class="boost-fire"><g transform="translate(54.13 64.96)"><path d="M24.13-10.83C24.13 2.5 0 34.96 0 34.96S-24.13 2.5-24.13-10.83C-24.13-24.15-13.33-34.96 0-34.96 13.33-34.96 24.13-24.15 24.13-10.83Z" stroke="#ffb627" stroke-width="12"/></g></g></g><g transform="translate(47.31 232.35)"><path d="M14.22-40.34L-17.31-18.18-14.58 40.34 17.31 18.66Z" stroke="#ffb627" stroke-width="12"/></g><g transform="translate(185.53 232.35)"><path d="M-14.22-40.34L17.31-18.18 14.58 40.34-17.31 18.66Z" stroke="#ffb627" stroke-width="12"/></g><g transform="translate(116.56 146.22)"><path d="M0-116.22C3.97-116.22 7.83-114.81 10.84-112.22 23.12-101.62 53.64-69.63 55.4-12.18 57.09 43.31 51.08 116.22 51.08 116.22H-51.08S-57.09 43.31-55.4-12.18C-53.64-69.63-23.12-101.62-10.84-112.22-7.83-114.81-3.97-116.22 0-116.22Z" stroke="#ffd539" stroke-width="12"/><path class="boost-shine" d="M0-116.22C3.97-116.22 7.83-114.81 10.84-112.22 23.12-101.62 53.64-69.63 55.4-12.18 57.09 43.31 51.08 116.22 51.08 116.22H-51.08S-57.09 43.31-55.4-12.18C-53.64-69.63-23.12-101.62-10.84-112.22-7.83-114.81-3.97-116.22 0-116.22Z"/><g transform="translate(0 -116.22)"><g class="boost-sparkle"><path d="M0,-22 L4,-4 L22,0 L4,4 L0,22 L-4,4 L-22,0 L-4,-4 Z" fill="#fff8d1"/><path d="M0,-12 L2,-2 L12,0 L2,2 L0,12 L-2,2 L-12,0 L-2,-2 Z" fill="#fff"/></g></g></g><g transform="translate(116.56 273.13)"><path d="M32.09 10.7H-32.09V-10.7H32.09Z" stroke="#ffd539" stroke-width="12"/></g><circle cx="116.56" cy="105.92" r="23.48" stroke="#ffb627" stroke-width="12"/></g></g></svg>' + (at.boostCount || '') + '</span>' : '') + '</div></div></div></div></div></td><td class="price-col">' + (window._priceColMode === 'mcap' ? fmt(at.mcap) : fmtPrice(at.price)) + '</td><td class="age-col">' + fmtAge(at.age) + '</td><td class="vol-col">' + fmt(at.vol) + '</td>' + pctTd(at.p5m) + pctTd(at.p1h) + pctTd(at.p6h) + pctTd(at.p24h) + '<td class="mcap-col">' + (window._priceColMode === 'mcap' ? fmtPrice(at.price) : fmt(at.mcap)) + '</td><td class="row-dots-col"><span class="token-dots" onclick="event.stopPropagation();showRowMenu(this, ' + aIdx + ')"><svg class="dots-outline" width="20" height="20" viewBox="0 -960 960 960" fill="currentColor"><path d="M322.5-437.5Q340-455 340-480t-17.5-42.5Q305-540 280-540t-42.5 17.5Q220-505 220-480t17.5 42.5Q255-420 280-420t42.5-17.5Zm200 0Q540-455 540-480t-17.5-42.5Q505-540 480-540t-42.5 17.5Q420-505 420-480t17.5 42.5Q455-420 480-420t42.5-17.5Zm200 0Q740-455 740-480t-17.5-42.5Q705-540 680-540t-42.5 17.5Q620-505 620-480t17.5 42.5Q655-420 680-420t42.5-17.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg><svg class="dots-filled" width="20" height="20" viewBox="0 -960 960 960" fill="currentColor"><path d="M322.5-437.5Q340-455 340-480t-17.5-42.5Q305-540 280-540t-42.5 17.5Q220-505 220-480t17.5 42.5Q255-420 280-420t42.5-17.5Zm200 0Q540-455 540-480t-17.5-42.5Q505-540 480-540t-42.5 17.5Q420-505 420-480t17.5 42.5Q455-420 480-420t42.5-17.5Zm200 0Q740-455 740-480t-17.5-42.5Q705-540 680-540t-42.5 17.5Q620-505 620-480t17.5 42.5Q655-420 680-420t42.5-17.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg></span></td></tr>';
      tbody.insertAdjacentHTML('beforeend', aRow);
    }
  } else {
    // Full rebuild (first load or page change)
    tbody.innerHTML = '';
    pagedTokens.forEach((t, i) => {
      const _ab2 = _isAdminBoosted(t.ca);
      t.boosted = !!_ab2;
      t.boostCount = _ab2 ? _ab2.count : 0;
      const globalIdx = startIdx + i;
      const grad = GRADIENTS[globalIdx % GRADIENTS.length];
      const letter = t.sym.charAt(0).toUpperCase();
      const chainImg = CHAIN_ICONS[t.net] || CHAIN_ICONS['solana'];
      const chainColor = CHAIN_COLORS[t.net] || CHAIN_COLORS['solana'];

      const tCa = (t.ca || '').replace(/'/g, "\\'");
      const rowNum = startIdx + i + 1;
      const row = `<tr${t.boosted ? ' class="boosted-row"' : ''} style="animation-delay:${i * 15}ms;cursor:pointer" onclick="openTokenModal('${tCa}')">
        <td${t.boosted ? ' class="boosted-cell"' : ''}><div class="token-cell">
          <span class="row-num">${rowNum}</span>
          <div class="token-badges"><img class="token-badge-icon" src="${chainImg}"></div>
          <div class="token-avatar-wrap${t.boosted ? ' boosted-avatar' : ''}"><img class="token-avatar-img" style="outline:1px solid ${chainColor}" loading="lazy" decoding="async" src="${imgProxy(t.img, 56, 56)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="token-avatar" style="display:${t.img ? 'none' : 'flex'};background:linear-gradient(135deg,${grad})">${letter}</div></div>
          <div class="token-info"><div class="token-top-row"><span class="token-symbol">${t.sym}</span><span class="token-pair" style="color:rgba(255,255,255,0.3);font-size:14px;font-weight:400">/${t.pair||t.quoteSymbol||({solana:'SOL',eth:'WETH',base:'WETH',bsc:'BNB',sui:'SUI',tron:'TRX',arbitrum:'WETH',avalanche:'WAVAX',polygon:'WMATIC',optimism:'WETH',blast:'WETH',ton:'TON',sonic:'S',hyperliquid:'WHYPE',berachain:'WBERA',monad:'MON',cronos:'WCRO',aptos:'APT',linea:'WETH',zksync:'WETH',fantom:'WFTM',mantle:'WMNT',scroll:'WETH',manta:'WETH',starknet:'ETH'}[t.net])||'SOL'}</span>${t.boosted ? '<span class="boost-badge"><svg class="boost-badge-icon" viewBox="0 0 500 500" fill="none" stroke-linecap="round" stroke-linejoin="round"><g class="boost-bob"><g transform="translate(312.32 204.14) rotate(45) translate(-116.42 -151.35)"><g transform="translate(116.78 283.83) translate(-54.13 -30)"><g class="boost-fire"><g transform="translate(54.13 64.96)"><path d="M24.13-10.83C24.13 2.5 0 34.96 0 34.96S-24.13 2.5-24.13-10.83C-24.13-24.15-13.33-34.96 0-34.96 13.33-34.96 24.13-24.15 24.13-10.83Z" stroke="#ffb627" stroke-width="12"/></g></g></g><g transform="translate(47.31 232.35)"><path d="M14.22-40.34L-17.31-18.18-14.58 40.34 17.31 18.66Z" stroke="#ffb627" stroke-width="12"/></g><g transform="translate(185.53 232.35)"><path d="M-14.22-40.34L17.31-18.18 14.58 40.34-17.31 18.66Z" stroke="#ffb627" stroke-width="12"/></g><g transform="translate(116.56 146.22)"><path d="M0-116.22C3.97-116.22 7.83-114.81 10.84-112.22 23.12-101.62 53.64-69.63 55.4-12.18 57.09 43.31 51.08 116.22 51.08 116.22H-51.08S-57.09 43.31-55.4-12.18C-53.64-69.63-23.12-101.62-10.84-112.22-7.83-114.81-3.97-116.22 0-116.22Z" stroke="#ffd539" stroke-width="12"/><path class="boost-shine" d="M0-116.22C3.97-116.22 7.83-114.81 10.84-112.22 23.12-101.62 53.64-69.63 55.4-12.18 57.09 43.31 51.08 116.22 51.08 116.22H-51.08S-57.09 43.31-55.4-12.18C-53.64-69.63-23.12-101.62-10.84-112.22-7.83-114.81-3.97-116.22 0-116.22Z"/><g transform="translate(0 -116.22)"><g class="boost-sparkle"><path d="M0,-22 L4,-4 L22,0 L4,4 L0,22 L-4,4 L-22,0 L-4,-4 Z" fill="#fff8d1"/><path d="M0,-12 L2,-2 L12,0 L2,2 L0,12 L-2,2 L-12,0 L-2,-2 Z" fill="#fff"/></g></g></g><g transform="translate(116.56 273.13)"><path d="M32.09 10.7H-32.09V-10.7H32.09Z" stroke="#ffd539" stroke-width="12"/></g><circle cx="116.56" cy="105.92" r="23.48" stroke="#ffb627" stroke-width="12"/></g></g></svg>' + (t.boostCount || '') + '</span>' : ''}</div></div>
          </div></div>
        </td>
        <td class="price-col">${window._priceColMode === 'mcap' ? fmt(t.mcap) : fmtPrice(t.price)}</td>
        <td class="age-col">${fmtAge(t.age)}</td>
        <td class="vol-col">${fmt(t.vol)}</td>
        ${pctTd(t.p5m)}
        ${pctTd(t.p1h)}
        ${pctTd(t.p6h)}
        ${pctTd(t.p24h)}
        <td class="mcap-col">${window._priceColMode === 'mcap' ? fmtPrice(t.price) : fmt(t.mcap)}</td>
        <td class="row-dots-col"><span class="token-dots" onclick="event.stopPropagation();showRowMenu(this, ${startIdx + i})"><svg class="dots-outline" width="20" height="20" viewBox="0 -960 960 960" fill="currentColor"><path d="M322.5-437.5Q340-455 340-480t-17.5-42.5Q305-540 280-540t-42.5 17.5Q220-505 220-480t17.5 42.5Q255-420 280-420t42.5-17.5Zm200 0Q540-455 540-480t-17.5-42.5Q505-540 480-540t-42.5 17.5Q420-505 420-480t17.5 42.5Q455-420 480-420t42.5-17.5Zm200 0Q740-455 740-480t-17.5-42.5Q705-540 680-540t-42.5 17.5Q620-505 620-480t17.5 42.5Q655-420 680-420t42.5-17.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg><svg class="dots-filled" width="20" height="20" viewBox="0 -960 960 960" fill="currentColor"><path d="M322.5-437.5Q340-455 340-480t-17.5-42.5Q305-540 280-540t-42.5 17.5Q220-505 220-480t17.5 42.5Q255-420 280-420t42.5-17.5Zm200 0Q540-455 540-480t-17.5-42.5Q505-540 480-540t-42.5 17.5Q420-505 420-480t17.5 42.5Q455-420 480-420t42.5-17.5Zm200 0Q740-455 740-480t-17.5-42.5Q705-540 680-540t-42.5 17.5Q620-505 620-480t17.5 42.5Q655-420 680-420t42.5-17.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg></span></td>
      </tr>`;
      tbody.insertAdjacentHTML('beforeend', row);
    });
  }
}

// ========== SOCIAL FEED BOXES ==========

const X_USERS = ['@CryptoWhale','@DegenSpartan','@inversebrah','@HsakaTrades','@ColdBloodShill','@GCRClassic','@CryptoKaleo','@AltcoinSherpa','@TheCryptoDog','@CryptoGodJohn','@blknoiz06','@CryptoCobain'];
const TG_USERS = ['CryptoAlpha','GemHuntersChat','DeFiDegens','SolanaAlpha','BaseCallsVIP','WhaleAlertGroup','MemeTokenAlpha','InsiderCalls','ChainAnalysis','TrendingGems'];
const FEED_AVATARS = ['#FF6B6B','#4ECDC4','#A18CD1','#FF9A9E','#667EEA','#F093FB','#4FACFE','#43E97B','#FA709A','#FCCB90','#D4FC79','#84FAB0'];

const MOCK_POSTS = {
  x: [
    {user:'@CryptoWhale', text:'$PEPE looking extremely bullish on the 4H chart. Higher lows forming. Next leg up imminent 🚀 <span class="hashtag">#PEPE</span> <span class="hashtag">#memecoin</span>'},
    {user:'@DegenSpartan', text:'Just aped into <span class="mention">$GOAT</span> with 50 SOL. This chart is identical to early $WIF. NFA but the setup is perfect.'},
    {user:'@HsakaTrades', text:'SOL DEX volume hitting ATH. The rotation from ETH to SOL is real. <span class="hashtag">#Solana</span> ecosystem eating everything.'},
    {user:'@inversebrah', text:'<span class="mention">$MOG</span> holders rn: 📈📈📈 This thing does not stop. +230% in 24h with no signs of slowing.'},
    {user:'@ColdBloodShill', text:'New meta forming around AI agents. Watch <span class="mention">$GOAT</span> and similar plays. The narrative is just getting started <span class="hashtag">#AI</span>'},
    {user:'@CryptoKaleo', text:'<span class="mention">$SIGMA</span> breaking out of the range. Volume confirmation is there. Targets: $0.15, $0.25, $0.40'},
    {user:'@AltcoinSherpa', text:'<span class="mention">$WIF</span> reclaiming key support at $0.75. If this holds, $1+ is the next stop. Accumulation zone.'},
    {user:'@TheCryptoDog', text:'The <span class="hashtag">#Solana</span> memecoin meta is far from over. Every cycle people say its dead and it comes back 10x stronger.'},
    {user:'@CryptoGodJohn', text:'CA: <span class="ca">7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr</span> — new stealth launch, low MC, looks clean. DYOR.'},
    {user:'@blknoiz06', text:'<span class="mention">$SHROOMS</span> dev is legit. Liq locked, no insider wallets. This is a rare clean launch in the trenches. <span class="hashtag">#gems</span>'},
    {user:'@CryptoCobain', text:'Entire market dumping but <span class="mention">$POPCAT</span> holding strong. Relative strength = alpha. When BTC recovers this sends.'},
    {user:'@CryptoWhale', text:'<span class="mention">$SLERF</span> forming a massive cup & handle on the daily. Breakout target is 3x from here. Adding more.'},
    {user:'@DegenSpartan', text:'If you\'re not watching Base chain rn you\'re missing free money. <span class="mention">$BRETT</span> <span class="mention">$DEGEN</span> <span class="mention">$TOSHI</span> all cooking <span class="hashtag">#Base</span>'},
    {user:'@HsakaTrades', text:'<span class="mention">$MOON</span> — 2 day old token, already $1.4M MC. Dev renounced. Chart looks parabolic. High risk high reward play.'},
  ],
  tg: [
    {user:'CryptoAlpha', text:'🚨 ALPHA ALERT: <span class="mention">$MYRO</span> whale just bought 200K worth. On-chain shows smart money accumulating for 3 days.'},
    {user:'GemHuntersChat', text:'New gem found: <span class="mention">$VAPOR</span> on ETH. Only $1.7M MC, strong community forming. LP locked 1 year. <span class="hashtag">#100xgem</span>'},
    {user:'DeFiDegens', text:'<span class="mention">$PEPE</span> whale wallet <span class="ca">0x1a2b...3c4d</span> just moved 500B tokens to a fresh wallet. Could be preparing to sell. Be careful.'},
    {user:'SolanaAlpha', text:'<span class="mention">$LOCKIN</span> dev just burned 30% of supply. Chart responded immediately. This is how you build trust. Bullish AF.'},
    {user:'BaseCallsVIP', text:'<span class="mention">$CHAD</span> on Base — 4 days old, $1.8M MC, 267% in 24h. Still early if the narrative holds. <span class="hashtag">#basegems</span>'},
    {user:'WhaleAlertGroup', text:'🐋 WHALE ALERT: 1,500 SOL ($180K) just swapped for <span class="mention">$NINJA</span>. This is the 3rd whale entry in 2 hours.'},
    {user:'MemeTokenAlpha', text:'The <span class="mention">$FWOG</span> community just hit 10K holders. Organic growth, no paid shills. This is what sustainable looks like.'},
    {user:'InsiderCalls', text:'Hearing rumors of a major CEX listing for <span class="mention">$POPCAT</span> next week. Unconfirmed but multiple sources. Take with grain of salt.'},
    {user:'ChainAnalysis', text:'On-chain data for <span class="mention">$BONK</span>: 78% of holders in profit, avg hold time increasing. Healthy accumulation pattern.'},
    {user:'TrendingGems', text:'<span class="mention">$ALIEN</span> stealth launched 1 week ago. CA: <span class="ca">9xK4...m8Fp</span>. Only 50 holders. Could be very early or very dead.'},
    {user:'CryptoAlpha', text:'<span class="mention">$RETARDIO</span> breaking through resistance at $0.025. Next target $0.04. Volume picking up significantly.'},
    {user:'SolanaAlpha', text:'SOL memecoins outperforming ETH memecoins 3:1 this week. The liquidity is firmly on Solana rn. <span class="hashtag">#SOL</span>'},
  ]
};

let feedIndex = {x: 0, tg: 0};





let socialVisible = false;
let feedsInitialized = false;
let xFeedInterval = null;
let tgFeedInterval = null;

function toggleSocialBoxes() {
  socialVisible = !socialVisible;
  const row = document.getElementById('social-feeds-row');
  const nav = document.getElementById('nav-social-feed');
  if (!row) return;
  row.classList.toggle('open', socialVisible);
  if(nav) nav.classList.toggle('active', socialVisible);
  if (socialVisible && !feedsInitialized) {
    feedsInitialized = true;
    for(let i=0;i<6;i++) addFeedItem('x', 'x-feed-scroll');
    for(let i=0;i<6;i++) addFeedItem('tg', 'tg-feed-scroll');
    xFeedInterval = setInterval(() => addFeedItem('x', 'x-feed-scroll'), 3000);
    tgFeedInterval = setInterval(() => addFeedItem('tg', 'tg-feed-scroll'), 3500);
  }
}

function toggleMulticharts() {
  const nav = document.getElementById('nav-multicharts');
  if(nav) nav.classList.toggle('active');
}

// ========== DRAGGABLE POPUPS ==========
let dragState = { el: null, offsetX: 0, offsetY: 0 };

function startDrag(e, panelId) {
  const el = document.getElementById(panelId);
  if (!el) return;
  e.preventDefault();
  const rect = el.getBoundingClientRect();
  dragState.el = el;
  dragState.offsetX = e.clientX - rect.left;
  dragState.offsetY = e.clientY - rect.top;
  el.style.transition = 'none';
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
}

function onDrag(e) {
  if (!dragState.el) return;
  let x = e.clientX - dragState.offsetX;
  let y = e.clientY - dragState.offsetY;
  // Clamp to viewport
  x = Math.max(0, Math.min(x, window.innerWidth - 100));
  y = Math.max(0, Math.min(y, window.innerHeight - 50));
  dragState.el.style.left = x + 'px';
  dragState.el.style.top = y + 'px';
  dragState.el.style.right = 'auto';
  dragState.el.style.transform = 'none';
}

function stopDrag() {
  if (dragState.el) dragState.el.style.transition = '';
  dragState.el = null;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
}

// ========== SOCIAL FEED SEARCH ==========
function filterSocialFeed(query) {
  const q = query.toLowerCase().trim();
  const items = document.querySelectorAll('.social-feeds-body .feed-item');
  items.forEach(item => {
    if (!q) {
      item.style.display = '';
      return;
    }
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(q) ? '' : 'none';
  });
}

let xFeedIdx = 0;
let tgFeedIdx = 0;

function addFeedItem(platform, scrollId) {
  const scroll = document.getElementById(scrollId);
  if (!scroll) return;
  const posts = MOCK_POSTS[platform];
  const idx = platform === 'x' ? xFeedIdx++ : tgFeedIdx++;
  const post = posts[idx % posts.length];
  const avatarColor = FEED_AVATARS[Math.abs(post.user.charCodeAt(1)) % FEED_AVATARS.length];
  const initial = post.user.replace('@','').charAt(0).toUpperCase();
  const sentiments = [
    {bull:'↑ 84%', bear:'↓ 16%'},{bull:'↑ 72%', bear:'↓ 28%'},{bull:'↑ 56%', bear:'↓ 44%'},
    {bull:'↑ 91%', bear:'↓ 9%'},{bull:'↑ 38%', bear:'↓ 62%'},{bull:'↑ 67%', bear:'↓ 33%'},
  ];
  const sent = sentiments[Math.floor(Math.random()*sentiments.length)];
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `
    <div class="feed-item-avatar" style="background:${avatarColor}">${initial}</div>
    <div class="feed-item-body">
      <div class="feed-item-header">
        <span class="feed-item-user">${post.user}</span>
        <span class="feed-item-time">now</span>
      </div>
      <div class="feed-item-text">${post.text}</div>
      <div class="feed-item-sentiment">
        <span class="bull">${sent.bull}</span>
        <span class="bear">${sent.bear}</span>
      </div>
    </div>`;
  scroll.prepend(item);
  const items = scroll.querySelectorAll('.feed-item');
  items.forEach((el,i) => {
    if (i > 0) {
      const t = el.querySelector('.feed-item-time');
      const sec = i * 10 + Math.floor(Math.random()*12);
      if (sec < 60) t.textContent = sec+'s';
      else if (sec < 3600) t.textContent = Math.floor(sec/60)+'m';
      else t.textContent = Math.floor(sec/3600)+'h';
    }
  });
  if (items.length > 25) items[items.length-1].remove();
  // Update count
  const countEl = document.getElementById(platform === 'x' ? 'x-count' : 'tg-count');
  if (countEl) countEl.textContent = items.length + ' posts';
}



// ========== WATCHLIST ==========
let watchlist = JSON.parse(localStorage.getItem('msWatchlist') || '[]');
let watchlistVisible = false;
// Update nav star on load
setTimeout(function() { if (typeof renderWatchlist === 'function') renderWatchlist(); }, 100);
// Watchlist entries persist even if token leaves the feed

function toggleWatchlistPanel() {}

function animateWatchlistRemove(el, sym) {
  var row = el.closest('.wl-modal-row');
  if (!row) return toggleWatchlist(sym);
  var rect = row.getBoundingClientRect();
  var parent = row.parentElement;
  var parentRect = parent.getBoundingClientRect();
  // Create burn overlay
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;top:' + (rect.top - parentRect.top + parent.scrollTop) + 'px;left:0;width:' + rect.width + 'px;height:' + rect.height + 'px;pointer-events:none;z-index:99;overflow:visible;';
  parent.style.position = 'relative';
  parent.appendChild(overlay);
  // Burn edge sweep — faster
  var burn = document.createElement('div');
  burn.style.cssText = 'position:absolute;top:-2px;left:-10px;width:6px;height:' + (rect.height + 4) + 'px;' +
    'background:linear-gradient(90deg,transparent,#ff6600,#ff3300,#ff6600,transparent);' +
    'box-shadow:0 0 12px 4px rgba(255,80,0,0.6),0 0 30px 8px rgba(255,40,0,0.3);' +
    'border-radius:2px;transition:left 0.35s ease-in;';
  overlay.appendChild(burn);
  // Ash particles
  var ashCount = 14;
  var ashes = [];
  for (var i = 0; i < ashCount; i++) {
    var ash = document.createElement('div');
    var sz = 2 + Math.random() * 4;
    ash.style.cssText = 'position:absolute;width:' + sz + 'px;height:' + sz + 'px;' +
      'background:' + (Math.random() > 0.4 ? '#ff6600' : '#333') + ';' +
      'border-radius:50%;opacity:0;pointer-events:none;' +
      'transition:all 0.4s ease ' + (0.05 + Math.random() * 0.25) + 's;';
    ash.style.top = (Math.random() * rect.height) + 'px';
    ash.style.left = '0px';
    overlay.appendChild(ash);
    ashes.push(ash);
  }
  // Burned area
  var burned = document.createElement('div');
  burned.style.cssText = 'position:absolute;top:0;left:0;width:0;height:100%;' +
    'background:linear-gradient(90deg,rgba(30,20,10,0.95),rgba(50,30,10,0.7));' +
    'transition:width 0.35s ease-in;';
  overlay.appendChild(burned);
  // Start burn sweep immediately — no glow delay
  row.style.filter = 'brightness(1.3) sepia(0.3)';
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      burn.style.left = (rect.width + 10) + 'px';
      burned.style.width = '100%';
      row.style.filter = 'brightness(0.3) sepia(1)';
      row.style.transition = 'filter 0.3s ease-in, opacity 0.12s ease 0.2s';
      row.style.opacity = '0';
      ashes.forEach(function(a) {
        a.style.opacity = '1';
        a.style.top = (parseFloat(a.style.top) - 20 - Math.random() * 30) + 'px';
        a.style.left = (Math.random() * rect.width) + 'px';
        setTimeout(function() {
          a.style.opacity = '0';
          a.style.top = (parseFloat(a.style.top) - 20) + 'px';
        }, 200 + Math.random() * 150);
      });
    });
  });
  // Collapse row
  setTimeout(function() {
    row.style.transition = 'max-height 0.2s ease, padding 0.2s ease, margin 0.2s ease';
    row.style.overflow = 'hidden';
    row.style.maxHeight = rect.height + 'px';
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        row.style.maxHeight = '0';
        row.style.paddingTop = '0';
        row.style.paddingBottom = '0';
        row.style.marginTop = '0';
        row.style.marginBottom = '0';
      });
    });
  }, 380);
  // Cleanup
  setTimeout(function() {
    if (overlay.parentNode) overlay.remove();
    toggleWatchlist(sym);
  }, 650);
}

function toggleWatchlist(sym, btnEl) {
  const idx = watchlist.indexOf(sym);
  var wasAdded = idx === -1;
  if (idx > -1) watchlist.splice(idx, 1);
  else if (watchlist.length < 20) watchlist.push(sym);
  localStorage.setItem('msWatchlist', JSON.stringify(watchlist));
  // Update star buttons in table
  document.querySelectorAll('.star-btn').forEach(btn => {
    const s = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
    btn.classList.toggle('active', watchlist.includes(s));
  });
  // Update modal star
  var modalStar = document.getElementById('bmStar');
  if (modalStar && window._modalToken) {
    var mActive = watchlist.includes(window._modalToken.sym);
    modalStar.classList.toggle('active', mActive);
  }
  // Update sidebar watchlist
  renderWatchlist();
  // Sync alerts panel if open
  if (alertsVisible) renderAlerts();
  // Toast
  var et = document.getElementById('bmCopyToast');
  if (et) et.remove();
  var toast = document.createElement('div');
  toast.id = 'bmCopyToast';
  toast.textContent = wasAdded ? sym + ' added to watchlist' : sym + ' removed from watchlist';
  toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-60px);background:#2b2930;color:#fff;padding:10px 24px;border-radius:14px;font-size:14px;font-weight:600;z-index:100000;transition:transform 0.3s ease;white-space:nowrap;box-shadow:none;';
  document.body.appendChild(toast);
  requestAnimationFrame(function() { requestAnimationFrame(function() { toast.style.transform = 'translateX(-50%) translateY(0)'; }); });
  setTimeout(function() { toast.style.transform = 'translateX(-50%) translateY(-60px)'; setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300); }, 1500);
}

function toggleWlShareMenu(btn) {
  // On mobile, use native share API (works on HTTPS)
  if (window.innerWidth <= 768 && navigator.share) {
    var text = '🔭 My MemeScope Watchlist:\n\n';
    if (typeof watchlist !== 'undefined' && watchlist && watchlist.length > 0) {
      watchlist.forEach(function(sym) {
        var token = (typeof LIVE_TOKENS !== 'undefined') ? LIVE_TOKENS.find(function(t) { return t.sym === sym; }) : null;
        if (token) {
          var change = token.p24h || 0;
          var arrow = change >= 0 ? '🟢' : '🔴';
          text += arrow + ' $' + sym + ' — ' + (change >= 0 ? '+' : '') + change.toFixed(1) + '%\n';
        } else {
          text += '⚪ $' + sym + '\n';
        }
      });
    }
    text += '\nTrack yours at memescope.io';
    navigator.share({ title: 'My MemeScope Watchlist', text: text, url: 'https://memescope.io' }).catch(function(){});
    return;
  }
  // Desktop or fallback: use dropdown menu
  var menu = document.getElementById('wlShareMenu');
  if (menu.classList.contains('open')) {
    menu.classList.remove('open');
  } else {
    var rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.bottom = 'auto';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.classList.add('open');
  }
}

function shareWatchlist(platform) {
  document.getElementById('wlShareMenu').classList.remove('open');
  if (!watchlist || watchlist.length === 0) { alert('Your watchlist is empty!'); return; }

  var text = '🔭 My MemeScope Watchlist:\n\n';
  watchlist.forEach(function(sym) {
    var token = (typeof LIVE_TOKENS !== 'undefined') ? LIVE_TOKENS.find(function(t) { return t.sym === sym; }) : null;
    if (token) {
      var change = token.p24h || 0;
      var arrow = change >= 0 ? '🟢' : '🔴';
      text += arrow + ' $' + sym + ' — ' + (change >= 0 ? '+' : '') + change.toFixed(1) + '%\n';
    } else {
      text += '⚪ $' + sym + '\n';
    }
  });
  text += '\nTrack yours at memescope.io';

  var encoded = encodeURIComponent(text);
  var url = '';

  switch(platform) {
    case 'x':
      url = 'https://x.com/intent/tweet?text=' + encoded;
      break;
    case 'telegram':
      url = 'https://t.me/share/url?url=' + encodeURIComponent('https://memescope.io') + '&text=' + encoded;
      break;
    case 'whatsapp':
      url = 'https://wa.me/?text=' + encoded;
      break;
    case 'sms':
      url = 'sms:?body=' + encoded;
      break;
    case 'email':
      url = 'mailto:?subject=' + encodeURIComponent('My MemeScope Watchlist') + '&body=' + encoded;
      break;
  }
  if (url) window.open(url, '_blank');
}

// Close share menu when clicking outside
document.addEventListener('click', function(e) {
  var menu = document.getElementById('wlShareMenu');
  if (menu && menu.classList.contains('open') && !e.target.closest('.wl-share-btn') && !e.target.closest('.wl-share-menu')) {
    menu.classList.remove('open');
  }
});

function openWatchlistModal() {
  renderWatchlist();
  var navWl = document.getElementById('navWatchlistLink');
  if (navWl) navWl.classList.add('active');
  document.getElementById('wlOverlay').classList.add('open');
  lockScroll();
}
function closeWatchlistModal() {
  var ov = document.getElementById('wlOverlay');
  m3CloseOverlay(ov, function() {
    unlockScroll();
    var shareMenu = document.getElementById('wlShareMenu');
    if (shareMenu) shareMenu.classList.remove('open');
    var wlNav = document.querySelector('.ms-watchlist-nav');
    if(wlNav) { wlNav.classList.remove('pill-animate'); wlNav.classList.remove('active'); }
  });
}

function renderWatchlist() {
  // Toggle nav bookmark: filled when has items, outline when empty
  var navWlLink = document.getElementById('navWatchlistLink');
  if (navWlLink) {
    navWlLink.classList.toggle('has-items', watchlist.length > 0);
  }

  var countEl = document.getElementById('wlCount');
  if (countEl) countEl.textContent = watchlist.length + '/20';

  // Update nav badge
  var badge = document.getElementById('watchlistBadge');
  if (badge) {
    if (watchlist.length > 0) {
      badge.textContent = watchlist.length;
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  }
  // Mobile nav bar badge
  var mobBadge = document.getElementById('mobWlBadge');
  if (mobBadge) {
    if (watchlist.length > 0) {
      mobBadge.textContent = watchlist.length;
      mobBadge.classList.add('visible');
    } else {
      mobBadge.classList.remove('visible');
    }
  }
  // Mobile menu badge
  var menuBadge = document.getElementById('menuWlBadge');
  if (menuBadge) {
    if (watchlist.length > 0) {
      menuBadge.textContent = watchlist.length;
      menuBadge.classList.add('visible');
    } else {
      menuBadge.classList.remove('visible');
    }
  }

  var body = document.getElementById('wlBody');
  if (!body) return;

  if (watchlist.length === 0) {
    body.innerHTML = '<div class="wl-modal-empty">' +
      '<svg width="80" height="80" viewBox="-5 -10 110 105" fill="currentColor"><path d="m37.5 23.438v-13.156l-14.719 14.719h13.156c0.86328 0 1.5625-0.69922 1.5625-1.5625z"/><path d="m92.188 78.125h-34.375c-0.41406 0-0.8125 0.16406-1.1055 0.45703l-1.1055 1.1055h-11.207l-1.1055-1.1055c-0.29297-0.29297-0.69141-0.45703-1.1055-0.45703h-34.371c-0.86328 0-1.5625 0.69922-1.5625 1.5625 0 6.0312 4.9062 10.938 10.938 10.938h65.625c6.0312 0 10.938-4.9062 10.938-10.938 0-0.86328-0.69922-1.5625-1.5625-1.5625z"/><path d="m18.75 31.25h-3.125c-3.4531 0-6.25 2.7969-6.25 6.25v37.5h9.375z"/><path d="m90.625 37.5c0-3.4531-2.7969-6.25-6.25-6.25h-3.125v43.75h9.375z"/><path d="m45.5 76.375 0.1875 0.1875h8.625l0.1875-0.1875c0.89062-0.89062 2.0625-1.375 3.3125-1.375h20.312v-60.938c0-2.5781-2.1094-4.6875-4.6875-4.6875h-32.812v14.062c0 2.5859-2.1016 4.6875-4.6875 4.6875h-14.062v46.875h20.312c1.25 0 2.4219 0.48438 3.3125 1.375zm-6.9062-14.711 0.87891-5.1289-3.7266-3.6328c-1.2852-1.2539-1.7422-3.0938-1.1875-4.8047 0.55469-1.7109 2.0039-2.9336 3.7852-3.1914l5.1484-0.74609 2.3008-4.6641c0.79688-1.6133 2.4062-2.6133 4.2031-2.6133s3.4062 1 4.2031 2.6133l2.3008 4.6641 5.1484 0.74609c1.7773 0.25781 3.2305 1.4805 3.7852 3.1914 0.55469 1.7109 0.10156 3.5508-1.1875 4.8047l-3.7266 3.6328 0.87891 5.1289c0.30469 1.7734-0.41016 3.5273-1.8672 4.5859s-3.3438 1.1914-4.9375 0.35547l-4.6055-2.4219-4.6055 2.4219c-0.69141 0.36328-1.4414 0.54297-2.1875 0.54297-0.96875 0-1.9297-0.30469-2.75-0.89844-1.4531-1.0586-2.168-2.8125-1.8672-4.5859z"/><path d="m49.273 61.035c0.45312-0.24219 1-0.24219 1.4531 0l5.332 2.8047c0.53906 0.28516 1.1562 0.23828 1.6445-0.11719 0.49219-0.35938 0.72266-0.92969 0.62109-1.5273l-1.0195-5.9375c-0.085938-0.50781 0.082031-1.0234 0.44922-1.3828l4.3125-4.207c0.4375-0.42578 0.58203-1.0234 0.39453-1.6016s-0.66016-0.97656-1.2617-1.0625l-5.9609-0.86719c-0.50781-0.074219-0.94922-0.39453-1.1758-0.85547l-2.6641-5.4023c-0.26953-0.54688-0.79297-0.87109-1.4023-0.87109s-1.1328 0.32422-1.4023 0.87109l-2.6641 5.4023c-0.22656 0.46094-0.66797 0.78125-1.1758 0.85547l-5.9609 0.86719c-0.60156 0.085938-1.0742 0.48438-1.2617 1.0625s-0.039062 1.1758 0.39453 1.6016l4.3125 4.207c0.36719 0.35938 0.53516 0.875 0.44922 1.3828l-1.0195 5.9375c-0.10156 0.60156 0.12891 1.1719 0.62109 1.5273 0.49219 0.35547 1.1055 0.40234 1.6445 0.11719l5.332-2.8047z"/></svg>' +
      '<span class="wl-empty-title">Watchlist\'s empty</span></div>';
    return;
  }

  var pctFmt = function(v) {
    v = v || 0;
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  };
  var pctCls = function(v) { return (v || 0) >= 0 ? 'up' : 'down'; };

  var html = '';
  watchlist.forEach(function(sym) {
    var token = LIVE_TOKENS.find(function(t) { return t.sym === sym; });
    var imgSrc = token ? (token.img || '') : '';
    var letter = sym.charAt(0).toUpperCase();
    var avatarHtml = imgSrc
      ? '<img class="wl-modal-token-img" decoding="async" src="' + imgProxy(imgSrc, 64, 64) + '" onerror="this.style.display=\'none\'">'
      : '<div class="wl-modal-token-img" style="background:#333;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">' + letter + '</div>';

    var clickAction = token
      ? ' onclick="closeWatchlistModal();openBubbleModal(LIVE_TOKENS.find(function(t){return t.sym===\'' + sym + '\'}))"'
      : ' style="opacity:0.6;cursor:default"';

    html += '<div class="wl-modal-row"' + clickAction + '>' +
      '<div class="wl-modal-token">' + avatarHtml +
        '<span class="wl-modal-token-sym">' + sym + '</span>' +
        '<span class="wl-modal-token-delete" onclick="event.stopPropagation();animateWatchlistRemove(this,\'' + sym + '\')"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 1.5V2.5H3C2.44772 2.5 2 2.94772 2 3.5V4.5C2 5.05228 2.44772 5.5 3 5.5H21C21.5523 5.5 22 5.05228 22 4.5V3.5C22 2.94772 21.5523 2.5 21 2.5H16V1.5C16 0.947715 15.5523 0.5 15 0.5H9C8.44772 0.5 8 0.947715 8 1.5Z"/><path d="M3.9231 7.5H20.0767L19.1344 20.2216C19.0183 21.7882 17.7135 23 16.1426 23H7.85724C6.28636 23 4.98148 21.7882 4.86544 20.2216L3.9231 7.5Z"/></svg></span>' +
      '</div>' +
      '<span class="wl-modal-val">' + (token ? fmtPrice(token.price || 0) : '—') + '</span>' +
      '<span class="wl-modal-val ' + (token ? pctCls(token.p5m) : '') + '">' + (token ? pctFmt(token.p5m) : '—') + '</span>' +
      '<span class="wl-modal-val ' + (token ? pctCls(token.p1h) : '') + '">' + (token ? pctFmt(token.p1h) : '—') + '</span>' +
      '<span class="wl-modal-val ' + (token ? pctCls(token.p6h) : '') + '">' + (token ? pctFmt(token.p6h) : '—') + '</span>' +
      '<span class="wl-modal-val ' + (token ? pctCls(token.p24h) : '') + '">' + (token ? pctFmt(token.p24h) : '—') + '</span>' +
    '</div>';
  });
  body.innerHTML = html;
}

// ---- ALERTS ----
let alerts = [];
let alertsVisible = false;

function toggleAlertsPanel() {
  alertsVisible = !alertsVisible;
  document.getElementById('alerts-panel').classList.toggle('open', alertsVisible);
  var navA = document.getElementById('nav-alerts'); if(navA) navA.classList.toggle('active', alertsVisible);
  renderAlerts();
}

function renderAlerts() {
  // Remove alerts for tokens no longer in watchlist
  alerts = alerts.filter(a => watchlist.includes(a.sym));
  const content = document.getElementById('alerts-content');
  const countEl = document.getElementById('alerts-count');
  const badge = document.getElementById('alerts-badge');
  if(countEl) countEl.textContent = alerts.length + ' alert' + (alerts.length !== 1 ? 's' : '');

  // Update badge
  if (badge && alerts.length > 0) {
    badge.textContent = alerts.length;
    badge.classList.add('visible');
    badge.style.animation = 'none';
    badge.offsetHeight;
    badge.style.animation = '';
  } else if(badge) {
    badge.classList.remove('visible');
  }

  if (watchlist.length === 0) {
    content.innerHTML = '<div class="alerts-empty">No tokens in your watchlist.<br><a onclick="toggleWatchlistPanel()">★ Add tokens to your watchlist</a> first to create alerts.</div>';
    return;
  }

  let html = '<div class="alerts-form">';
  html += '<select id="alert-token">';
  watchlist.forEach(sym => {
    html += `<option value="${sym}">${sym}</option>`;
  });
  html += '</select>';
  html += '<select id="alert-type">';
  html += '<option value="above">Price above</option>';
  html += '<option value="below">Price below</option>';
  html += '<option value="pct_up">% Up ≥</option>';
  html += '<option value="pct_down">% Down ≥</option>';
  html += '</select>';
  html += '<input id="alert-value" type="text" placeholder="Value...">';
  html += '<button class="alert-create-btn" onclick="createAlert()">+ Add</button>';
  html += '</div>';

  if (alerts.length > 0) {
    html += '<div class="alerts-list">';
    alerts.forEach((a, i) => {
      let condStr = '';
      if (a.type === 'above') condStr = 'Price > $' + a.value;
      else if (a.type === 'below') condStr = 'Price < $' + a.value;
      else if (a.type === 'pct_up') condStr = '↑ ≥ ' + a.value + '%';
      else if (a.type === 'pct_down') condStr = '↓ ≥ ' + a.value + '%';
      html += `<div class="alert-item">
        <div class="alert-item-info">
          <span class="alert-item-sym">${a.sym}</span>
          <span class="alert-item-cond">${condStr}</span>
        </div>
        <button class="alert-item-remove" onclick="removeAlert(${i})">✕</button>
      </div>`;
    });
    html += '</div>';
  }

  content.innerHTML = html;
}

function createAlert() {
  const sym = document.getElementById('alert-token').value;
  const type = document.getElementById('alert-type').value;
  const val = document.getElementById('alert-value').value.trim();
  if (!val || isNaN(parseFloat(val))) return;
  alerts.push({ sym, type, value: parseFloat(val) });
  renderAlerts();
}

function removeAlert(idx) {
  alerts.splice(idx, 1);
  renderAlerts();
}

// ========== ALERT TOAST NOTIFICATIONS ==========
function showAlertToast(alert, currentPrice) {
  const container = document.getElementById('alert-toast-container');
  if (!container) return;
  
  const isDown = alert.type === 'below' || alert.type === 'pct_down';
  const toast = document.createElement('div');
  toast.className = 'alert-toast' + (isDown ? ' down' : '');
  toast.style.position = 'relative';
  toast.innerHTML = `
    <span class="alert-toast-icon">${isDown ? '📉' : '📈'}</span>
    <div class="alert-toast-body">
      <span class="alert-toast-title">${alert.sym} Alert Triggered!</span>
      <span class="alert-toast-detail">
        Current: <span class="alert-toast-price ${isDown ? 'down' : 'up'}">${fmtPrice(currentPrice)}</span>
        &nbsp;•&nbsp; Target: ${alert.type === 'above' ? '>' : alert.type === 'below' ? '<' : alert.type === 'pct_up' ? '↑' : '↓'} ${alert.type.includes('pct') ? alert.value + '%' : '$' + alert.value}
      </span>
    </div>
    <button class="alert-toast-close" onclick="this.parentElement.classList.add('closing');setTimeout(()=>this.parentElement.remove(),350)">✕</button>
    <div class="alert-toast-progress"></div>
  `;
  container.appendChild(toast);
  
  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('closing');
      setTimeout(() => toast.remove(), 350);
    }
  }, 4000);
}

// ========== PRICE SIMULATION & ALERT CHECK ==========
function checkAlerts() {
  if (alerts.length === 0) return;
  const toRemove = [];
  
  alerts.forEach((a, i) => {
    const token = LIVE_TOKENS.find(t => t.sym === a.sym);
    if (!token) return;
    
    let triggered = false;
    if (a.type === 'above' && token.price >= a.value) triggered = true;
    if (a.type === 'below' && token.price <= a.value) triggered = true;
    if (a.type === 'pct_up' && token.m5 >= a.value) triggered = true;
    if (a.type === 'pct_down' && token.m5 <= -a.value) triggered = true;
    
    if (triggered) {
      showAlertToast(a, token.price);
      toRemove.push(i);
    }
  });
  
  // Remove triggered alerts (reverse order to keep indices correct)
  toRemove.reverse().forEach(i => alerts.splice(i, 1));
  if (toRemove.length > 0) renderAlerts();
}

// Simulate small price fluctuations and check alerts — delay start so Lighthouse sees idle CPU
var _priceSimTimer = null;
setTimeout(function() {
  _priceSimTimer = setInterval(() => {
    LIVE_TOKENS.forEach(t => {
      const change = (Math.random() - 0.48) * 0.02;
      t.price *= (1 + change);
      t.m5 += (Math.random() - 0.5) * 0.8;
    });
    checkAlerts();
  }, 3000);
}, 10000);


// ========== PAGINATION ==========
var currentPage = 1;
var rowsPerPage = 100;

function getFilteredTokens() {
  let tokens = [...LIVE_TOKENS];
  const tf = getTimeframeField();
  // Boosted tokens always stay visible regardless of chain/category filters
  if (currentChain !== 'all') tokens = tokens.filter(t => t.boosted || t.net === currentChain);
  if (currentLaunchpad !== 'all') tokens = tokens.filter(t => t.boosted || t.pad === currentLaunchpad);
  switch(currentCategory) {
    case 'trending': tokens.sort((a,b) => Math.abs(b[tf]) - Math.abs(a[tf])); break;
    case 'top': tokens.sort((a,b) => b.mcap - a.mcap); break;
    case 'gainers': tokens = tokens.filter(t => t.boosted || t[tf] > 0); tokens.sort((a,b) => b[tf] - a[tf]); break;
    case 'losers': tokens = tokens.filter(t => t.boosted || t[tf] < 0); tokens.sort((a,b) => a[tf] - b[tf]); break;
    case 'new': tokens = tokens.filter(t => t.boosted || ageToHours(t.age) <= 1); tokens.sort((a,b) => ageToHours(a.age) - ageToHours(b.age)); break;
  }
  if (currentSort.col) {
    const col = currentSort.col;
    const dir = currentSort.asc ? 1 : -1;
    tokens.sort((a,b) => {
      let av, bv;
      switch(col) {
        case 'price': av=a.price||0; bv=b.price||0; break;
        case 'age': av=ageToHours(a.age||'\u2014'); bv=ageToHours(b.age||'\u2014'); break;
        case 'vol': av=a.vol||0; bv=b.vol||0; break;
        case 'p5m': av=a.p5m||0; bv=b.p5m||0; break;
        case 'p7d': av=a.p24h||0; bv=b.p24h||0; break;
        case 'p1h': av=a.p1h||0; bv=b.p1h||0; break;
        case 'p6h': av=a.p6h||0; bv=b.p6h||0; break;
        case 'p24h': av=a.p24h||0; bv=b.p24h||0; break;
        case 'mcap': av=a.mcap||0; bv=b.mcap||0; break;
        default: return 0;
      }
      return (av - bv) * dir;
    });
  }
  // Re-check admin boosts before sorting
  _applyAdminBoosts(tokens);
  // Boosted tokens always get priority — move them to the top
  // Rank by boost count (higher first), then recency (newer first) as tiebreaker
  var boosted = tokens.filter(function(t){ return t.boosted; });
  var notBoosted = tokens.filter(function(t){ return !t.boosted; });
  boosted.sort(function(a, b) {
    var countDiff = (b.boostCount || 0) - (a.boostCount || 0);
    if (countDiff !== 0) return countDiff;
    return (b.boostCreatedAt || 0) - (a.boostCreatedAt || 0);
  });
  tokens = boosted.concat(notBoosted);
  return tokens;
}

function changePage(dir) {
  var totalFiltered = getFilteredTokens().length;
  var totalPages = Math.ceil(totalFiltered / rowsPerPage);
  currentPage = Math.max(1, Math.min(currentPage + dir, totalPages));
  loadData();
}

function goToPage(p) {
  currentPage = p;
  _lastRowOrder = null;
  loadData();
}

function changeRowsPerPage(val) {
  rowsPerPage = parseInt(val);
  currentPage = 1;
  _lastRowOrder = null;
  loadData();
}

function renderPagination(totalItems) {
  var totalPages = Math.ceil(totalItems / rowsPerPage);
  if(totalPages < 1) totalPages = 1;
  
  var prevBtn = document.getElementById('page-prev');
  var nextBtn = document.getElementById('page-next');
  if(prevBtn) prevBtn.disabled = currentPage <= 1;
  if(nextBtn) nextBtn.disabled = currentPage >= totalPages;
  
  var pEl = document.getElementById('page-numbers');
  if(!pEl) return;
  var h = '';
  for (var i = 1; i <= totalPages; i++) {
    if (totalPages <= 7 || i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      h += '<button class="pag-num' + (i === currentPage ? ' active' : '') + '" onclick="goToPage(' + i + ')">' + i + '</button>';
    } else if (Math.abs(i - currentPage) === 2) {
      h += '<span style="width:28px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:10px">…</span>';
    }
  }
  pEl.innerHTML = h;
}


loadData();

// Sync thead sticky offset to actual sticky-nav-wrap height
function updateStickyOffsets() {
  requestAnimationFrame(() => {
    const wrap = document.querySelector('.sticky-nav-wrap');
    if (wrap) {
      let h = wrap.offsetHeight;
      document.querySelectorAll('thead th').forEach(th => th.style.top = h + 'px');
    }
  });
}


// Run multiple times to catch layout changes
updateStickyOffsets();
setTimeout(updateStickyOffsets, 200);
setTimeout(updateStickyOffsets, 1500);
window.addEventListener('resize', updateStickyOffsets);

// Hide filter bar when scrolling down, show only when near the top
(function(){
  var filterBar = document.querySelector('.filter-bar');
  if(!filterBar) return;
  window.addEventListener('scroll', function(){
    var currentY = window.scrollY;
    if(currentY > 150) {
      filterBar.classList.add('hidden-scroll');
    } else {
      filterBar.classList.remove('hidden-scroll');
    }
    updateStickyOffsets();
  }, {passive: true});
})();

// Watch for nav wrap size changes
if (typeof ResizeObserver !== 'undefined') {
  var navWrap = document.querySelector('.sticky-nav-wrap');
  if (navWrap) {
    new ResizeObserver(updateStickyOffsets).observe(navWrap);
  }
}

// Keep the bubble canvas buffer in sync whenever the bubble world changes size
// (returning from the token page, mobile address-bar show/hide, orientation, etc.).
// Without this the canvas buffer goes stale and the bubbles render huge/blurry.
if (typeof ResizeObserver !== 'undefined') {
  var _bWorld = document.getElementById('bubbleWorld');
  if (_bWorld) {
    var _bwPrevW = _bWorld.offsetWidth, _bwPrevH = _bWorld.offsetHeight;
    new ResizeObserver(function(){
      var w = _bWorld.offsetWidth, h = _bWorld.offsetHeight;
      if (w <= 0 || h <= 0) return;                  // hidden — ignore
      if (w === _bwPrevW && h === _bwPrevH) return;  // no real change
      _bwPrevW = w; _bwPrevH = h;
      if (typeof bubs !== 'undefined' && bubs && bubs.length && typeof resizeBubbles === 'function') {
        resizeBubbles();
        if (window.wakeBubbles) window.wakeBubbles();
      } else if (typeof BubbleCanvas !== 'undefined' && BubbleCanvas) {
        BubbleCanvas.resize(w, h);
      }
    }).observe(_bWorld);
  }
}

// Floating Appbox drag + persistence
(function(){
  var box = document.getElementById('appbox');
  var bar = document.getElementById('appbox-titlebar');
  if(!box || !bar) return;
  var isDrag = false, offX = 0, offY = 0;
  
  // Restore saved position on load
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('appbox_state')); } catch(e){}
  if (saved) {
    box.style.left = saved.left + 'px';
    box.style.top = saved.top + 'px';
    box.style.transform = 'none';
    if (saved.minimized) {
      box.classList.add('minimized');
    }
  } else {
    // Default: start minimized - position next to search bar
    box.classList.add('minimized');
    box.style.transform = 'none';
    box.style.opacity = '0';
    setTimeout(function(){
      var searchBar2 = document.querySelector('.top-header-search');
      if(searchBar2) {
        var sr = searchBar2.getBoundingClientRect();
        box.style.left = (sr.left - 110) + 'px';
        box.style.top = (sr.top + Math.round((sr.height - 34) / 2)) + 'px';
      } else {
        box.style.left = (window.innerWidth - 540) + 'px';
        box.style.top = '8px';
      }
      box.style.opacity = '1';
    }, 100);
  }
  
  function saveState() {
    var rect = box.getBoundingClientRect();
    try {
      localStorage.setItem('appbox_state', JSON.stringify({
        left: rect.left,
        top: rect.top,
        minimized: box.classList.contains('minimized')
      }));
    } catch(e){}
  }
  
  bar.addEventListener('mousedown', function(e){
    isDrag = true;
    var rect = box.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    box.style.transition = 'none';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function(e){
    if(!isDrag) return;
    var x = e.clientX - offX;
    var y = e.clientY - offY;
    x = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, x));
    y = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, y));
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.transform = 'none';
  });
  document.addEventListener('mouseup', function(){
    if (isDrag) saveState();
    isDrag = false;
    document.body.style.userSelect = '';
  });
  bar.addEventListener('touchstart', function(e){
    isDrag = true;
    var t = e.touches[0];
    var rect = box.getBoundingClientRect();
    offX = t.clientX - rect.left;
    offY = t.clientY - rect.top;
    box.style.transition = 'none';
  }, {passive:true});
  document.addEventListener('touchmove', function(e){
    if(!isDrag) return;
    var t = e.touches[0];
    var x = t.clientX - offX;
    var y = t.clientY - offY;
    x = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, x));
    y = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, y));
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.transform = 'none';
  }, {passive:true});
  document.addEventListener('touchend', function(){ if(isDrag) saveState(); isDrag = false; });
  
  // Expose saveState globally so toggleAppbox can use it
  window._appboxSaveState = saveState;

  // Drag to throw bubbles
  var dragBubble = null, dragStartX, dragStartY, dragLastX, dragLastY;
  
  var bCanvas2 = document.getElementById("bubbleWorld");
  if(bCanvas2){
    bCanvas2.addEventListener("mousedown", function(e){
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for(var i = bubs.length - 1; i >= 0; i--){
        var b = bubs[i];
        if(Math.hypot(mx - b.x, my - b.y) < b.r){
          dragBubble = b;
          dragStartX = mx; dragStartY = my;
          dragLastX = mx; dragLastY = my;
          e.preventDefault();
          break;
        }
      }
    });
    
    document.addEventListener("mousemove", function(e){
      if(!dragBubble) return;
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      dragBubble.x = mx;
      dragBubble.y = my;
      dragBubble.vx = (mx - dragLastX) * 0.3;
      dragBubble.vy = (my - dragLastY) * 0.3;
      dragLastX = mx; dragLastY = my;
    });
    
    document.addEventListener("mouseup", function(){
      if(dragBubble){
        var dist = Math.hypot(dragLastX - dragStartX, dragLastY - dragStartY);
        if(dist < 5 && dragBubble.token) {
          // It was a click, not a drag - open modal
          openBubbleModal(dragBubble.token);
        } else {
          // Fling it
          dragBubble.vx *= 1;
          dragBubble.vy *= 1;
        }
        dragBubble = null;
      }
    });

    // Touch events for mobile bubble interaction
    bCanvas2.addEventListener("touchstart", function(e){
      var touch = e.touches[0];
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = touch.clientX - rect.left, my = touch.clientY - rect.top;
      for(var i = bubs.length - 1; i >= 0; i--){
        var b = bubs[i];
        if(Math.hypot(mx - b.x, my - b.y) < b.r){
          dragBubble = b;
          dragStartX = mx; dragStartY = my;
          dragLastX = mx; dragLastY = my;
          e.preventDefault();
          break;
        }
      }
    }, {passive: false});

    document.addEventListener("touchmove", function(e){
      if(!dragBubble) return;
      e.preventDefault();
      var touch = e.touches[0];
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = touch.clientX - rect.left, my = touch.clientY - rect.top;
      dragBubble.x = mx;
      dragBubble.y = my;
      dragBubble.vx = (mx - dragLastX) * 0.3;
      dragBubble.vy = (my - dragLastY) * 0.3;
      dragLastX = mx; dragLastY = my;
    }, {passive: false});

    document.addEventListener("touchend", function(){
      if(dragBubble){
        var dist = Math.hypot(dragLastX - dragStartX, dragLastY - dragStartY);
        if(dist < 5 && dragBubble.token) {
          openBubbleModal(dragBubble.token);
        } else {
          dragBubble.vx *= 1;
          dragBubble.vy *= 1;
        }
        dragBubble = null;
      }
    });
  }


  })();

function toggleAppbox(){
  var box = document.getElementById('appbox');
  var isMinimized = box.classList.contains('minimized');
  
  if (!isMinimized) {
    // Save current position before minimizing
    var rect = box.getBoundingClientRect();
    box._savedLeft = rect.left;
    box._savedTop = rect.top;
    box._savedWidth = rect.width;
    
    // Get position next to search bar
    var searchBar = document.querySelector('.top-header-search');
    var targetLeft = window.innerWidth - 540;
    var targetTop = 8;
    if(searchBar) {
      var sRect = searchBar.getBoundingClientRect();
      targetLeft = sRect.left;
      targetTop = sRect.top + Math.round((sRect.height - 34) / 2);
    }
    
    // Phase 1: slight scale down + squeeze (genie start)
    box.style.transition = 'none';
    box.style.transformOrigin = 'top center';
    box.offsetHeight; // force reflow
    
    box.style.transition = 'all 0.15s cubic-bezier(0.4, 0, 1, 1)';
    box.style.transform = 'scaleY(0.92) scaleX(0.95)';
    box.style.opacity = '0.9';
    
    setTimeout(function(){
      // Phase 2: genie suck - shrink toward target
      box.classList.add('minimized');
      var miniWidth = box.offsetWidth || 100;
      var finalLeft = targetLeft - miniWidth - 10;
      if (finalLeft < 4) finalLeft = 4;
      
      box.style.transition = 'all 0.35s cubic-bezier(0.2, 0, 0, 1)';
      box.style.left = finalLeft + 'px';
      box.style.top = targetTop + 'px';
      box.style.transform = 'scaleX(1) scaleY(1)';
      box.style.opacity = '1';
      
      // Phase 3: little bounce at the end
      setTimeout(function(){
        box.style.transition = 'transform 0.15s cubic-bezier(0, 0, 0.2, 1.4)';
        box.style.transform = 'scale(1.06)';
        setTimeout(function(){
          box.style.transition = 'transform 0.1s ease-out';
          box.style.transform = 'scale(1)';
          if (window._appboxSaveState) window._appboxSaveState();
        }, 150);
      }, 350);
    }, 150);
    
  } else {
    // Restore: reverse genie
    var savedLeft = box._savedLeft !== undefined ? box._savedLeft : 20;
    var savedTop = box._savedTop !== undefined ? box._savedTop : 80;
    
    // Phase 1: pop out slightly
    box.style.transition = 'transform 0.1s ease-in';
    box.style.transform = 'scale(1.1)';
    
    setTimeout(function(){
      // Phase 2: expand back to full size at original position
      box.classList.remove('minimized');
      box.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
      box.style.left = savedLeft + 'px';
      box.style.top = savedTop + 'px';
      box.style.transform = 'scaleX(1) scaleY(1)';
      box.style.opacity = '1';
      
      // Phase 3: settle bounce
      setTimeout(function(){
        box.style.transition = 'transform 0.2s cubic-bezier(0, 0, 0.2, 1.2)';
        box.style.transform = 'scale(1.02)';
        setTimeout(function(){
          box.style.transition = 'transform var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard)-out';
          box.style.transform = 'scale(1)';
          if (window._appboxSaveState) window._appboxSaveState();
        }, 200);
      }, 500);
    }, 100);
  }
}

function appNav(el){
  document.querySelectorAll('.appbox-tile').forEach(function(t){ t.classList.remove('active'); });
  el.classList.add('active');
}


// ========== SETTINGS PANEL ==========
var settingsVisible = false;

function toggleSettingsPanel() {
  settingsVisible = !settingsVisible;
  document.getElementById('settings-panel').classList.toggle('open', settingsVisible);
}

// Wire up the Settings tile in DexHub
(function(){
  var tiles = document.querySelectorAll('.appbox-tile');
  tiles.forEach(function(tile){
    if (tile.getAttribute('data-route') === 'settings') {
      tile.onclick = function(){
        appNav(this);
        toggleSettingsPanel();
      };
    }
  });

  // Drag to throw bubbles
  var dragBubble = null, dragStartX, dragStartY, dragLastX, dragLastY;
  
  var bCanvas2 = document.getElementById("bubbleWorld");
  if(bCanvas2){
    bCanvas2.addEventListener("mousedown", function(e){
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for(var i = bubs.length - 1; i >= 0; i--){
        var b = bubs[i];
        if(Math.hypot(mx - b.x, my - b.y) < b.r){
          dragBubble = b;
          dragStartX = mx; dragStartY = my;
          dragLastX = mx; dragLastY = my;
          e.preventDefault();
          break;
        }
      }
    });
    
    document.addEventListener("mousemove", function(e){
      if(!dragBubble) return;
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      dragBubble.x = mx;
      dragBubble.y = my;
      dragBubble.vx = (mx - dragLastX) * 0.3;
      dragBubble.vy = (my - dragLastY) * 0.3;
      dragLastX = mx; dragLastY = my;
    });
    
    document.addEventListener("mouseup", function(){
      if(dragBubble){
        var dist = Math.hypot(dragLastX - dragStartX, dragLastY - dragStartY);
        if(dist < 5 && dragBubble.token) {
          // It was a click, not a drag - open modal
          openBubbleModal(dragBubble.token);
        } else {
          // Fling it
          dragBubble.vx *= 1;
          dragBubble.vy *= 1;
        }
        dragBubble = null;
      }
    });
  }


  })();

// Theme system
var currentThemeName = 'Default';

function applyTheme(el) {
  var bg = el.getAttribute('data-bg');
  var surface = el.getAttribute('data-surface');
  var accent = el.getAttribute('data-accent');
  var text = el.getAttribute('data-text');
  var root = document.documentElement;
  
  // Determine if light theme
  var isLight = parseInt(bg.slice(1,3), 16) > 128;
  
  root.style.setProperty('--bg-void', bg);
  root.style.setProperty('--bg-primary', bg);
  root.style.setProperty('--bg-secondary', surface);
  root.style.setProperty('--bg-surface', isLight ? darken(surface, 0.03) : lighten(surface, 0.03));
  root.style.setProperty('--bg-hover', isLight ? darken(surface, 0.06) : lighten(surface, 0.06));
  root.style.setProperty('--bg-elevated', isLight ? darken(surface, 0.03) : lighten(surface, 0.03));
  root.style.setProperty('--phantom-purple', accent);
  root.style.setProperty('--phantom-purple-dim', accent + '1f');
  root.style.setProperty('--phantom-purple-glow', accent + '33');
  root.style.setProperty('--text-primary', text);
  root.style.setProperty('--text-secondary', isLight ? 'rgba(0,0,0,0.55)' : '#A7B4C6');
  root.style.setProperty('--text-secondary', isLight ? 'rgba(0,0,0,0.55)' : '#e6e1e3');
  root.style.setProperty('--border', isLight ? 'rgba(0,0,0,0.08)' : 'rgba(220,220,220,0.12)');
  root.style.setProperty('--border-strong', isLight ? 'rgba(0,0,0,0.15)' : 'rgba(220,220,220,0.22)');
  root.style.setProperty('--green', isLight ? '#16a34a' : '#22C55E');
  root.style.setProperty('--red', isLight ? '#dc2626' : '#EF4444');
  
  // Update body bg
  document.body.style.background = bg;
  document.body.style.color = text;
  
  // Update fixed elements
  var topHeader = document.querySelector('.top-header-bar');
  if (topHeader) {
    topHeader.style.background = isLight ? surface : '';
    topHeader.style.borderBottomColor = isLight ? 'rgba(0,0,0,0.08)' : '';
  }
  
  var topbar = document.querySelector('.topbar');
  if (topbar) {
    topbar.style.background = isLight ? surface : '';
    topbar.style.borderBottomColor = isLight ? 'rgba(0,0,0,0.06)' : '';
  }
  
  // Update topbar stat values
  document.querySelectorAll('.topbar-stat-value').forEach(function(el){
    el.style.color = isLight ? text : '';
  });
  
  // Update thead
  document.querySelectorAll('thead th').forEach(function(th){
    th.style.background = isLight ? darken(surface, 0.06) : '';
    th.style.color = isLight ? text : '';
  });
  
  // Update table cells
  document.querySelectorAll('tbody td').forEach(function(td){
    td.style.color = isLight ? text : '';
  });
  document.querySelectorAll('.price-col').forEach(function(el){
    el.style.color = isLight ? text : '';
  });
  document.querySelectorAll('.token-symbol').forEach(function(el){
    el.style.color = isLight ? text : '';
  });
  
  // Update filter bar
  var filterBar = document.querySelector('.filter-bar');
  if (filterBar) {
    filterBar.style.background = isLight ? surface : '';
    filterBar.style.borderBottomColor = isLight ? 'rgba(0,0,0,0.06)' : '';
  }
  
  // Update trending bar
  var trendBar = document.querySelector('.x-trending-bar');
  if (trendBar) {
    trendBar.style.background = isLight ? darken(surface, 0.02) : '';
  }
  
  // Update appbox
  var appbox = document.getElementById('appbox');
  if (appbox) {
    var titlebar = appbox.querySelector('.appbox-titlebar');
    if (titlebar) titlebar.style.background = isLight ? darken(surface, 0.05) : '';
    appbox.style.background = isLight ? surface : '';
    appbox.style.borderColor = isLight ? 'rgba(0,0,0,0.1)' : '';
    // Update tile labels
    appbox.querySelectorAll('.appbox-tile-label').forEach(function(l){
      l.style.color = isLight ? 'rgba(0,0,0,0.5)' : '';
    });
    appbox.querySelector('.appbox-title').style.color = isLight ? 'rgba(0,0,0,0.5)' : '';
  }
  
  // Update search bar
  var searchBar = document.querySelector('.top-header-search');
  if (searchBar) {
    searchBar.style.background = isLight ? 'rgba(0,0,0,0.04)' : '';
    searchBar.style.borderColor = isLight ? 'rgba(0,0,0,0.1)' : '';
    var searchInput = searchBar.querySelector('input');
    if (searchInput) searchInput.style.color = isLight ? text : '';
  }
  
  // Update search modal
  var searchModal = document.querySelector('.search-modal');
  if (searchModal) {
    searchModal.style.background = isLight ? surface : '';
    searchModal.style.borderColor = isLight ? 'rgba(0,0,0,0.1)' : '';
  }
  
  // Update popups (settings, watchlist, alerts, social)
  document.querySelectorAll('.settings-panel, .watchlist-panel, .alerts-panel, .social-feeds-row').forEach(function(p){
    p.style.background = isLight ? surface : '';
    p.style.borderColor = isLight ? 'rgba(0,0,0,0.1)' : '';
  });
  document.querySelectorAll('.popup-titlebar').forEach(function(t){
    t.style.background = isLight ? darken(surface, 0.03) : '';
  });
  document.querySelectorAll('.popup-titlebar-left').forEach(function(t){
    t.style.color = isLight ? text : '';
  });
  
  // Update connect wallet button
  var connectBtn = document.querySelector('.connect-btn');
  if (connectBtn) {
    connectBtn.style.background = isLight ? accent : '';
    connectBtn.style.color = isLight ? '#fff' : '';
  }
  
  // Toggle a class on body for CSS fallbacks
  document.body.classList.toggle('light-theme', isLight);
  document.body.classList.toggle('dark-theme', !isLight);
  
  // Invert logos in light mode (white logos on light bg)
  document.querySelectorAll('.top-header-logo, .appbox-titlebar img').forEach(function(img){
    img.style.filter = isLight ? 'invert(1)' : '';
  });
  
  // Fix DexSocial name color in light mode
  var headerName = document.querySelector('.top-header-name');
  if (headerName) headerName.style.color = isLight ? text : '';
  
  // Mark active swatch
  document.querySelectorAll('.settings-theme-swatch').forEach(function(s){ s.classList.remove('active'); });
  el.classList.add('active');
}

function lighten(hex, amount) {
  var r = parseInt(hex.slice(1,3),16);
  var g = parseInt(hex.slice(3,5),16);
  var b = parseInt(hex.slice(5,7),16);
  r = Math.min(255, r + Math.round(255*amount));
  g = Math.min(255, g + Math.round(255*amount));
  b = Math.min(255, b + Math.round(255*amount));
  return '#' + [r,g,b].map(function(c){return c.toString(16).padStart(2,'0');}).join('');
}
function darken(hex, amount) {
  var r = parseInt(hex.slice(1,3),16);
  var g = parseInt(hex.slice(3,5),16);
  var b = parseInt(hex.slice(5,7),16);
  r = Math.max(0, r - Math.round(255*amount));
  g = Math.max(0, g - Math.round(255*amount));
  b = Math.max(0, b - Math.round(255*amount));
  return '#' + [r,g,b].map(function(c){return c.toString(16).padStart(2,'0');}).join('');
}

// Sound toggles
var alertSoundEnabled = false;
var newPairSoundEnabled = true;

function toggleAlertSound(on) { alertSoundEnabled = on; }
function toggleNewPairSound(on) { newPairSoundEnabled = on; }

// Mark default theme as active on load
(function(){
  var swatches = document.querySelectorAll('.settings-theme-swatch');
  if (swatches.length > 0) swatches[0].classList.add('active');

  // Drag to throw bubbles
  var dragBubble = null, dragStartX, dragStartY, dragLastX, dragLastY;
  
  var bCanvas2 = document.getElementById("bubbleWorld");
  if(bCanvas2){
    bCanvas2.addEventListener("mousedown", function(e){
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for(var i = bubs.length - 1; i >= 0; i--){
        var b = bubs[i];
        if(Math.hypot(mx - b.x, my - b.y) < b.r){
          dragBubble = b;
          dragStartX = mx; dragStartY = my;
          dragLastX = mx; dragLastY = my;
          e.preventDefault();
          break;
        }
      }
    });
    
    document.addEventListener("mousemove", function(e){
      if(!dragBubble) return;
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      dragBubble.x = mx;
      dragBubble.y = my;
      dragBubble.vx = (mx - dragLastX) * 0.3;
      dragBubble.vy = (my - dragLastY) * 0.3;
      dragLastX = mx; dragLastY = my;
    });
    
    document.addEventListener("mouseup", function(){
      if(dragBubble){
        var dist = Math.hypot(dragLastX - dragStartX, dragLastY - dragStartY);
        if(dist < 5 && dragBubble.token) {
          // It was a click, not a drag - open modal
          openBubbleModal(dragBubble.token);
        } else {
          // Fling it
          dragBubble.vx *= 1;
          dragBubble.vy *= 1;
        }
        dragBubble = null;
      }
    });
  }


  })();


// ========== SEARCH MODAL ==========
var searchHighlightIdx = -1;

function openSearchModal() {
  if (window._mcAddMode) return;
  var overlay = document.getElementById('search-overlay');
  var bar = document.getElementById('headerSearchBar');
  var modal = document.getElementById('search-modal');
  var isMobile = window.innerWidth <= 768;
  if (!isMobile && bar && modal) {
    // Desktop: position modal over the search bar — one continuous surface
    var rect = bar.getBoundingClientRect();
    modal.style.top = rect.top + 'px';
    modal.style.left = rect.left + 'px';
    modal.style.width = rect.width + 'px';
    modal.style.transform = 'none';
    // Hide the header bar so modal replaces it
    bar.style.opacity = '0';
    bar.style.pointerEvents = 'none';
  } else if (isMobile && modal) {
    modal.style.top = '';
    modal.style.left = '';
    modal.style.width = '';
    modal.style.transform = '';
    modal.style.animation = '';
  }
  if (isMobile) {
    window._scrollY = window.scrollY;
    document.body.classList.add('modal-scroll-lock');
    document.body.style.top = -window._scrollY + 'px';
    lockScroll();
  } else {
    document.body.style.overflow = 'hidden';
  }
  overlay.classList.add('open');
  var input = document.getElementById('search-modal-input');
  input.value = '';
  if (!isMobile) input.focus();
  else setTimeout(function() { input.focus(); }, 300);
  searchHighlightIdx = -1;
  // Reset chain filter to All on each open
  _searchChain = 'all';
  var chainCur = document.getElementById('searchChainCurrent');
  if (chainCur) chainCur.src = '/img/globe-chains.svg';
  var chainBtn = document.getElementById('searchChainBtn');
  if (chainBtn) chainBtn.classList.remove('filtered');
  var chainMenu = document.getElementById('searchChainMenu');
  if (chainMenu) chainMenu.classList.remove('open');
  showSearchDefault();
}

function closeSearchModal() {
  document.getElementById('search-overlay').classList.remove('open');
  if (window.innerWidth <= 768) unlockScroll();
  else document.body.style.overflow = '';
  if (document.body.classList.contains('modal-scroll-lock')) {
    document.body.classList.remove('modal-scroll-lock');
    document.body.style.top = '';
    window.scrollTo(0, window._scrollY || 0);
  }
  searchHighlightIdx = -1;
  var bar = document.getElementById('headerSearchBar');
  if (bar) {
    bar.style.opacity = '';
    bar.style.pointerEvents = '';
  }
  var modal = document.getElementById('search-modal');
  if (modal) { modal.style.height = ''; modal.style.transition = ''; }
}

// Wire up the header search bar to open modal
(function(){
  var headerSearch = document.querySelector('.top-header-search');
  var headerInput = headerSearch ? headerSearch.querySelector('input') : null;
  if (headerSearch) {
    headerSearch.style.cursor = 'pointer';
    headerSearch.addEventListener('click', function(e) {
      e.preventDefault();
      openSearchModal();
    });
  }
  if (headerInput) {
    headerInput.readOnly = true;
    headerInput.style.cursor = 'pointer';
  }

  // Drag to throw bubbles
  var dragBubble = null, dragStartX, dragStartY, dragLastX, dragLastY;
  
  var bCanvas2 = document.getElementById("bubbleWorld");
  if(bCanvas2){
    bCanvas2.addEventListener("mousedown", function(e){
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for(var i = bubs.length - 1; i >= 0; i--){
        var b = bubs[i];
        if(Math.hypot(mx - b.x, my - b.y) < b.r){
          dragBubble = b;
          dragStartX = mx; dragStartY = my;
          dragLastX = mx; dragLastY = my;
          e.preventDefault();
          break;
        }
      }
    });
    
    document.addEventListener("mousemove", function(e){
      if(!dragBubble) return;
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      dragBubble.x = mx;
      dragBubble.y = my;
      dragBubble.vx = (mx - dragLastX) * 0.3;
      dragBubble.vy = (my - dragLastY) * 0.3;
      dragLastX = mx; dragLastY = my;
    });
    
    document.addEventListener("mouseup", function(){
      if(dragBubble){
        var dist = Math.hypot(dragLastX - dragStartX, dragLastY - dragStartY);
        if(dist < 5 && dragBubble.token) {
          // It was a click, not a drag - open modal
          openBubbleModal(dragBubble.token);
        } else {
          // Fling it
          dragBubble.vx *= 1;
          dragBubble.vy *= 1;
        }
        dragBubble = null;
      }
    });
  }


  })();

// Keyboard shortcut: / to open search
document.addEventListener('keydown', function(e) {
  if (e.key === '/' && !document.getElementById('search-overlay').classList.contains('open')) {
    var tag = document.activeElement.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
      e.preventDefault();
      openSearchModal();
    }
  }
  if (e.key === 'Escape' && document.getElementById('search-overlay').classList.contains('open')) {
    closeSearchModal();
  }
  // Arrow keys for navigation
  if (document.getElementById('search-overlay').classList.contains('open')) {
    var items = document.querySelectorAll('#search-modal-body .search-modal-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchHighlightIdx = Math.min(searchHighlightIdx + 1, items.length - 1);
      updateSearchHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchHighlightIdx = Math.max(searchHighlightIdx - 1, 0);
      updateSearchHighlight(items);
    } else if (e.key === 'Enter' && searchHighlightIdx >= 0 && searchHighlightIdx < items.length) {
      items[searchHighlightIdx].click();
    }
  }
});

function updateSearchHighlight(items) {
  items.forEach(function(el, i) {
    el.classList.toggle('highlighted', i === searchHighlightIdx);
    if (i === searchHighlightIdx) el.scrollIntoView({block:'nearest'});
  });
}

// Recent searches
function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem('memescope_recent_searches') || '[]'); } catch(e) { return []; }
}
function saveRecentSearch(token) {
  var recent = getRecentSearches();
  // Remove if already exists
  recent = recent.filter(function(r) { return r.sym !== token.sym; });
  // Add to front
  recent.unshift({ sym: token.sym, name: token.name, img: token.img || '', net: token.net || 'solana', price: token.price, p1h: token.p1h || 0, p24h: token.p24h || 0, mcap: token.mcap || 0, liq: token.liq || 0, vol: token.vol || 0, age: token.age || '?', ca: token.ca || '' });
  // Keep max 8
  recent = recent.slice(0, 8);
  try { localStorage.setItem('memescope_recent_searches', JSON.stringify(recent)); } catch(e) {}
}
function clearRecentSearches() {
  try { localStorage.removeItem('memescope_recent_searches'); } catch(e) {}
  renderRecentSearches();
}
function renderRecentSearches() {
  var recent = getRecentSearches();
  var list = document.getElementById('search-recent-list');
  if (!list) return;
  var clearBtn = document.getElementById('searchClearRecent');
  if (recent.length === 0) {
    list.innerHTML = '<div class="search-modal-empty">No recent searches</div>';
    if (clearBtn) clearBtn.style.display = 'none';
  } else {
    list.innerHTML = '<div class="recent-chips">' + recent.map(function(t) {
      var gradIdx = Math.abs(t.sym.charCodeAt(0) * 7 + (t.sym.charCodeAt(1)||0) * 13) % GRADIENTS.length;
      var grad = GRADIENTS[gradIdx] || '#666,#999';
      var letter = t.sym ? t.sym.charAt(0) : '?';
      var imgHtml = t.img
        ? '<img decoding="async" src="' + imgProxy(t.img, 40, 40) + '" style="width:20px;height:20px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'">'
        : '<div style="width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,' + grad + ');display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">' + letter + '</div>';
      return '<div class="recent-chip" onclick="selectSearchResult(\'' + (t.ca || '').replace(/'/g,'') + '\',\'' + t.sym + '\')">' + imgHtml + '<span>' + t.sym + '</span></div>';
    }).join('') + '</div>';
    if (clearBtn) clearBtn.style.display = '';
  }
}

function showSearchDefault() {
  // Show trending tokens
  var trending = LIVE_TOKENS.slice().sort(function(a,b){ return Math.abs(b.p24h) - Math.abs(a.p24h); }).slice(0, 6);
  var list = document.getElementById('search-trending-list');
  list.innerHTML = trending.map(function(t) {
    return buildSearchItem(t);
  }).join('');

  // Show boosted tokens as pills
  var boosted = LIVE_TOKENS.filter(function(t) { return t.boosted; });
  var boostedSection = document.getElementById('search-boosted');
  var boostedList = document.getElementById('search-boosted-list');
  if (boosted.length > 0) {
    boostedList.innerHTML = boosted.map(function(t) {
      var imgHtml = t.img
        ? '<img class="boosted-chip-img" decoding="async" src="' + imgProxy(t.img, 40, 40) + '" onerror="this.style.display=\'none\'">'
        : '';
      return '<div class="boosted-chip" onclick="selectSearchResult(\'' + (t.ca || '').replace(/'/g,'') + '\',\'' + t.sym + '\')">' +
        imgHtml +
        '<span class="boosted-chip-sym">' + t.sym + '</span>' +
        '<span class="boosted-chip-count">⚡' + (t.boostCount || '') + '</span>' +
      '</div>';
    }).join('');
    boostedSection.style.display = '';
  } else {
    boostedSection.style.display = 'none';
  }

  renderRecentSearches();
  document.getElementById('search-trending').style.display = '';
  document.getElementById('search-recent').style.display = '';
  document.getElementById('search-results').style.display = 'none';
}

// ── Search chain filter (desktop) ───────────────────────────────────────────
var _searchChain = 'all';
var SEARCH_CHAINS = [
  { id: 'all', label: 'All Chains', icon: '/img/globe-chains.svg' },
  { id: 'solana', label: 'Solana' },
  { id: 'eth', label: 'Ethereum' },
  { id: 'base', label: 'Base' },
  { id: 'sui', label: 'Sui' },
  { id: 'bsc', label: 'BSC' },
  { id: 'tron', label: 'Tron' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'avalanche', label: 'Avalanche' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'optimism', label: 'Optimism' },
  { id: 'blast', label: 'Blast' },
  { id: 'ton', label: 'TON' },
  { id: 'pulsechain', label: 'Pulsechain' },
  { id: 'seiv2', label: 'Sei' },
  { id: 'sonic', label: 'Sonic' },
  { id: 'hyperliquid', label: 'Hyperliquid' },
  { id: 'berachain', label: 'Berachain' },
  { id: 'monad', label: 'Monad' },
  { id: 'cronos', label: 'Cronos' },
  { id: 'aptos', label: 'Aptos' },
  { id: 'linea', label: 'Linea' },
  { id: 'zksync', label: 'zkSync' },
  { id: 'fantom', label: 'Fantom' },
  { id: 'mantle', label: 'Mantle' },
  { id: 'scroll', label: 'Scroll' },
  { id: 'manta', label: 'Manta' },
  { id: 'starknet', label: 'Starknet' }
];

function _buildSearchChainMenu() {
  var menu = document.getElementById('searchChainMenu');
  if (!menu) return;
  menu.innerHTML = '<div class="search-chain-title">Filter by chain</div>' +
    '<div class="search-chain-grid">' +
    SEARCH_CHAINS.map(function(c) {
      var icon = c.icon || CHAIN_ICONS[c.id] || '';
      var active = (_searchChain === c.id) ? ' active' : '';
      return '<button class="search-chain-opt' + active + '" onclick="event.stopPropagation(); setSearchChain(\'' + c.id + '\')" title="' + c.label + '">' +
        '<span class="search-chain-ic"><img src="' + icon + '" alt="' + c.label + '"></span>' +
        '<span class="search-chain-lbl">' + c.label + '</span></button>';
    }).join('') + '</div>';
}

function toggleSearchChainMenu() {
  var menu = document.getElementById('searchChainMenu');
  if (!menu) return;
  if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
  _buildSearchChainMenu();
  menu.classList.add('open');
}

function setSearchChain(chain) {
  _searchChain = chain || 'all';
  var cur = document.getElementById('searchChainCurrent');
  if (cur) cur.src = (_searchChain === 'all') ? '/img/globe-chains.svg' : (CHAIN_ICONS[_searchChain] || '/img/globe-chains.svg');
  var btn = document.getElementById('searchChainBtn');
  if (btn) btn.classList.toggle('filtered', _searchChain !== 'all');
  var menu = document.getElementById('searchChainMenu');
  if (menu) menu.classList.remove('open');
  var input = document.getElementById('search-modal-input');
  if (input) handleSearchInput(input.value);
}

// Close the chain menu when clicking anywhere else
document.addEventListener('click', function(e) {
  var menu = document.getElementById('searchChainMenu');
  if (!menu || !menu.classList.contains('open')) return;
  if (e.target.closest && e.target.closest('.search-chain-wrap')) return;
  menu.classList.remove('open');
});

function handleSearchInput(query) {
  var q = query.trim().toLowerCase();
  if (!q) {
    showSearchDefault();
    searchHighlightIdx = -1;
    return;
  }

  // Filter loaded tokens first
  var localResults = LIVE_TOKENS.filter(function(t) {
    var match = t.sym.toLowerCase().indexOf(q) !== -1 ||
           t.name.toLowerCase().indexOf(q) !== -1 ||
           (t.ca && t.ca.toLowerCase().indexOf(q) !== -1);
    if (!match) return false;
    if (_searchChain !== 'all' && t.net !== _searchChain) return false;
    return true;
  }).sort(function(a,b) { return (b.mcap||0) - (a.mcap||0); }).slice(0, 8);

  var resultsList = document.getElementById('search-results-list');

  // Show local results immediately if any
  if (localResults.length > 0) {
    resultsList.innerHTML = localResults.map(function(t) {
      return buildSearchItem(t);
    }).join('');
  } else {
    resultsList.innerHTML = '<div class="search-modal-empty"><div class="loading-spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle"></div></div>';
  }

  // Always also search DexScreener/Supabase and merge results
  clearTimeout(window._liveSearchTimer);
  window._liveSearchTimer = setTimeout(function() {
    liveSearchDexScreener(q, resultsList, localResults);
  }, 400);
  
  document.getElementById('search-trending').style.display = 'none';
  document.getElementById('search-recent').style.display = 'none';
  document.getElementById('search-boosted').style.display = 'none';
  document.getElementById('search-results').style.display = '';
  searchHighlightIdx = -1;
}

async function liveSearchDexScreener(query, resultsList, localResults) {
  try {
    var isCA = query.length > 30;
    var url = isCA 
      ? 'https://api.dexscreener.com/latest/dex/tokens/' + query
      : 'https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(query);
    
    // Always use DexScreener for search — live prices
    
    var resp = await fetch(url);
    
    if(!resp.ok) { resultsList.innerHTML = '<div class="search-modal-empty">Search failed</div>'; return; }
    var data = await resp.json();
    
    var pairs = [];
    var chainMap = {solana:'solana',ethereum:'eth',base:'base',bsc:'bsc',sui:'sui',tron:'tron',arbitrum:'arbitrum',avalanche:'avalanche',polygon:'polygon',optimism:'optimism',blast:'blast',ton:'ton',seiv2:'seiv2',pulsechain:'pulsechain'};
    
    // Add DexScreener/API results
    if(data.tokens) {
      for(var t = 0; t < data.tokens.length; t++) { pairs.push(data.tokens[t]); }
    } else if(data.pairs) {
      for(var i = 0; i < Math.min(data.pairs.length, 20); i++) {
        var p = data.pairs[i];
        if(!p.baseToken) continue;
        var pc = p.priceChange || {};
        pairs.push({
          sym: p.baseToken.symbol.toUpperCase(), name: p.baseToken.name || p.baseToken.symbol,
          img: (p.info && p.info.imageUrl) ? p.info.imageUrl : '',
          price: p.priceUsd ? parseFloat(p.priceUsd) : 0,
          priceNative: p.priceNative ? parseFloat(p.priceNative) : 0,
          quoteSymbol: p.quoteToken ? p.quoteToken.symbol.toUpperCase() : '',
          p24h: pc.h24 ? parseFloat(pc.h24) : 0,
          net: chainMap[p.chainId] || 'solana', ca: p.baseToken.address || '',
          mcap: p.marketCap || p.fdv || 0, vol: p.volume ? (p.volume.h24||0) : 0,
          liq: p.liquidity ? (p.liquidity.usd||0) : 0,
          p5m: pc.m5?parseFloat(pc.m5):0, p1h: pc.h1?parseFloat(pc.h1):0,
          p6h: pc.h6?parseFloat(pc.h6):0,
          age: p.pairCreatedAt ? _calcAge(p.pairCreatedAt) : '?', txn: 0, dex: p.dexId||'unknown',
          social: 0, boosted: false, _liveResult: true, pairAddress: p.pairAddress || ''
        });
      }
    }
    
    // Deduplicate by contract address, prefer entries with images
    var seenCA = {};
    var deduped = [];
    pairs.sort(function(a,b) { return (b.mcap||0) - (a.mcap||0); });
    for(var j = 0; j < pairs.length; j++) {
      var key = (pairs[j].ca || '') + (pairs[j].net || '');
      if(key && seenCA[key] !== undefined) {
        // If existing entry has no image but this one does, replace it
        if(!deduped[seenCA[key]].img && pairs[j].img) {
          deduped[seenCA[key]].img = pairs[j].img;
        }
        continue;
      }
      if(key) seenCA[key] = deduped.length;
      deduped.push(pairs[j]);
    }

    if (_searchChain !== 'all') {
      deduped = deduped.filter(function(t) { return t.net === _searchChain; });
    }

    var displayResults = deduped.slice(0, 8);
    if(displayResults.length > 0) {
      resultsList.innerHTML = displayResults.map(function(t) {
        return buildSearchItem(t);
      }).join('');
      // Lazy-load missing avatars from DexScreener token endpoint
      displayResults.forEach(function(t, idx) {
        if(!t.img && t.ca) {
          fetch('https://api.dexscreener.com/latest/dex/tokens/' + t.ca)
            .then(function(r){ return r.json(); })
            .then(function(d){
              if(d && d.pairs && d.pairs[0] && d.pairs[0].info && d.pairs[0].info.imageUrl) {
                var items = resultsList.querySelectorAll('.search-modal-item');
                if(items[idx]) {
                  var av = items[idx].querySelector('.search-modal-item-avatar');
                  if(av) {
                    var img = document.createElement('img');
                    img.className = 'search-modal-item-avatar';
                    img.src = d.pairs[0].info.imageUrl;
                    img.style.objectFit = 'cover';
                    av.replaceWith(img);
                  }
                }
              }
            }).catch(function(){});
        }
      });
    } else if(!localResults || !localResults.length) {
      resultsList.innerHTML = '<div class="search-modal-empty">No tokens found for "' + query + '"</div>';
    }
  } catch(e) {
    resultsList.innerHTML = '<div class="search-modal-empty">Search error</div>';
  }
}

function buildSearchItem(t) {
  var gradIdx = LIVE_TOKENS.indexOf(t);
  if(gradIdx < 0) gradIdx = Math.abs(t.sym.charCodeAt(0) * 7 + (t.sym.charCodeAt(1)||0) * 13) % GRADIENTS.length;
  var grad = GRADIENTS[gradIdx] || '#666,#999';
  var letter = t.sym ? t.sym.charAt(0) : '?';
  var chainImg = CHAIN_ICONS[t.net] || CHAIN_ICONS['solana'];
  var c1h = Math.max(-9999, Math.min(9999, t.p1h || 0));
  var c24h = Math.max(-9999, Math.min(9999, t.p24h || 0));
  var c1hCls = c1h >= 0 ? 'up' : 'down';
  var c24hCls = c24h >= 0 ? 'up' : 'down';
  var c1hStr = (c1h >= 0 ? '+' : '') + c1h.toFixed(2) + '%';
  var c24hStr = (c24h >= 0 ? '+' : '') + c24h.toFixed(2) + '%';
  var caShort = t.ca ? (t.ca.slice(0,6) + '...' + t.ca.slice(-4)) : '';
  var pairCa = t.pairAddress ? (t.pairAddress.slice(0,6) + '...' + t.pairAddress.slice(-4)) : '';
  
  var avatarHtml = t.img
    ? '<img class="search-modal-item-avatar" decoding="async" src="' + imgProxy(t.img, 64, 64) + '" style="object-fit:cover" onerror="this.style.display=\'none\'">'
    : '<div class="search-modal-item-avatar" style="background:linear-gradient(135deg,' + grad + ')">' + letter + '</div>';
  
  var addrHtml = '';
  if(caShort) addrHtml += '<span style="color:var(--text-secondary);font-size:10px">TOKEN:</span> ' + caShort + ' ';
  if(pairCa) addrHtml += '<span style="color:var(--text-secondary);font-size:10px">PAIR:</span> ' + pairCa;

  return '<div class="search-modal-item" onclick="selectSearchResult(\'' + (t.ca || '').replace(/'/g,'') + '\',\'' + t.sym + '\')">' +
    '<div class="smi-top">' +
      '<div class="smi-token-info">' +
        '<div class="smi-left">' + avatarHtml +
          '<img class="search-modal-item-chain" src="' + chainImg + '">' +
        '</div>' +
        '<div class="smi-name-block">' +
          '<span class="smi-sym">' + t.sym + '</span>' +
          '<span class="smi-fullname">' + (t.name || '') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="smi-data-pair"><span class="smi-col-price">' + fmtPrice(t.price) + '</span>' +
      '<span class="smi-col-mcap"><span class="smi-label">MC</span> ' + fmt(t.mcap) + '</span></div>' +
      '<div class="smi-data-pair"><span class="smi-col-pct ' + c24hCls + '">' + c24hStr + '</span>' +
      '<span class="smi-col-vol"><span class="smi-label">Vol</span> ' + fmt(t.vol) + '</span></div>' +
    '</div>' +
  '</div>';
}

function selectSearchResult(ca, sym) {
  closeSearchModal();
  // Match by CA first (exact match), only fall back to symbol if no CA
  var token = null;
  if (ca) token = LIVE_TOKENS.find(function(t){ return t.ca === ca; });
  if (!token && !ca) token = LIVE_TOKENS.find(function(t){ return t.sym === sym; });
  if(token) {
    saveRecentSearch(token);
    openBubbleModal(token);
  } else {
    // Token from live search - do a fresh lookup by CA first, then symbol
    var query = ca || sym;
    fetch('https://api.dexscreener.com/latest/dex/' + (ca ? 'tokens/' : 'search?q=') + encodeURIComponent(query))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(d && d.pairs && d.pairs.length > 0) {
          var p = d.pairs[0];
          var pc = p.priceChange || {};
          var chainMap = {solana:'solana',ethereum:'eth',base:'base',bsc:'bsc',sui:'sui',tron:'tron',arbitrum:'arbitrum',avalanche:'avalanche',polygon:'polygon',optimism:'optimism',blast:'blast',ton:'ton',seiv2:'seiv2',pulsechain:'pulsechain'};
          var t = {
            sym: p.baseToken.symbol.toUpperCase(), name: p.baseToken.name,
            img: (p.info && p.info.imageUrl) ? p.info.imageUrl : '',
            price: p.priceUsd ? parseFloat(p.priceUsd) : 0,
            mcap: p.marketCap || p.fdv || 0, vol: p.volume?(p.volume.h24||0):0,
            liq: p.liquidity?(p.liquidity.usd||0):0,
            p5m:pc.m5?parseFloat(pc.m5):0, p1h:pc.h1?parseFloat(pc.h1):0,
            p6h:pc.h6?parseFloat(pc.h6):0, p24h:pc.h24?parseFloat(pc.h24):0,
            age: p.pairCreatedAt ? _calcAge(p.pairCreatedAt) : '?', txn:0, net:chainMap[p.chainId]||'solana',
            dex:p.dexId||'unknown', social:0, boosted:false, ca:p.baseToken.address||''
          };
          saveRecentSearch(t);
          openBubbleModal(t);
        }
      }).catch(function(){});
  }
}


// ========== SEARCH TABS ==========
var currentSearchTab = 'tokens';

function switchSearchTab(tab) {
  currentSearchTab = tab;
  document.getElementById('search-tab-tokens').classList.toggle('active', tab === 'tokens');
  document.getElementById('search-tab-x').classList.toggle('active', tab === 'x');
  
  // Show/hide sections based on tab
  var query = document.getElementById('search-modal-input').value.trim();
  if (tab === 'tokens') {
    document.getElementById('search-x-results').style.display = 'none';
    if (query) {
      handleSearchInput(query);
    } else {
      showSearchDefault();
    }
  } else {
    // X tab
    document.getElementById('search-trending').style.display = 'none';
    document.getElementById('search-recent').style.display = 'none';
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('search-x-results').style.display = '';
    showXPosts(query);
  }
}

// Mock X/Twitter posts data
var MOCK_X_POSTS = [
  {user:'CryptoWhale', handle:'@CryptoWhale', avatar:'#667EEA', text:'<span class="mention">$PEPE</span> looking extremely bullish on the 4H chart. Higher lows forming. Next leg up imminent <span class="hashtag">#PEPE</span>', likes:842, retweets:156, time:'2m'},
  {user:'DegenSpartan', handle:'@DegenSpartan', avatar:'#F093FB', text:'Just aped into <span class="mention">$GOAT</span> with 50 SOL. This chart is identical to early $WIF. NFA but the setup is perfect.', likes:1203, retweets:289, time:'5m'},
  {user:'HsakaTrades', handle:'@HsakaTrades', avatar:'#4ECDC4', text:'SOL DEX volume hitting ATH. The rotation from ETH to SOL is real. <span class="hashtag">#Solana</span> ecosystem eating everything.', likes:2451, retweets:512, time:'8m'},
  {user:'inversebrah', handle:'@inversebrah', avatar:'#FF6B6B', text:'<span class="mention">$MOG</span> holders rn: This thing does not stop. +230% in 24h with no signs of slowing.', likes:1567, retweets:341, time:'12m'},
  {user:'ColdBloodShill', handle:'@ColdBloodShill', avatar:'#43E97B', text:'New meta forming around AI agents. Watch <span class="mention">$GOAT</span> and similar plays. The narrative is just getting started <span class="hashtag">#AI</span>', likes:934, retweets:178, time:'15m'},
  {user:'CryptoKaleo', handle:'@CryptoKaleo', avatar:'#FA709A', text:'<span class="mention">$SIGMA</span> breaking out of the range. Volume confirmation is there. Targets: $0.15, $0.25, $0.40', likes:678, retweets:124, time:'18m'},
  {user:'AltcoinSherpa', handle:'@AltcoinSherpa', avatar:'#4FACFE', text:'<span class="mention">$WIF</span> reclaiming key support at $0.75. If this holds, $1+ is the next stop. Accumulation zone.', likes:1890, retweets:402, time:'22m'},
  {user:'TheCryptoDog', handle:'@TheCryptoDog', avatar:'#FCCB90', text:'The <span class="hashtag">#Solana</span> memecoin meta is far from over. Every cycle people say its dead and it comes back 10x stronger.', likes:3201, retweets:678, time:'25m'},
  {user:'blknoiz06', handle:'@blknoiz06', avatar:'#A18CD1', text:'<span class="mention">$SHROOMS</span> dev is legit. Liq locked, no insider wallets. This is a rare clean launch in the trenches.', likes:456, retweets:89, time:'30m'},
  {user:'CryptoCobain', handle:'@CryptoCobain', avatar:'#D4FC79', text:'Entire market dumping but <span class="mention">$POPCAT</span> holding strong. Relative strength = alpha. When BTC recovers this sends.', likes:2134, retweets:445, time:'35m'},
];

function showXPosts(query) {
  var list = document.getElementById('search-x-list');
  var q = (query || '').toLowerCase().trim();
  
  var posts = MOCK_X_POSTS;
  if (q) {
    posts = posts.filter(function(p) {
      return p.text.toLowerCase().indexOf(q) !== -1 || 
             p.user.toLowerCase().indexOf(q) !== -1 ||
             p.handle.toLowerCase().indexOf(q) !== -1;
    });
  }
  
  if (posts.length === 0) {
    list.innerHTML = '<div class="search-modal-empty">No posts found' + (q ? ' for "' + q + '"' : '') + '</div>';
    return;
  }
  
  list.innerHTML = posts.map(function(p) {
    var initial = p.user.charAt(0);
    return '<div class="x-post-item">' +
      '<div class="x-post-avatar" style="background:' + p.avatar + '">' + initial + '</div>' +
      '<div class="x-post-body">' +
        '<div class="x-post-header">' +
          '<span class="x-post-user">' + p.user + '</span>' +
          '<span class="x-post-handle">' + p.handle + '</span>' +
          '<span class="x-post-time">' + p.time + '</span>' +
        '</div>' +
        '<div class="x-post-text">' + p.text + '</div>' +
        '<div class="x-post-stats">' +
          '<span class="x-post-stat">♡ ' + fmtNum(p.likes) + '</span>' +
          '<span class="x-post-stat">⟲ ' + fmtNum(p.retweets) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Override handleSearchInput to also update X tab if active
var _origHandleSearch = handleSearchInput;
handleSearchInput = function(query) {
  if (currentSearchTab === 'tokens') {
    _origHandleSearch(query);
  } else {
    showXPosts(query);
  }
};

// Reset tab when opening modal
var _origOpenSearch = openSearchModal;
openSearchModal = function() {
  currentSearchTab = 'tokens';
  _origOpenSearch();
  var tabT = document.getElementById('search-tab-tokens');
  var tabX = document.getElementById('search-tab-x');
  var xRes = document.getElementById('search-x-results');
  if (tabT) tabT.classList.add('active');
  if (tabX) tabX.classList.remove('active');
  if (xRes) xRes.style.display = 'none';
};



// ========== TOKEN X SEARCH MENU ==========
var activeXMenu = null;

function showTokenXMenu(el, sym) {
  closeTokenXMenu();
  
  var rect = el.getBoundingClientRect();
  var menu = document.createElement('div');
  menu.className = 'token-x-menu';
  menu.innerHTML = 
    '<button class="token-x-menu-item" onclick="searchXByName(\'' + sym + '\');closeTokenXMenu()">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' +
      'Search X by name <span style="color:var(--phantom-purple);font-weight:700;margin-left:auto">$' + sym + '</span>' +
    '</button>' +
    '<button class="token-x-menu-item" onclick="searchXByCA(\'' + sym + '\');closeTokenXMenu()">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' +
      'Search X by CA <span style="color:var(--text-secondary);font-family:\'Inter\',sans-serif;font-size:10px;margin-left:auto">0x1a2b...3c4d</span>' +
    '</button>';
  
  document.body.appendChild(menu);
  
  // Position below the icon
  var menuWidth = menu.offsetWidth;
  var left = rect.left + rect.width / 2 - menuWidth / 2;
  var top = rect.bottom + 6;
  
  // Keep within viewport
  if (left < 8) left = 8;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  
  activeXMenu = menu;
  
  // Close on click outside
  setTimeout(function() {
    document.addEventListener('click', closeTokenXMenu, {once: true});
  }, 10);
}

function closeTokenXMenu() {
  if (activeXMenu) {
    activeXMenu.remove();
    activeXMenu = null;
  }
}

function searchXByName(sym) {
  window.open('https://x.com/search?q=%24' + sym + '&src=typed_query&f=live', '_blank');
}

function searchXByCA(sym) {
  var token = LIVE_TOKENS.find(function(t){ return t.sym === sym; });
  var query = token && token.ca ? token.ca : sym;
  window.open('https://x.com/search?q=' + encodeURIComponent(query) + '&src=typed_query&f=live', '_blank');
}




// ========== CRYPTO BUBBLES ==========
function computeBubbleStyles(tfVal) {
  var isUp = tfVal >= 0;
  var absP = Math.abs(tfVal);
  var glowHue = isUp ? 145 : 0;
  var absNorm = Math.min(1, absP / 20);
  var isNeutral = absP < 0.3;
  var isHot = absP > 15;
  var glowBg, innerBg, ringBorder, pctColor;
  
  if(isNeutral) {
    glowBg = "radial-gradient(circle, rgba(60,60,70,0.06) 40%, transparent 70%)";
    innerBg = "radial-gradient(circle at 50% 45%, #1a1a1f 0%, #131316 50%, #0e0e11 85%, #0a0a0d 100%)";
    ringBorder = "1px solid rgba(255,255,255,0.05)";
    pctColor = "rgba(255,255,255,0.55)";
  } else {
    var curve = Math.pow(absNorm, 0.6);
    var sat = 50 + curve * 40;
    var glowLum = 29 + curve * 21;
    var glowAlpha = 0.06 + curve * 0.32;
    glowBg = "radial-gradient(circle, hsla(" + glowHue + "," + sat + "%," + glowLum + "%," + glowAlpha + ") 35%, transparent 70%)";
    var centerLum = 12 + curve * 10;
    var midLum = 8 + curve * 8;
    var edgeLum = 5 + curve * 5;
    var tintSat = Math.round(20 + curve * 30);
    innerBg = "radial-gradient(circle at 50% 45%, hsl(" + glowHue + "," + tintSat + "%," + centerLum + "%) 0%, hsl(" + glowHue + "," + tintSat + "%," + midLum + "%) 50%, hsl(" + glowHue + "," + Math.round(tintSat * 0.7) + "%," + edgeLum + "%) 85%, #0a0a0d 100%)";
    var ringAlpha = 0.06 + curve * 0.22;
    ringBorder = "1.5px solid hsla(" + glowHue + "," + sat + "%," + (glowLum + 8) + "%," + ringAlpha + ")";
    pctColor = isUp ? "var(--green)" : "var(--red)";
  }
  
  return { glowBg: glowBg, innerBg: innerBg, ringBorder: ringBorder, pctColor: pctColor, isUp: isUp, isNeutral: isNeutral, isHot: isHot };
}

// ============================================================================
// Canvas bubble renderer — draws all bubbles onto ONE <canvas> instead of 50
// DOM elements. This is what keeps it smooth in Safari (one composited layer,
// no per-element paint/clip). Physics/data/interactions are unchanged.
// ============================================================================
var BubbleCanvas = (function(){
  var cv = null, ctx = null, dpr = 1, cssW = 0, cssH = 0;
  var imgCache = {};
  var MEME_EMOJI = {
    "PEPE":"🐸","DOGE":"🐕","SHIB":"🐕","BONK":"🐶","WIF":"🎩","FLOKI":"⚡",
    "BRETT":"🧢","POPCAT":"🐱","MOG":"😎","TOSHI":"🤖","MEME":"🎭","TURBO":"🏎️",
    "MYRO":"🐾","BOME":"📖","SLERF":"🦥","TRUMP":"🇺🇸","PONKE":"🐵","NEIRO":"🌸",
    "MICHI":"🐱","GOAT":"🐐","PNUT":"🥜","ACT":"🎬","FWOG":"🐸","GIGA":"💪",
    "SPX":"📈","HIGHER":"⬆️","TYBG":"🙏","DEGEN":"🎰","ANDY":"🧑","WOLF":"🐺",
    "BOBO":"🐻","SMOG":"🌫️","SNEK":"🐍","RICK":"🧪","DUKO":"🐶","SILLY":"🤪",
    "WEN":"⏰","CATMAN":"🦸","REKT":"💀","WAGMI":"🚀","CHAD":"💪","COPE":"😤",
    "HOPPY":"🐸","PORK":"🐷","WOOF":"🐕","AURA":"✨","TOAD":"🐸","APU":"🐸",
    "DINO":"🦕","RIZZ":"😏","SIGMA":"🧠","BASED":"🏗️"
  };

  function ensure(){
    var world = document.getElementById('bubbleWorld');
    if(!world) return null;
    var es = world.querySelector('.bubble-empty-state');
    if(es) es.remove();
    cv = document.getElementById('bubbleCanvas');
    if(!cv || !cv.isConnected){
      cv = document.createElement('canvas');
      cv.id = 'bubbleCanvas';
      world.appendChild(cv);
    }
    ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    var w = world.offsetWidth, h = world.offsetHeight;
    if(w > 0 && h > 0) resize(w, h);
    return cv;
  }

  function resize(w, h){
    if(!cv) return;
    if(w <= 0 || h <= 0) return;   // measured while hidden — never size the buffer to 0
    // Render at the device's TRUE pixel ratio (capped at 3) so logos/text/reticle stay
    // crisp on high-DPR phones. Most phones are 3x, so a 2x buffer got upscaled to 3x by
    // the browser → blurry. Affordable because bubbles are cached sprite blits, not redraws.
    var d = Math.min(window.devicePixelRatio || 1, 3);
    var bw = Math.round(w * d), bh = Math.round(h * d);
    // Skip only when the ACTUAL buffer already matches. cv.width can be a stale 300x150
    // default right after the canvas was recreated (e.g. showEmptyBubbleState() wiped the
    // world's innerHTML), so we check the real buffer — not the cached cssW/H — which is
    // what prevents the giant blurry bubble after a chain switch / empty-state.
    if(cv.width === bw && cv.height === bh && d === dpr) return;
    dpr = d; cssW = w; cssH = h;
    cv.width = bw;
    cv.height = bh;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    // Changing the buffer resets canvas state — re-enable high-quality scaling so the
    // sprite blits stay sharp instead of the browser default (low) which looks soft.
    if(ctx){ ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
  }

  // Logo image cache. Returns a drawable Image once loaded, else null.
  function img(url){
    if(!url) return null;
    var rec = imgCache[url];
    if(rec) return rec.ok ? rec.img : null;
    var im = new Image();
    im.decoding = 'async';
    rec = { img: im, ok: false };
    imgCache[url] = rec;
    im.onload = function(){ rec.ok = true; if(window.wakeBubbles) window.wakeBubbles(); };
    im.onerror = function(){ rec.ok = false; };
    im.src = url;
    return null;
  }

  // Mirror of computeBubbleStyles(), but returns canvas-ready color stops.
  function colors(tfVal){
    var isUp = tfVal >= 0, absP = Math.abs(tfVal);
    // Emerald #2ED57E (up) / coral #FF5765 (down) — tuned for the #1c1b1d background.
    var hue = isUp ? 149 : 354;
    var absNorm = Math.min(1, absP / 20);
    var isNeutral = absP < 0.3;
    if(isNeutral){
      return { glow:'rgba(60,60,70,0.06)', bodyC:'#1a1a1f', bodyM:'#131316', bodyE:'#0e0e11', dim:'#0c0c0f',
               ring:'rgba(255,255,255,0.05)', ringW:1, pct:'rgba(255,255,255,0.55)', sign:'' };
    }
    var curve = Math.pow(absNorm, 0.6);
    var sat = (isUp ? 58 : 90) + curve * 30;
    var glowLum = (isUp ? 30 : 42) + curve * 18;
    var glowAlpha = 0.07 + curve * 0.34;
    var centerLum = 14 + curve * 11, midLum = 11 + curve * 9, edgeLum = 9 + curve * 7;
    var tintSat = Math.round(20 + curve * 32);
    var ringAlpha = 0.10 + curve * 0.26;
    return {
      glow:'hsla('+hue+','+sat+'%,'+glowLum+'%,'+glowAlpha+')',
      bodyC:'hsl('+hue+','+tintSat+'%,'+centerLum+'%)',
      bodyM:'hsl('+hue+','+tintSat+'%,'+midLum+'%)',
      bodyE:'hsl('+hue+','+Math.round(tintSat*0.7)+'%,'+edgeLum+'%)',
      dim:'hsl('+hue+','+Math.round(tintSat*0.5)+'%,'+Math.max(5, edgeLum - 3)+'%)',
      ring:'hsla('+hue+','+sat+'%,'+(glowLum+10)+'%,'+ringAlpha+')', ringW:1.5,
      pct: isUp ? '#2ED57E' : '#FF5765', sign: isUp ? '+' : ''
    };
  }

  // Render the full bubble ONCE into an offscreen canvas at a reference radius.
  // Only re-run when color/size-target/logo/data change — never per frame.
  function renderSprite(b, tfVal, ref){
    var t = b.token;
    var c = colors(tfVal);
    var pad = Math.ceil(ref * 1.2) + 2;     // glow reaches 1.2*ref
    var size = pad * 2;
    var spr = b._spr || (b._spr = document.createElement('canvas'));
    var ss = Math.min(dpr * 2, 4);  // supersample past device res for crisp lines/text; capped at 4x so 3x-DPR sprites don't balloon in memory
    var px = Math.max(1, Math.round(size * ss));
    if(spr.width !== px){ spr.width = px; spr.height = px; }
    var sx = spr.getContext('2d');
    sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';  // sharp logo image scaling
    sx.setTransform(ss, 0, 0, ss, 0, 0);
    sx.clearRect(0, 0, size, size);
    var x = pad, y = pad, r = ref;

    // Glow
    var gR = r * 1.2;
    var gg = sx.createRadialGradient(x, y, 0, x, y, gR);
    gg.addColorStop(0, c.glow); gg.addColorStop(0.35, c.glow);
    gg.addColorStop(0.70, 'rgba(0,0,0,0)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
    sx.globalAlpha = 0.7; sx.fillStyle = gg;
    sx.beginPath(); sx.arc(x, y, gR, 0, 6.2832); sx.fill();
    sx.globalAlpha = 1;

    // Lens body
    var cyc = y - r * 0.05;
    var bg = sx.createRadialGradient(x, cyc, 0, x, cyc, r * 1.05);
    bg.addColorStop(0, c.bodyC); bg.addColorStop(0.5, c.bodyM);
    bg.addColorStop(0.88, c.bodyE); bg.addColorStop(1, c.dim);
    sx.fillStyle = bg; sx.beginPath(); sx.arc(x, y, r, 0, 6.2832); sx.fill();

    // Outer ring (colored; white hover ring is drawn live in drawOne)
    sx.lineWidth = c.ringW; sx.strokeStyle = c.ring;
    sx.beginPath(); sx.arc(x, y, r - c.ringW / 2, 0, 6.2832); sx.stroke();

    // Scope reticle
    if(r > 20){
      sx.lineWidth = 1; sx.strokeStyle = 'rgba(220,220,220,0.12)';
      sx.beginPath(); sx.arc(x, y, r * 0.56, 0, 6.2832); sx.stroke();
    }
    if(r > 22){
      var e = r * 0.84, g = r * 0.20;
      sx.strokeStyle = 'rgba(255,255,255,0.16)'; sx.lineWidth = 1;
      sx.beginPath();
      sx.moveTo(x - e, y); sx.lineTo(x - g, y);
      sx.moveTo(x + g, y); sx.lineTo(x + e, y);
      sx.moveTo(x, y - e); sx.lineTo(x, y - g);
      sx.moveTo(x, y + g); sx.lineTo(x, y + e);
      sx.stroke();
    }
    if(t.boosted){
      sx.lineWidth = 2; sx.strokeStyle = 'rgba(255,184,39,0.85)';
      sx.beginPath(); sx.arc(x, y, r - 1, 0, 6.2832); sx.stroke();
    }

    // Content
    var showLogo = r > 18, showPct = r > 16;
    var logoSize = Math.max(13, r * 0.38) + 4;
    var fsTicker = Math.max(7, r * 0.30);
    var fsPct = Math.max(5, r * 0.18);
    var gapY = Math.max(1, r * 0.05);
    var blockH = (showLogo ? logoSize + gapY : 0) + fsTicker + (showPct ? fsPct + gapY : 0);
    var cyy = y - blockH / 2;
    if(showLogo){
      var im = t.img ? img(imgProxy(t.img, 80, 80)) : null;
      if(im){
        sx.save();
        sx.beginPath(); sx.arc(x, cyy + logoSize / 2, logoSize / 2, 0, 6.2832); sx.closePath(); sx.clip();
        try { sx.drawImage(im, x - logoSize / 2, cyy, logoSize, logoSize); } catch(e){}
        sx.restore();
      } else {
        sx.textAlign = 'center'; sx.textBaseline = 'middle';
        sx.font = Math.round(logoSize) + "px 'Inter', sans-serif";
        sx.fillText(MEME_EMOJI[t.sym] || '🪙', x, cyy + logoSize / 2);
      }
      cyy += logoSize + gapY;
    }
    sx.textAlign = 'center'; sx.textBaseline = 'top';
    sx.fillStyle = '#E6E1E5';
    sx.font = "700 " + fsTicker + "px 'Inter', sans-serif";
    sx.fillText(t.sym || '', x, cyy);
    cyy += fsTicker + gapY;
    if(showPct){
      sx.fillStyle = c.pct;
      sx.font = "600 " + fsPct + "px 'Inter', sans-serif";
      sx.fillText(c.sign + tfVal.toFixed(1) + '%', x, cyy);
    }

    b._sprPad = pad; b._sprRef = ref; b._ringW = c.ringW;
  }

  function drawOne(b, tfField){
    var t = b.token, r = b.r;
    if(!t || r < 1) return;
    var es = (b.entScale === undefined) ? 1 : b.entScale;  // M3 entrance scale
    if(es <= 0.01) return;
    var er = r * es;  // effective drawn radius (physics size × entrance)
    var tfVal = (typeof getTfVal === 'function') ? getTfVal(t, tfField) : 0;
    var ref = Math.max(1, Math.round(b.targetR || r));
    var logoReady = !!(t.img && img(imgProxy(t.img, 80, 80)));
    // Cache key on TARGET size (fixed) — so entrance/settle just scale the blit.
    var sig = ref + '|' + tfVal.toFixed(1) + '|' + (logoReady ? 1 : 0) + '|' + (t.boosted ? 1 : 0) + '|' + (t.sym || '');
    if(b._sig !== sig){ renderSprite(b, tfVal, ref); b._sig = sig; }

    var s = er / b._sprRef;
    var half = b._sprPad * s;
    ctx.drawImage(b._spr, b.x - half, b.y - half, half * 2, half * 2);

    // Hover ring — animated white crossfade, drawn live. Drawn a bit thinner than
    // the sprite's ring: solid hard-edged white reads heavier than the soft,
    // supersampled, translucent colored ring at the same nominal width.
    var ht = b.hoverT || 0;
    if(ht > 0.001){
      var rw = Math.max(1, (b._ringW || 1.5) * 0.7);
      ctx.globalAlpha = ht;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = rw;
      ctx.beginPath(); ctx.arc(b.x, b.y, er - rw / 2, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function draw(bubs, tfField){
    if(!ctx || !cv || !cv.isConnected){ if(!ensure()) return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    for(var i = 0; i < bubs.length; i++) drawOne(bubs[i], tfField);
  }

  return { ensure: ensure, resize: resize, draw: draw, img: img };
})();

var bubs = [];
(function(){
  var world, W, H, rafId, mouseX = -1000, mouseY = -1000, mouseActive = false, mousePrevX = -1000, mousePrevY = -1000, mouseVX = 0, mouseVY = 0, mouseSpeed = 0;
  var _idleFrames = 0, _sleeping = false, _tick = null;

  function init(){
    world = document.getElementById("bubbleWorld");
    var hero = document.getElementById("bubbleHero");
    if(!world || !hero) return;
    sizeBubbleHero();
    W = hero.offsetWidth;
    H = hero.offsetHeight;
    if(W < 10 || H < 10){ setTimeout(init, 100); return; }

    // Run ALL filtering BEFORE clearing the world so the shrug never flashes
    var tokens = (typeof getFilteredTokens === 'function') ? getFilteredTokens().slice(0, 200) : ((typeof LIVE_TOKENS !== 'undefined') ? LIVE_TOKENS.slice(0, 200) : []);

    // Inject admin-boosted tokens that might not be in the top 100
    var adminBoosts = _getAdminBoosts();
    var tokenCAs = {};
    tokens.forEach(function(t) { tokenCAs[(t.ca || '').toLowerCase()] = true; });
    for (var i = 0; i < LIVE_TOKENS.length; i++) {
      var ltCA = (LIVE_TOKENS[i].ca || '').toLowerCase();
      if (adminBoosts[ltCA] && !tokenCAs[ltCA]) {
        LIVE_TOKENS[i].boosted = true;
        LIVE_TOKENS[i].boostCount = adminBoosts[ltCA].count;
        tokens.push(LIVE_TOKENS[i]);
        tokenCAs[ltCA] = true;
      }
    }

    // Deduplicate: first by CA, then by symbol (keep highest volume per symbol)
    var caMap = {};
    tokens.forEach(function(t) {
      var key = t.ca || t.sym;
      if (!caMap[key]) caMap[key] = t;
    });
    tokens = Object.values(caMap);
    var symMap = {};
    tokens.forEach(function(t) {
      var sym = (t.sym || '').toUpperCase();
      if (!symMap[sym] || t.boosted || (!symMap[sym].boosted && (t.vol || 0) > (symMap[sym].vol || 0))) {
        symMap[sym] = t;
      }
    });
    tokens = Object.values(symMap);

    var tfField = getTimeframeField();

    // Filter out tokens only if ALL timeframes are 0 (truly dead data)
    tokens = tokens.filter(function(t) {
      return t.boosted || (t.p5m || 0) !== 0 || (t.p1h || 0) !== 0 || (t.p6h || 0) !== 0 || (t.p24h || 0) !== 0 || (t.mcap || 0) > 0;
    });

    // NOW we know if we have tokens — empty state or render
    if(!tokens.length){
      if (liveDataLoaded) { showEmptyBubbleState(); if(rafId) cancelAnimationFrame(rafId); return; }
      setTimeout(init, 100); return;
    }

    // We have tokens — now safe to (re)create the canvas and render
    world.classList.remove('ready');
    BubbleCanvas.ensure();
    bubs = [];
    if(rafId) cancelAnimationFrame(rafId);

    // Re-check admin boosts at render time (bulletproof against flag loss)
    _applyAdminBoosts(tokens);

    // Sort by % change magnitude for bubble sizing, but keep boosted tokens prioritized
    var boostedTokens = tokens.filter(function(t){ return t.boosted; });
    var normalTokens = tokens.filter(function(t){ return !t.boosted; });
    normalTokens.sort(function(a,b){ return Math.abs(getTfVal(b, tfField)) - Math.abs(getTfVal(a, tfField)); });
    // Boosted tokens always get a spot — trim normal tokens to make room
    var normalSlots = Math.max(0, 50 - boostedTokens.length);
    tokens = boostedTokens.concat(normalTokens.slice(0, normalSlots));

    // Use shared sizing function
    var radii = calcBubbleSizes(tokens, W, H, tfField);
    
    var items = tokens.map(function(t, i){
      var r = radii[i];
      return { t: t, r: r, displayR: r };
    });
    
    items.sort(function(a,b){ return b.r - a.r; });
    
    // Pack bubbles - use shrinking radii ONLY for collision detection
    // but preserve original displayR for actual rendering
    var placed = [], gap = 1;
    for(var attempt = 0; attempt < 10; attempt++){
      placed = [];
      for(var k = 0; k < items.length; k++){
        var it = items[k], r = it.r, found = false;
        for(var tries = 0; tries < 5000; tries++){
          var glowPad = (W < 500) ? 4 : 12;
          var x = r + glowPad + Math.random() * (W - r * 2 - glowPad * 2);
          var y = r + glowPad + Math.random() * (H - r * 2 - glowPad * 2);
          var ok = true;
          for(var j = 0; j < placed.length; j++){
            if(Math.hypot(placed[j].x - x, placed[j].y - y) < placed[j].packR + r + gap){
              ok = false; break;
            }
          }
          if(ok){ placed.push({x:x, y:y, packR:r, r:it.displayR, it:it}); found = true; break; }
        }
      }
      if(placed.length >= items.length * 0.9) break;
      // Shrink packing radii only - displayR stays untouched
      items.forEach(function(it){ it.r = Math.max(10, it.r * 0.90); });
    }
    
    // Create DOM elements
    var _entBase = performance.now();
    placed.forEach(function(p, idx){
      var t = p.it.t, r = p.r;
      if(t.img) BubbleCanvas.img(imgProxy(t.img, 80, 80)); // preload logo for canvas
      var spd = 0.03 + Math.random() * 0.05;
      var ang = Math.random() * Math.PI * 2;
      bubs.push({
        x: p.x, y: p.y, r: r, targetR: r,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        token: t,
        entStart: _entBase + idx * 14,   // staggered M3 entrance (largest first)
        entScale: 0
      });
    });

    // Size the canvas to the world and reveal it (one fade-in for the whole layer)
    BubbleCanvas.resize(W, H);
    world.classList.add('ready');

    // Animation loop
    function tick(){
      for(var i = 0; i < bubs.length; i++){
        var b = bubs[i];
        
        // Mouse swipe force - only when moving fast
        if(mouseActive && mouseSpeed > 8){
          var mdx = b.x - mouseX;
          var mdy = b.y - mouseY;
          var mDist = Math.sqrt(mdx*mdx + mdy*mdy);
          var pushRadius = 50 + b.r;
          if(mDist < pushRadius && mDist > 0.1){
            var swipeForce = Math.min(mouseSpeed / 40, 1.5) * (1 - mDist / pushRadius);
            b.vx += (mouseVX / mouseSpeed) * swipeForce * 0.6;
            b.vy += (mouseVY / mouseSpeed) * swipeForce * 0.6;
          }
        }
        
        // Gentle centering force - pulls toward center when too far out
        var cx = W / 2, cy = H / 2;
        var dcx = cx - b.x, dcy = cy - b.y;
        var distFromCenter = Math.sqrt(dcx*dcx + dcy*dcy);
        var maxDrift = Math.min(W, H) * 0.7;
        if(distFromCenter > maxDrift){
          var pullStrength = (distFromCenter - maxDrift) * 0.0001;
          b.vx += (dcx / distFromCenter) * pullStrength;
          b.vy += (dcy / distFromCenter) * pullStrength;
        }
        
        // Spread force - push away from nearby bubbles to prevent clumping
        for(var si = 0; si < bubs.length; si++){
          if(si === i) continue;
          var sb = bubs[si];
          var sdx = b.x - sb.x, sdy = b.y - sb.y;
          var sDist = Math.sqrt(sdx*sdx + sdy*sdy);
          var ideal = b.r + sb.r + 8;
          if(sDist < ideal && sDist > 0.1){
            var spread = (ideal - sDist) * 0.003;
            b.vx += (sdx / sDist) * spread;
            b.vy += (sdy / sDist) * spread;
          }
        }
        
        // Damping so they slow down after being pushed
        b.vx *= 0.98;
        b.vy *= 0.98;
        
        // Minimum drift speed so they keep floating gently
        var speed = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
        // Kill very tiny movements - let bubbles rest
        if(speed < 0.05){
          b.vx = 0;
          b.vy = 0;
        }
        // Cap max speed
        if(speed > 0.5){
          b.vx = (b.vx / speed) * 0.5;
          b.vy = (b.vy / speed) * 0.5;
        }
        
        b.x += b.vx; b.y += b.vy;
        var isMob = window.innerWidth <= 768;
        var padX = isMob ? 4 : 14;
        var padY = isMob ? 4 : 10;
        var edgeR = b.r;
        if(b.x - edgeR < padX){ b.x = edgeR + padX; b.vx = Math.abs(b.vx); }
        if(b.x + edgeR > W - padX){ b.x = W - edgeR - padX; b.vx = -Math.abs(b.vx); }
        if(b.y - edgeR < padY){ b.y = edgeR + padY; b.vy = Math.abs(b.vy); }
        if(b.y + edgeR > H - padY){ b.y = H - edgeR - padY; b.vy = -Math.abs(b.vy); }
      }
      // Overlap-resolution passes — 2 is enough since bubbles start packed and
      // drift gently; this halves the heaviest per-frame O(n^2) work.
      var _isMob2 = window.innerWidth <= 768;
      var _padX2 = _isMob2 ? 4 : 10, _padY2 = _isMob2 ? 4 : 10;
      for(var pass = 0; pass < 2; pass++){
        for(var i = 0; i < bubs.length; i++){
          for(var j = i+1; j < bubs.length; j++){
            var a = bubs[i], b = bubs[j];
            var dx = b.x - a.x, dy = b.y - a.y;
            var dist = Math.sqrt(dx*dx + dy*dy);
            var minD = a.r + b.r + 6;
            if(dist < minD && dist > 0.1){
              var ov = (minD - dist);
              var nx = dx/dist, ny = dy/dist;
              // Check if either bubble is near a wall — push the other one more
              var aWall = (a.x - a.r < _padX2 + 5) || (a.x + a.r > W - _padX2 - 5) || (a.y - a.r < _padY2 + 5) || (a.y + a.r > H - _padY2 - 5);
              var bWall = (b.x - b.r < _padX2 + 5) || (b.x + b.r > W - _padX2 - 5) || (b.y - b.r < _padY2 + 5) || (b.y + b.r > H - _padY2 - 5);
              var aShare = (bWall && !aWall) ? 0.8 : (aWall && !bWall) ? 0.2 : 0.5;
              a.x -= nx * ov * aShare; a.y -= ny * ov * aShare;
              b.x += nx * ov * (1 - aShare); b.y += ny * ov * (1 - aShare);
              if(pass === 0){
                var dvx = a.vx - b.vx, dvy = a.vy - b.vy;
                var dot = dvx*nx + dvy*ny;
                if(dot > 0){
                  a.vx -= dot*nx*0.1; a.vy -= dot*ny*0.1;
                  b.vx += dot*nx*0.1; b.vy += dot*ny*0.1;
                }
              }
            }
          }
        }
        // Re-clamp to bounds after each pass
        for(var ci = 0; ci < bubs.length; ci++){
          var c = bubs[ci];
          if(c.x - c.r < _padX2) c.x = c.r + _padX2;
          if(c.x + c.r > W - _padX2) c.x = W - c.r - _padX2;
          if(c.y - c.r < _padY2) c.y = c.r + _padY2;
          if(c.y + c.r > H - _padY2) c.y = H - c.r - _padY2;
        }
      }

      // Hover hit-test (skip while dragging) for cursor + ring highlight
      var hoverIdx = -1;
      if(mouseActive && !dragBubble){
        for(var hi = bubs.length - 1; hi >= 0; hi--){
          if(Math.hypot(mouseX - bubs[hi].x, mouseY - bubs[hi].y) < bubs[hi].r){ hoverIdx = hi; break; }
        }
      }
      if(world) world.style.cursor = (hoverIdx >= 0) ? 'pointer' : '';

      var _now = performance.now();
      var _allIdle = true;
      for(var i = 0; i < bubs.length; i++){
        var b = bubs[i];
        // M3 entrance: scale up with an eased decelerate over 420ms after the
        // bubble's staggered start time. Keeps the loop awake until all are in.
        if(b.entScale === undefined) b.entScale = 1;
        if(b.entScale < 1){
          var ep = (_now - (b.entStart || 0)) / 420;
          if(ep <= 0){ b.entScale = 0; }
          else if(ep >= 1){ b.entScale = 1; }
          else { var inv = 1 - ep; b.entScale = 1 - inv * inv * inv; } // easeOutCubic
          _allIdle = false;
        }
        // Smoothly interpolate radius toward target
        if(b.targetR && Math.abs(b.r - b.targetR) > 0.5){
          b.r += (b.targetR - b.r) * 0.08;
          _allIdle = false;
        }
        if(b.vx !== 0 || b.vy !== 0) _allIdle = false;
        // M3-style hover: ease the white-ring crossfade toward 0/1 (~65ms — fastest that still reads as a fade)
        var ht = (i === hoverIdx) ? 1 : 0;
        var cur = b.hoverT || 0;
        if(cur !== ht){
          cur += (ht - cur) * 0.65;
          if(Math.abs(cur - ht) < 0.02) cur = ht;
          b.hoverT = cur;
          _allIdle = false;
        }
      }

      // Cheap per-frame paint now (pre-rendered sprite blits), so full 60fps.
      BubbleCanvas.draw(bubs, getTimeframeField());

      if(_allIdle){ _idleFrames++; } else { _idleFrames = 0; }
      if(_idleFrames > 60){ _sleeping = true; rafId = null; return; }
      rafId = requestAnimationFrame(tick);
    }
    _tick = tick;
    tick();
  }

  function wakeBubbles(){
    if(_sleeping && bubs.length > 0 && _tick){
      _sleeping = false; _idleFrames = 0;
      _tick();
    }
  }
  window.wakeBubbles = wakeBubbles;

  // Wake on any interaction with the bubble area
  var _heroEl = document.getElementById("bubbleHero");
  if(_heroEl){
    _heroEl.addEventListener("mousedown", function(){ wakeBubbles(); });
    _heroEl.addEventListener("touchstart", function(){ wakeBubbles(); }, {passive: true});
  }

  // Wait for LIVE_TOKENS then init (only if init hasn't already been called by fetchLiveTokens)
  var _bubbleInitDone = false;
  var _origInit = init;
  init = function(){ _bubbleInitDone = true; _origInit(); };
  window.init = init;

  var _waitAttempts = 0;
  function waitAndInit(){
    if(_bubbleInitDone || window._bubbleBuildDeferred) return; // building after verify, or already built
    if(liveDataLoaded && typeof LIVE_TOKENS !== 'undefined' && LIVE_TOKENS.length > 0){
      init();
    } else if(_waitAttempts < 15) {
      _waitAttempts++;
      setTimeout(waitAndInit, 1000);
    }
  }
  waitAndInit();
  
  var rt, _lastW = window.innerWidth;
  window.addEventListener("resize", function(){
    // Only reinit on width change — mobile scroll hides/shows address bar changing height only
    if(window.innerWidth === _lastW) return;
    _lastW = window.innerWidth;
    clearTimeout(rt); rt = setTimeout(init, 250);
  });
  
  // Mouse interaction - only push when swiping fast
  document.addEventListener("mousemove", function(e){
    var hero = document.getElementById("bubbleHero");
    if(!hero) return;
    var rect = hero.getBoundingClientRect();
    var newX = e.clientX - rect.left;
    var newY = e.clientY - rect.top;
    mouseVX = newX - mouseX;
    mouseVY = newY - mouseY;
    mouseSpeed = Math.sqrt(mouseVX*mouseVX + mouseVY*mouseVY);
    mouseX = newX;
    mouseY = newY;
    mouseActive = (mouseX >= 0 && mouseX <= W && mouseY >= 0 && mouseY <= H);
    if(mouseActive) wakeBubbles();
  });
  document.addEventListener("mouseleave", function(){ mouseActive = false; wakeBubbles(); });

  // Drag to throw bubbles
  var dragBubble = null, dragStartX, dragStartY, dragLastX, dragLastY;
  
  var bCanvas2 = document.getElementById("bubbleWorld");
  if(bCanvas2){
    bCanvas2.addEventListener("mousedown", function(e){
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for(var i = bubs.length - 1; i >= 0; i--){
        var b = bubs[i];
        if(Math.hypot(mx - b.x, my - b.y) < b.r){
          dragBubble = b;
          dragStartX = mx; dragStartY = my;
          dragLastX = mx; dragLastY = my;
          e.preventDefault();
          break;
        }
      }
    });
    
    document.addEventListener("mousemove", function(e){
      if(!dragBubble) return;
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      dragBubble.x = mx;
      dragBubble.y = my;
      dragBubble.vx = (mx - dragLastX) * 0.3;
      dragBubble.vy = (my - dragLastY) * 0.3;
      dragLastX = mx; dragLastY = my;
    });
    
    document.addEventListener("mouseup", function(){
      if(dragBubble){
        var dist = Math.hypot(dragLastX - dragStartX, dragLastY - dragStartY);
        if(dist < 5 && dragBubble.token) {
          openBubbleModal(dragBubble.token);
        } else {
          dragBubble.vx *= 1;
          dragBubble.vy *= 1;
        }
        dragBubble = null;
      }
    });

    // Touch handlers for mobile
    bCanvas2.addEventListener("touchstart", function(e){
      var touch = e.touches[0];
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = touch.clientX - rect.left, my = touch.clientY - rect.top;
      for(var i = bubs.length - 1; i >= 0; i--){
        var b = bubs[i];
        if(Math.hypot(mx - b.x, my - b.y) < b.r){
          dragBubble = b;
          dragStartX = mx; dragStartY = my;
          dragLastX = mx; dragLastY = my;
          e.preventDefault();
          break;
        }
      }
    }, {passive: false});

    document.addEventListener("touchmove", function(e){
      if(!dragBubble) return;
      e.preventDefault();
      var touch = e.touches[0];
      var rect = document.getElementById("bubbleHero").getBoundingClientRect();
      var mx = touch.clientX - rect.left, my = touch.clientY - rect.top;
      dragBubble.x = mx;
      dragBubble.y = my;
      dragBubble.vx = (mx - dragLastX) * 0.3;
      dragBubble.vy = (my - dragLastY) * 0.3;
      dragLastX = mx; dragLastY = my;
    }, {passive: false});

    document.addEventListener("touchend", function(){
      if(dragBubble){
        var dist = Math.hypot(dragLastX - dragStartX, dragLastY - dragStartY);
        if(dist < 5 && dragBubble.token) {
          openBubbleModal(dragBubble.token);
        } else {
          dragBubble.vx *= 1;
          dragBubble.vy *= 1;
        }
        dragBubble = null;
      }
    });
  }


  ;

  // Smoothly interpolate bubble radius toward target
  // Add this to the tick function by monkey-patching
  var origTick = null;

  })();


// ========== BUBBLE MODAL ==========

function openModalBySym(el) {
  var sym = el.getAttribute('data-sym');
  if(!sym) return;
  var tk = LIVE_TOKENS.find(function(x){ return x.sym === sym; });
  if(tk) openBubbleModal(tk);
}


var _activeRowMenu = null;
var _activeRowDots = null;
function showRowMenu(dotsEl, idx) {
  if(_activeRowDots === dotsEl) { closeRowMenu(); return; }
  closeRowMenu();
  var tokens = (typeof getFilteredTokens === 'function') ? getFilteredTokens() : LIVE_TOKENS;
  var t = tokens[idx];
  if(!t) return;
  _activeRowDots = dotsEl;
  dotsEl.classList.add('active');
  
  var net = (t.net||'solana').toLowerCase();
  var explorers = {
    solana: { url:'https://solscan.io/token/'+t.ca, name:'Solscan' },
    eth: { url:'https://etherscan.io/token/'+t.ca, name:'Etherscan' },
    base: { url:'https://basescan.org/token/'+t.ca, name:'Basescan' },
    bsc: { url:'https://bscscan.com/token/'+t.ca, name:'BscScan' },
    tron: { url:'https://tronscan.org/#/token20/'+t.ca, name:'Tronscan' },
    sui: { url:'https://suiscan.xyz/mainnet/coin/'+t.ca, name:'Suiscan' },
    arbitrum: { url:'https://arbiscan.io/token/'+t.ca, name:'Arbiscan' },
    avalanche: { url:'https://snowtrace.io/token/'+t.ca, name:'Snowtrace' },
    polygon: { url:'https://polygonscan.com/token/'+t.ca, name:'Polygonscan' },
    optimism: { url:'https://optimistic.etherscan.io/token/'+t.ca, name:'Optimism Explorer' },
    blast: { url:'https://blastscan.io/token/'+t.ca, name:'Blastscan' },
    ton: { url:'https://tonviewer.com/'+t.ca, name:'TON Viewer' },
    pulsechain: { url:'https://scan.pulsechain.com/token/'+t.ca, name:'PulseScan' },
    seiv2: { url:'https://seitrace.com/token/'+t.ca, name:'Seitrace' },
    sonic: { url:'https://sonicscan.org/token/'+t.ca, name:'Sonicscan' },
    hyperliquid: { url:'https://hyperscan.xyz/token/'+t.ca, name:'HyperScan' },
    berachain: { url:'https://berascan.com/token/'+t.ca, name:'Berascan' },
    monad: { url:'https://monadscan.com/token/'+t.ca, name:'MonadScan' },
    cronos: { url:'https://cronoscan.com/token/'+t.ca, name:'CronoScan' },
    aptos: { url:'https://explorer.aptoslabs.com/account/'+t.ca, name:'Aptos Explorer' },
    linea: { url:'https://lineascan.build/token/'+t.ca, name:'LineaScan' },
    zksync: { url:'https://explorer.zksync.io/address/'+t.ca, name:'zkSync Explorer' },
    fantom: { url:'https://ftmscan.com/token/'+t.ca, name:'FTMScan' },
    mantle: { url:'https://mantlescan.xyz/token/'+t.ca, name:'Mantle Explorer' },
    scroll: { url:'https://scrollscan.com/token/'+t.ca, name:'ScrollScan' },
    manta: { url:'https://pacific-explorer.manta.network/token/'+t.ca, name:'Manta Explorer' },
    starknet: { url:'https://starkscan.co/token/'+t.ca, name:'Starkscan' }
  };
  var exp = explorers[net] || explorers.solana;
  var expIcon = '';
  if(typeof SCANNER_ICONS !== 'undefined' && SCANNER_ICONS[net]) {
    expIcon = SCANNER_ICONS[net];
  } else if(typeof CHAIN_ICONS !== 'undefined' && CHAIN_ICONS[net]) {
    expIcon = CHAIN_ICONS[net];
  }
  
  var menu = document.createElement('div');
  menu.className = 'row-chrome-menu';
  var html = '';
  var caLabel = t.ca ? (t.ca.slice(0,4) + '...' + t.ca.slice(-4)) : 'N/A';
  html += '<span onclick="event.stopPropagation();navigator.clipboard.writeText(\''+t.ca+'\');var s=this;var o=s.childNodes[1];o.nodeValue=\' Copied!\';setTimeout(function(){o.nodeValue=\' '+caLabel+'\';},1200)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M760-200H320q-33 0-56.5-23.5T240-280v-560q0-33 23.5-56.5T320-920h280l240 240v400q0 33-23.5 56.5T760-200ZM560-640v-200H320v560h440v-360H560ZM160-40q-33 0-56.5-23.5T80-120v-560h80v560h440v80H160Zm160-800v200-200 560-560Z"/></svg> '+caLabel+'</span>';
  html += '<a href="https://x.com/search?q='+encodeURIComponent('$'+t.sym+' OR '+t.ca)+'&src=typed_query&f=live" target="_blank" onclick="event.stopPropagation()"><svg class="ico-search" viewBox="0 0 32 32" fill="currentColor"><path d="M16.906 20.188l5.5 5.5-2.25 2.281-5.75-5.781c-1.406 0.781-3.031 1.219-4.719 1.219-5.344 0-9.688-4.344-9.688-9.688s4.344-9.688 9.688-9.688 9.719 4.344 9.719 9.688c0 2.5-0.969 4.781-2.5 6.469zM3.219 13.719c0 3.594 2.875 6.469 6.469 6.469s6.469-2.875 6.469-6.469-2.875-6.469-6.469-6.469-6.469 2.875-6.469 6.469z"/></svg>Search on X</a>';
  if(t.twitter) html += '<a href="'+t.twitter+'" target="_blank" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>Community</a>';
  if(t.website) html += '<a href="'+t.website+'" target="_blank" onclick="event.stopPropagation()"><svg class="ico-globe" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M325-111.5q-73-31.5-127.5-86t-86-127.5Q80-398 80-480.5t31.5-155q31.5-72.5 86-127t127.5-86Q398-880 480.5-880t155 31.5q72.5 31.5 127 86t86 127Q880-563 880-480.5T848.5-325q-31.5 73-86 127.5t-127 86Q563-80 480.5-80T325-111.5ZM480-162q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>Website</a>';
  html += '<a href="'+exp.url+'" target="_blank" onclick="event.stopPropagation()"><img src="'+expIcon+'" onerror="this.style.display=\'none\'">'+exp.name+'</a>';
  html += '<span onclick="event.stopPropagation();closeRowMenu();window._modalToken={ca:\''+((t.ca||'').replace(/'/g,''))+'\',sym:\''+((t.sym||'').replace(/'/g,''))+'\',net:\''+(t.net||'solana')+'\'};if(typeof openBoostModal===\'function\')openBoostModal()" style="background:rgba(234,179,8,0.15);color:#eab308;border-radius:0 0 8px 8px;margin:0;padding:10px 14px;box-sizing:border-box"><svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Boost Token</span>';
  menu.innerHTML = html;

  document.body.appendChild(menu);
  _activeRowMenu = menu;
  
  // Position the menu next to the dots
  var rect = dotsEl.getBoundingClientRect();
  menu.style.left = (rect.right + 4) + 'px';
  menu.style.top = rect.top + 'px';
  
  // Check if menu goes off-screen
  var menuRect = menu.getBoundingClientRect();
  if(menuRect.right > window.innerWidth - 10) {
    menu.style.left = (rect.left - menuRect.width - 4) + 'px';
  }
  if(menuRect.bottom > window.innerHeight - 10) {
    menu.style.top = (window.innerHeight - menuRect.height - 10) + 'px';
  }
  
  requestAnimationFrame(function(){ menu.classList.add('open'); });
}

function closeRowMenu() {
  if(_activeRowDots) _activeRowDots.classList.remove('active');
  if(_activeRowMenu) { _activeRowMenu.remove(); }
  _activeRowMenu = null;
  _activeRowDots = null;
}

document.addEventListener('click', function(e) {
  if(_activeRowMenu && !e.target.closest('.token-dots') && !e.target.closest('.row-chrome-menu')) closeRowMenu();
});

document.addEventListener('scroll', function() {
  if(_activeRowMenu) closeRowMenu();
}, true);


function openTokenModal(caOrIdx) {
  if (typeof caOrIdx === 'string') {
    var t = LIVE_TOKENS.find(function(tk) { return tk.ca === caOrIdx; });
    if (t) openBubbleModal(t);
  } else {
    var tokens = (typeof getFilteredTokens === 'function') ? getFilteredTokens() : LIVE_TOKENS;
    if(tokens[caOrIdx]) openBubbleModal(tokens[caOrIdx]);
  }
}

// DexScreener-style price: $0.0₄5890
function dexPriceFmt(p) {
  if (!p || p <= 0) return '$0.00';
  if (p >= 1) return '$' + p.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  if (p >= 0.01) return '$' + p.toFixed(4);
  // Count leading zeros after "0."
  var s = p.toFixed(20);
  var dot = s.indexOf('.');
  var zeros = 0;
  for (var i = dot + 1; i < s.length; i++) {
    if (s[i] === '0') zeros++;
    else break;
  }
  if (zeros < 4) return '$' + p.toFixed(zeros + 4);
  // Get 4 significant digits after the zeros
  var sigDigits = s.substring(dot + 1 + zeros, dot + 1 + zeros + 4);
  // Remove trailing zeros from sig digits
  sigDigits = sigDigits.replace(/0+$/, '') || '0';
  var sub = String(zeros);
  var subHtml = '';
  for (var j = 0; j < sub.length; j++) {
    subHtml += '<sub style="font-size:0.7em;vertical-align:baseline;opacity:0.85">' + sub[j] + '</sub>';
  }
  return '$0.0' + subHtml + sigDigits;
}
function dexPricePlain(p) {
  if (!p || p <= 0) return '$0.00';
  if (p >= 1) return '$' + p.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  if (p >= 0.01) return '$' + p.toFixed(4);
  var s = p.toFixed(20);
  var dot = s.indexOf('.');
  var zeros = 0;
  for (var i = dot + 1; i < s.length; i++) { if (s[i] === '0') zeros++; else break; }
  if (zeros < 4) return '$' + p.toFixed(zeros + 4);
  var sigDigits = s.substring(dot + 1 + zeros, dot + 1 + zeros + 4).replace(/0+$/, '') || '0';
  return '$0.0{' + zeros + '}' + sigDigits;
}

// --- Price currency toggle (USD / native) ---
var _bmPriceCurrency = 'usd'; // 'usd' or 'native'
var _nativeTokenMap = { 'solana': 'SOL', 'eth': 'ETH', 'ethereum': 'ETH', 'base': 'ETH', 'bsc': 'BNB', 'sui': 'SUI', 'tron': 'TRX', 'arbitrum': 'ETH', 'avalanche': 'AVAX', 'polygon': 'MATIC', 'optimism': 'ETH', 'blast': 'ETH', 'ton': 'TON' };

function nativePriceFmt(p, symbol) {
  if (!p || p <= 0) return '0 ' + symbol;
  if (p >= 1000) return p.toLocaleString('en-US', {maximumFractionDigits:2}) + ' ' + symbol;
  if (p >= 1) return p.toFixed(4) + ' ' + symbol;
  if (p >= 0.001) return p.toFixed(6) + ' ' + symbol;
  // Very small — use subscript like dexPriceFmt but without $
  var s = p.toFixed(20);
  var dot = s.indexOf('.');
  var zeros = 0;
  for (var i = dot + 1; i < s.length; i++) {
    if (s[i] === '0') zeros++;
    else break;
  }
  if (zeros < 4) return p.toFixed(zeros + 4) + ' ' + symbol;
  var sigDigits = s.substring(dot + 1 + zeros, dot + 1 + zeros + 4).replace(/0+$/, '') || '0';
  var sub = String(zeros);
  var subHtml = '';
  for (var j = 0; j < sub.length; j++) {
    subHtml += '<sub style="font-size:0.7em;vertical-align:baseline;opacity:0.85">' + sub[j] + '</sub>';
  }
  return '0.0' + subHtml + sigDigits + ' ' + symbol;
}

function updatePriceDisplay() {
  var el = document.getElementById('bmPriceBig');
  if (!el || !window._modalToken) return;
  var t = window._modalToken;
  var nativeSym = t.quoteSymbol || _nativeTokenMap[(t.net || 'solana').toLowerCase()] || 'SOL';
  if (_bmPriceCurrency === 'native' && t.priceNative) {
    el.innerHTML = nativePriceFmt(t.priceNative, nativeSym);
  } else {
    el.innerHTML = dexPriceFmt(t.price);
  }
}

function togglePriceCurrency() {
  if (!window._modalToken) return;
  var t = window._modalToken;
  if (!t.priceNative) return; // no native price available
  _bmPriceCurrency = _bmPriceCurrency === 'usd' ? 'native' : 'usd';
  updatePriceDisplay();
}

function openBubbleModal(t) {
  if (!t) return;
  try {
  var ov = document.getElementById("bubbleModalOverlay");
  lockScroll();
  var _isMobile = window.innerWidth <= 768;
  if (_isMobile) {
    window._scrollY = window.scrollY;
    document.body.classList.add('modal-scroll-lock');
    document.body.style.top = -window._scrollY + 'px';
  }
  window._modalToken = t;

  // Init buy/sell panel — default to 24H
  _bmBuySellData = null;
  _bmActiveTf = 'h24';
  document.querySelectorAll('.bm-tf').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tf') === 'h24');
  });
  // Fetch buy/sell data right away
  if (t.ca) {
    fetchDexToken(t.ca)
      .then(function(d) {
        if (!d.pairs || !d.pairs.length) return;
        var pair = d.pairs.reduce(function(b,p) { return (p.liquidity&&p.liquidity.usd||0) > (b.liquidity&&b.liquidity.usd||0) ? p : b; }, d.pairs[0]);
        _bmBuySellData = { txns: pair.txns || {}, volume: pair.volume || {} };
        if (_bmActiveTf) renderBuySell(_bmActiveTf);
      }).catch(function() {});
  }

  // Remove any existing banner overlay
  var existingBanner = document.querySelector('.bm-banner-overlay');
  if (existingBanner) existingBanner.remove();
  window._bmBannerUrl = null;

  // Avatar
  var av = document.getElementById("bmAvatar");
  var bmChainColor = CHAIN_COLORS[t.net] || CHAIN_COLORS['solana'];
  av.style.outline = '1px solid ' + bmChainColor;
  if (t.img) {
    av.innerHTML = '<img decoding="async" src="' + imgProxy(t.img, 128, 128) + '" style="width:100%;height:100%;border-radius:6px;object-fit:cover" onerror="this.parentElement.textContent=\'' + t.sym.charAt(0) + '\'">';
  } else {
    var hue = t.p24h >= 0 ? 152 : 0;
    var lum = Math.min(45, 25 + Math.abs(t.p24h || 0) * 0.3);
    av.style.background = "hsl(" + hue + ",70%," + lum + "%)";
    av.textContent = t.sym.charAt(0);
  }
  if (t.boosted) { av.classList.add('boosted-avatar'); av.style.outline = 'none'; }
  else av.classList.remove('boosted-avatar');
  // Click avatar to show banner
  av.onclick = function(e) {
    e.stopPropagation();
    showTokenBanner();
  };
  // Fetch banner URL from DexScreener
  if (t.ca) {
    fetchDexToken(t.ca)
      .then(function(d) {
        if (d && d.pairs && d.pairs.length > 0 && d.pairs[0].info && d.pairs[0].info.header) {
          window._bmBannerUrl = d.pairs[0].info.header;
        }
      }).catch(function() {});
  }

  // Symbol & name
  document.getElementById("bmSym").textContent = t.sym;
  var bmSymEl = document.getElementById("bmSym");
  var existingBadge = bmSymEl.parentElement.querySelector('.boost-badge');
  if (existingBadge) existingBadge.remove();
  document.getElementById("bmFullname").textContent = t.name || t.sym;
  var _copyCA = function() {
    if (t.ca) {
      navigator.clipboard.writeText(t.ca);
      var existing = document.getElementById('bmCopyToast');
      if (existing) existing.remove();
      var toast = document.createElement('div');
      toast.id = 'bmCopyToast';
      toast.textContent = 'CA copied to clipboard';
      toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-60px);background:#2b2930;color:#fff;padding:10px 24px;border-radius:14px;font-size:14px;font-weight:600;z-index:100000;transition:transform 0.3s ease;white-space:nowrap;box-shadow:none;';
      document.body.appendChild(toast);
      requestAnimationFrame(function() { requestAnimationFrame(function() { toast.style.transform = 'translateX(-50%) translateY(0)'; }); });
      setTimeout(function() {
        toast.style.transform = 'translateX(-50%) translateY(-60px)';
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
      }, 1500);
    }
  };
  bmSymEl.style.cursor = 'pointer';
  bmSymEl.onclick = function(e) { e.stopPropagation(); _copyCA(); };
  document.getElementById("bmFullname").style.cursor = 'pointer';
  document.getElementById("bmFullname").onclick = function(e) { e.stopPropagation(); _copyCA(); };
  // Set watchlist star state
  var starBtn = document.getElementById("bmStar");
  if (starBtn) {
    var sActive = watchlist.includes(t.sym);
    starBtn.classList.toggle('active', sActive);
  }
  var pairTokenMap = { 'solana':'/SOL','eth':'/WETH','ethereum':'/WETH','base':'/WETH','bsc':'/BNB','sui':'/SUI','tron':'/TRX','arbitrum':'/WETH','avalanche':'/WAVAX','polygon':'/WMATIC','optimism':'/WETH','blast':'/WETH','ton':'/TON','pulsechain':'/PLS','seiv2':'/WSEI' };
  document.getElementById("bmChain").textContent = pairTokenMap[(t.net || 'solana').toLowerCase()] || '/SOL';
  var ageBadge = document.getElementById("bmAgeBadge");
  if (ageBadge) ageBadge.textContent = fmtAge(t.age) || '';

  // Price — DexScreener subscript format (default to USD on modal open)
  _bmPriceCurrency = 'usd';
  var _bmPriceEl = document.getElementById("bmPriceBig");
  _bmPriceEl.innerHTML = dexPriceFmt(t.price);
  _bmPriceEl.setAttribute('data-price', t.price);
  _bmPriceEl.setAttribute('data-price-native', t.priceNative || 0);

  // Fetch native price immediately from DexScreener if not already available
  if (!t.priceNative && t.ca) {
    fetchDexToken(t.ca)
      .then(function(d) {
        if (!d.pairs || !d.pairs.length) return;
        var pair = d.pairs.reduce(function(b,p) { return (p.liquidity&&p.liquidity.usd||0) > (b.liquidity&&b.liquidity.usd||0) ? p : b; }, d.pairs[0]);
        var pn = pair.priceNative ? parseFloat(pair.priceNative) : 0;
        var qs = pair.quoteToken ? pair.quoteToken.symbol.toUpperCase() : '';
        if (pn && window._modalToken && window._modalToken.ca === t.ca) {
          window._modalToken.priceNative = pn;
          if (qs) window._modalToken.quoteSymbol = qs;
          var el = document.getElementById('bmPriceBig');
          if (el) el.setAttribute('data-price-native', pn);
          if (_bmPriceCurrency === 'native') updatePriceDisplay();
        }
      }).catch(function() {});
  }

  // Initial header glow based on 5m change
  var hdr = document.querySelector('.bm-header');
  if (hdr) {
    hdr.classList.remove('glow-up','glow-down');
    void hdr.offsetWidth;
    var p5m = t.p5m || 0;
    hdr.classList.add(p5m >= 0 ? 'glow-up' : 'glow-down');
  }

  // Contract Address — just store on the element for copyCA()
  var caEl = document.getElementById("bmCA");
  if (caEl) caEl.title = t.ca ? ('Copy CA: ' + t.ca.slice(0,4) + '...' + t.ca.slice(-4)) : 'No CA';

  // Stats
  var fmt = function(n) {
    if (!n || n === 0) return "$0";
    if (n >= 1e9) return "$" + (n/1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n/1e6).toFixed(2) + "M";
    if (n >= 1e3) return "$" + (n/1e3).toFixed(1) + "K";
    return "$" + n.toFixed(2);
  };
  document.getElementById("bmMcap").textContent = fmt(t.mcap);
  document.getElementById("bmVol").textContent = fmt(t.vol);
  document.getElementById("bmLiq").textContent = fmt(t.liq);
  document.getElementById("bmAge").textContent = fmtAge(t.age) || "??";
  document.getElementById("bmSupply").textContent = "...";
  if (t.ca) {
    fetchDexToken(t.ca).then(function(d) {
      if (!d.pairs || !d.pairs.length) return;
      var pair = d.pairs.reduce(function(b,p) { return (p.liquidity&&p.liquidity.usd||0) > (b.liquidity&&b.liquidity.usd||0) ? p : b; }, d.pairs[0]);
      var fdv = pair.fdv || 0;
      var price = parseFloat(pair.priceUsd) || t.price;
      var supplyEl = document.getElementById("bmSupply");
      if (supplyEl && fdv && price) supplyEl.textContent = fmtNum(Math.round(fdv / price));
      else if (supplyEl) supplyEl.textContent = "??";
    }).catch(function() {
      var supplyEl = document.getElementById("bmSupply");
      if (supplyEl) supplyEl.textContent = "??";
    });
  }


  // Timeframes
  var pFmt = function(v, id) {
    var el = document.getElementById(id);
    v = Math.max(-9999, Math.min(9999, v || 0));
    el.textContent = (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
    el.style.color = v >= 0 ? "var(--green)" : "var(--red)";
  };
  pFmt(t.p5m, "bmTf5m");
  pFmt(t.p1h, "bmTf1h");
  pFmt(t.p6h, "bmTf6h");
  pFmt(t.p24h, "bmTf24h");

  // Converter V3
  initConverterV3();

  // Explorer links
  var chainExplorer = {
    'solana':'https://solscan.io/token/','eth':'https://etherscan.io/token/',
    'base':'https://basescan.org/token/','bsc':'https://bscscan.com/token/',
    'sui':'https://suiscan.xyz/mainnet/coin/','tron':'https://tronscan.org/#/token20/',
    'arbitrum':'https://arbiscan.io/token/','avalanche':'https://snowtrace.io/token/',
    'polygon':'https://polygonscan.com/token/','optimism':'https://optimistic.etherscan.io/token/',
    'blast':'https://blastscan.io/token/','ton':'https://tonviewer.com/',
    'pulsechain':'https://scan.pulsechain.com/token/','seiv2':'https://seitrace.com/token/',
    'sonic':'https://sonicscan.org/token/','hyperliquid':'https://hyperscan.xyz/token/',
    'berachain':'https://berascan.com/token/','monad':'https://monadscan.com/token/',
    'cronos':'https://cronoscan.com/token/','aptos':'https://explorer.aptoslabs.com/account/',
    'linea':'https://lineascan.build/token/','zksync':'https://explorer.zksync.io/address/',
    'fantom':'https://ftmscan.com/token/','mantle':'https://mantlescan.xyz/token/',
    'scroll':'https://scrollscan.com/token/','manta':'https://pacific-explorer.manta.network/token/',
    'starknet':'https://starkscan.co/token/'
  };
  var solscanLink = document.getElementById("bmLinkSolscan");
  if (solscanLink) {
    solscanLink.href = (chainExplorer[t.net] || 'https://solscan.io/token/') + (t.ca || '');
    var explorerNames = {'solana':'Solscan','eth':'Etherscan','base':'Basescan','bsc':'BscScan','arbitrum':'Arbiscan','avalanche':'Snowtrace','polygon':'Polygonscan','optimism':'OP Explorer','blast':'Blastscan','ton':'TON Viewer','pulsechain':'PulseScan','seiv2':'Seitrace','sonic':'Sonicscan','hyperliquid':'HyperScan','berachain':'Berascan','monad':'MonadScan','cronos':'CronoScan','aptos':'Aptos Explorer','linea':'LineaScan','zksync':'zkSync Explorer','fantom':'FTMScan','mantle':'Mantle Explorer','scroll':'ScrollScan','manta':'Manta Explorer','starknet':'Starkscan'};
    try {
      var scanIcon = document.getElementById('bmSolscanIcon');
      if (scanIcon && typeof SCANNER_ICONS !== 'undefined') scanIcon.src = SCANNER_ICONS[t.net] || SCANNER_ICONS['solana'];
      var scanName = document.getElementById('bmSolscanName');
      if (scanName) scanName.textContent = explorerNames[t.net] || 'Explorer';
    } catch(e2){}
  }
  var webLink = document.getElementById("bmLinkWeb");
  if (webLink) { if (t.website) { webLink.href = t.website; webLink.style.display = ""; } else { webLink.style.display = "none"; } }
  var xLink = document.getElementById("bmLinkX");
  if (xLink) { xLink.href = t.twitter || ("https://x.com/search?q=%24" + t.sym); xLink.style.display = ''; }
  var searchLink = document.getElementById("bmSearchLink");
  if (searchLink) searchLink.href = "https://x.com/search?q=" + encodeURIComponent("$" + t.sym + " OR " + t.ca) + "&src=typed_query&f=live";

  // Boost CTA
  var boostTitle = document.querySelector('.bm-boost-title');
  var boostDesc = document.querySelector('.bm-boost-desc');
  if (boostTitle && boostDesc) {
    if (t.boosted && t.boostCount) {
      boostTitle.textContent = '⚡' + t.boostCount + ' Boosted!';
      boostDesc.textContent = 'Add more boosts to increase visibility';
    } else {
      boostTitle.textContent = 'Boost this token';
      boostDesc.textContent = 'Get featured with a golden spotlight in scopes';
    }
  }

  // Show modal
  ov.classList.add("open");
  loadTradingView(function() { _initModalChart(t); });

  // Update URL
  try {
    var chain = (t.net || 'solana').toLowerCase();
    var ca = t.ca || '';
    if (ca) history.pushState({ token: true, ca: ca, chain: chain }, '', '/' + chain + '/' + ca);
  } catch(e3) {}

  } catch(e) { console.error('Modal error:', e); }
}

// ── Buy/Sell panel under timeframes ──
var _bmBuySellData = null; // stores { m5:{buys,sells}, h1:{...}, h6:{...}, h24:{...} } + volumes
var _bmActiveTf = null;

function toggleBuySell(tf) {
  var tabs = document.querySelectorAll('.bm-tf');
  _bmActiveTf = tf;
  tabs.forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-tf') === tf);
  });

  // If we have cached data, show it immediately
  if (_bmBuySellData) {
    renderBuySell(tf);
  }

  // Fetch fresh data
  var t = window._modalToken;
  if (!t || !t.ca) return;
  fetchDexToken(t.ca)
    .then(function(d) {
      if (!d.pairs || !d.pairs.length) return;
      var pair = d.pairs.reduce(function(b,p) { return (p.liquidity&&p.liquidity.usd||0) > (b.liquidity&&b.liquidity.usd||0) ? p : b; }, d.pairs[0]);
      _bmBuySellData = { txns: pair.txns || {}, volume: pair.volume || {} };
      if (_bmActiveTf) renderBuySell(_bmActiveTf);
    }).catch(function() {});
}

function renderBuySell(tf) {
  if (!_bmBuySellData) return;
  var txns = _bmBuySellData.txns[tf] || { buys: 0, sells: 0 };
  var vol = _bmBuySellData.volume[tf] || 0;
  var buys = txns.buys || 0;
  var sells = txns.sells || 0;
  var total = buys + sells;
  var buyPct = total > 0 ? (buys / total * 100) : 50;

  document.getElementById('bmBsBuys').textContent = buys.toLocaleString();
  document.getElementById('bmBsSells').textContent = sells.toLocaleString();
  document.getElementById('bmBsTxnBar').style.width = buyPct + '%';

  // Volume — DexScreener only gives total vol per timeframe, estimate split by txn ratio
  var fmtV = function(n) {
    if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  var buyVol = total > 0 ? vol * (buys / total) : vol / 2;
  var sellVol = total > 0 ? vol * (sells / total) : vol / 2;
  var volPct = vol > 0 ? (buyVol / vol * 100) : 50;

  document.getElementById('bmBsBuyVol').textContent = fmtV(buyVol);
  document.getElementById('bmBsSellVol').textContent = fmtV(sellVol);
  document.getElementById('bmBsVolBar').style.width = volPct + '%';
}

// ── Modal watchlist star ──
function showTokenBanner() {
  var existing = document.querySelector('.bm-banner-overlay');
  if (existing) { existing.remove(); return; }
  if (!window._bmBannerUrl) return;
  var modal = document.querySelector('.bubble-modal');
  if (!modal) return;
  var overlay = document.createElement('div');
  overlay.className = 'bm-banner-overlay';
  overlay.innerHTML = '<img src="' + window._bmBannerUrl + '" onerror="this.parentElement.remove()">' +
    '<button class="bm-banner-close" onclick="event.stopPropagation();this.parentElement.remove()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
  modal.insertBefore(overlay, modal.firstChild);
}

function toggleModalWatchlist(btnEl) {
  var t = window._modalToken;
  if (!t || !t.sym) return;
  toggleWatchlist(t.sym, null);
  var isActive = watchlist.includes(t.sym);
  btnEl.classList.toggle('active', isActive);
}

// ── Modal 3-dot dropdown ──
var _bmDropdown = null;
function toggleModalMenu() {
  if (_bmDropdown) { closeModalMenu(); return; }
  var t = window._modalToken;
  if (!t) return;
  var dots = document.getElementById('bmDots');
  dots.classList.add('active');

  var net = (t.net || 'solana').toLowerCase();
  var explorers = {
    solana:{url:'https://solscan.io/token/'+t.ca,name:'Solscan'},
    eth:{url:'https://etherscan.io/token/'+t.ca,name:'Etherscan'},
    base:{url:'https://basescan.org/token/'+t.ca,name:'Basescan'},
    bsc:{url:'https://bscscan.com/token/'+t.ca,name:'BscScan'},
    sui:{url:'https://suiscan.xyz/mainnet/coin/'+t.ca,name:'Suiscan'},
    tron:{url:'https://tronscan.org/#/token20/'+t.ca,name:'Tronscan'},
    arbitrum:{url:'https://arbiscan.io/token/'+t.ca,name:'Arbiscan'},
    avalanche:{url:'https://snowtrace.io/token/'+t.ca,name:'Snowtrace'},
    polygon:{url:'https://polygonscan.com/token/'+t.ca,name:'Polygonscan'},
    optimism:{url:'https://optimistic.etherscan.io/token/'+t.ca,name:'Optimism Explorer'},
    blast:{url:'https://blastscan.io/token/'+t.ca,name:'Blastscan'},
    ton:{url:'https://tonviewer.com/'+t.ca,name:'TON Viewer'},
    pulsechain:{url:'https://scan.pulsechain.com/token/'+t.ca,name:'PulseScan'},
    seiv2:{url:'https://seitrace.com/token/'+t.ca,name:'Seitrace'},
    sonic:{url:'https://sonicscan.org/token/'+t.ca,name:'Sonicscan'},
    hyperliquid:{url:'https://hyperscan.xyz/token/'+t.ca,name:'HyperScan'},
    berachain:{url:'https://berascan.com/token/'+t.ca,name:'Berascan'},
    monad:{url:'https://monadscan.com/token/'+t.ca,name:'MonadScan'},
    cronos:{url:'https://cronoscan.com/token/'+t.ca,name:'CronoScan'},
    aptos:{url:'https://explorer.aptoslabs.com/account/'+t.ca,name:'Aptos Explorer'},
    linea:{url:'https://lineascan.build/token/'+t.ca,name:'LineaScan'},
    zksync:{url:'https://explorer.zksync.io/address/'+t.ca,name:'zkSync Explorer'},
    fantom:{url:'https://ftmscan.com/token/'+t.ca,name:'FTMScan'},
    mantle:{url:'https://mantlescan.xyz/token/'+t.ca,name:'Mantle Explorer'},
    scroll:{url:'https://scrollscan.com/token/'+t.ca,name:'ScrollScan'},
    manta:{url:'https://pacific-explorer.manta.network/token/'+t.ca,name:'Manta Explorer'},
    starknet:{url:'https://starkscan.co/token/'+t.ca,name:'Starkscan'}
  };
  var exp = explorers[net] || explorers.solana;
  var expIcon = (typeof SCANNER_ICONS !== 'undefined' && SCANNER_ICONS[net]) ? SCANNER_ICONS[net] : ((typeof CHAIN_ICONS !== 'undefined' && CHAIN_ICONS[net]) ? CHAIN_ICONS[net] : '');

  var dd = document.createElement('div');
  dd.className = 'bm-dropdown';
  var html = '';
  var caLabel2 = t.ca ? (t.ca.slice(0,4) + '...' + t.ca.slice(-4)) : 'N/A';
  html += '<span onclick="event.stopPropagation();navigator.clipboard.writeText(\''+t.ca+'\');var s=this;s.childNodes[1].nodeValue=\' Copied!\';setTimeout(function(){s.childNodes[1].nodeValue=\' '+caLabel2+'\'},1200)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M760-200H320q-33 0-56.5-23.5T240-280v-560q0-33 23.5-56.5T320-920h280l240 240v400q0 33-23.5 56.5T760-200ZM560-640v-200H320v560h440v-360H560ZM160-40q-33 0-56.5-23.5T80-120v-560h80v560h440v80H160Zm160-800v200-200 560-560Z"/></svg> '+caLabel2+'</span>';
  html += '<a href="https://x.com/search?q='+encodeURIComponent('$'+t.sym+' OR '+t.ca)+'&src=typed_query&f=live" target="_blank" onclick="event.stopPropagation()"><svg class="ico-search" viewBox="0 0 32 32" fill="currentColor"><path d="M16.906 20.188l5.5 5.5-2.25 2.281-5.75-5.781c-1.406 0.781-3.031 1.219-4.719 1.219-5.344 0-9.688-4.344-9.688-9.688s4.344-9.688 9.688-9.688 9.719 4.344 9.719 9.688c0 2.5-0.969 4.781-2.5 6.469zM3.219 13.719c0 3.594 2.875 6.469 6.469 6.469s6.469-2.875 6.469-6.469-2.875-6.469-6.469-6.469-6.469 2.875-6.469 6.469z"/></svg>Search on X</a>';
  if (t.twitter) html += '<a href="'+t.twitter+'" target="_blank" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>Community</a>';
  if (t.website) html += '<a href="'+t.website+'" target="_blank" onclick="event.stopPropagation()"><svg class="ico-globe" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M325-111.5q-73-31.5-127.5-86t-86-127.5Q80-398 80-480.5t31.5-155q31.5-72.5 86-127t127.5-86Q398-880 480.5-880t155 31.5q72.5 31.5 127 86t86 127Q880-563 880-480.5T848.5-325q-31.5 73-86 127.5t-127 86Q563-80 480.5-80T325-111.5ZM480-162q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>Website</a>';
  html += '<a href="'+exp.url+'" target="_blank" onclick="event.stopPropagation()"><img src="'+expIcon+'" onerror="this.style.display=\'none\'">'+exp.name+'</a>';
  // Bubblemaps — only show for supported chains
  var _bmChains = {solana:1,eth:1,bsc:1,tron:1,base:1,ton:1,avalanche:1,polygon:1};
  if (_bmChains[net]) {
    html += '<span onclick="event.stopPropagation();closeModalMenu();showBubblemapsView()"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 151 97" width="26" height="17" style="vertical-align:-3px"><g transform="matrix(0.358637,0,0,0.442707,-3370.29,-2535.37)"><g transform="matrix(-0.569944,-0.461713,0.569944,-0.461713,4403.48,14658.4)"><path d="M5074.5,13845.5C5074.5,13845.5 5137,13879.9 5137,13924.5C5137,13959 5108.99,13987 5074.5,13987C5040.01,13987 5012,13959 5012,13924.5C5012,13879.9 5074.5,13845.5 5074.5,13845.5Z" style="fill:url(#_dd1)"/></g><g transform="matrix(0.723552,-0.338414,0.417743,0.586151,299.802,-598.176)"><path d="M4796.35,13671.2C4796.35,13628.2 4856.64,13595 4856.64,13595C4856.64,13595 4916.94,13628.2 4916.94,13671.2V13867.3C4916.94,13900.6 4889.92,13927.6 4856.64,13927.6C4823.36,13927.6 4796.35,13900.6 4796.35,13867.3V13671.2Z" style="fill:url(#_dd2)"/></g><g transform="matrix(0.723552,-0.338414,0.417743,0.586151,459.141,-598.176)"><path d="M4796.35,13671.2C4796.35,13628.2 4856.64,13595 4856.64,13595C4856.64,13595 4916.94,13628.2 4916.94,13671.2V13867.3C4916.94,13900.6 4889.92,13927.6 4856.64,13927.6C4823.36,13927.6 4796.35,13900.6 4796.35,13867.3V13671.2Z" style="fill:url(#_dd3)"/></g></g><defs><linearGradient gradientTransform="matrix(5.22e-16,-141.487,160.148,5.91e-16,5074.5,13987)" gradientUnits="userSpaceOnUse" id="_dd1"><stop offset="0" stop-color="rgb(111,23,186)"/><stop offset="1" stop-color="rgb(176,56,250)"/></linearGradient><linearGradient gradientTransform="matrix(2.04e-14,-332.592,917.287,5.62e-14,4856.64,13927.6)" gradientUnits="userSpaceOnUse" id="_dd2"><stop offset="0" stop-color="rgb(196,27,175)"/><stop offset="1" stop-color="rgb(245,37,134)"/></linearGradient><linearGradient gradientTransform="matrix(2.04e-14,-332.592,917.287,5.62e-14,4856.64,13927.6)" gradientUnits="userSpaceOnUse" id="_dd3"><stop offset="0" stop-color="rgb(48,84,182)"/><stop offset="1" stop-color="rgb(0,164,252)"/></linearGradient></defs></svg> Bubblemaps</span>';
  }
  html += '<span onclick="event.stopPropagation();closeModalMenu();if(typeof openBoostModal===\'function\')openBoostModal()" style="background:rgba(234,179,8,0.15);color:#eab308;border-radius:0 0 10px 10px;margin:0;padding:10px 14px;box-sizing:border-box"><svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Boost Token</span>';
  dd.innerHTML = html;

  document.body.appendChild(dd);
  _bmDropdown = dd;

  // Position below the dots
  var rect = dots.getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.left = rect.left + 'px';
  dd.style.top = (rect.bottom + 4) + 'px';

  // Adjust if off-screen
  requestAnimationFrame(function() {
    dd.classList.add('open');
    var dr = dd.getBoundingClientRect();
    if (dr.right > window.innerWidth - 10) dd.style.left = (window.innerWidth - dr.width - 10) + 'px';
    if (dr.bottom > window.innerHeight - 10) dd.style.top = (rect.top - dr.height - 4) + 'px';
  });
}
function closeModalMenu() {
  var dots = document.getElementById('bmDots');
  if (dots) dots.classList.remove('active');
  if (_bmDropdown) { _bmDropdown.remove(); _bmDropdown = null; }
}
document.addEventListener('click', function(e) {
  if (_bmDropdown && !e.target.closest('.bm-dots') && !e.target.closest('.bm-dropdown')) closeModalMenu();
});

// ── Bubblemaps iframe view ──
function showBubblemapsView() {
  var t = window._modalToken;
  if (!t || !t.ca) return;
  var net = (t.net || 'solana').toLowerCase();
  var supported = {solana:'solana',eth:'eth',bsc:'bsc',tron:'tron',base:'base',ton:'ton',avalanche:'avalanche',polygon:'polygon'};
  var chain = supported[net];
  if (!chain) return;
  window.open('https://app.bubblemaps.io/' + chain + '/token/' + t.ca, '_blank');
}
function closeBubblemapsView() {
  var overlay = document.getElementById('bmBubblemapsOverlay');
  var chart = document.getElementById('bmChartWrap');
  var footer = document.querySelector('.bm-footer');
  var frame = document.getElementById('bmBubblemapsFrame');
  if (overlay) { overlay.classList.remove('open'); overlay.style.display = 'none'; }
  if (frame) frame.src = '';
  var modal = document.querySelector('.bubble-modal');
  if (modal) { modal.classList.remove('bm-bubblemaps-active'); modal.style.height = ''; }
  var statsBar = document.querySelector('.bm-stats-bar');
  if (statsBar) statsBar.style.display = '';
  if (chart) chart.style.display = '';
  if (footer) footer.style.display = '';
}

/* ── Converter V3 ── */
var _convFrom = 'USD';
var _convTo = '';
var _convCurrency = 'usd'; // 'usd' or 'native'

function _convFormatPlain(n) {
  if (!isFinite(n) || n === 0) return '0';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return n.toPrecision(4);
}

function _convFormatDisplay(n, unit) {
  if (unit === 'USD') {
    if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  }
  return _convFormatPlain(n);
}

function updateConverterV3() {
  var t = window._modalToken;
  if (!t || !t.price) return;
  var input = document.getElementById('bmConvInput');
  var output = document.getElementById('bmConvOutput');
  var rateEl = document.getElementById('bmConvRate');
  var sym = t.sym || 'TOKEN';
  var amount = parseFloat(String(input.value).replace(/,/g, '')) || 0;
  var rate, result;
  if (_convCurrency === 'native' && t.priceNative) {
    // Native coin mode: convert native → token or token → native
    if (_convFrom !== sym) {
      rate = 1 / t.priceNative;
      result = amount * rate;
    } else {
      rate = t.priceNative;
      result = amount * rate;
    }
  } else {
    // USD mode
    if (_convFrom === 'USD') {
      rate = 1 / t.price;
      result = amount * rate;
    } else {
      rate = t.price;
      result = amount * rate;
    }
  }
  output.textContent = _convFormatDisplay(result, _convTo);
  var unitRate = result / (amount || 1);
  rateEl.textContent = ' · 1 ' + _convFrom + ' ≈ ' + _convFormatDisplay(unitRate, _convTo) + ' ' + _convTo;
}

function swapConverterV3() {
  var t = window._modalToken;
  if (!t || !t.price) return;
  var sym = t.sym || 'TOKEN';
  var input = document.getElementById('bmConvInput');
  var output = document.getElementById('bmConvOutput');
  // Get current result to move into input
  var curAmount = parseFloat(String(input.value).replace(/,/g, '')) || 0;
  var rate;
  if (_convCurrency === 'native' && t.priceNative) {
    rate = (_convFrom !== sym) ? (1 / t.priceNative) : t.priceNative;
  } else {
    rate = (_convFrom === 'USD') ? (1 / t.price) : t.price;
  }
  var result = curAmount * rate;
  // Swap
  var tmp = _convFrom;
  _convFrom = _convTo;
  _convTo = tmp;
  input.value = _convFormatPlain(result);
  document.getElementById('bmConvFromUnit').textContent = _convFrom;
  document.getElementById('bmConvToUnit').textContent = _convTo;
  updateConverterV3();
}

function convPreset(p) {
  var t = window._modalToken;
  if (!t) return;
  var input = document.getElementById('bmConvInput');
  var map = { '1K': '1000', '10K': '10000', '20K': '20000' };
  input.value = map[p] || p;
  updateConverterV3();
}

function toggleConvCurrency() {
  var t = window._modalToken;
  if (!t) return;
  var sym = t.sym || 'TOKEN';
  var nativeSym = t.quoteSymbol || _nativeTokenMap[(t.net || 'solana').toLowerCase()] || 'SOL';
  var presetsEl = document.getElementById('bmConvPresets');
  var fromUnit = document.getElementById('bmConvFromUnit');
  var input = document.getElementById('bmConvInput');

  if (_convCurrency === 'usd') {
    // Switch to native coin
    _convCurrency = 'native';
    _convFrom = nativeSym;
    _convTo = sym;
    fromUnit.textContent = nativeSym;
    document.getElementById('bmConvToUnit').textContent = sym;
    input.value = '1';
    presetsEl.innerHTML =
      '<button class="bm-conv-chip" onclick="convPreset(\'1\')">1</button>' +
      '<button class="bm-conv-chip" onclick="convPreset(\'2\')">2</button>' +
      '<button class="bm-conv-chip" onclick="convPreset(\'3\')">3</button>' +
      '<button class="bm-conv-chip" onclick="convPreset(\'4\')">4</button>' +
      '<button class="bm-conv-chip" onclick="convPreset(\'5\')">5</button>';
  } else {
    // Switch back to USD
    _convCurrency = 'usd';
    _convFrom = 'USD';
    _convTo = sym;
    fromUnit.textContent = 'USD';
    document.getElementById('bmConvToUnit').textContent = sym;
    input.value = '1';
    presetsEl.innerHTML =
      '<button class="bm-conv-chip" onclick="convPreset(\'10\')">10</button>' +
      '<button class="bm-conv-chip" onclick="convPreset(\'100\')">100</button>' +
      '<button class="bm-conv-chip" onclick="convPreset(\'1K\')">1K</button>' +
      '<button class="bm-conv-chip" onclick="convPreset(\'10K\')">10K</button>' +
      '<button class="bm-conv-chip" onclick="convPreset(\'20K\')">20K</button>';
  }
  updateConverterV3();
}

function initConverterV3() {
  var t = window._modalToken;
  if (!t) return;
  var sym = t.sym || 'TOKEN';
  _convCurrency = 'usd';
  _convFrom = 'USD';
  _convTo = sym;
  document.getElementById('bmConvInput').value = '1';
  document.getElementById('bmConvFromUnit').textContent = 'USD';
  document.getElementById('bmConvToUnit').textContent = sym;
  // Reset presets to USD mode
  var presetsEl = document.getElementById('bmConvPresets');
  if (presetsEl) presetsEl.innerHTML =
    '<button class="bm-conv-chip" onclick="convPreset(\'10\')">10</button>' +
    '<button class="bm-conv-chip" onclick="convPreset(\'100\')">100</button>' +
    '<button class="bm-conv-chip" onclick="convPreset(\'1K\')">1K</button>' +
    '<button class="bm-conv-chip" onclick="convPreset(\'10K\')">10K</button>' +
    '<button class="bm-conv-chip" onclick="convPreset(\'20K\')">20K</button>';
  updateConverterV3();
}

function copyCA() {
  var t = window._modalToken;
  if(!t || !t.ca) return;
  navigator.clipboard.writeText(t.ca).then(function() {
    var el = document.getElementById("bmCA");
    el.style.color = 'var(--green)';
    el.title = 'Copied!';
    setTimeout(function() {
      el.style.color = '';
      el.title = 'Copy CA';
    }, 1200);
  });
}

function toggleSearchDropdown(e) {
  var dd = document.getElementById("bmSearchDropdown");
  if(!dd) return;
  if(dd.style.display === 'none') {
    var btn = document.getElementById("bmLinkSearch");
    var rect = btn.getBoundingClientRect();
    dd.style.top = (rect.bottom + 6) + 'px';
    dd.style.left = (rect.right - 170) + 'px';
    dd.style.display = 'block';
  } else {
    dd.style.display = 'none';
  }
}
document.addEventListener('click', function(e) {
  var dd = document.getElementById("bmSearchDropdown");
  var wrap = document.querySelector('.bm-search-wrap');
  if(dd && wrap && !wrap.contains(e.target)) dd.style.display = 'none';
});

function closeBubbleModal() {
  var ov = document.getElementById("bubbleModalOverlay");
  if(!ov || !ov.classList.contains("open")) return;
  m3CloseOverlay(ov);
  unlockScroll();
  document.title = 'MemeScope — The Meme Coin Scope & Scanner';
  if (document.body.classList.contains('modal-scroll-lock')) {
    document.body.classList.remove('modal-scroll-lock');
    document.body.style.top = '';
    window.scrollTo(0, window._scrollY || 0);
  }
  closeModalMenu();
  closeBubblemapsView();
  if(_candlePollTimer) { clearInterval(_candlePollTimer); _candlePollTimer = null; }
  // Destroy TradingView modal chart
  if (window._bmChartPoll) { clearInterval(window._bmChartPoll); window._bmChartPoll = null; }
  if (window._bmSubIntervals) {
    Object.keys(window._bmSubIntervals).forEach(function(guid) { clearInterval(window._bmSubIntervals[guid]); });
    window._bmSubIntervals = {};
  }
  // Clean up worker subscriptions for bubble modal
  if (_priceWorker) _priceWorker.postMessage({ type: 'unsubscribeAll' });
  _priceWorkerCallbacks = {};
  if (window._bmWidget) { try { window._bmWidget.remove(); } catch(e) {} window._bmWidget = null; }
  // Clean up no-data overlay and poll
  if (window._bmNoDataPoll) { clearInterval(window._bmNoDataPoll); window._bmNoDataPoll = null; }
  var bmNoData = document.getElementById('bmNoDataOverlay');
  if (bmNoData) bmNoData.style.display = 'none';
  var bmChart = document.getElementById('bmTvChartContainer');
  if (bmChart) bmChart.innerHTML = '';
  // Clear bar cache for this token
  var mt = window._modalToken;
  if (mt && mt.ca) {
    Object.keys(_barCache).forEach(function(k) { if (k.indexOf(mt.ca) === 0) delete _barCache[k]; });
  }
  if(window.location.pathname !== '/') {
    try { history.replaceState({}, '', '/'); } catch(e) {}
  }
}

// Close modal on browser back / swipe back
window.addEventListener('popstate', function() {
  var ov = document.getElementById("bubbleModalOverlay");
  if(ov && ov.classList.contains("open")) {
    closeBubbleModal();
  }
  // Also close token page if open
  var tp = document.getElementById('tokenPage');
  if(tp && tp.style.display !== 'none') {
    closeTokenPage();
  }
});

// Init TradingView Advanced Chart inside the modal
function _initModalChart(t) {
  if (!window.TradingView || !t || !t.ca) return;
  var container = document.getElementById('bmTvChartContainer');
  if (!container) return;

  // Clean up any previous widget
  if (window._bmChartPoll) { clearInterval(window._bmChartPoll); window._bmChartPoll = null; }
  if (window._bmSubIntervals) {
    Object.keys(window._bmSubIntervals).forEach(function(guid) { clearInterval(window._bmSubIntervals[guid]); });
    window._bmSubIntervals = {};
  }
  if (_priceWorker) _priceWorker.postMessage({ type: 'unsubscribeAll' });
  _priceWorkerCallbacks = {};
  if (window._bmWidget) { try { window._bmWidget.remove(); } catch(e) {} window._bmWidget = null; }
  if (window._bmNoDataPoll) { clearInterval(window._bmNoDataPoll); window._bmNoDataPoll = null; }
  var bmNd = document.getElementById('bmNoDataOverlay');
  if (bmNd) bmNd.style.display = 'none';
  container.innerHTML = '';
  // Show chart loading overlay
  var chartLoad = document.getElementById('bmChartLoading');
  if (chartLoad) { chartLoad.classList.remove('hidden'); chartLoad.style.display = ''; }

  var chain = (t.net || 'solana').toLowerCase();
  var pairTokenMap2 = { solana:'SOL', eth:'WETH', base:'WETH', bsc:'BNB', sui:'SUI', tron:'TRX', arbitrum:'WETH', avalanche:'WAVAX', polygon:'WMATIC', optimism:'WETH', blast:'WETH', ton:'TON', pulsechain:'PLS', seiv2:'WSEI' };
  var geckoChainMap = { solana:'solana', eth:'eth', base:'base', bsc:'bsc', sui:'sui-network', tron:'tron', arbitrum:'arbitrum', avalanche:'avax', polygon:'polygon_pos', optimism:'optimism', blast:'blast', ton:'ton', pulsechain:'pulsechain', seiv2:'sei-evm', sonic:'sonic', hyperliquid:'hyperliquid', berachain:'berachain', monad:'monad', cronos:'cro', aptos:'aptos', linea:'linea', zksync:'zksync', fantom:'ftm', mantle:'mantle', scroll:'scroll', manta:'manta-pacific', starknet:'starknet-alpha' };
  var dexChainMap2 = { solana:'solana', eth:'ethereum', base:'base', bsc:'bsc', sui:'sui', tron:'tron', arbitrum:'arbitrum', avalanche:'avalanche', polygon:'polygon', optimism:'optimism', blast:'blast', ton:'ton', pulsechain:'pulsechain', seiv2:'seiv2' };
  var geckoNet = geckoChainMap[chain] || chain;
  var dexNet = dexChainMap2[chain] || chain;

  function _discoverPoolModal(cb) {
    if (t._discoveredPool) { cb(t._discoveredPool); return; }
    if (t.pairAddress) { t._discoveredPool = t.pairAddress; cb(t.pairAddress); return; }
    var done = false;
    fetchDexToken(t.ca).then(function(d){
      if (done) return;
      if (d && d.pairs && d.pairs.length) {
        var cp = d.pairs.filter(function(p){return p.chainId === dexNet});
        var best = (cp.length ? cp : d.pairs).reduce(function(b,p){return (p.liquidity&&p.liquidity.usd||0)>(b.liquidity&&b.liquidity.usd||0)?p:b},(cp.length?cp:d.pairs)[0]);
        if (best.pairAddress) { done = true; t._discoveredPool = best.pairAddress; cb(best.pairAddress); }
      }
    }).catch(function(){});
    geckoFetch('https://api.geckoterminal.com/api/v2/networks/'+geckoNet+'/tokens/'+t.ca+'/pools?page=1',{headers:{'Accept':'application/json'}}).then(function(r){return r.json()}).then(function(d){
      if (done) return;
      if (d && d.data && d.data.length) {
        var poolId = d.data[0].attributes && d.data[0].attributes.address;
        if (!poolId) { var pts = d.data[0].id.split('_'); poolId = pts.length > 1 ? pts.slice(1).join('_') : d.data[0].id; }
        if (poolId) { done = true; t._discoveredPool = poolId; cb(poolId); }
      }
    }).catch(function(){});
    setTimeout(function(){ if (!done) { done = true; cb(null); } }, 8000);
  }

  var datafeed = {
    onReady: function(cb) {
      setTimeout(function() {
        cb({ supported_resolutions:['1','5','15','30','60','240','1D'], supports_time:true });
      }, 0);
    },
    searchSymbols: function(q,e,st,cb) { cb([]); },
    resolveSymbol: function(name, onRes, onErr) {
      setTimeout(function() {
        var p = t.price || 0.00001;
        var ps = 100;
        if (p < 1) ps = 10000;
        if (p < 0.01) ps = 1000000;
        if (p < 0.0001) ps = 100000000;
        if (p < 0.000001) ps = 10000000000;
        onRes({
          name: t.sym + '/' + (pairTokenMap2[chain] || 'SOL'),
          description: t.name || t.sym,
          type: 'crypto',
          session: '24x7',
          exchange: 'memescope.io',
          timezone: 'Etc/UTC',
          format: 'price',
          pricescale: ps,
          minmov: 1,
          has_intraday: true,
          supported_resolutions: ['1','5','15','30','60','240','1D'],
          volume_precision: 2,
          data_status: 'streaming',
        });
      }, 0);
    },
    getBars: function(sym, res, params, onRes, onErr) {
      if (params.firstDataRequest === false) { onRes([], { noData: true }); return; }
      var cacheKey = t.ca + '_' + res;
      if (_barCache[cacheKey]) { onRes(_barCache[cacheKey], { noData: _barCache[cacheKey].length === 0 }); return; }
      var resMap = {'1':{agg:'minute',mult:1},'5':{agg:'minute',mult:5},'15':{agg:'minute',mult:15},'30':{agg:'minute',mult:30},'60':{agg:'hour',mult:1},'240':{agg:'hour',mult:4},'1D':{agg:'day',mult:1}};
      var rc = resMap[res] || resMap['1'];
      var resMin = parseInt(res);
      var resMs = (!isNaN(resMin) ? resMin : 1) * 60000;
      if (res === '1D') resMs = 86400000;
      // Fallback: seed bars from DexScreener live price when no OHLCV available
      function _seedFromLivePrice() {
        var overlay = document.getElementById('bmNoDataOverlay');
        if (overlay) overlay.style.display = 'flex';
        onRes([], { noData: true });
      }
      _discoverPoolModal(function(pool) {
        if (!pool) { _seedFromLivePrice(); return; }
        var url = 'https://api.geckoterminal.com/api/v2/networks/'+geckoNet+'/pools/'+pool+'/ohlcv/'+rc.agg+'?aggregate='+rc.mult+'&limit=1000&currency=usd';
        var attempt = 0;
        function tryFetch() {
          attempt++;
          var ctrl = new AbortController();
          var tid = setTimeout(function(){ ctrl.abort(); }, 12000);
          geckoFetch(url,{headers:{'Accept':'application/json'},signal:ctrl.signal}).then(function(r){
            clearTimeout(tid);
            if (r.status === 429 || r.status === 403) {
              if (attempt < 5) { setTimeout(tryFetch, attempt * 2000); return; }
              _seedFromLivePrice(); return;
            }
            return r.json();
          }).then(function(d){
            if (!d) return;
            var list = d && d.data && d.data.attributes && d.data.attributes.ohlcv_list;
            if (!list || !list.length) {
              _seedFromLivePrice();
              return;
            }
            var seen = {};
            var bars = [];
            for (var i = 0; i < list.length; i++) {
              var c = list[i];
              var tm = c[0] * 1000;
              tm = Math.floor(tm / resMs) * resMs;
              if (!tm || seen[tm]) continue;
              seen[tm] = true;
              bars.push({ time: tm, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] });
            }
            bars.sort(function(a,b){ return a.time - b.time; });
            // Place live candle RIGHT AFTER last OHLCV bar (eliminates time gap)
            function _finishBars(livePrice) {
              if (bars.length > 0 && livePrice) {
                var last = bars[bars.length - 1];
                var nextSlot = last.time + resMs;
                var nowBucket = Math.floor(Date.now() / resMs) * resMs;
                console.log('[MODAL CHART] Last OHLCV:', new Date(last.time).toISOString(),
                  '| now:', new Date(nowBucket).toISOString(),
                  '| gap:', Math.round((nowBucket - last.time) / 60000), 'min',
                  '| OHLCV close:', last.close, '| live:', livePrice);
                bars.push({ time: nextSlot, open: last.close, high: Math.max(last.close, livePrice), low: Math.min(last.close, livePrice), close: livePrice, volume: 0 });
              }
              _barCache[cacheKey] = bars;
              onRes(bars, { noData: bars.length === 0 });
            }
            // Use SAME pair selection as subscribeBars (highest liquidity, not pairs[0])
            fetchDexToken(t.ca).then(function(dexData) {
              var lp = bars.length > 0 ? bars[bars.length - 1].close : 0;
              if (dexData && dexData.pairs && dexData.pairs.length) {
                var bestPair = dexData.pairs.reduce(function(b,p) { return (p.liquidity&&p.liquidity.usd||0) > (b.liquidity&&b.liquidity.usd||0) ? p : b; }, dexData.pairs[0]);
                var p = parseFloat(bestPair.priceUsd);
                if (p) lp = p;
              }
              _finishBars(lp);
            }).catch(function() {
              _finishBars(bars.length > 0 ? bars[bars.length - 1].close : 0);
            });
          }).catch(function(){
            clearTimeout(tid);
            if (attempt < 5) { setTimeout(tryFetch, attempt * 2000); return; }
            _seedFromLivePrice();
          });
        }
        tryFetch();
      });
    },
    subscribeBars: function(sym, res, onTick, guid) {
      var resMin = parseInt(res);
      var resMs = (!isNaN(resMin) ? resMin : 1) * 60000;
      if (res === '1D') resMs = 86400000;
      var _currentBar = null;
      var cacheKey = t.ca + '_' + res;
      if (_barCache[cacheKey] && _barCache[cacheKey].length) {
        var lastBar = _barCache[cacheKey][_barCache[cacheKey].length - 1];
        _currentBar = { time: lastBar.time, open: lastBar.open, high: lastBar.high, low: lastBar.low, close: lastBar.close, volume: lastBar.volume };
      }
      var _lastTickPrice = _currentBar ? _currentBar.close : 0;

      function _handleTick(d) {
        try {
          if (!d.pairs || !d.pairs.length) return;
          var pair = d.pairs.reduce(function(b,p) { return (p.liquidity&&p.liquidity.usd||0) > (b.liquidity&&b.liquidity.usd||0) ? p : b; }, d.pairs[0]);
          var price = parseFloat(pair.priceUsd);
          if (!price) return;
          var barTime = Math.floor(Date.now() / resMs) * resMs;
          var priceChanged = price !== _lastTickPrice;
          var newBucket = !_currentBar || barTime > _currentBar.time;
          if (priceChanged) _lastTickPrice = price;
          if (priceChanged || newBucket) {
            if (_currentBar && _currentBar.time === barTime) {
              _currentBar.close = price;
              _currentBar.high = Math.max(_currentBar.high, price);
              _currentBar.low = Math.min(_currentBar.low, price);
            } else {
              _currentBar = { time: barTime, open: price, high: price, low: price, close: price, volume: 0 };
            }
            onTick({ time: _currentBar.time, open: _currentBar.open, high: _currentBar.high, low: _currentBar.low, close: _currentBar.close, volume: _currentBar.volume });
          }
          // Delay UI updates ~300ms so price display syncs with TradingView candle repaint
          var _price = price, _pair = pair;
          setTimeout(function() {
          // Update native price on the token
          var pNative = _pair.priceNative ? parseFloat(_pair.priceNative) : 0;
          var qSym = _pair.quoteToken ? _pair.quoteToken.symbol.toUpperCase() : '';
          if (window._modalToken) {
            window._modalToken.price = _price;
            window._modalToken.priceNative = pNative;
            if (qSym) window._modalToken.quoteSymbol = qSym;
          }
          // Update modal price display
          var priceEl = document.getElementById('bmPriceBig');
          if (priceEl) {
            var prevPrice = parseFloat(priceEl.getAttribute('data-price')) || 0;
            priceEl.setAttribute('data-price', _price);
            priceEl.setAttribute('data-price-native', pNative);
            // Show in whichever currency is active
            if (_bmPriceCurrency === 'native' && pNative && window._modalToken) {
              var _ns = (window._modalToken.quoteSymbol) || _nativeTokenMap[(window._modalToken.net || 'solana').toLowerCase()] || 'SOL';
              priceEl.innerHTML = nativePriceFmt(pNative, _ns);
            } else {
              priceEl.innerHTML = dexPriceFmt(_price);
            }
            // Update browser tab title with mcap
            var _mc = _pair.marketCap || _pair.fdv || 0;
            var _bmOv = document.getElementById('bubbleModalOverlay');
            if (window._modalToken && _bmOv && _bmOv.classList.contains('open')) document.title = fmt(_mc) + ' | ' + (window._modalToken.sym || '') + ' — MemeScope';
            // Header glow
            var hdr = document.querySelector('.bm-header');
            if (hdr && prevPrice && _price !== prevPrice) {
              hdr.classList.remove('glow-up','glow-down');
              void hdr.offsetWidth; // reflow to restart animation
              hdr.classList.add(_price > prevPrice ? 'glow-up' : 'glow-down');
            }
          }
          // Update stats bar (mcap, vol, liq)
          var mcapEl = document.getElementById('bmMcap');
          var volEl = document.getElementById('bmVol');
          var liqEl = document.getElementById('bmLiq');
          if (mcapEl) mcapEl.textContent = fmt(_pair.marketCap || _pair.fdv || 0);
          if (volEl) volEl.textContent = fmt(_pair.volume ? (_pair.volume.h24 || 0) : 0);
          if (liqEl) liqEl.textContent = fmt(_pair.liquidity ? (_pair.liquidity.usd || 0) : 0);
          var supplyEl = document.getElementById('bmSupply');
          if (supplyEl && _pair.fdv && _price) supplyEl.textContent = fmtNum(Math.round(_pair.fdv / _price));
          }, 300);
          // Update percentage timeframes
          var pc = pair.priceChange || {};
          var _pFmt = function(v, id) {
            var el = document.getElementById(id);
            if (!el) return;
            v = Math.max(-9999, Math.min(9999, v || 0));
            el.textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
            el.style.color = v >= 0 ? 'var(--green)' : 'var(--red)';
          };
          _pFmt(pc.m5 ? parseFloat(pc.m5) : 0, 'bmTf5m');
          _pFmt(pc.h1 ? parseFloat(pc.h1) : 0, 'bmTf1h');
          _pFmt(pc.h6 ? parseFloat(pc.h6) : 0, 'bmTf6h');
          _pFmt(pc.h24 ? parseFloat(pc.h24) : 0, 'bmTf24h');
          // Keep buy/sell panel data fresh
          _bmBuySellData = { txns: pair.txns || {}, volume: pair.volume || {} };
          if (_bmActiveTf) renderBuySell(_bmActiveTf);
        } catch(e) {}
      }

      // Use Web Worker if available, fallback to setInterval
      if (_priceWorker) {
        _priceWorkerCallbacks[guid] = _handleTick;
        _priceWorker.postMessage({ type: 'subscribe', guid: guid, ca: t.ca, interval: 2000 });
      } else {
        var iv = setInterval(async function() {
          try { var d = await fetchDexToken(t.ca); _handleTick(d); } catch(e) {}
        }, 2000);
        window._bmSubIntervals = window._bmSubIntervals || {};
        window._bmSubIntervals[guid] = iv;
      }
    },
    unsubscribeBars: function(guid) {
      if (_priceWorker) {
        _priceWorker.postMessage({ type: 'unsubscribe', guid: guid });
        delete _priceWorkerCallbacks[guid];
      }
      if (window._bmSubIntervals && window._bmSubIntervals[guid]) {
        clearInterval(window._bmSubIntervals[guid]);
        delete window._bmSubIntervals[guid];
      }
    },
  };

  window._bmWidget = new TradingView.widget({
    container: 'bmTvChartContainer',
    locale: 'en',
    library_path: '/charting_library/',
    datafeed: datafeed,
    symbol: t.sym + '/' + (pairTokenMap2[chain] || 'SOL'),
    interval: '1',
    fullscreen: false,
    autosize: true,
    theme: 'dark',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    loading_screen: { backgroundColor: '#18171A', foregroundColor: '#4A9EFF' },
    overrides: {
      'paneProperties.background': '#18171A',
      'paneProperties.backgroundType': 'solid',
      'paneProperties.vertGridProperties.color': 'rgba(255,255,255,0.03)',
      'paneProperties.horzGridProperties.color': 'rgba(255,255,255,0.03)',
      'scalesProperties.backgroundColor': '#18171A',
      'scalesProperties.textColor': '#6B7685',
      'scalesProperties.lineColor': 'rgba(255,255,255,0.08)',
      'mainSeriesProperties.candleStyle.upColor': '#22C55E',
      'mainSeriesProperties.candleStyle.downColor': '#EF4444',
      'mainSeriesProperties.candleStyle.borderUpColor': '#22C55E',
      'mainSeriesProperties.candleStyle.borderDownColor': '#EF4444',
      'mainSeriesProperties.candleStyle.wickUpColor': 'rgba(34,197,94,0.5)',
      'mainSeriesProperties.candleStyle.wickDownColor': 'rgba(239,68,68,0.5)',
      'timeScale.rightOffset': 5,
    },
    studies_overrides: {
      'volume.volume.color.0': 'rgba(239,68,68,0.25)',
      'volume.volume.color.1': 'rgba(34,197,94,0.25)',
    },
    disabled_features: ['header_symbol_search','symbol_search_hot_key','header_compare','display_market_status','go_to_date','timeframes_toolbar','use_localstorage_for_settings'],
    enabled_features: ['side_toolbar_in_fullscreen_mode','header_in_fullscreen_mode','create_volume_indicator_by_default','items_favoriting'],
    favorites: { intervals: ['1','5','15','60','240','1D'], chartTypes: ['Candles','Line','Area'] },
  });

  // Hide custom loading overlay once TradingView iframe appears (TV spinner takes over)
  if (window._bmIframePoll) clearInterval(window._bmIframePoll);
  window._bmIframePoll = setInterval(function() {
    var iframe = container.querySelector('iframe');
    if (iframe) {
      clearInterval(window._bmIframePoll);
      window._bmIframePoll = null;
      var cl = document.getElementById('bmChartLoading');
      if (cl) cl.classList.add('hidden');
    }
  }, 50);
  setTimeout(function() { if (window._bmIframePoll) { clearInterval(window._bmIframePoll); window._bmIframePoll = null; } var cl3 = document.getElementById('bmChartLoading'); if (cl3) cl3.classList.add('hidden'); }, 15000);

  // Poll for chart readiness — just resize/paint, no view reset
  if (window._bmChartPoll) clearInterval(window._bmChartPoll);
  var _ck = t.ca + '_1';
  window._bmChartPoll = setInterval(function() {
    try {
      var iframe = container.querySelector('iframe');
      if (!iframe || !iframe.contentWindow || !iframe.contentWindow.chartWidget) return;
      var cw = iframe.contentWindow.chartWidget;
      cw.resize();
      cw.paint();
      if (_barCache[_ck] && _barCache[_ck].length > 0) {
        setTimeout(function() {
          try { if (iframe.contentWindow && iframe.contentWindow.chartWidget) { iframe.contentWindow.chartWidget.resize(); iframe.contentWindow.chartWidget.paint(); } } catch(e) {}
          clearInterval(window._bmChartPoll);
          window._bmChartPoll = null;
        }, 500);
      }
    } catch(e) { clearInterval(window._bmChartPoll); window._bmChartPoll = null; }
  }, 200);
  setTimeout(function() { if (window._bmChartPoll) { clearInterval(window._bmChartPoll); window._bmChartPoll = null; } }, 15000);
}

// Check URL on page load for direct token links
function checkUrlForToken() {
  var path = window.location.pathname;
  if(!path || path === '/') return;
  var parts = path.split('/').filter(function(p) { return p.length > 0; });
  if(parts.length < 2) return;
  var ca = parts[1];
  // Search in loaded tokens
  var found = LIVE_TOKENS.find(function(t) {
    return t.ca && t.ca.toLowerCase() === ca.toLowerCase();
  });
  if(found) {
    setTimeout(function() { openBubbleModal(found); }, 500);
  } else {
    // Not in feed — fetch from DexScreener
    fetchDexToken(ca)
      .then(function(data) {
        if(data.pairs && data.pairs.length > 0) {
          var p = data.pairs[0];
          var pc = p.priceChange || {};
          var t = {
            sym: p.baseToken ? p.baseToken.symbol.toUpperCase() : '???',
            name: p.baseToken ? p.baseToken.name : 'Unknown',
            img: (p.info && p.info.imageUrl) || '',
            price: p.priceUsd ? parseFloat(p.priceUsd) : 0,
            priceNative: p.priceNative ? parseFloat(p.priceNative) : 0,
            quoteSymbol: p.quoteToken ? p.quoteToken.symbol.toUpperCase() : '',
            mcap: p.marketCap || p.fdv || 0,
            vol: p.volume ? (p.volume.h24 || 0) : 0,
            liq: p.liquidity ? (p.liquidity.usd || 0) : 0,
            p5m: pc.m5 ? parseFloat(pc.m5) : 0,
            p1h: pc.h1 ? parseFloat(pc.h1) : 0,
            p6h: pc.h6 ? parseFloat(pc.h6) : 0,
            p24h: pc.h24 ? parseFloat(pc.h24) : 0,
            age: '\u2014', net: parts[0].toLowerCase(), ca: ca,
            pair: p.quoteToken ? p.quoteToken.symbol.toUpperCase() : '',
            website: (p.info && p.info.websites && p.info.websites[0]) ? p.info.websites[0].url : '',
            twitter: (p.info && p.info.socials) ? (function(){ var x = p.info.socials.filter(function(s){return s.type==='twitter';}); return x.length ? x[0].url : ''; })() : '',
          };
          setTimeout(function() { openBubbleModal(t); }, 500);
        }
      }).catch(function() {});
  }
}



var _candlePollTimer = null;





// Close on ESC
document.addEventListener("keydown", function(e) {
  if(e.key === "Escape") { closeBubbleModal(); closeBubbleFilter(); }
});

  // Dynamically size bubble section to fit exactly on desktop
  function sizeBubbleHero(){
    var hero = document.getElementById("bubbleHero");
    if(!hero || window.innerWidth <= 768) return;
    var topRel = 0, el = hero;
    while(el){ topRel += el.offsetTop; el = el.offsetParent; }
    hero.style.height = Math.max(300, Math.floor(window.innerHeight - topRel)) + "px";
  }
  sizeBubbleHero();
  window.addEventListener("resize", function(){ sizeBubbleHero(); });
  // Ensure page starts at top so bubbles fill the entire viewport
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener("load", function(){ window.scrollTo(0, 0); });


// ═══════════════════════════════════════
// TOKEN PAGE FUNCTIONS
// ═══════════════════════════════════════
var _tpToken = null;
var _tpWidget = null;
var _tpPollTimer = null;
var _tpPoolCache = {};

// Load TradingView Advanced Charts library on demand
var _tvLoading = false, _tvLoaded = false, _tvCallbacks = [];
function loadTradingView(cb) {
  if(_tvLoaded) { if(cb) cb(); return; }
  if(cb) _tvCallbacks.push(cb);
  if(_tvLoading) return;
  _tvLoading = true;
  var s = document.createElement('script');
  s.src = '/charting_library/charting_library.standalone.js';
  s.async = true;
  s.onload = function(){ _tvLoaded = true; _tvCallbacks.forEach(function(f){ f(); }); _tvCallbacks = []; };
  document.head.appendChild(s);
}

function openTokenPage(t) {
  if (!t) return;
  _tpToken = t;

  // Show token page (fixed overlay next to sidebar, below header)
  var tp = document.getElementById('tokenPage');
  if (tp) {
    // On mobile, go full screen (no header). On desktop, sit below header.
    var isMobile = window.innerWidth <= 900;
    var headerBar = document.querySelector('.top-header-bar');
    if (isMobile) {
      tp.style.top = '0';
      if (headerBar) headerBar.style.display = 'none';
    } else {
      var topOffset = headerBar ? headerBar.offsetHeight : 48;
      tp.style.top = topOffset + 'px';
    }
    tp.style.display = '';
  }
  // Hide filter bar, progress bar, and main content
  var filterBar = document.querySelector('.filter-bar');
  var refreshBar = document.querySelector('.refresh-progress-wrap');
  var bubbleHero = document.getElementById('bubbleHero');
  var tableContainer = document.querySelector('.table-container');
  var pagBar = document.querySelector('.pagination-bar');
  var disclaimer = document.querySelector('.disclaimer-footer');
  if (filterBar) filterBar.style.display = 'none';
  if (refreshBar) refreshBar.style.display = 'none';
  if (bubbleHero) bubbleHero.style.display = 'none';
  if (tableContainer) tableContainer.style.display = 'none';
  if (pagBar) pagBar.style.display = 'none';
  if (disclaimer) disclaimer.style.display = 'none';
  lockScroll();

  // Update URL
  var chain = (t.net || 'solana').toLowerCase();
  var ca = t.ca || '';
  if (ca) {
    try { history.pushState({ tokenPage: true, ca: ca, chain: chain }, '', '/' + chain + '/' + ca); } catch(e) {}
  }

  var pFmt = function(p) { return dexPriceFmt(p); };

  var ch = t.p24h || 0;

  // Populate right panel — banner
  var bannerImg = document.getElementById('tpRBannerImg');
  var bannerEmpty = document.getElementById('tpRBannerEmpty');
  bannerImg.style.display = 'none';
  bannerEmpty.style.display = '';
  var dsChainMap = { solana:'solana', eth:'ethereum', base:'base', bsc:'bsc', sui:'sui', tron:'tron' };
  var dsChain = dsChainMap[t.net] || t.net || 'solana';
  if (t.ca) {
    // Try DexScreener pair endpoint which includes token profile info
    fetchDexToken(t.ca)
      .then(function(data) {
        if (data && data.pairs && data.pairs.length > 0) {
          var info = data.pairs[0].info;
          if (info && info.header) {
            bannerImg.src = info.header;
            bannerImg.style.display = '';
            bannerEmpty.style.display = 'none';
          }
        }
      })
      .catch(function() { /* no banner available */ });
  }

  // Populate right panel — identity
  var av = document.getElementById('tpRAvatar');
  var modalChainColor = CHAIN_COLORS[t.net] || CHAIN_COLORS['solana'];
  av.style.outline = '1px solid ' + modalChainColor;
  if (t.img) av.innerHTML = '<img decoding="async" src="' + imgProxy(t.img, 128, 128) + '" onerror="this.parentElement.textContent=\'' + (t.sym||'?').charAt(0) + '\'">';
  else av.textContent = (t.sym||'?').charAt(0);
  if (t.boosted) { av.classList.add('boosted-avatar'); av.style.outline = 'none'; }
  else av.classList.remove('boosted-avatar');
  document.getElementById('tpRSym').textContent = t.sym || '???';
  document.getElementById('tpRName').textContent = t.name || t.sym || '';
  var chainNames = { solana:'Solana', eth:'Ethereum', base:'Base', bsc:'BSC', sui:'Sui', tron:'Tron' };
  document.getElementById('tpRChain').textContent = chainNames[t.net] || t.net || 'Solana';
  var ageEl = document.getElementById('tpRAgeBadge');
  var ageVal = fmtAge(t.age) || '';
  if (ageVal) { ageEl.textContent = ageVal; ageEl.style.display = ''; } else { ageEl.style.display = 'none'; }

  // Populate right panel — price
  document.getElementById('tpRPriceBig').innerHTML = pFmt(t.price);
  
  // Pair price (price in base token like WETH, SOL, etc.)
  var pairLabel = document.getElementById('tpRPairPriceLabel');
  var pairPrice = document.getElementById('tpRPricePair');
  var quoteToken = (t.pair || '').split('/')[1] || (t.net === 'solana' ? 'SOL' : t.net === 'eth' ? 'WETH' : t.net === 'base' ? 'WETH' : t.net === 'bsc' ? 'WBNB' : 'SOL');
  pairLabel.textContent = 'Price ' + quoteToken.trim();
  // Estimate pair price from USD price / quote price (placeholder)
  var quotePrices = { SOL:150, WETH:2400, WBNB:600, WSUI:1.2, TRX:0.12 };
  var qp = quotePrices[quoteToken.trim()] || 1;
  var pairPriceVal = t.price / qp;
  if (pairPriceVal >= 1) pairPrice.textContent = pairPriceVal.toFixed(4);
  else if (pairPriceVal >= 0.0001) pairPrice.textContent = pairPriceVal.toFixed(8);
  else pairPrice.textContent = pairPriceVal.toExponential(4);

  var fmt = function(n) {
    if (!n || n === 0) return '$0';
    if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  };
  document.getElementById('tpRMcap').textContent = fmt(t.mcap);
  document.getElementById('tpRLiq').textContent = fmt(t.liq);
  document.getElementById('tpRFdv').textContent = fmt(t.mcap); // fdv fallback
  document.getElementById('tpRVol').textContent = fmt(t.vol);

  // Timeframes
  var tfSet = function(id, val) {
    var el = document.getElementById(id);
    val = val || 0;
    el.textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
    el.style.color = val >= 0 ? 'var(--green)' : 'var(--red)';
  };
  tfSet('tpR5m', t.p5m);
  tfSet('tpR1h', t.p1h);
  tfSet('tpR6h', t.p6h);
  tfSet('tpR24h', t.p24h);

  // Txns
  var txns = t.txn || 0;
  var buys = t.buys || Math.round(txns * 0.6);
  var sells = t.sells || (txns - buys);
  document.getElementById('tpRTxnTotal').textContent = txns >= 1000 ? (txns/1000).toFixed(1) + 'K' : txns;
  document.getElementById('tpRBuys').textContent = buys.toLocaleString();
  document.getElementById('tpRSells').textContent = sells.toLocaleString();
  var buyPct = txns > 0 ? (buys / txns * 100) : 50;
  document.getElementById('tpRBuyBar').style.width = buyPct + '%';
  document.getElementById('tpRBuyVol').textContent = fmt(t.vol * (buyPct/100));
  document.getElementById('tpRSellVol').textContent = fmt(t.vol * (1 - buyPct/100));

  // CA
  document.getElementById('tpRCa').textContent = t.ca || '—';
  document.getElementById('tpRPairAge').textContent = fmtAge(t.age) || '—';
  document.getElementById('tpRDex').textContent = t.dex || '—';
  var pairTokenMap = { solana:'SOL', eth:'WETH', base:'WETH', bsc:'BNB', sui:'SUI', tron:'TRX', arbitrum:'WETH', avalanche:'WAVAX', polygon:'WMATIC', optimism:'WETH', blast:'WETH', ton:'TON', pulsechain:'PLS', seiv2:'WSEI' };
  document.getElementById('tpRPair').textContent = (t.sym || '???') + ' / ' + (pairTokenMap[t.net] || 'SOL');

  // Social links
  var webEl = document.getElementById('tpLinkWeb');
  webEl.style.display = t.website ? '' : 'none';
  webEl.href = t.website || '#';
  var xEl = document.getElementById('tpLinkX');
  xEl.href = t.twitter || ('https://x.com/search?q=%24' + t.sym);
  var tgEl = document.getElementById('tpLinkTg');
  tgEl.style.display = t.telegram ? '' : 'none';
  tgEl.href = t.telegram || '#';

  // Init chart — load TradingView on demand
  loadTradingView(function() { initTokenPageChart(t); });

  // Load demo txns for now
  loadTokenPageTxns(t);

  // Populate converter
  var convSym = document.getElementById('tpConvSym');
  if (convSym) convSym.textContent = t.sym || 'TOKEN';
  var convAmt = document.getElementById('tpConvAmt');
  var convUsd = document.getElementById('tpConvUsd');
  if (convAmt) convAmt.value = '';
  if (convUsd) convUsd.value = '';
}

function closeTokenPage() {
  var tp = document.getElementById('tokenPage');
  if (tp) tp.style.display = 'none';
  document.title = 'MemeScope — The Meme Coin Scope & Scanner';
  // Restore all hidden content
  var els = ['.filter-bar', '.refresh-progress-wrap', '#bubbleHero', '.table-container', '.pagination-bar', '.disclaimer-footer', '.top-header-bar'];
  els.forEach(function(sel) {
    var el = sel.startsWith('#') ? document.getElementById(sel.slice(1)) : document.querySelector(sel);
    if (el) el.style.display = '';
  });
  unlockScroll();
  // Re-sync the bubble canvas to the now-visible world (its buffer may be stale from
  // while the hero was display:none) so bubbles don't render huge/blurry on return.
  if (typeof resizeBubbles === 'function') resizeBubbles();
  if (window.wakeBubbles) window.wakeBubbles();

  // Destroy chart — kill chart poll, subscribeBars intervals, then widget
  if (window._tpChartPoll) { clearInterval(window._tpChartPoll); window._tpChartPoll = null; }
  if (window._tpSubIntervals) {
    Object.keys(window._tpSubIntervals).forEach(function(guid) {
      clearInterval(window._tpSubIntervals[guid]);
    });
    window._tpSubIntervals = {};
  }
  // Clean up worker subscriptions for token page
  if (_priceWorker) _priceWorker.postMessage({ type: 'unsubscribeAll' });
  _priceWorkerCallbacks = {};
  if (_tpWidget) { try { _tpWidget.remove(); } catch(e) {} _tpWidget = null; }
  // Clean up no-data overlay and poll
  if (window._tpNoDataPoll) { clearInterval(window._tpNoDataPoll); window._tpNoDataPoll = null; }
  var tpNoData = document.getElementById('tpNoDataOverlay');
  if (tpNoData) tpNoData.style.display = 'none';
  var tpChartEl = document.getElementById('tpChartContainer');
  if (tpChartEl) { tpChartEl.style.display = ''; tpChartEl.innerHTML = ''; }
  if (_tpPollTimer) { clearInterval(_tpPollTimer); _tpPollTimer = null; }
  if (_tpTxnTimer) { clearInterval(_tpTxnTimer); _tpTxnTimer = null; }

  // Clear bar cache for this token so next open gets fresh data
  if (_tpToken && _tpToken.ca) {
    Object.keys(_barCache).forEach(function(k) {
      if (k.indexOf(_tpToken.ca) === 0) delete _barCache[k];
    });
  }

  // Reset URL
  if (window.location.pathname !== '/') {
    try { history.replaceState({}, '', '/'); } catch(e) {}
  }
  _tpToken = null;
}

var _barCache = {};

function initTokenPageChart(t) {
  if (!window.TradingView || !t || !t.ca) return;
  var container = document.getElementById('tpChartContainer');
  if (!container) return;

  // Kill any leftover subscribeBars intervals and chart poll from previous widget
  if (window._tpChartPoll) { clearInterval(window._tpChartPoll); window._tpChartPoll = null; }
  if (window._tpSubIntervals) {
    Object.keys(window._tpSubIntervals).forEach(function(guid) {
      clearInterval(window._tpSubIntervals[guid]);
    });
    window._tpSubIntervals = {};
  }
  if (_priceWorker) _priceWorker.postMessage({ type: 'unsubscribeAll' });
  _priceWorkerCallbacks = {};
  if (_tpWidget) { try { _tpWidget.remove(); } catch(e) {} _tpWidget = null; }
  if (window._tpNoDataPoll) { clearInterval(window._tpNoDataPoll); window._tpNoDataPoll = null; }
  var tpNd = document.getElementById('tpNoDataOverlay');
  if (tpNd) tpNd.style.display = 'none';
  container.style.display = '';
  if (_tpPollTimer) { clearInterval(_tpPollTimer); _tpPollTimer = null; }
  container.innerHTML = '';

  var chain = (t.net || 'solana').toLowerCase();
  var pairTokenMap = { solana:'SOL', eth:'WETH', base:'WETH', bsc:'BNB', sui:'SUI', tron:'TRX', arbitrum:'WETH', avalanche:'WAVAX', polygon:'WMATIC', optimism:'WETH', blast:'WETH', ton:'TON', pulsechain:'PLS', seiv2:'WSEI' };
  var geckoChainMap = { solana:'solana', eth:'eth', base:'base', bsc:'bsc', sui:'sui-network', tron:'tron', arbitrum:'arbitrum', avalanche:'avax', polygon:'polygon_pos', optimism:'optimism', blast:'blast', ton:'ton', pulsechain:'pulsechain', seiv2:'sei-evm', sonic:'sonic', hyperliquid:'hyperliquid', berachain:'berachain', monad:'monad', cronos:'cro', aptos:'aptos', linea:'linea', zksync:'zksync', fantom:'ftm', mantle:'mantle', scroll:'scroll', manta:'manta-pacific', starknet:'starknet-alpha' };
  var dexChainMap2 = { solana:'solana', eth:'ethereum', base:'base', bsc:'bsc', sui:'sui', tron:'tron', arbitrum:'arbitrum', avalanche:'avalanche', polygon:'polygon', optimism:'optimism', blast:'blast', ton:'ton', pulsechain:'pulsechain', seiv2:'seiv2' };
  var geckoNet = geckoChainMap[chain] || chain;
  var dexNet = dexChainMap2[chain] || chain;

  // Discover pool from browser — DexScreener first, GeckoTerminal fallback, in parallel
  function _discoverPool(cb) {
    if (t._discoveredPool) { cb(t._discoveredPool); return; }
    if (t.pairAddress) { t._discoveredPool = t.pairAddress; cb(t.pairAddress); return; }
    var done = false;
    // DexScreener
    fetchDexToken(t.ca).then(function(d){
      if (done) return;
      if (d && d.pairs && d.pairs.length) {
        var cp = d.pairs.filter(function(p){return p.chainId === dexNet});
        var best = (cp.length ? cp : d.pairs).reduce(function(b,p){return (p.liquidity&&p.liquidity.usd||0)>(b.liquidity&&b.liquidity.usd||0)?p:b},(cp.length?cp:d.pairs)[0]);
        if (best.pairAddress) { done = true; t._discoveredPool = best.pairAddress; cb(best.pairAddress); }
      }
    }).catch(function(){});
    // GeckoTerminal fallback
    geckoFetch('https://api.geckoterminal.com/api/v2/networks/'+geckoNet+'/tokens/'+t.ca+'/pools?page=1',{headers:{'Accept':'application/json'}}).then(function(r){return r.json()}).then(function(d){
      if (done) return;
      if (d && d.data && d.data.length) {
        var poolId = d.data[0].attributes && d.data[0].attributes.address;
        if (!poolId) { var pts = d.data[0].id.split('_'); poolId = pts.length > 1 ? pts.slice(1).join('_') : d.data[0].id; }
        if (poolId) { done = true; t._discoveredPool = poolId; cb(poolId); }
      }
    }).catch(function(){});
    // Timeout after 8s
    setTimeout(function(){ if (!done) { done = true; cb(null); } }, 8000);
  }

  var datafeed = {
    onReady: function(cb) {
      setTimeout(function() {
        cb({ supported_resolutions:['1','5','15','30','60','240','1D'], supports_time:true });
      }, 0);
    },
    searchSymbols: function(q,e,st,cb) { cb([]); },
    resolveSymbol: function(name, onRes, onErr) {
      setTimeout(function() {
        var p = t.price || 0.00001;
        var ps = 100;
        if (p < 1) ps = 10000;
        if (p < 0.01) ps = 1000000;
        if (p < 0.0001) ps = 100000000;
        if (p < 0.000001) ps = 10000000000;
        onRes({
          name: t.sym + '/' + (pairTokenMap[chain] || 'SOL'),
          description: t.name || t.sym,
          type: 'crypto',
          session: '24x7',
          exchange: 'memescope.io',
          timezone: 'Etc/UTC',
          format: 'price',
          pricescale: ps,
          minmov: 1,
          has_intraday: true,
          supported_resolutions: ['1','5','15','30','60','240','1D'],
          volume_precision: 2,
          data_status: 'streaming',
        });
      }, 0);
    },
    getBars: function(sym, res, params, onRes, onErr) {
      if (params.firstDataRequest === false) { onRes([], { noData: true }); return; }

      var cacheKey = t.ca + '_' + res;
      if (_barCache[cacheKey]) { onRes(_barCache[cacheKey], { noData: _barCache[cacheKey].length === 0 }); return; }

      var resMap = {'1':{agg:'minute',mult:1},'5':{agg:'minute',mult:5},'15':{agg:'minute',mult:15},'30':{agg:'minute',mult:30},'60':{agg:'hour',mult:1},'240':{agg:'hour',mult:4},'1D':{agg:'day',mult:1}};
      var rc = resMap[res] || resMap['1'];
      var resMin = parseInt(res);
      var resMs = (!isNaN(resMin) ? resMin : 1) * 60000;
      if (res === '1D') resMs = 86400000;

      // Fallback: seed bars from DexScreener live price when no OHLCV available
      function _seedFromLivePrice2() {
        // Show "no data" overlay with live price instead of fake seed bars
        var overlay = document.getElementById('tpNoDataOverlay');
        var chartArea = document.getElementById('tpChartContainer');
        if (chartArea) chartArea.style.display = 'none';
        if (overlay) overlay.style.display = 'flex';
        onRes([], { noData: true });
      }
      _discoverPool(function(pool) {
        if (!pool) { _seedFromLivePrice2(); return; }
        var url = 'https://api.geckoterminal.com/api/v2/networks/'+geckoNet+'/pools/'+pool+'/ohlcv/'+rc.agg+'?aggregate='+rc.mult+'&limit=1000&currency=usd';
        var attempt = 0;
        function tryFetch() {
          attempt++;
          var ctrl = new AbortController();
          var tid = setTimeout(function(){ ctrl.abort(); }, 12000);
          geckoFetch(url,{headers:{'Accept':'application/json'},signal:ctrl.signal}).then(function(r){
            clearTimeout(tid);
            if (r.status === 429 || r.status === 403) {
              if (attempt < 5) { setTimeout(tryFetch, attempt * 2000); return; }
              _seedFromLivePrice2(); return;
            }
            return r.json();
          }).then(function(d){
            if (!d) return;
            var list = d && d.data && d.data.attributes && d.data.attributes.ohlcv_list;
            if (!list || !list.length) {
              _seedFromLivePrice2();
              return;
            }
            var seen = {};
            var bars = [];
            for (var i = 0; i < list.length; i++) {
              var c = list[i];
              var tm = c[0] * 1000;
              tm = Math.floor(tm / resMs) * resMs;
              if (!tm || seen[tm]) continue;
              seen[tm] = true;
              bars.push({ time: tm, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] });
            }
            bars.sort(function(a,b){ return a.time - b.time; });
            // Place live candle RIGHT AFTER last OHLCV bar (eliminates time gap)
            function _finishBars(livePrice) {
              if (bars.length > 0 && livePrice) {
                var last = bars[bars.length - 1];
                var nextSlot = last.time + resMs;
                var nowBucket = Math.floor(Date.now() / resMs) * resMs;
                console.log('[TOKEN CHART] Last OHLCV:', new Date(last.time).toISOString(),
                  '| now:', new Date(nowBucket).toISOString(),
                  '| gap:', Math.round((nowBucket - last.time) / 60000), 'min',
                  '| OHLCV close:', last.close, '| live:', livePrice);
                bars.push({ time: nextSlot, open: last.close, high: Math.max(last.close, livePrice), low: Math.min(last.close, livePrice), close: livePrice, volume: 0 });
              }
              _barCache[cacheKey] = bars;
              onRes(bars, { noData: bars.length === 0 });
            }
            // Use SAME pair selection as subscribeBars (highest liquidity, not pairs[0])
            fetchDexToken(t.ca).then(function(dexData) {
              var lp = bars.length > 0 ? bars[bars.length - 1].close : 0;
              if (dexData && dexData.pairs && dexData.pairs.length) {
                var bestPair = dexData.pairs.reduce(function(b,p) { return (p.liquidity&&p.liquidity.usd||0) > (b.liquidity&&b.liquidity.usd||0) ? p : b; }, dexData.pairs[0]);
                var p = parseFloat(bestPair.priceUsd);
                if (p) lp = p;
              }
              _finishBars(lp);
            }).catch(function() {
              _finishBars(bars.length > 0 ? bars[bars.length - 1].close : 0);
            });
          }).catch(function(){
            clearTimeout(tid);
            if (attempt < 5) { setTimeout(tryFetch, attempt * 2000); return; }
            _seedFromLivePrice2();
          });
        }
        tryFetch();
      });
    },
    subscribeBars: function(sym, res, onTick, guid) {
      var resMin = parseInt(res);
      var resMs = (!isNaN(resMin) ? resMin : 1) * 60000;
      if (res === '1D') resMs = 86400000;
      var _currentBar = null;
      var cacheKey = t.ca + '_' + res;
      if (_barCache[cacheKey] && _barCache[cacheKey].length) {
        var lastBar = _barCache[cacheKey][_barCache[cacheKey].length - 1];
        _currentBar = { time: lastBar.time, open: lastBar.open, high: lastBar.high, low: lastBar.low, close: lastBar.close, volume: lastBar.volume };
      }
      var _lastTickPrice = _currentBar ? _currentBar.close : 0;

      function _handleTick(d) {
        try {
          if (!d.pairs || !d.pairs.length) return;
          var pair = d.pairs.reduce(function(b,p) { return (p.liquidity&&p.liquidity.usd||0) > (b.liquidity&&b.liquidity.usd||0) ? p : b; }, d.pairs[0]);
          var price = parseFloat(pair.priceUsd);
          if (!price) return;
          var barTime = Math.floor(Date.now() / resMs) * resMs;
          var priceChanged = price !== _lastTickPrice;
          var newBucket = !_currentBar || barTime > _currentBar.time;
          if (priceChanged) _lastTickPrice = price;
          if (priceChanged || newBucket) {
            if (_currentBar && _currentBar.time === barTime) {
              _currentBar.close = price;
              _currentBar.high = Math.max(_currentBar.high, price);
              _currentBar.low = Math.min(_currentBar.low, price);
            } else {
              _currentBar = { time: barTime, open: price, high: price, low: price, close: price, volume: 0 };
            }
            onTick({ time: _currentBar.time, open: _currentBar.open, high: _currentBar.high, low: _currentBar.low, close: _currentBar.close, volume: _currentBar.volume });
          }
          var _p = price, _pr = pair;
          setTimeout(function() {
            var el = document.getElementById('tpRPriceBig');
            if (el) el.innerHTML = dexPriceFmt(_p);
            // Update browser tab title with mcap
            var _mc = _pr.marketCap || _pr.fdv || 0;
            var _tpEl = document.getElementById('tokenPage');
            if (_tpToken && _tpEl && _tpEl.style.display !== 'none') document.title = fmt(_mc) + ' | ' + (_tpToken.sym || '') + ' — MemeScope';
          }, 300);
        } catch(e) {}
      }

      // Use Web Worker if available, fallback to setInterval
      if (_priceWorker) {
        _priceWorkerCallbacks[guid] = _handleTick;
        _priceWorker.postMessage({ type: 'subscribe', guid: guid, ca: t.ca, interval: 2000 });
      } else {
        var iv = setInterval(async function() {
          try { var d = await fetchDexToken(t.ca); _handleTick(d); } catch(e) {}
        }, 2000);
        window._tpSubIntervals = window._tpSubIntervals || {};
        window._tpSubIntervals[guid] = iv;
      }
    },
    unsubscribeBars: function(guid) {
      if (_priceWorker) {
        _priceWorker.postMessage({ type: 'unsubscribe', guid: guid });
        delete _priceWorkerCallbacks[guid];
      }
      if (window._tpSubIntervals && window._tpSubIntervals[guid]) {
        clearInterval(window._tpSubIntervals[guid]);
        delete window._tpSubIntervals[guid];
      }
    },
  };

  _tpWidget = new TradingView.widget({
    container: 'tpChartContainer',
    locale: 'en',
    library_path: '/charting_library/',
    datafeed: datafeed,
    symbol: t.sym + '/' + (pairTokenMap[chain] || 'SOL'),
    interval: '1',
    fullscreen: false,
    autosize: true,
    theme: 'dark',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    loading_screen: { backgroundColor: '#18171A', foregroundColor: '#4A9EFF' },
    overrides: {
      'paneProperties.background': '#18171A',
      'paneProperties.backgroundType': 'solid',
      'paneProperties.vertGridProperties.color': 'rgba(255,255,255,0.03)',
      'paneProperties.horzGridProperties.color': 'rgba(255,255,255,0.03)',
      'scalesProperties.backgroundColor': '#18171A',
      'scalesProperties.textColor': '#6B7685',
      'scalesProperties.lineColor': 'rgba(255,255,255,0.08)',
      'mainSeriesProperties.candleStyle.upColor': '#22C55E',
      'mainSeriesProperties.candleStyle.downColor': '#EF4444',
      'mainSeriesProperties.candleStyle.borderUpColor': '#22C55E',
      'mainSeriesProperties.candleStyle.borderDownColor': '#EF4444',
      'mainSeriesProperties.candleStyle.wickUpColor': 'rgba(34,197,94,0.5)',
      'mainSeriesProperties.candleStyle.wickDownColor': 'rgba(239,68,68,0.5)',
      'timeScale.rightOffset': 5,
    },
    studies_overrides: {
      'volume.volume.color.0': 'rgba(239,68,68,0.25)',
      'volume.volume.color.1': 'rgba(34,197,94,0.25)',
    },
    disabled_features: ['header_symbol_search','symbol_search_hot_key','header_compare','display_market_status','go_to_date','timeframes_toolbar','use_localstorage_for_settings'],
    enabled_features: ['side_toolbar_in_fullscreen_mode','header_in_fullscreen_mode','create_volume_indicator_by_default','items_favoriting'],
    favorites: { intervals: ['1','5','15','60','240','1D'], chartTypes: ['Candles','Line','Area'] },
  });

  // Poll for chart readiness — just resize/paint, no view reset
  if (window._tpChartPoll) clearInterval(window._tpChartPoll);
  var _cacheKey = t.ca + '_1';
  window._tpChartPoll = setInterval(function() {
    try {
      var iframe = container.querySelector('iframe');
      if (!iframe || !iframe.contentWindow || !iframe.contentWindow.chartWidget) return;
      var cw = iframe.contentWindow.chartWidget;
      cw.resize();
      cw.paint();
      if (_barCache[_cacheKey] && _barCache[_cacheKey].length > 0) {
        setTimeout(function() {
          try {
            if (iframe.contentWindow && iframe.contentWindow.chartWidget) {
              iframe.contentWindow.chartWidget.resize();
              iframe.contentWindow.chartWidget.paint();
            }
          } catch(e) {}
          clearInterval(window._tpChartPoll);
          window._tpChartPoll = null;
        }, 500);
      }
    } catch(e) { clearInterval(window._tpChartPoll); window._tpChartPoll = null; }
  }, 200);
  setTimeout(function() { if (window._tpChartPoll) { clearInterval(window._tpChartPoll); window._tpChartPoll = null; } }, 15000);
}

// Pool lookup and OHLCV fetching now handled server-side via /api/ohlcv

function tpSwitchTab(el, tab) {
  document.querySelectorAll('.tp-tab').forEach(function(t) { t.classList.remove('active'); });
  el.classList.add('active');
  ['txns','traders','holders','bubblemaps'].forEach(function(id) {
    var pane = document.getElementById('tpPane' + id.charAt(0).toUpperCase() + id.slice(1));
    if (pane) pane.style.display = (id === tab || (id==='txns' && tab==='txns')) ? '' : 'none';
  });
  // Fix pane IDs
  document.getElementById('tpPaneTxns').style.display = tab === 'txns' ? '' : 'none';
  document.getElementById('tpPaneTraders').style.display = tab === 'traders' ? '' : 'none';
  document.getElementById('tpPaneHolders').style.display = tab === 'holders' ? '' : 'none';
  document.getElementById('tpPaneBubblemaps').style.display = tab === 'bubblemaps' ? '' : 'none';
}

function tpCopyCA() {
  if (!_tpToken || !_tpToken.ca) return;
  navigator.clipboard.writeText(_tpToken.ca).then(function() {
    var btn = document.querySelector('.tp-r-ca-copy');
    if (btn) { btn.textContent = 'Copied!'; btn.style.color = 'var(--green)'; setTimeout(function() { btn.textContent = 'Copy'; btn.style.color = ''; }, 1500); }
  });
}

function tpToggleWatchlist() {
  if (!_tpToken) return;
  if (typeof toggleWatchlist === 'function') toggleWatchlist(_tpToken.sym);
}

function tpShare() {
  if (navigator.share && _tpToken) {
    navigator.share({ title: _tpToken.sym + ' on MemeScope', url: window.location.href });
  } else {
    navigator.clipboard.writeText(window.location.href);
  }
}

// Price converter calculator
function tpCalcConv(dir) {
  var price = _tpToken ? _tpToken.price : 0;
  if (!price) return;
  if (dir === 'token') {
    var amt = parseFloat(document.getElementById('tpConvAmt').value) || 0;
    document.getElementById('tpConvUsd').value = amt ? (amt * price).toFixed(2) : '';
  } else {
    var usd = parseFloat(document.getElementById('tpConvUsd').value) || 0;
    document.getElementById('tpConvAmt').value = usd ? Math.floor(usd / price).toLocaleString() : '';
  }
}

var _tpTxnTimer = null;

function loadTokenPageTxns(t) {
  if (_tpTxnTimer) { clearInterval(_tpTxnTimer); _tpTxnTimer = null; }
  var amtH = document.getElementById('tpTxnAmtHeader');
  if (amtH) amtH.textContent = (t.sym || t.ticker || t.symbol || 'Amount').toUpperCase();
  _fetchAndRenderTxns(t);
  // Auto-refresh every 4 seconds
  _tpTxnTimer = setInterval(function() { _fetchAndRenderTxns(t); }, 4000);
}

function _fetchAndRenderTxns(t) {
  var body = document.getElementById('tpTxnBody');
  if (!body) return;
  var chain = (t.net || 'solana').toLowerCase();
  var geckoChainMap2 = { solana:'solana', eth:'eth', base:'base', bsc:'bsc', sui:'sui-network', tron:'tron', arbitrum:'arbitrum', avalanche:'avax', polygon:'polygon_pos', optimism:'optimism', blast:'blast', ton:'ton', pulsechain:'pulsechain', seiv2:'sei-evm', sonic:'sonic', hyperliquid:'hyperliquid', berachain:'berachain', monad:'monad', cronos:'cro', aptos:'aptos', linea:'linea', zksync:'zksync', fantom:'ftm', mantle:'mantle', scroll:'scroll', manta:'manta-pacific', starknet:'starknet-alpha' };
  var dexChainMap3 = { solana:'solana', eth:'ethereum', base:'base', bsc:'bsc', sui:'sui', tron:'tron', arbitrum:'arbitrum', avalanche:'avalanche', polygon:'polygon', optimism:'optimism', blast:'blast', ton:'ton', pulsechain:'pulsechain', seiv2:'seiv2' };
  var gNet = geckoChainMap2[chain] || chain;
  var dNet = dexChainMap3[chain] || chain;

  var explorerMap = {
    solana: 'https://solscan.io/tx/',
    eth: 'https://etherscan.io/tx/',
    base: 'https://basescan.org/tx/',
    bsc: 'https://bscscan.com/tx/',
    sui: 'https://suiscan.xyz/tx/',
    tron: 'https://tronscan.org/#/transaction/',
  };
  var makerExplorerMap = {
    solana: 'https://solscan.io/account/',
    eth: 'https://etherscan.io/address/',
    base: 'https://basescan.org/address/',
    bsc: 'https://bscscan.com/address/',
    sui: 'https://suiscan.xyz/account/',
    tron: 'https://tronscan.org/#/address/',
  };
  var explorerBase = explorerMap[chain] || explorerMap.solana;
  var makerBase = makerExplorerMap[chain] || makerExplorerMap.solana;

  // Discover pool then fetch trades directly from GeckoTerminal
  function _doFetch(pool) {
    if (!pool) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px">No pool found</td></tr>'; return; }
    var url = 'https://api.geckoterminal.com/api/v2/networks/'+gNet+'/pools/'+pool+'/trades?trade_volume_in_usd_greater_than=0';
    var ctrl = new AbortController();
    var tid = setTimeout(function(){ ctrl.abort(); }, 8000);
    geckoFetch(url,{headers:{'Accept':'application/json'},signal:ctrl.signal}).then(function(r){clearTimeout(tid);return r.json()}).then(function(d){
      var raw = (d && d.data) || [];
      if (!raw.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px">No trades found</td></tr>'; return; }
      var html = '';
      for (var i = 0; i < raw.length; i++) {
        var a = raw[i].attributes || {};
        var isBuy = a.kind === 'buy';
        var color = isBuy ? 'var(--green)' : 'var(--red)';
        var txDate = a.block_timestamp ? new Date(a.block_timestamp) : null;
        var dateStr = '';
        if (txDate) {
          var mm = txDate.getMonth() + 1, dd = txDate.getDate(), hh = txDate.getHours(), mi = txDate.getMinutes(), ss = txDate.getSeconds();
          var ampm = hh >= 12 ? 'PM' : 'AM', h12 = hh % 12 || 12;
          dateStr = mm + '/' + dd + ' ' + h12 + ':' + (mi < 10 ? '0' : '') + mi + ':' + (ss < 10 ? '0' : '') + ss + ' ' + ampm;
        }
        var volUsd = parseFloat(a.volume_in_usd || 0);
        var amtBase = parseFloat(a.from_token_amount || 0);
        var price = volUsd && amtBase ? volUsd / amtBase : 0;
        var pFmt = price >= 1 ? '$' + price.toFixed(2) : price >= 0.01 ? '$' + price.toFixed(4) : price >= 0.0001 ? '$' + price.toFixed(6) : '$' + price.toFixed(8);
        var amtStr = amtBase >= 1e6 ? (amtBase / 1e6).toFixed(1) + 'M' : amtBase >= 1e3 ? Math.floor(amtBase).toLocaleString() : amtBase.toFixed(1);
        var totalStr = volUsd >= 1000 ? '$' + (volUsd / 1000).toFixed(1) + 'K' : '$' + volUsd.toFixed(2);
        var maker = a.tx_from_address || '';
        var makerShort = maker.length > 8 ? maker.slice(0, 4) + '...' + maker.slice(-3) : maker;
        var txLink = a.tx_hash ? explorerBase + a.tx_hash : '#';
        var makerLink = maker ? makerBase + maker : '#';
        html += '<tr><td>' + dateStr + '</td><td style="color:' + color + '">' + (isBuy ? 'Buy' : 'Sell') + '</td><td style="color:' + color + '">' + pFmt + '</td><td style="color:' + color + '">' + amtStr + '</td><td style="color:' + color + '">' + totalStr + '</td><td style="color:var(--text-secondary)"><a href="' + makerLink + '" target="_blank" style="color:inherit;text-decoration:none">' + makerShort + '</a></td><td><a class="tp-txn-link" href="' + txLink + '" target="_blank"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a></td></tr>';
      }
      body.innerHTML = html;
    }).catch(function(){
      clearTimeout(tid);
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px">Failed to load trades</td></tr>';
    });
  }

  // Use cached pool or discover
  if (t._discoveredPool) {
    _doFetch(t._discoveredPool);
  } else {
    // Quick pool discovery from DexScreener
    fetchDexToken(t.ca).then(function(d){
      if (d && d.pairs && d.pairs.length) {
        var cp = d.pairs.filter(function(p){return p.chainId === dNet});
        var best = (cp.length ? cp : d.pairs).reduce(function(b,p){return (p.liquidity&&p.liquidity.usd||0)>(b.liquidity&&b.liquidity.usd||0)?p:b},(cp.length?cp:d.pairs)[0]);
        if (best.pairAddress) { t._discoveredPool = best.pairAddress; _doFetch(best.pairAddress); return; }
      }
      // Fallback: GeckoTerminal pool discovery
      geckoFetch('https://api.geckoterminal.com/api/v2/networks/'+gNet+'/tokens/'+t.ca+'/pools?page=1',{headers:{'Accept':'application/json'}}).then(function(r2){return r2.json()}).then(function(d2){
        if (d2 && d2.data && d2.data.length) {
          var poolId = d2.data[0].attributes && d2.data[0].attributes.address;
          if (!poolId) { var pts = d2.data[0].id.split('_'); poolId = pts.length > 1 ? pts.slice(1).join('_') : d2.data[0].id; }
          if (poolId) { t._discoveredPool = poolId; _doFetch(poolId); return; }
        }
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px">No pool found</td></tr>';
      }).catch(function(){ body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px">Failed to load trades</td></tr>'; });
    }).catch(function(){ body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px">Failed to load trades</td></tr>'; });
  }
}

// Bottom panel resize — drag handle to resize chart, bottom fills remaining
(function(){
  var handle = document.getElementById('tpResizeHandle');
  if (!handle) return;
  var startY, startH;
  handle.addEventListener('mousedown', function(e) {
    var chart = document.getElementById('tpChartContainer');
    if (!chart) return;
    startY = e.clientY;
    startH = chart.offsetHeight;
    document.addEventListener('mousemove', onM);
    document.addEventListener('mouseup', onU);
    e.preventDefault();
  });
  function onM(e) {
    var chart = document.getElementById('tpChartContainer');
    if (!chart) return;
    var newH = startH + (e.clientY - startY);
    newH = Math.max(150, Math.min(window.innerHeight - 200, newH));
    chart.style.height = newH + 'px';
    chart.style.flex = 'none';
  }
  function onU() {
    document.removeEventListener('mousemove', onM);
    document.removeEventListener('mouseup', onU);
  }
})();

// Handle back button for token page
window.addEventListener('popstate', function() {
  var tp = document.getElementById('tokenPage');
  if (tp && tp.style.display !== 'none') {
    closeTokenPage();
  }
});

// ========== LIVE DATA ==========
var LIVE_MODE = true;
var liveDataLoaded = false;
// Cloudflare Worker API (reads from Supabase, populated by scraper cron)
var MEMESCOPE_API = '/api/tokens';

function updateBubbleData(newTokens) {}

// Live-verify ALL tokens against DexScreener — remove rugged ones, update prices
var _verifyInProgress = false;
var _ruggedCas = {}; // temp blacklist: CA -> timestamp (expires after 5 min)
var _RUGGED_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes — tokens get a second chance

function isRugged(ca) {
  if (!_ruggedCas[ca]) return false;
  if (Date.now() - _ruggedCas[ca] > _RUGGED_EXPIRY_MS) {
    delete _ruggedCas[ca]; // expired — let it back in
    return false;
  }
  return true;
}

async function verifyTopTokens(skipBubbleRender) {
  if (_verifyInProgress) return;
  _verifyInProgress = true;
  try {
    // Get all tokens with contract addresses
    var toVerify = LIVE_TOKENS.filter(function(t) { return t.ca && t.ca.length > 5; });
    if (toVerify.length === 0) { _verifyInProgress = false; return; }

    // Build lookup of all pairs from DexScreener (parallel batches of 30)
    var pairByCa = {};
    var allCas = toVerify.map(function(t) { return t.ca; });
    var batchSize = 30;
    var chunks = [];
    for (var b = 0; b < allCas.length; b += batchSize) {
      chunks.push(allCas.slice(b, b + batchSize));
    }

    var results = await Promise.allSettled(chunks.map(function(chunk) {
      return fetch('https://api.dexscreener.com/latest/dex/tokens/' + chunk.join(','))
        .then(function(resp) { return resp.ok ? resp.json() : null; });
    }));

    for (var r = 0; r < results.length; r++) {
      if (results[r].status !== 'fulfilled' || !results[r].value || !results[r].value.pairs) continue;
      var pairs = results[r].value.pairs;
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i];
        var ca = p.baseToken ? p.baseToken.address : null;
        if (!ca) continue;
        var existingLiq = pairByCa[ca] && pairByCa[ca].liquidity ? (pairByCa[ca].liquidity.usd || 0) : 0;
        var newLiq = p.liquidity ? (p.liquidity.usd || 0) : 0;
        if (!pairByCa[ca] || newLiq > existingLiq) {
          pairByCa[ca] = p;
        }
      }
    }

    // Build set of CAs we actually sent to DexScreener
    var sentCas = {};
    for (var s = 0; s < allCas.length; s++) sentCas[allCas[s]] = true;

    // Update or remove tokens
    var removed = 0;
    for (var j = LIVE_TOKENS.length - 1; j >= 0; j--) {
      var t = LIVE_TOKENS[j];
      if (!t.ca) continue;

      // If we sent this CA to DexScreener but got NO pair back = likely dead
      if (sentCas[t.ca] && !pairByCa[t.ca]) {
        if (_isAdminBoosted(t.ca)) continue; // never remove admin-boosted tokens
        _ruggedCas[t.ca] = Date.now(); // temp blacklist with timestamp
        LIVE_TOKENS.splice(j, 1);
        removed++;
        continue;
      }

      if (!pairByCa[t.ca]) continue;
      var pair = pairByCa[t.ca];
      var liq = pair.liquidity ? (pair.liquidity.usd || 0) : 0;
      var price = pair.priceUsd ? parseFloat(pair.priceUsd) : 0;
      var mcap = pair.marketCap || pair.fdv || 0;

      // Only remove truly dead tokens (zero price = confirmed rug)
      // Lowered thresholds: memecoins naturally dip in liq/mcap temporarily
      if (price === 0 || liq < 500 || mcap < 1000) {
        if (_isAdminBoosted(t.ca)) continue; // never remove admin-boosted tokens
        _ruggedCas[t.ca] = Date.now(); // temp blacklist with timestamp
        LIVE_TOKENS.splice(j, 1);
        removed++;
        continue;
      }

      // Update with live data
      t.price = price;
      t.mcap = mcap;
      t.liq = liq;
      t.vol = pair.volume ? (pair.volume.h24 || 0) : t.vol;
      var pc = pair.priceChange || {};
      t.p5m = pc.m5 ? parseFloat(pc.m5) : t.p5m;
      t.p1h = pc.h1 ? parseFloat(pc.h1) : t.p1h;
      t.p6h = pc.h6 ? parseFloat(pc.h6) : t.p6h;
      t.p24h = pc.h24 ? parseFloat(pc.h24) : t.p24h;
      if (pair.priceNative) t.priceNative = parseFloat(pair.priceNative);
      if (pair.quoteToken) t.quoteSymbol = pair.quoteToken.symbol.toUpperCase();
    }

    console.log('MemeScope: Verified', Object.keys(pairByCa).length, 'tokens, removed', removed, 'rugged, blacklist size:', Object.keys(_ruggedCas).length);
    _applyAdminBoosts(LIVE_TOKENS);
    loadData();
    if (!skipBubbleRender && typeof updateBubblesSmooth === 'function') updateBubblesSmooth();
  } catch (e) {
    console.log('MemeScope: Verify error', e);
  }
  _verifyInProgress = false;
}

async function fetchLiveTokens() {
  try {
    // Show app shell immediately with skeleton rows — don't wait for data
    if (!window._firstLoadDone) {
      var app = document.querySelector('.app');
      if (app && !app.classList.contains('ready')) {
        loadData(); // renders skeleton rows
        app.classList.add('ready');
        var ls = document.getElementById('loadingScreen');
        if (ls) { ls.style.opacity = '0'; setTimeout(function() { ls.remove(); }, 400); }
      }
    }
    console.log('MemeScope: Fetching...');
    showFetchingProgress();
    
    // If API is configured, use it (fast, 500+ tokens)
    if(MEMESCOPE_API) {
      try {
        // Use early fetch if available (started in <head>), otherwise fetch now
        var data = null;
        if(window._earlyTokens) {
          data = await window._earlyTokens;
          window._earlyTokens = null; // only use once
        }
        if(!data) {
          var resp = await fetch(MEMESCOPE_API);
          if(resp.ok) data = await resp.json();
        }
        if(data) {
          if(data.tokens && data.tokens.length > 0) {
            var isFirstLoad = !liveDataLoaded;
            liveDataLoaded = true;

            // Dismiss loading screen on first data load
            if (isFirstLoad) {
              var loader = document.getElementById('loadingScreen');
              if (loader) { loader.style.opacity = '0'; setTimeout(function() { loader.remove(); }, 400); }
            }

            // 1) Dedup incoming payload (by ca, then by symbol keeping highest volume)
            var seenCa = {};
            var seenSym = {};
            var incoming = [];
            for(var i = 0; i < data.tokens.length; i++) {
              var tk = data.tokens[i];
              var ca = tk.ca || tk.sym;
              if(seenCa[ca]) continue;
              if(isRugged(ca) && !_isAdminBoosted(ca)) continue; // skip blacklisted tokens, but never skip admin-boosted
              seenCa[ca] = true;
              var sym = (tk.sym || '').toUpperCase();
              var _isBoostedTk = !!_isAdminBoosted(ca);
              if(seenSym[sym]) {
                var _prevBoosted = !!_isAdminBoosted(seenSym[sym].ca || seenSym[sym].sym);
                // Boosted token always wins symbol dedup; otherwise higher volume wins
                if(_isBoostedTk && !_prevBoosted) { /* current wins, fall through */ }
                else if(!_isBoostedTk && _prevBoosted) { continue; }
                else if((tk.vol || 0) <= (seenSym[sym].vol || 0)) { continue; }
              }
              seenSym[sym] = tk;
              tk.boosted = false;
              incoming.push(tk);
            }

            // Apply admin boosts from localStorage
            _applyAdminBoosts(incoming);

            if(isFirstLoad) {
              // First load: just fill the list
              LIVE_TOKENS.length = 0;
              for(var k = 0; k < incoming.length; k++) LIVE_TOKENS.push(incoming[k]);
            } else {
              // Subsequent refresh: MERGE instead of wipe so the view stays stable
              // Build lookup of incoming by ca
              var incomingByCa = {};
              for(var m = 0; m < incoming.length; m++) {
                var ikey = incoming[m].ca || incoming[m].sym;
                incomingByCa[ikey] = incoming[m];
              }

              // Update existing tokens in place with fresh numbers
              var existingCas = {};
              for(var n = 0; n < LIVE_TOKENS.length; n++) {
                var ex = LIVE_TOKENS[n];
                var exKey = ex.ca || ex.sym;
                existingCas[exKey] = true;
                var fresh = incomingByCa[exKey];
                if(fresh) {
                  // Update dynamic fields, keep the same object reference so bubbles don't respawn
                  ex.price = fresh.price;
                  ex.mcap = fresh.mcap;
                  ex.vol = fresh.vol;
                  ex.liq = fresh.liq;
                  // Only overwrite % fields with non-zero values — API sometimes sends 0
                  // before DexScreener verify fills in the real numbers
                  if(fresh.p5m) ex.p5m = fresh.p5m;
                  if(fresh.p1h) ex.p1h = fresh.p1h;
                  if(fresh.p6h) ex.p6h = fresh.p6h;
                  if(fresh.p24h) ex.p24h = fresh.p24h;
                  ex.txn = fresh.txn;
                  ex.age = fresh.age;
                  if(fresh.name) ex.name = fresh.name;
                  if(fresh.dex) ex.dex = fresh.dex;
                  if(fresh.website) ex.website = fresh.website;
                  if(fresh.twitter) ex.twitter = fresh.twitter;
                }
              }

              // Add brand new tokens that weren't in the list before
              for(var p = 0; p < incoming.length; p++) {
                var pkey = incoming[p].ca || incoming[p].sym;
                if(!existingCas[pkey]) LIVE_TOKENS.push(incoming[p]);
              }
            }

            // Re-apply admin boosts BEFORE dedup so boosted tokens win
            _applyAdminBoosts(LIVE_TOKENS);

            // Final symbol-level dedup (edge case: two chains same sym)
            // Boosted tokens always survive — pick winner per symbol, then rebuild
            var symBest = {};
            for(var j = 0; j < LIVE_TOKENS.length; j++) {
              var s = (LIVE_TOKENS[j].sym || '').toUpperCase();
              if(!symBest[s]) {
                symBest[s] = LIVE_TOKENS[j];
              } else if(LIVE_TOKENS[j].boosted && !symBest[s].boosted) {
                symBest[s] = LIVE_TOKENS[j];
              }
            }
            var keepSet = new Set(Object.values(symBest));
            for(var j = LIVE_TOKENS.length - 1; j >= 0; j--) {
              if(!keepSet.has(LIVE_TOKENS[j])) LIVE_TOKENS.splice(j, 1);
            }

            if(isFirstLoad) {
              // First load: show the table instantly, but build the bubbles only AFTER
              // verify cleans the token set — so they enter ONCE at their final size,
              // instead of settling on raw data then re-settling/shrinking when verify
              // lands. (Filter changes feel clean for exactly this reason: pre-verified.)
              loadData();
              if(!window._firstLoadDone) { window._firstLoadDone = true; window.scrollTo(0, 0); checkUrlForToken(); var ls=document.getElementById('loadingScreen'); if(ls) ls.remove(); var app=document.querySelector('.app'); if(app) app.classList.add('ready'); }
              window._bubbleBuildDeferred = true;   // hold off waitAndInit until verified
              var _builtOnce = false;
              var _buildBubblesOnce = function(){
                if(_builtOnce) return; _builtOnce = true;
                window._bubbleBuildDeferred = false;
                _injectMissingBoostedTokens();
                if(typeof init === 'function') init();   // single clean entrance, final sizes
                var bl = document.getElementById('bubbleLoading'); if(bl) bl.classList.add('hidden');
              };
              verifyTopTokens(true).then(_buildBubblesOnce, _buildBubblesOnce);
              setTimeout(_buildBubblesOnce, 2200);   // fallback: never let the bubbles hang
            } else {
              // Subsequent refreshes: re-sort and render, verify in background
              _lastRowOrder = null;
              loadData();
              verifyTopTokens();
              // Inject any boosted tokens not in the scraper results
              _injectMissingBoostedTokens();
            }
            console.log('MemeScope: Live via API!', LIVE_TOKENS.length, 'tokens', data.cached ? '(cached)' : '(fresh)', isFirstLoad ? '(first load)' : '(merged)');
            resetRefreshProgress();
            return;
          }
        }
      } catch(apiErr) { console.log('MemeScope: API error', apiErr); }
    }
    
    // No fallback - API is the only source. If it fails, dismiss loader and keep showing whatever was loaded before.
    console.log('MemeScope: No data loaded from API');
    var loader = document.getElementById('loadingScreen');
    if (loader) { loader.style.opacity = '0'; setTimeout(function() { loader.remove(); }, 400); }
  } catch(e) {
    console.error('MemeScope error:', e);
    var loader = document.getElementById('loadingScreen');
    if (loader) { loader.style.opacity = '0'; setTimeout(function() { loader.remove(); }, 400); }
  }
}

function parseDexPair(p) {
  var chainMap = {
    'solana': 'solana', 'ethereum': 'eth', 'base': 'base',
    'bsc': 'bsc', 'sui': 'sui', 'tron': 'tron',
    'arbitrum': 'arbitrum', 'avalanche': 'avalanche',
    'polygon': 'polygon', 'optimism': 'optimism',
    'blast': 'blast', 'ton': 'ton',
    'pulsechain': 'pulsechain', 'seiv2': 'seiv2'
  };
  var net = chainMap[p.chainId] || 'solana';
  
  var price = p.priceUsd ? parseFloat(p.priceUsd) : 0;
  var priceNative = p.priceNative ? parseFloat(p.priceNative) : 0;
  var mcap = (p.marketCap) ? p.marketCap : (p.fdv || 0);
  var vol = p.volume ? (p.volume.h24 || 0) : 0;
  var liq = p.liquidity ? (p.liquidity.usd || 0) : 0;
  
  var pc = p.priceChange || {};
  var p5m = pc.m5 ? parseFloat(pc.m5) : 0;
  var p1h = pc.h1 ? parseFloat(pc.h1) : 0;
  var p6h = pc.h6 ? parseFloat(pc.h6) : 0;
  var p24h = pc.h24 ? parseFloat(pc.h24) : 0;
  
  // Calculate age from pairCreatedAt
  var age = '?';
  if(p.pairCreatedAt) {
    var ageMs = Date.now() - p.pairCreatedAt;
    var ageHrs = ageMs / 3600000;
    if(ageHrs < 1) age = Math.round(ageHrs * 60) + 'm';
    else if(ageHrs < 24) age = Math.round(ageHrs) + 'h';
    else if(ageHrs < 720) age = Math.round(ageHrs / 24) + 'd';
    else age = Math.round(ageHrs / 720) + 'mo';
  }
  
  var txns = 0;
  if(p.txns && p.txns.h24) {
    txns = (p.txns.h24.buys || 0) + (p.txns.h24.sells || 0);
  }
  
  return {
    sym: p.baseToken ? p.baseToken.symbol.toUpperCase() : '???',
    name: p.baseToken ? p.baseToken.name : 'Unknown',
    price: price,
    priceNative: priceNative,
    quoteSymbol: p.quoteToken ? p.quoteToken.symbol.toUpperCase() : '',
    mcap: mcap,
    vol: vol,
    liq: liq,
    p5m: p5m,
    p1h: p1h,
    p6h: p6h,
    p24h: p24h,
    age: age,
    txn: txns,
    net: net,
    dex: p.dexId || 'raydium',
    social: Math.floor(Math.random() * 100),
    boosted: false
  };
}

// Fetch live data on load
if(LIVE_MODE) fetchLiveTokens();

// Refresh every 30 seconds — but skip when token detail page is open
var _mainRefreshTimer = setInterval(function(){
  if (!LIVE_MODE) return;
  _fetchServerBoosts(); // sync boosts from server every cycle
  var tp = document.getElementById('tokenPage');
  if (tp && tp.style.display !== 'none') return; // token page open, skip refresh
  fetchLiveTokens();
}, 30000);

// Browsers throttle setInterval on inactive tabs; without this, after a long
// idle the token list goes stale, bubbles drop out, and the remaining few
// scale up to fill the screen.
document.addEventListener('visibilitychange', function(){
  if (document.visibilityState !== 'visible') return;

  // Refresh chart if token page is open — fully rebuild to avoid gap
  var tp = document.getElementById('tokenPage');
  if (tp && tp.style.display !== 'none') {
    if (_tpToken && _tpToken.ca) {
      Object.keys(_barCache).forEach(function(k) {
        if (k.indexOf(_tpToken.ca) === 0) delete _barCache[k];
      });
    }
    // Destroy and rebuild chart — shows loading instead of gap
    if (_tpToken && typeof initTokenPageChart === 'function') {
      initTokenPageChart(_tpToken);
    }
    return;
  }

  // Refresh chart if bubble modal is open — fully rebuild to avoid gap
  var modal = document.getElementById('bubbleModal');
  if (modal && modal.style.display !== 'none') {
    if (window._modalToken && window._modalToken.ca) {
      Object.keys(_barCache).forEach(function(k) {
        if (k.indexOf(window._modalToken.ca) === 0) delete _barCache[k];
      });
    }
    // Destroy and rebuild chart — shows loading instead of gap
    if (window._modalToken && typeof _initModalChart === 'function') {
      _initModalChart(window._modalToken);
    }
    return;
  }

  // No chart open — refresh token feed
  if (!LIVE_MODE) return;
  fetchLiveTokens();
});


function copyTokenCA(btn, ca) {
  if(!ca) return;
  event.stopPropagation();
  navigator.clipboard.writeText(ca);
  btn.innerHTML = '✓';
  setTimeout(function(){
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="14" height="14" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0013.5 3H5.5A2.5 2.5 0 003 5.5v8A2.5 2.5 0 005.5 16H8"/></svg>';
  }, 1000);
}

// Refresh progress bar
var refreshInterval = 30;
var refreshElapsed = 0;
var refreshTimer = null;

function startRefreshProgress() {}
function showFetchingProgress() {}
function resetRefreshProgress() {}

// ─── BUBBLE FILTER MODAL ───
// New state model: ranges for numeric filters, strings for categorical.
// Range = {min: 0..100, max: 0..100} — UI position. Mapped to real values via _bfMapRange.
var bubbleFilters = {
  chain: 'all',
  mcapRange: { min: 0, max: 100 },
  volumeRange: { min: 0, max: 100 },
  ageRange: { min: 0, max: 100 },
  liqRange: { min: 0, max: 100 },
  perf: 'all',
  count: '50',
  category: 'all'
};

// Slider position (0..100) -> real-world value. Each filter has its own scale.
// All ranges use log scale for natural feel since data is heavy-tailed.
var _BF_SCALES = {
  // Market cap: $1K to $100M (5 decades)
  mcap: { min: 1e3, max: 1e8, decades: 5, fmt: 'usd' },
  // Volume: $100 to $10M
  volume: { min: 1e2, max: 1e7, decades: 5, fmt: 'usd' },
  // Liquidity: $100 to $10M
  liq: { min: 1e2, max: 1e7, decades: 5, fmt: 'usd' },
  // Age: 0 hours to 365 days (linear-ish in hours, log for display)
  age: { min: 1, max: 8760, decades: 4, fmt: 'age' },
};

function _bfPosToValue(group, pos) {
  var s = _BF_SCALES[group];
  if (!s) return pos;
  // Log mapping
  var log = Math.log10(s.min) + (pos / 100) * (Math.log10(s.max) - Math.log10(s.min));
  return Math.pow(10, log);
}

function _bfFmtUsd(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}

function _bfFmtAge(hours) {
  if (hours < 1) return '<1h';
  if (hours < 24) return Math.round(hours) + 'h';
  if (hours < 24 * 30) return Math.round(hours / 24) + 'd';
  if (hours < 24 * 365) return Math.round(hours / 24 / 30) + 'mo';
  return Math.round(hours / 24 / 365) + 'y';
}

function _bfFmtRange(group, minPos, maxPos) {
  var s = _BF_SCALES[group];
  if (!s) return 'Any';
  if (minPos <= 0 && maxPos >= 100) return 'Any';
  var fmt = s.fmt === 'age' ? _bfFmtAge : _bfFmtUsd;
  var lo = fmt(_bfPosToValue(group, minPos));
  var hi = maxPos >= 100 ? (s.fmt === 'age' ? 'Any+' : fmt(_bfPosToValue(group, 100)) + '+') : fmt(_bfPosToValue(group, maxPos));
  return lo + ' – ' + hi;
}

function toggleBubbleFilter() {
  var ov = document.getElementById('bubbleFilterOverlay');
  if (ov.classList.contains('open')) {
    closeBubbleFilter();
  } else {
    ov.classList.add('open');
    lockScroll();
    document.body.style.touchAction = 'none';
    _bfUpdateLiveCount();
  }
}

function closeBubbleFilter() {
  document.getElementById('bubbleFilterOverlay').classList.remove('open');
  var bm = document.getElementById('bubbleModal');
  if (!bm || !bm.classList.contains('open')) {
    unlockScroll();
    document.body.style.touchAction = '';
  }
}

function toggleBFChip(el, group, value) {
  var section = el.closest('.bf-section');
  // Clear all chip-like buttons in this section (handles both .bf-chip and .bf-seg).
  var btns = section.querySelectorAll('.bf-chip, .bf-seg');
  btns.forEach(function(c) { c.classList.remove('active'); });
  el.classList.add('active');
  bubbleFilters[group] = value;
  _bfScheduleApply();
}

// Helper: programmatically set a range slider's position (used by presets).
function _bfSetRange(group, minPos, maxPos) {
  var cap = group.charAt(0).toUpperCase() + group.slice(1);
  var minEl = document.getElementById('bf' + cap + 'Min');
  var maxEl = document.getElementById('bf' + cap + 'Max');
  if (!minEl || !maxEl) return;
  minEl.value = minPos;
  maxEl.value = maxPos;
  updateBFRange(group);
}

// Helper: convert a real value (e.g. $1M) to slider position (0..100) for a group.
function _bfValueToPos(group, value) {
  var s = _BF_SCALES[group];
  if (!s || value <= s.min) return 0;
  if (value >= s.max) return 100;
  return ((Math.log10(value) - Math.log10(s.min)) / (Math.log10(s.max) - Math.log10(s.min))) * 100;
}

function updateBFRange(group) {
  var cap = group.charAt(0).toUpperCase() + group.slice(1);
  var minEl = document.getElementById('bf' + cap + 'Min');
  var maxEl = document.getElementById('bf' + cap + 'Max');
  var fill = document.getElementById('bf' + cap + 'Fill');
  var readout = document.getElementById('bf' + cap + 'Readout');
  if (!minEl || !maxEl || !fill) return;
  var minVal = parseInt(minEl.value, 10);
  var maxVal = parseInt(maxEl.value, 10);
  // Prevent crossover.
  if (minVal > maxVal - 2) {
    if (event && event.target === minEl) {
      minVal = maxVal - 2;
      minEl.value = minVal;
    } else {
      maxVal = minVal + 2;
      maxEl.value = maxVal;
    }
  }
  fill.style.left = minVal + '%';
  fill.style.right = (100 - maxVal) + '%';
  if (readout) readout.textContent = _bfFmtRange(group, minVal, maxVal);
  if (typeof bubbleFilters !== 'undefined') {
    bubbleFilters[group + 'Range'] = { min: minVal, max: maxVal };
  }
  _bfScheduleApply();
}

// Initialize range fills + live count on page load.
window.addEventListener('DOMContentLoaded', function () {
  ['mcap', 'volume', 'age', 'liq'].forEach(function (g) {
    var cap = g.charAt(0).toUpperCase() + g.slice(1);
    if (document.getElementById('bf' + cap + 'Min')) updateBFRange(g);
  });
  _bfUpdateLiveCount();
});

// Auto-apply: debounced re-render on any filter change.
var _bfApplyTimer = null;
function _bfScheduleApply() {
  clearTimeout(_bfApplyTimer);
  _bfApplyTimer = setTimeout(function () {
    _bfUpdateLiveCount();
    if (typeof init === 'function') init();
    _bfUpdateFilterBtnState();
  }, 180);
}

function _bfUpdateLiveCount() {
  var el = document.getElementById('bfLiveCount');
  if (!el) return;
  var n = (typeof getFilteredTokens === 'function') ? getFilteredTokens().length : 0;
  el.textContent = n.toLocaleString();
}

function _bfUpdateFilterBtnState() {
  var btn = document.getElementById('bubbleFilterBtn');
  if (!btn) return;
  var hasFilter = false;
  if (bubbleFilters.chain !== 'all') hasFilter = true;
  if (bubbleFilters.perf !== 'all') hasFilter = true;
  if (bubbleFilters.category !== 'all') hasFilter = true;
  if (bubbleFilters.count !== '50') hasFilter = true;
  ['mcapRange', 'volumeRange', 'ageRange', 'liqRange'].forEach(function (k) {
    var r = bubbleFilters[k];
    if (r && (r.min > 0 || r.max < 100)) hasFilter = true;
  });
  if (hasFilter) {
    btn.style.background = '#4a4fd8';
    btn.style.color = '#e6e1e3';
  } else {
    btn.style.background = '';
    btn.style.color = '';
  }
}

// Preset combos — one tap configures the modal. Ranges as {minVal,maxVal} in $ or hours.
var BF_PRESETS = {
  pumping:   { perf: 'pumping', volume: { minVal: 5e4 } },
  newlaunch: { age: { maxVal: 24 }, mcap: { maxVal: 1e6 }, volume: { minVal: 1e4 } },
  whales:    { volume: { minVal: 1e6 }, liq: { minVal: 5e5 } },
  gems:      { mcap: { maxVal: 1e5 }, volume: { minVal: 1e4 }, age: { maxVal: 168 } },
};

function applyBFPreset(name) {
  var combo = BF_PRESETS[name];
  if (!combo) return;
  resetBubbleFilters();
  Object.keys(combo).forEach(function (group) {
    var spec = combo[group];
    if (typeof spec === 'string') {
      // Categorical (perf, category, chain, count): click matching chip.
      var section = document.querySelector('.bf-section .bf-chip[onclick*="\'' + group + '\'"]');
      if (section) {
        var sec = section.closest('.bf-section');
        var chip = sec.querySelector('.bf-chip[data-value="' + spec + '"], .bf-seg[data-value="' + spec + '"]');
        if (chip) toggleBFChip(chip, group, spec);
      }
    } else if (typeof spec === 'object') {
      // Range filter: convert min/maxVal in real units to slider positions.
      var minPos = spec.minVal != null ? _bfValueToPos(group, spec.minVal) : 0;
      var maxPos = spec.maxVal != null ? _bfValueToPos(group, spec.maxVal) : 100;
      _bfSetRange(group, Math.round(minPos), Math.round(maxPos));
    }
  });
  // Highlight the active preset chip.
  document.querySelectorAll('.bf-preset-chip').forEach(function(c) { c.classList.remove('active'); });
  var presetBtn = document.querySelector('.bf-preset-chip[onclick*="\'' + name + '\'"]');
  if (presetBtn) presetBtn.classList.add('active');
}

function resetBubbleFilters() {
  bubbleFilters = {
    chain: 'all',
    mcapRange: { min: 0, max: 100 },
    volumeRange: { min: 0, max: 100 },
    ageRange: { min: 0, max: 100 },
    liqRange: { min: 0, max: 100 },
    perf: 'all',
    count: '50',
    category: 'all',
  };
  // Reset chips
  var sections = document.querySelectorAll('.bf-section');
  sections.forEach(function (sec) {
    var btns = sec.querySelectorAll('.bf-chip, .bf-seg');
    btns.forEach(function (c) { c.classList.remove('active'); });
    var allBtn = sec.querySelector('[data-value="all"]');
    if (allBtn) allBtn.classList.add('active');
    else {
      var def = sec.querySelector('[data-value="50"]');
      if (def) def.classList.add('active');
    }
  });
  // Reset preset highlights
  document.querySelectorAll('.bf-preset-chip').forEach(function (c) { c.classList.remove('active'); });
  // Reset sliders
  ['mcap', 'volume', 'age', 'liq'].forEach(function (g) { _bfSetRange(g, 0, 100); });
  _bfScheduleApply();
}

function applyBubbleFilters() {
  closeBubbleFilter();
  // Update the filter button to show active state
  var btn = document.getElementById('bubbleFilterBtn');
  var hasFilter = Object.keys(bubbleFilters).some(function(k) {
    if (k === 'count') return bubbleFilters[k] !== '50';
    return bubbleFilters[k] !== 'all';
  });
  if (hasFilter) {
    btn.style.background = '#4a4fd8';
    btn.style.color = '#e6e1e3';
  } else {
    btn.style.background = '';
    btn.style.color = '';
  }
  // Trigger re-render
  if (typeof updateBubblesSmooth === 'function') updateBubblesSmooth();
  if (typeof loadData === 'function') loadData();
}

// Patch getFilteredTokens to apply bubble filters
var _origGetFilteredTokens = typeof getFilteredTokens === 'function' ? getFilteredTokens : null;

getFilteredTokens = function() {
  var tokens = _origGetFilteredTokens ? _origGetFilteredTokens() : [...LIVE_TOKENS];
  var bf = bubbleFilters;

  // Chain filter (boosted tokens always pass)
  if (bf.chain && bf.chain !== 'all') {
    tokens = tokens.filter(function(t) { return t.boosted || t.net === bf.chain; });
  }

  // Range filters helper
  function _applyRange(group, getter) {
    var r = bf[group + 'Range'];
    if (!r) return;
    if (r.min <= 0 && r.max >= 100) return; // full range = no filter
    var s = _BF_SCALES[group];
    if (!s) return;
    var lo = r.min <= 0 ? -Infinity : _bfPosToValue(group, r.min);
    var hi = r.max >= 100 ? Infinity : _bfPosToValue(group, r.max);
    tokens = tokens.filter(function (t) {
      var v = getter(t);
      return v >= lo && v <= hi;
    });
  }

  _applyRange('mcap',   function (t) { return t.mcap || 0; });
  _applyRange('volume', function (t) { return t.vol  || 0; });
  _applyRange('liq',    function (t) { return t.liq  || 0; });
  _applyRange('age',    function (t) { return ageToHours(t.age || '999y'); });

  // Performance filter (based on current timeframe)
  if (bf.perf && bf.perf !== 'all') {
    var tf = getTimeframeField();
    tokens = tokens.filter(function(t) {
      var pct = t[tf] || 0;
      switch(bf.perf) {
        case 'pumping': return pct > 10;
        case 'dumping': return pct < -10;
        case 'stable': return pct >= -10 && pct <= 10;
        default: return true;
      }
    });
  }

  // Category filter
  if (bf.category !== 'all') {
    var tf2 = getTimeframeField();
    switch(bf.category) {
      case 'trending': tokens.sort(function(a,b) { return Math.abs(b[tf2]) - Math.abs(a[tf2]); }); break;
      case 'gainers': tokens = tokens.filter(function(t) { return (t[tf2] || 0) > 0; }); tokens.sort(function(a,b) { return b[tf2] - a[tf2]; }); break;
      case 'losers': tokens = tokens.filter(function(t) { return (t[tf2] || 0) < 0; }); tokens.sort(function(a,b) { return a[tf2] - b[tf2]; }); break;
    }
  }

  return tokens;
};

// ── Mobile bottom nav ──
function mobNavGo(tab) {
  var nav = document.getElementById('mobileBottomNav');
  var btns = nav ? nav.querySelectorAll('.mob-nav-item') : [];

  if (tab === 'home') {
    btns.forEach(function(b) { b.classList.remove('active'); });
    if (btns[0]) btns[0].classList.add('active');
    // Close any open modals/pages and go to main view
    var ov = document.getElementById('bubbleModalOverlay');
    if (ov && ov.classList.contains('open')) closeBubbleModal();
    var tp = document.getElementById('tokenPage');
    if (tp && tp.style.display !== 'none') closeTokenPage();
    var wl = document.getElementById('wlOverlay');
    var navEl = document.getElementById('mobileBottomNav');
    if ((wl && wl.classList.contains('open')) || (navEl && navEl.classList.contains('watchlist-open'))) closeWatchlistModal();
    if (navEl) { navEl.classList.remove('menu-open','search-open'); }
    unlockScroll();
    // Reset everything back to default home state
    var _needsRefresh = false;
    // Reset chain to All
    if (currentChain !== 'all') {
      currentChain = 'all';
      // Update sidebar active state
      document.querySelectorAll('.ms-nav-link[onclick*="toggleChain"], .ms-mobile-item[onclick*="toggleChain"]').forEach(function(b) { b.classList.remove('active'); });
      var allBtn = document.querySelector('.ms-nav-link[onclick*="toggleChain(this,\'all\')"]');
      if (allBtn) allBtn.classList.add('active');
      // Update dropdown button label
      var chainBtn = document.querySelector('.topbar-btn[onclick*="toggleChainFilter"]');
      if (chainBtn) chainBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 100 100" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M34.971 61.094l-11.303 11.303c-1.087 1.087-2.85 1.087-3.937 0l-4.497-4.497c-1.087-1.087-1.087-2.85 0-3.937l24.364-24.364c1.087-1.087 2.85-1.087 3.937 0l14.709 14.71c3.874-5.72 3.283-13.583-1.779-18.646l-4.497-4.497c-5.735-5.735-15.067-5.735-20.803 0L6.802 55.53c-5.735 5.735-5.735 15.067 0 20.803l4.497 4.497c5.735 5.735 15.067 5.735 20.803 0l10.027-10.027-2.53-2.53c-2.09-2.09-3.638-4.546-4.627-7.18z"/><path d="M93.198 23.668l-4.497-4.497c-5.735-5.735-15.067-5.735-20.803 0L57.872 29.197l2.53 2.53c2.09 2.09 3.637 4.547 4.627 7.18l11.303-11.303c1.087-1.087 2.85-1.087 3.937 0l4.497 4.497c1.087 1.087 1.087 2.85 0 3.937L60.402 60.401c-1.087 1.087-2.85 1.087-3.937 0l-14.709-14.71c-3.874 5.72-3.284 13.583 1.779 18.646l4.497 4.497c5.735 5.735 15.068 5.735 20.803 0l24.364-24.364c5.735-5.735 5.735-15.067 0-20.803z"/></svg>Hot Chains ▾';
      // Sync mobile menu chain active state
      document.querySelectorAll('.mob-menu-chain').forEach(function(c) { c.classList.remove('active'); });
      _needsRefresh = true;
    }
    // Reset category to trending (top/gainers/losers/new → trending)
    if (currentCategory !== 'trending') {
      currentCategory = 'trending';
      var leaf = document.getElementById('navNewPairs');
      var mobileLeaf = document.getElementById('mobileNavNewPairs');
      if (leaf) leaf.classList.remove('active');
      if (mobileLeaf) mobileLeaf.classList.remove('active');
      _needsRefresh = true;
    }
    // Reset filter chips UI back to Top
    var chips = document.querySelectorAll('.filter-chip');
    chips.forEach(function(c) {
      c.classList.remove('active-chip', 'chip-animate');
      if (c.textContent.trim().indexOf('Top') !== -1 || (c.getAttribute('onclick') && c.getAttribute('onclick').indexOf("'trending'") !== -1)) c.classList.add('active-chip');
    });
    // Reset filter pills UI (gainers/losers)
    document.querySelectorAll('.filter-pill').forEach(function(p) { p.classList.remove('active-pill'); });
    // Reset timeframe to 1h
    if (currentTimeframe !== '1h') {
      currentTimeframe = '1h';
      var tfGroup = document.getElementById('tfGroup');
      if (tfGroup) {
        tfGroup.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
        var h1Btn = tfGroup.querySelector('.filter-btn[onclick*="\'1h\'"]');
        if (h1Btn) h1Btn.classList.add('active');
        updateTfSlider();
      }
      _needsRefresh = true;
    }
    // Reset launchpad filter
    if (currentLaunchpad !== 'all') {
      currentLaunchpad = 'all';
      _needsRefresh = true;
    }
    currentPage = 1;
    _lastRowOrder = null;
    loadData();
    if (typeof init === 'function') init();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (tab === 'newpairs') {
    btns.forEach(function(b) { b.classList.remove('active'); });
    if (btns[2]) btns[2].classList.add('active');
    // Close any open panels first
    var navEl = document.getElementById('mobileBottomNav');
    if (navEl) { navEl.classList.remove('menu-open','watchlist-open','search-open'); }
    unlockScroll();
    // Always activate new pairs (don't toggle off from nav bar)
    if (currentCategory !== 'new') {
      toggleNewPairs();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (tab === 'watchlist') {
    btns.forEach(function(b) { b.classList.remove('active'); });
    if (btns[1]) btns[1].classList.add('active');
    if (window.innerWidth <= 768) {
      var nav = document.getElementById('mobileBottomNav');
      var wlModal = document.querySelector('.wl-modal');
      var container = document.getElementById('mobNavWatchlist');
      if (nav && wlModal && container) {
        window._wlModalParent = wlModal.parentNode;
        container.appendChild(wlModal);
        nav.classList.add('watchlist-open');
        lockScroll();
        renderWatchlist();
      }
    } else {
      if (typeof openWatchlistModal === 'function') openWatchlistModal();
    }
  }

  if (tab === 'search') {
    btns.forEach(function(b) { b.classList.remove('active'); });
    if (btns[3]) btns[3].classList.add('active');
    if (window.innerWidth <= 768) {
      var nav = document.getElementById('mobileBottomNav');
      var searchModal = document.getElementById('search-modal');
      var container = document.getElementById('mobNavSearch');
      if (nav && searchModal && container) {
        window._searchModalParent = searchModal.parentNode;
        container.appendChild(searchModal);
        nav.classList.add('search-open');
        lockScroll();
        var input = document.getElementById('search-modal-input');
        if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 350); }
        searchHighlightIdx = -1;
        showSearchDefault();
      }
    } else {
      openSearchModal();
    }
  }

  if (tab === 'menu') {
    btns.forEach(function(b) { b.classList.remove('active'); });
    if (btns[4]) btns[4].classList.add('active');
    var nav = document.getElementById('mobileBottomNav');
    if (nav) {
      nav.classList.add('menu-open');
      lockScroll();
    }
  }
}

function closeMobMenu() {
  var nav = document.getElementById('mobileBottomNav');
  if (nav) {
    nav.classList.remove('menu-open');
    unlockScroll();
    var btns = nav.querySelectorAll('.mob-nav-item');
    btns.forEach(function(b) { b.classList.remove('active'); });
    if (btns[0]) btns[0].classList.add('active');
  }
}

// Reset nav to Home when watchlist closes + move modal back
(function() {
  var _origCloseWl = closeWatchlistModal;
  closeWatchlistModal = function() {
    var nav = document.getElementById('mobileBottomNav');
    if (nav && window.innerWidth <= 768 && nav.classList.contains('watchlist-open')) {
      nav.classList.remove('watchlist-open');
      unlockScroll();
      // Move modal back to its original parent
      var wlModal = document.querySelector('.wl-modal');
      if (wlModal && window._wlModalParent) {
        window._wlModalParent.appendChild(wlModal);
      }
      var btns = nav.querySelectorAll('.mob-nav-item');
      btns.forEach(function(b) { b.classList.remove('active'); });
      if (btns[0]) btns[0].classList.add('active');
    } else {
      _origCloseWl();
    }
  };
})();

// Handle search close — move modal back if it was in nav
(function() {
  var _origCloseSearch = closeSearchModal;
  closeSearchModal = function() {
    var nav = document.getElementById('mobileBottomNav');
    var searchModal = document.getElementById('search-modal');
    // If search modal is inside the nav, move it back and collapse
    if (nav && nav.classList.contains('search-open') && searchModal && window._searchModalParent) {
      window._searchModalParent.appendChild(searchModal);
      window._searchModalParent = null;
      nav.classList.remove('search-open');
      unlockScroll();
      var btns = nav.querySelectorAll('.mob-nav-item');
      btns.forEach(function(b) { b.classList.remove('active'); });
      if (btns[0]) btns[0].classList.add('active');
      searchHighlightIdx = -1;
    } else {
      _origCloseSearch();
      if (nav && window.innerWidth <= 768) {
        var btns = nav.querySelectorAll('.mob-nav-item');
        btns.forEach(function(b) { b.classList.remove('active'); });
        if (btns[0]) btns[0].classList.add('active');
      }
    }
  };
})();
