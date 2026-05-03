// ============================================================
// Memescope Tweet Bot — Configuration
// All thresholds are easy to tweak here
// ============================================================

export const CONFIG = {
  // API endpoint
  API_URL: 'https://memescope-scraper.memescope-io.workers.dev/tokens',

  // Trigger A: Fast Momentum
  TRIGGER_A: {
    enabled: true,
    minP5m: 40,        // +40% in 5 min
    minVol: 50000,     // $50K volume
    minLiq: 30000,     // $30K liquidity
    minMcap: 75000,    // $75K market cap floor
    minAgeHours: 1,    // at least 1 hour old
    cooldownHours: 6,  // don't re-tweet same token within 6h
  },

  // Trigger B: Early Bird
  TRIGGER_B: {
    enabled: true,
    maxAgeMin: 30,     // 30 min or younger
    minVol: 20000,     // $20K volume
    minMcap: 75000,    // $75K market cap floor
    cooldownHours: 6,
  },

  // Trigger E: Follow-up
  TRIGGER_E: {
    enabled: true,
    minAdditionalGain: 100,    // +100% more since we tweeted
    minTimeSinceTweetMin: 30,  // wait at least 30 min before follow-up
    maxFollowUps: 2,           // max 2 follow-ups per token
    minMcap: 75000,            // $75K market cap floor
  },

  // Trigger G: Winners of the Day
  TRIGGER_G: {
    enabled: true,
    topN: 5,           // top 5 winners
    minP24h: 20,       // at least +20% in 24h to qualify
    minVol: 10000,     // minimum volume to qualify
    minMcap: 250000,   // $250K market cap floor (higher bar for daily winners)
  },

  // Rug check — skip if liquidity is less than this fraction of mcap
  MIN_LIQ_MCAP_RATIO: 0.05,  // 5%

  // Global
  MAX_TWEETS_PER_HOUR: 4,   // safety cap
  SITE_URL: 'memescope.io',

  // Chain display names
  CHAIN_NAMES: {
    solana: 'SOL',
    eth: 'ETH',
    bsc: 'BSC',
    base: 'BASE',
    arbitrum: 'ARB',
    avalanche: 'AVAX',
    polygon: 'MATIC',
    optimism: 'OP',
    blast: 'BLAST',
    ton: 'TON',
  },

  // Chain hashtags
  CHAIN_HASHTAGS: {
    solana: '#solana',
    eth: '#ethereum',
    bsc: '#bnb',
    base: '#base',
    arbitrum: '#arbitrum',
    avalanche: '#avax',
    polygon: '#polygon',
    optimism: '#optimism',
    blast: '#blast',
    ton: '#ton',
  },
};
