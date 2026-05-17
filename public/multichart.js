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
      slot.onclick = function() { mcOpenSearch(); };
      slot.innerHTML =
        '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>' +
        '<span>Add Chart</span>' +
        '<span class="mc-slot-count">' + _mcTokens.length + ' / ' + MAX_CHARTS + '</span>';
      grid.appendChild(slot);
    }
  }

  // ---- Update count on the add-slot card ----
  function _updateCount() {
    var grid = document.getElementById('mcGrid');
    if (!grid) return;
    var countEl = grid.querySelector('.mc-slot-count');
    if (countEl) countEl.textContent = _mcTokens.length + ' / ' + MAX_CHARTS;
  }

  // ---- Open / Close ----
  window.openMultichart = function() {
    var overlay = document.getElementById('mcOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
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
  };

  window.closeMultichart = function() {
    var overlay = document.getElementById('mcOverlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    mcCloseSearch();
    var mcNav = document.getElementById('navMultichart');
    if(mcNav) { mcNav.classList.remove('pill-animate'); mcNav.classList.remove('active'); }
  };

  // ---- Floating search open / close ----
  window.mcOpenSearch = function() {
    var float = document.getElementById('mcSearchFloat');
    if (float) float.classList.add('open');
    setTimeout(function() {
      var inp = document.getElementById('mcSearch');
      if (inp) inp.focus();
    }, 200);
  };
  window.mcCloseSearch = function() {
    var float = document.getElementById('mcSearchFloat');
    if (float) { float.classList.remove('open'); float.classList.remove('has-results'); }
    var results = document.getElementById('mcResults');
    if (results) results.style.display = 'none';
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
        var iv = setInterval(function() {
          fetchDexToken(t.ca).then(function(d) {
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
          }).catch(function() {});
        }, 2000);
        _mcSubIntervals[guid] = iv;
      },
      unsubscribeBars: function(guid) {
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

    card.innerHTML =
      '<div class="mc-card-header">' +
        '<div class="mc-card-info">' +
          '<span class="mc-card-sym">' + (t.sym || '???') + '</span>' +
          '<span class="mc-card-pair">/ ' + (pairTokenMap[(t.net || 'solana').toLowerCase()] || 'SOL') + '</span>' +
          '<span class="mc-card-pct ' + pctClass + '">' + pctText + '</span>' +
        '</div>' +
        '<div class="mc-card-actions">' +
          '<span class="mc-card-price">' + _fmtPrice(t.price) + '</span>' +
          '<button class="mc-card-expand" onclick="expandMultichartCard(\'' + t.ca.replace(/'/g, "\\'") + '\')">' +
            '<svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-120q-33 0-56.5-23.5T120-200v-160h80v160h160v80H200Zm400 0v-80h160v-160h80v160q0 33-23.5 56.5T760-120H600ZM120-600v-160q0-33 23.5-56.5T200-840h160v80H200v160h-80Zm640 0v-160H600v-80h160q33 0 56.5 23.5T840-760v160h-80Z"/></svg>' +
          '</button>' +
          '<button class="mc-card-close" onclick="removeMultichartCard(\'' + t.ca.replace(/'/g, "\\'") + '\')">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="mc-card-chart" id="' + chartId + '"></div>';

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

  // ---- Remove chart ----
  window.removeMultichartCard = function(ca) {
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
  });

})();
