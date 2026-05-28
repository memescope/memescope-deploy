// ========== BOOST SYSTEM ==========
var BOOST_API = 'https://memescope-api.vercel.app/api/boost';
var BOOST_PAYMENT_WALLET = '82p2EEAB5jobWxVYjGN4aZm84ZGcK3TSzpHqTXv5kvMg';
var BOOST_TIERS = { 20: 99, 50: 199, 100: 399, 500: 999 };

var boostState = {
  selectedTier: null,
  walletConnected: false,
  walletAddress: null,
  tokenCA: null,
  tokenSym: null,
  solPrice: null,
  activeBoosts: {},  // ca → {boostCount, expiration}
  paying: false,
};

// Fetch SOL price for tier conversion
async function fetchSolPrice() {
  try {
    var resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    var data = await resp.json();
    boostState.solPrice = data.solana.usd;
    updateBoostSolPrices();
  } catch(e) {
    console.log('SOL price fetch error:', e);
    // Fallback
    boostState.solPrice = 150;
    updateBoostSolPrices();
  }
}

function updateBoostSolPrices() {
  if (!boostState.solPrice) return;
  for (var tier of [20, 50, 100, 500]) {
    var solAmount = (BOOST_TIERS[tier] / boostState.solPrice).toFixed(3);
    var el = document.getElementById('boostSol' + tier);
    if (el) el.textContent = '≈ ' + solAmount + ' SOL';
  }
}

// Fetch active boosts
async function fetchActiveBoosts() {
  try {
    var resp = await fetch(BOOST_API);
    if (resp.ok) {
      var data = await resp.json();
      boostState.activeBoosts = data.boosts || {};
      applyBoostsToTokens();
    }
  } catch(e) { console.log('Boost fetch error:', e); }
}

// Apply boost data to LIVE_TOKENS
function applyBoostsToTokens() {
  if (typeof LIVE_TOKENS === 'undefined') return;
  for (var i = 0; i < LIVE_TOKENS.length; i++) {
    var t = LIVE_TOKENS[i];
    var boostData = boostState.activeBoosts[t.ca];
    if (boostData && boostData.remainingMs > 0) {
      t.boosted = true;
      t.boostCount = boostData.boostCount;
    } else {
      t.boosted = false;
      t.boostCount = 0;
    }
  }
}

// Open boost modal from token modal
function openBoostModal() {
  var t = window._modalToken;
  if (!t) return;

  boostState.tokenCA = t.ca || '';
  boostState.tokenSym = t.sym || '';
  boostState.selectedTier = null;

  document.getElementById('boostModalTitle').textContent = 'Boost ' + t.sym;
  document.getElementById('boostSubtitleText').textContent = 'Get ' + t.sym + ' featured with a ⚡ badge, larger scope, and golden spotlight. Boosts last 24 hours.';
  
  // Reset tier selection
  document.querySelectorAll('.boost-tier-card').forEach(function(c) { c.classList.remove('selected'); });
  
  // Reset status
  var statusEl = document.getElementById('boostStatus');
  statusEl.textContent = '';
  statusEl.className = 'boost-status';

  // Hide pay btn until tier selected
  document.getElementById('boostPayBtn').style.display = 'none';

  // Update wallet display
  updateBoostWalletUI();
  
  // Fetch SOL price
  fetchSolPrice();

  var scrollY = window.scrollY;
  lockScroll();
  document.body.style.position = 'fixed';
  document.body.style.top = '-' + scrollY + 'px';
  document.body.style.width = '100%';
  document.body.style.touchAction = 'none';
  document.getElementById('boostModalOverlay').classList.add('open');
}

function closeBoostModal() {
  var scrollY = Math.abs(parseInt(document.body.style.top || '0'));
  var ov = document.getElementById('boostModalOverlay');
  m3CloseOverlay(ov, function() {
    unlockScroll();
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.touchAction = '';
    window.scrollTo(0, scrollY);
  });
}

/* ── Contact Modal ── */
function openContactModal() {
  var scrollY = window.scrollY;
  lockScroll();
  document.body.style.position = 'fixed';
  document.body.style.top = '-' + scrollY + 'px';
  document.body.style.width = '100%';
  document.body.style.touchAction = 'none';
  document.getElementById('contactOverlay').classList.add('open');
  document.getElementById('contactEmail').value = '';
  document.getElementById('contactSubject').value = '';
  document.getElementById('contactMessage').value = '';
  document.getElementById('contactStatus').textContent = '';
  document.getElementById('contactStatus').className = 'bugreport-status';
  document.getElementById('contactSubmitBtn').disabled = false;
}
function closeContactModal() {
  var scrollY = Math.abs(parseInt(document.body.style.top || '0'));
  var ov = document.getElementById('contactOverlay');
  m3CloseOverlay(ov, function() {
    unlockScroll();
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.touchAction = '';
    window.scrollTo(0, scrollY);
  });
}
function submitContact() {
  var email = document.getElementById('contactEmail').value.trim();
  var subject = document.getElementById('contactSubject').value.trim();
  var message = document.getElementById('contactMessage').value.trim();
  var statusEl = document.getElementById('contactStatus');
  var btn = document.getElementById('contactSubmitBtn');
  if (!message) {
    statusEl.textContent = 'Please write a message before sending.';
    statusEl.className = 'bugreport-status error';
    return;
  }
  btn.disabled = true;
  statusEl.textContent = 'Sending...';
  statusEl.className = 'bugreport-status';
  var body = { message: message, type: 'contact' };
  if (email) body.email = email;
  if (subject) body.subject = subject;
  body.url = window.location.href;
  body.ua = navigator.userAgent;
  fetch('https://memescope-scraper.memescope-io.workers.dev/bug-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(r) {
    if (!r.ok) throw new Error('Server error');
    statusEl.textContent = 'Message sent! We\'ll get back to you soon.';
    statusEl.className = 'bugreport-status success';
    btn.disabled = true;
    setTimeout(closeContactModal, 2500);
  }).catch(function() {
    statusEl.textContent = 'Failed to send. Please try again later.';
    statusEl.className = 'bugreport-status error';
    btn.disabled = false;
  });
}

/* ── Bug Report Modal ── */
function openBugReportModal() {
  lockScroll();
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.touchAction = 'none';
  document.getElementById('bugreportOverlay').classList.add('open');
  document.getElementById('bugreportEmail').value = '';
  document.getElementById('bugreportMessage').value = '';
  document.getElementById('bugreportStatus').textContent = '';
  document.getElementById('bugreportStatus').className = 'bugreport-status';
  document.getElementById('bugreportSubmitBtn').disabled = false;
}
function closeBugReportModal() {
  var ov = document.getElementById('bugreportOverlay');
  m3CloseOverlay(ov, function() {
    unlockScroll();
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.touchAction = '';
  });
}
function submitBugReport() {
  var email = document.getElementById('bugreportEmail').value.trim();
  var message = document.getElementById('bugreportMessage').value.trim();
  var statusEl = document.getElementById('bugreportStatus');
  var btn = document.getElementById('bugreportSubmitBtn');
  if (!message) {
    statusEl.textContent = 'Please describe the bug before sending.';
    statusEl.className = 'bugreport-status error';
    return;
  }
  btn.disabled = true;
  statusEl.textContent = 'Sending...';
  statusEl.className = 'bugreport-status';
  var body = { message: message };
  if (email) body.email = email;
  body.url = window.location.href;
  body.ua = navigator.userAgent;
  fetch('https://memescope-scraper.memescope-io.workers.dev/bug-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(r) {
    if (!r.ok) throw new Error('Server error');
    statusEl.textContent = 'Bug report sent! Thank you for helping us improve.';
    statusEl.className = 'bugreport-status success';
    btn.disabled = true;
    setTimeout(closeBugReportModal, 2500);
  }).catch(function() {
    statusEl.textContent = 'Failed to send. Please try again later.';
    statusEl.className = 'bugreport-status error';
    btn.disabled = false;
  });
}

function selectBoostTier(tier) {
  boostState.selectedTier = tier;
  document.querySelectorAll('.boost-tier-card').forEach(function(c) {
    c.classList.toggle('selected', parseInt(c.dataset.tier) === tier);
  });
  
  // Show pay button if wallet connected
  var payBtn = document.getElementById('boostPayBtn');
  if (boostState.walletConnected) {
    var solAmount = boostState.solPrice ? (BOOST_TIERS[tier] / boostState.solPrice).toFixed(3) : '—';
    payBtn.textContent = '⚡ Pay ' + solAmount + ' SOL ($' + BOOST_TIERS[tier] + ')';
    payBtn.style.display = 'block';
    payBtn.disabled = false;
  } else {
    payBtn.style.display = 'none';
  }
}

// Phantom wallet connection
async function connectPhantom() {
  if (typeof window.solana === 'undefined' || !window.solana.isPhantom) {
    setBoostStatus('Phantom wallet not found. Please install it at phantom.app', 'error');
    window.open('https://phantom.app/', '_blank');
    return;
  }
  
  try {
    setBoostStatus('Connecting to Phantom...', 'pending');
    var resp = await window.solana.connect();
    boostState.walletConnected = true;
    boostState.walletAddress = resp.publicKey.toString();
    updateBoostWalletUI();
    setBoostStatus('Wallet connected!', 'success');
    setTimeout(function() { setBoostStatus('', ''); }, 2000);

    // Show pay btn if tier already selected
    if (boostState.selectedTier) {
      selectBoostTier(boostState.selectedTier);
    }
  } catch(e) {
    setBoostStatus('Connection rejected', 'error');
  }
}

function disconnectPhantom() {
  if (window.solana && window.solana.isPhantom) {
    try { window.solana.disconnect(); } catch(e) {}
  }
  boostState.walletConnected = false;
  boostState.walletAddress = null;
  updateBoostWalletUI();
  document.getElementById('boostPayBtn').style.display = 'none';
}

function updateBoostWalletUI() {
  var area = document.getElementById('boostWalletArea');
  if (boostState.walletConnected && boostState.walletAddress) {
    var addr = boostState.walletAddress;
    var shortAddr = addr.slice(0, 4) + '...' + addr.slice(-4);
    area.innerHTML = '<div class="boost-wallet-connected">' +
      '<img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSI+CjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSIjQUI5RkYyIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNNTUuNjQxNiA4Mi4xNDc3QzUwLjg3NDQgODkuNDUyNSA0Mi44ODYyIDk4LjY5NjYgMzIuMjU2OCA5OC42OTY2QzI3LjIzMiA5OC42OTY2IDIyLjQwMDQgOTYuNjI4IDIyLjQwMDQgODcuNjQyNEMyMi40MDA0IDY0Ljc1ODQgNTMuNjQ0NSAyOS4zMzM1IDgyLjYzMzkgMjkuMzMzNUM5OS4xMjU3IDI5LjMzMzUgMTA1LjY5NyA0MC43NzU1IDEwNS42OTcgNTMuNzY4OUMxMDUuNjk3IDcwLjQ0NzEgOTQuODczOSA4OS41MTcxIDg0LjExNTYgODkuNTE3MUM4MC43MDEzIDg5LjUxNzEgNzkuMDI2NCA4Ny42NDI0IDc5LjAyNjQgODQuNjY4OEM3OS4wMjY0IDgzLjg5MzEgNzkuMTU1MiA4My4wNTI3IDc5LjQxMjkgODIuMTQ3N0M3NS43NDA5IDg4LjQxODIgNjguNjU0NiA5NC4yMzYxIDYyLjAxOTIgOTQuMjM2MUM1Ny4xODc3IDk0LjIzNjEgNTQuNzM5NyA5MS4xOTc5IDU0LjczOTcgODYuOTMxNEM1NC43Mzk3IDg1LjM3OTkgNTUuMDYxOCA4My43NjM4IDU1LjY0MTYgODIuMTQ3N1pNODAuNjEzMyA1My4zMTgyQzgwLjYxMzMgNTcuMTA0NCA3OC4zNzk1IDU4Ljk5NzUgNzUuODgwNiA1OC45OTc1QzczLjM0MzggNTguOTk3NSA3MS4xNDc5IDU3LjEwNDQgNzEuMTQ3OSA1My4zMTgyQzcxLjE0NzkgNDkuNTMyIDczLjM0MzggNDcuNjM4OSA3NS44ODA2IDQ3LjYzODlDNzguMzc5NSA0Ny42Mzg5IDgwLjYxMzMgNDkuNTMyIDgwLjYxMzMgNTMuMzE4MlpNOTQuODEwMiA1My4zMTg0Qzk0LjgxMDIgNTcuMTA0NiA5Mi41NzYzIDU4Ljk5NzcgOTAuMDc3NSA1OC45OTc3Qzg3LjU0MDcgNTguOTk3NyA4NS4zNDQ3IDU3LjEwNDYgODUuMzQ0NyA1My4zMTg0Qzg1LjM0NDcgNDkuNTMyMyA4Ny41NDA3IDQ3LjYzOTIgOTAuMDc3NSA0Ny42MzkyQzkyLjU3NjMgNDcuNjM5MiA5NC44MTAyIDQ5LjUzMjMgOTQuODEwMiA1My4zMTg0WiIgZmlsbD0iI0ZGRkRGOCIvPgo8L3N2Zz4=" width="18" height="18" style="border-radius: 4px">' +
      '<span class="boost-wallet-addr">' + shortAddr + '</span>' +
      '<button class="boost-wallet-disconnect" onclick="disconnectPhantom()">Disconnect</button>' +
      '</div>';
  } else {
    area.innerHTML = '<button class="boost-connect-btn" id="boostConnectBtn" onclick="connectPhantom()">' +
      '<img src="/img/phantom_logo.png" width="20" height="20" style="border-radius: 5px"> Connect Phantom Wallet</button>';
  }
}

// Execute payment
async function executeBoostPayment() {
  if (boostState.paying) return;
  if (!boostState.selectedTier || !boostState.walletConnected || !boostState.tokenCA) {
    setBoostStatus('Please select a tier and connect wallet', 'error');
    return;
  }

  var tier = boostState.selectedTier;
  var usdPrice = BOOST_TIERS[tier];
  var solAmount = boostState.solPrice ? usdPrice / boostState.solPrice : 0;
  
  if (solAmount <= 0) {
    setBoostStatus('Unable to calculate SOL amount. Refresh and try again.', 'error');
    return;
  }

  boostState.paying = true;
  var payBtn = document.getElementById('boostPayBtn');
  payBtn.disabled = true;
  payBtn.textContent = '⏳ Sending transaction...';
  setBoostStatus('Approve the transaction in Phantom...', 'pending');

  try {
    // Create SOL transfer transaction
    var connection = new (window.solanaWeb3 ? window.solanaWeb3.Connection : null)
      || null;
    
    // Use Phantom's built-in transfer
    var lamports = Math.round(solAmount * 1e9);
    
    // Build transaction using the Solana web3 library  
    // We'll load it dynamically if not present
    if (!window.solanaWeb3) {
      // Use Phantom's signAndSendTransaction with a manually built instruction
      setBoostStatus('Preparing transaction...', 'pending');
      
      // Load solana web3.js
      await loadSolanaWeb3();
    }

    var web3 = window.solanaWeb3;
    var conn = new web3.Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    
    var transaction = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: window.solana.publicKey,
        toPubkey: new web3.PublicKey(BOOST_PAYMENT_WALLET),
        lamports: lamports,
      })
    );
    
    transaction.feePayer = window.solana.publicKey;
    var latestBlockhash = await conn.getLatestBlockhash();
    transaction.recentBlockhash = latestBlockhash.blockhash;

    setBoostStatus('Please approve in Phantom...', 'pending');
    var signed = await window.solana.signAndSendTransaction(transaction);
    var txSignature = signed.signature;

    setBoostStatus('Transaction sent! Verifying on-chain...', 'pending');
    payBtn.textContent = '⏳ Verifying...';

    // Wait for confirmation
    await conn.confirmTransaction(txSignature, 'confirmed');

    // Submit to our API
    setBoostStatus('Confirming boost...', 'pending');
    var apiResp = await fetch(BOOST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txSignature: txSignature,
        ca: boostState.tokenCA,
        tier: tier,
        solAmount: solAmount,
      })
    });

    var apiData = await apiResp.json();
    
    if (apiData.success) {
      setBoostStatus('🎉 Token boosted with ⚡' + apiData.boostCount + '! Badge is now live.', 'success');
      
      // Update local token data
      if (typeof LIVE_TOKENS !== 'undefined') {
        for (var i = 0; i < LIVE_TOKENS.length; i++) {
          if (LIVE_TOKENS[i].ca === boostState.tokenCA) {
            LIVE_TOKENS[i].boosted = true;
            LIVE_TOKENS[i].boostCount = apiData.boostCount;
            break;
          }
        }
      }
      
      // Refresh table and bubbles
      if (typeof loadData === 'function') loadData();
      if (typeof init === 'function') setTimeout(init, 500);
      
      // Close boost modal after delay
      setTimeout(closeBoostModal, 3000);
    } else {
      setBoostStatus('Boost verification failed: ' + (apiData.error || 'Unknown error'), 'error');
    }

  } catch(e) {
    console.error('Boost payment error:', e);
    if (e.message && e.message.includes('rejected')) {
      setBoostStatus('Transaction cancelled by user', 'error');
    } else {
      setBoostStatus('Payment error: ' + (e.message || 'Unknown error'), 'error');
    }
  } finally {
    boostState.paying = false;
    payBtn.disabled = false;
    if (boostState.selectedTier && boostState.solPrice) {
      var solAmt = (BOOST_TIERS[boostState.selectedTier] / boostState.solPrice).toFixed(3);
      payBtn.textContent = '⚡ Pay ' + solAmt + ' SOL ($' + BOOST_TIERS[boostState.selectedTier] + ')';
    }
  }
}

function setBoostStatus(msg, cls) {
  var el = document.getElementById('boostStatus');
  el.textContent = msg;
  el.className = 'boost-status' + (cls ? ' ' + cls : '');
}

// Load Solana web3.js dynamically
function loadSolanaWeb3() {
  return new Promise(function(resolve, reject) {
    if (window.solanaWeb3) return resolve();
    var script = document.createElement('script');
    script.src = 'https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js';
    script.onload = function() { resolve(); };
    script.onerror = function() { reject(new Error('Failed to load Solana web3.js')); };
    document.head.appendChild(script);
  });
}

// Initialize boost system
fetchSolPrice();
fetchActiveBoosts();
// Refresh boosts every 60s
var _boostRefreshTimer = setInterval(fetchActiveBoosts, 60000);

// --- Pause all global intervals when tab is hidden to save CPU & API calls ---
(function() {
  var _pausedTimers = {};
  var _timerDefs = [
    { name: 'mainRefresh', get: function(){ return _mainRefreshTimer; }, set: function(v){ _mainRefreshTimer = v; }, fn: function(){ if(LIVE_MODE){ var tp=document.getElementById('tokenPage'); if(!tp||tp.style.display==='none') fetchLiveTokens(); } }, ms: 30000 },
    { name: 'priceSim', get: function(){ return _priceSimTimer; }, set: function(v){ _priceSimTimer = v; }, fn: function(){ LIVE_TOKENS.forEach(function(t){ var c=(Math.random()-0.48)*0.02; t.price*=(1+c); t.m5+=(Math.random()-0.5)*0.8; }); checkAlerts(); }, ms: 3000 },
    { name: 'boostRefresh', get: function(){ return _boostRefreshTimer; }, set: function(v){ _boostRefreshTimer = v; }, fn: fetchActiveBoosts, ms: 60000 }
  ];

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      _timerDefs.forEach(function(td) {
        var id = td.get();
        if (id) { clearInterval(id); td.set(null); _pausedTimers[td.name] = true; }
      });
      if (typeof xFeedInterval !== 'undefined' && xFeedInterval) { clearInterval(xFeedInterval); xFeedInterval = null; _pausedTimers.xFeed = true; }
      if (typeof tgFeedInterval !== 'undefined' && tgFeedInterval) { clearInterval(tgFeedInterval); tgFeedInterval = null; _pausedTimers.tgFeed = true; }
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; _pausedTimers.refreshBar = true; }
    } else {
      _timerDefs.forEach(function(td) {
        if (_pausedTimers[td.name]) { td.set(setInterval(td.fn, td.ms)); delete _pausedTimers[td.name]; }
      });
      if (_pausedTimers.xFeed) { xFeedInterval = setInterval(function(){ addFeedItem('x','x-feed-scroll'); }, 3000); delete _pausedTimers.xFeed; }
      if (_pausedTimers.tgFeed) { tgFeedInterval = setInterval(function(){ addFeedItem('tg','tg-feed-scroll'); }, 3500); delete _pausedTimers.tgFeed; }
      if (_pausedTimers.refreshBar) { startRefreshProgress(); delete _pausedTimers.refreshBar; }
      // Immediately refresh data when tab becomes visible again
      if (LIVE_MODE) fetchLiveTokens();
    }
  });
})();
