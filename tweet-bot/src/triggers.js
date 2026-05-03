// ============================================================
// Memescope Tweet Bot — Trigger Logic
// ============================================================

import { CONFIG } from './config.js';

// Parse age string to hours (e.g. "4d" -> 96, "30m" -> 0.5)
function ageToHours(age) {
  if (!age) return 9999;
  const n = parseFloat(age);
  if (age.includes('y')) return n * 8760;
  if (age.includes('mo')) return n * 720;
  if (age.includes('w')) return n * 168;
  if (age.includes('d')) return n * 24;
  if (age.includes('h')) return n;
  if (age.includes('m')) return n / 60;
  return 9999;
}

// Parse age string to minutes
function ageToMinutes(age) {
  return ageToHours(age) * 60;
}

// Check if token was tweeted recently (within cooldown)
function isOnCooldown(token, tweetHistory, cooldownHours) {
  const key = token.ca || token.sym;
  const lastTweet = tweetHistory[key];
  if (!lastTweet) return false;
  const hoursSince = (Date.now() - lastTweet.timestamp) / (1000 * 60 * 60);
  return hoursSince < cooldownHours;
}

// Trigger A: Fast Momentum
export function checkTriggerA(tokens, tweetHistory) {
  if (!CONFIG.TRIGGER_A.enabled) return [];
  const { minP5m, minVol, minLiq, minAgeHours, cooldownHours } = CONFIG.TRIGGER_A;

  return tokens.filter(t => {
    if (t.p5m < minP5m) return false;
    if ((t.vol || 0) < minVol) return false;
    if ((t.liq || 0) < minLiq) return false;
    if (ageToHours(t.age) < minAgeHours) return false;
    if (isOnCooldown(t, tweetHistory, cooldownHours)) return false;
    return true;
  }).map(t => ({ type: 'A', token: t }));
}

// Trigger B: Early Bird
export function checkTriggerB(tokens, tweetHistory) {
  if (!CONFIG.TRIGGER_B.enabled) return [];
  const { maxAgeMin, minVol, cooldownHours } = CONFIG.TRIGGER_B;

  return tokens.filter(t => {
    if (ageToMinutes(t.age) > maxAgeMin) return false;
    if ((t.vol || 0) < minVol) return false;
    if (isOnCooldown(t, tweetHistory, cooldownHours)) return false;
    return true;
  }).map(t => ({ type: 'B', token: t }));
}

// Trigger E: Follow-up on previously tweeted tokens
export function checkTriggerE(tokens, tweetHistory) {
  if (!CONFIG.TRIGGER_E.enabled) return [];
  const { minAdditionalGain, minTimeSinceTweetMin, maxFollowUps } = CONFIG.TRIGGER_E;

  const results = [];

  for (const t of tokens) {
    const key = t.ca || t.sym;
    const history = tweetHistory[key];
    if (!history) continue;

    // Check time since last tweet
    const minSince = (Date.now() - history.timestamp) / (1000 * 60);
    if (minSince < minTimeSinceTweetMin) continue;

    // Check follow-up count
    if ((history.followUps || 0) >= maxFollowUps) continue;

    // Check if token gained significantly since we tweeted
    const tweetedP1h = history.p1h || 0;
    const currentP1h = t.p1h || 0;
    const additionalGain = currentP1h - tweetedP1h;

    if (additionalGain >= minAdditionalGain) {
      results.push({ type: 'E', token: t, previousTweet: history });
    }
  }

  return results;
}

// Trigger G: Winners of the Day
export function checkTriggerG(tokens) {
  if (!CONFIG.TRIGGER_G.enabled) return [];
  const { topN, minP24h, minVol } = CONFIG.TRIGGER_G;

  // Dedup by symbol (keep highest p24h per symbol)
  const symBest = {};
  for (const t of tokens) {
    const sym = (t.sym || '').toUpperCase();
    if (!symBest[sym] || (t.p24h || 0) > (symBest[sym].p24h || 0)) {
      symBest[sym] = t;
    }
  }

  const winners = Object.values(symBest)
    .filter(t => (t.p24h || 0) >= minP24h && (t.vol || 0) >= minVol)
    .sort((a, b) => (b.p24h || 0) - (a.p24h || 0))
    .slice(0, topN);

  if (winners.length < 2) return []; // need at least 2 for a recap

  return [{ type: 'G', tokens: winners }];
}
