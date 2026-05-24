function showEmbedCode() {
  var t = window._modalToken;
  if(!t || !t.ca) return;
  var chain = (t.net || 'solana').toLowerCase();
  var url = window.location.origin + '/' + chain + '/' + t.ca;
  var embedUrl = window.location.origin + '/embed/' + chain + '/' + t.ca;
  var iframe = '<iframe src="' + embedUrl + '" width="600" height="420" frameborder="0" style="border-radius:8px;border:1px solid var(--border-strong)"></iframe>';
  document.getElementById('embedDirectLink').value = url;
  document.getElementById('embedCode').value = iframe;
  document.getElementById('embedPopupOverlay').classList.add('open');
}
function closeEmbedPopup() {
  document.getElementById('embedPopupOverlay').classList.remove('open');
}
function copyEmbedCode() {
  var el = document.getElementById('embedCode');
  navigator.clipboard.writeText(el.value).then(function() {
    var btn = document.querySelector('.embed-popup-btn.copy');
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = orig; }, 1500);
  });
}
function copyDirectLink() {
  var el = document.getElementById('embedDirectLink');
  navigator.clipboard.writeText(el.value).then(function() {
    var btns = document.querySelectorAll('.embed-popup-btn.copy');
    var btn = btns[1];
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = orig; }, 1500);
  });
}
  // Brightness/contrast slider
  function setBrightness(val) {
    document.documentElement.style.filter = val == 100 ? '' : 'brightness(' + (val / 100) + ')';
    document.querySelectorAll('.ms-brightness-slider').forEach(function(s) { s.value = val; });
    try { localStorage.setItem('ms-brightness', val); } catch(e) {}
  }
  /* brightness: apply default 115% on load */
  setBrightness(110);

  // Sidebar watchlist — no panel, just adds to sidebar bottom
  function renderSidebarWatchlist() {
    var container = document.getElementById('msSidebarWatchlist');
    var items = document.getElementById('msSidebarWlItems');
    var count = document.getElementById('msSidebarWlCount');
    if (!container || !items) return;

    if (!watchlist || watchlist.length === 0) {
      container.classList.remove('has-items');
      items.innerHTML = '';
      if (count) count.textContent = '';
      return;
    }

    container.classList.add('has-items');
    if (count) count.textContent = watchlist.length;

    var html = '';
    watchlist.forEach(function(sym) {
      var token = (typeof LIVE_TOKENS !== 'undefined') ? LIVE_TOKENS.find(function(t) { return t.sym === sym; }) : null;
      if (!token) {
        html += '<div class="ms-sidebar-wl-token"><span class="ms-sidebar-wl-sym">' + sym + '</span><span class="ms-sidebar-wl-change">—</span></div>';
        return;
      }
      var changeVal = token.p24h || 0;
      var cls = changeVal >= 0 ? 'up' : 'down';
      var changeStr = (changeVal >= 0 ? '+' : '') + changeVal.toFixed(1) + '%';
      var imgSrc = token.img || '';
      html += '<div class="ms-sidebar-wl-token" onclick="if(typeof openTokenModal===\'function\'){var i=LIVE_TOKENS.indexOf(LIVE_TOKENS.find(function(t){return t.sym===\'' + sym + '\'}));if(i>=0)openTokenModal(i);}">';
      html += '<img class="ms-sidebar-wl-token-img" src="' + imgSrc + '" onerror="this.style.display=\'none\'">';
      html += '<span class="ms-sidebar-wl-sym">' + sym + '</span>';
      html += '<span class="ms-sidebar-wl-change ' + cls + '">' + changeStr + '</span>';
      html += '</div>';
    });
    items.innerHTML = html;
  }

  // Hook into existing renderWatchlist to also update sidebar
  var _origRenderWatchlist = (typeof renderWatchlist === 'function') ? renderWatchlist : null;
  renderWatchlist = function() {
    if (_origRenderWatchlist) _origRenderWatchlist();
    renderSidebarWatchlist();
  };

  // Initial render
  setTimeout(renderSidebarWatchlist, 500);

  function openMsMenu() {
    document.getElementById('msMobileMenu').classList.add('open');
    document.getElementById('msMobileOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeMsMenu() {
    document.getElementById('msMobileMenu').classList.remove('open');
    document.getElementById('msMobileOverlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  // Toggle body class on sidebar hover for header-logo hide
  (function() {
    var sb = document.querySelector('.ms-sidebar');
    if (sb) {
      sb.addEventListener('mouseenter', function() {
        if (!sb.classList.contains('sidebar-locked'))
          document.body.classList.add('ms-sb-open');
      });
      sb.addEventListener('mouseleave', function() {
        document.body.classList.remove('ms-sb-open');
      });
    }
  })();

  // ==================== LANGUAGE / i18n ====================
  // Dictionary keyed by English source text → translation per language
  // Matched via exact text content on common UI elements
  var MS_TRANSLATIONS = {
    zh: {
      'Top': '热门', 'Gainers': '涨幅', 'Losers': '跌幅',
      'All Chains': '所有链', 'Watchlist': '关注', 'Alerts': '提醒',
      'Settings': '设置', 'Social Feed': '社交', 'Trending': '趋势',
      'Search': '搜索', 'Connect': '连接', 'Previous': '上一页', 'Next': '下一页',
      'Theme': '主题', 'Light': '浅色', 'Default': '默认',
      'Connect Phantom Wallet': '连接 Phantom 钱包',
      'X (Twitter)': 'X (推特)', 'GitHub': 'GitHub', 'Contact': '联系',
      'Market Cap': '市值', '24H Volume': '24小时成交量', 'Liquidity': '流动性', 'Age': '创建时间',
      'Token': '代币', 'Price': '价格', 'Volume': '成交量', 'MCap': '市值',
      'New Pair': '新交易对', 'Gainer': '涨幅', 'Loser': '跌幅',
      'MultiChart': '多图表', 'DexHub': 'DexHub',
      'Recent Searches': '最近搜索', 'No recent searches': '无最近搜索',
      'Share / Embed': '分享 / 嵌入', 'Direct Link': '直接链接', 'Embed Code': '嵌入代码',
      'Copy Link': '复制链接', 'Copy Embed Code': '复制嵌入代码', 'Close': '关闭',
      'Boost Token': '推广代币', 'Boost Now': '立即推广',
      'Loading scopes...': '加载中...', 'No tokens match the current filters': '没有符合当前筛选的代币'
    },
    ko: {
      'Top': '인기', 'Gainers': '상승', 'Losers': '하락',
      'All Chains': '모든 체인', 'Watchlist': '관심목록', 'Alerts': '알림',
      'Settings': '설정', 'Social Feed': '소셜', 'Trending': '트렌딩',
      'Search': '검색', 'Connect': '연결', 'Previous': '이전', 'Next': '다음',
      'Theme': '테마', 'Light': '라이트', 'Default': '기본',
      'Connect Phantom Wallet': 'Phantom 지갑 연결',
      'X (Twitter)': 'X (트위터)', 'GitHub': 'GitHub', 'Contact': '문의',
      'Market Cap': '시가총액', '24H Volume': '24시간 거래량', 'Liquidity': '유동성', 'Age': '생성일',
      'Token': '토큰', 'Price': '가격', 'Volume': '거래량', 'MCap': '시총',
      'New Pair': '새 페어', 'Gainer': '상승', 'Loser': '하락',
      'MultiChart': '멀티차트', 'DexHub': 'DexHub',
      'Recent Searches': '최근 검색', 'No recent searches': '최근 검색 없음',
      'Share / Embed': '공유 / 임베드', 'Direct Link': '직접 링크', 'Embed Code': '임베드 코드',
      'Copy Link': '링크 복사', 'Copy Embed Code': '임베드 복사', 'Close': '닫기',
      'Boost Token': '토큰 부스트', 'Boost Now': '지금 부스트',
      'Loading scopes...': '로딩 중...', 'No tokens match the current filters': '일치하는 토큰이 없습니다'
    },
    es: {
      'Top': 'Top', 'Gainers': 'Ganadores', 'Losers': 'Perdedores',
      'All Chains': 'Todas las cadenas', 'Watchlist': 'Seguimiento', 'Alerts': 'Alertas',
      'Settings': 'Ajustes', 'Social Feed': 'Social', 'Trending': 'Tendencias',
      'Search': 'Buscar', 'Connect': 'Conectar', 'Previous': 'Anterior', 'Next': 'Siguiente',
      'Theme': 'Tema', 'Light': 'Claro', 'Default': 'Predeterminado',
      'Connect Phantom Wallet': 'Conectar Phantom',
      'X (Twitter)': 'X (Twitter)', 'GitHub': 'GitHub', 'Contact': 'Contacto',
      'Market Cap': 'Capitalización', '24H Volume': 'Volumen 24H', 'Liquidity': 'Liquidez', 'Age': 'Edad',
      'Token': 'Token', 'Price': 'Precio', 'Volume': 'Volumen', 'MCap': 'Cap.',
      'New Pair': 'Nuevo Par', 'Gainer': 'Ganador', 'Loser': 'Perdedor',
      'MultiChart': 'MultiGrafico', 'DexHub': 'DexHub',
      'Recent Searches': 'Búsquedas recientes', 'No recent searches': 'Sin búsquedas recientes',
      'Share / Embed': 'Compartir / Insertar', 'Direct Link': 'Enlace directo', 'Embed Code': 'Código para insertar',
      'Copy Link': 'Copiar enlace', 'Copy Embed Code': 'Copiar código', 'Close': 'Cerrar',
      'Boost Token': 'Impulsar Token', 'Boost Now': 'Impulsar ahora',
      'Loading scopes...': 'Cargando...', 'No tokens match the current filters': 'No hay tokens que coincidan'
    }
  };

  // Store original English text the first time we translate, so we can switch back
  var MS_ORIG_TEXTS = new WeakMap();

  function msTranslateNode(node, dict) {
    var txt = (node.nodeValue || '').trim();
    if (!txt) return;
    // Cache original text
    if (!MS_ORIG_TEXTS.has(node)) MS_ORIG_TEXTS.set(node, node.nodeValue);
    var orig = MS_ORIG_TEXTS.get(node).trim();
    if (dict === null) {
      // Reset to English
      node.nodeValue = MS_ORIG_TEXTS.get(node);
    } else if (dict[orig]) {
      node.nodeValue = node.nodeValue.replace(orig, dict[orig]);
    }
  }

  function msApplyTranslations(lang) {
    var dict = lang === 'en' ? null : MS_TRANSLATIONS[lang];
    if (lang !== 'en' && !dict) return; // Unknown lang, skip
    // Walk text nodes in the whole body
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n) {
        // Skip script/style content
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while (node = walker.nextNode()) {
      msTranslateNode(node, dict);
    }
  }

  function setLanguage(lang) {
    // Update active flag state in both desktop sidebar and mobile menu
    document.querySelectorAll('.ms-flag').forEach(function(f) {
      if (f.dataset.lang === lang) f.classList.add('active');
      else f.classList.remove('active');
    });
    msApplyTranslations(lang);
    try { localStorage.setItem('ms-lang', lang); } catch (e) {}
  }

  // Apply saved language on page load
  (function() {
    try {
      var saved = localStorage.getItem('ms-lang');
      if (saved && saved !== 'en') {
        // Wait a tick for dynamic content to render
        setTimeout(function() { setLanguage(saved); }, 300);
      }
    } catch (e) {}
  })();
