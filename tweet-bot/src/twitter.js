// ============================================================
// Twitter OAuth 1.0a — signing & posting
// No external dependencies, pure crypto
// ============================================================

export class TwitterClient {
  constructor(consumerKey, consumerSecret, accessToken, accessSecret) {
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.accessToken = accessToken;
    this.accessSecret = accessSecret;
  }

  // Post a tweet, returns tweet data or throws
  async tweet(text) {
    const url = 'https://api.twitter.com/2/tweets';
    const body = JSON.stringify({ text });

    const headers = await this._buildAuthHeader('POST', url);
    headers['Content-Type'] = 'application/json';

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = data.detail || data.title || JSON.stringify(data);
      throw new Error(`Twitter API ${resp.status}: ${errMsg}`);
    }

    return data;
  }

  // Build OAuth 1.0a Authorization header
  async _buildAuthHeader(method, url) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = this._generateNonce();

    const params = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: this.accessToken,
      oauth_version: '1.0',
    };

    // Create signature base string
    const paramString = Object.keys(params)
      .sort()
      .map(k => `${this._encode(k)}=${this._encode(params[k])}`)
      .join('&');

    const baseString = [
      method.toUpperCase(),
      this._encode(url),
      this._encode(paramString),
    ].join('&');

    // Create signing key
    const signingKey = `${this._encode(this.consumerSecret)}&${this._encode(this.accessSecret)}`;

    // HMAC-SHA1 signature
    const signature = await this._hmacSha1(signingKey, baseString);
    params.oauth_signature = signature;

    // Build header
    const authHeader = 'OAuth ' + Object.keys(params)
      .sort()
      .map(k => `${this._encode(k)}="${this._encode(params[k])}"`)
      .join(', ');

    return { Authorization: authHeader };
  }

  async _hmacSha1(key, data) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const msgData = encoder.encode(data);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    return this._base64Encode(new Uint8Array(sig));
  }

  _base64Encode(uint8Array) {
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  _encode(str) {
    return encodeURIComponent(str)
      .replace(/!/g, '%21')
      .replace(/\*/g, '%2A')
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
  }

  _generateNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    const values = crypto.getRandomValues(new Uint8Array(32));
    for (let i = 0; i < 32; i++) {
      nonce += chars[values[i] % chars.length];
    }
    return nonce;
  }
}
