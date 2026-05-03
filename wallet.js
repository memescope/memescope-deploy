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
    icon: 'https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg',
    detect: function() { return !!(window.ethereum && window.ethereum.isMetaMask); },
    connect: async function() {
      var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      return { address: accounts[0], chainType: 'evm' };
    },
    disconnect: function() {},
    installUrl: 'https://metamask.io/',
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    icon: 'https://altcoinsbox.com/wp-content/uploads/2022/12/coinbase-logo.webp',
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
    icon: 'https://avatars.githubusercontent.com/u/32179889?s=200&v=4',
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
    icon: 'https://avatars.githubusercontent.com/u/59078187?s=200&v=4',
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
  document.body.style.overflow = 'hidden';
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
  document.getElementById('wcOverlay').classList.remove('open');
  document.body.style.overflow = '';
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
}

async function connectWallet(walletId) {
  var wallet = WALLETS.find(function(w) { return w.id === walletId; });
  if (!wallet) return;

  // If not installed, open install page
  if (!wallet.detect()) {
    window.open(wallet.installUrl, '_blank');
    return;
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
  var iconBtn = wrap.querySelector('.connect-split-icon');
  var labelBtn = wrap.querySelector('.connect-split-label');
  if (!iconBtn || !labelBtn) return;

  if (_wcState.connected && _wcState.address) {
    var short = _wcState.address.slice(0, 4) + '...' + _wcState.address.slice(-4);
    var jazz = generateJazzicon(_wcState.address, 18);
    iconBtn.innerHTML = '<span class="wc-jazzicon">' + jazz + '</span>';
    labelBtn.innerHTML = '<span class="wc-addr">' + short + '</span>';
    wrap.classList.add('connected');
    wrap.title = _wcState.address;
  } else {
    iconBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10.5 13C10.5 13.5523 10.9477 14 11.5 14H12.5C13.0523 14 13.5 13.5523 13.5 13V3C13.5 2.44772 13.0523 2 12.5 2H11.5C10.9477 2 10.5 2.44772 10.5 3V13Z"/><path d="M5.97584 7.81301C6.31036 7.37356 6.31677 6.74398 5.92623 6.35348L5.21909 5.6464C4.82855 5.2559 4.19112 5.25312 3.8398 5.67926C2.37973 7.4503 1.5 9.71165 1.5 12.1764C1.5 17.9058 6.22915 22.4999 12 22.4999C17.7709 22.4999 22.5 17.9058 22.5 12.1764C22.5 9.71165 21.6203 7.4503 20.1602 5.67926C19.8089 5.25312 19.1715 5.2559 18.7809 5.6464L18.0738 6.35348C17.6832 6.74398 17.6896 7.37356 18.0242 7.81301C18.9539 9.03438 19.5 10.5437 19.5 12.1764C19.5 16.1932 16.1703 19.4999 12 19.4999C7.82973 19.4999 4.5 16.1932 4.5 12.1764C4.5 10.5437 5.04606 9.03438 5.97584 7.81301Z"/></svg>';
    labelBtn.innerHTML = '<span>Connect</span>';
    wrap.classList.remove('connected');
    wrap.title = '';
  }
}

function handleHeaderWalletClick() {
  if (_wcState.connected) {
    disconnectWallet();
  } else {
    openWalletModal();
  }
}

// Close wallet modal on ESC
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeWalletModal(); closeWatchlistModal(); closeContactModal(); }
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
  else if (savedWallet === 'metamask' && window.ethereum && window.ethereum.isMetaMask) {
    window.ethereum.request({ method: 'eth_accounts' }).then(function(accounts) {
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
