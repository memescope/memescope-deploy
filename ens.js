// ============================================================
// MemeScope ENS Subname Registration — ens.js
// Handles claiming yourname.memescope.eth on Base L2
// ============================================================

(function() {
  'use strict';

  // ── Config ──────────────────────────────────────────────────
  var BASE_CHAIN_ID = '0x2105'; // 8453
  var BASE_RPC = 'https://mainnet.base.org';

  // Durin L2 contracts on Base
  var L2_REGISTRY_ADDRESS = '0xaebd6e8389349880a1beaf5356ac0a1549b651a2';
  var L2_REGISTRAR_ADDRESS = '0x68D212E25E7A16c93005502eE48980D244A59a6E';

  // ABI for the free registrar (minimal)
  var REGISTRAR_ABI = [
    'function register(string label)',
    'function available(string label) view returns (bool)',
  ];

  // ABI for L2Registry (check ownership)
  var REGISTRY_ABI = [
    'function ownerOf(uint256 tokenId) view returns (address)',
  ];

  // ── State ───────────────────────────────────────────────────
  var _ensModal = null;
  var _ensCheckTimer = null;
  var _ensLastChecked = '';

  // ── Helpers ─────────────────────────────────────────────────

  // Simple namehash (no ethers dependency needed)
  function namehash(name) {
    var node = new Uint8Array(32); // 0x00...00
    if (!name) return '0x' + Array.from(node).map(function(b){return b.toString(16).padStart(2,'0')}).join('');
    var labels = name.split('.');
    for (var i = labels.length - 1; i >= 0; i--) {
      var labelHash = sha3_keccak256(labels[i]);
      var combined = new Uint8Array(64);
      combined.set(node, 0);
      combined.set(hexToBytes(labelHash), 32);
      node = hexToBytes(sha3_keccak256_bytes(combined));
    }
    return '0x' + Array.from(node).map(function(b){return b.toString(16).padStart(2,'0')}).join('');
  }

  // Keccak-256 using browser SubtleCrypto isn't available for keccak,
  // so we'll use a tiny inline keccak implementation or just rely on
  // the contract's `available()` function which takes the label string directly.
  // No namehash needed on the frontend since the registrar contract handles it.

  // ── ENS name validation ─────────────────────────────────────
  function isValidLabel(label) {
    if (!label || label.length < 3) return { valid: false, reason: 'Minimum 3 characters' };
    if (label.length > 32) return { valid: false, reason: 'Maximum 32 characters' };
    if (!/^[a-z0-9-]+$/.test(label)) return { valid: false, reason: 'Only lowercase letters, numbers, and hyphens' };
    if (label.startsWith('-') || label.endsWith('-')) return { valid: false, reason: 'Cannot start or end with a hyphen' };
    return { valid: true };
  }

  // ── Get the correct EVM provider based on connected wallet ──
  function getEvmProvider() {
    var wt = window._wcState && window._wcState.walletType;
    if (wt === 'metamask' && window.ethereum) {
      // When multiple wallets inject window.ethereum, find MetaMask specifically
      if (window.ethereum.providers) {
        var mm = window.ethereum.providers.find(function(p) { return p.isMetaMask; });
        if (mm) return mm;
      }
      return window.ethereum;
    }
    if (wt === 'coinbase' && window.ethereum) {
      if (window.ethereum.providers) {
        var cb = window.ethereum.providers.find(function(p) { return p.isCoinbaseWallet; });
        if (cb) return cb;
      }
      return window.ethereum;
    }
    if (wt === 'trust') return window.trustwallet || window.ethereum;
    if (wt === 'okx') return window.okxwallet || window.ethereum;
    if (wt === 'phantom' && window.phantom && window.phantom.ethereum) return window.phantom.ethereum;
    return window.ethereum;
  }

  // ── Switch to Base chain ────────────────────────────────────
  async function ensureBaseChain() {
    var provider = getEvmProvider();
    if (!provider) throw new Error('No wallet detected');

    var chainId = await provider.request({ method: 'eth_chainId' });
    if (chainId === BASE_CHAIN_ID) return;

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_CHAIN_ID }],
      });
    } catch (err) {
      if (err.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: BASE_CHAIN_ID,
            chainName: 'Base',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: [BASE_RPC],
            blockExplorerUrls: ['https://basescan.org'],
          }],
        });
      } else {
        throw err;
      }
    }
  }

  // ── Check availability via Base RPC (no wallet needed) ──────
  async function checkAvailability(label) {
    var selector = '0xaeb8ce9b'; // available(string) selector
    var encoded = abiEncodeString(label);
    var data = selector + encoded;

    var resp = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: L2_REGISTRAR_ADDRESS, data: data }, 'latest'],
      }),
    });
    var json = await resp.json();
    var result = json.result;

    // Decode bool — returns 0x...0001 for true, 0x...0000 for false
    return result && result !== '0x' + '0'.repeat(64);
  }

  // ── ABI encode a string parameter ──────────────────────────
  function abiEncodeString(str) {
    // offset to data (32 bytes = 0x20)
    var offset = '0000000000000000000000000000000000000000000000000000000000000020';
    // length
    var len = str.length.toString(16).padStart(64, '0');
    // data (utf8 bytes, padded to 32-byte boundary)
    var hex = '';
    for (var i = 0; i < str.length; i++) {
      hex += str.charCodeAt(i).toString(16).padStart(2, '0');
    }
    var padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
    return offset + len + padded;
  }

  // ── Register subname via contract ──────────────────────────
  async function registerSubname(label) {
    await ensureBaseChain();

    var provider = getEvmProvider();
    var accounts = await provider.request({ method: 'eth_requestAccounts' });
    var from = accounts[0];

    var regSelector = '0xf2c298be'; // register(string) selector
    var encoded = abiEncodeString(label);
    var data = regSelector + encoded;

    var tx = await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: from,
        to: L2_REGISTRAR_ADDRESS,
        data: data,
        value: '0x0', // free — only gas
      }],
    });

    return tx;
  }

  // ── Modal UI — Step 1: Search ───────────────────────────────

  var _ensSelectedLabel = '';

  function openEnsModal() {
    var overlay = document.getElementById('ensOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    lockScroll();

    var input = document.getElementById('ensNameInput');
    if (input) { input.value = ''; }
    setEnsStatus('idle', '');
    hideEnsResult();
  }
  window.openEnsModal = openEnsModal;

  function closeEnsModal() {
    var overlay = document.getElementById('ensOverlay');
    if (!overlay) return;
    if (typeof m3CloseOverlay === 'function') {
      m3CloseOverlay(overlay, function() {
        unlockScroll();
      });
    } else {
      overlay.classList.remove('open');
      unlockScroll();
    }
    if (_ensCheckTimer) clearTimeout(_ensCheckTimer);
  }
  window.closeEnsModal = closeEnsModal;

  function setEnsStatus(type, message) {
    var el = document.getElementById('ensStatus');
    if (!el) return;
    el.textContent = message;
    el.className = 'ens-status';
    if (type === 'available') el.classList.add('ens-status-available');
    else if (type === 'taken') el.classList.add('ens-status-taken');
    else if (type === 'error') el.classList.add('ens-status-error');
    else if (type === 'checking') el.classList.add('ens-status-checking');
  }

  var _ensTypewriterTimer = null;

  function showEnsResult(label) {
    var row = document.getElementById('ensResult');
    var name = document.getElementById('ensResultName');
    if (!row || !name) return;

    if (_ensTypewriterTimer) { clearInterval(_ensTypewriterTimer); _ensTypewriterTimer = null; }

    // Cleanup old stamp
    var oldStamp = row.querySelector('.ens-stamp');
    if (oldStamp) oldStamp.remove();

    var fullText = label + '.memescope.eth';
    name.textContent = '';
    name.style.borderRight = '2px solid #22C55E';
    name.style.opacity = '1';
    name.style.color = '';
    name.style.textShadow = '';
    row.style.display = 'flex';
    row.style.position = 'relative';
    row.style.overflow = 'visible';

    // Badge starts hidden
    var badge = row.querySelector('.ens-result-badge');
    if (badge) { badge.style.opacity = '0'; badge.style.transform = 'scale(0.5)'; badge.style.transition = 'none'; }

    _ensSelectedLabel = label;

    // ── Step 1: Typewriter ─────────────────────────────────────
    var charIndex = 0;
    _ensTypewriterTimer = setInterval(function() {
      charIndex++;
      name.textContent = fullText.substring(0, charIndex);
      if (charIndex >= fullText.length) {
        clearInterval(_ensTypewriterTimer);
        _ensTypewriterTimer = null;
        name.style.borderRight = 'none';

        // ── Step 2: Stamp slams down ───────────────────────────
        setTimeout(function() {
          var stamp = document.createElement('div');
          stamp.className = 'ens-stamp';
          stamp.textContent = 'AVAILABLE';
          stamp.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(3) rotate(-15deg);' +
            'font-size:20px;font-weight:900;letter-spacing:4px;color:#22C55E;' +
            'border:3px solid #22C55E;border-radius:8px;padding:5px 16px;' +
            'opacity:0;pointer-events:none;z-index:2;white-space:nowrap;' +
            'text-shadow:0 0 10px rgba(34,197,94,0.5);box-shadow:0 0 15px rgba(34,197,94,0.3);' +
            'transition:transform 0.25s cubic-bezier(0.17,0.67,0.35,1.5), opacity 0.15s ease;';
          row.appendChild(stamp);

          // Slam
          requestAnimationFrame(function() {
            requestAnimationFrame(function() {
              stamp.style.opacity = '1';
              stamp.style.transform = 'translate(-50%,-50%) scale(1) rotate(-12deg)';
            });
          });

          // Shake on impact
          setTimeout(function() {
            row.style.transition = 'none';
            row.style.transform = 'translateX(-3px)';
            setTimeout(function() { row.style.transform = 'translateX(3px)'; }, 40);
            setTimeout(function() { row.style.transform = 'translateX(-2px)'; }, 80);
            setTimeout(function() { row.style.transform = 'translateX(1px)'; }, 120);
            setTimeout(function() { row.style.transform = 'translateX(0)'; }, 160);
          }, 250);

          // Fade stamp, show badge
          setTimeout(function() {
            stamp.style.transition = 'opacity 0.4s ease';
            stamp.style.opacity = '0.15';

            if (badge) {
              badge.style.transition = 'opacity 0.3s ease, transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
              badge.style.opacity = '1';
              badge.style.transform = 'scale(1)';
            }

            setTimeout(function() { if (stamp.parentNode) stamp.remove(); }, 500);
          }, 800);
        }, 150);
      }
    }, 45);
  }

  function hideEnsResult() {
    var row = document.getElementById('ensResult');
    if (row) row.style.display = 'none';
    _ensSelectedLabel = '';
  }

  // ── Modal UI — Step 2: Register ────────────────────────────

  function openEnsRegisterModal() {
    if (!_ensSelectedLabel) return;
    closeEnsModal();
    var overlay = document.getElementById('ensRegOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    lockScroll();

    var preview = document.getElementById('ensRegPreviewName');
    if (preview) preview.textContent = _ensSelectedLabel + '.memescope.eth';

    var status = document.getElementById('ensRegStatus');
    if (status) { status.textContent = ''; status.className = 'ens-reg-status'; }

    updateEnsButton('ready');
  }
  window.openEnsRegisterModal = openEnsRegisterModal;

  function closeEnsRegModal() {
    var overlay = document.getElementById('ensRegOverlay');
    if (!overlay) return;
    if (typeof m3CloseOverlay === 'function') {
      m3CloseOverlay(overlay, function() {
        unlockScroll();
      });
    } else {
      overlay.classList.remove('open');
      unlockScroll();
    }
  }
  window.closeEnsRegModal = closeEnsRegModal;

  function backToEnsSearch() {
    closeEnsRegModal();
    openEnsModal();
    // Restore previous search
    var input = document.getElementById('ensNameInput');
    if (input && _ensSelectedLabel) {
      input.value = _ensSelectedLabel;
      onEnsInput({ target: input });
    }
  }
  window.backToEnsSearch = backToEnsSearch;

  function setRegStatus(type, message) {
    var el = document.getElementById('ensRegStatus');
    if (!el) return;
    el.textContent = message;
    el.className = 'ens-reg-status';
    if (type === 'available') el.style.color = '#22C55E';
    else if (type === 'error') el.style.color = '#EF4444';
    else if (type === 'checking') el.style.color = 'var(--text-secondary)';
    else el.style.color = '';
  }

  function updateEnsButton(state) {
    var btn = document.getElementById('ensRegisterBtn');
    if (!btn) return;
    if (state === 'ready') {
      btn.disabled = false;
      btn.textContent = 'Register Name';
      btn.className = 'ens-register-btn';
    } else if (state === 'registering') {
      btn.disabled = true;
      btn.textContent = 'Registering...';
      btn.className = 'ens-register-btn ens-registering';
    } else if (state === 'success') {
      btn.disabled = true;
      btn.textContent = 'Registered!';
      btn.className = 'ens-register-btn ens-success';
    } else {
      btn.disabled = true;
      btn.textContent = 'Register Name';
      btn.className = 'ens-register-btn';
    }
  }

  // ── Input handler with debounced availability check ─────────
  function onEnsInput(e) {
    var raw = (e.target.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    e.target.value = raw;
    hideEnsResult();

    if (_ensCheckTimer) clearTimeout(_ensCheckTimer);

    if (!raw) {
      setEnsStatus('idle', '');
      return;
    }

    var validation = isValidLabel(raw);
    if (!validation.valid) {
      setEnsStatus('error', validation.reason);
      return;
    }

    setEnsStatus('checking', 'Checking availability...');

    _ensLastChecked = raw;
    _ensCheckTimer = setTimeout(async function() {
      try {
        var avail = await checkAvailability(raw);
        if (raw !== _ensLastChecked) return;
        if (avail) {
          setEnsStatus('idle', '');
          showEnsResult(raw);
        } else {
          setEnsStatus('taken', 'Already taken');
        }
      } catch (err) {
        setEnsStatus('error', 'Could not check — try again');
      }
    }, 400);
  }
  window.onEnsInput = onEnsInput;
  window.showEnsResult = showEnsResult;

  // ── Register button handler (Step 2) ───────────────────────
  async function onEnsRegister() {
    var label = _ensSelectedLabel;
    if (!label || !isValidLabel(label).valid) return;

    // Check wallet connection
    if (!window._wcState || !window._wcState.connected) {
      window._ensWaitingForWallet = true;
      closeEnsRegModal();
      if (typeof handleHeaderWalletClick === 'function') handleHeaderWalletClick();
      return;
    }

    if (window._wcState.chainType !== 'evm') {
      setRegStatus('error', 'Please connect an EVM wallet (MetaMask, Coinbase, etc.)');
      return;
    }

    updateEnsButton('registering');
    setRegStatus('checking', 'Confirm in your wallet...');

    try {
      await ensureBaseChain();
      var txHash = await registerSubname(label);
      updateEnsButton('success');
      setRegStatus('available', 'Registered! ' + label + '.memescope.eth is yours!');

      localStorage.setItem('memescope_ens_name', label + '.memescope.eth');
      updateSidebarEns(label + '.memescope.eth');

      setTimeout(function() { closeEnsRegModal(); }, 2500);
    } catch (err) {
      console.error('ENS registration error:', err);
      var msg = err.message || 'Registration failed';
      if (msg.includes('not deployed')) {
        setRegStatus('error', 'Coming soon! Contract being deployed.');
      } else if (msg.includes('rejected') || msg.includes('denied')) {
        setRegStatus('error', 'Transaction cancelled');
      } else {
        setRegStatus('error', 'Registration failed — try again');
      }
      updateEnsButton('ready');
    }
  }
  window.onEnsRegister = onEnsRegister;

  // ── Sidebar display ────────────────────────────────────────
  function updateSidebarEns(name) {
    var el = document.getElementById('sidebarEnsName');
    if (el) {
      el.textContent = name;
      el.style.display = name ? '' : 'none';
    }
  }

  // On load, check if user already has a name
  var savedEns = localStorage.getItem('memescope_ens_name');
  if (savedEns) {
    document.addEventListener('DOMContentLoaded', function() {
      updateSidebarEns(savedEns);
    });
  }

})();
