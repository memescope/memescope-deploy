/* ============================================================
   Multichart — slot-based grid of TradingView charts
   ============================================================ */
(function() {
  'use strict';

  var MAX_CHARTS = 16;
  var STORAGE_KEY = 'ms_multichart';
  var _mcWidgets = {};
  var _mcTokens = [];
  var _searchTimeout = null;

  // Chain maps
  var pairTokenMap = { solana:'SOL', eth:'WETH', base:'WETH', bsc:'BNB', sui:'SUI', tron:'TRX', arbitrum:'WETH', avalanche:'WAVAX', polygon:'WMATIC', optimism:'WETH', blast:'WETH', ton:'TON', pulsechain:'PLS', seiv2:'WSEI' };
  var geckoChainMap = { solana:'solana', eth:'eth', base:'base', bsc:'bsc', sui:'sui-network', tron:'tron', arbitrum:'arbitrum', avalanche:'avax', polygon:'polygon_pos', optimism:'optimism', blast:'blast', ton:'ton', pulsechain:'pulsechain', seiv2:'sei-evm' };
  var dexChainMap = { solana:'solana', eth:'ethereum', base:'base', bsc:'bsc', sui:'sui', tron:'tron', arbitrum:'arbitrum', avalanche:'avalanche', polygon:'polygon', optimism:'optimism', blast:'blast', ton:'ton', pulsechain:'pulsechain', seiv2:'seiv2' };
  var _mcSubIntervals = {}; // track subscribeBars intervals for cleanup

  // ---- Persistence ----
  function _save() {
    try {
      var data = _mcTokens.map(function(t) {
        return { ca: t.ca, sym: t.sym, name: t.name, net: t.net, price: t.price, mcap: t.mcap, p24h: t.p24h, img: t.img, pairAddress: t.pairAddress };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) {}
  }
  function _load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return [];
  }

  // ---- Render the add-slot placeholder ----
  function _ensureAddSlot() {
    var grid = document.getElementById('mcGrid');
    if (!grid) return;
    // Remove existing add-slot
    var old = grid.querySelector('.mc-add-slot');
    if (old) old.remove();
    // Add new one if under max
    if (_mcTokens.length < MAX_CHARTS) {
      var slot = document.createElement('div');
      slot.className = 'mc-add-slot';
      slot.onclick = function() { mcEnterAddMode(); };
      slot.innerHTML =
        '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>' +
        '<button class="mc-add-btn" type="button">Add Chart</button>' +
        '<span class="mc-slot-count">' + _mcTokens.length + ' / ' + MAX_CHARTS + '</span>';
      grid.appendChild(slot);
    }
  }

  // ---- Update count on the add-slot card ----
  function _updateCount() {
    var grid = document.getElementById('mcGrid');
    if (grid) {
      var countEl = grid.querySelector('.mc-slot-count');
      if (countEl) countEl.textContent = _mcTokens.length + ' / ' + MAX_CHARTS;
    }
    _updateBadges();
  }

  function _updateBadges() {
    var n = _mcTokens.length;
    ['multichartBadge', 'multichartBadgeMob'].forEach(function(id) {
      var badge = document.getElementById(id);
      if (!badge) return;
      if (n > 0) {
        badge.textContent = n;
        badge.classList.add('visible');
      } else {
        badge.classList.remove('visible');
      }
    });
  }

  // ---- Open / Close ----
  window.openMultichart = function() {
    var overlay = document.getElementById('mcOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    document.body.classList.add('mc-open');
    // Jump to top BEFORE locking scroll. lockScroll() sets
    // body{position:fixed; top:-scrollY}; that negative offset breaks the
    // position:sticky header (it reverts to its in-flow spot, now scrolled off
    // the top), exposing the bubble-hero through the strip the overlay leaves
    // uncovered for the global header/sidebar. Going to top first keeps the
    // sticky header pinned at 0. We restore the user's scroll on close.
    window._mcPrevScroll = window.scrollY || window.pageYOffset || 0;
    window.scrollTo(0, 0);
    if (typeof lockScroll === 'function') lockScroll();
    // Load saved charts on first open
    var saved = _load();
    if (saved.length && !_mcTokens.length) {
      for (var i = 0; i < saved.length; i++) {
        _addChart(saved[i], true);
      }
    }
    _ensureAddSlot();
    _updateCount();
  };

  window.clearMultichart = function() {
    if (!_mcTokens.length) return;
    _mcConfirm('Are you sure you want to clear all charts?', _doClearMultichart);
  };
  function _doClearMultichart() {
    var grid = document.getElementById('mcGrid');
    if (!grid) return;
    // Remove all chart widgets
    var cards = grid.querySelectorAll('.mc-card');
    for (var i = 0; i < cards.length; i++) {
      var chartEl = cards[i].querySelector('.mc-card-chart');
      if (chartEl && _mcWidgets[chartEl.id]) {
        try { _mcWidgets[chartEl.id].remove(); } catch(e) {}
        delete _mcWidgets[chartEl.id];
      }
      cards[i].remove();
    }
    _mcTokens = [];
    _save();
    _ensureAddSlot();
    _updateCount();
  }

  // Reusable confirmation dialog (matches the site's M3 modal styling).
  function _mcConfirm(message, onConfirm) {
    var existing = document.getElementById('mcConfirmOverlay');
    if (existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'mcConfirmOverlay';
    ov.className = 'mc-confirm-overlay';
    ov.innerHTML =
      '<div class="mc-confirm" role="dialog" aria-modal="true">' +
        '<button class="mc-confirm-close" type="button" aria-label="Close">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '<div class="mc-confirm-msg"></div>' +
        '<div class="mc-confirm-actions">' +
          '<button class="mc-confirm-yes" type="button">Confirm</button>' +
          '<button class="mc-confirm-no" type="button">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('.mc-confirm-msg').textContent = message;
    document.body.appendChild(ov);
    function close() {
      ov.classList.remove('open');
      ov.classList.add('closing');
      setTimeout(function() { if (ov.parentNode) ov.remove(); }, 200);
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'Enter') { e.stopPropagation(); close(); if (onConfirm) onConfirm(); }
    }
    ov.querySelector('.mc-confirm-close').onclick = close;
    ov.querySelector('.mc-confirm-no').onclick = close;
    ov.querySelector('.mc-confirm-yes').onclick = function() { close(); if (onConfirm) onConfirm(); };
    ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(function() { ov.classList.add('open'); });
  }

  window.closeMultichart = function() {
    var overlay = document.getElementById('mcOverlay');
    if (typeof m3CloseOverlay === 'function') {
      m3CloseOverlay(overlay, function() {
        if (typeof unlockScroll === 'function') unlockScroll();
        window.scrollTo(0, window._mcPrevScroll || 0);
        document.body.classList.remove('mc-open');
        mcCloseSearch();
        var mcNav = document.getElementById('navMultichart');
        if(mcNav) { mcNav.classList.remove('pill-animate'); mcNav.classList.remove('active'); }
      });
    } else {
      if (overlay) overlay.classList.remove('open');
      if (typeof unlockScroll === 'function') unlockScroll();
      window.scrollTo(0, window._mcPrevScroll || 0);
      document.body.classList.remove('mc-open');
      mcCloseSearch();
      var mcNav = document.getElementById('navMultichart');
      if(mcNav) { mcNav.classList.remove('pill-animate'); mcNav.classList.remove('active'); }
    }
  };

  // ---- Floating search open / close ----
  window.mcOpenSearch = function() {
    var float = document.getElementById('mcSearchFloat');
    if (float) float.classList.add('open');
    var backdrop = document.getElementById('mcSearchBackdrop');
    if (backdrop) backdrop.classList.add('open');
    setTimeout(function() {
      var inp = document.getElementById('mcSearch');
      if (inp) inp.focus();
    }, 200);
  };
  window.mcCloseSearch = function() {
    if (window._mcAddMode) { mcExitAddMode(); return; }
    var float = document.getElementById('mcSearchFloat');
    if (float) { float.classList.remove('open'); float.classList.remove('has-results'); }
    var backdrop = document.getElementById('mcSearchBackdrop');
    if (backdrop) backdrop.classList.remove('open');
    var results = document.getElementById('mcResults');
    if (results) results.style.display = 'none';
    var inp = document.getElementById('mcSearch');
    if (inp) inp.value = '';
  };

  // ---- Add mode: search surface sits exactly over the top search bar ----
  function _positionFloat() {
    var bar = document.getElementById('headerSearchBar');
    var float = document.getElementById('mcSearchFloat');
    if (!float) return;
    var r = bar ? bar.getBoundingClientRect() : null;
    // When the header search is hidden (multichart open) it has zero size —
    // anchor the search to the empty bar strip under the Clear All row instead.
    if (!r || r.width === 0) {
      var fb = document.querySelector('.mc-filterbar');
      var fr = fb ? fb.getBoundingClientRect() : null;
      if (fr && fr.width > 0) {
        var fw = Math.min(560, fr.width);
        var ftop = fr.top + 6;
        var fleft = fr.left + (fr.width - fw) / 2;
        float.style.top = ftop + 'px';
        float.style.left = fleft + 'px';
        float.style.width = fw + 'px';
        float.style.transform = 'none';
        float.style.maxHeight = (window.innerHeight - ftop - 24) + 'px';
        return;
      }
      var w = Math.min(560, window.innerWidth - 32);
      var top = 80;
      var left = (window.innerWidth - w) / 2;
      float.style.top = top + 'px';
      float.style.left = left + 'px';
      float.style.width = w + 'px';
      float.style.transform = 'none';
      float.style.maxHeight = (window.innerHeight - top - 24) + 'px';
      return;
    }
    // Mirror the top search bar position so it reads as the same bar lighting up
    float.style.top = r.top + 'px';
    float.style.left = r.left + 'px';
    float.style.width = r.width + 'px';
    float.style.transform = 'none';
    float.style.maxHeight = (window.innerHeight - r.top - 24) + 'px';
  }

  window.mcEnterAddMode = function() {
    window._mcAddMode = true;
    document.body.classList.add('mc-add-mode');
    var backdrop = document.getElementById('mcSearchBackdrop');
    if (backdrop) backdrop.classList.add('open');
    var float = document.getElementById('mcSearchFloat');
    _positionFloat();
    if (float) float.classList.add('open');
    var inp = document.getElementById('mcSearch');
    if (inp) { inp.value = ''; setTimeout(function() { inp.focus(); }, 60); }
  };

  window.mcExitAddMode = function() {
    window._mcAddMode = false;
    document.body.classList.remove('mc-add-mode');
    var float = document.getElementById('mcSearchFloat');
    if (float) { float.classList.remove('open'); float.classList.remove('has-results'); float.style.cssText = ''; }
    var backdrop = document.getElementById('mcSearchBackdrop');
    if (backdrop) backdrop.classList.remove('open');
    var results = document.getElementById('mcResults');
    if (results) { results.style.display = 'none'; results.innerHTML = ''; }
    var inp = document.getElementById('mcSearch');
    if (inp) inp.value = '';
  };

  // ---- Build datafeed for a token ----
  function _buildDatafeed(t) {
    var chain = (t.net || 'solana').toLowerCase();
    var geckoNet = geckoChainMap[chain] || chain;
    var dexNet = dexChainMap[chain] || chain;
    var _barCache = {};
    var _discoveredPool = t.pairAddress || null;

    function _discoverPool(cb) {
      if (_discoveredPool) { cb(_discoveredPool); return; }
      var done = false;
      fetch('https://api.dexscreener.com/tokens/v1/' + (dexNet || 'solana') + '/' + t.ca)
        .then(function(r) { return r.json(); })
        .then(function(pairs) {
          if (done) return;
          if (pairs && pairs.length) {
            var cp = pairs.filter(function(p) { return p.chainId === dexNet; });
            var best = (cp.length ? cp : pairs).reduce(function(b, p) { return (p.liquidity && p.liquidity.usd || 0) > (b.liquidity && b.liquidity.usd || 0) ? p : b; }, (cp.length ? cp : pairs)[0]);
            if (best && best.pairAddress) { done = true; _discoveredPool = best.pairAddress; cb(best.pairAddress); }
          }
        }).catch(function() {});
      fetch('/api/gecko/networks/' + geckoNet + '/tokens/' + t.ca + '/pools?page=1', { headers: { 'Accept': 'application/json' } })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (done) return;
          if (d && d.data && d.data.length) {
            var poolId = d.data[0].attributes && d.data[0].attributes.address;
            if (!poolId) { var pts = d.data[0].id.split('_'); poolId = pts.length > 1 ? pts.slice(1).join('_') : d.data[0].id; }
            if (poolId) { done = true; _discoveredPool = poolId; cb(poolId); }
          }
        }).catch(function() {});
      setTimeout(function() { if (!done) { done = true; cb(null); } }, 8000);
    }

    return {
      onReady: function(cb) {
        setTimeout(function() {
          cb({ supported_resolutions: ['1', '5', '15', '60', '240', '1D'], supports_time: true });
        }, 0);
      },
      searchSymbols: function(q, e, st, cb) { cb([]); },
      resolveSymbol: function(name, onRes) {
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
            type: 'crypto', session: '24x7', exchange: 'memescope.io', timezone: 'Etc/UTC',
            format: 'price', pricescale: ps, minmov: 1, has_intraday: true,
            supported_resolutions: ['1', '5', '15', '60', '240', '1D'], volume_precision: 2, data_status: 'streaming',
          });
        }, 0);
      },
      getBars: function(sym, res, params, onRes, onErr) {
        if (params.firstDataRequest === false) { onRes([], { noData: true }); return; }
        var cacheKey = t.ca + '_' + res;
        if (_barCache[cacheKey]) { onRes(_barCache[cacheKey], { noData: _barCache[cacheKey].length === 0 }); return; }
        var resMap = { '1': { agg: 'minute', mult: 1 }, '5': { agg: 'minute', mult: 5 }, '15': { agg: 'minute', mult: 15 }, '60': { agg: 'hour', mult: 1 }, '240': { agg: 'hour', mult: 4 }, '1D': { agg: 'day', mult: 1 } };
        var rc = resMap[res] || resMap['1'];
        var resMin = parseInt(res);
        var resMs = (!isNaN(resMin) ? resMin : 1) * 60000;
        if (res === '1D') resMs = 86400000;
        _discoverPool(function(pool) {
          if (!pool) { onRes([], { noData: true }); return; }
          var url = '/api/gecko/networks/' + geckoNet + '/pools/' + pool + '/ohlcv/' + rc.agg + '?aggregate=' + rc.mult + '&limit=1000&currency=usd';
          fetch(url, { headers: { 'Accept': 'application/json' } })
            .then(function(r) { return r.json(); })
            .then(function(d) {
              var bars = [];
              if (d && d.data && d.data.attributes && d.data.attributes.ohlcv_list) {
                var list = d.data.attributes.ohlcv_list;
                for (var i = list.length - 1; i >= 0; i--) {
                  bars.push({ time: list[i][0] * 1000, open: list[i][1], high: list[i][2], low: list[i][3], close: list[i][4], volume: list[i][5] });
                }
              }
              // Place live candle RIGHT AFTER last OHLCV bar (eliminates time gap)
              function _finishBars(livePrice) {
                if (bars.length > 0 && livePrice) {
                  var last = bars[bars.length - 1];
                  var nextSlot = last.time + resMs;
                  bars.push({ time: nextSlot, open: last.close, high: Math.max(last.close, livePrice), low: Math.min(last.close, livePrice), close: livePrice, volume: 0 });
                }
                _barCache[cacheKey] = bars;
                onRes(bars, { noData: bars.length === 0 });
              }
              if (typeof fetchDexToken === 'function') {
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
              } else {
                _barCache[cacheKey] = bars;
                onRes(bars, { noData: bars.length === 0 });
              }
            })
            .catch(function() { onRes([], { noData: true }); });
        });
      },
      subscribeBars: function(sym, res, onTick, guid) {
        if (typeof fetchDexToken !== 'function') return;
        var resMin = parseInt(res);
        var resMs = (!isNaN(resMin) ? resMin : 1) * 60000;
        if (res === '1D') resMs = 86400000;
        var cacheKey = t.ca + '_' + res;
        var _curBar = null;
        if (_barCache[cacheKey] && _barCache[cacheKey].length) {
          var lb = _barCache[cacheKey][_barCache[cacheKey].length - 1];
          _curBar = { time: lb.time, open: lb.open, high: lb.high, low: lb.low, close: lb.close, volume: lb.volume };
        }
        var _lastTickPrice = _curBar ? _curBar.close : 0;

        function _handleTick(d) {
          if (!d || !d.pairs || !d.pairs.length) return;
          var pair = d.pairs.reduce(function(b, p) { return (p.liquidity && p.liquidity.usd || 0) > (b.liquidity && b.liquidity.usd || 0) ? p : b; }, d.pairs[0]);
          var price = parseFloat(pair.priceUsd);
          if (!price) return;
          var barTime = Math.floor(Date.now() / resMs) * resMs;
          var priceChanged = price !== _lastTickPrice;
          var newBucket = !_curBar || barTime > _curBar.time;
          if (priceChanged) _lastTickPrice = price;
          if (priceChanged || newBucket) {
            if (_curBar && _curBar.time === barTime) {
              _curBar.close = price;
              _curBar.high = Math.max(_curBar.high, price);
              _curBar.low = Math.min(_curBar.low, price);
            } else {
              _curBar = { time: barTime, open: price, high: price, low: price, close: price, volume: 0 };
            }
            onTick({ time: _curBar.time, open: _curBar.open, high: _curBar.high, low: _curBar.low, close: _curBar.close, volume: _curBar.volume });
          }
        }

        // Use Web Worker if available, fallback to setInterval
        if (window._priceWorker && window._priceWorkerCallbacks) {
          window._priceWorkerCallbacks[guid] = _handleTick;
          window._priceWorker.postMessage({ type: 'subscribe', guid: guid, ca: t.ca, interval: 2000 });
        } else {
          var iv = setInterval(function() {
            fetchDexToken(t.ca).then(_handleTick).catch(function() {});
          }, 2000);
          _mcSubIntervals[guid] = iv;
        }
      },
      unsubscribeBars: function(guid) {
        if (window._priceWorker && window._priceWorkerCallbacks) {
          window._priceWorker.postMessage({ type: 'unsubscribe', guid: guid });
          delete window._priceWorkerCallbacks[guid];
        }
        if (_mcSubIntervals[guid]) { clearInterval(_mcSubIntervals[guid]); delete _mcSubIntervals[guid]; }
      },
    };
  }

  // ---- Add chart card (inserts before the add-slot) ----
  function _addChart(t, skipSave) {
    if (_mcTokens.length >= MAX_CHARTS) return;
    for (var i = 0; i < _mcTokens.length; i++) {
      if (_mcTokens[i].ca.toLowerCase() === t.ca.toLowerCase()) return;
    }
    _mcTokens.push(t);
    if (!skipSave) _save();
    _updateCount();

    var grid = document.getElementById('mcGrid');
    if (!grid) return;

    var chartId = 'mc_chart_' + t.ca.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) + '_' + Date.now();
    var card = document.createElement('div');
    card.className = 'mc-card';
    card.setAttribute('data-ca', t.ca);

    var pctClass = (t.p24h || 0) >= 0 ? 'mc-pct-up' : 'mc-pct-down';
    var pctText = (t.p24h || 0) >= 0 ? '+' + (t.p24h || 0).toFixed(2) + '%' : (t.p24h || 0).toFixed(2) + '%';
    var escapedCa = t.ca.replace(/'/g, "\\'");

    var pct1hClass = (t.p1h || 0) >= 0 ? 'mc-pct-up' : 'mc-pct-down';
    var pct1hText = (t.p1h || 0) >= 0 ? '+' + (t.p1h || 0).toFixed(2) + '%' : (t.p1h || 0).toFixed(2) + '%';

    card.innerHTML =
      '<div class="mc-card-header">' +
        '<div class="mc-card-info">' +
          '<img class="mc-card-logo" src="' + (t.img || '') + '" onerror="this.style.display=\'none\'">' +
          '<div class="mc-card-info-text">' +
            '<div class="mc-card-info-row">' +
              '<span class="mc-card-sym">' + (t.sym || '???') + '</span>' +
              '<span class="mc-card-pair">/ ' + (pairTokenMap[(t.net || 'solana').toLowerCase()] || 'SOL') + '</span>' +
            '</div>' +
            '<span class="mc-card-name">' + (t.name || t.sym || '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="mc-card-right-text">' +
          '<span class="mc-card-price">' + _fmtPrice(t.price) + '</span>' +
          '<div class="mc-card-right-row">' +
            '<span class="mc-card-pct-label">1H</span>' +
            '<span class="mc-card-pct ' + pct1hClass + '">' + pct1hText + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="mc-card-chart-wrap">' +
        '<div class="mc-card-chart" id="' + chartId + '"></div>' +
      '</div>' +
      '<div class="mc-card-footer">' +
        '<div class="mc-card-footer-left"></div>' +
        '<div class="mc-card-footer-right">' +
          '<div class="mc-card-expand" onclick="event.stopPropagation();expandMultichartCard(\'' + escapedCa + '\')" title="Open coin modal">' +
            '<svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M800-600v-120H680v-80h120q33 0 56.5 23.5T880-720v120h-80Zm-720 0v-120q0-33 23.5-56.5T160-800h120v80H160v120H80Zm600 440v-80h120v-120h80v120q0 33-23.5 56.5T800-160H680Zm-520 0q-33 0-56.5-23.5T80-240v-120h80v120h120v80H160Zm80-160v-320h480v320H240Zm80-80h320v-160H320v160Zm0 0v-160 160Z"/></svg>' +
          '</div>' +
          '<div class="mc-card-trash" onclick="removeMultichartCard(\'' + escapedCa + '\')">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 1.5V2.5H3C2.44772 2.5 2 2.94772 2 3.5V4.5C2 5.05228 2.44772 5.5 3 5.5H21C21.5523 5.5 22 5.05228 22 4.5V3.5C22 2.94772 21.5523 2.5 21 2.5H16V1.5C16 0.947715 15.5523 0.5 15 0.5H9C8.44772 0.5 8 0.947715 8 1.5Z"/><path d="M3.9231 7.5H20.0767L19.1344 20.2216C19.0183 21.7882 17.7135 23 16.1426 23H7.85724C6.28636 23 4.98148 21.7882 4.86544 20.2216L3.9231 7.5Z"/></svg>' +
          '</div>' +
          '<div class="mc-card-dots" onclick="mcToggleCardMenu(this, \'' + escapedCa + '\')">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Insert before the add-slot
    var addSlot = grid.querySelector('.mc-add-slot');
    if (addSlot) {
      grid.insertBefore(card, addSlot);
    } else {
      grid.appendChild(card);
    }

    // Re-render add slot (updates position / hides if full)
    _ensureAddSlot();

    _initChartWidget(t, chartId);
  }

  // ---- Init TradingView widget ----
  function _initChartWidget(t, containerId) {
    function _create() {
      if (!window.TradingView) return;
      var chain = (t.net || 'solana').toLowerCase();
      try {
        _mcWidgets[containerId] = new TradingView.widget({
          container: containerId,
          locale: 'en',
          library_path: '/charting_library/',
          datafeed: _buildDatafeed(t),
          symbol: t.sym + '/' + (pairTokenMap[chain] || 'SOL'),
          interval: '15',
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
          },
          studies_overrides: {
            'volume.volume.color.0': 'rgba(239,68,68,0.25)',
            'volume.volume.color.1': 'rgba(34,197,94,0.25)',
          },
          disabled_features: ['header_symbol_search', 'symbol_search_hot_key', 'header_compare', 'display_market_status', 'go_to_date', 'timeframes_toolbar', 'use_localstorage_for_settings', 'left_toolbar', 'control_bar', 'legend_widget'],
          enabled_features: ['create_volume_indicator_by_default'],
        });
      } catch (e) { console.warn('MC chart error:', e); }
    }

    if (window.TradingView) {
      setTimeout(_create, 50);
    } else {
      if (typeof loadTradingView === 'function') {
        loadTradingView(_create);
      } else {
        var s = document.createElement('script');
        s.src = '/charting_library/charting_library.standalone.js';
        s.onload = _create;
        document.head.appendChild(s);
      }
    }
  }

  // ---- 3-dot card menu (reuses row-chrome-menu style) ----
  var _mcActiveMenu = null;
  var _mcActiveDots = null;

  window.mcToggleCardMenu = function(dotsEl, ca) {
    if (_mcActiveDots === dotsEl) { mcCloseCardMenu(); return; }
    mcCloseCardMenu();

    var t = _mcTokens.find(function(tok) { return tok.ca.toLowerCase() === ca.toLowerCase(); });
    if (!t) return;
    var escapedCa = ca.replace(/'/g, "\\'");
    var net = (t.net || 'solana').toLowerCase();
    var caLabel = ca ? (ca.slice(0,4) + '...' + ca.slice(-4)) : 'N/A';

    var explorers = {
      solana: { url:'https://solscan.io/token/'+ca, name:'Solscan' },
      eth: { url:'https://etherscan.io/token/'+ca, name:'Etherscan' },
      base: { url:'https://basescan.org/token/'+ca, name:'Basescan' },
      bsc: { url:'https://bscscan.com/token/'+ca, name:'BscScan' },
      tron: { url:'https://tronscan.org/#/token20/'+ca, name:'Tronscan' },
      sui: { url:'https://suiscan.xyz/mainnet/coin/'+ca, name:'Suiscan' },
      arbitrum: { url:'https://arbiscan.io/token/'+ca, name:'Arbiscan' },
      avalanche: { url:'https://snowtrace.io/token/'+ca, name:'Snowtrace' },
      polygon: { url:'https://polygonscan.com/token/'+ca, name:'Polygonscan' },
      optimism: { url:'https://optimistic.etherscan.io/token/'+ca, name:'Optimism Explorer' },
      blast: { url:'https://blastscan.io/token/'+ca, name:'Blastscan' },
      ton: { url:'https://tonviewer.com/'+ca, name:'TON Viewer' },
      pulsechain: { url:'https://scan.pulsechain.com/token/'+ca, name:'PulseScan' },
      seiv2: { url:'https://seitrace.com/token/'+ca, name:'Seitrace' }
    };
    var exp = explorers[net] || explorers.solana;
    var expIcon = '';
    if (typeof SCANNER_ICONS !== 'undefined' && SCANNER_ICONS[net]) expIcon = SCANNER_ICONS[net];
    else if (typeof CHAIN_ICONS !== 'undefined' && CHAIN_ICONS[net]) expIcon = CHAIN_ICONS[net];

    var menu = document.createElement('div');
    menu.className = 'row-chrome-menu';
    var html = '';
    html += '<span onclick="event.stopPropagation();navigator.clipboard.writeText(\'' + escapedCa + '\');var s=this;var o=s.childNodes[1];o.nodeValue=\' Copied!\';setTimeout(function(){o.nodeValue=\' ' + caLabel + '\';},1200)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M760-200H320q-33 0-56.5-23.5T240-280v-560q0-33 23.5-56.5T320-920h280l240 240v400q0 33-23.5 56.5T760-200ZM560-640v-200H320v560h440v-360H560ZM160-40q-33 0-56.5-23.5T80-120v-560h80v560h440v80H160Zm160-800v200-200 560-560Z"/></svg> ' + caLabel + '</span>';
    html += '<a href="https://x.com/search?q=' + encodeURIComponent('$' + t.sym + ' OR ' + ca) + '&src=typed_query&f=live" target="_blank" onclick="event.stopPropagation()"><svg class="ico-search" viewBox="0 0 32 32" fill="currentColor"><path d="M16.906 20.188l5.5 5.5-2.25 2.281-5.75-5.781c-1.406 0.781-3.031 1.219-4.719 1.219-5.344 0-9.688-4.344-9.688-9.688s4.344-9.688 9.688-9.688 9.719 4.344 9.719 9.688c0 2.5-0.969 4.781-2.5 6.469zM3.219 13.719c0 3.594 2.875 6.469 6.469 6.469s6.469-2.875 6.469-6.469-2.875-6.469-6.469-6.469-6.469 2.875-6.469 6.469z"/></svg>Search on X</a>';
    html += '<a href="' + exp.url + '" target="_blank" onclick="event.stopPropagation()"><img src="' + expIcon + '" onerror="this.style.display=\'none\'">' + exp.name + '</a>';
    html += '<span onclick="event.stopPropagation();mcCloseCardMenu();window._modalToken={ca:\'' + escapedCa + '\',sym:\'' + ((t.sym||'').replace(/'/g,'')) + '\',net:\'' + net + '\'};if(typeof openBoostModal===\'function\')openBoostModal()" style="background:rgba(234,179,8,0.15);color:#eab308;border-radius:0 0 10px 10px;margin:0;padding:10px 14px;box-sizing:border-box"><svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Boost Token</span>';
    menu.innerHTML = html;

    _mcActiveDots = dotsEl;
    _mcActiveMenu = menu;
    document.body.appendChild(menu);

    // Position near the dots
    var rect = dotsEl.getBoundingClientRect();
    menu.style.left = (rect.right + 4) + 'px';
    menu.style.top = rect.top + 'px';

    // Adjust if off-screen
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 10) {
      menu.style.left = (rect.left - menuRect.width - 4) + 'px';
    }
    if (menuRect.bottom > window.innerHeight - 10) {
      menu.style.top = (window.innerHeight - menuRect.height - 10) + 'px';
    }

    requestAnimationFrame(function() { menu.classList.add('open'); });
  };

  function mcCloseCardMenu() {
    if (_mcActiveMenu) { _mcActiveMenu.remove(); _mcActiveMenu = null; }
    _mcActiveDots = null;
  }
  window.mcCloseCardMenu = mcCloseCardMenu;

  document.addEventListener('click', function(e) {
    if (_mcActiveMenu && !e.target.closest('.mc-card-dots') && !e.target.closest('.row-chrome-menu')) mcCloseCardMenu();
  });

  // ---- Expand to full modal ----
  window.expandMultichartCard = function(ca) {
    var t = _mcTokens.find(function(tok) { return tok.ca.toLowerCase() === ca.toLowerCase(); });
    if (!t) return;
    closeMultichart();
    if (typeof openBubbleModal === 'function') {
      openBubbleModal(t);
    } else if (typeof selectSearchResult === 'function') {
      selectSearchResult(t.ca, t.sym);
    }
  };

  window.toggleMcFullscreen = function(btn, ca) {
    var card = btn.closest('.mc-card');
    if (!card) return;
    var isFS = card.classList.toggle('mc-card-fullscreen-active');
    // Resize the TradingView widget so it fills the new size
    var chartEl = card.querySelector('.mc-card-chart');
    if (chartEl && _mcWidgets[chartEl.id]) {
      try { _mcWidgets[chartEl.id].resize(); } catch(e) {}
    }
    // Close fullscreen on Escape
    if (isFS) {
      card._mcEscHandler = function(e) {
        if (e.key === 'Escape') {
          card.classList.remove('mc-card-fullscreen-active');
          if (chartEl && _mcWidgets[chartEl.id]) { try { _mcWidgets[chartEl.id].resize(); } catch(ex) {} }
          document.removeEventListener('keydown', card._mcEscHandler);
          card._mcEscHandler = null;
        }
      };
      document.addEventListener('keydown', card._mcEscHandler);
    } else if (card._mcEscHandler) {
      document.removeEventListener('keydown', card._mcEscHandler);
      card._mcEscHandler = null;
    }
  };

  // ---- Remove chart ----
  window.removeMultichartCard = function(ca) {
    _mcConfirm('Are you sure you want to delete this chart?', function() { _doRemoveCard(ca); });
  };
  function _doRemoveCard(ca) {
    ca = ca.toLowerCase();
    _mcTokens = _mcTokens.filter(function(t) { return t.ca.toLowerCase() !== ca; });
    _save();
    _updateCount();
    var grid = document.getElementById('mcGrid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.mc-card');
    for (var i = 0; i < cards.length; i++) {
      if ((cards[i].getAttribute('data-ca') || '').toLowerCase() === ca) {
        var chartEl = cards[i].querySelector('.mc-card-chart');
        if (chartEl && _mcWidgets[chartEl.id]) {
          try { _mcWidgets[chartEl.id].remove(); } catch(e) {}
          delete _mcWidgets[chartEl.id];
        }
        cards[i].remove();
        break;
      }
    }
    _ensureAddSlot();
  };

  // ---- Search ----
  function _setupSearch() {
    var inp = document.getElementById('mcSearch');
    if (!inp) return;
    inp.addEventListener('input', function() {
      clearTimeout(_searchTimeout);
      var q = inp.value.trim();
      if (q.length < 2) {
        document.getElementById('mcResults').style.display = 'none';
        document.getElementById('mcSearchFloat').classList.remove('has-results');
        return;
      }
      _searchTimeout = setTimeout(function() { _doSearch(q); }, 300);
    });
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        mcCloseSearch();
      }
    });
    window.addEventListener('resize', function() { if (window._mcAddMode) _positionFloat(); });
  }

  function _doSearch(query) {
    var results = document.getElementById('mcResults');
    results.style.display = 'block';
    document.getElementById('mcSearchFloat').classList.add('has-results');
    results.innerHTML = '<div class="mc-search-loading">Searching...</div>';

    var isAddress = query.length > 30 || query.startsWith('0x');
    var promises = [];

    var chainMap = { solana:'solana', ethereum:'eth', base:'base', bsc:'bsc', sui:'sui', tron:'tron', arbitrum:'arbitrum', avalanche:'avalanche', polygon:'polygon', optimism:'optimism', blast:'blast', ton:'ton' };

    if (isAddress) {
      promises.push(
        fetch('https://api.dexscreener.com/tokens/v1/solana/' + query)
          .then(function(r) { return r.json(); })
          .then(function(pairs) {
            if (!pairs || !pairs.length) return [];
            return pairs.slice(0, 5).map(function(p) {
              var pc = p.priceChange || {};
              return {
                ca: p.baseToken.address, sym: p.baseToken.symbol, name: p.baseToken.name,
                net: chainMap[p.chainId] || p.chainId,
                price: parseFloat(p.priceUsd) || 0, mcap: p.marketCap || p.fdv || 0,
                p24h: pc.h24 ? parseFloat(pc.h24) : 0,
                vol: p.volume ? (p.volume.h24 || 0) : 0,
                img: p.info && p.info.imageUrl || '', pairAddress: p.pairAddress,
              };
            });
          })
          .catch(function() { return []; })
      );
    }

    promises.push(
      fetch('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(query))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d || !d.pairs) return [];
          var seen = {};
          d.pairs.forEach(function(p) {
            var addr = (p.baseToken.address || '').toLowerCase();
            if (!seen[addr] || (p.liquidity && p.liquidity.usd || 0) > (seen[addr].liq || 0)) {
              var pc = p.priceChange || {};
              seen[addr] = {
                ca: p.baseToken.address, sym: p.baseToken.symbol, name: p.baseToken.name,
                net: chainMap[p.chainId] || p.chainId,
                price: parseFloat(p.priceUsd) || 0, mcap: p.marketCap || p.fdv || 0,
                p24h: pc.h24 ? parseFloat(pc.h24) : 0,
                vol: p.volume ? (p.volume.h24 || 0) : 0,
                img: p.info && p.info.imageUrl || '', pairAddress: p.pairAddress,
                liq: p.liquidity && p.liquidity.usd || 0,
              };
            }
          });
          var out = [];
          for (var k in seen) out.push(seen[k]);
          out.sort(function(a, b) { return (b.liq || 0) - (a.liq || 0); });
          return out.slice(0, 8);
        })
        .catch(function() { return []; })
    );

    Promise.all(promises).then(function(arrays) {
      var all = [];
      var seenCa = {};
      arrays.forEach(function(arr) {
        arr.forEach(function(t) {
          var k = t.ca.toLowerCase();
          if (!seenCa[k]) { seenCa[k] = true; all.push(t); }
        });
      });
      _renderResults(all);
    });
  }

  function _fmtMcap(n) {
    if (!n) return '$0';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }

  var chainIcons = {
    solana: '/img/sol.png', eth: '/img/eth.png', base: '/img/base.png',
    bsc: '/img/bsc.png', sui: '/img/sui.png', tron: '/img/tron.png',
    arbitrum: '/img/arb.png', avalanche: '/img/avax.png', polygon: '/img/polygon.png',
    optimism: '/img/op.png', blast: '/img/blast.png', ton: '/img/ton.png',
  };

  function _fmtPrice(p) {
    if (!p) return '$0';
    if (p >= 1000) return '$' + p.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (p >= 1) return '$' + p.toFixed(2);
    if (p >= 0.01) return '$' + p.toFixed(4);
    if (p >= 0.0001) return '$' + p.toFixed(6);
    var s = p.toFixed(12);
    var m = s.match(/^0\.(0+)/);
    if (m) {
      var zeros = m[1].length;
      var sig = s.slice(2 + zeros, 2 + zeros + 4).replace(/0+$/, '');
      return '$0.0' + '<sub>' + zeros + '</sub>' + sig;
    }
    return '$' + p.toFixed(8);
  }

  var GRADIENTS = ['#6366f1,#a78bfa','#f43f5e,#fb923c','#10b981,#34d399','#3b82f6,#60a5fa','#ec4899,#f472b6','#8b5cf6,#c084fc','#f59e0b,#fbbf24','#14b8a6,#2dd4bf'];

  function _renderResults(tokens) {
    var results = document.getElementById('mcResults');
    if (!tokens.length) {
      results.innerHTML = '<div class="mc-search-empty">No tokens found</div>';
      return;
    }
    var html = '';
    tokens.forEach(function(t) {
      var c24h = Math.max(-9999, Math.min(9999, t.p24h || 0));
      var c24hCls = c24h >= 0 ? 'up' : 'down';
      var c24hStr = (c24h >= 0 ? '+' : '') + c24h.toFixed(2) + '%';
      var chainIcon = chainIcons[t.net] || chainIcons.solana;
      var alreadyAdded = _mcTokens.some(function(mt) { return mt.ca.toLowerCase() === t.ca.toLowerCase(); });
      var gradIdx = Math.abs((t.sym.charCodeAt(0) || 0) * 7 + (t.sym.charCodeAt(1) || 0) * 13) % GRADIENTS.length;
      var grad = GRADIENTS[gradIdx];
      var letter = t.sym ? t.sym.charAt(0) : '?';
      var avatarHtml = t.img
        ? '<img class="search-modal-item-avatar" src="' + t.img + '" style="object-fit:cover" onerror="this.style.display=\'none\'">'
        : '<div class="search-modal-item-avatar" style="background:linear-gradient(135deg,' + grad + ')">' + letter + '</div>';
      var dataJson = JSON.stringify({ ca: t.ca, sym: t.sym, name: t.name, net: t.net, price: t.price, mcap: t.mcap, p24h: t.p24h, img: t.img, pairAddress: t.pairAddress }).replace(/'/g, '&#39;');

      html +=
        '<div class="search-modal-item' + (alreadyAdded ? ' mc-result-added' : '') + '" onclick="' + (alreadyAdded ? '' : '_mcAddFromSearch(this)') + '" data-token=\'' + dataJson + '\'>' +
          '<div class="smi-top">' +
            '<div class="smi-token-info">' +
              '<div class="smi-left">' + avatarHtml +
                '<img class="search-modal-item-chain" src="' + chainIcon + '">' +
              '</div>' +
              '<div class="smi-name-block">' +
                '<span class="smi-sym">' + t.sym + '</span>' +
                '<span class="smi-fullname">' + (t.name || '').slice(0, 24) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="smi-data-pair"><span class="smi-col-price">' + _fmtPrice(t.price) + '</span>' +
            '<span class="smi-col-mcap"><span class="smi-label">MC</span> ' + _fmtMcap(t.mcap) + '</span></div>' +
            '<div class="smi-data-pair"><span class="smi-col-pct ' + c24hCls + '">' + c24hStr + '</span>' +
            '<span class="smi-col-vol"><span class="smi-label">Vol</span> ' + _fmtMcap(t.vol || 0) + '</span></div>' +
          '</div>' +
        '</div>';
    });
    results.innerHTML = html;
  }

  window._mcAddFromSearch = function(el) {
    try {
      var t = JSON.parse(el.getAttribute('data-token'));
      if (_mcTokens.length >= MAX_CHARTS) return;
      _addChart(t);
      mcCloseSearch();
    } catch (e) {}
  };

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', function() {
    _setupSearch();

    // Reflect saved-chart count in the nav badge before the panel is opened.
    // Don't populate _mcTokens here — openMultichart() restores them on first
    // open and relies on _mcTokens being empty to know it hasn't restored yet.
    try {
      var savedInit = _load();
      var n = (savedInit && savedInit.length) || 0;
      ['multichartBadge', 'multichartBadgeMob'].forEach(function(id) {
        var badge = document.getElementById(id);
        if (!badge) return;
        if (n > 0) { badge.textContent = n; badge.classList.add('visible'); }
        else { badge.classList.remove('visible'); }
      });
    } catch (e) {}

    // When multichart is open, clicking any sidebar / mobile-menu action
    // (a chain, watchlist, contact, etc.) should close the multichart and let
    // that action run behind it — so the user "goes back" and sees the result.
    document.addEventListener('click', function(e) {
      if (!document.body.classList.contains('mc-open')) return;
      var t = e.target;
      var link = t && t.closest ? t.closest('.ms-nav-link, .ms-mobile-item, .mob-menu-circle') : null;
      if (!link) return;
      // Don't auto-close on the link that (re)opens the multichart itself.
      if (link.id === 'navMultichart') return;
      var oc = (link.getAttribute && link.getAttribute('onclick')) || '';
      if (oc.indexOf('openMultichart') !== -1) return;
      closeMultichart();
    }, true);
  });

})();
