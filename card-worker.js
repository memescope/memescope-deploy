/**
 * Memescopes Card Image Worker
 * Intercepts bot/crawler requests to /{chain}/{ca} and serves dynamic OG meta tags.
 * Generates branded 1200x628 PNG card images at /card-image/{chain}/{ca}.png
 *
 * Uses @resvg/resvg-wasm for SVG -> PNG conversion in Cloudflare Workers.
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import interMedium from './fonts/Inter-Medium.ttf';
import interRegular from './fonts/Inter-Regular.ttf';

// ── Initialization ──────────────────────────────────────────────────────────
let wasmReady = false;
let fontBuffers = null;

async function ensureWasm() {
  if (wasmReady) return;
  await initWasm(resvgWasm);

  // Load font buffers from imported binary modules
  fontBuffers = [
    new Uint8Array(interMedium),
    new Uint8Array(interRegular),
  ];

  wasmReady = true;
}

// ── Constants ───────────────────────────────────────────────────────────────

const SCRAPER_API = 'https://memescope-scraper.memescope-io.workers.dev/tokens';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens/';

// Bumped on every deploy (with package.json/app.js/sw.js). Edge-cache keys for HTML
// include this, so a new deploy = new key = old cached HTML is ignored instantly.
const CACHE_VERSION = '2.5.234';

const VALID_CHAINS = new Set([
  'solana', 'eth', 'ethereum', 'base', 'bsc', 'sui', 'tron',
  'arbitrum', 'avalanche', 'avax', 'polygon', 'optimism', 'blast', 'ton',
]);

const CHAIN_DISPLAY = {
  solana: 'Solana', eth: 'Ethereum', ethereum: 'Ethereum',
  base: 'Base', bsc: 'BSC', sui: 'Sui', tron: 'Tron',
  arbitrum: 'Arbitrum', avalanche: 'Avalanche', avax: 'Avalanche',
  polygon: 'Polygon', optimism: 'Optimism', blast: 'Blast', ton: 'TON',
};

// ─── Per-chain SEO landing pages (/solana, /ethereum, …) ──────────────
// Served as the normal SPA, but the Worker rewrites <title>/meta/<h1>/canonical
// so each chain is its own indexable, keyword-targeted page.
const CHAIN_PAGES = { '/solana': 'Solana', '/ethereum': 'Ethereum', '/base': 'Base', '/bsc': 'BSC', '/sui': 'Sui' };
async function rewriteChainSeo(resp, name, path) {
  const u = 'https://memescopes.com' + path;
  const title = name + ' Meme Coins — Live Bubble Map & Scanner | Memescopes';
  const desc = 'Live ' + name + ' meme coin scanner and bubble map on Memescopes. Track trending ' + name + ' meme coins in real time — prices, market cap, volume, charts and on-chain data.';
  const h1 = name + ' Meme Coins — Live Bubble Map & Scanner';
  const out = new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(title); } })
    .on('link[rel="canonical"]', { element(e) { e.setAttribute('href', u); } })
    .on('meta[name="description"]', { element(e) { e.setAttribute('content', desc); } })
    .on('meta[property="og:title"]', { element(e) { e.setAttribute('content', title); } })
    .on('meta[property="og:url"]', { element(e) { e.setAttribute('content', u); } })
    .on('meta[property="og:description"]', { element(e) { e.setAttribute('content', desc); } })
    .on('meta[name="twitter:title"]', { element(e) { e.setAttribute('content', title); } })
    .on('meta[name="twitter:description"]', { element(e) { e.setAttribute('content', desc); } })
    .on('h1', { element(e) { e.setInnerContent(h1); } })
    .transform(resp);
  const html = await out.text();   // buffer so it can be edge-cached + returned safely
  return new Response(html, { status: 200, headers: new Headers(resp.headers) });
}

// Bot user-agent patterns
const BOT_UA_RE = /Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot|TelegramBot|WhatsApp|Googlebot|bingbot|Baiduspider|yandex|rogerbot|embedly|showyoubot|outbrain|pinterest|applebot|vkShare|W3C_Validator|redditbot|Applebot|crawler|spider|bot\b/i;

// ── Number Formatting ───────────────────────────────────────────────────────

function fmtNum(n) {
  if (n == null || isNaN(n)) return { value: '—', unit: '' };
  n = Number(n);
  if (n >= 1e12) return { value: (n / 1e12).toFixed(1), unit: 'T' };
  if (n >= 1e9) return { value: (n / 1e9).toFixed(1), unit: 'B' };
  if (n >= 1e6) return { value: (n / 1e6).toFixed(1), unit: 'M' };
  if (n >= 1e3) return { value: (n / 1e3).toFixed(1), unit: 'K' };
  if (n >= 1) return { value: n.toFixed(1), unit: '' };
  return { value: n.toFixed(4), unit: '' };
}

function fmtAge(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return days + 'D';
  if (hrs > 0) return hrs + 'H';
  if (mins > 0) return mins + 'M';
  return '<1M';
}

function escXml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── Token Data Fetching ─────────────────────────────────────────────────────

async function fetchTokenData(chain, ca) {
  // Try our own scraper API first (faster, already aggregated)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(SCRAPER_API, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      const tokens = data.tokens || [];
      const match = tokens.find(t => t.ca && t.ca.toLowerCase() === ca.toLowerCase());
      if (match) return normalizeScraperToken(match, chain);
    }
  } catch { /* fall through to DexScreener */ }

  // Fallback: DexScreener
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(DEXSCREENER_API + ca, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      if (data.pairs && data.pairs.length > 0) {
        // Pick the pair with highest liquidity
        const pair = data.pairs.reduce((best, p) =>
          ((p.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? p : best), data.pairs[0]);
        return normalizeDexScreenerPair(pair, chain);
      }
    }
  } catch { /* give up */ }

  return null;
}

function normalizeScraperToken(t, chain) {
  // Strip leading $ from ticker if present (scraper includes it)
  let ticker = t.sym || '???';
  if (ticker.startsWith('$')) ticker = ticker.slice(1);

  return {
    name: t.name || 'Unknown',
    ticker,
    img: t.img || '',
    mcap: t.mcap || 0,
    vol: t.vol || 0,
    liq: t.liq || 0,
    ageStr: t.age || '',   // already formatted string like "2y", "3d", "5h"
    chain: t.net || chain,
    price: t.price || 0,
    ca: t.ca,
  };
}

function normalizeDexScreenerPair(p, chain) {
  const ageMs = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) : 0;
  const ageSec = Math.floor(ageMs / 1000);
  return {
    name: p.baseToken?.name || 'Unknown',
    ticker: p.baseToken?.symbol || '???',
    img: p.info?.imageUrl || '',
    mcap: p.marketCap || p.fdv || 0,
    vol: p.volume?.h24 || 0,
    liq: p.liquidity?.usd || 0,
    ageStr: fmtAge(ageSec),
    chain: p.chainId || chain,
    price: parseFloat(p.priceUsd || 0),
    ca: p.baseToken?.address || '',
  };
}

// ── Image Fetching ──────────────────────────────────────────────────────────

async function fetchImageAsBuffer(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'image/png, image/jpeg, image/gif, */*' },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;

    const buf = new Uint8Array(await resp.arrayBuffer());

    // Validate it's a supported format (PNG, JPEG, or GIF)
    // PNG: starts with 0x89 0x50 0x4E 0x47
    // JPEG: starts with 0xFF 0xD8
    // GIF: starts with GIF8
    if (buf.length < 4) return null;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;

    if (!isPng && !isJpeg && !isGif) {
      console.warn('Skipping unsupported image format from:', url, 'magic bytes:', buf[0], buf[1], buf[2], buf[3]);
      return null;
    }

    return buf;
  } catch {
    return null;
  }
}

// Scope logo embedded as base64 (avoids self-referential fetch)
const SCOPE_LOGO_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAACXBIWXMAAA7DAAAOwwHHb6hkAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAIABJREFUeJzs3Xe0ZkWV/vHvbposOeekgoBECRIGBVQUUWTGgAgKplEZw+gAo2PChPJzRDHBKAoqKpgFExhAclQyipIEJCdBQsPz+6NOQ9P07b6h6tQ573k+a/VqQveuvfr2PbXfqjq7AjPrJEnTgRWB1YAlZ/uxBLDUHP7bksB8EbFc5lxuBR4B7gLubn6e+ePOMf779cDfI2JGzlzMLI/ptRMwGypJSwFrAysDK83hn1dnct+j9+bKcRYLAosBK0z0N0q6E/grcBNw4xz++ToXCWbti9oJmI0ySSsDzwDWA9Zvfn46aZKfr9Cw90bE4jkDSrqHVACU8AipIPgTcAVwKXAlcHlE3FhoTLPBcwFglkEz0a8PbND8vDawEbB8hXT6VgDMzd3AVaSVgstIxcFlwBUR8UiFfMxGhgsAswmQNA1YF9ii+bElsDFpibwrRqkAGMsDwB+Bc4Bzmx9XRoSqZmXWIy4AzOai+WS/+Sw/ng0sUzWpeRtCATAn9wIXAefP/BERl9ZNyay7XACYNZpT91sBO5A+2W9BOpTXN0MtAObkBtLqwDnAKcA5PnBolrgAsEGTtDawc/PjeaTX6PrOBcDY7gPOBE5uflwYEY/WTcmsDhcANiizTfg70v3l/MlwATB+twFnAaeRCoILfI7AhsIFgI00SUsDu5I+3e8IrFI3o1a4AJi8vwG/AX4F/Cwi7qycj1kxLgBs5EhaHdgF2A14ATB/3Yxa5wIgj0dIqwM/BX4QEX+unI9ZVi4AbCRI2gB4MWnS34Zh/912AVDGZaRi4ATgdG8VWN8N+SFpPSZpPtIreS8GXkbqrmeJC4DyrgV+SSoGfhERD1fOx2zCXABYb0gK0qf7vYF/YzQP8OXgAqBdtwHHA9+MiDNqJ2M2Xi4ArPOaPf09gdcDT6ucTh+4AKjnOuDbwFd9ZsC6zgWAdZKkJYGXkD7t74T/rk6EC4BuOB/4BnBsRNxaOxmz2fmhap0haUHg+aRJ/6XAAnUz6i0XAN3yEOm1wuOB4yPin5XzMQNcAFgHSFoPeBuwF7BU5XRGgQuA7rqDtCrwpYi4snYyNmwuAKyK5la9HYF3kBr1+O9iPi4A+uF04LPAD30/gdXgh661StLywL7AW4A1KqczqlwA9MuNpFWBwyPihtrJ2HC4ALBWSNoceBNpf3/hyumMOhcA/fQQ8GPgyIg4uXYyNvpcAFgxkhYm7eu/Fdi0cjpD4gKg/y4Avkh6g8CHBq0IFwCWnaTFgP2AA4CVK6czRC4ARsetpELgs76YyHJzAWDZSFqOdJr/7fg0f00uAEbPvcDXgE9GxI21k7HR4ALApkzSGsB/Am8AFqmcjrkAGGUPAscBB0fEVbWTsX5zAWCT1tzAdyDwKoZ35W6XuQAYfQ8D3wEOiYjLaidj/TStdgLWP5K2kvQj4GLSqX5P/mbtmp/0vXexpB9I2qJ2QtY/LgBs3CStL+k44ExSq16vIJnVNY10HfY5kk6StHHthKw/XADYPElaXdIRwEXAy/HEb9ZFOwMXSDpO0jq1k7HucwFgY5K0rKRDgCtJTXzmq5ySmc3dNFKRfrmkIyStWDsh6y5/krMnkfQU0ut87wWyHiazVvgQoM10H/B54BMRcXftZKxbXADYYyQtALwOOBhYoW42NgUuAGx2twOHkhoKPVA7GesGbwEYkkLS3sBVwBF48jcbNcsAhwBXSHq1JH/4MxcAQydpE+BU4BhgtcrpmFlZawDfAk7xGwPmAmCgJC0l6bPAecB2tfMxs1ZtT3pj4BhJy9ZOxupwATAwkqZJ2od0sv/t+GS/2VBNIzUTulLSOyT5WTAwLgAGRNKzgDOAo4HlKqdjZt2wNHAYqZnQNrWTsfa4ABgAScs0y/1nA1vVzsfMOmkz4LRmW8AHgQfABcAIa5b7/wP4C2m5319vM5ubIG0LXCHpLX5bYLR5QhhRTSvQXwOfA5aonI6Z9cuSwBeB30tat3YyVoYLgBEjabqkdwB/BJ5TOR0z67dtgQslHehDgqPHyzsjRNIGwFHAlrVzsarcCdBKOAt4fURcVjsRy8MrACOg+dR/IHA+nvzNrIytgT9IOqRpG2495xWAnpO0EelT/+a1c7HO8AqAlXYRsF9EnF87EZs8rwD0lKQFJX2M9Knfk7+ZtWkj4ExJB3s1oL+8AtBDktYDjgU2rZ2LdZJXAKxNlwB7RsQltROxifEKQM80bXzPw5O/mXXDhqQugu+onYhNjAuAnpC0hKRjSW18F62dj5nZLBYGDpP0fUlL1U7GxscFQA9I2hq4ANizdi5mZnOxB+lNge1rJ2Lz5gKgwyTNJ+lDwGnA2pXTMTMbj9WB30j6kJsHdZsPAXaUpNWBb5Lu7TabCB8CtK44C3h1RFxdOxF7Mq8AdJCkl5Na+XryN7M+2xo4T9LLaidiT+YCoEOaJf9DgONIl3GYmfXd0sD3JX1W0vTaydjjvAXQEZKWAb4D7Fw7F+s9bwFYV50CvCIibqmdiHkFoBMkbUJ6t9+Tv5mNsh1IWwJb1E7EXABUJ2kv4HRgzcqpmJm1YTXgVEn71k5k6FwAVNLc4HcI6aT/IrXzMTNr0ULAUZKOkDR/7WSGygVABZKWA34JHFg7FzOzit4E/FrSirUTGSKfyGyZpK2A7wOr1M7FRsKjwB3A7bP8fGOBcb4NrAwsQzrVPfNnf4iwqdqedJfAv0bEubWTGRK/BdAiSXsCXwMWrJ2LdZ6Am4BrgGubH9c1P26jmewj4o5aCQJImrUYWJbUBW6NWX5eE1gJP2ts3h4A9omI42snMhT+pmyJpIOAj+M/c3ucSBP7ZaQrVa/k8Qn/+oh4qF5q+TT3xa/e/FgTWJd0g9z6+PCrPdGjwIER8f9qJzIEnowKaxpffIG012XD9Tcen+gvAy4GLo+Ie6tmVZmkxUiFwIaz/LwB3iIbui8Cb4+IR2onMspcABQkaVFSc58X187FWnUf8AfgfNJFTqdGxM11U+qX5lDYFsDmzY/tcHfMofkl8PKhF8kluQAoRNLKwAnAprVzsaJEWro/a5Yfl/iTS17NStqGpN7yWwNbkbYS/AwbbecBu0XE32snMor8zVOApA2AE0mHoGz03AycCpwM/Cwi/lY5n0GStDyps9zOwC6kMwY2eq4BXhQRl9dOZNS4AMhM0o6k1/y8XDk67gPOJE34JwMXRITqpmSzk7Q2qRjYGXge/h4cJXcCe0TE72onMkpcAGQkaW/gK8ACtXOxKfsz8EPgp8BZETGjcj42AU13ua2B3YA9gHXqZmQZPAjsGxHfrp3IqHABkImkfyed9ndjlP66jDThnxARp9VOxvJptuVeTCoItsHPvr4S8M6I+FztREaBvwkykHQA8MnaediEPQpcSDqs+e2IuLJyPtYCSWsCLwVeDjwbF+19I+C/IuLTtRPpOxcAUyTpYOD9tfOwCbkUOAb4VkTcUDsZq0fSqsBewGuBZ1ROxybmgxFxcO0k+swFwCRJCuBQ4N21c7FxuRM4HviGl/dtTpptgr2B/YDlKqdj43MoqXOgD+VOgguASWgm/8OAt9fOxebqEeC3wJHAj0elta6V1bQufgGpGHgpPtTbdV8G3hYRj9ZOpG9cAEyQpPmAo4B9audiY7qa1Er06xFxW+1krL+aq7v3Bd6K+3p02deAN7oB18S4AJiA5tWib5EOD1n3nA58FvihX9uznCRNA3YE3gHsip+dXXQc8JqIeLh2In3hv8TjJGkh0h6y+/p3y73AN4DPu1OYtUHS+sD+pC2Cp1ROx57oJ8ArIuLB2on0gQuAcWg++f8AT/5dchXweeBrEXFP7WRseCQtQdoe2B83GuqSnwD/5pWAeXMBMA/Nnv83gVfVzsWAdJ3uocCxXua3Lmi2B3YFPgRsVjcba/wAeKWfEXPnAmAumtP+RwJvqJ2LcSHwCeB7fuXHuqh5XrwYeB/ptkKr62hgP78dMDYXAGNovpm/ALyldi4DdzrwyYj4ae1Euqw5o7IMsCywZESckjn+DsBdwG3A7RHxQM74o0bSdsCBeNuwti9ExP61k+gqFwBjkPRp4D9r5zFgPwM+EhFn1U6kJknTgVWBNYG1Zvl5WdKEv3zzz7MeRrs3IhbPnMc9wGKz/Kd/kIqBW4DbgVtJr19eM8uPvw19CVbStqROoS+oncuAfSoiDqydRBe5AJgDt/et6hxSZ6/f1U6kTZJWATYEnklqSTtzsl8NmD7BcG0UAOMxA7ieVAxcDVwOXARcEhE35syv6yRtQ7ovZLvauQzUByLiI7WT6BoXALOR9E7gM7XzGKArSUXXSO/xS1oU2IQ02W/U/LwhsHTGYbpSAMzNHcDFpEOdM3/+Q0Tcl3GMzpG0M/C/pELP2nVgRHyqdhJd4gJgFpLeRnq1zNpzA3AwcNQoLhdLWhnYlvTJb3NgC8q3lu1DATAnj5AKwdNIZz/OBy4btYKw2dbZD/ggsHLldIZEpJbBX6qdSFe4AGhI2pt0atR/Ju24CzgE+FxE/LN2Mjk0r4NtBjyXdOf81sCKFVLpawEwJ38HzgTOAH4HXDAqp7olLQK8EzgAWKJyOkPxKKlb4LdrJ9IFnux47ITzL4EFa+cyACL1VXhPRNxSO5mpkrQisD2wM7AbsFLdjIDRKgBmdzvwG+Bk4JcRcW3lfKZM0jLAB0gNhaZVTmcIHgJeFBG/rp1IbYMvAJq2nqcBS9XOZQAuBPaPiDNqJzJZkhYGdgKe3/xYt25GczTKBcDsrgB+1fz4TZ9XkyQ9i/Tq8Za1cxmAu4HtIuKS2onUNOgCQNJKpOVF3/JV1p3Ah0n9+nt3W1ezVLsT6RKo3enmRDirIRUAs/on8GvSnR0/6mOL6GYb6TXAp0mvd1o51wDPjoi/106klsEWAM1D/be42i5p5nL/uyPi1trJTISkpUhL+i8GXgQsWjejCRlqATCrB0jbBD8lFQO92m6StDTpkODbgPkqpzPKzgd2GPW3T8YyyAKgOYX7Y9KD3cq4EHhTRJxXO5Hxapb3X0a65W0nYP66GU2aC4AnephUDHyDVAz0ZptA0lakduQb1c5lhP0E2KOPq5NTNdQC4POkytrye5j0nvMHIuKh2smMh6TNgX2AvUjd9frOBcDY7iY98I8Bft2HVwybDyzvJm2j+aByGUdGxJtrJ9G2wRUAkv4b+HjtPEbUH4F9I+LC2onMS9N57zWk97GfXjmd3FwAjM+fgG8DR0fE1bWTmRdJGwJfA55VO5cR9Z6I+HTtJNo0qAJA0itI3/B+1SavB0htTj/W5Tu4mwueng+8HdiF0f174AJgYh4l3T3xOeDkLq8KeDWgKJF6BBxbO5G2DKYAaPbSTsHfNLmdRbpy8/LaiYxF0lOAV5Mm/g0qp9MGFwCT92fgq8AREXFX7WTGImkD4Ch8iDm3B4Dt+3R2aSoGUQBIWoF02nOV2rmMkIdIvfs/3dXDM5LWAd7Y/MjZa7/rXABM3T3Ad4DDulrcSpoP+C9SK+2+HljtouuAZ/XtzaXJGPkCQNL8wEnADrVzGSHXAK+OiDNrJzInkrYG/pv0Ct+oLvPPjQuAfB4lvUr4iYg4u3Yyc9I0EPo28NTauYyQ04Adu7ylmcMQHo6fwZN/TscDm3Zx8pe0naSfkpo7vYRh/P22sqYBLwXOknSapN1qJzS7Zrl6M1LPDctjO9K5ppE20isAkl5DevfXpu5e0k1anfvzbK5YPRh4du1cOsIrAGWdTpocTujagUFJ+5DaCT+ldi4jYt+I+HrtJEoZ2QJA0iakb9RFaucyAs4D9oyIq2onMlNzon8P4H3AppXT6RoXAO04H/go8OMuFQKS1gKOJd1GaVPzAOnOgPNrJ1LCSC6RSloO+BGe/KdKwKHANh2b/LcFfg98D0/+Vs/mwA+BsyXtWDuZmZqeBjsAh9XOZQQsBBzftGYeOSNXADQnY7+JL/iZqn8Ar4iIA7pyEEbSBpKOIx3Q2bZ2PmaNLYBfSzpJUicK0oh4KCLeBbwKGGSf+4zWAo5r5paRMnIFAPApUrMXm7yrSLdkfa92IgCSVpN0BKnT4Mtr52M2hp2B8yQdJ2nt2skARMR3gW2Av9bOped2Im33jJSROgMg6eXAcbXz6LmfAXt1oQmKpCWBDwBvxQ2cJsJnAOp7EPg88JGIuLt2Ms0S9rfxh6OpEOnSoB/VTiSXkVkBkLQa8OXaefSYSCebd6s9+UuK5jTzFcC78ORv/bMgqWXvFZL2aQ6tVhMRd5DaXx9E+l63iQvgKEmr104kl5EoACRNI93uNZIHNVowc7//oIh4tGYizdsbvweOBlaomYtZBiuS/i6fLWmLmolEhCLik8DupE6HNnFLAd8clfMAI1EAkJaJn1M7iZ66jg7s90taUtJnSa8c+oCfjZotSM2EjpFU9crpiPgJsD1wfc08emx7UqfR3uv9GQBJ2wG/A0aiImvZRcCuEfG3Wgk0S6OvJW0/LF8rjxHjMwDd9nfggNpNtSStBJxA6iJoEzMD2CEizqidyFT0egWgOST2TTz5T8ZJpFuvak7+KwE/Jt1x7snfhmJF4BhJP2/OLlURETeR+gWcWCuHHpsOfEfSUrUTmYpeFwDAl/D7/pNxFOmTf5V9wFkO+V0KdK63ullLdgEulvSmWocEI+IfpLsOfIB64lYDjqydxFT0tgCQ9EZSkwsbPwEfjojX12ruI2kN4Jekg1G9rp7NMlgCOAL4Ra3T5RHxSES8BXgnfkNgov5N0r61k5isXp4BkPQ04AJ84cVEPAS8PiKq3BjWfMJ5I/D/8F5yaT4D0E/3kA40H17rbRxJryAV5wvVGL+n7gOeFRFX1E5konpXAEhaEDgL2KR2Lj1yH/CyiDipxuCSViA9VF5QY/wBcgHQbz8j3UJ3S43BJb0A+AG+S2UiLiC9TfVQ7UQmoo9bAB/Ek/9E/AN4ScXJfyfgQjz5m43Xi0hnA15YY/CI+CXpfIJ7BYzfZsD/1E5ionq1AtA0iTkHmL92Lj1xF/DCiDir7YElTSd9Q7yffhaafeYVgNEg4HDgv2p8spT0LOAXQNW+BT0yA9gqIi6onch49aYAaCaUs/E7q+N1C/D8iPhj2wNLWpN0H/mz2x7bABcAo+Zc4NU1ruSWtAHpleGV2h67p/4IbNGVG1TnpU+fzN6HJ//x+juwU6XJ/zWkBkOe/M3y2IJ0y+Ar2h44Ii4FdgSq9QvpmY2B/6qdxHj1YgVA0jNI+8i+FGbergV2bvvTQrNC81HgwDbHtTnyCsDoOhLYv+1PmM2q3snAOm2O21MPAps3xVOndX4FoLl04Wg8+Y/HNcC/VJj8lyW92+/J36ysNwEnN2/WtCYiriGtBFzb5rg9tSDwlT5cGNT5AgB4D2kJzObuBtIn/+vaHFTSpqQLfHZsc1yzAfsX0pZAq8/F5tmyE3Bjm+P21NbAO2onMS+d3gKQ9HTgD8DCtXPpuFuB50TEZW0OKmkv4P/w16drvAUwDA8Ab42Ir7U5aPNcPoV0p4GN7X5gk4j4c+1ExtLZFQBJ04Cv4MllXu4Cdmlz8pc0XdLhpIuY/PUxq2Mh4ChJ/9vmcnNE/InU1+OOtsbsqUWA/6t1z8N4dLYAAN5GunfZxnYP6VW/1t47lbQo8ENg/7bGNLO5ehdwoqTWVmgi4iJSw6J72xqzp3YA3lw7ibF0sjJpDrhcSboow+bsfuBFEXFKWwM21/f+FNi8rTFtUrwFMEx/JN3yeUNbA0ralnQAeNG2xuyhO4F1I+LW2onMrqsrAJ/Ek//cPAjs3vLkvwFwJp78zbpqY+C05rXpVkTE6cC/kS4bszlbCvh47STmpHMFgKRnA/vUzqPDBLyxzd7+kp4LnAas0daYZjYpawKnS9qhrQEj4hfA6/BVwnOzn6Staicxu04VAM3Bv8/S0a2JjnhfRHyjrcGazn6/AJZsa0wzm5KlgF9KelVbA0bEt4EPtTVeD00DvtDMcZ3RqWRITS78zv/YvhoRn2hrMElvITVhWqCtMc0siwWBYyW9va0BI+Jg4MttjddDm5NWSjqjM5+0JS1NOvi3bO1cOurnpGt9Z7QxmKQDSGcxrH98CNBmEnBARPy/VgaT5icdFPb133N2C+lA4F21E4FurQB8DE/+Y7kY2LPFyf9APPmbjYIADpV0SCuDpTsKXk5q4GZPtjzw4dpJzNSJFYCmney5QOd7J1dwA7B1RBS/jatpWHEo8O7SY1lRXgGwOTkUODAiih/Wk7Qy6a2h1UuP1UOPkC4Lav221tlVXwFoJp3D8eQ/J/eSuvy1Nfkfhid/s1H1X8AX2ziIFhE3ArsB95Ueq4fmAz7bhQ6B1QsA4DXAtrWT6CABr4uIS4oP9Hjb5dYODJlZFf8OHNHG5NN0C9wPvx44JzsAr6ydRNUCQNJCpL1/e7KPRcQPSg8yywrMfqXHMrNOeAPpe764iDgO+FQbY/XQIZKqXnNfewVgf2C1yjl00a9o753aTwBvbWksM+uGt0n6TEtjvZf0FpM90RpUvieg2h6EpCWAvwDL1Mqho/4MbNnGayKSDgbeX3oca50PAdp4fSAiPlJ6EElLkQ56r1N6rJ65FVgnIqpcqlRzBeA9ePKf3T+APVqa/N+FJ3+zoTu46flRVETcCeyBDwXObjnSbY5VVFkBkLQc6dO/P1E8TsCrmj2zsgNJ+9PSHqBV4RUAmwgBb4uILxUfSNoD+B4deQW9I/5BWgW4pe2Ba60AfAA/TGb3/1qa/F8DfK70OGbWGwF8XlLxU+nNwebPlh6nZ54CHFRj4NarMElrAleQelVbch6wbUQUvVJT0r+QDhj6z360eQXAJuMh4IUR8ZuSgzTtgk8Dtiw5Ts88BKwXEVe3OWiNFYCP4AloVv8A9mph8l8f+BH+szezOVsAOF7SeiUHadoF70VqdGbJAsD/tD1oqwWApGcCr25zzB54S0T8qeQAklYCfka6JtTMbCxLAz+TtELJQSLiKuAdJcfoodc2H9Ra0/YKwMcrjNllx0TEN0sOIGkR0if/NUqOY2YjYy3gREmLlhwkIr4GfKvkGD0zH2mFvDWtnQGQtBVwVlvj9cBVwGYl3/+UNB/wA+AlpcawTvIZAMvhRGD3kreQSlocuBBYu9QYPSNgi4g4v43B2vw0/t4Wx+q6h4HXtND84TA8+ZvZ5OxK4Ta+EXEPqSd+0TNQPRK0+EZAKwWApA1IN0NZ8j8RcXbJASTtTWq1bGY2We+S9LqSA0TEebTX+rwP9ih9EHOmtlYADsKNH2Y6G/h0yQEkbQocUXIMMxuML0l6VuExPgmcUXiMvpgGFO/OCC1MypJWJ+13z196rB54ENg8Ii4tNUBzevdcfMnSkPkMgOV2HfCsiLi11ADNp94LgYVKjdEjDwNPi4hrSw7SxgrAgXjyn+mDhSf/+YHv4snfzPJaHfiOpOmlBoiIK4CPlorfM/MD/1l6kKIrAJKWB64BFi45Tk9cCGzVNMEoQtLheN/fvAJg5Xw6It5TKnhTYJwJlN5y6IP7gTVLrrqUXgF4F578IZ1w3afw5L8XnvzNrKx3S3pFqeDNK4evx28FACwCvL3kAMUKgOb9zn8vFb9nDo6IS0oFl7QO8MVS8c3MZnGkpLVKBY+Ii4BPlIrfM/8haYlSwUuuAOwPLFkwfl/8kYLv0jb7/t8Csi75mpmNYQngu82zp5SPAhcUjN8XSwBvLhW8SAEgaWHc5xngUeANJZf+Se2VtyoY38xsdltQ8N39ZivgbaRn6NC9S1KRNyNKrQC8Bli+UOw++b+myUURkp5PCydFzczm4CBJO5cKHhFnAV8vFb9HVqTQJXpF3gKQdD6wWYnYPXIHsG5E3FYiePOGxR+AlUrEt17zWwDWlpuBjSPi5hLBJS0DXAksUyJ+j/whIjbNHTT7CoCkbfHkD/DegpN/AMfgyd/M6loB+GrzTMouIm7HbYIBNpG0de6gJbYA3lYgZt9cAHylYPx/B15QML6Z2XjtSnp1r5QvkVY7h+6tuQNmrdokLQdcDyyYM27PPAps2+xfZSdpDeBivBxrY/MWgLXtHmDDiLi+RHBJ2wCnMew7ZR4EVo+IW3IFzL0C8GaGPfkDfK3g5B+kS378IDazLlkcOKrgVsAZwDdKxO6RBYH9cgbM9sVqWjj+lWH3ob8LeHqp1o2S3gx8uURsGyleAbBa9o2Ir5cI3Fx09ieG3fPkWmCdiHgkR7CcKwAvYdiTP8AhBSf/VYBDSsQ2M8vkMEmrlgjcvGlwaInYPbIG6cxFFjkLgKEf/rsROLxg/K/gzopm1m1LUHaV8tPADQXj90G2uTZLASDpGcBzc8TqsQ9ExP0lAkt6HbBLidhmZpntKqlM45qIfwIfKxG7R54nad0cgXKtALyFYZ/OvBw4ukRgSUsBnywR28yskP8teInNV4A/F4rdB0Gm+wGmXABIWoBCbQp75L1N7+oSPoLbKptZv6wAfLBE4OZulf8pEbtHXtvMvVOSYwVgN4bdpvEc4MclAkt6JgVvgjIzK+g/JG1cKPbxQJHXrXtiaTJsC+coAPbOEKPPDooI5Q7avE/7eWB67thmZi2YDny+RG+A5pl7UO64PTPluXdKBUBzUcMLp5pEj/0sIn5bKPbrgH8pFNvMrA3bUeomu4hTgJNLxO6J3ZozYpM21RWAVwJT3ofosSKnUSUtXiq2mVnLPl3wQOBHCsXtgwWBl08lwFQLgCEv//+maU9ZwofwTX9mNhpWAN5XInBEnAr8vkTsnpjSHDzpvRlJTyW1ZRzq6387R8SvcweVtCZwBb5TwSbPrYCtax4A1o2I63IHlrQL8PPccXtCwFMj4q+T+c1TWQHYm+FO/ueUmPwbH8WTv5mNloWAD5cIHBG/AM4rEbsHAnjNZH/zpAqA5lTnXpMddASU2vvfCNizRGwzs8r2kbRJodhDvidl78m+aTHZFYBtgHUm+Xv77jL0+vEPAAAgAElEQVTghEKxDyX/Fc1mZl0wjXKH9n4AXFIodtc9FdhqMr9xspPNkA//fTQiHs0dVNJzgOfnjmtm1iEvlpT93pimL8CncsftkUnNyRNeNpA0Hfg7w+z+dxWwXq67mGdqlm/OBTbPGdcGy4cArcvOAbbO3UCtmZv+BKyVM25P3AqsNNG5aTIrANszzMkf4HO5J//GHnjyN7Nh2JLUQj6r5j6Wz+eO2xPLAdtO9DdNpgB46SR+zyj4B3BModj/XSiumVkXfbBEi2DgKOC+AnH7YMJz82QKgJdM4veMgqMj4u7cQSXtij/9m9mwbAY8L3fQiLgL+GbuuD2xx0R/w4QKAEmbMsz9FQFfKBTbn/7NbIiKXBcMHE56Zg/Nms0NsuM20RWAoS7/nxwRl+cOKmlHJrFvY2Y2AraRlP3Cs4i4FDgld9yemNAcPdECYPcJ/vpRcXihuEX6Y5uZ9USpZ+BQDwNOqAAY9yEMSWsAV0/k94yIa4F1Crz6txVwVs6YZg2/Bmh9sk1EnJkzoKT5gL8Aa+SM2wMC1oiI68fziyeyAvAyhjf5Axxe6NW/9xaIaWbWNwfkDtg8s4/MHbcHggkc1J9IATDE/f+HgKNzB21uUnxx7rhmZj30EklrF4j7VWBGgbhdN+65elwFgKSlge0mnU5/nRgRtxWIuz/u+W9mBulZ+NbcQSPiZuBXueP2wHMkLTWeXzjeSWhXYPrk8+mt7I1/JC0GvC53XDOzHnu9pEULxM2+gtsD8wO7jOcXjrcAyN6woQduB35eIO5rgSUKxDUz66slKXPJ3E+AOwvE7bqdx/OLxlsAZL+9qQeOjYgHcwZsWl++LWdMM7MR8R+52wNHxAPAcTlj9kSeAkDSusCqU06nf0osHb0AWK9AXDOzvlsf2LFA3CFuA6wuaZ15/aLxrADslCGZvrksIs4vEPc/CsQ0MxsV2Z+RTY+BK3LH7YF5FlPjKQBKVGRd9/XcASWtQloBMDOzOXuxpJUKxB3iBUHz/PA+1/0WSdOAW4BlcmXUA48Cq0fEDTmDSnov8LGcMc3G8Ajwh8wxNwHmyxzTbE4OiIhDcwYcaCfbW4AVI2LMi5HmVQBsClyQO6uOOy0its8dVNLleP/fzGxeLouIDXIHlXQ2sGXuuB23UURcPNb/nNcWwBD3/3+YO6CkbfHkb2Y2HutL2qJA3OzP9h6Y6xw+rwJgiK///ahAzNcWiGlmNqpKPDO/XyBm1831DN+YWwCSppOa4WS9VazjLoyIzXIGlLQwcCOp0YWZmc3bHcDKBXqxXAJk317osHuBZSLi4Tn9z7mtAGzFsCZ/KLNEtAee/M3MJmJpJnCr3QQMbRtgMWDzsf7n3AqAf8mfS+eVWP4v0d7SzGzU7VMg5tAKAIAdxvof81oBGJI/z+205GRIWpJhnqMwM5uq50nKem9KRFwA/DVnzB4Y882HuRUAJU5hdtkPCsTcHVigQFwzs1G3IOkm2tx+XCBml02sAJC0KrBysXS66YQCMf+1QEwzs6HYo0DMnxSI2WWrjtVdcawVgKE1S7gXODtnQEmLMc4bmczMbI5eKGnRzDHPAO7LHLPr5jinj1UADG35/7djvSYxBS8GFsoc08xsSBYh8x0qEfEQ8PucMXtgjnO6VwCSkwvELLF0ZWY2NCW2Uk8qELPL5jinP6kRkKQgNWEY0rvrz4iIbNdFNs1/bgVyL12ZmQ3NvcDyEfFAroCSnglclCteD9wFLD37xUBzWgFYj2FN/jfknPwbO+HJ38wsh8XI35fmEuCmzDG7bEngabP/xzkVAENb/i+xFPT8AjHNzIYq6zO1+ST865wxe+BJ5wDmVAAM7QBgif1/FwBmZvmUeKaWePZ32bgKgCGtAAj4TdaAqYfCujljmpkN3IaScvemOYk0BwzFk+b2JxQAkuYDntlaOvVdGRG594F2yRzPzGzoAnhe1oARNwJX5YzZcRtLesKcP/sKwFoM6931MwvEzPqX1MzMgDLP1rMKxOyqRYA1Zv0PsxcAz2gvl07I+sVvqqsdc8Y0MzMAXjD7J9gMsnaA7YEnzPEuAPLaHFg2c0wzM0vP1o0zxxzSCgC4AHjMfcBlmWM+J3M8MzN7XO7r1S8C7s8cs8tcADTOjogZmWNukzmemZk97tk5gzV3wFyQM2bHzbUAWK/FRGorsfSzdYGYZmaWlPiQNaRtgPVn/ZfHCoDmHcslWk+nntzX/64NrJgzppmZPcHKklbLHHNIBwGXlLTCzH+ZdQVgSMv/kP+L7uV/M7Pysm4DAGdkjtd1j831Qy0AboiImzPHzP2X0szMniz3OYAbgdzzQZc9tg0w1ALgkgIxXQCYmZVXYrX10gIxu+qxs35DLQCyfrElLcqwWiibmdWyqaSFM8ccUgEwxy2AJ90VPMJyf7E3BaZnjmlmZk82P7BR5pglVoW76ukz/2EagKTpwErV0mlf7i+2P/2bmbVnw8zxhrQCsHJz8d9jn1pXBuarl0+rBFyeOeYGmeOZTcU/gddmjnk0kHvZ1Wyycn/ouoQ0N0TmuF00nfTK+g0zC4BVKybTtmsj4t7MMb0CYF0yIyKOzxlQ0ldzxjOboqwrABFxt6QbgVVyxu2wVYEbZp4ByN1YoctKLPV4BcDMrD25zwDAsM4BrAaPHwIc0gpA1i+ypFWAZXLGNDOzuVpO0vKZYw7pHMCq8HgBMJRlD4A/ZY7n5X8zs/blfvZekTlelz2hABjSFsA1mePlPo1qZmbzlrsAuDZzvC5zAZDJkBoomZl1xfrz/iUTck3meF02yDMAjwJ/yxxzrczxzMxs3tbMHO860quAQ5BWAJomQEO5xvamiHgoc0wXAGZm7cv67I2IB4BbcsbssJUlzTeNYTUByrrH0xRPQ1k9MTPrktUlTZv3L5uQoZwDmA6sOLMAGIrcX9xV8R0AZmY1LED++euazPG6bJVpDOsd9twFgJf/zczqyf0Mvi5zvC5bdhqwZO0sWpS7AFgzczwzMxu/NTPHG8oWAMAy04DFa2fRouszx1szczwzMxs/rwBM3jLTgKVqZ9Gi3Cc818gcz8zMxi/3M/jWzPG6bJlpwBK1s2jRHZnjrZA5npmZjV/uZ/DtmeN12TJDOwOQuwBYNnM8MzMbv9zPYBcAI+oR4O7MMV0AmJnVs1zmeHeSOsYOweJDKgDuiIjcX1gXAGZm9WR9BjdzxF05Y3bYYoMqAHIGk7QQ8JScMc3MbEIWl7Rg5phD2QYY1ApA7i9q7qUnMzObOJ8DmJxBrQDk/qJ6+d/MrD4XAJOz2HTSgYc7a2fSghsyx1ucYfy5jbLFqXsR1n3AvgXizigQ87WUuffia8CiBeKO1yPAPRXHt6nL/Sr79Qzj2T4jamdgVouki4ENK6ZwV0QMqRHXk0i6k7qrkJdExDMrjm9WTe6rFM3MzKwHXACYmZkNkAsAMzOzAXIBYGZmNkAuAMzMzAbIBYCZmdkAuQAwMzMbIBcAZmZmA+QCwMzMbIBcAJiZmQ2QCwAzM7MBcgFgZmY2QC4AzMzMBsgFgJmZ2QC5ADAzMxsgFwBmZmYD5ALAzMxsgFwAmJmZDdD02gmYDdjCkg4pEPfBiPhgzoCSPgwsmDNmY+ECMc1sHELSTZT5xu6a70bEW3IFk7QD8MNc8ayKxYH5aidRwL0RsXjOgJLuARbLGbMjHgHuqZ2ETcnuEXFqrmCSvgS8Mle8DntoOhDAUrUzacGqmePdzTD+3MxG2Xz4+7jv7socb3WG8Xfi9mnk/8PrqmUyx7stczwzM5u4WzPHyz1XdNW9LgAmL/dfOjMzm7jbM8dzATCCsn5RI+JB4N6cMc3MbELujoiHMsccSgFwz5AKgCUl5X7t0dsAZmb1ZF2JlTQfsETOmB127zTSYbYhmA9YMnNMFwBmZvXkfgYvxXD649wzDbizdhYtWjpzPBcAZmb1+ADg5N02pBUAyP/FvSVzPDMzGz8XAJM3qNcAAZbNHO/azPHMzGz8cj+Dc88RXXbH0AqA1TLHuyZzPDMzG7+rM8dbPXO8LrttaAXAGpnjXZM5npmZjd81mePlniO67PahHQJcM3O83NWnmZmNX+5n8OAKgBtqZ9Gi3Ms7fwNmZI5pZmbz9hBwY+aYQyoA/jaN9Ac4lElszZzBImIGqQgwM7N2XRcRj2aOuWbmeF31MHDztIh4BPh77WxasqKk3FcfexvAzKx9WZ+9khYGlssZs8NujIhHZnY8Gsqn2GnkvxbYBYCZWfuuyRxvdSAyx+yqv8HjLQ+vr5hI23Lv8VyeOZ6Zmc3bZZnjDWn//3p4vAAYygoA5N/juThzPDMzm7fcz94hFQA3wDALgHUzx7skczwzM5u33AXAepnjddkTVgCGtAWwQc5gEXEDcHvOmGZmNle3RkTuu1g2zByvy64HmN78y5BWAEp8kS8BdigQ12wyFpR0SO6YmeOZTcVFBWJm/XDYcX+DxwuAIa0ArC5p8Yi4J2NMFwDWJQsAB9ZOwqygrMv/kpYEVskZs+OesAVwE8NpBhTAMzLH9DkAM7P25N7/H9Ly/8M0V9lPA2iaAd1UM6OW5f5i+00AM7P25P7QNaTl/xubOf+xFQCAqyolU8P6meNdyHBWUMzManqQ/GcAhrQC8OeZ/zBrATCkhjZZv9gRcT/wx5wxzcxsji6MiAcyxxzSCsBjDZSmzek/DkCJL/aZBWKamdkTlXjWDqkAuGLmP0yb038cgFUkrZw5pgsAM7Pysj5rJa0OLJ8zZsfNcQVgSFsAAFtmjucCwMysvNzP2q0zx+u6x+b6xwqAiLgRuKtKOnVslTNYRFwN3JgzppmZPcENEZG7cV3WuaDj7pi1g+K02f7nlS0nU1OJqu/sAjHNzCw5vUDMIRUAT1jpn70AGNI2wBaSps/7l03IGZnjmZnZ487KGUzS/MBmOWN2nAuAxqLkf/fzd5njmZnZ436bOd4mwMKZY3aZC4BZ5N4GuAC4NXNMMzODm8nfb2WwBwDBBUDug4CPAr/JGdPMzAA4KSKUOeaQ9v9hHgXA1UDuDktd9uwCMU8qENPMbOhKPFuHVADcD1w36394QgHQXBAwpJa2T5e0UuaYv8wcz8xs6ETmAkDSKsBTc8bsuAubVerHzL4CAHBOS8l0QQA7Zg2Y3lEdUldFM7PSLo6I3DfWPi9zvK570tw+pwLg3BYS6ZISfwl+VSCmmdlQlXim7lwgZpc9aW4f+goAuAAwM+u6rM9USdlXf3vgSQVAzP4fmj+YO4Al28ioI9aPiGxvQEhaCLgFWCxXTDOzgboLWCEiHsoVUNJGDOu82x3AsrO/RfGkFYDmF5zXVlYdkXUVoLmr+uc5Y5qZDdRPc07+jaHt/587p1co57QFAMM7B1BiL+gHBWKamQ1NiWfp0AqAOW7tuwBIntP0hM7pROCfmWOamQ3J/eTf/18A2C5nzB6Y45w+VgEwtIOAi5G5JWRE/AM3BTIzm4oTI+L+zDG3I90FMyRz3NafYwEQETcANxRNp3t2KxDz+wVimpkNRYnl/5cUiNll143VQ2GsFQAY3jbAvxWI+RMg9+EVM7MheBD4WYG4QysAxpzL51YADG0bYK3m1ZBsIuIufDmQmdlk/Coi7skZUNLmwFo5Y/bApAqAUwok0nV7FIh5TIGYZmaj7ugCMUs847vud2P9jyc1AppJ0nTgdmDxAgl11UURsXHOgE1ToJsYVmMlM7OpuANYOSIezBlU0uXAejljdty9wNIRMWNO/3PMFYDmN5xWKquO2kjS03MGbJoCHZczppnZiDu2wOT/dIY1+QP8dqzJH+a+BQDD3L9+aYGYJZayzMxGVYln5ssLxOy6uc7h8yoAfp0xkb54We6AEXEGviLYzGw8Lo2IEu3osz/be2Cuc/j0efzmi4DbgGWzpdN9W0laNSL+ljnuMcDHM8c0m5NHgD9kjrkJMF/mmGZz8vXcASWtCWyWO27H3QxcOrdfMNcCICIelfQ7yrwj31XTgL2AT2aOewzwEfwQtfLuj4hn5Qwo6R58u6WVNwP4VoG4ezOXQ+8j6rdzugBoVvPaAoBhngN4be6ATXdF3xBoZja2n47VtW6K9ioQs+vmuYU/ngJgiOcAniFpiwJxDy8Q08xsVHwud0BJ2wLr5o7bA/P88D7PAiAi/gTk3g/vgxKrAL8CLskd18xsBFxKmQZ02Z/lPXBtRPx1Xr9oPCsAMMxtgD0lLVgg7pcKxDQz67vPzmvPeqKaRmxDfP3v5PH8ovEWAFnvY+6JpYFdC8T9OnBngbhmZn11F3Bsgbi7M8wurFkLgBOBhyefS2/tkztgc7f113PHNTPrsf+LiPsKxB3i8v/DwC/G8wvHVQA0t9qdOpWMeupFkpYrEPdzpHe1zcyG7lEKbI1KWhl4Xu64PfDbZs6ep/GuAAD8eJLJ9Nn8wH65g0bENcAJueOamfXQjyPi6gJx38Aw+678aLy/cNyNESStAlw/kd8zIq4D1o6IrJ/YJW0JnJ0zplnj3ojIeounGwFZQVtGxJh31k9Gc5vt1cCqOeP2gIDVx9vJdtwrAE0jmwsnm1WPrQ7sljtoRJzDOA9qmJmNqF/knvwbezC8yR/g3Im0sZ/IFgAMcxsA4D8Kxf1YobhmZn1Q6n6U/QvF7boJzdETLQDGvbcwYnaU9MzcQSPid8BpueOamfXA7yLi97mDStoQ2D533J6Y0Bw9oQIgIi4C5tldaES9pVBc3xBoZkNUagX0HYXidt1VEXHZRH7DRFcAYLjbAK+VtFTuoBHxc6DE3ddmZl11dkRkPwMlaUlgz9xxe2LCK/QuAMZvEco1lfAqgJkNyUcLxX0DsGih2F034bl5wq/0SZoP+Duw7ER/7wj4C7BeRMzIHVjSGcCzc8e1QfJrgNZlZwHbFOj7Px34M7Bmzrg9cQuw8kRfV5/wCkAzwPET/X0jYh3gFYViH1QorplZl7wn9+TfeDXDnPwBjptMr5rJbAEAfGOSv28U/I+kyf65jSkiTgV+ljuumVmH/CgiTs8dtHkmH5A7bo9Mak6e1EQWEWcCf5rM7x0BzwBeUij2QaS+2GZmo+YR4H8Kxf5XYINCsbvuz8CkmilN5ZNsiasb++L9krK3RI6Ii4Fv5o5rZtYBX4uISwvFPrBQ3D44ZrJbKpOexCStQ6o8hnY3wEzPj4iTcgeVtCppdWXh3LFtMHwI0LrmAeDpEXF97sCSdmW4l6sJeGpETKo/z6RXACLiL8CZk/39I+C9JYI2fZy/WCK2mVklny0x+Tf+u1DcPvj9ZCd/mNoWAAz7MOBzJG1XKPbBwE2FYpuZtenvwCdKBJb0XGDbErF7Ykpz8FQLgOOAB6cYo8+KHGiJiHvwa4FmNhr+MyLuLhT7/YXi9sEDwPemEmBKBUBE3MGwX117gaSdCsX+BnBKodhmZm34PfCdEoEl7QI8t0TsnvhpRNw1lQA53mcf8jYAwCcKvREg0pWWD+eObWbWghnA20o0/WmeuUO/Tn3Kc2+OAuBE4PYMcfpqC9I7qNlFxCXAl0rENjMr7DPNq80l7AlsVih2H9wK/GKqQaZcAETEQ/jd9Y81fahLeD8+EGhm/fJ3Cl34I2kB0kHpIftGREx5dThXS9vPM+wOdk8HXl8icHMgcMgtLs2sf97RPLtKeDPpXpahEnBEjkDZ9q4l/Qp4Xq54PXQT8LSIuK9EcEk/Al5aIraNHDcCspp+GhFF2qVLegpwFbBCifg98fOIeFGOQDkvtflCxlh9tBLwjoLx3wrcWTC+mdlU3QW8pWD8dzPsyR8yzrU5VwDmA/4KrJ4rZg/dDawbETeXCC5pP+CrJWLbSPEKgNWyd0QUORMmaSXgSob99/BqUuvfLFvu2VYAmruIv5wrXk8tARxSKnhEHAX8vFR8M7MpOLHU5N84lGFP/gBfzjX5Q+aLfCQtC1wPLJQzbs8IeE5EnFokuLQKcAmwZIn4NhK8AmBtuxvYsLnLJLum7fqpDPfyOUhdd1ePiFtyBcx5BoCIuI0ptiYcAQEc1myJ5A8ecQN+K8DMuuWdBSf/+Uhvmg158gf4Ts7JHzIXAI2hHwYE2JT0qkopX2HYLZjNrDt+EhFfLxh/f2DjgvH7IvvcWqSiknQesHmJ2D1yJ+lA4K0lgktaDvgj6e0Ds1l5C8DacgOwSbP6m52kFYAr8JbnBRGRfU4tsQIAbl8LsBSFrsAEaAqLVwOPlBrDzGwuHgX2KTX5Nz6FJ3+Aw0sELVUAfAu3rwXYV9LWpYJHxO9IJ2PNzNr20Yj4TangkrYB9i4Vv0duBr5bInCRAiAiHgA+VyJ2z0wDjmh6V5fyfuDMgvHNzGZ3GvCRUsGbZ+YR+OAfwKcj4p8lApdaAQD4Iqkr1NBtBLy3VPCImAG8CncJNLN23EVq+DOj4BgfADYsGL8v7gaOLBW8WAHQXAThswDJ+yQVu7oyIq6jbPtNMzNIfU72i4hrig0gbYxfdZ7pcxFxd6ngJVcAAA4D7i88Rh9MB46SNH+pASLiu8D/lopvZgYcEhE/LBW8uVb9KKDYs7JH7qfQ4b+ZihYATdOCo0qO0SNtVLUHAL8sPIaZDdNJpDNHJb0PKLZa2jNHlnqNfKbiBywkrUa6vrHkQbi+eAjYPCIuKTWApKWBc4G1S41hnec+AJbbNcAWJV/5k7QR6dnluQIeJl36c13JQUpvARAR1wPfKT1OTywAHFN4K+AOYA+89WJmefwT+NfCk/900k2nnvyTY0pP/tBCAdA4hNQ0wlKb4HeXHCAi/gi8seQYZjYIAvaNiAsKj3MQ8KzCY/TFI6QGSMW1UgBExOXAT9oYqyc+IunZJQeIiGOBz5Qcw8xG3qHNAeNiJG1Beu3Pku9HxJ/aGKi1JgvNF/mctsbrgb8CmzavSxbR3KL1PWD3UmNYJ/kMgOVwArB7RBRrNy5pSeBCYM1SY/SMSOfELmxjsLa2AIiIc4EftzVeD6wN/F/JAZpv3FcDZ5Ucx8xGzrnAq0pO/o0v4sl/Vt9ra/KHltssSloPuJj0Xrwlr4uIo0sO0NwceAbw1JLjWGd4BcCm4q/ANhFxc8lBJL2Bwh+CeuYR4JnNlnkrWlsBAIiIK0gXBdnjviBp3ZIDNO+S7gbcUXIcM+u924EXtTD5Pw2fUZrdUW1O/lDhogVJawBXAgu2PXaHXUCquB8sOYik7YFfAQuVHMeq8wqATcYDwM4RcXrJQSQtSNqW3KTkOD3zAPD05rX51rS6AgAQEdcCX2573I7bjPSqZFER8XtgX/xKppk90aPAa0pP/o1P48l/dp9ve/KHSlctSloW+AuQ9VPKCNgzIoo3TZK0H/AVfNXmqPIKgE2EgLdExBHFB5L2Ar5ZepyeuRtYJyJub3vg1lcAAJqOUt7/ebKjSt4aOFNEHAW8q/Q4ZtYLB7Q0+W9Cwatte+xTNSZ/qPgJUNJTSHcErFArh466FnhWybabM0n6APDh0uNY67wCYOP1voj4eOlBmjtKzgPWKj1Wz9xC6vl/b43Bq6wAAETEP2hh37uH1gC+3TTxKSoiDsZfA7Oh+kxLk/98wLF48p+TD9ea/KFiAdD4IumdU3uinYGPtTFQRPw36VCOmQ3H5yPiP1sa61PAC1oaq0+uJp3FqqZqARARD1H+fum+OkDSy1sa67+o/BfRzFpzJPD2NgaStCfQVqHRNwc2c2A11U+BSwrgFGD72rl00D+AbSPiotIDNV+H/wXeWXosK85nAGwsXwL2j4jirwI3h/5OBxYpPVYP/SYidqqdRO0tACJCwFuBGbVz6aCnAD+XtFrpgSJCEfEu4ODSY5lZFZ+MiLe2NPmvQroB1pP/k82gIx+0qhcAABFxCW4ONJaVgZ81t2YVFxEfJN3NbWaj45MR0cr3taTFgROB4h9ceupzEXFx7SSgA1sAM0laitQieLnauXTUb4Fd2tozkvQ24HA69HfExs1bADaTgHdHRCt9VyTNT5r8n9fGeD10M7BuRNxdOxHoyAoAQETcCbyvdh4d9lzS/l0rIuILwL/jtsFmffUo8KYWJ/8gHTD05D+2A7sy+UOHCoDGV4GzayfRYftJau2tiYg4Eng1UPSSIjPL7p/AKyKizbd7PgS8rsXx+uZM4JjaScyqc8u7kjYHzqF7xUlXCNg3Io5ubUDp2cCP8fZMX3gLYNjuAHZvLv9qRXO/yFfbGq+HHgW2johzaycyq85NshFxPvD12nl0WABHSmqtsUZEnAlsA/y5rTHNbFL+SrpavM3J/0X4EPe8/F/XJn/o4AoAgKTlSQcCWzn53lP/BF4UEb9ra0BJy5BWArZta0ybFK8ADNPZwEsi4pa2BpS0I+nQ30JtjdlDd5AO/hW/32WiOrcCAND8BfaBwLlbGPiJpK3aGrC5ser5pPd7zaw7fgTs2PLkP3Nr0JP/3B3UxckfOloANL4E/Lp2Eh23GPDL5txEKyLifmAPfJ2zWReI1Gv/X5vvzXYGlTYGTiA1K7Ox/ZYOt1nv5BbATJLWAi4GFq2dS8fdCjwnIi5rc1BJryId/HG3r27xFsAwPAC8OSJaPVkuaV1S+3Zf5T539wMbRcRfaicyli6vABARVwMfrJ1HDywH/Kb5xmxNRHyHdDjw6jbHNTOuA7arMPmvA/wGT/7jcVCXJ3/o+AoAPHaX9GnA1rVz6YFrgX+JiOvaHLQ5HPht3ACkK7wCMNp+Cbw6Iu5oc1BJqwOnAmu0OW5PnU56Fne6kVqnVwAAIuIRYF/ScpfN3RrA7yU9rc1Bm8OBLwQ+SdqTNLP8RPoe27XC5L8WaT/bk/+8PUjqwNjpyR96UAAARMQVwEdr59ETqwOnSnpmm4NGxCPNZSOvAjrT6tJsRNxJOuh3UPOhqDWS1gN+D6zd5rg99oG2z2NNVue3AGaSNB04C2jtxHvP3UG6PKj15hPNUuGxuF9ALd4CGC1nA3s2Z6JaJWlT0paDu4COz4XAVhHxcLq3i0wAABSnSURBVO1ExqMXKwAAETED2A/oxR9sBywN/Kp5V7dVzRmE5wAfBlr9tGI2QgR8Dti+0uS/BXAynvzH6yHgtX2Z/KFHBQBARFwEHFI7jx5ZEjhJ0k5tDxwRMyLiQ6SDgTe0Pb5Zz91MWsF7R40JRdIOpD4sS7c9do99PCIurp3ERPRmC2AmSQuQblXarHYuPXI/af/wFzUGl7Qc8DVg1xrjD5C3APrtJ8Dra3WPa3r7fx93+JuI84BtI+Kh2olMRK9WAACaP+BXAvfWzqVHFgF+KumNNQaPiFsj4sXAK0hnE8zsye4G3ky6ya/W5P86UlthT/7jdx/wmr5N/tDDAgAgIq4C3lk7j56ZDhwh6UOSqqz8RMTxwIak/uFm9rifAxtGxJER0fqrtJJC0oeAo4D52x6/594aEVfWTmIyelkAAETEUaTmMzZ+QeqseJSkKt/kEXFTROxOWg24vUYOZh1yF6md74si4m81EmjesDqC9Gzo3bZwZce13Y0xp15/sSUtAfwBWLNyKn30a9K5gGrv7EtaEfgi8LJaOYwonwHohxNJk3+1Q7KSFgOOA3aplUOP/RXYNCLuqZ3IZPV2BQCgmbxeiV8NnIydgNOad/ariIi/R8QewF7ATbXyMGvZDcArI+LFlSf/lUmtfT35T9wM0r5/byd/6HkBABAR5wAfqZ1HT20InC5po5pJRMSxwNNIfQN6d5DGbJxmkN7rXz8ijquZiKRNgHOBTWrm0WPvj4gzaycxVb3eAphJ0jTgJGDH2rn01D+Bf+/CXlZzo+Hh+GKhqfAWQPecAuwfEZfUTqS5xvsr+Jr1yToF2Kntlswl9H4FAKC5dOG1+FDZZC0MHC3piOZAUDURcWVEPB94CXB9zVzMMriJ9Gx6bu3JX9J8kg4hten25D85t5FuYuz95A8jUgAANCdo34hvo5uKNwEnSqre/SsifkraojgU3wRp/fNP0s1960bEMTVe7ZuVpGVJPf0PZERWfisQsG9E3Fg7kVxGpgAAiIgfAp+qnUfPPR/4g6Rn1U4kIu6JiANI5wOOxPcKWPc9ChxP2uc/KCKqNyxr9vvPIR38tcn7aEScUDuJnEauEmzOA5xAup/eJu8B0rmAo2snMpOkZ5AOCr68di4d5zMAdZwMvLu5s6QTJO1J2u9fpHYuPfcr4EWjsvQ/00itAMBj5wH2Blq/PWvELAR8XdJnJC1YOxmAiLg8Il4BPJv0+pJZF5wNPCcinteVyV/SQpIOJ+33e/KfmquAV43a5A8jWAAARMTtwO6kS3Bsat4JnCdpw9qJzBQRZ5GuG34p6VUmsxrOBnaLiK0j4pTaycwkaT3ShWn7185lBNwHvCwi7qydSAkjWQDAY1cHV7n8ZgRtCJwj6R21E5kpIhQRP4mILYHtScuvZm04HXhJM/F3ak9Y0j6km+n8fv/UiXQrY/VXN0sZ2QIAHmswc1jtPEbEwsBhko6XtFTtZGYVEadFxPNIhcAJ+E0QK+N0YOeI2K55S6UzJC0u6VvA0fgVv1wOjYjv1k6ipJE7BDi75r32XwHPrZ3LCLkW2CsiTq+dyJxI2hL4b1IvgZEucsfgQ4D5PEq6vfITEdHJ7SZJW5AuRlundi4j5NfALhExo3YiJY18AQAgaXnSsthqtXMZIQ8DHyBVyZ08HCNpbVJvgzcAy1ROp00uAKbuHuDrwGER0ckDxc2HmwOBD5Gu+7Y8rgG2iIjbaidS2iAKAHisSj6VdLrd8jkH2C8iLq2dyFgkLUS6fvg9wDMrp9MGFwCTdyXwJeArEXFf7WTGIumZwNeAzWvnMmL+CWwbERfWTqQNg1kebZbv9iEt6Vk+WwIXSjpE0gK1k5mTiHiguedgY2Bn4Ee4qZA9bgbwQ2DHiFgvIv5/e/cebFdZn3H8+wC2iHQQAnJRRDFQhBKUcAtBIzRRLEIHuQ0VsY0jkRaEqrQ4jnWoM3Qygy1QUKCRtgQqJVDEMNVqsKCEiyVUCJeISLgECgknCeFiCHB+/eNd0UMkJ+ec7L1/a6/1fGbWnDP8EZ7JnJz17LXe9/deUNebf0RsFhF/Tdn94pt/Zw1STvhrxc0fWvQEYK2IOAtPC+yWeylPAxZkB9mQiNiR8lTgT2neimk/ARiZB4FrgMslPZ4dZkOqUzsvxzf+bjlT0gXZIXqpdQUAICIuBE7PztFQrwJfB74q6eXsMCMREXtRhkdNB7ZLjtMJLgDrt5Jy058t6dbsMCMREW8CPg/8LVDLp2wNcImkU7ND9FpbC8CmlEd+R2ZnabB7gVMk3ZkdZKSqiYdHUV4VTQNqMQFxDFwAXu9lyk6gK4C5/VJMASJiMnApsFd2lga7Hji2miLbKq0sAAAR8WbgR8BB2VkaLIArgS9KWpodZjQiYgvK4SnHUaZK9tPNzwWgLOa6iXIwzw2SnkvOMyoRMY6yy+Y0WrRWK8FdlDHOtVzz0W2tLQAAEbEdcBswPjtLw62kbFW6qK5bBodTlcWplDJwFLBVbqINamsBeIlS6ucA/yHpheQ8o1Zt7ZsOnEu7tq5mWAxMkvRMdpAsrS4A8OsT5uYDtZpu11D3AKf1y7vXN1K9JpgCfITymqCO2wrbUgACWAj8kHLW/S2S1uRGGruI+ABwETAhO0sLDFC2+/08O0im1hcAgIj4IOUdYb++8+0na18LnNWE5l0NmZpCeUJwBPD23ERAswvAMuBmytkP35P0RG6cjRcRO1B2Jp2Efyf3wmpgWj9/EOkU/7BVqnOzr8Tv23plFeWX3vlNef8WEaJsKTyUcmTxJHIKQZMKwBLKyXa3U278P5PUiLMeImJLyur+L1KPctUGg5SjfedkB6kDF4AhImI6MAv/vfTSs8B5lCLQN6uzRyoidqLs254MHFJ93+1plP1aAF4FHgJupbyWW1DnCZNjVW3r+zPgHGCH5DhtEsCpki7NDlIXvtGtozry1icI9t5jlIVPs5q8HacaSzyhuv6guibQ2fkD/VAAllLe3y8E7qNsG10oaXUH/x+1Uj0hOpbyc+6Fx713lqTzskPUiQvAG4iIr1JWrVvv3Qd8qW7nrHdbRGxPWVC4N/Be4N3Au4B3MvrhL3UpAGuAxymHqywGHqC62ffbttCNFRFTgZnAvtlZWurLks7NDlE3LgDrEREzgb/KztFi84CvSfpxdpBMEbEJZR3BuyilYG0x2La6tgPexutvzr0oAM9TPsUvo7zGWUa50T9KudkvBp5q8tOckYiID1H28/s48jznSvpydog6cgEYRkR8nbJIx/LMp3xyurEpi7+6odqeOI5SCraWdEuH//wpwArKzX6gies1OikiDqG84z8sO0vLXSTJY9/XwwVgGNU7u0uBz2RnMe6lnDFwVT8OE7Lmq57WHAF8Bdg/OY7Bv1IOJ2v1U6jhuABsQHVuwGzgxOwsBsAvKdsHL5f0anYYs+rGfwzlE/97k+NYcS1lu58/LAzDBWAEqm0711LGwFo9LKZMTbtc0srsMNY+EbE1ZWzvaZR1GVYPNwDHSXolO0jduQCMUPWO9RpcAurmRcoAp4slLcwOY80XERMoN/1PAFskx7HXuwE4wWtURsYFYBSq1wH/TDk73upnAXAh8G23f+ukIe/3P0c5JdK/O+vnauBk/9sfOf8Qj1JVAv6JMsnL6ukJ4BLK64Gns8NY/6omOU4HPks9znmwN/YtYIbf+Y+OC8AYVLsD/h44MzuLDWuQcjzsbOBaSS8l57E+UL3u+zDlSd/RwGa5iWwDvgGc7tX+o+cCsBEi4hzKkA+rv+eA7wJXADd5poCtKyImAidT3u2PS45jIzNT0tnZIfqVC8BGioi/oWz/sf7xEKUIzJb0eHYYyxMRu1Bu+p8EdkuOY6Pj8b4byQWgAyLiL4B/xH+f/egBYA5wjaQHssNY90XErsCRwHHAwfjfbb8J4AuS/iE7SL/zD36HRMQpwDeBTbKz2Jg9AtxIKQTz/ZqgOSJiL8oN/2OUI5mtP70GfFbSrOwgTeAC0EERcSJlm+DvZmexjfYocD0wl1IG1uTGsdGoFvJNpnzSPxrYJTeRdcBqyja/OdlBmsIFoMMiYhJlsdm22VmsY14CbqOcUDgPuNtPB+qnerQ/tbo+AnT0RERLtRw4uu2ng3aaC0AXRMR44D/xoqKmWgrcQikD3/dCwhwRsT3wQcoN/4+Ad+Qmsi55BDhC0qLsIE3jAtAl1S+nufhUsDZ4CLizuu4A7vFBRZ1VncexD3AQcGB1uWA33x3AUZKWZQdpIheALoqItwD/hs8PaJtXKMcXz6eMJ75V0iO5kfpLNYFvYnVNpqzW99z9dvkO8AkP8OoeF4Auq0YHn085PMTaawVly+H9Q77eK2lpaqpkEbEVMB7YC9hzyNddM3NZuguBv/R0v+5yAeiRiPgC5Rx7bxO0oZZQysB9wCLgMeBx4DFJqzODdUpEbE5Zhb/2+n1gb8qN3u/tbahB4POSLsgO0gYuAD0UEcdS5tJvnp3F+sLTlELw61JA2Z44QFkVPQAMZO1IqM7EGLfONfRG/87q6w4Z+azv/IryyP/67CBt4QLQYxGxH3Ad5ZejWScMDLmWA09KmtHJ/0FEXEo5DW8bXn/DN+uER4GPS/rf7CBt4gKQICLGUc6unpqdxRrpeUkd3QMfEauA3+vkn2lWuQU4vu3rYTL4fXQCSQPA4cDM7CxmZokuA6b65p/DBSCJpNeqYyxPBF7MzmNm1kMvACdImuGZGXlcAJJJupqyx9n7xM2sDR4GDpZ0TXaQtnMBqAFJ91ImBv5XdhYzsy76HnCApIXZQcwFoDYkLQc+CpxN2QtrZtYUQVnz9DFJK7LDWOECUCOSQtJM4BjKdi4zs373LGWe/9me7FcvLgA1JOk7lINPbsnOYma2Ef4beJ+kG7OD2G9zAagpSUuAQ4EzKYfLmJn1i1eBc4Bpkp7MDmNvzIOA+kBEHEA5VfA92VmsL3gQkGV6jDLSd352EBuenwD0AUk/BfYFrsrOYmY2jGspj/x98+8DLgB9QtIqSScBn6IM0TAzq4vngRmSjpO0MjuMjYwLQJ+RdAUwAbgjO4uZGbAAmCjpsuwgNjouAH1I0mJgCvA1vEDQzHKsoSz0myTpF9lhbPS8CLDPRcTewOXAftlZrDa8CNC67R5guqS7s4PY2PkJQJ+rRmpOokwQXJ0cx8yabTXlU//+vvn3Pz8BaJCIGA/MorwesPbyEwDrhtuBT0t6MDuIdYafADSIpIeBw4AZeKeAmXXGryhPGD/gm3+zuAA0jKTBajXuBOCm7Dxm1td+Auwjaaak17LDWGe5ADRUtVNgGnAq4NO3zGw0lgOfAaZ4hX9zuQA0WHW64CXAeOBCwA3ezIYzCMwG9pA0S1JkB7LucQFoAUnLJZ0BHADclp3HzGrpLmCypJMlLcsOY93nAtAi1badQyjjhJ9JjmNm9TBAOXX0QEmeMNoiLgAtU70WuALYA5hJmeZlZu3zKuXV4HskXSBpMDuQ9ZYLQEtJWinpbGAf4AfZecysp24G9pV0hqTnssNYDheAlpO0CDgcOBF4NDeNmXXZI8Dxkg6tpohai7kA2NrXAlcDu1OGCD2dHMnMOutZyjCfPSXNyQ5j9eBRwPZbIuItwGnAl4CtkuPY6HkUsK31AnAxcK6kVdlhrF5cAGy9ImIccBbwOeDNyXFs5FwAbA3wL8BXJC1NzmI15VcAtl6SBqqFgrsDl1FWDZtZfQ0CcyiDfGb45m/DcQGwDZK0RNIMYG/KLxdPBzOrn3nA+yQdX40CNxuWC4CNmKRFko4H9gOuo3zaMLM8g8A1wPslTfPKfhsNrwGwMYuIXYEzgFOAzZPj2G94DUDzvQJcTVnctyg7jPUnFwDbaBGxA2WU6OnAFslxzAWgyV4EvgWcJ+mJ7DDW31wArGMiYlvK9sHTgW2S47SZC0DzrKKs6v87SZ7TYR3hAmAdFxFbAp+mbCF8e3KcNnIBaI6lwDeB8yWtzA5jzeICYF0TEZsDfwL8OTAxOU6buAD0v7uAbwDflrQ6O4w1kwuA9URETKQsFvwkHirUbS4A/ell4LvAZZLmZYex5nMBsJ6KiLcCn6LsHnh3cpymcgHoL08Cs4CLJS3LDmPt4QJgKSJiE+AwylOBjwOb5iZqFBeA+hsEfkSZsHm9JE/ZtJ5zAbB0EbEbcCpwMjAuOU4TuADU1zLgCuASSQ9nh7F2cwGw2oiITYFDKUXgGDxTYKxcAOrlZeCHlBv/DZLWJOcxA1wArKYiYivgjymLBv8Q/6yOhgtAPSwAZgNXSXo2O4zZuvxL1WovInambCecTjmZ0IbnApDnMcqI3ll+xG915wJgfSUiJgEnAccD2ybHqSsXgN5aBvw7cKWkO7PDmI2UC4D1pWoXwfuBI4ETgD1yE9WKC0D3LQbmVtfNXsVv/cgFwBqhOpnwSOA44GDa/bPtAtAdDwBzgLmSFmSHMdtYbf4laQ0VEW8DDqeUgQ8Dv5ObqOdcADrjNeAOyk3/OklLkvOYdZQLgDVaNXnwo8A0yuChXXIT9YQLwNg9ShnQ8wPg+5Key41j1j0uANYq1auCQ4DJwBE087RCF4CRWwbcDMwD5ku6PzeOWe+4AFirVYVg6pBr69xEHeECsH4vArdTbvjzgLslRW4ksxwuAGaViNgM2A+YAhwI7A+8IzXU2LgA/MYTwP8AdwI/Bu7yin2zwgXAbBgRsSOlFEysroOo//yBthaAVcBCygS+BcBPJC3OjWRWXy4AZqMQEQJ2ozwdOKD6ug/1OregDQXgJeBnlE/3P62+PuzH+WYj5wJg1gERsROwJ7ArsFf1/d7A9glxmlQAVgK/pOzBvx94pPp+kaTXEvKYNcZm2QHMmkDSU8BT6/73iNieUgb2GPJ1d2An/O9vrVcof3e/AB6k3OB/Djwg6ZnMYGZN5icAZkkiYmvKE4OdgB3f4PudgTeN4Y+u2xOAFZRP7v9HudGv+/3jXphn1nsuAGY1FRGbUl4h7ExZeLgNMG6d663AlkOurYGQNK7DWQYovy9WAC8MuVYAy4GBIddy4FnKCvynJQ12MouZdcb/A7d/4Va4V/LHAAAAAElFTkSuQmCC';

// ── SVG Card Builder ────────────────────────────────────────────────────────

// Scope watermark — matches the original design with concentric thin circles + crosshair
function scopeWatermark(size) {
  const r1 = size * 0.95;
  const r2 = size * 0.71;
  const r3 = size * 0.48;
  const r4 = size * 0.24;
  const dot = size * 0.06;
  const tickOuter = size;
  const tickInner = size * 0.85;
  return `
    <circle cx="0" cy="0" r="${r1}" fill="none" stroke="white" stroke-width="1"/>
    <circle cx="0" cy="0" r="${r2}" fill="none" stroke="white" stroke-width="0.75"/>
    <circle cx="0" cy="0" r="${r3}" fill="none" stroke="white" stroke-width="0.75"/>
    <circle cx="0" cy="0" r="${r4}" fill="none" stroke="white" stroke-width="0.75"/>
    <circle cx="0" cy="0" r="${dot}" fill="white" fill-opacity="0.4"/>
    <line x1="0" y1="-${tickOuter}" x2="0" y2="-${tickInner}" stroke="white" stroke-width="1"/>
    <line x1="0" y1="${tickInner}" x2="0" y2="${tickOuter}" stroke="white" stroke-width="1"/>
    <line x1="-${tickOuter}" y1="0" x2="-${tickInner}" y2="0" stroke="white" stroke-width="1"/>
    <line x1="${tickInner}" y1="0" x2="${tickOuter}" y2="0" stroke="white" stroke-width="1"/>
  `;
}

// Scope icon (top-right branding) — inline SVG version
const SCOPE_ICON = `
  <circle cx="0" cy="0" r="28" fill="none" stroke="white" stroke-width="2.5"/>
  <circle cx="0" cy="0" r="18" fill="none" stroke="white" stroke-width="1.5"/>
  <circle cx="0" cy="0" r="8" fill="none" stroke="white" stroke-width="1.5"/>
  <circle cx="0" cy="0" r="3" fill="white" fill-opacity="0.6"/>
  <line x1="0" y1="-34" x2="0" y2="-24" stroke="white" stroke-width="2.5"/>
  <line x1="0" y1="24" x2="0" y2="34" stroke="white" stroke-width="2.5"/>
  <line x1="-34" y1="0" x2="-24" y2="0" stroke="white" stroke-width="2.5"/>
  <line x1="24" y1="0" x2="34" y2="0" stroke="white" stroke-width="2.5"/>
`;

function buildCardSvg(token) {
  const W = 1200;
  const H = 628;
  const TOP_H = 260;
  const BOT_Y = TOP_H;

  const name = escXml(token.name);
  const ticker = escXml(token.ticker);

  // Auto-size token name if too long
  let nameFontSize = 72;
  if (token.name.length > 16) nameFontSize = 56;
  if (token.name.length > 24) nameFontSize = 44;
  if (token.name.length > 32) nameFontSize = 36;

  // Format stats
  const mcap = fmtNum(token.mcap);
  const vol = fmtNum(token.vol);
  const liq = fmtNum(token.liq);
  const age = (token.ageStr || '—').toUpperCase();

  // Avatar image href — will be resolved by resvg
  const avatarHref = token.img || '';

  // Stats layout — left-aligned, vertically centered in bottom half
  const statsLeft = 90;
  const statsWidth = W - statsLeft - 72;
  const colW = statsWidth / 4;
  const labelY = BOT_Y + 80;
  const valueY = labelY + 50;

  // Ticker pill dimensions
  const tickerText = `$${ticker}`;
  const pillW = tickerText.length * 12 + 32;
  const pillH = 30;
  const pillX = 260;
  const pillY = nameFontSize <= 44 ? 148 : 158;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="avatarClip">
      <circle cx="152" cy="130" r="80"/>
    </clipPath>
    <radialGradient id="meshA" cx="20%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#3a2a52" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#1c1b1d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="meshB" cx="85%" cy="20%" r="55%">
      <stop offset="0%" stop-color="#2a3a52" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#1c1b1d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="meshC" cx="60%" cy="100%" r="70%">
      <stop offset="0%" stop-color="#522a3a" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#1c1b1d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glassFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="white" stop-opacity="0.08"/>
      <stop offset="50%" stop-color="white" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="white" stop-opacity="0.05"/>
    </linearGradient>
    <linearGradient id="glassBorder" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="white" stop-opacity="0.25"/>
      <stop offset="50%" stop-color="white" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="white" stop-opacity="0.15"/>
    </linearGradient>
  </defs>

  <!-- Background: layered gradient mesh -->
  <rect width="${W}" height="${H}" fill="#1c1b1d"/>
  <rect width="${W}" height="${H}" fill="url(#meshA)"/>
  <rect width="${W}" height="${H}" fill="url(#meshB)"/>
  <rect width="${W}" height="${H}" fill="url(#meshC)"/>

  <!-- Faint section divider -->
  <line x1="0" y1="${TOP_H}" x2="${W}" y2="${TOP_H}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>

  <!-- Watermark: top-left scope -->
  <g transform="translate(70, 70)" opacity="0.05">
    ${scopeWatermark(120)}
  </g>

  <!-- Watermark: bottom-right scope -->
  <g transform="translate(1070, 498)" opacity="0.05">
    ${scopeWatermark(200)}
  </g>

  <!-- Token avatar (circle clipped) with white-alpha ring -->
  ${avatarHref ? `
  <image href="${escXml(avatarHref)}" x="72" y="50" width="160" height="160" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>
  <circle cx="152" cy="130" r="80" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  ` : `
  <circle cx="152" cy="130" r="80" fill="#333"/>
  <circle cx="152" cy="130" r="80" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  <text x="152" y="140" fill="#666" font-family="'Inter', sans-serif" font-size="48" font-weight="500" text-anchor="middle">?</text>
  `}

  <!-- Token name -->
  <text x="260" y="${nameFontSize <= 44 ? 121 : 131}" fill="#f2f1f4" font-family="'Inter', sans-serif" font-size="${nameFontSize}" font-weight="500">${name}</text>

  <!-- Ticker -->
  <text x="264" y="${nameFontSize <= 44 ? 174 : 184}" fill="rgba(255,255,255,0.45)" font-family="'Inter', sans-serif" font-size="28" font-weight="500">${tickerText}</text>

  <!-- Scope icon (top-right) -->
  <image href="${SCOPE_LOGO_DATA}" x="${W - 150}" y="20" width="120" height="120" opacity="0.95"/>

  <!-- Glass stats panel: drop shadow, translucent fill, gradient border, top highlight, vertical dividers -->
  <rect x="72" y="312" width="${W - 144}" height="160" rx="20" fill="rgba(0,0,0,0.35)"/>
  <rect x="72" y="308" width="${W - 144}" height="160" rx="20" fill="url(#glassFill)"/>
  <rect x="72.5" y="308.5" width="${W - 145}" height="159" rx="19.5" fill="none" stroke="url(#glassBorder)" stroke-width="1"/>
  <line x1="92" y1="309" x2="${W - 92}" y2="309" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
  <line x1="${statsLeft + colW}" y1="328" x2="${statsLeft + colW}" y2="448" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
  <line x1="${statsLeft + colW * 2}" y1="328" x2="${statsLeft + colW * 2}" y2="448" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
  <line x1="${statsLeft + colW * 3}" y1="328" x2="${statsLeft + colW * 3}" y2="448" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Stat labels -->
  <text x="${statsLeft + 24}" y="${labelY}" fill="rgba(255,255,255,0.6)" font-family="'Inter', sans-serif" font-size="15" letter-spacing="1.5">MARKET CAP</text>
  <text x="${statsLeft + colW + 24}" y="${labelY}" fill="rgba(255,255,255,0.6)" font-family="'Inter', sans-serif" font-size="15" letter-spacing="1.5">VOLUME 24H</text>
  <text x="${statsLeft + colW * 2 + 24}" y="${labelY}" fill="rgba(255,255,255,0.6)" font-family="'Inter', sans-serif" font-size="15" letter-spacing="1.5">LIQUIDITY</text>
  <text x="${statsLeft + colW * 3 + 24}" y="${labelY}" fill="rgba(255,255,255,0.6)" font-family="'Inter', sans-serif" font-size="15" letter-spacing="1.5">AGE</text>

  <!-- Stat values -->
  <text x="${statsLeft + 24}" y="${valueY}" fill="#f2f1f4" font-family="'Inter', sans-serif" font-size="38" font-weight="500">$${escXml(mcap.value)}${escXml(mcap.unit)}</text>
  <text x="${statsLeft + colW + 24}" y="${valueY}" fill="#f2f1f4" font-family="'Inter', sans-serif" font-size="38" font-weight="500">$${escXml(vol.value)}${escXml(vol.unit)}</text>
  <text x="${statsLeft + colW * 2 + 24}" y="${valueY}" fill="#f2f1f4" font-family="'Inter', sans-serif" font-size="38" font-weight="500">$${escXml(liq.value)}${escXml(liq.unit)}</text>

  <text x="${statsLeft + colW * 3 + 24}" y="${valueY}" fill="#f2f1f4" font-family="'Inter', sans-serif" font-size="38" font-weight="500">${escXml(age)}</text>

  <!-- Bottom-right branding (above Twitter's title overlay zone) -->
  <text x="${W - 36}" y="${H - 50}" fill="rgba(255,255,255,0.92)" font-family="'Inter', sans-serif" font-size="20" font-weight="500" text-anchor="end" letter-spacing="1.5">MEMESCOPE.IO</text>

</svg>`;

  return svg;
}


// ── Bot HTML Page ───────────────────────────────────────────────────────────

function buildBotHtml(token, chain, ca) {
  const title = `${token.name} ($${token.ticker}) — Memescopes`;
  const mcap = fmtNum(token.mcap);
  const desc = `$${token.ticker} on ${CHAIN_DISPLAY[chain] || chain} | MCap: $${mcap.value}${mcap.unit} | Scoped on Memescopes`;
  const imageUrl = `https://memescopes.com/card-image/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}.png`;
  const pageUrl = `https://memescopes.com/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escXml(title)}</title>
<meta name="description" content="${escXml(desc)}">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="${escXml(title)}">
<meta property="og:description" content="${escXml(desc)}">
<meta property="og:image" content="${escXml(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="628">
<meta property="og:url" content="${escXml(pageUrl)}">
<meta property="og:site_name" content="Memescopes">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@memescope_io">
<meta name="twitter:creator" content="@memescope_io">
<meta name="twitter:title" content="${escXml(title)}">
<meta name="twitter:description" content="${escXml(desc)}">
<meta name="twitter:image" content="${escXml(imageUrl)}">

<!-- Redirect real users to the SPA -->
<script>window.location.replace("${pageUrl}");</script>
</head>
<body>
<p>Loading <a href="${escXml(pageUrl)}">${escXml(token.name)}</a> on Memescopes...</p>
</body>
</html>`;
}


// ── PNG Generation ──────────────────────────────────────────────────────────

async function generateCardPng(token) {
  await ensureWasm();

  const svgString = buildCardSvg(token);

  // Create Resvg instance with embedded fonts
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: 1200 },
    background: '#1c1b1d',
    font: {
      loadSystemFonts: false,
      fontBuffers: fontBuffers,
      defaultFontFamily: 'Inter',
      sansSerifFamily: 'Inter',
    },
  });

  // Resolve external images (avatar, chain icon, scope logo)
  const imagesToResolve = resvg.imagesToResolve();
  const fetchPromises = imagesToResolve.map(href => fetchImageAsBuffer(href).then(buf => ({ href, buf })));
  const results = await Promise.all(fetchPromises);
  for (const { href, buf } of results) {
    if (buf) {
      try {
        resvg.resolveImage(href, buf);
      } catch (e) {
        console.warn('Failed to resolve image:', href, e.message);
      }
    }
  }

  // Render to PNG
  const rendered = resvg.render();
  const pngData = rendered.asPng();

  return pngData;
}

// ── Route Matching ──────────────────────────────────────────────────────────

function parseTokenRoute(pathname) {
  // Match /{chain}/{contract_address}
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [chain, ca] = parts;
  if (!VALID_CHAINS.has(chain.toLowerCase())) return null;
  // Basic CA validation: at least 20 chars (Solana is ~44, EVM is 42)
  if (ca.length < 20) return null;
  return { chain: chain.toLowerCase(), ca };
}

function parseCardImageRoute(pathname) {
  // Match /card-image/{chain}/{contract_address}.png
  const match = pathname.match(/^\/card-image\/([^/]+)\/([^/]+)\.png$/);
  if (!match) return null;
  const chain = match[1].toLowerCase();
  const ca = match[2];
  if (!VALID_CHAINS.has(chain)) return null;
  if (ca.length < 20) return null;
  return { chain, ca };
}

function isBot(userAgent) {
  return BOT_UA_RE.test(userAgent || '');
}


// ── Worker Entry Point ──────────────────────────────────────────────────────

// ── Security + Performance Headers ─────────────────────────────────
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '1; mode=block',
};

// Early Hints — resources the browser should start fetching immediately
const EARLY_HINT_LINKS = [
  '</styles.css>; rel=preload; as=style',
  '</app.js>; rel=preload; as=script',
  '<https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap>; rel=preload; as=style',
  '</api/tokens>; rel=preload; as=fetch; crossorigin',
];

function addSecurityHeaders(headers) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  headers.set('Vary', 'Accept-Encoding');
  return headers;
}

// ===== AI Search (natural-language → coin filters via Claude) =====
const AI_SEARCH_CHAINS = ['solana','eth','base','robinhood','sui','bsc','tron','arbitrum','avalanche','polygon','optimism','blast','ton','pulsechain','seiv2','sonic','hyperliquid','berachain','monad','cronos','aptos','linea','zksync','fantom','mantle','scroll','manta','starknet'];
const AI_FILTER_TOOL = {
  name: 'filter_coins',
  description: 'Convert a user request about meme coins into structured filters applied to the live coin list. Always call this tool.',
  input_schema: {
    type: 'object',
    properties: {
      is_coin_query: { type: 'boolean', description: 'true if the request is about finding/filtering crypto or meme coins; false for anything off-topic (general questions, advice, jokes, unrelated topics).' },
      summary: { type: 'string', description: "One short human-readable line describing the SEARCH (the filters applied), e.g. 'Dog-themed coins under $500K market cap, sorted by trending'. Describe the filters only — never claim anything about specific coins, prices, or whether to buy/sell." },
      keywords: { type: 'array', items: { type: 'string' }, description: "Search terms used to find matching coins in the full database: the theme word PLUS well-known related coin names and tickers. E.g. 'dog coins' -> ['dog','doge','shiba','shib','inu','floki','bonk','wif']; 'frog coins' -> ['frog','pepe','wojak']; a specific coin -> just its name. Use 2-8 terms. Omit ONLY for pure numeric/sort requests with no theme (e.g. 'top gainers')." },
      chain: { type: 'string', enum: AI_SEARCH_CHAINS, description: 'Restrict to a single chain. Omit for all chains.' },
      min_market_cap: { type: 'number', description: 'Minimum market cap in USD.' },
      max_market_cap: { type: 'number', description: 'Maximum market cap in USD.' },
      min_volume: { type: 'number', description: 'Minimum 24h volume in USD.' },
      min_change_24h: { type: 'number', description: 'Minimum 24h price change in percent (e.g. 50 means +50%).' },
      min_change_1h: { type: 'number', description: 'Minimum 1h price change in percent — use for "last hour" requests.' },
      min_change_5m: { type: 'number', description: 'Minimum 5-minute price change in percent — for "right now"/"this minute" momentum.' },
      min_change_6h: { type: 'number', description: 'Minimum 6h price change in percent.' },
      max_age_hours: { type: 'number', description: "Only coins whose trading pair was created within the last N hours. Use for 'new'/'just launched': 24 = today, 1 = last hour, 168 = this week." },
      min_liquidity: { type: 'number', description: 'Minimum liquidity in USD. A $1,000 floor is applied by default to hide dust/rugs — set 0 explicitly ONLY if the user asks to include micro/dust coins.' },
      min_txns: { type: 'integer', description: 'Minimum 24h transaction count (buys+sells) — use for "actively traded".' },
      boosted_only: { type: 'boolean', description: 'true = only boosted/promoted coins.' },
      sort_by: { type: 'string', enum: ['market_cap','volume','change_24h','change_1h','change_5m','change_6h','liquidity','txns','trending','age'], description: "Sort field. 'trending' = biggest movers; 'age' = newest first." },
      direction: { type: 'string', enum: ['asc','desc'], description: 'Sort direction; default desc (highest first).' },
      limit: { type: 'integer', description: 'Max coins to return (1-50). Default 25.' },
    },
    required: ['is_coin_query','summary'],
  },
};
const AI_SYSTEM_PROMPT =
  "You are the search assistant for Memescopes, a meme-coin scanner. Convert the user's request into filters by calling the filter_coins tool. You ONLY help find or filter coins. If the request is off-topic (general questions, advice, jokes, anything not about finding coins), set is_coin_query=false and make the summary a brief note that you can only search coins. Never invent coins, prices, or recommendations. Keep the summary to one short line describing the filters. " +
  "When the request names a THEME (dogs, cats, frogs, AI, Trump, etc.), fill 'keywords' with several search terms — the theme word plus well-known related coin names and tickers (dogs -> dog, doge, shiba, shib, inu, floki, bonk, wif; frogs -> frog, pepe, wojak) — so coins that don't literally contain the theme word are still found. For a specific coin name, just use that name. " +
  "Supported chains: " +
  AI_SEARCH_CHAINS.join(', ') +
  ". For 'new', 'newest', 'just launched', or 'launched today' set max_age_hours (24 for today, 168 for this week) AND sort_by=age — never rely on sort alone to mean new. For 'trending', 'top gainers', or 'pumping' use sort_by=trending or change_24h; for gains 'in the last hour' use min_change_1h / sort_by=change_1h; for 'pumping RIGHT NOW' / 'this minute' use min_change_5m / sort_by=change_5m. A $1,000 liquidity floor is applied by default so results aren't dust — set min_liquidity=0 only when the user explicitly wants micro/dust coins, or higher when they ask for 'real liquidity'. 'Actively traded' -> min_txns (e.g. 500). 'Boosted' or 'promoted' -> boosted_only=true. There is NO holder-count or buy/sell-pressure data: if the user asks for those, apply the filters you CAN and add a short note in the summary that this data isn't available (e.g. 'holder counts not available').";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const ua = request.headers.get('user-agent') || '';

    // ─── Old domain → new domain (memescope.io → memescopes.com) ────
    if (url.hostname === 'memescope.io' || url.hostname === 'www.memescope.io') {
      url.hostname = 'memescopes.com';
      return Response.redirect(url.toString(), 301);
    }

    // ─── www → non-www redirect (SEO canonical) ────────────────────
    if (url.hostname === 'www.memescopes.com') {
      url.hostname = 'memescopes.com';
      return Response.redirect(url.toString(), 301);
    }

    // ─── Card Image Route ───────────────────────────────────────────
    const cardParams = parseCardImageRoute(pathname);
    if (cardParams) {
      // Check cache first
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;
      let cachedResp = await cache.match(cacheKey);
      if (cachedResp) return cachedResp;

      try {
        const token = await fetchTokenData(cardParams.chain, cardParams.ca);
        if (!token) {
          return new Response('Token not found', { status: 404 });
        }

        const png = await generateCardPng(token);
        const resp = new Response(png, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=300, s-maxage=300',
            'CDN-Cache-Control': 'max-age=300',
          },
        });

        // Store in cache (non-blocking)
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));

        return resp;
      } catch (err) {
        console.error('Card generation error:', err.message, err.stack);
        // Fallback: redirect to static OG image
        return Response.redirect('https://memescopes.com/og-image.png', 302);
      }
    }

    // ─── Bot Interception for /{chain}/{ca} ─────────────────────────
    if (isBot(ua)) {
      const tokenParams = parseTokenRoute(pathname);
      if (tokenParams) {
        // Check cache
        const botCacheKey = new Request(url.toString() + '?_bot=1', request);
        const cache = caches.default;
        let cachedResp = await cache.match(botCacheKey);
        if (cachedResp) return cachedResp;

        try {
          const token = await fetchTokenData(tokenParams.chain, tokenParams.ca);
          if (token) {
            const html = buildBotHtml(token, tokenParams.chain, tokenParams.ca);
            const resp = new Response(html, {
              headers: {
                'Content-Type': 'text/html;charset=UTF-8',
                'Cache-Control': 'public, max-age=300, s-maxage=300',
              },
            });
            ctx.waitUntil(cache.put(botCacheKey, resp.clone()));
            return resp;
          }
        } catch (err) {
          console.error('Bot page error:', err);
        }
        // If token not found or error, fall through to SPA
      }
    }

    // ─── Boost API ────────────────────────────────────────────────────
    if (pathname === '/api/boosts') {
      // CORS headers for all boost API responses
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      // Preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // GET — public, returns active boosts
      if (request.method === 'GET') {
        try {
          const raw = await env.BOOSTS.get('active_boosts');
          const all = raw ? JSON.parse(raw) : [];
          const now = Date.now();
          const active = all.filter(b => b.expiresAt > now);
          // Clean up expired if any were removed
          if (active.length !== all.length) {
            ctx.waitUntil(env.BOOSTS.put('active_boosts', JSON.stringify(active)));
          }
          return new Response(JSON.stringify({ boosts: active }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } catch (e) {
          return new Response(JSON.stringify({ boosts: [] }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // POST — admin: add/update a boost
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          const { passwordHash, ca, sym, chain, count, duration } = body;
          if (!passwordHash || !ca) {
            return new Response(JSON.stringify({ error: 'Missing fields' }), {
              status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          // Verify admin password hash
          const ADMIN_HASH = '0646b38df753eb49e8391cea45e057f0934882a1932a282ec73bbf613777459f';
          if (passwordHash !== ADMIN_HASH) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          const raw = await env.BOOSTS.get('active_boosts');
          const all = raw ? JSON.parse(raw) : [];
          const now = Date.now();
          // Remove expired and any existing boost for this CA
          const caLower = ca.toLowerCase();
          const filtered = all.filter(b => b.expiresAt > now && b.ca.toLowerCase() !== caLower);
          const newBoost = {
            ca: ca,
            sym: sym || '',
            chain: chain || 'solana',
            count: count || 1,
            expiresAt: now + (duration || 86400000), // default 24h
            createdAt: now,
          };
          filtered.push(newBoost);
          await env.BOOSTS.put('active_boosts', JSON.stringify(filtered));
          return new Response(JSON.stringify({ ok: true, boost: newBoost, total: filtered.length }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // DELETE — admin: remove a boost
      if (request.method === 'DELETE') {
        try {
          const body = await request.json();
          const { passwordHash, ca } = body;
          if (!passwordHash || !ca) {
            return new Response(JSON.stringify({ error: 'Missing fields' }), {
              status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          const ADMIN_HASH = '0646b38df753eb49e8391cea45e057f0934882a1932a282ec73bbf613777459f';
          if (passwordHash !== ADMIN_HASH) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          const raw = await env.BOOSTS.get('active_boosts');
          const all = raw ? JSON.parse(raw) : [];
          const caLower = ca.toLowerCase();
          const filtered = all.filter(b => b.ca.toLowerCase() !== caLower);
          await env.BOOSTS.put('active_boosts', JSON.stringify(filtered));
          return new Response(JSON.stringify({ ok: true, remaining: filtered.length }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }
    }

    // ─── GeckoTerminal (free) API Proxy ───────────────────────────────
    // Proxies /api/gecko/* to the public GeckoTerminal v2 API (no key).
    // NOTE: free tier is rate-limited (~30 req/min/IP); the edge-cache TTLs below soften that.
    if (pathname.startsWith('/api/gecko/')) {
      const geckoPath = pathname.replace('/api/gecko/', '');
      const proxyUrl = 'https://api.geckoterminal.com/api/v2/' + geckoPath + url.search;
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      };
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Smart cache TTLs by endpoint type to save API credits
      let cacheTtl = 30; // default 30s
      if (geckoPath.includes('/ohlcv/')) {
        cacheTtl = 180;  // OHLCV: 180s — the chart overlays a live price tip from DexScreener, so stale history is invisible; doubling the window halves upstream calls and eases the free-tier limit
      } else if (geckoPath.includes('/trades')) {
        cacheTtl = 20;   // Trades: 20s — slightly longer to cut calls under the free-tier limit
      } else if (geckoPath.includes('/pools/') && !geckoPath.includes('/ohlcv/')) {
        cacheTtl = 120;  // Pool info/discovery: 2 min — rarely changes
      } else if (geckoPath.includes('/search') || geckoPath.includes('/trending')) {
        cacheTtl = 300;  // Search/trending: 5 min — changes slowly
      } else if (geckoPath.includes('/tokens/') || geckoPath.includes('/info')) {
        cacheTtl = 600;  // Token info + pool discovery: 10 min — metadata and a token's pools are stable
      } else if (geckoPath.includes('/networks')) {
        cacheTtl = 600;  // Network list: 10 min — almost never changes
      }

      try {
        const cache = caches.default;
        const cacheKey = new Request(proxyUrl);
        const staleKey = new Request(proxyUrl + (proxyUrl.includes('?') ? '&' : '?') + '__lastgood=1');

        // 1. Fresh edge hit → serve without calling GeckoTerminal. This collapses
        //    every user + every chart auto-refresh for the same data into ONE upstream
        //    call per TTL window — the main guard against the free tier's 30 req/min limit.
        const hit = await cache.match(cacheKey);
        if (hit) return hit;

        // 2. Miss → one call to GeckoTerminal.
        const proxyResp = await fetch(proxyUrl, { headers: { 'Accept': 'application/json' } });

        if (proxyResp.status === 200) {
          const body = await proxyResp.arrayBuffer();
          const resp = new Response(body, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`,
              ...corsHeaders,
            },
          });
          // Cache for the TTL window (dedup) + keep a 30-min "last good" copy for the 429 fallback,
          // so a throttled coin shows slightly-stale candles instead of a hidden/empty chart.
          ctx.waitUntil(cache.put(cacheKey, resp.clone()));
          ctx.waitUntil(cache.put(staleKey, new Response(body, {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
          })));
          return resp;
        }

        // 3. Throttled (429) or upstream 5xx → serve the last good copy if we have one,
        //    so a brief rate-limit shows slightly-stale data instead of a broken chart.
        if (proxyResp.status === 429 || proxyResp.status >= 500) {
          const stale = await cache.match(staleKey);
          if (stale) {
            const sb = await stale.arrayBuffer();
            return new Response(sb, {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10', 'X-MS-Stale': '1', ...corsHeaders },
            });
          }
        }

        // 4. No stale fallback → pass the upstream status through, uncached.
        const eb = await proxyResp.arrayBuffer();
        return new Response(eb, {
          status: proxyResp.status,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store', ...corsHeaders },
        });
      } catch (e) {
        // Network failure → last good copy if available.
        try {
          const stale = await caches.default.match(new Request(proxyUrl + (proxyUrl.includes('?') ? '&' : '?') + '__lastgood=1'));
          if (stale) {
            const sb = await stale.arrayBuffer();
            return new Response(sb, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10', 'X-MS-Stale': '1', ...corsHeaders } });
          }
        } catch (e2) {}
        return new Response(JSON.stringify({ error: 'Proxy error' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ─── Image Proxy with Cloudflare Image Resizing + Edge Cache ────
    // Usage: /api/img?url=https://dd.dexscreener.com/...&w=64&h=64
    if (pathname === '/api/img') {
      const imageUrl = url.searchParams.get('url');
      if (!imageUrl) {
        return new Response('Missing url param', { status: 400 });
      }

      // Only allow known image origins
      try {
        const imgHost = new URL(imageUrl).hostname;
        const allowed = ['dexscreener.com', 'raw.githubusercontent.com', 'arweave.net',
          'ipfs.io', 'cf-ipfs.com', 'pump.fun', 'nftstorage.link', 'imgur.com'];
        if (!allowed.some(d => imgHost === d || imgHost.endsWith('.' + d))) {
          return new Response('Origin not allowed', { status: 403 });
        }
      } catch {
        return new Response('Invalid URL', { status: 400 });
      }

      // Edge cache — keyed on full URL including size params
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      let cached = await cache.match(cacheKey);
      if (cached) return cached;

      const w = Math.min(parseInt(url.searchParams.get('w')) || 64, 256);
      const h = Math.min(parseInt(url.searchParams.get('h')) || 64, 256);

      const imgHeaders = {
        'Cache-Control': 'public, max-age=86400',
        'CDN-Cache-Control': 'public, max-age=604800',
        'Access-Control-Allow-Origin': '*',
      };

      // Try Cloudflare Image Resizing first, then plain proxy fallback
      let imgResp = null;
      try {
        imgResp = await fetch(imageUrl, {
          cf: {
            image: {
              width: w,
              height: h,
              fit: 'cover',
              format: 'webp',
              quality: 80,
            }
          }
        });
      } catch {}

      // If resize failed or returned error, fall back to plain proxy
      if (!imgResp || !imgResp.ok) {
        try {
          imgResp = await fetch(imageUrl);
        } catch {
          return new Response('', { status: 502 });
        }
      }

      if (!imgResp.ok) {
        const notFound = new Response('', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
        ctx.waitUntil(cache.put(cacheKey, notFound.clone()));
        return notFound;
      }

      const body = await imgResp.arrayBuffer();
      const resp = new Response(body, {
        headers: {
          'Content-Type': imgResp.headers.get('content-type') || 'image/png',
          ...imgHeaders,
        }
      });
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }

    // ─── Token API Proxy (same-origin + edge cache + KV fallback) ───
    // Avoids extra DNS+TLS handshake to scraper subdomain
    // AI Search — natural-language query → structured coin filters (via Claude).
    // The model only returns filter params; the browser filters the real token
    // list. Key stays server-side (env.ANTHROPIC_API_KEY); never sent to client.
    if (pathname === '/api/ai-search' && request.method === 'POST') {
      const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      try {
        const bodyIn = await request.json().catch(() => ({}));
        const query = (typeof bodyIn.query === 'string' ? bodyIn.query : '').trim();
        if (!query || query.length > 200) {
          return new Response(JSON.stringify({ error: 'bad_query' }), { status: 400, headers: jsonHeaders });
        }
        if (!env.ANTHROPIC_API_KEY) {
          return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503, headers: jsonHeaders });
        }
        // Lightweight per-IP rate limit (cost guard): ~30 searches/min/IP.
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rlKey = 'rl:ai:' + ip;
        const cnt = parseInt((await env.BOOSTS.get(rlKey)) || '0', 10);
        if (cnt >= 30) {
          return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: jsonHeaders });
        }
        ctx.waitUntil(env.BOOSTS.put(rlKey, String(cnt + 1), { expirationTtl: 60 }));

        const ai = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 512,
            system: AI_SYSTEM_PROMPT,
            tools: [AI_FILTER_TOOL],
            tool_choice: { type: 'tool', name: 'filter_coins' },
            messages: [{ role: 'user', content: query }],
          }),
        });
        if (!ai.ok) {
          return new Response(JSON.stringify({ error: 'ai_error' }), { status: 502, headers: jsonHeaders });
        }
        const data = await ai.json();
        const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
        const params = (toolUse && toolUse.input) || { is_coin_query: false, summary: 'I can only search coins.' };
        return new Response(JSON.stringify(params), { headers: jsonHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: jsonHeaders });
      }
    }

    if (pathname === '/api/tokens') {
      const corsJson = {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=5, s-maxage=5',
        'CDN-Cache-Control': 'max-age=5',
        'Access-Control-Allow-Origin': '*',
        'Vary': 'Accept-Encoding',
      };

      // 1. Edge cache (per-POP, fastest)
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      let cached = await cache.match(cacheKey);
      if (cached) return cached;

      // 2. Try upstream — but never make users wait out a scraper cold start.
      try {
        const upstream = fetch(SCRAPER_API).then(async (r) => {
          if (!r.ok) throw new Error('Upstream ' + r.status);
          const body = await r.text();
          const resp = new Response(body, { headers: corsJson });
          ctx.waitUntil(cache.put(cacheKey, resp.clone()));
          // 3. Save to KV as global fallback (non-blocking)
          ctx.waitUntil(env.BOOSTS.put('_token_cache', body));
          return resp;
        });
        // STALE-WHILE-SLOW: if the scraper worker hasn't answered within 1.5s
        // (it aggregates upstream sources and can be slow on a cold cache),
        // serve the KV snapshot immediately — it's refreshed on every successful
        // fetch, so it's at most one cycle old. The upstream fetch keeps running
        // (waitUntil) and refreshes edge+KV for the next hit.
        const raced = await Promise.race([
          upstream.catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve('slow'), 1500)),
        ]);
        if (raced === 'slow') {
          const kvData = await env.BOOSTS.get('_token_cache');
          if (kvData) {
            ctx.waitUntil(upstream.then(() => {}, () => {}));
            return new Response(kvData, { headers: { ...corsJson, 'X-Source': 'kv-stale-while-slow' } });
          }
          const resp = await upstream; // first-ever request: no snapshot, must wait
          if (!resp) throw new Error('upstream failed');
          return resp;
        }
        if (!raced) throw new Error('upstream failed');
        return raced;
      } catch {
        // 4. KV fallback — globally replicated, survives upstream outages
        try {
          const kvData = await env.BOOSTS.get('_token_cache');
          if (kvData) {
            return new Response(kvData, { headers: { ...corsJson, 'X-Source': 'kv-fallback' } });
          }
        } catch {}
        return new Response('{"error":"upstream"}', {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // ─── Everything Else: Static Assets / SPA ───────────────────────
    // HTML edge-cache: serve the page from the nearest Cloudflare POP instead of
    // fetching from origin on every visit. Keyed by CACHE_VERSION so deploys are
    // still instant (new version = new key = old copy ignored). GET only.
    if (request.method === 'GET') {
      const htmlCache = caches.default;
      const htmlKey = new Request(url.origin + url.pathname + '|html|' + CACHE_VERSION, request);
      const cachedHtml = await htmlCache.match(htmlKey);
      if (cachedHtml && (cachedHtml.headers.get('content-type') || '').includes('text/html')) {
        return cachedHtml;
      }

      const probe = await env.ASSETS.fetch(request);
      const probeCt = probe.headers.get('content-type') || '';
      if (probeCt.includes('text/html')) {
        const h = new Headers(probe.headers);
        addSecurityHeaders(h);
        // Browser always revalidates (instant deploys); edge holds the copy.
        h.set('Cache-Control', 'no-cache, must-revalidate');
        h.set('Pragma', 'no-cache');
        h.set('Link', EARLY_HINT_LINKS.join(', '));
        const body = await probe.arrayBuffer();
        let htmlResp = new Response(body, { status: probe.status, headers: h });
        // Per-chain SEO landing pages — rewrite title/meta/h1/canonical for /solana, etc.
        const _np = url.pathname.replace(/\/+$/, '');
        const _chainName = CHAIN_PAGES[_np];
        if (_chainName && probe.status === 200) {
          try { htmlResp = await rewriteChainSeo(htmlResp, _chainName, _np); } catch (e) {}
        }
        if (probe.status === 200) ctx.waitUntil(htmlCache.put(htmlKey, htmlResp.clone()));
        return htmlResp;
      }
      // Not HTML — fall through to the generic handler below, reusing this response.
      var prefetched = probe;
    }

    const assetResp = prefetched || await env.ASSETS.fetch(request);
    const ct = assetResp.headers.get('content-type') || '';
    const headers = new Headers(assetResp.headers);

    // Security headers on all responses
    addSecurityHeaders(headers);

    if (ct.includes('text/html')) {
      // HTML: always revalidate so deploys are instant
      headers.set('Cache-Control', 'no-cache, must-revalidate');
      headers.set('Pragma', 'no-cache');
      // Preload critical resources via Link header
      headers.set('Link', EARLY_HINT_LINKS.join(', '));
    } else if (ct.includes('font')) {
      // Fonts: cache 1 year (they never change)
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (ct.includes('javascript') || ct.includes('css')) {
      // JS, CSS: cache 1 day — SW version-busts on deploy
      headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=60');
    } else if (ct.includes('image/')) {
      // Images: cache 1 week
      headers.set('Cache-Control', 'public, max-age=604800');
    }
    return new Response(assetResp.body, { status: assetResp.status, headers });
  },
};
