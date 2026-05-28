// ========== WALLET CONNECT ==========
var _wcState = {
  connected: false,
  address: null,
  walletType: null, // 'phantom', 'metamask', 'coinbase', 'trust', 'okx'
  chainType: null,  // 'solana' or 'evm'
};

var WALLETS = [
  {
    id: 'phantom',
    name: 'Phantom',
    icon: '/img/phantom_logo.png',
    detect: function() { return !!(window.phantom && window.phantom.solana && window.phantom.solana.isPhantom); },
    connect: async function() {
      var provider = window.phantom.solana;
      var resp = await provider.connect();
      return { address: resp.publicKey.toString(), chainType: 'solana' };
    },
    disconnect: function() { try { window.phantom.solana.disconnect(); } catch(e) {} },
    installUrl: 'https://phantom.app/',
  },
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: '/img/metamask_logo.svg',
    detect: function() {
      if (window.ethereum && window.ethereum.providers) {
        return !!window.ethereum.providers.find(function(p) { return p.isMetaMask && !p.isPhantom; });
      }
      return !!(window.ethereum && window.ethereum.isMetaMask && !window.ethereum.isPhantom);
    },
    connect: async function() {
      var provider = window.ethereum;
      if (provider && provider.providers) {
        var mm = provider.providers.find(function(p) { return p.isMetaMask && !p.isPhantom; });
        if (mm) provider = mm;
      }
      var accounts = await provider.request({ method: 'eth_requestAccounts' });
      return { address: accounts[0], chainType: 'evm' };
    },
    disconnect: function() {},
    installUrl: 'https://metamask.io/',
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    icon: '/img/coinbase_logo.webp',
    detect: function() { return !!(window.ethereum && window.ethereum.isCoinbaseWallet); },
    connect: async function() {
      var provider = window.ethereum.providers ? window.ethereum.providers.find(function(p) { return p.isCoinbaseWallet; }) : window.ethereum;
      var accounts = await provider.request({ method: 'eth_requestAccounts' });
      return { address: accounts[0], chainType: 'evm' };
    },
    disconnect: function() {},
    installUrl: 'https://www.coinbase.com/wallet',
  },
  {
    id: 'trust',
    name: 'Trust Wallet',
    icon: '/img/trust_logo.png',
    detect: function() { return !!(window.trustwallet || (window.ethereum && window.ethereum.isTrust)); },
    connect: async function() {
      var provider = window.trustwallet || window.ethereum;
      var accounts = await provider.request({ method: 'eth_requestAccounts' });
      return { address: accounts[0], chainType: 'evm' };
    },
    disconnect: function() {},
    installUrl: 'https://trustwallet.com/',
  },
  {
    id: 'okx',
    name: 'OKX Wallet',
    icon: '/img/okx_logo.png',
    detect: function() { return !!(window.okxwallet); },
    connect: async function() {
      var accounts = await window.okxwallet.request({ method: 'eth_requestAccounts' });
      return { address: accounts[0], chainType: 'evm' };
    },
    disconnect: function() {},
    installUrl: 'https://www.okx.com/web3',
  },
];

function openWalletModal() {
  lockScroll();
  var overlay = document.getElementById('wcOverlay');
  var installedEl = document.getElementById('wcInstalled');
  var availableEl = document.getElementById('wcAvailable');

  var installed = [];
  var notInstalled = [];

  for (var i = 0; i < WALLETS.length; i++) {
    var w = WALLETS[i];
    try {
      if (w.detect()) installed.push(w);
      else notInstalled.push(w);
    } catch(e) {
      notInstalled.push(w);
    }
  }

  var html = '';

  if (installed.length > 0) {
    html = '<div class="wc-section">Detected</div><div class="wc-list">';
    for (var j = 0; j < installed.length; j++) {
      html += '<button class="wc-wallet" onclick="connectWallet(\'' + installed[j].id + '\')">' +
        '<img src="' + installed[j].icon + '" alt="' + installed[j].name + '">' +
        '<span class="wc-wallet-name">' + installed[j].name + '</span>' +
        '<span class="wc-badge wc-badge-installed">Ready</span>' +
        '</button>';
    }
    html += '</div>';
  }

  installedEl.innerHTML = html;

  var html2 = '';
  if (notInstalled.length > 0) {
    if (installed.length > 0) html2 += '<div class="wc-divider"></div>';
    html2 += '<div class="wc-section">More Wallets</div><div class="wc-list">';
    for (var k = 0; k < notInstalled.length; k++) {
      html2 += '<button class="wc-wallet" onclick="connectWallet(\'' + notInstalled[k].id + '\')">' +
        '<img src="' + notInstalled[k].icon + '" alt="' + notInstalled[k].name + '" onerror="this.style.display=\'none\'">' +
        '<span class="wc-wallet-name">' + notInstalled[k].name + '</span>' +
        '</button>';
    }
    html2 += '</div>';
  }

  availableEl.innerHTML = html2;
  overlay.classList.add('open');
}

function closeWalletModal() {
  var ov = document.getElementById('wcOverlay');
  m3CloseOverlay(ov, function() {
    unlockScroll();
    // Restore modal structure if it was replaced by connecting animation
    var modal = document.querySelector('.wc-modal');
    if (modal && !document.getElementById('wcInstalled')) {
      modal.innerHTML =
        '<div class="wc-header">' +
          '<span class="wc-title">Connect a Wallet</span>' +
          '<button class="wc-close" onclick="closeWalletModal()">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div id="wcInstalled"></div>' +
        '<div id="wcAvailable"></div>' +
        '<div class="wc-footer">New to wallets? <a href="https://phantom.app/" target="_blank">Get started</a></div>';
    }
  });
}

async function connectWallet(walletId) {
  var wallet = WALLETS.find(function(w) { return w.id === walletId; });
  if (!wallet) return;

  // If not installed, open install page
  if (!wallet.detect()) {
    window.open(wallet.installUrl, '_blank');
    return;
  }

  // Disconnect current wallet first if switching
  if (_wcState.connected && _wcState.walletType && _wcState.walletType !== walletId) {
    var oldWallet = WALLETS.find(function(w) { return w.id === _wcState.walletType; });
    if (oldWallet) try { oldWallet.disconnect(); } catch(e) {}
    _wcState.connected = false;
    _wcState.address = null;
    _wcState.walletType = null;
    _wcState.chainType = null;
  }

  // Show connecting animation
  var modal = document.querySelector('.wc-modal');
  var prevContent = modal.innerHTML;
  modal.innerHTML =
    '<div class="wc-header">' +
      '<span class="wc-title"></span>' +
      '<button class="wc-close" onclick="closeWalletModal()">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="wc-connecting">' +
      '<img class="wc-connecting-icon" src="' + wallet.icon + '" onerror="this.style.display=\'none\'">' +
      '<div class="wc-connecting-title">Opening ' + wallet.name + '...</div>' +
      '<div class="wc-connecting-sub">Confirm connection in the extension</div>' +
      '<div class="wc-spinner"></div>' +
    '</div>';

  try {
    // Show connecting screen for at least 2s so user can read it
    var connectPromise = wallet.connect();
    var delayPromise = new Promise(function(r) { setTimeout(r, 2000); });
    var result = await connectPromise;
    await delayPromise;
    _wcState.connected = true;
    _wcState.address = result.address;
    _wcState.walletType = walletId;
    _wcState.chainType = result.chainType;

    // Also update boost state so boost system can use the wallet
    if (walletId === 'phantom' && typeof boostState !== 'undefined') {
      boostState.walletConnected = true;
      boostState.walletAddress = result.address;
      if (typeof updateBoostWalletUI === 'function') updateBoostWalletUI();
    }

    localStorage.setItem('wcWallet', walletId);
    updateHeaderWallet();
    closeWalletModal();

    // If ENS register modal was waiting for wallet, re-open it
    if (window._ensWaitingForWallet) {
      window._ensWaitingForWallet = false;
      setTimeout(function() { if (typeof openEnsRegisterModal === 'function') openEnsRegisterModal(); }, 300);
    }
  } catch(e) {
    console.log('Wallet connect error:', e);
    // Restore wallet list on cancel/error
    modal.innerHTML = prevContent;
  }
}

function disconnectWallet() {
  if (_wcState.walletType) {
    var wallet = WALLETS.find(function(w) { return w.id === _wcState.walletType; });
    if (wallet) wallet.disconnect();
  }

  localStorage.removeItem('wcWallet');
  _wcState.connected = false;
  _wcState.address = null;
  _wcState.walletType = null;
  _wcState.chainType = null;

  // Also update boost state
  if (typeof boostState !== 'undefined') {
    boostState.walletConnected = false;
    boostState.walletAddress = null;
    if (typeof updateBoostWalletUI === 'function') updateBoostWalletUI();
  }

  updateHeaderWallet();
}

// Generate a jazzicon SVG from an address string
function generateJazzicon(address, size) {
  size = size || 18;
  // Simple hash from address
  var seed = 0;
  for (var i = 0; i < address.length; i++) {
    seed = ((seed << 5) - seed) + address.charCodeAt(i);
    seed = seed & seed; // to 32-bit int
  }
  function rand() {
    var t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  var colors = ['#01888C','#FC7500','#034F5D','#F73F01','#FC1960','#C7144C','#F3C100','#1598F2','#2465E1','#F19E02','#8B5CF6','#EC4899'];
  var bg = colors[Math.floor(rand() * colors.length)];
  var shapes = '';
  for (var s = 0; s < 3; s++) {
    var c = colors[Math.floor(rand() * colors.length)];
    var x = rand() * size;
    var y = rand() * size;
    var r = (rand() * size * 0.6) + size * 0.2;
    shapes += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + c + '" opacity="0.7"/>';
  }
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="' + size + '" height="' + size + '" fill="' + bg + '"/>' + shapes + '</svg>';
}

function updateHeaderWallet() {
  var wrap = document.getElementById('headerConnectBtn');
  if (!wrap) return;
  var outerWrap = wrap.parentElement; // .ms-header-connect-wrap
  var iconBtn = wrap.querySelector('.connect-split-icon');
  var labelBtn = wrap.querySelector('.connect-split-label');
  if (!iconBtn || !labelBtn) return;

  if (_wcState.connected && _wcState.address) {
    var short = _wcState.address.slice(0, 4) + '...' + _wcState.address.slice(-4);
    var jazz = generateJazzicon(_wcState.address, 18);
    iconBtn.innerHTML = '<span class="wc-jazzicon">' + jazz + '</span>';
    labelBtn.innerHTML = '<span class="wc-addr">' + short + '</span>';
    wrap.classList.add('connected');
    if (outerWrap) outerWrap.classList.add('connected');
    wrap.title = _wcState.address;
  } else {
    iconBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10.5 13C10.5 13.5523 10.9477 14 11.5 14H12.5C13.0523 14 13.5 13.5523 13.5 13V3C13.5 2.44772 13.0523 2 12.5 2H11.5C10.9477 2 10.5 2.44772 10.5 3V13Z"/><path d="M5.97584 7.81301C6.31036 7.37356 6.31677 6.74398 5.92623 6.35348L5.21909 5.6464C4.82855 5.2559 4.19112 5.25312 3.8398 5.67926C2.37973 7.4503 1.5 9.71165 1.5 12.1764C1.5 17.9058 6.22915 22.4999 12 22.4999C17.7709 22.4999 22.5 17.9058 22.5 12.1764C22.5 9.71165 21.6203 7.4503 20.1602 5.67926C19.8089 5.25312 19.1715 5.2559 18.7809 5.6464L18.0738 6.35348C17.6832 6.74398 17.6896 7.37356 18.0242 7.81301C18.9539 9.03438 19.5 10.5437 19.5 12.1764C19.5 16.1932 16.1703 19.4999 12 19.4999C7.82973 19.4999 4.5 16.1932 4.5 12.1764C4.5 10.5437 5.04606 9.03438 5.97584 7.81301Z"/></svg>';
    labelBtn.innerHTML = '<span>Connect</span>';
    wrap.classList.remove('connected');
    if (outerWrap) outerWrap.classList.remove('connected');
    wrap.title = '';
    closeWalletDropdown();
  }
}

function handleHeaderWalletClick() {
  openWalletModal();
}

function buildWalletDropdownContent() {
  var dropdown = document.getElementById('walletDropdown');
  if (!dropdown) return;

  if (_wcState.connected && _wcState.address) {
    dropdown.innerHTML =
      '<button class="wallet-dropdown-item" onclick="walletAction(\'copy\')" role="menuitem">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>' +
        '<span>Copy address</span>' +
      '</button>' +
      '<button class="wallet-dropdown-item" onclick="walletAction(\'explorer\')" role="menuitem">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>' +
        '<span>View on explorer</span>' +
      '</button>' +
      '<div class="wallet-dropdown-divider"></div>' +
      '<button class="wallet-dropdown-item wallet-dropdown-danger" onclick="walletAction(\'disconnect\')" role="menuitem">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>' +
        '<span>Disconnect</span>' +
      '</button>';
  } else {
    // Only show detected/installed wallets
    var detected = [];
    for (var i = 0; i < WALLETS.length; i++) {
      var w = WALLETS[i];
      try { if (w.detect()) detected.push(w); } catch(e) {}
    }

    if (detected.length === 0) {
      dropdown.innerHTML =
        '<div class="wallet-dropdown-empty">No wallets detected</div>' +
        '<div class="wallet-dropdown-divider"></div>' +
        '<button class="wallet-dropdown-item" onclick="walletAction(\'allWallets\')" role="menuitem">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>' +
          '<span>Browse all wallets</span>' +
        '</button>';
    } else {
      var html = '<div class="wallet-dropdown-label">Detected wallets</div>';
      for (var j = 0; j < detected.length; j++) {
        var dw = detected[j];
        html += '<button class="wallet-dropdown-item" onclick="quickConnect(\'' + dw.id + '\')" role="menuitem">' +
          '<img src="' + dw.icon + '" width="18" height="18" style="border-radius:4px;flex-shrink:0">' +
          '<span>' + dw.name + '</span>' +
        '</button>';
      }
      dropdown.innerHTML = html;
    }
  }
}

function quickConnect(walletId) {
  closeWalletDropdown();
  if (typeof connectWallet === 'function') {
    connectWallet(walletId);
  }
}

function toggleWalletDropdown(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  var dropdown = document.getElementById('walletDropdown');
  var chevron = document.getElementById('headerConnectChevron');
  if (!dropdown) return;
  var isOpen = dropdown.classList.contains('open');
  if (isOpen) {
    closeWalletDropdown();
  } else {
    buildWalletDropdownContent();
    dropdown.classList.add('open');
    if (chevron) chevron.classList.add('open');
  }
}

function closeWalletDropdown() {
  var dropdown = document.getElementById('walletDropdown');
  var chevron = document.getElementById('headerConnectChevron');
  if (dropdown) dropdown.classList.remove('open');
  if (chevron) chevron.classList.remove('open');
}

function walletAction(action) {
  closeWalletDropdown();

  // "allWallets" works regardless of connection state
  if (action === 'allWallets') {
    openWalletModal();
    return;
  }

  // All other actions require an active connection
  if (!_wcState.connected || !_wcState.address) return;

  if (action === 'copy') {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(_wcState.address).catch(function(){});
    } else {
      var ta = document.createElement('textarea');
      ta.value = _wcState.address;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch(e) {}
      document.body.removeChild(ta);
    }
  } else if (action === 'explorer') {
    var url;
    if (_wcState.chainType === 'solana') {
      url = 'https://solscan.io/account/' + _wcState.address;
    } else {
      url = 'https://etherscan.io/address/' + _wcState.address;
    }
    window.open(url, '_blank', 'noopener');
  } else if (action === 'disconnect') {
    disconnectWallet();
  }
}

document.addEventListener('click', function(e) {
  var dropdown = document.getElementById('walletDropdown');
  var chevron = document.getElementById('headerConnectChevron');
  if (!dropdown || !dropdown.classList.contains('open')) return;
  if (dropdown.contains(e.target) || (chevron && chevron.contains(e.target))) return;
  closeWalletDropdown();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeWalletDropdown();
});

// Close wallet modal on ESC
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeWalletModal(); closeWatchlistModal(); closeContactModal(); if(typeof closeEnsModal==='function') closeEnsModal(); if(typeof closeEnsRegModal==='function') closeEnsRegModal(); }
});

// Auto-reconnect wallet on page load (only if user was connected before)
(function autoReconnectWallet() {
  var savedWallet = localStorage.getItem('wcWallet');
  if (!savedWallet) return; // User disconnected or never connected — don't auto-reconnect

  if (savedWallet === 'phantom' && window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) {
    window.phantom.solana.connect({ onlyIfTrusted: true }).then(function(resp) {
      _wcState.connected = true;
      _wcState.address = resp.publicKey.toString();
      _wcState.walletType = 'phantom';
      _wcState.chainType = 'solana';
      if (typeof boostState !== 'undefined') {
        boostState.walletConnected = true;
        boostState.walletAddress = resp.publicKey.toString();
        if (typeof updateBoostWalletUI === 'function') updateBoostWalletUI();
      }
      updateHeaderWallet();
    }).catch(function() { localStorage.removeItem('wcWallet'); });
  }
  else if (savedWallet === 'metamask' && window.ethereum) {
    var mmProvider = window.ethereum;
    if (mmProvider.providers) {
      var mmFound = mmProvider.providers.find(function(p) { return p.isMetaMask && !p.isPhantom; });
      if (mmFound) mmProvider = mmFound;
    }
    mmProvider.request({ method: 'eth_accounts' }).then(function(accounts) {
      if (accounts && accounts.length > 0) {
        _wcState.connected = true;
        _wcState.address = accounts[0];
        _wcState.walletType = 'metamask';
        _wcState.chainType = 'evm';
        updateHeaderWallet();
      } else { localStorage.removeItem('wcWallet'); }
    }).catch(function() { localStorage.removeItem('wcWallet'); });
  }
})();
