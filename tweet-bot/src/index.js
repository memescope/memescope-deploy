// ============================================================
// Memescope Tweet Bot — Cloudflare Worker
//
// Cron triggers:
//   */5 * * * *  → Check triggers A, B, E (every 5 min)
//   0 3 * * *    → Winners of the Day (11pm EST / 3am UTC)
//
// Secrets (set via `wrangler secret put`):
//   TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET,
//   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
//
// KV: TWEET_STATE — tracks tweeted tokens & hourly counts
// ============================================================

import { CONFIG } from './config.js';
import { TwitterClient } from './twitter.js';
import { checkTriggerA, checkTriggerB, checkTriggerE, checkTriggerG } from './triggers.js';
import { generateTweet } from './templates.js';

// ---- KV helpers ----

async function getTweetHistory(kv) {
  const data = await kv.get('tweet_history', 'json');
  return data || {};
}

async function saveTweetHistory(kv, history) {
  // Clean up entries older than 48h to prevent KV bloat
  const cutoff = Date.now() - (48 * 60 * 60 * 1000);
  for (const key of Object.keys(history)) {
    if (history[key].timestamp < cutoff) {
      delete history[key];
    }
  }
  await kv.put('tweet_history', JSON.stringify(history));
}

async function getHourlyCount(kv) {
  const data = await kv.get('hourly_count', 'json');
  if (!data || data.hour !== new Date().getUTCHours()) {
    return { hour: new Date().getUTCHours(), count: 0 };
  }
  return data;
}

async function incrementHourlyCount(kv) {
  const data = await getHourlyCount(kv);
  data.count++;
  await kv.put('hourly_count', JSON.stringify(data));
  return data.count;
}

async function getLastDailyRecap(kv) {
  const data = await kv.get('last_daily_recap', 'text');
  return data || '';
}

async function setLastDailyRecap(kv, dateStr) {
  await kv.put('last_daily_recap', dateStr);
}

// ---- Fetch tokens from API ----

async function fetchTokens(env) {
  try {
    let resp;
    // Use service binding if available (worker-to-worker on same account)
    if (env && env.SCRAPER) {
      resp = await env.SCRAPER.fetch('https://dummy/tokens');
    } else {
      resp = await fetch(CONFIG.API_URL, {
        headers: {
          'User-Agent': 'MemescopeTweetBot/1.0',
          'Accept': 'application/json',
        },
      });
    }
    if (!resp.ok) throw new Error(`API ${resp.status}: ${resp.statusText}`);
    const data = await resp.json();
    const tokens = data.tokens || [];
    tokens._fetchOk = true;
    return tokens;
  } catch (e) {
    console.error('Failed to fetch tokens:', e.message);
    const empty = [];
    empty._fetchError = e.message;
    return empty;
  }
}

// ---- Main logic ----

async function handleAlertCron(env) {
  console.log('Tweet bot: Running alert check...');

  const tokens = await fetchTokens(env);
  if (tokens.length === 0) {
    console.log('Tweet bot: No tokens from API, skipping.');
    return;
  }

  const twitter = new TwitterClient(
    env.TWITTER_CONSUMER_KEY,
    env.TWITTER_CONSUMER_SECRET,
    env.TWITTER_ACCESS_TOKEN,
    env.TWITTER_ACCESS_SECRET,
  );

  const kv = env.TWEET_STATE;
  const history = await getTweetHistory(kv);
  const hourly = await getHourlyCount(kv);

  if (hourly.count >= CONFIG.MAX_TWEETS_PER_HOUR) {
    console.log(`Tweet bot: Hourly cap reached (${hourly.count}/${CONFIG.MAX_TWEETS_PER_HOUR}), skipping.`);
    return;
  }

  // Collect all alerts (A first since it's highest priority, then B, then E)
  const alerts = [
    ...checkTriggerA(tokens, history),
    ...checkTriggerB(tokens, history),
    ...checkTriggerE(tokens, history),
  ];

  if (alerts.length === 0) {
    console.log('Tweet bot: No triggers matched.');
    return;
  }

  console.log(`Tweet bot: ${alerts.length} triggers matched.`);

  // Process alerts (respect hourly cap)
  let tweeted = 0;
  for (const alert of alerts) {
    if (hourly.count + tweeted >= CONFIG.MAX_TWEETS_PER_HOUR) {
      console.log('Tweet bot: Hourly cap reached during processing.');
      break;
    }

    const text = generateTweet(alert);
    if (!text) continue;

    // Check tweet length (280 chars)
    if (text.length > 280) {
      console.log(`Tweet bot: Tweet too long (${text.length} chars), skipping ${alert.token?.sym || 'recap'}`);
      continue;
    }

    try {
      const result = await twitter.tweet(text);
      console.log(`Tweet bot: Posted [${alert.type}] for ${alert.token?.sym || 'recap'} — tweet ID: ${result.data?.id}`);

      // Record in history
      const key = alert.token?.ca || alert.token?.sym;
      if (key) {
        const existing = history[key] || {};
        history[key] = {
          sym: alert.token.sym,
          timestamp: Date.now(),
          p1h: alert.token.p1h,
          p5m: alert.token.p5m,
          tweetId: result.data?.id,
          triggerType: alert.type,
          followUps: alert.type === 'E' ? (existing.followUps || 0) + 1 : 0,
        };
      }

      tweeted++;
      await incrementHourlyCount(kv);

      // Small delay between tweets to be safe
      if (alerts.indexOf(alert) < alerts.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error(`Tweet bot: Failed to post [${alert.type}] for ${alert.token?.sym}:`, e.message);
    }
  }

  // Save updated history
  await saveTweetHistory(kv, history);
  console.log(`Tweet bot: Done. Posted ${tweeted} tweets this run.`);
}

async function handleDailyCron(env) {
  console.log('Tweet bot: Running Winners of the Day...');

  const kv = env.TWEET_STATE;

  // Check if we already posted today
  const today = new Date().toISOString().slice(0, 10);
  const lastRecap = await getLastDailyRecap(kv);
  if (lastRecap === today) {
    console.log('Tweet bot: Already posted daily recap today, skipping.');
    return;
  }

  const tokens = await fetchTokens(env);
  if (tokens.length === 0) {
    console.log('Tweet bot: No tokens from API, skipping.');
    return;
  }

  const triggers = checkTriggerG(tokens);
  if (triggers.length === 0) {
    console.log('Tweet bot: Not enough winners for daily recap.');
    return;
  }

  const twitter = new TwitterClient(
    env.TWITTER_CONSUMER_KEY,
    env.TWITTER_CONSUMER_SECRET,
    env.TWITTER_ACCESS_TOKEN,
    env.TWITTER_ACCESS_SECRET,
  );

  const text = generateTweet(triggers[0]);
  if (!text) return;

  if (text.length > 280) {
    console.log(`Tweet bot: Daily recap too long (${text.length} chars), trimming winners.`);
    // Retry with fewer winners
    triggers[0].tokens = triggers[0].tokens.slice(0, 3);
    const shorter = generateTweet(triggers[0]);
    if (!shorter || shorter.length > 280) {
      console.log('Tweet bot: Cannot fit daily recap in 280 chars.');
      return;
    }
    try {
      await twitter.tweet(shorter);
    } catch (e) {
      console.error('Tweet bot: Failed to post daily recap:', e.message);
      return;
    }
  } else {
    try {
      await twitter.tweet(text);
    } catch (e) {
      console.error('Tweet bot: Failed to post daily recap:', e.message);
      return;
    }
  }

  await setLastDailyRecap(kv, today);
  console.log('Tweet bot: Winners of the Day posted!');
}

// ---- Worker entry points ----

export default {
  // Cron handler
  async scheduled(event, env, ctx) {
    // 0 3 * * * = daily winners (11pm EST)
    if (event.cron === '0 3 * * *') {
      ctx.waitUntil(handleDailyCron(env));
    } else {
      // */5 * * * * = alert checks
      ctx.waitUntil(handleAlertCron(env));
    }
  },

  // HTTP handler — for manual testing
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/test') {
      // Dry run — show what would be tweeted without actually posting
      const tokens = await fetchTokens(env);
      const fetchError = tokens._fetchError || null;
      const kv = env.TWEET_STATE;
      const history = await getTweetHistory(kv);

      const alerts = [
        ...checkTriggerA(tokens, history),
        ...checkTriggerB(tokens, history),
        ...checkTriggerE(tokens, history),
      ];

      const daily = checkTriggerG(tokens);

      const results = {
        totalTokens: tokens.length,
        alerts: alerts.map(a => ({
          type: a.type,
          sym: a.token?.sym,
          tweet: generateTweet(a),
        })),
        dailyWinners: daily.length > 0 ? {
          tweet: generateTweet(daily[0]),
          tokens: daily[0].tokens.map(t => ({ sym: t.sym, p24h: t.p24h })),
        } : null,
        fetchError,
        history: Object.keys(history).length + ' tokens tracked',
        hourly: await getHourlyCount(kv),
      };

      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/trigger' && request.method === 'POST') {
      // Manual trigger — actually post, return results
      const tokens = await fetchTokens(env);
      if (tokens.length === 0) {
        return new Response(JSON.stringify({ error: 'No tokens', fetchError: tokens._fetchError }), { headers: { 'Content-Type': 'application/json' } });
      }

      const twitter = new TwitterClient(
        env.TWITTER_CONSUMER_KEY,
        env.TWITTER_CONSUMER_SECRET,
        env.TWITTER_ACCESS_TOKEN,
        env.TWITTER_ACCESS_SECRET,
      );

      const kv = env.TWEET_STATE;
      const history = await getTweetHistory(kv);
      const alerts = [
        ...checkTriggerA(tokens, history),
        ...checkTriggerB(tokens, history),
        ...checkTriggerE(tokens, history),
      ];

      if (alerts.length === 0) {
        return new Response(JSON.stringify({ result: 'No triggers matched', totalTokens: tokens.length }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Try to tweet the first alert
      const alert = alerts[0];
      const text = generateTweet(alert);
      try {
        const result = await twitter.tweet(text);
        // Record in history
        const key = alert.token?.ca || alert.token?.sym;
        if (key) {
          history[key] = {
            sym: alert.token.sym,
            timestamp: Date.now(),
            p1h: alert.token.p1h,
            p5m: alert.token.p5m,
            tweetId: result.data?.id,
            triggerType: alert.type,
            followUps: 0,
          };
          await saveTweetHistory(kv, history);
        }
        await incrementHourlyCount(kv);
        return new Response(JSON.stringify({ success: true, tweetId: result.data?.id, sym: alert.token?.sym, text }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, sym: alert.token?.sym, text }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/daily' && request.method === 'POST') {
      await handleDailyCron(env);
      return new Response('Daily recap complete');
    }

    return new Response(JSON.stringify({
      name: 'Memescope Tweet Bot',
      endpoints: {
        '/test': 'GET — dry run, shows what would be tweeted',
        '/trigger': 'POST — manually run alert check',
        '/daily': 'POST — manually run daily recap',
      },
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
