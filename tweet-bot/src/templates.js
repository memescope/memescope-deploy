// ============================================================
// Memescope Tweet Bot — Tweet Templates
// ============================================================

import { CONFIG } from './config.js';

function fmtNum(n) {
  if (!n && n !== 0) return '$0';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtPct(n) {
  if (!n && n !== 0) return '0%';
  if (n >= 1000) return '+' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '%';
  if (n > 0) return '+' + n.toFixed(1) + '%';
  return n.toFixed(1) + '%';
}

function chainName(net) {
  return CONFIG.CHAIN_NAMES[net] || net?.toUpperCase() || '';
}

function chainTag(net) {
  return CONFIG.CHAIN_HASHTAGS[net] || '';
}

function dexName(dex) {
  if (!dex) return '';
  return dex.charAt(0).toUpperCase() + dex.slice(1);
}

// Build token-specific URL for card previews
function tokenUrl(t) {
  const chain = t.net || 'solana';
  const ca = t.ca || '';
  if (!ca) return CONFIG.SITE_URL;
  return `${CONFIG.SITE_URL}/${chain}/${ca}`;
}

// Ticker — clean up symbols with spaces or weird chars
function ticker(sym) {
  if (!sym) return '???';
  // If symbol has spaces or is too long, just use first word
  const clean = sym.trim().split(/\s+/)[0];
  return clean.length > 12 ? clean.slice(0, 12) : clean;
}

// Trigger A: Fast Momentum
const TRIGGER_A_TEMPLATES = [
  (t) => `\u{1F680} $${ticker(t.sym)} just ripped ${fmtPct(t.p5m)} in 5 min

Vol: ${fmtNum(t.vol)} | MCap: ${fmtNum(t.mcap)} | Age: ${t.age}
Pair: ${chainName(t.net)} on ${dexName(t.dex)}

Track it live → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t) => `\u{1F525} $${ticker(t.sym)} is cooking — ${fmtPct(t.p5m)} in 5 min

MCap: ${fmtNum(t.mcap)} | Vol: ${fmtNum(t.vol)} | Liq: ${fmtNum(t.liq)}
${chainName(t.net)} on ${dexName(t.dex)}

→ ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t) => `\u{26A1} $${ticker(t.sym)} spiking ${fmtPct(t.p5m)} in 5m

Vol: ${fmtNum(t.vol)} | MCap: ${fmtNum(t.mcap)}
${chainName(t.net)} • ${dexName(t.dex)} • ${t.age} old

Live data → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t) => `\u{1F4C8} $${ticker(t.sym)} going vertical — ${fmtPct(t.p5m)} in 5m

Vol: ${fmtNum(t.vol)} | MCap: ${fmtNum(t.mcap)} | Liq: ${fmtNum(t.liq)}
${chainName(t.net)} on ${dexName(t.dex)}

Eyes on this → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t) => `\u{1F4A5} $${ticker(t.sym)} exploding ${fmtPct(t.p5m)} in 5 min

MCap: ${fmtNum(t.mcap)} | Vol: ${fmtNum(t.vol)}
${chainName(t.net)} • ${dexName(t.dex)}

Chart's printing → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t) => `\u{1F30A} Wave incoming on $${ticker(t.sym)} — ${fmtPct(t.p5m)} in 5m

Vol: ${fmtNum(t.vol)} | MCap: ${fmtNum(t.mcap)} | Age: ${t.age}
${chainName(t.net)} on ${dexName(t.dex)}

→ ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t) => `\u{1F440} Eyes on $${ticker(t.sym)} — ${fmtPct(t.p5m)} in 5m

MCap: ${fmtNum(t.mcap)} | Vol: ${fmtNum(t.vol)} | Liq: ${fmtNum(t.liq)}
${chainName(t.net)} • ${dexName(t.dex)}

This is moving → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,
];

// Trigger B: Early Bird (sprout-only branding)
const TRIGGER_B_TEMPLATES = [
  (t) => `\u{1F331} Early Bird: $${ticker(t.sym)}

${t.age} old | Vol: ${fmtNum(t.vol)} | ${fmtPct(t.p5m)} in 5m
MCap: ${fmtNum(t.mcap)} | Liq: ${fmtNum(t.liq)}

Watch it → ${tokenUrl(t)}
${chainTag(t.net)} #newtoken`,

  (t) => `\u{1F331} Fresh launch: $${ticker(t.sym)}

Only ${t.age} old and already doing ${fmtNum(t.vol)} vol
MCap: ${fmtNum(t.mcap)} | ${chainName(t.net)} on ${dexName(t.dex)}

→ ${tokenUrl(t)}
${chainTag(t.net)} #newtoken`,

  (t) => `\u{1F331} New on the radar: $${ticker(t.sym)}

Age: ${t.age} | Vol: ${fmtNum(t.vol)} | MCap: ${fmtNum(t.mcap)}
Liq: ${fmtNum(t.liq)} | ${chainName(t.net)}

Track it → ${tokenUrl(t)}
${chainTag(t.net)} #earlybird`,

  (t) => `\u{1F331} Just dropped: $${ticker(t.sym)}

${t.age} old • ${fmtNum(t.vol)} vol • ${fmtNum(t.mcap)} mcap
${chainName(t.net)} on ${dexName(t.dex)}

Curtain just opened → ${tokenUrl(t)}
${chainTag(t.net)} #newtoken`,

  (t) => `\u{1F331} Sprouting: $${ticker(t.sym)}

Age: ${t.age} | ${fmtPct(t.p5m)} in 5m | Vol: ${fmtNum(t.vol)}
MCap: ${fmtNum(t.mcap)} | ${chainName(t.net)}

Catch it early → ${tokenUrl(t)}
${chainTag(t.net)} #newtoken`,
];

// Trigger E: Follow-up
const TRIGGER_E_TEMPLATES = [
  (t, prev) => `\u{1F4E2} Update on $${ticker(t.sym)}

Was ${fmtPct(prev.p1h)} in 1h → now ${fmtPct(t.p1h)} \u{1F525}
Vol: ${fmtNum(t.vol)} | MCap: ${fmtNum(t.mcap)}

Still running → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t, prev) => `\u{1F6A8} $${ticker(t.sym)} keeps going

Earlier: ${fmtPct(prev.p1h)} → Now: ${fmtPct(t.p1h)}
MCap: ${fmtNum(t.mcap)} | Vol: ${fmtNum(t.vol)}

→ ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t, prev) => `\u{1F3C3} $${ticker(t.sym)} doesn't stop

${fmtPct(prev.p1h)} → ${fmtPct(t.p1h)} (1h)
MCap: ${fmtNum(t.mcap)} | Vol: ${fmtNum(t.vol)}
${chainName(t.net)} on ${dexName(t.dex)}

Marathon mode → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t, prev) => `\u{1F501} Round 2 — $${ticker(t.sym)}

Earlier: ${fmtPct(prev.p1h)} → Now: ${fmtPct(t.p1h)}
Vol: ${fmtNum(t.vol)} | MCap: ${fmtNum(t.mcap)}

Coming back for more → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,

  (t, prev) => `\u{1F4AA} $${ticker(t.sym)} showing strength

${fmtPct(prev.p1h)} → ${fmtPct(t.p1h)} in 1h
MCap: ${fmtNum(t.mcap)} | Vol: ${fmtNum(t.vol)}
${chainName(t.net)}

Holding momentum → ${tokenUrl(t)}
${chainTag(t.net)} #memecoin`,
];

// Trigger G: Winners of the Day
const TRIGGER_G_TEMPLATES = [
  (winners) => {
    let text = `\u{1F3C6} Winners of the Day\n\n`;
    winners.forEach((t, i) => {
      text += `${i + 1}. $${ticker(t.sym)} → ${fmtPct(t.p24h)} | ${fmtNum(t.mcap)} mcap\n`;
    });
    text += `\n#crypto #memecoin`;

    return text;
  },

  (winners) => {
    let text = `\u{1F4CA} Today's top performers:\n\n`;
    winners.forEach((t, i) => {
      text += `${i + 1}. $${ticker(t.sym)} — ${fmtPct(t.p24h)} (24h) | ${fmtNum(t.vol)} vol\n`;
    });
    text += `\n#crypto #memecoin`;
    return text;
  },

  (winners) => {
    let text = `\u{1F947} Champions of the day\n\n`;
    winners.forEach((t, i) => {
      text += `${i + 1}. $${ticker(t.sym)} ${fmtPct(t.p24h)} | ${fmtNum(t.mcap)} mcap\n`;
    });
    text += `\n#crypto #memecoin`;
    return text;
  },

  (winners) => {
    let text = `\u{1F3AF} Best plays of the day\n\n`;
    winners.forEach((t, i) => {
      text += `${i + 1}. $${ticker(t.sym)} → ${fmtPct(t.p24h)} (24h)\n`;
    });
    text += `\n#crypto #memecoin`;
    return text;
  },

  (winners) => {
    let text = `\u{1F4AF} 24h scoreboard\n\n`;
    winners.forEach((t, i) => {
      text += `${i + 1}. $${ticker(t.sym)} ${fmtPct(t.p24h)} | ${fmtNum(t.vol)} vol\n`;
    });
    text += `\n#crypto #memecoin`;
    return text;
  },
];

// Pick a random template
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate tweet text for a trigger
export function generateTweet(trigger) {
  switch (trigger.type) {
    case 'A':
      return pickRandom(TRIGGER_A_TEMPLATES)(trigger.token);
    case 'B':
      return pickRandom(TRIGGER_B_TEMPLATES)(trigger.token);
    case 'E':
      return pickRandom(TRIGGER_E_TEMPLATES)(trigger.token, trigger.previousTweet);
    case 'G':
      return pickRandom(TRIGGER_G_TEMPLATES)(trigger.tokens);
    default:
      return null;
  }
}
