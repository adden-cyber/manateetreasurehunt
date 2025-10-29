let selectedDifficulty = "normal"; // Default difficulty
const DIFFICULTY_CREDIT_COST = { easy: 100, normal: 150, hard: 250 };
let userCredits = null;
let startRequestInFlight = false;

const MANATEE_DEBRIS_PARTS = [
  { sx: 60,  sy: 60,  sw: 36, sh: 36 },
  { sx: 160, sy: 60,  sw: 36, sh: 36 },
  { sx: 260, sy: 60,  sw: 36, sh: 36 },
  { sx: 90,  sy: 150, sw: 36, sh: 36 },
  { sx: 180, sy: 160, sw: 36, sh: 36 },
  { sx: 270, sy: 150, sw: 36, sh: 36 },
  { sx: 70,  sy: 240, sw: 36, sh: 36 },
  { sx: 170, sy: 250, sw: 36, sh: 36 },
  { sx: 270, sy: 240, sw: 36, sh: 36 }
];

let GAME_CONFIG = {};

/* Helper: update credits UI and local state */
// --- Credits helpers and Start-button UI helpers (paste this BEFORE setCredits) ---
let creditsCountdownInterval = null;

// Compute next midnight in GMT+8 expressed as a UTC Date
function getNextGmt8MidnightUtc() {
  const now = new Date();
  const offsetMs = 8 * 3600 * 1000; // +8 hours in milliseconds
  const nowGmt8 = new Date(now.getTime() + offsetMs);
  const y = nowGmt8.getUTCFullYear();
  const m = nowGmt8.getUTCMonth();
  const d = nowGmt8.getUTCDate();
  const nextMidnightGmt8UtcMs = Date.UTC(y, m, d + 1, 0, 0, 0) - offsetMs;
  return new Date(nextMidnightGmt8UtcMs);
}

function formatTimeRemainingTo(nextUtcDate) {
  const now = new Date();
  let diffMs = nextUtcDate.getTime() - now.getTime();
  if (diffMs <= 0) return "00:00:00";
  const totalSeconds = Math.floor(diffMs / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s} (GMT+8)`;
}

// Update Start button disabled state and (optionally) its label.
// If you call updateStartButtonUI() before startButton exists, it will try the cached var when available.
function updateStartButtonUI(customLabel) {
  const sb = startButton || document.getElementById('start-button');
  if (!sb) return;
  const cost = DIFFICULTY_CREDIT_COST[selectedDifficulty] || 10;

  // Disable reasons: request in flight, not logged in, or not enough credits
  const notLoggedIn = !userToken;
  const noCredits = (typeof userCredits === 'number' ? (userCredits < cost) : false);
  const disabled = !!startRequestInFlight || notLoggedIn || noCredits;

  // Native disabled state
  sb.disabled = disabled;

  // IMPORTANT: also manage pointer-events so an inline "pointer-events: none" left behind
  // by other code cannot make the button visually enabled but unclickable.
  try {
    sb.style.pointerEvents = disabled ? 'none' : 'auto';
  } catch (e) {
    // ignore styling failures
  }

  // Helpful tooltip so users know *why* the button is disabled
  if (startRequestInFlight) {
    sb.title = 'Starting — please wait';
  } else if (notLoggedIn) {
    sb.title = 'Please log in to start the game';
  } else if (noCredits) {
    sb.title = `Not enough credits (need ${cost})`;
  } else {
    sb.title = 'Start the game';
  }

  if (typeof customLabel === 'string') {
    sb.textContent = customLabel;
  } else {
    sb.textContent = 'Start Game';
  }
}

function refreshFeedbackButton() {
  const sendBtn = document.getElementById('send-feedback-btn');
  if (!sendBtn) return;
  if (!userToken) {
    sendBtn.disabled = true;
    sendBtn.title = 'Log in to send feedback';
  } else {
    sendBtn.disabled = false;
    sendBtn.title = 'Send feedback';
  }
}

// show initial difficulty cost for the active difficulty
// Safe initialization of difficulty cost display — runs now if DOM ready, or on DOMContentLoaded otherwise
(function initDifficultyCostDisplay() {
  function applyCost() {
    const costDisplay = document.getElementById('difficulty-cost-display');
    const activeBtn = document.querySelector('#difficulty-selector .difficulty-btn.active') ||
                      document.querySelector('#difficulty-selector .difficulty-btn');
    const val = activeBtn ? activeBtn.getAttribute('data-value') : selectedDifficulty;
    if (costDisplay) {
      costDisplay.textContent = `Cost to start (${val.charAt(0).toUpperCase()+val.slice(1)}): ${DIFFICULTY_CREDIT_COST[val] || 0} credits`;
      costDisplay.style.display = '';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyCost, { once: true });
  } else {
    applyCost();
  }
})();

// Call this to restore Start button to idle state (used after game end)
function ensureStartButtonIdle() {
  // Reset label/state centrally
  updateStartButtonUI('Start');

  // Defensively restore pointer-events in case any wrapper set it to 'none' and forgot to clear it.
  const sb = startButton || document.getElementById('start-button');
  if (sb) {
    try { sb.style.pointerEvents = 'auto'; } catch (e) {}
  }
}
// --- end helpers ---
// Replace existing setCredits function with this block
function setCredits(value) {
  const n = (value === undefined || value === null) ? NaN : Number(value);
  const ok = !Number.isNaN(n);
  userCredits = ok ? n : null;
  const el = document.getElementById('credits-value');
  if (el) el.textContent = ok ? String(n) : '--';

  // Persist authoritative credit value so a page refresh shows the real amount
  try {
    if (ok) {
      localStorage.setItem('credits', String(n));
    } else {
      localStorage.removeItem('credits');
    }
  } catch (e) {
    // If localStorage is unavailable (private mode, etc.), just continue
    console.warn('[setCredits] localStorage unavailable', e);
  }

  // Update Start button disabled state (but don't change label here)
  const sb = startButton || document.getElementById('start-button');
  if (sb) {
    // Centralize logic so titles/tooltips and in-flight state are applied consistently
    updateStartButtonUI();
  }

  // Credits message element (inserted into HTML; see index.html snippet below)
  const msgEl = document.getElementById('credits-msg');

  // Clear any existing interval if credits are > 0
  if (creditsCountdownInterval) {
    clearInterval(creditsCountdownInterval);
    creditsCountdownInterval = null;
  }

  if (ok && n <= 0) {
    // Show used-up message and start countdown to next GMT+8 midnight
    if (msgEl) {
      const nextUtc = getNextGmt8MidnightUtc();
      // initial set
      msgEl.textContent = `All points have been used up, come back by tomorrow! (${formatTimeRemainingTo(nextUtc)})`;
      msgEl.style.color = '#b00';
      // update every second
      creditsCountdownInterval = setInterval(() => {
        const remainingText = formatTimeRemainingTo(nextUtc);
        msgEl.textContent = `All points have been used up, come back by tomorrow! (${remainingText})`;
      }, 1000);
    }
  } else {
    if (msgEl) {
      msgEl.textContent = '';
    }
  }
  try {
    // keep end-screen indicators up to date whenever credits change
    if (typeof updateEndScreenCredits === 'function') updateEndScreenCredits();
  } catch (e) { /* ignore */ }
}

function updateEndScreenCredits() {
  try {
    const cost = DIFFICULTY_CREDIT_COST[selectedDifficulty] || 0;
    const n = (typeof userCredits === 'number') ? userCredits : null;

    // Completion popup elements
    const remainingEl = document.getElementById('credits-remaining-value-completion');
    const warnEl = document.getElementById('credits-warning-completion');
    const playBtn = document.getElementById('completion-play-again-button');

    if (remainingEl) remainingEl.textContent = (n !== null && n !== undefined) ? String(n) : '--';
    if (warnEl) {
      if (n === null || n < cost) {
        warnEl.style.display = 'block';
        warnEl.textContent = `Not enough credits (need ${cost}). Please return to main page.`;
      } else {
        warnEl.style.display = 'none';
      }
    }
    if (playBtn) {
      if (n === null || n < cost) {
        playBtn.disabled = true;
        playBtn.style.pointerEvents = 'none';
      } else {
        playBtn.disabled = false;
        playBtn.style.pointerEvents = 'auto';
      }
    }

    // Quit popup elements
    const remainingElQ = document.getElementById('credits-remaining-value-quit');
    const warnElQ = document.getElementById('credits-warning-quit');
    const playBtnQ = document.getElementById('quit-play-again-button');

    if (remainingElQ) remainingElQ.textContent = (n !== null && n !== undefined) ? String(n) : '--';
    if (warnElQ) {
      if (n === null || n < cost) {
        warnElQ.style.display = 'block';
        warnElQ.textContent = `Not enough credits (need ${cost}). Please return to main page.`;
      } else {
        warnElQ.style.display = 'none';
      }
    }
    if (playBtnQ) {
      if (n === null || n < cost) {
        playBtnQ.disabled = true;
        playBtnQ.style.pointerEvents = 'none';
      } else {
        playBtnQ.disabled = false;
        playBtnQ.style.pointerEvents = 'auto';
      }
    }
  } catch (e) {
    console.warn('[updateEndScreenCredits] failed', e);
  }
}

const ASSETS = {
  images: {
    mermaid: null,
    manatee: null,
    seaweed: null,
    bubble: null,
    coral: null,
    mine: null,
    treasures: {
      small: null,
      medium: null,
      large: null,
      fake: null
    },
    manateeVariants: []
  },
  sounds: {
    collect: () => {},
    trap: () => {},
    complete: () => {},
    explosion: () => {}
  }
};

const imageManifest = [
  { key: 'mermaid', path: 'images/mermaid.png', assign: img => ASSETS.images.mermaid = img },
  { key: 'wall', path: 'images/wall.png', assign: img => ASSETS.images.wall = img },
  { key: 'manatee', path: 'images/manatee.png', assign: img => { ASSETS.images.manatee = img; ASSETS.images.manateeVariants[0] = img; } },
  { key: 'seaweed', path: 'images/seaweed.png', assign: img => ASSETS.images.seaweed = img },
  { key: 'bubble', path: 'images/bubble.png', assign: img => ASSETS.images.bubble = img },
  { key: 'coral', path: 'images/coral.png', assign: img => ASSETS.images.coral = img },
  { key: 'shell', path: 'images/shell.png', assign: img => ASSETS.images.shell = img },
  { key: 'mine', path: 'images/mine.png', assign: img => ASSETS.images.mine = img },
  { key: 'small', path: 'images/treasure_small.png', assign: img => { img.width=60; img.height=60; img.value=10; ASSETS.images.treasures.small = img; } },
  { key: 'medium', path: 'images/treasure_medium.png', assign: img => { img.width=60; img.height=60; img.value=10; ASSETS.images.treasures.medium = img; } },
  { key: 'large', path: 'images/treasure_large.png', assign: img => { img.width=60; img.height=60; img.value=10; ASSETS.images.treasures.large = img; } },
  { key: 'fake', path: 'images/treasure_fake.png', assign: img => { img.width=60; img.height=60; img.penalty=5; ASSETS.images.treasures.fake = img; } }
];

// Replace the existing BACKEND_URL line with this block
const DEFAULT_BACKEND_URL = "http://192.168.0.114:3001/api";
const BACKEND_URL = (typeof window !== 'undefined' && (
  window.__BACKEND_URL_OVERRIDE ||
  (document.querySelector && document.querySelector('meta[name=\"backend-url\"]')?.getAttribute('content'))
)) || DEFAULT_BACKEND_URL;

/* 2) Small helper: fetch with timeout (prevents hanging on mobile) */
async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/* Safe JSON parse: returns parsed JSON or null on empty/invalid body */
async function safeParseJson(res) {
  if (!res) return null;
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

/* authFetch: central wrapper that injects Authorization when userToken exists.
   Accepts options.timeoutMs (ms) — default 7000. Pass credentials: 'include' when needed.
*/
async function authFetch(url, options = {}) {
  const opts = Object.assign({}, options);
  const timeoutMs = (typeof opts.timeoutMs === 'number') ? opts.timeoutMs : 7000;
  delete opts.timeoutMs;
  opts.headers = createHeaders(opts.headers || {});
  try {
    return await fetchWithTimeout(url, opts, timeoutMs);
  } catch (err) {
    throw err;
  }
}

/* Persistent telemetry retry queue (stores failed logs in localStorage) */
const FAILED_LOGS_KEY = 'failedTelemetryQueue';
function enqueueFailedLog(entry) {
  try {
    const raw = localStorage.getItem(FAILED_LOGS_KEY) || '[]';
    const arr = JSON.parse(raw);
    arr.push(Object.assign({ ts: Date.now() }, entry));
    // cap to last 200 entries
    while (arr.length > 200) arr.shift();
    localStorage.setItem(FAILED_LOGS_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('[telemetry] enqueueFailedLog failed', e);
  }
}
// replace existing processFailedLogs() with this enhanced version
async function processFailedLogs() {
  try {
    const raw = localStorage.getItem(FAILED_LOGS_KEY) || '[]';
    let arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return;
    const stillFailed = [];
    for (const entry of arr) {
      try {
        const res = await fetchWithTimeout(entry.url, {
          method: entry.method || 'POST',
          headers: createHeaders({ 'Content-Type': 'application/json' }),
          body: entry.body ? JSON.stringify(entry.body) : undefined
        }, 4000);

        // Treat success OR "not found" for gameplay-endpoints as non-retryable
        if (res && (res.ok || res.status === 404)) {
          // success (or session already cleaned up) -> do not requeue
          continue;
        } else {
          // non-ok -> requeue
          stillFailed.push(entry);
        }
      } catch (err) {
        // network or other failure -> requeue
        stillFailed.push(entry);
      }
    }
    localStorage.setItem(FAILED_LOGS_KEY, JSON.stringify(stillFailed));
  } catch (e) {
    console.warn('[telemetry] processFailedLogs failed', e);
  }
}

/* attachIfExists: convenience to addEventListener only if element exists */
function attachIfExists(selectorOrEl, evt, handler, options) {
  try {
    const el = (typeof selectorOrEl === 'string') ? document.querySelector(selectorOrEl) : selectorOrEl;
    if (el) el.addEventListener(evt, handler, options);
    return el;
  } catch (e) {
    console.warn('[attachIfExists] failed for', selectorOrEl, e);
    return null;
  }
}

// try immediately and schedule periodic retries
try { processFailedLogs().catch(console.warn); } catch (e) {}
setInterval(() => processFailedLogs().catch(console.warn), 30000);

// Add this helper (place right after fetchWithTimeout or before wireFeedbackUI)
async function sendFeedbackToServer(payload) {
  const url = `${backendBase()}/api/feedback`;
  const headers = { 'Content-Type': 'application/json' };
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

  console.debug('[feedback] sending', { email: userEmail, rating: payload.rating, textLen: (payload.text||'').length, hasToken: !!userToken });

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    }, 7000);

    // Helpful diagnostics in console to see server response and status
    let bodyText = '<no body>';
    try { bodyText = await res.clone().text(); } catch (e) {}
    console.debug('[feedback] response', { ok: !!res && res.ok, status: res && res.status, bodyPreview: bodyText.slice(0, 1000) });

    if (!res.ok) {
  const errJson = await safeParseJson(res) || {};
  throw new Error('Feedback failed: ' + (errJson.error || res.status));
}

    return res;
  } catch (err) {
    console.warn('[feedback] sendFeedbackToServer failed', err);
    throw err;
  }
}


// Utility: create headers object and include Authorization only when userToken exists
function createHeaders(base = {}) {
  const headers = Object.assign({}, base);
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
  return headers;
}

// Compute backend base URL (strip trailing /api if present)
function backendBase() {
  try {
    return BACKEND_URL.endsWith('/api') ? BACKEND_URL.slice(0, -4) : BACKEND_URL;
  } catch (e) {
    return BACKEND_URL;
  }
}

/* 3) Provide a safe default config if backend is unreachable */
function buildOpenPattern(rows = 14, cols = 28) {
  const pattern = Array.from({ length: rows }, () => '0'.repeat(cols));
  // Place a start 'X' roughly near top-left and one mermaid 'M' somewhere
  const rX = Math.max(1, Math.floor(rows * 0.2));
  const cX = Math.max(1, Math.floor(cols * 0.2));
  const rM = Math.min(rows - 2, Math.floor(rows * 0.7));
  const cM = Math.min(cols - 2, Math.floor(cols * 0.7));
  const pX = pattern[rX].split(''); pX[cX] = 'X'; pattern[rX] = pX.join('');
  const pM = pattern[rM].split(''); pM[cM] = 'M'; pattern[rM] = pM.join('');
  return pattern;
}

const DEFAULT_GAME_CONFIG = {
  mazePattern: buildOpenPattern(14, 28),
  totalTreasures: 16,
  totalSeaweeds: 50,
  totalBubbles: 6,
  totalMines: 6,
  totalFakeChests: 4,
  gameTimeSeconds: 90,
};

function applyConfigToGlobals(cfg) {
  customPattern = cfg.mazePattern;
  TOTAL_TREASURES = cfg.totalTreasures;
  SEAWEED_COUNT = cfg.totalSeaweeds;
  BUBBLE_COUNT = cfg.totalBubbles;
  NUM_MINES = cfg.totalMines;
  GAME_TIME_SECONDS = cfg.gameTimeSeconds;
}

let sessionId = null;
let userToken = localStorage.getItem('token') || null;
let userEmail = localStorage.getItem('email') || null;
let customPattern = [], TOTAL_TREASURES = 0, SEAWEED_COUNT = 0, BUBBLE_COUNT = 0, NUM_MINES = 0, GAME_TIME_SECONDS = 0;
/* 5) Make start logging non-blocking: never block init on network */
// REPLACE the existing logStartGame() with this safer dry-run-only version
 // REPLACE existing logStartGame() with this
function logStartGame() {
  // never call /start for real here. This is a best-effort dry-run for diagnostics only.
  if (sessionId) return Promise.resolve();

  const headers = { 'Content-Type': 'application/json', 'X-Dry-Run': '1' };
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

  return fetchWithTimeout(`${backendBase()}/api/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ difficulty: selectedDifficulty, email: userEmail })
  }, 5000)
  .then(r => {
    if (!r.ok) return Promise.reject(new Error(`start dry-run ${r.status}`));
    return safeParseJson(r);
  })
  .then(data => {
    // don't mutate sessionId here — this must only be set by the real /start response
    return data;
  })
  .catch(err => {
    console.warn('[game] logStartGame failed (non-blocking):', err);
    return null;
  });
}

/* Telemetry: send events with timeout and enqueue failed attempts for retry */
function logChest(chest) {
  const url = `${backendBase()}/api/chest`;
  const payload = { sessionId, x: chest.x, y: chest.y, value: chest.value, type: chest.type };
  fetchWithTimeout(url, {
    method: "POST",
    headers: createHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  }, 4000)
  .then(res => {
    if (!res.ok) {
      enqueueFailedLog({ url, method: 'POST', body: payload });
      console.warn('[logChest] non-ok, queued for retry', res.status);
    }
  })
  .catch(err => {
    console.warn('[logChest] failed, queued for retry', err);
    enqueueFailedLog({ url, method: 'POST', body: payload });
  });
}

function logBubble(bubble) {
  const url = `${backendBase()}/api/bubble`;
  const payload = { sessionId, x: bubble.x, y: bubble.y, value: bubble.value };
  fetchWithTimeout(url, {
    method: "POST",
    headers: createHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  }, 4000)
  .then(res => {
    if (!res.ok) {
      enqueueFailedLog({ url, method: 'POST', body: payload });
      console.warn('[logBubble] non-ok, queued for retry', res.status);
    }
  })
  .catch(err => {
    console.warn('[logBubble] failed, queued for retry', err);
    enqueueFailedLog({ url, method: 'POST', body: payload });
  });
}

function logMineDeath() {
  const url = `${backendBase()}/api/mineDeath`;
  const payload = { sessionId };
  fetchWithTimeout(url, {
    method: "POST",
    headers: createHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  }, 4000)
  .then(res => {
    if (!res.ok) {
      enqueueFailedLog({ url, method: 'POST', body: payload });
      console.warn('[logMineDeath] non-ok, queued for retry', res.status);
    }
  })
  .catch(err => {
    console.warn('[logMineDeath] failed, queued for retry', err);
    enqueueFailedLog({ url, method: 'POST', body: payload });
  });
}

// Replace existing logEndGame(...) with this updated implementation
function logEndGame(endedEarly = false) {
  const url = `${backendBase()}/api/end`;
  const payload = {
    sessionId,
    endedEarly,
    grace: !!endedWithinGrace,
    score: typeof score !== 'undefined' ? score : 0,
    seaweedsCollected: Array.isArray(collectibleSeaweeds) ? collectibleSeaweeds.filter(s => s.collected).length : 0
  };
  fetchWithTimeout(url, {
    method: "POST",
    headers: createHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  }, 4000)
  .then(async res => {
    if (!res.ok) {
      // try to parse error body for diagnostics (non-blocking)
      const errJson = await safeParseJson(res).catch(()=>null);
      enqueueFailedLog({ url, method: 'POST', body: payload });
      console.warn('[logEndGame] non-ok, queued for retry', res.status, errJson);
      return;
    }
    // If server returns JSON, apply credits if provided
    try {
      const data = await safeParseJson(res) || {};
      if (data && data.refunded) {
        console.info('[logEndGame] server indicates credits were refunded for session', payload.sessionId);
      }
      if (data && typeof data.credits === 'number') {
        // update client-side credits immediately
        setCredits(data.credits);
        console.info('[logEndGame] updated client credits to', data.credits);
      }
    } catch (e) {
      // ignore parse errors
    }
  })
  .catch(err => {
    console.warn('[logEndGame] failed, queued for retry', err);
    enqueueFailedLog({ url, method: 'POST', body: payload });
  });
}

// Replace existing getGameReport
async function getGameReport() {
  try {
    const res = await authFetch(`${backendBase()}/api/report`, { timeoutMs: 7000 });
    if (!res || !res.ok) return null;
    return await safeParseJson(res);
  } catch (e) {
    console.warn('[getGameReport] failed', e);
    return null;
  }
}

// DOM references
let startScreen, gameScreen, completionPopup, quitResultPopup;
let startButton, completionPlayAgainButton, completionReturnToStartButton;
let quitPlayAgainButton, quitReturnToStartButton;
let endGameButton;
let endedWithinGrace = false;
let scoreValue, treasuresCollected, totalTreasures, finalScore, quitFinalScore, quitTreasuresCollected;
let timerValue, timeRemaining;
let completionTitle, completionMessage, quitTitle, quitMessage;
let canvas, ctx;
let confettiCameraX = 0, confettiCameraY = 0, confettiViewportWidth = 0, confettiViewportHeight = 0;
let celebrationTimer = 0;
let celebrationActive = false
function stopAnimationLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}
let isGameOver = false;
let rafId = null;

// Add near other globals (e.g. after `let rafId = null;`)
let hudVisible = true;              // single global HUD visibility flag (used by setHUDVisible)
let joystickContainer = null;
let joystickBase = null;
let joystickStick = null;
let baseRect = null;             // single global HUD visibility flag (used by setHUDVisible)
window.selectedDifficulty = selectedDifficulty; // expose for small inline scripts

// Map and viewport constants
let GAME_WIDTH = 4800, GAME_HEIGHT = 3600;
const MANATEE_SPEED = 5;
const CHEST_SIZE = 60;
const AMBIENT_BUBBLE_COUNT = 120;
const AMBIENT_SEAWEED_COUNT = 700;
const AMBIENT_CORAL_COUNT = 80;
const WALL_THICKNESS = 34;
const PRE_GAME_TIMER = 3;
const CHEST_SPAWN_EXCLUDE_RADIUS = 280;
let manateeJumping = false;
let manateeJumpFrame = 0;
let manateeJumpCount = 0;
const MANATEE_JUMPS_TOTAL = 3; // Set how many jumps you want
const MANATEE_JUMP_DURATION = 40; // frames (about 0.66s at 60fps)
const MANATEE_JUMP_HEIGHT = 110;  // pixels
let fakeTreasureSlowTimer = 0; // in frames (60fps)
// Mermaid constants and state
const MERMAID_SPEED = MANATEE_SPEED;
const MERMAID_SIZE = 70;
const MERMAID_COLOR = "#db71bc";
const MERMAID_EXCLAMATION_TIME = 60; // 1s at 60fps
const MERMAID_CHASE_TIME = 480; // 8s at 60fps

// Screenshake effect variables
let screenshakeTimer = 0;
let screenshakeMagnitude = 0;
let screenshakeX = 0;
let screenshakeY = 0;



// Helper: get a random open cell from the map
// Helper: get a random open cell from the map
function getRandomOpenPosition() {
  const openCells = getValidTreasurePositions(walls);
  if (!openCells || openCells.length === 0) {
    // fallback to center of map
    return { x: Math.max(0, GAME_WIDTH/2 - CHEST_SIZE/2), y: Math.max(0, GAME_HEIGHT/2 - CHEST_SIZE/2) };
  }
  return openCells[Math.floor(Math.random() * openCells.length)];
}

let mermaidStuckCounter = 0;

function updateMermaids() {
  for (const mermaid of mermaids) {
    if (explosionActive) continue;
    let moved = false;
    if (mermaid.state === "roaming") {
      let dx = mermaid.roamTarget.x - mermaid.x;
      let dy = mermaid.roamTarget.y - mermaid.y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      let step = 2.3;
      if (dist < 40) {
        mermaid.roamTarget = getRandomOpenPosition();
      } else {
        if (Math.abs(dx) > 1) {
          let tryX = mermaid.x + step * dx/dist;
          let tryRectX = { ...mermaid, x: tryX };
          if (!walls.some(wall => isColliding(tryRectX, wall))) {
            mermaid.x = tryX;
            moved = true;
          }
        }
        if (Math.abs(dy) > 1) {
          let tryY = mermaid.y + step * dy/dist;
          let tryRectY = { ...mermaid, y: tryY };
          if (!walls.some(wall => isColliding(tryRectY, wall))) {
            mermaid.y = tryY;
            moved = true;
          }
        }
      }
      if (!moved) {
        mermaid.stuckCounter++;
        if (mermaid.stuckCounter > 20) {
          mermaid.roamTarget = getRandomOpenPosition();
          mermaid.stuckCounter = 0;
        }
      } else {
        mermaid.stuckCounter = 0;
      }
      if (isColliding(mermaid, manatee)) {
        mermaid.state = "exclamation";
        mermaid.stateTimer = MERMAID_EXCLAMATION_TIME;
        mermaid.lastChaseTarget = { x: mermaid.x, y: mermaid.y };
      }
    } else if (mermaid.state === "exclamation") {
      mermaid.stateTimer--;
      if (mermaid.stateTimer <= 0) {
        mermaid.state = "chase";
        mermaid.stateTimer = MERMAID_CHASE_TIME;
      }
    } else if (mermaid.state === "chase") {
      let dx = manatee.x - mermaid.x;
      let dy = manatee.y - mermaid.y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      let step = MERMAID_SPEED;
      if (dist > 0.1) {
        if (Math.abs(dx) > 1) {
          let tryX = mermaid.x + step * dx/dist;
          let tryRectX = { ...mermaid, x: tryX };
          if (!walls.some(wall => isColliding(tryRectX, wall))) {
            mermaid.x = tryX;
          }
        }
        if (Math.abs(dy) > 1) {
          let tryY = mermaid.y + step * dy/dist;
          let tryRectY = { ...mermaid, y: tryY };
          if (!walls.some(wall => isColliding(tryRectY, wall))) {
            mermaid.y = tryY;
          }
        }
      }
      if (isColliding(mermaid, manatee)) {
        startExplosion(); // Mermaid triggers explosion/game over
      }
      mermaid.stateTimer--;
      if (mermaid.stateTimer <= 0) {
        mermaid.state = "exhausted";
        mermaid.stateTimer = 240;
        mermaid.roamTarget = getRandomOpenPosition();
      }
    } else if (mermaid.state === "exhausted") {
      let dx = mermaid.roamTarget.x - mermaid.x;
      let dy = mermaid.roamTarget.y - mermaid.y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      let step = 1.2;
      if (dist > step) {
        if (Math.abs(dx) > 1) {
          let tryX = mermaid.x + step * dx/dist;
          let tryRectX = { ...mermaid, x: tryX };
          if (!walls.some(wall => isColliding(tryRectX, wall))) {
            mermaid.x = tryX;
          }
        }
        if (Math.abs(dy) > 1) {
          let tryY = mermaid.y + step * dy/dist;
          let tryRectY = { ...mermaid, y: tryY };
          if (!walls.some(wall => isColliding(tryRectY, wall))) {
            mermaid.y = tryY;
          }
        }
      }
      mermaid.stateTimer--;
      if (mermaid.stateTimer <= 0) {
        mermaid.state = "roaming";
        mermaid.roamTarget = getRandomOpenPosition();
      }
    }
    mermaid.x = Math.max(0, Math.min(GAME_WIDTH-mermaid.width, mermaid.x));
    mermaid.y = Math.max(0, Math.min(GAME_HEIGHT-mermaid.height, mermaid.y));
  }
}


// State
let gameActive = false, score = 0, collectedTreasures = 0, gameTimer = GAME_TIME_SECONDS, gameStartTime = 0;
let treasures = [], walls = [], bubbles = [], seaweeds = [], corals = [];
let mines = [];
let explosionActive = false;
let debrisPieces = [];
let explosionTimer = 0;
let preGameCountdown = PRE_GAME_TIMER;
let preGameState = "count";
let timeInterval = null;
let preGameInterval = null;
let activeSeaweedBoost = false;
let seaweedBoostTimer = 0;
const SEAWEED_BOOST_AMOUNT = 1.5; // 50% increase
const SEAWEED_BOOST_DURATION = 8 * 60; // 8 seconds at 60fps
const keysPressed = {};
let mermaids = []; // Array of all mermaids
let collectibleSeaweeds = [];
let floatingRewards = []; // Each item: {x, y, value, alpha, vy}
let collectibleBubbles = []; // Each: {x, y, width, height, value, collected}
let confettiActive = false;
let confettiParticles = [];

function generateCollectibleSeaweeds() {
  let positions = getValidTreasurePositions(walls);
  let used = new Set();
  let arr = [];
  let count = Math.min(SEAWEED_COUNT, positions.length);
  while (arr.length < count) {
    let idx = Math.floor(Math.random() * positions.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const pos = positions[idx];
    let overlap = treasures.some(t => Math.abs(t.x - pos.x) < 60 && Math.abs(t.y - pos.y) < 60);
    if (overlap) continue;
    arr.push({
      x: pos.x,
      y: pos.y,
      width: 60,
      height: 120,
      collected: false,
      boost: true
    });
  }
  return arr;
}

function generateCollectibleBubbles() {
  let positions = getValidTreasurePositions(walls);
  let arr = [];
  let used = new Set();
  let count = Math.min(BUBBLE_COUNT, positions.length); // 5 bubbles per game, adjust as you like
  const values = [5, 10, 15];

  // Prevent placement on top of any chest (real or fake)
  while (arr.length < count) {
    let idx = Math.floor(Math.random() * positions.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const pos = positions[idx];

    // Check overlap with all treasures (real and fake)
    let overlapsAnyChest = treasures.some(t =>
      Math.abs(t.x - pos.x) < CHEST_SIZE && Math.abs(t.y - pos.y) < CHEST_SIZE
    );
     let overlapsSeaweed = collectibleSeaweeds && collectibleSeaweeds.some(s =>
      Math.abs(s.x - pos.x) < 60 && Math.abs(s.y - pos.y) < 60
    );

    if (overlapsAnyChest || overlapsSeaweed) continue;

    arr.push({
      x: pos.x,
      y: pos.y,
      width: 52, // bubble size
      height: 52,
      value: values[Math.floor(Math.random() * values.length)],
      collected: false,
    });
  }
  return arr;
}

let cameraX = 0, cameraY = 0;

const manatee = { x: CHEST_SIZE, y: CHEST_SIZE, width: 80, height: 60, speedX: 0, speedY: 0, moving: false, direction: 1 };
let manateeLastX = CHEST_SIZE, manateeLastY = CHEST_SIZE;

let playAgainAfterDeath = false;

// MOBILE/JOYSTICK SUPPORT
let isMobile = false;
let joystickActive = false, joystickX = 0, joystickY = 0;

// Fullscreen sizing: always use window.innerWidth/innerHeight for the canvas
let VIEWPORT_WIDTH = window.innerWidth;
let VIEWPORT_HEIGHT = window.innerHeight;


// REPLACE existing updateViewportSize() with this function
function updateViewportSize() {
  // CSS-visible viewport in CSS pixels (matches window)
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;

  // Decide zoom factor by device class so controls remain usable on small screens
  const isNarrow = cssWidth < 900;
  const isTablet = cssWidth >= 900 && cssWidth < 1400;

  // Tunable zoom factors (higher => see more of the world)
  const DESKTOP_ZOOM = 1.50; // 1.5x wider view on desktop
  const TABLET_ZOOM  = 1.25; // moderate zoom on mid-size screens
  const MOBILE_ZOOM  = 1.08; // gentle zoom on phones so controls still feel responsive

  let zoom = DESKTOP_ZOOM;
  if (isNarrow) zoom = MOBILE_ZOOM;
  else if (isTablet) zoom = TABLET_ZOOM;

  // Compute requested viewport (world pixels visible)
  // Clamp so viewport never exceeds the world size.
  VIEWPORT_WIDTH = Math.min(Math.round(cssWidth * zoom), GAME_WIDTH);
  VIEWPORT_HEIGHT = Math.min(Math.round(cssHeight * zoom), GAME_HEIGHT);

  // For very large worlds keep aspect ratio of CSS viewport so scaling looks natural
  // (This keeps UI pixel sizes stable while the backing store is larger.)
  if (!canvas) return;

  // Device pixel ratio for crisp rendering on high-DPI displays
  const dpr = window.devicePixelRatio || 1;

  // Backing store should be world pixels scaled by DPR
  canvas.width = Math.round(VIEWPORT_WIDTH * dpr);
  canvas.height = Math.round(VIEWPORT_HEIGHT * dpr);

  // Ensure the visible size of the canvas matches the CSS viewport
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.style.background = "#234";
  canvas.style.setProperty("z-index", "0", "important");

  // Reset the 2D context transform so 1 canvas unit = 1 CSS pixel (scaled by DPR)
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function isColliding(rect1, rect2) {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}


// --- Mermaid Drawing ---
function drawMermaids() {
  for (const mermaid of mermaids) {
    const img = ASSETS.images.mermaid;
    if (img && img.complete) {
      ctx.save();
      ctx.drawImage(
        img,
        mermaid.x - cameraX,
        mermaid.y - cameraY,
        mermaid.width,
        mermaid.height
      );
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(
        mermaid.x + mermaid.width/2 - cameraX,
        mermaid.y + mermaid.height/2 - cameraY,
        mermaid.width/2, mermaid.height/2,
        0, 0, Math.PI * 2
      );
      ctx.fillStyle = MERMAID_COLOR;
      ctx.fill();
      ctx.restore();
    }
  }
}



/* Fix drawMinimap(): change const -> let for MM_X/MM_Y to allow reassignment on mobile */
function drawMinimap() {
  const MM_WIDTH = 240;
  const MM_HEIGHT = 180;
  const MM_MARGIN = 20;
  let MM_X = MM_MARGIN;
  let MM_Y = VIEWPORT_HEIGHT - MM_HEIGHT - MM_MARGIN;

  if (isMobile) {
    MM_X = MM_MARGIN; // left edge
    MM_Y = VIEWPORT_HEIGHT / 2 - MM_HEIGHT / 2; // vertical center
  }

  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#222";
  ctx.fillRect(MM_X, MM_Y, MM_WIDTH, MM_HEIGHT);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(MM_X, MM_Y, MM_WIDTH, MM_HEIGHT);

  const scaleX = MM_WIDTH / GAME_WIDTH;
  const scaleY = MM_HEIGHT / GAME_HEIGHT;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#2b3e2f";
  for (const w of walls) {
    ctx.fillRect(
      MM_X + w.x * scaleX,
      MM_Y + w.y * scaleY,
      Math.max(1, w.width * scaleX),
      Math.max(1, w.height * scaleY)
    );
  }
  ctx.restore();

  // Real treasures only
  ctx.save();
  ctx.globalAlpha = 0.8;
  for (const t of treasures) {
    if (!t.collected && t.type !== "fake") {
      ctx.fillStyle = "#ffd700";
      ctx.fillRect(
        MM_X + t.x * scaleX,
        MM_Y + t.y * scaleY,
        Math.max(2, CHEST_SIZE * scaleX),
        Math.max(2, CHEST_SIZE * scaleY)
      );
    }
  }
  ctx.restore();

  // Mines
  ctx.save();
  ctx.globalAlpha = 0.8;
  for (const mine of mines) {
    ctx.fillStyle = "#ff3131";
    ctx.beginPath();
    ctx.arc(
      MM_X + (mine.x + mine.width / 2) * scaleX,
      MM_Y + (mine.y + mine.height / 2) * scaleY,
      Math.max(3, mine.width * scaleX / 2),
      0, Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();

  // Collectible seaweed
  ctx.save();
  ctx.globalAlpha = 0.9;
  for (const s of collectibleSeaweeds) {
    if (!s.collected) {
      ctx.fillStyle = "#00ff88";
      ctx.fillRect(
        MM_X + s.x * scaleX,
        MM_Y + s.y * scaleY,
        Math.max(3, s.width * scaleX / 3),
        Math.max(6, s.height * scaleY / 8)
      );
    }
  }
  ctx.restore();

  // Camera viewport box
  ctx.strokeStyle = "#76e3ff";
  ctx.lineWidth = 3;
  ctx.strokeRect(
    MM_X + cameraX * scaleX,
    MM_Y + cameraY * scaleY,
    VIEWPORT_WIDTH * scaleX,
    VIEWPORT_HEIGHT * scaleY
  );

  // Player dot
  ctx.beginPath();
  ctx.arc(
    MM_X + (manatee.x + manatee.width / 2) * scaleX,
    MM_Y + (manatee.y + manatee.height / 2) * scaleY,
    8, 0, Math.PI * 2
  );
  ctx.fillStyle = "#ffe5b4";
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function generateMazeWalls() {
  const walls = [];
  const rows = customPattern.length;
  const cols = customPattern[0].length;
  const cellW = GAME_WIDTH / cols;
  const cellH = GAME_HEIGHT / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (customPattern[r][c] === "1") {
        const wall = {
          x: c * cellW,
          y: r * cellH,
          width: cellW,
          height: cellH,
          decorations: []
        };
        // --- Add coral/shell decorations as before ---
        if (Math.random() < 0.35) {
          const shellSize = 32 + Math.random() * 16;
          wall.decorations.push({
            type: "shell",
            x: Math.random() * (cellW - shellSize),
            y: Math.random() * (cellH - shellSize),
            size: shellSize
          });
        }
        if (Math.random() < 0.28) {
          const coralSize = 42 + Math.random() * 32;
          wall.decorations.push({
            type: "coral",
            x: Math.random() * (cellW - coralSize),
            y: Math.random() * (cellH - coralSize),
            size: coralSize
          });
        }
        walls.push(wall);
      }
    }
  }
  return walls;
}

function generateBubbles() {
  const bubbles = [];
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    bubbles.push({
      x: Math.random() * (GAME_WIDTH - 30) + 15,
      y: Math.random() * (GAME_HEIGHT - 200) + 100,
      radius: Math.random() * 12 + 8,
      speed: Math.random() * 0.7 + 0.3
    });
  }
  return bubbles;
}

function generateSeaweeds() {
  const seaweeds = [];
  const count = SEAWEED_COUNT;
  for (let i = 0; i < count; i++) {
    const seaweedWidth = 60 + Math.random() * 70;
    const seaweedHeight = 160 + Math.random() * 140;
    // Place anywhere on the map, not just at the bottom!
    let x = Math.random() * (GAME_WIDTH - seaweedWidth);
    let y = Math.random() * (GAME_HEIGHT - seaweedHeight);
    seaweeds.push({
      x,
      y,
      width: seaweedWidth,
      height: seaweedHeight
    });
  }
  return seaweeds;
}

function generateCorals() {
  const corals = [];
  const count = AMBIENT_CORAL_COUNT;
  for (let i = 0; i < count; i++) {
    const coralWidth = 120 + Math.random() * 180;
    const coralHeight = 100 + Math.random() * 230;
    let x = (i * GAME_WIDTH / count) + Math.random() * 50;
    corals.push({
      x,
      y: GAME_HEIGHT - coralHeight + Math.random() * 30,
      width: coralWidth,
      height: coralHeight
    });
  }
  return corals;
}

// --- Mines Initialization ---
function generateMines() {
  const mines = [];
  let tries = 0;
  let maxTries = 300;
  let placed = 0;
  const validPositions = getValidTreasurePositions(walls);
  if (!validPositions || validPositions.length === 0) {
    // Nothing to place safely — return empty list
    return mines;
  }
  const MINE_MARGIN = 16;
  const MIN_MINE_DISTANCE = 220;

  while (placed < NUM_MINES && tries < maxTries) {
    tries++;
    let idx = Math.floor(Math.random() * validPositions.length);
    const pos = validPositions[idx];
    // compute grid cell size from the actual maze (fallback to 14x28)
    const rows = (Array.isArray(customPattern) && customPattern.length) ? customPattern.length : 14;
    const cols = (Array.isArray(customPattern) && customPattern[0] && customPattern[0].length) ? customPattern[0].length : 28;
    let cellW = GAME_WIDTH / cols;
    let cellH = GAME_HEIGHT / rows; 
    let mineW = 80, mineH = 80;
    let maxOffsetX = Math.max(0, cellW - mineW - 2*MINE_MARGIN);
    let maxOffsetY = Math.max(0, cellH - mineH - 2*MINE_MARGIN);
    let x = pos.x + MINE_MARGIN + Math.random() * maxOffsetX;
    let y = pos.y + MINE_MARGIN + Math.random() * maxOffsetY;

    if (x < 200 && y < 200) continue;
    let overlap = mines.some(m => Math.abs(m.x - x) < 100 && Math.abs(m.y - y) < 100);
    if (overlap) continue;

    let tooClose = mines.some(m => {
      let dx = m.x - x;
      let dy = m.y - y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      return dist < MIN_MINE_DISTANCE;
    });
    if (tooClose) continue;

    let row = Math.floor(y / cellH);
    let col = Math.floor(x / cellW);
    let wallNeighbors = 0;
    if (Array.isArray(customPattern) && customPattern.length > 0) {
      if (row > 0 && customPattern[row - 1] && customPattern[row - 1][col] === "1") wallNeighbors++;
      if (row < customPattern.length - 1 && customPattern[row + 1] && customPattern[row + 1][col] === "1") wallNeighbors++;
      if (col > 0 && customPattern[row] && customPattern[row][col - 1] === "1") wallNeighbors++;
      if (customPattern[0] && col < customPattern[0].length - 1 && customPattern[row] && customPattern[row][col + 1] === "1") wallNeighbors++;
    }
    if (wallNeighbors >= 3) continue;

    let mineRect = { x, y, width: mineW, height: mineH };
    let collidesWithWall = walls.some(w => isColliding(mineRect, w));
    if (collidesWithWall) continue;

    // --- RANDOMLY CHOOSE HORIZONTAL OR VERTICAL ---
    let isHorizontal = Math.random() < 0.5;
    let range = 300 + Math.random() * 400; // example range
    let speed = 3 + Math.random() * 2;
    let direction = Math.random() > 0.5 ? 1 : -1;

    let mineData = {
      x, y, width: mineW, height: mineH,
      speed,
      direction,
      range
    };

    if (isHorizontal) {
  mineData.baseX = x;
  mineData.baseY = undefined;
} else {
  mineData.baseY = y;
  mineData.baseX = undefined;
}

    mines.push(mineData);
    placed++;
  }

  return mines;
}

// --- Mines Movement (call in your game loop) ---
function updateMines() {
  for (let i = mines.length - 1; i >= 0; i--) {
    const mine = mines[i];
    let prevX = mine.x, prevY = mine.y;

    if (typeof mine.baseX === "number") {
      mine.x += mine.speed * mine.direction;
      let mineRect = { x: mine.x, y: mine.y, width: mine.width, height: mine.height };
      if (walls.some(w => isColliding(mineRect, w))) {
        mine.x = prevX;
        mine.direction *= -1;
      }
    } else if (typeof mine.baseY === "number") {
      mine.y += mine.speed * mine.direction;
      let mineRect = { x: mine.x, y: mine.y, width: mine.width, height: mine.height };
      if (walls.some(w => isColliding(mineRect, w))) {
        mine.y = prevY;
        mine.direction *= -1;
      }
    }
    // Clamp the mine's position inside the map
    mine.x = Math.max(0, Math.min(GAME_WIDTH - mine.width, mine.x));
    mine.y = Math.max(0, Math.min(GAME_HEIGHT - mine.height, mine.y));

    if (!explosionActive && isColliding(manatee, mine)) {
      startExplosion(i);
    }
  }
}

function getValidTreasurePositions(walls) {
  if (!Array.isArray(customPattern) || customPattern.length === 0 || !customPattern[0]) {
    // fallback: single center position so other code can continue
    return [{ x: Math.max(0, GAME_WIDTH/2 - CHEST_SIZE/2), y: Math.max(0, GAME_HEIGHT/2 - CHEST_SIZE/2) }];
  }

  const rows = customPattern.length;
  const cols = customPattern[0].length;
  // guards in case cols is zero (shouldn't happen for valid patterns)
  if (!cols || !rows) {
    return [{ x: Math.max(0, GAME_WIDTH/2 - CHEST_SIZE/2), y: Math.max(0, GAME_HEIGHT/2 - CHEST_SIZE/2) }];
  }

  const cellW = GAME_WIDTH / cols;
  const cellH = GAME_HEIGHT / rows;
  const validPositions = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (customPattern[r] && customPattern[r][c] === "0") { // Only open cells
        validPositions.push({
          x: c * cellW + cellW/2 - CHEST_SIZE/2,
          y: r * cellH + cellH/2 - CHEST_SIZE/2
        });
      }
    }
  }
  return validPositions;
}

function startExplosion(mineIndex) {
  if (explosionActive) return;
  explosionActive = true;
  logMineDeath();
  debrisPieces = [];
  explosionTimer = 0;
  if (typeof mineIndex === "number") {
    mines.splice(mineIndex,1);
  }
  screenshakeTimer = 30;   // duration in frames (e.g., 18 = 0.3 sec at 60fps)
  screenshakeMagnitude = 60; // shake intensity in pixels
  for (let i = 0; i < 9; i++) {
    const angle = (Math.PI * 2) * (i / 9) + Math.random() * 0.3 - 0.15;
    const speed = 6 + Math.random() * 4;
    debrisPieces.push({
      partIdx: i,
      x: manatee.x + manatee.width/2,
      y: manatee.y + manatee.height/2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.12
    });
  }
}

function drawExplosionAndDebris() {
  const manateeImg = ASSETS.images.manatee;
  for (const d of debrisPieces) {
    ctx.save();
    ctx.translate(d.x - cameraX, d.y - cameraY);
    ctx.rotate(d.rot);
    const part = MANATEE_DEBRIS_PARTS[d.partIdx];
    let drewImage = false;
    if (manateeImg) {
      ctx.drawImage(
        manateeImg,
        part.sx, part.sy, part.sw, part.sh,
        -part.sw/2, -part.sh/2, part.sw, part.sh
      );
      drewImage = true;
    }
    if (!drewImage) {
      ctx.fillStyle = "#bbb";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(part.sw, part.sh)/2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - explosionTimer/60);
  ctx.beginPath();
  ctx.arc(manatee.x + manatee.width/2 - cameraX, manatee.y + manatee.height/2 - cameraY, 120 + explosionTimer*2, 0, Math.PI*2);
  ctx.fillStyle = "rgba(255,200,60,0.3)";
  ctx.fill();
  ctx.restore();
}

function startConfetti() {
  confettiActive = true;
  confettiParticles = [];
  // Capture the camera and viewport at the instant of winning
  confettiCameraX = cameraX;
  confettiCameraY = cameraY;
  confettiViewportWidth = VIEWPORT_WIDTH;
  confettiViewportHeight = VIEWPORT_HEIGHT;
  for (let side = -1; side <= 1; side += 2) { // -1 for left, 1 for right
      // Spawn confetti across the full top edge
for (let i = 0; i < 80; i++) { // Increase for more particles
  confettiParticles.push({
    x: confettiCameraX + Math.random() * confettiViewportWidth,
    y: confettiCameraY - 20 + Math.random() * 30, // just above the top
    vx: (Math.random() - 0.5) * 3, // small random left/right
    vy: Math.random() * 3 + 2,
    size: Math.random() * 8 + 7,
    color: randomConfettiColor(),
    angle: Math.random() * Math.PI * 2,
    angularSpeed: (Math.random() - 0.5) * 0.2,
    life: Math.random() * 26 + 54
  });
}
    }
  }

function updateConfetti() {
  if (!confettiActive) return;
  for (const c of confettiParticles) {
    c.x += c.vx;
    c.y += c.vy;
    c.vy += 0.12; // gravity
    c.angle += c.angularSpeed;
    c.life--;
  }
  // Use captured confetti camera/viewport!
  confettiParticles = confettiParticles.filter(c =>
    c.life > 0 &&
    c.y < confettiCameraY + confettiViewportHeight + 40 &&
    c.x > confettiCameraX - 40 &&
    c.x < confettiCameraX + confettiViewportWidth + 40
  );
  if (confettiParticles.length === 0) confettiActive = false;
}
 

function drawConfetti() {
    if (!confettiActive) return;
    for (const c of confettiParticles) {
      ctx.save();
      ctx.translate(c.x - confettiCameraX, c.y - confettiCameraY);
      ctx.rotate(c.angle);
      ctx.fillStyle = c.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, c.life / 30));
      ctx.fillRect(-c.size / 2, -c.size / 6, c.size, c.size / 3);
      ctx.restore();
    }
  }

function randomConfettiColor() {
  const colors = ['#FFD700', '#FF69B4', '#00E6FF', '#44FF44', '#FF6347', '#FFB347', '#00FFEA', '#B366FF'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// --- Replace existing showJoystick(...) with this implementation ---
/* Replace the existing showJoystick(...) implementation with this block */
function showJoystick(show) {
  try {
    if (!joystickContainer) return;

    if (show) {
      // Make visible and interactive
      joystickContainer.style.setProperty('display', 'block', 'important');
      joystickContainer.style.setProperty('pointer-events', 'auto', 'important');

      // Ensure baseRect is current (use single global updater)
      refreshBaseRect();

      if (baseRect && joystickStick && joystickBase) {
        const baseW = baseRect.width || joystickBase.offsetWidth || 120;
        const baseH = baseRect.height || joystickBase.offsetHeight || 120;
        const stickW = joystickStick.offsetWidth || joystickStick.getBoundingClientRect().width || 40;
        const stickH = joystickStick.offsetHeight || joystickStick.getBoundingClientRect().height || 40;

        // center the knob (use left/top for a stable origin; move via transform for smoothness)
        joystickStick.style.left = (baseW / 2 - stickW / 2) + 'px';
        joystickStick.style.top = (baseH / 2 - stickH / 2) + 'px';
        joystickStick.style.transform = 'translate(0px, 0px)';
        joystickStick.style.transition = 'transform 0.06s linear';
        joystickStick.style.willChange = 'transform';
      }

      joystickActive = false;
    } else {
      // Hide reliably and reset the knob
      if (joystickContainer) {
        joystickContainer.style.setProperty('display', 'none', 'important');
        joystickContainer.style.setProperty('pointer-events', 'none', 'important');
      }
      if (joystickStick) {
        joystickStick.style.transition = ''; // clear transition when hidden
        try { joystickStick.style.transform = 'translate(0px, 0px)'; } catch (e) {}
      }
      joystickActive = false;
      joystickX = 0; joystickY = 0;
    }
  } catch (err) {
    console.warn('[showJoystick] error', err);
  }
}




function refreshBaseRect() {
  if (joystickBase) baseRect = joystickBase.getBoundingClientRect();
}



// image preloader used by the init code — ensure this exists before DOMContentLoaded
// Robust preloadImages with max-wait fallback and logging
function preloadImages(manifest, onComplete) {
  const items = Array.isArray(manifest) ? manifest : [];
  const total = items.length;
  if (total === 0) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  let loaded = 0;
  let finished = false;

  // Safety timeout: proceed even if not all images load (prevents stuck loading bar)
  const MAX_WAIT_MS = 8000; // adjust as needed
  const timeoutId = setTimeout(() => {
    if (!finished) {
      finished = true;
      console.warn(`[preloadImages] timeout after ${MAX_WAIT_MS}ms — continuing with ${loaded}/${total} loaded`);
      if (typeof onComplete === 'function') onComplete();
    }
  }, MAX_WAIT_MS);

  items.forEach(({ path, assign }, idx) => {
    const img = new Image();
    img.onload = function() {
      try {
        if (typeof assign === 'function') assign(img);
      } catch (e) {
        console.warn('[preloadImages] assign callback failed for', path, e);
      }
      loaded++;
      if (!finished && loaded >= total) {
        finished = true;
        clearTimeout(timeoutId);
        if (typeof onComplete === 'function') onComplete();
      }
    };
    img.onerror = function(ev) {
      console.warn('[preloadImages] failed to load image:', path, ev);
      // still count it as loaded (we won't block startup)
      loaded++;
      if (!finished && loaded >= total) {
        finished = true;
        clearTimeout(timeoutId);
        if (typeof onComplete === 'function') onComplete();
      }
    };
    // start loading (trigger CORS errors in console if blocked)
    img.src = path;
  });
}

document.addEventListener('DOMContentLoaded',async () => {
  
  window.addEventListener('error', (ev) => {
  try { enqueueFailedLog({ url: `${backendBase()}/api/client-error`, method: 'POST', body: { message: ev.message, filename: ev.filename, lineno: ev.lineno, colno: ev.colno, stack: ev.error?.stack } }); } catch (e) {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try { const r = ev.reason || {}; enqueueFailedLog({ url: `${backendBase()}/api/client-error`, method: 'POST', body: { message: r.message || String(r), stack: r.stack || null } }); } catch (e) {}
});

async function loadStartLeaderboard() {
  try {
    if (!userToken) {
      console.warn("loadStartLeaderboard: no userToken; skipping fetch");
      return;
    }
    const url = `${backendBase()}/api/leaderboard`;
    const res = await authFetch(url, { credentials: 'include', timeoutMs: 7000 });
    if (!res.ok) {
      const text = await (res.text().catch(() => "<no body>"));
      console.error("loadStartLeaderboard: failed", res.status, res.statusText, text);
      const container = document.getElementById('start-leaderboard-container');
      if (container) container.innerHTML = `<div style="color:#b00;">Leaderboard unavailable (${res.status}).</div>`;
      return;
    }
    const leaderboard = await safeParseJson(res) || {};
    console.log("loadStartLeaderboard: received data", leaderboard);
    renderStartLeaderboard(leaderboard);
  } catch (err) {
    console.error("loadStartLeaderboard: error", err);
    const container = document.getElementById('start-leaderboard-container');
    if (container) container.innerHTML = `<div style="color:#b00;">Failed to load leaderboard.</div>`;
  }
}

async function loadUserSessions() {
  if (!userToken) {
    renderUserSessions([]); // show logged-out message / clear
    return;
  }
  try {
    const res = await authFetch(`${backendBase()}/api/my-sessions`, {
      timeoutMs: 7000,
      headers: { "Accept": "application/json" },
      credentials: 'include'
    });
    if (!res.ok) {
      console.warn('loadUserSessions failed', res.status);
      renderUserSessions([]);
      return;
    }
    const sessions = await safeParseJson(res) || [];
    renderUserSessions(sessions);
  } catch (err) {
    console.warn('loadUserSessions error', err);
    renderUserSessions([]);
  }
}

if (document.getElementById('user-sessions-container')) {
    document.getElementById('user-sessions-container').style.display = userToken ? '' : 'none';
  }

 // --- Welcome text and difficulty-cost hover/click UI ---
// Show logged in email in start screen welcome area
function showWelcomeEmail() {
    const welcomeEl = document.getElementById('welcome-user');
    const emailSpan = document.getElementById('welcome-email');
    if (userEmail && welcomeEl && emailSpan) {
      emailSpan.textContent = userEmail;
      welcomeEl.style.display = '';
    } else if (welcomeEl) {
      welcomeEl.style.display = 'none';
    }
  }


// Wire difficulty buttons to show cost on hover and click
(function wireDifficultyCostUI() {
  const costDisplay = document.getElementById('difficulty-cost-display');
  const diffBtns = document.querySelectorAll('#difficulty-selector .difficulty-btn');

  if (!diffBtns || diffBtns.length === 0) return;

  diffBtns.forEach(btn => {
    const value = btn.getAttribute('data-value');
    const cost = DIFFICULTY_CREDIT_COST[value] || 0;
    // set native title tooltip for accessibility and hover
    btn.title = `Cost: ${cost} credits`;

    // Hover: show cost
    btn.addEventListener('mouseenter', () => {
      if (costDisplay) {
        costDisplay.textContent = `Cost to start (${value.charAt(0).toUpperCase()+value.slice(1)}): ${cost} credits`;
        costDisplay.style.display = '';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (costDisplay) {
        const active = document.querySelector('#difficulty-selector .difficulty-btn.active');
        if (!active) {
          costDisplay.style.display = 'none';
        } else {
          const activeVal = active.getAttribute('data-value');
          const activeCost = DIFFICULTY_CREDIT_COST[activeVal] || 0;
          costDisplay.textContent = `Cost to start (${activeVal.charAt(0).toUpperCase()+activeVal.slice(1)}): ${activeCost} credits`;
          costDisplay.style.display = '';
        }
      }
    });

    // Click: update cost display and Start button state
    // inside wireDifficultyCostUI: replace the click handler with:
btn.addEventListener('click', () => {
  const activeVal = btn.getAttribute('data-value');
  const activeCost = DIFFICULTY_CREDIT_COST[activeVal] || 0;

  // toggle active class across buttons
  document.querySelectorAll('#difficulty-selector .difficulty-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedDifficulty = activeVal;
  window.selectedDifficulty = selectedDifficulty;

  // cost display + refresh Start button
  if (costDisplay) {
    costDisplay.textContent = `Cost to start (${activeVal.charAt(0).toUpperCase()+activeVal.slice(1)}): ${activeCost} credits`;
    costDisplay.style.display = '';
  }

  // Recompute enable/disable and reload leaderboard for new difficulty
  setCredits(userCredits);
  updateStartButtonUI();
  if (typeof loadStartLeaderboard === 'function') loadStartLeaderboard();
});
  });
})();

function formatSessionShort(sess) {
  const dt = sess.startTime ? new Date(sess.startTime) : null;
  const when = dt ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : 'Unknown';
  const duration = sess.elapsedSeconds ? `${sess.elapsedSeconds}s` : (sess.endTime ? '0s' : 'In progress');
  const status = sess.isWin ? 'WIN' : (sess.endedEarly ? 'ENDED' : 'LOSS');
  const difficulty = sess.difficulty ? sess.difficulty.charAt(0).toUpperCase() + sess.difficulty.slice(1) : 'Normal';
  return { when, duration, status, difficulty, chests: (sess.chestsCollected||0) + '/' + (sess.totalChests||0), device: sess.deviceType || 'unknown' };
}

// Replace the existing renderUserSessions function with this implementation
function renderUserSessions(sessions) {
  const panel = document.getElementById('user-sessions-container');
  const container = document.getElementById('user-sessions-list');
  const mobileList = document.getElementById('mobile-history-list');

  // Ensure panel visibility only when logged in
  if (panel) panel.style.display = userToken ? 'block' : 'none';
  if (!container) return;

  // If not logged in or no sessions, show empty state (mobile & desktop)
  if (!userToken || !sessions || sessions.length === 0) {
    container.innerHTML = `<div style="color:#9fb7c6;padding:8px;">No sessions yet.</div>`;
    if (mobileList) mobileList.innerHTML = `<div style="color:#222; padding:8px;">No sessions yet.</div>`;
    return;
  }

  // Render sessions (latest first)
  container.innerHTML = '';
  sessions.forEach(s => {
    const meta = formatSessionShort(s);
    const statusClass = s.isWin ? 'win' : 'loss';

    const el = document.createElement('div');
    el.className = 'session-item';
    el.innerHTML = `
      <div class="session-date">${meta.when}</div>
      <div class="session-difficulty">${meta.difficulty}</div>
      <div class="session-meta">
        ${meta.chests} • ${meta.duration} • ${meta.device} • <span class="session-status ${statusClass}">${meta.status}</span>
      </div>
    `;
    container.appendChild(el);
  });

  // Mobile list (same content but compact)
  if (mobileList) {
    mobileList.innerHTML = '';
    sessions.forEach(s => {
      const meta = formatSessionShort(s);
      const statusClass = s.isWin ? 'win' : 'loss';
      const el = document.createElement('div');
      el.className = 'session-item';
      el.style.marginBottom = '10px';
      el.innerHTML = `
        <div class="session-date">${meta.when}</div>
        <div class="session-difficulty">${meta.difficulty}</div>
        <div class="session-meta">
          ${meta.chests} • ${meta.duration} • ${meta.device} • <span class="session-status ${statusClass}">${meta.status}</span>
        </div>
      `;
      mobileList.appendChild(el);
    });
  }
}

// Wire mobile history button / close
(function wireMobileHistoryUI(){
  const mobileBtn = document.getElementById('mobile-history-btn');
  const mobileModal = document.getElementById('mobile-history-modal');
  const mobileClose = document.getElementById('close-mobile-history');

  if (mobileBtn && mobileModal) {
    mobileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      loadUserSessions(); // refresh before showing
      mobileModal.classList.remove('hidden');
      mobileModal.style.display = 'flex';
    });
  }
  if (mobileClose && mobileModal) {
    mobileClose.addEventListener('click', (e) => {
      e.preventDefault();
      mobileModal.classList.add('hidden');
      mobileModal.style.display = 'none';
    });
    mobileModal.addEventListener('click', (ev) => {
      if (ev.target === mobileModal) {
        mobileModal.classList.add('hidden');
        mobileModal.style.display = 'none';
      }
    });
  }
})();

// REPLACE the existing renderStartLeaderboard function with this implementation
function renderStartLeaderboard(leaderboard) {
  const container = document.getElementById('start-leaderboard-container');
  if (!container) return;
  container.innerHTML = ''; // clear first

  const diff = selectedDifficulty || 'normal';
  const entries = (leaderboard && leaderboard[diff]) ? leaderboard[diff] : [];

  // Header
  let out = `<h2 style="color:#0078d7;margin-top:0;">${diff.charAt(0).toUpperCase() + diff.slice(1)} Difficulty Leaderboard</h2>`;

  if (!entries || entries.length === 0) {
    out += `<div style="color:#444;">No winners yet for ${diff}!</div>`;
    container.innerHTML = out;
    window.lastLeaderboard = leaderboard || {};
    return;
  }

  function getCrownSVG(rank) {
    const S = 36;
    const R = S / 2;
    const emojiFontSize = 20;
    if (rank === 0) {
      return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" style="vertical-align:middle;flex:0 0 ${S}px;">
        <circle cx="${R}" cy="${R}" r="${R}" fill="#FFD700"/><text x="50%" y="58%" text-anchor="middle" font-size="${emojiFontSize}" dy=".35em">👑</text>
      </svg>`;
    } else if (rank === 1) {
      return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" style="vertical-align:middle;flex:0 0 ${S}px;">
        <circle cx="${R}" cy="${R}" r="${R}" fill="#C0C0C0"/><text x="50%" y="58%" text-anchor="middle" font-size="${emojiFontSize}" dy=".35em">👑</text>
      </svg>`;
    } else if (rank === 2) {
      return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" style="vertical-align:middle;flex:0 0 ${S}px;">
        <circle cx="${R}" cy="${R}" r="${R}" fill="#cd7f32"/><text x="50%" y="58%" text-anchor="middle" font-size="${emojiFontSize}" dy=".35em">👑</text>
      </svg>`;
    } else {
      return `<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:#eee;color:#222;font-weight:700;font-size:16px;">${rank+1}</span>`;
    }
  }

  out += entries.map((entry, i) => {
    const icon = getCrownSVG(i);
    const email = (entry && entry.user && entry.user.email) ? entry.user.email : 'unknown';
    const elapsed = (entry && typeof entry.elapsedSeconds !== 'undefined') ? entry.elapsedSeconds : '--';
    const seaweeds = (entry && typeof entry.seaweedsCollected !== 'undefined') ? entry.seaweedsCollected : '--';
    const score = (entry && typeof entry.score !== 'undefined') ? entry.score : '--';

    // Structured meta markup (allows CSS to align/pad consistently)
    const metaHtml = `
      <div class="meta" aria-hidden="true">
        <div class="meta-item"><span class="label">Time</span><span class="value">${elapsed} s</span></div>
        <div class="meta-item"><span class="label">Seaweeds</span><span class="value">${seaweeds}</span></div>
        <div class="meta-item"><span class="label">Score</span><span class="value">${score}</span></div>
      </div>
    `;

    return `
      <div class="leaderboard-entry" role="listitem" aria-label="rank-${i+1}">
        <div class="icon" aria-hidden="true">${icon}</div>
        <div class="entry-card" style="flex:1;">
          <div class="info">
            <div class="name" title="${email}">${email}</div>
            ${metaHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = out;
  window.lastLeaderboard = leaderboard || {};
}


  preloadImages(imageManifest, function() {
    startScreen = document.getElementById('start-screen');
    gameScreen = document.getElementById('game-screen');
    if (gameScreen) {
  // Make #game-screen a stacking context for absolute children
  gameScreen.style.position = 'relative';
}
    completionPopup = document.getElementById('completion-popup');
    quitResultPopup = document.getElementById('quit-result-popup');
    startButton = document.getElementById('start-button');
if (startButton) {
  startButton.type = 'button';
 
  joystickContainer = document.getElementById('joystick-container');
joystickBase = document.getElementById('joystick-base');
joystickStick = document.getElementById('joystick-stick');
refreshBaseRect();

(function installSafeStartWrapper() {
  if (window.__safeStartWrapperInstalled) return;
  window.__safeStartWrapperInstalled = true;

  let localInFlight = false;
  const FALLBACK_WAIT_MS = 12000; // wait for gameActive to appear

  function hideTransientControls() {
    try {
      showJoystick(false);
      setHUDVisible(false);
      const hudToggle = document.getElementById('toggle-hud-button');
      if (hudToggle) hudToggle.style.display = 'none';
    } catch (err) { console.warn('hideTransientControls error', err); }
  }

  async function safeStartHandler(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    if (localInFlight) {
      console.warn('[safeStartHandler] ignored: localInFlight');
      return;
    }
    localInFlight = true;

    // IMPORTANT: do NOT set startRequestInFlight here - handleStartButtonClick owns that flag
    const btn = document.getElementById('start-button') || startButton;
    const originalLabel = btn ? btn.textContent : 'Start';

    try {
      if (btn) {
        btn.disabled = true;
        btn.style.pointerEvents = 'none';
        btn.textContent = 'Starting...';
      }

      hideTransientControls();

      // call existing start logic (it will set startRequestInFlight)
      let startPromise;
      try {
        startPromise = Promise.resolve().then(() => {
          console.debug('[safeStartHandler] invoking handleStartButtonClick()');
          return typeof handleStartButtonClick === 'function' ? handleStartButtonClick() : Promise.reject(new Error('handleStartButtonClick not defined'));
        });
      } catch (callErr) {
        startPromise = Promise.reject(callErr);
      }

      const waitForGameActive = new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          if (window.gameActive) return resolve(true);
          if (Date.now() - start > FALLBACK_WAIT_MS) return resolve(false);
          setTimeout(check, 150);
        };
        check();
      });

      await Promise.allSettled([startPromise, waitForGameActive]);

      if (window.gameActive) {
        console.info('[safeStartHandler] gameActive true -> leaving UI to game logic');
        return;
      } else {
        // start didn't transition to a running game in time -> restore
        if (btn) {
          btn.disabled = false;
          btn.style.pointerEvents = '';
          btn.textContent = originalLabel;
        }
        hideTransientControls();
      }

    } catch (err) {
      console.error('[safeStartHandler] error', err);
      if (btn) {
        btn.disabled = false;
        btn.style.pointerEvents = '';
        btn.textContent = originalLabel;
      }
    } finally {
      localInFlight = false;
      // do NOT modify startRequestInFlight here
    }
  }

  // Attach both direct and delegated listeners so we never miss a click
  const directBtn = document.getElementById('start-button');
  if (directBtn) {
    directBtn.addEventListener('click', (ev) => { safeStartHandler(ev).catch(console.error); });
  }
  // Delegated listener (guarantees we catch the click even if button is created later)
  document.addEventListener('click', (ev) => {
    try {
      const t = ev.target;
      if (!t) return;
      // matches start button by id or a button inside an element with that id
      if (t.id === 'start-button' || (t.closest && t.closest('#start-button'))) {
        safeStartHandler(ev).catch(console.error);
      }
    } catch (err) {
      console.error('[safeStartWrapper delegated listener] error', err);
    }
  });
})();
  // Ensure label + enabled state reflect current login/credits on load
  updateStartButtonUI();
    refreshFeedbackButton();
}
    completionPlayAgainButton = document.getElementById('completion-play-again-button');
    completionReturnToStartButton = document.getElementById('completion-return-to-start-button');
    quitPlayAgainButton = document.getElementById('quit-play-again-button');
    quitReturnToStartButton = document.getElementById('quit-return-to-start-button');

    if (completionPlayAgainButton) {
      completionPlayAgainButton.addEventListener('click', () => {
  playAgainAfterDeath = true;
  loadStartLeaderboard();
  handleStartButtonClick();
});
    }
    if (quitPlayAgainButton) {
quitPlayAgainButton.addEventListener('click', () => {
  playAgainAfterDeath = true;
  loadStartLeaderboard();
  handleStartButtonClick();
});
    }
    if (completionReturnToStartButton) {
      completionReturnToStartButton.addEventListener('click', () => {
        showScreen(startScreen);
        loadStartLeaderboard();
        loadUserSessions();
        showWelcomeEmail();
    
        // Refresh Start button state/credits — defensive fix to ensure button becomes enabled
        // if the user changed difficulty or their credits were updated during gameplay.
        startRequestInFlight = false; // guard in case it was left set
        setCredits(userCredits);
        updateStartButtonUI();
        refreshFeedbackButton();
      });
    }
    if (quitReturnToStartButton) {
      quitReturnToStartButton.addEventListener('click', () => {
        showScreen(startScreen);
        loadStartLeaderboard();
        loadUserSessions();
        showWelcomeEmail();
    
        // Refresh Start button state and clear any stuck in-flight flag
        startRequestInFlight = false;
        setCredits(userCredits);
        updateStartButtonUI();
        refreshFeedbackButton();
      });
    }

    endGameButton = document.getElementById('end-game-button');
    scoreValue = document.getElementById('score-value');
    treasuresCollected = document.getElementById('treasures-collected');
    totalTreasures = document.getElementById('total-treasures');
    finalScore = document.getElementById('final-score');
    quitFinalScore = document.getElementById('quit-final-score');
    quitTreasuresCollected = document.getElementById('quit-treasures-collected');
    timerValue = document.getElementById('timer-value');
    timeRemaining = document.getElementById('time-remaining');
    completionTitle = document.getElementById('completion-title');
    completionMessage = document.getElementById('completion-message');
    quitTitle = document.getElementById('quit-title');
    quitMessage = document.getElementById('quit-message');
    let gameInfo = document.querySelector('#game-screen .game-info');
     let toggleHudBtn = document.querySelector('#game-screen #toggle-hud-button');
 
    {
  const hudToggle = document.getElementById('toggle-hud-button');
  if (hudToggle) {
    // ensure it's a button (safe) and visible above canvas
    hudToggle.type = hudToggle.type || 'button';
    hudToggle.style.setProperty('z-index', '1600', 'important');

    // attach a single handler that toggles the HUD
    hudToggle.addEventListener('click', () => {
      setHUDVisible(!hudVisible);
    });
  }
}
    // restore persisted credits (if any) so UI reflects them immediately
const persistedCredits = localStorage.getItem('credits');
if (persistedCredits !== null && typeof setCredits === 'function') {
  setCredits(Number(persistedCredits));
  // ensure buttons and feedback reflect this restored state
  if (typeof updateStartButtonUI === 'function') updateStartButtonUI();
  if (typeof refreshFeedbackButton === 'function') refreshFeedbackButton();
}

// Show welcome if we already have an email
if (typeof showWelcomeEmail === 'function') showWelcomeEmail();

// If there's a token we assume the user is logged in — show the start screen and refresh panels.
// Otherwise show the auth screen.
if (userToken) {
  if (typeof loadStartLeaderboard === 'function') loadStartLeaderboard();
  if (typeof loadUserSessions === 'function') loadUserSessions();
  if (startScreen) {
    showScreen(startScreen);
  } else {
    showScreen(document.getElementById('start-screen'));
  }
} else {
  showScreen(document.getElementById('auth-screen'));
}


    // Feedback UI wiring
    // Improvised wireFeedbackUI — paste this inside your DOMContentLoaded init (replace any existing wireFeedbackUI)
/* Replace the existing wireFeedbackUI() (inside DOMContentLoaded) with this version.
   This keeps the same behavior but renders compact stars using CSS classes
   instead of the previous large inline styles. */
   (function wireFeedbackUI() {
    const sendBtn = document.getElementById('send-feedback-btn');
    const feedbackScreen = document.getElementById('feedback-screen');
    const feedbackStars = document.getElementById('feedback-stars');
    const feedbackText = document.getElementById('feedback-text');
    const submitBtn = document.getElementById('feedback-submit-btn');
    const thankyou = document.getElementById('feedback-thankyou');
    const returnBtn = document.getElementById('feedback-return-btn');
  
    if (!sendBtn || !feedbackScreen || !feedbackStars) return;
  
    // Scoped rating state (avoid global selectedRating)
    let rating = 0;
  
    function renderStars() {
      feedbackStars.innerHTML = ''; // clear
      // optional small accessible label
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = 'Feedback rating';
      feedbackStars.appendChild(sr);
  
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'feedback-star' + (i <= rating ? ' selected' : '');
        s.setAttribute('aria-label', `${i} star${i>1?'s':''}`);
        s.setAttribute('data-star', String(i));
        s.innerText = i <= rating ? '★' : '☆';
        // keyboard accessible handlers
        s.addEventListener('click', () => { rating = i; renderStars(); });
        s.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            rating = i;
            renderStars();
          }
        });
        feedbackStars.appendChild(s);
      }
    }
    renderStars();
  
    // Show feedback modal
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      rating = 0;
      renderStars();
      if (feedbackText) feedbackText.value = '';
      if (thankyou) thankyou.classList.add('hidden');
      if (submitBtn) {
        submitBtn.style.display = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
      showScreen(feedbackScreen);
    });
  
    // Prevent double submits
    let sendInFlight = false;
  
    async function submitFeedback() {
      if (sendInFlight) return;
      const text = (feedbackText && feedbackText.value || '').trim();
  
      // Require login for feedback (server requires auth)
      if (!userToken) {
        alert('Please log in to send feedback.');
        // show login screen so they can log in quickly
        showScreen(document.getElementById('auth-screen'));
        return;
      }
  
      console.info('[feedback] submit requested', { rating, textLen: text.length, hasToken: !!userToken });
  
      // Require at least rating OR text (adjust as you prefer)
      if (!rating && !text) {
        alert('Please give a rating and/or write some feedback.');
        return;
      }
  
      const payload = {
        rating: rating || 0,
        text,
        email: userEmail || null,
        difficulty: selectedDifficulty || 'normal'
      };
  
      sendInFlight = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
      }
  
      try {
        // Use the centralized helper — non-blocking behavior is handled below
        await sendFeedbackToServer(payload);
  
        // Success UI
        if (thankyou) thankyou.classList.remove('hidden');
        if (submitBtn) submitBtn.style.display = 'none';
      } catch (err) {
        console.warn('[feedback] submit failed (non-blocking):', err);
        // Best-effort: persist to localStorage for retry later
        try {
          const pending = JSON.parse(localStorage.getItem('pendingFeedback') || '[]');
          pending.push({ payload, createdAt: Date.now() });
          localStorage.setItem('pendingFeedback', JSON.stringify(pending));
        } catch (e) {
          // ignore storage errors
        }
        // Still show thank-you so user isn't blocked
        if (thankyou) thankyou.classList.remove('hidden');
        if (submitBtn) submitBtn.style.display = 'none';
      } finally {
        sendInFlight = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit';
        }
      }
    }
  
    if (submitBtn) submitBtn.addEventListener('click', (e) => { e.preventDefault(); submitFeedback(); });
  
    if (thankyou) thankyou.addEventListener('click', () => { showScreen(startScreen); });
  
    if (returnBtn) {
      returnBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showScreen(startScreen);
      });
    }
  })();


    // Auth form elements
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const showRegister = document.getElementById('show-register');
const showLogin = document.getElementById('show-login');
const registerSuccessPopup = document.getElementById('register-success-popup');
const registerBtn = document.getElementById('register-btn');
const registerError = document.getElementById('register-error');

// Show register form
if (showRegister) {
  showRegister.onclick = () => {
    if (loginForm) loginForm.classList.add('hidden');
    if (registerForm) registerForm.classList.remove('hidden');
    if (registerError) registerError.textContent = '';

    // Guarded assignments (optional chaining can't be used as an assignment target)
    const regEmailEl = document.getElementById('register-email');
    if (regEmailEl) regEmailEl.value = '';
    const regPassEl = document.getElementById('register-password');
    if (regPassEl) regPassEl.value = '';
    const regConfirmEl = document.getElementById('register-confirm');
    if (regConfirmEl) regConfirmEl.value = '';
  };
}
// Back to login screen
if (showLogin) {
  showLogin.onclick = () => {
    if (registerForm) registerForm.classList.add('hidden');
    if (loginForm) loginForm.classList.remove('hidden');
    if (registerError) registerError.textContent = '';
  };
}

// Register logic
if (registerBtn) {
  registerBtn.onclick = async () => {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    if (!email || !password || !confirm) {
      if (registerError) registerError.textContent = "All fields are required!";
      return;
    }
    if (password !== confirm) {
      if (registerError) registerError.textContent = "Passwords do not match!";
      return;
    }
    try {
      const res = await authFetch(`${backendBase()}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        timeoutMs: 7000
      });
      const data = await safeParseJson(res) || {};
      if (data.ok) {
        if (registerForm) registerForm.classList.add('hidden');
        if (registerSuccessPopup) registerSuccessPopup.classList.remove('hidden');
      } else {
        if (registerError) registerError.textContent = data.error || "Registration error";
      }
    } catch (e) {
      if (registerError) registerError.textContent = 'Registration error';
    }
  };
}

// Hide registration success popup and show login
if (registerSuccessPopup) {
  registerSuccessPopup.onclick = () => {
    registerSuccessPopup.classList.add('hidden');
    if (loginForm) loginForm.classList.remove('hidden');
  };
}

// Replace existing setHUDVisible(visible) with this improved, mobile-compact version
function setHUDVisible(visible) {
  const hudEls = document.querySelectorAll('#game-screen .game-info');

  hudEls.forEach(el => {
    try {
      // Keep fixed top-center positioning
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('top', '12px', 'important');
      el.style.setProperty('left', '50%', 'important');
      el.style.setProperty('transform', 'translateX(-50%)', 'important');
      el.style.setProperty('z-index', '1500', 'important');

      // Use inline-flex and prevent wrapping
      el.style.setProperty('display', 'inline-flex', 'important');
      el.style.setProperty('flex-wrap', 'nowrap', 'important');
      el.style.setProperty('white-space', 'nowrap', 'important');

      // Default spacing/padding for desktop
      el.style.setProperty('gap', '10px', 'important');
      el.style.setProperty('padding', '6px 10px', 'important');
      el.style.setProperty('font-size', '1.0em', 'important');
      el.style.setProperty('align-items', 'center', 'important');
    } catch (e) {
      // ignore style application failures on some browsers
    }

    // Show/hide while keeping layout stable
    if (visible) {
      el.style.setProperty('visibility', 'visible', 'important');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('display', 'inline-flex', 'important');
    } else {
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('display', 'none', 'important');
    }
  });

  hudVisible = !!visible;

  // Make HUD tighter on mobile to avoid spanning the whole top bar
  if (typeof isMobile !== 'undefined' && isMobile) {
    document.querySelectorAll('#game-screen .game-info').forEach(el => {
      try {
        el.style.setProperty('gap', '6px', 'important');
        el.style.setProperty('padding', '4px 8px', 'important');
        el.style.setProperty('font-size', '0.85em', 'important');
      } catch (e) {}
    });
    // Shrink individual HUD item spacing
    document.querySelectorAll('#game-screen .game-info .score, #game-screen .game-info .treasures, #game-screen .game-info .timer').forEach(item => {
      try {
        item.style.setProperty('padding', '4px 6px', 'important');
        item.style.setProperty('font-size', '0.9em', 'important');
      } catch (e) {}
    });
    // Make end-game button smaller on mobile so it doesn't force the HUD wide
    document.querySelectorAll('#game-screen #end-game-button').forEach(btn => {
      try {
        btn.style.setProperty('padding', '5px 8px', 'important');
        btn.style.setProperty('min-width', '48px', 'important');
        btn.style.setProperty('font-size', '0.85em', 'important');
      } catch (e) {}
    });
  }

  // Update toggle button(s) visibility. Only show toggle when game is actually running.
  document.querySelectorAll('#game-screen #toggle-hud-button').forEach(btn => {
    try {
      btn.textContent = hudVisible ? 'Hide HUD' : 'Show HUD';
      btn.style.setProperty('z-index', '1600', 'important');

      if (window.gameActive && hudVisible) {
        btn.style.setProperty('display', 'block', 'important');
        btn.style.setProperty('pointer-events', 'auto', 'important');
        btn.style.removeProperty('visibility');
        btn.style.removeProperty('opacity');
      } else {
        btn.style.setProperty('display', 'none', 'important');
        btn.style.setProperty('pointer-events', 'none', 'important');
      }
    } catch (e) {
      // ignore
    }
  });

  // Also ensure the end-game button remains stable
  const endBtn = document.getElementById('end-game-button');
  if (endBtn) {
    try {
      endBtn.style.setProperty('flex', '0 0 auto', 'important');
      endBtn.style.setProperty('min-width', '62px', 'important');
      endBtn.style.setProperty('white-space', 'nowrap', 'important');
    } catch (e) {}
  }
}

  
    const showReset = document.getElementById('show-reset');
const resetPasswordPopup = document.getElementById('reset-password-popup');
const resetSuccessPopup = document.getElementById('reset-success-popup');
const resetPasswordBtn = document.getElementById('reset-password-btn');
const resetError = document.getElementById('reset-error');



if (showReset) {
  showReset.onclick = () => {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) authScreen.classList.remove('hidden');
    if (loginForm) loginForm.classList.add('hidden');
    if (resetPasswordPopup) resetPasswordPopup.classList.remove('hidden');
    if (resetError) resetError.textContent = '';

    // Guarded assignments
    const resetEmail = document.getElementById('reset-email');
    if (resetEmail) resetEmail.value = '';
    const resetNew = document.getElementById('reset-new-password');
    if (resetNew) resetNew.value = '';
    const resetConfirm = document.getElementById('reset-confirm-password');
    if (resetConfirm) resetConfirm.value = '';
  };
}

// Replace existing resetPasswordBtn.onclick block with this guarded version
if (resetPasswordBtn) {
  resetPasswordBtn.onclick = async () => {
    const email = document.getElementById('reset-email').value;
    const newPassword = document.getElementById('reset-new-password').value;
    const confirmPassword = document.getElementById('reset-confirm-password').value;
    if (!email || !newPassword || !confirmPassword) {
      if (resetError) resetError.textContent = "All fields are required!";
      return;
    }
    if (newPassword !== confirmPassword) {
      if (resetError) resetError.textContent = "Passwords do not match!";
      return;
    }
    try {
      const res = await authFetch(`${backendBase()}/api/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newPassword }),
        timeoutMs: 7000
      });
      const data = await safeParseJson(res) || {};
      if (data.ok) {
        if (resetPasswordPopup) resetPasswordPopup.classList.add('hidden');
        if (resetSuccessPopup) resetSuccessPopup.classList.remove('hidden');
      } else {
        if (resetError) resetError.textContent = data.error || "Password reset error";
      }
    } catch (e) {
      if (resetError) resetError.textContent = 'Password reset error';
    }
  };
}

if (resetSuccessPopup) {
  resetSuccessPopup.onclick = () => {
    resetSuccessPopup.classList.add('hidden');
    if (loginForm) loginForm.classList.remove('hidden');
  };
}
// Replace the existing resetReturnBtn.onclick handler with this safe, guarded version
const resetReturnBtn = document.getElementById('reset-return-btn');
if (resetReturnBtn) {
  resetReturnBtn.onclick = () => {
    if (resetPasswordPopup) resetPasswordPopup.classList.add('hidden');
    if (loginForm) loginForm.classList.remove('hidden');

    // Optionally clear fields and errors (guarded so missing elements won't break anything)
    const resetEmail = document.getElementById('reset-email');
    if (resetEmail) resetEmail.value = '';
    const resetNewPassword = document.getElementById('reset-new-password');
    if (resetNewPassword) resetNewPassword.value = '';
    const resetConfirmPassword = document.getElementById('reset-confirm-password');
    if (resetConfirmPassword) resetConfirmPassword.value = '';
    if (resetError) resetError.textContent = '';
  };
}
// Replace existing showScreen(...) with this robust version
function showScreen(target) {
  // Accept either an element or an id string
  const targetEl = (typeof target === 'string') ? document.getElementById(target) : target;
  if (!targetEl) {
    console.warn('[showScreen] target not found:', target);
    return;
  }

  const knownIds = ['auth-screen', 'start-screen', 'game-screen', 'completion-popup', 'quit-result-popup', 'feedback-screen'];
  // Force-hide all known screens (both class and inline display) to override CSS rules
  for (const id of knownIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    // Add the hidden class
    el.classList.add('hidden');
    // Force style to hide if any stylesheet sets it visible
    try {
      el.style.setProperty('display', 'none', 'important');
    } catch (e) {
      // ignore if style setting fails in odd environments
    }
  }

  // Now show the requested target element
  targetEl.classList.remove('hidden');
  try {
    // Remove any inline "display:none" that we may have set above
    targetEl.style.removeProperty('display');

    // Ensure sensible default display so the element is actually visible.
    // Use 'flex' for screens (your layout uses flex), otherwise fall back to 'block'.
    if (targetEl.classList.contains('screen') || targetEl.id === 'start-screen' || targetEl.id === 'game-screen') {
      targetEl.style.setProperty('display', 'flex', 'important');
      // Make sure game-screen sits above overlays
      if (targetEl.id === 'game-screen') {
        targetEl.style.setProperty('z-index', '2000', 'important');
      }
    } else {
      targetEl.style.setProperty('display', 'block', 'important');
    }
  } catch (e) {
    // No big deal if inline style doesn't apply; the class toggle should suffice
    console.warn('[showScreen] failed to set inline styles for', targetEl.id, e);
  }

  // HUD / joystick visibility: only visible while in game screen
  if (targetEl.id === 'game-screen') {
    // While the client is in pre-game countdown (game not yet active),
    // ensure the HUD and the HUD toggle button remain hidden.
    if (!window.gameActive) {
      setHUDVisible(false);
      // Hide the toggle button reliably (use inline !important)
      document.querySelectorAll('#game-screen #toggle-hud-button').forEach(btn => {
        try { btn.style.setProperty('display', 'none', 'important'); } catch (e) {}
      });
    } else {
      // Game is running — restore HUD visibility based on hudVisible flag
      setHUDVisible(!!hudVisible);
      document.querySelectorAll('#game-screen #toggle-hud-button').forEach(btn => {
        try { btn.style.setProperty('display', 'block', 'important'); } catch (e) {}
      });
    }

    // Show joystick only when on mobile and gameActive
    if (typeof isMobile !== 'undefined' && isMobile && window.gameActive) {
      showJoystick(true);
    } else {
      showJoystick(false);
    }
  } else {
    setHUDVisible(false);
    showJoystick(false);
  }

  console.debug('[showScreen] switched to', targetEl.id);
}


  const loginBtn = document.getElementById('login-btn');
if (loginBtn) {
  loginBtn.onclick = async () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    try {
      const res = await authFetch(`${backendBase()}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        timeoutMs: 7000
      });
      const data = await safeParseJson(res) || {};
      if (data.ok) {
        userToken = data.token;
        userEmail = data.email;
        try {
          localStorage.setItem('token', data.token);
          localStorage.setItem('email', data.email || '');
          localStorage.setItem('credits', String(data.credits || 0));
          if (typeof data.id !== 'undefined') localStorage.setItem('adminId', String(data.id));
          if (typeof data.isAdmin !== 'undefined') localStorage.setItem('isAdmin', data.isAdmin ? '1' : '0');
        } catch (e) {
          console.warn('Failed to set localStorage during login:', e);
        }
        if (typeof data.credits !== "undefined") setCredits(data.credits);
        updateStartButtonUI();
        refreshFeedbackButton();
        showScreen(startScreen);
        loadStartLeaderboard();
        await loadUserSessions();
        showWelcomeEmail();

        // Fetch game config best-effort
        try {
          const cfgRes = await authFetch(`${backendBase()}/api/game-config?difficulty=${encodeURIComponent(selectedDifficulty)}`, { headers: { "Accept": "application/json" }, timeoutMs: 7000 });
          if (cfgRes && cfgRes.ok) {
            GAME_CONFIG = await safeParseJson(cfgRes) || { ...DEFAULT_GAME_CONFIG };
          } else {
            GAME_CONFIG = { ...DEFAULT_GAME_CONFIG };
          }
        } catch (err) {
          console.warn('fetch game config failed, using defaults', err);
          GAME_CONFIG = { ...DEFAULT_GAME_CONFIG };
        }

        customPattern = GAME_CONFIG.mazePattern;
        TOTAL_TREASURES = GAME_CONFIG.totalTreasures;
        SEAWEED_COUNT = GAME_CONFIG.totalSeaweeds;
        BUBBLE_COUNT = GAME_CONFIG.totalBubbles;
        NUM_MINES = GAME_CONFIG.totalMines;
        GAME_TIME_SECONDS = GAME_CONFIG.gameTimeSeconds;
      } else {
        const authErr = document.getElementById('auth-error');
        if (authErr) authErr.textContent = data.error || 'Login error';
      }
    } catch (e) {
      const authErr = document.getElementById('auth-error');
      if (authErr) authErr.textContent = 'Login error';
    }
  };
}
  const feedbackReturnBtn = document.getElementById('feedback-return-btn');
if (feedbackReturnBtn) {
  feedbackReturnBtn.type = 'button'; // safe for forms
  feedbackReturnBtn.onclick = (e) => {
    e.preventDefault(); // in case it's inside a form
    // Reset feedback UI
    const thankEl = document.getElementById('feedback-thankyou');
    if (thankEl && thankEl.classList) thankEl.classList.add('hidden');
    const submitBtn = document.getElementById('feedback-submit-btn');
    if (submitBtn) submitBtn.style.display = '';
    // Go back to start screen using the variable, not re-querying
    showScreen(startScreen);
  };
}
// Replace existing single-button logout binding with this centralized handler
const logoutBtn = document.getElementById('logout-btn');
const startLogoutBtn = document.getElementById('start-logout-btn');

function doLogout() {
  // Clear in-memory
  userToken = null;
  userEmail = null;
  sessionId = null;
  // Clear persisted auth and credits
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('email');
    localStorage.removeItem('adminId');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('credits');
  } catch (e) {
    console.warn('Failed to clear localStorage on logout', e);
  }
  // Reset UI state
  setCredits(null);
  renderUserSessions([]);
  showWelcomeEmail(); // hides welcome if no email
  updateStartButtonUI();
  refreshFeedbackButton();
  // Show auth screen
  showScreen(document.getElementById('auth-screen'));
  try {
    if (preGameInterval) { clearInterval(preGameInterval); preGameInterval = null; }
    if (timeInterval) { clearInterval(timeInterval); timeInterval = null; }
    if (creditsCountdownInterval) { clearInterval(creditsCountdownInterval); creditsCountdownInterval = null; }
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  } catch (e) { /* ignore */ }
}

// Attach the same implementation to both possible logout buttons (auth and start screens)
if (logoutBtn) logoutBtn.onclick = doLogout;
if (startLogoutBtn) startLogoutBtn.onclick = doLogout;
    

        canvas = document.getElementById('game-canvas');

    // Detect mobile/touch first so viewport sizing uses the correct branch
    function detectMobile() {
      // Consider device "mobile" / touch-capable if the platform supports touch.
      return ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
             /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent);
    }
    isMobile = detectMobile();

    // Now update canvas/viewport sizing using the determined isMobile
    updateViewportSize();

    // Ensure joystick is hidden on initial load (even if CSS would show it)
    showJoystick(false);

    // Finally get the drawing context
    if (canvas && canvas.getContext) {
      try {
        ctx = canvas.getContext('2d');
      } catch (e) {
        console.error('[init] getContext failed', e);
        ctx = null;
      }
    } else {
      ctx = null;
    }
    

   



if (( 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ) &&
    joystickContainer && joystickBase && joystickStick) {

  joystickContainer.style.pointerEvents = 'auto';
  refreshBaseRect(); // set initial rect
  const maxDist = 40;

  // keep rect current
  window.addEventListener('resize', refreshBaseRect);

  joystickStick.addEventListener('touchstart', function(e) {
    e.preventDefault();
    joystickActive = true;
    refreshBaseRect();
  }, { passive: false });

  window.addEventListener('touchend', function(e) {
    joystickActive = false;
    joystickX = 0; joystickY = 0;
    if (baseRect && joystickStick) {
      joystickStick.style.left = (baseRect.width/2 - joystickStick.offsetWidth/2) + 'px';
      joystickStick.style.top = (baseRect.height/2 - joystickStick.offsetHeight/2) + 'px';
    }
  }, { passive: true });

  window.addEventListener('touchmove', function(e) {
    if (!joystickActive || !baseRect) return;
    e.preventDefault();
    const touch = e.touches[0];
    const centerX = baseRect.left + baseRect.width / 2;
    const centerY = baseRect.top + baseRect.height / 2;
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    let dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > maxDist) {
      dx = dx * maxDist / dist;
      dy = dy * maxDist / dist;
    }
    joystickX = dx / maxDist;
    joystickY = dy / maxDist;
    joystickStick.style.left = (baseRect.width/2 - joystickStick.offsetWidth/2 + dx) + 'px';
    joystickStick.style.top = (baseRect.height/2 - joystickStick.offsetHeight/2 + dy) + 'px';
  }, { passive: false });

  // treat touching the base as equivalent to touching the stick
  joystickBase.addEventListener('touchstart', function(e) {
    e.preventDefault();
    joystickActive = true;
    refreshBaseRect();
  }, { passive: false });

  // handle canceled touches
  window.addEventListener('touchcancel', function(e) {
    joystickActive = false;
    joystickX = 0; joystickY = 0;
    if (baseRect && joystickStick) {
      joystickStick.style.left = (baseRect.width/2 - joystickStick.offsetWidth/2) + 'px';
      joystickStick.style.top = (baseRect.height/2 - joystickStick.offsetHeight/2) + 'px';
    }
  }, { passive: true });
}


   
   
    

  /* 6) Guard the Start Game button flow */
// === REPLACE the existing handleStartButtonClick() with this version ===

/**
 * Wait helper: poll until window.gameActive becomes true (or timeout).
 * Returns true if gameActive became true, false on timeout.
 */
function waitForGameActive(timeoutMs = 12000) {
  return new Promise(resolve => {
    const start = Date.now();
    (function check() {
      if (window.gameActive) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(check, 120);
    })();
  });
}

async function handleStartButtonClick() {
  console.debug('[handleStartButtonClick] called', {
    selectedDifficulty,
    userTokenExists: !!userToken,
    userEmail,
    userCredits,
    startRequestInFlight
  });
  
  const cost = DIFFICULTY_CREDIT_COST[selectedDifficulty] || 10;
  if (typeof userCredits === 'number' && userCredits < cost) {
    alert(`Not enough credits (${userCredits}) for ${selectedDifficulty}. You need ${cost} credits.`);
    return;
  }

   if (startRequestInFlight) {
    console.warn('[start] ignored: already in-flight');
    return;
  }
  startRequestInFlight = true;
  updateStartButtonUI();
  console.info('[start] startRequestInFlight set -> starting flow', {
    difficulty: selectedDifficulty,
    userEmail,
    hasToken: !!userToken,
    userCredits
  });

  const startBtn = startButton || document.getElementById('start-button');
  const backupLabel = startBtn ? startBtn.textContent : 'Start Game';
  let transitionedToGame = false;

  try {
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = 'Checking...';
    }

    // 1) Dry-run: check server-side if we can start, without deducting credits or creating a session
    // 1) Dry-run: check server-side if we can start (no side-effects)
console.debug('[start] sending dry-run /start (X-Dry-Run=1)');
const dryHeaders = { 'Content-Type': 'application/json', 'X-Dry-Run': '1' };
if (userToken) dryHeaders['Authorization'] = `Bearer ${userToken}`;

const dryRes = await fetchWithTimeout(`${backendBase()}/api/start`, {
  method: 'POST',
  headers: dryHeaders,
  body: JSON.stringify({ difficulty: selectedDifficulty, email: userEmail })
}, 5000);

console.debug('[start] dry-run response', { ok: !!dryRes && dryRes.ok, status: dryRes && dryRes.status });

if (!dryRes.ok) {
  const json = await safeParseJson(dryRes) || {};
  console.warn('[start] dry-run failed', dryRes.status, json);
  alert(json.error || `Cannot start (${dryRes.status})`);
  return;
}

// Update credits shown (dry-run response includes credits)
// Update credits shown (dry-run response includes credits)
try {
  const dryData = await safeParseJson(dryRes) || {};
  if (typeof dryData.credits !== 'undefined') setCredits(dryData.credits);
  console.debug('[start] dry-run payload', dryData);
} catch (e) {
  console.warn('[start] could not parse dry-run body', e);
}

// 2) best-effort fetch game-config (non-blocking)
if (startBtn) startBtn.textContent = 'Preparing...';
try {
  console.debug('[start] fetching game-config (authFetch)');
  const cfgRes = await authFetch(
    `${backendBase()}/api/game-config?difficulty=${encodeURIComponent(selectedDifficulty)}`,
    { credentials: 'include', timeoutMs: 7000 }
  );
  if (cfgRes && cfgRes.ok) {
    GAME_CONFIG = await safeParseJson(cfgRes) || { ...DEFAULT_GAME_CONFIG };
    applyConfigToGlobals(GAME_CONFIG);
    console.debug('[start] loaded GAME_CONFIG', GAME_CONFIG);
  } else {
    console.warn('[start] game-config fetch failed or empty, using defaults', cfgRes && cfgRes.status);
    if (!GAME_CONFIG?.mazePattern) {
      GAME_CONFIG = { ...DEFAULT_GAME_CONFIG };
      applyConfigToGlobals(GAME_CONFIG);
    }
  }
} catch (cfgErr) {
  console.warn('[start] game-config error — using defaults', cfgErr);
  if (!GAME_CONFIG?.mazePattern) {
    GAME_CONFIG = { ...DEFAULT_GAME_CONFIG };
    applyConfigToGlobals(GAME_CONFIG);
  }
}

// 3) Start local pre-game countdown / init BEFORE the destructive start
if (startBtn) startBtn.textContent = 'Starting...';
console.debug('[start] invoking startPreGameCountdown() to init local game');
startPreGameCountdown();

// 4) Wait for the local game to become active
console.debug('[start] waiting for window.gameActive (timeout 12s)');
const ok = await waitForGameActive(12000);
console.debug('[start] waitForGameActive result:', ok, 'window.gameActive=', !!window.gameActive, 'window.__gameInitCompleted=', !!window.__gameInitCompleted);

if (!ok) {
  console.warn('[start] local init did not complete in time; aborting server-side start');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = backupLabel;
  }
  return;
}

// refuse to call real /start unless the client truly initialized
if (!window.__gameInitCompleted && !window.gameActive) {
  console.warn('[start] aborting real /start: client not initialized (initCompleted,gameActive):', window.__gameInitCompleted, window.gameActive);
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = backupLabel;
  }
  return;
}

// 5) Now perform the destructive /start (create server session & deduct credits).
const realHeaders = createHeaders({ 'Content-Type': 'application/json' });

// generate/reuse an idempotency key for this start attempt (helps server dedupe)
const idempotencyKey = (window.__lastStartAttempt && window.__lastStartAttempt.idempotencyKey)
  || (window.__lastStartAttempt = { idempotencyKey: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8) }).idempotencyKey;

console.info('[start] performing real POST /start', { idempotencyKey, headersPreview: Object.keys(realHeaders), difficulty: selectedDifficulty });

const res = await fetchWithTimeout(`${backendBase()}/api/start`, {
  method: 'POST',
  headers: realHeaders,
  body: JSON.stringify({ difficulty: selectedDifficulty, email: userEmail, idempotencyKey })
}, 7000);

console.debug('[start] real /start response', { ok: !!res && res.ok, status: res && res.status });

    if (!res.ok) {
  const body = await safeParseJson(res) || {};
  console.error('[start] server /start failed after local init:', res.status, body);
  alert(body.error || `Failed to start game on server (status ${res.status}).`);
  return;
}

    const data = await safeParseJson(res) || {};
if (typeof data.credits !== 'undefined') setCredits(data.credits);
if (data.sessionId) sessionId = data.sessionId;

    transitionedToGame = true;

  } catch (err) {
    console.error('handleStartButtonClick error', err);
    alert('Network/server error. Please try again.');
  } finally {
    if (!transitionedToGame && startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = backupLabel;
    }
    startRequestInFlight = false;
    updateStartButtonUI();
    refreshFeedbackButton();
  }
}



    if (endGameButton) {
      endGameButton.addEventListener('click', () => {
        logEndGame(true);
        showGameEndedResult();
      });
    }
    
 ensureStartButtonIdle();

    // startPreGameCountdown (minimal edit: avoid initial redundant setHUDVisible(false))
function startPreGameCountdown() {
  try {
    console.log('[startPreGameCountdown] start requested');
    const hudBtn = document.getElementById('toggle-hud-button');
    if (hudBtn) hudBtn.style.display = "none";

    stopAnimationLoop();
    isGameOver = false;
    explosionActive = false;
    confettiActive = false;
    celebrationActive = false;

    // Ensure gameScreen is resolved
    if (!gameScreen) gameScreen = document.getElementById('game-screen');
    if (!gameScreen) {
      console.error('[startPreGameCountdown] Missing #game-screen');
      updateStartButtonUI('Start Game');
      const btn = startButton || document.getElementById('start-button');
      if (btn) btn.disabled = false;
      return;
    }

    // Show the game screen first, then hide HUD to avoid toggling it visible briefly
    showScreen(gameScreen);

    // Paste this immediately after `showScreen(gameScreen);` in startPreGameCountdown()
try {
  // Ensure joystick and HUD toggle are hidden during pre-game (countdown)
  showJoystick(false);
  document.querySelectorAll('#game-screen #toggle-hud-button').forEach(btn => {
    try { btn.style.setProperty('display', 'none', 'important'); } catch (e) {}
  });
} catch (e) { /* ignore */ }

    // Verify canvas/context
    if (!canvas) canvas = document.getElementById('game-canvas');
    if (!ctx && canvas) {
      try {
        ctx = canvas.getContext('2d');
      } catch (e) {
        console.error('[startPreGameCountdown] getContext failed', e);
      }
    }
    if (!canvas || !ctx) {
      console.error('[startPreGameCountdown] missing canvas or context', { canvas, ctx });
      updateStartButtonUI('Start Game');
      const btn = startButton || document.getElementById('start-button');
      if (btn) btn.disabled = false;
      return;
    }

    // Hide HUD during countdown (after showing the game screen so we don't cause a transient show)
    setHUDVisible(false);

    preGameCountdown = PRE_GAME_TIMER;
    preGameState = "count";

    try { render(); } catch (e) { console.warn('[startPreGameCountdown] initial render() failed (continuing):', e); }

    if (preGameInterval) {
      clearInterval(preGameInterval);
      preGameInterval = null;
    }

    window.__lastStartAttempt = { ts: Date.now(), started: true };
    window.__gameInitCompleted = false;
    window.__lastPreGameError = null;

    preGameInterval = setInterval(() => {
      try {
        console.log("[start] tick:", preGameCountdown, "state:", preGameState, "gameActive:", gameActive);

        if (preGameCountdown > 1) {
          preGameCountdown--;
        } else if (preGameCountdown === 1) {
          preGameCountdown = 0;
          preGameState = "start";
          console.log('[start] preGameState -> start');
        } else if (preGameState === "start") {
          clearInterval(preGameInterval);
          preGameInterval = null;
          preGameState = "running";
          console.log('[start] invoking initGame() now');

          try {
            window.__lastStartAttempt.initCallTs = Date.now();
            initGame(true);
            console.log('[start] initGame() returned; window.gameActive set true');
            return;
          } catch (initErr) {
            console.error('[start] initGame threw synchronously:', initErr);
            window.__lastPreGameError = String(initErr && (initErr.stack || initErr.message || initErr));
            updateStartButtonUI('Start Game');
            const btn = startButton || document.getElementById('start-button');
            if (btn) btn.disabled = false;
            return;
          }
        }

        try { render(); } catch (e) { console.warn('[start] render() during countdown threw:', e); throw e; }
      } catch (tickErr) {
        console.error('[startPreGameCountdown] tick error — aborting countdown, restoring start button:', tickErr);
        window.__lastPreGameError = String(tickErr && (tickErr.stack || tickErr.message || tickErr));
        if (preGameInterval) {
          clearInterval(preGameInterval);
          preGameInterval = null;
        }
        updateStartButtonUI('Start Game');
        const btn = startButton || document.getElementById('start-button');
        if (btn) btn.disabled = false;
      }
    }, 1000);
  } catch (err) {
    console.error('[startPreGameCountdown] unexpected failure', err);
    updateStartButtonUI('Start Game');
    const btn = startButton || document.getElementById('start-button');
    if (btn) btn.disabled = false;
  }
}

    // Place this function at the top level of your file (outside initGame):
function placeSpreadOutTreasures(validPositions, numTreasures, existingIndices = new Set(), minDistance = 180) {
  // handle empty/insufficient validPositions safely
if (!Array.isArray(validPositions) || validPositions.length === 0) {
  // Nothing we can place — return empty arrays so caller can handle fallback
  return { treasures: [], usedIndices: new Set() };
}
  let treasures = [];
  let usedIndices = new Set(existingIndices);

  // Shuffle validPositions for random start
  let indices = Array.from(Array(validPositions.length).keys());
  for (let i = indices.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  let attempts = 0;
  while (treasures.length < numTreasures && attempts < 2000) {
    attempts++;
    for (let idx of indices) {
      if (usedIndices.has(idx)) continue;
      const pos = validPositions[idx];
      // Enforce minimum distance from all placed treasures
      let tooClose = treasures.some(t => {
        let dx = t.x - pos.x;
        let dy = t.y - pos.y;
        let dist = Math.sqrt(dx*dx + dy*dy);
        return dist < minDistance;
      });
      if (tooClose) continue;
      treasures.push({
        x: pos.x,
        y: pos.y,
        width: CHEST_SIZE,
        height: CHEST_SIZE,
        type: "small",
        collected: false,
        value: [5, 10, 15][Math.floor(Math.random() * 3)],
        penalty: 0
      });
      usedIndices.add(idx);
      if (treasures.length >= numTreasures) break;
    }
  }
  return {treasures, usedIndices};
}

function placeMermaidsFromPattern() {
  let arr = [];
  if (!Array.isArray(customPattern) || customPattern.length === 0) return arr;
  const rows = customPattern.length;
  const cols = customPattern[0].length || 0;
  const cellW = GAME_WIDTH / cols;
  const cellH = GAME_HEIGHT / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (customPattern[r][c] === "M") {
        arr.push({
          x: c * cellW + cellW/2 - MERMAID_SIZE/2,
          y: r * cellH + cellH/2 - MERMAID_SIZE/2,
          width: MERMAID_SIZE,
          height: MERMAID_SIZE,
          state: "roaming",
          stateTimer: 0,
          roamTarget: getRandomOpenPosition(),
          lastChaseTarget: null,
          stuckCounter: 0
        });
      }
    }
  }
  return arr;
}

// Cleaned up initGame function:
function initGame(relocateManatee = true) {
  // If somehow config is missing, guarantee defaults
  if (!customPattern || !Array.isArray(customPattern) || !customPattern.length) {
    console.warn('[game] No maze pattern at init, applying defaults.');
    applyConfigToGlobals(GAME_CONFIG?.mazePattern ? GAME_CONFIG : DEFAULT_GAME_CONFIG);
  }

  // initialization state (do NOT declare game active here)
  activeSeaweedBoost = false;
  seaweedBoostTimer = 0;
  isGameOver = false;
  score = 0;
  collectedTreasures = 0;
  // DO NOT set gameActive = true here
  explosionActive = false;
  debrisPieces = [];
  explosionTimer = 0;
  gameTimer = GAME_TIME_SECONDS;
  gameStartTime = Date.now();

  // Ensure joystick will be shown later if mobile
  if (isMobile) showJoystick(true);

  walls = generateMazeWalls();
  bubbles = generateBubbles();
  seaweeds = generateSeaweeds();
  corals = generateCorals();
  mines = generateMines();

  // --- Ensure manatee spawn is set BEFORE we filter chest positions ---
  if (relocateManatee) {
    let spawnFound = false;
    if (Array.isArray(customPattern) && customPattern.length) {
      for (let r = 0; r < customPattern.length; r++) {
        const row = customPattern[r];
        const c = row.indexOf('X');
        if (c !== -1) {
          const rows = customPattern.length;
          const cols = (customPattern[0] && customPattern[0].length) ? customPattern[0].length : 28;
          const cellW = GAME_WIDTH / cols;
          const cellH = GAME_HEIGHT / rows;
          manatee.x = c * cellW + cellW/2 - manatee.width/2;
          manatee.y = r * cellH + cellH/2 - manatee.height/2;
          manateeLastX = manatee.x;
          manateeLastY = manatee.y;
          spawnFound = true;
          break;
        }
      }
    }
    if (!spawnFound) {
  const spawnPos = getRandomOpenPosition();
  // spawnPos is a chest top-left (same format as getValidTreasurePositions).
  // Center the manatee inside that cell so manateeCenter calculation is consistent.
  const chestCenterX = spawnPos.x + CHEST_SIZE / 2;
  const chestCenterY = spawnPos.y + CHEST_SIZE / 2;
  manatee.x = chestCenterX - manatee.width / 2;
  manatee.y = chestCenterY - manatee.height / 2;
  manateeLastX = manatee.x;
  manateeLastY = manatee.y;
}
  }

  mermaids = placeMermaidsFromPattern();

  // Compute valid positions and filter out those too close to the manatee spawn
  let validPositions = getValidTreasurePositions(walls);

  // Compute manatee center (now that we've set manatee.x/manatee.y)
  const manateeCenter = { x: manatee.x + (manatee.width / 2), y: manatee.y + (manatee.height / 2) };

  // Filter out candidate chest positions whose chest center is within the exclusion radius.
  let filteredPositions = [];
  if (Array.isArray(validPositions) && validPositions.length > 0) {
    const r2 = CHEST_SPAWN_EXCLUDE_RADIUS * CHEST_SPAWN_EXCLUDE_RADIUS;
    filteredPositions = validPositions.filter(pos => {
      const chestCenterX = pos.x + CHEST_SIZE / 2;
      const chestCenterY = pos.y + CHEST_SIZE / 2;
      const dx = chestCenterX - manateeCenter.x;
      const dy = chestCenterY - manateeCenter.y;
      return (dx * dx + dy * dy) >= r2;
    });
  }

  // If filtering removed too many candidates, fall back to the unfiltered set so we can still place chests.
  const requiredMin = Math.max(8, TOTAL_TREASURES + (GAME_CONFIG.totalFakeChests || 0));
  if (!Array.isArray(filteredPositions) || filteredPositions.length < requiredMin) {
    filteredPositions = validPositions.slice();
  }

  // Use filteredPositions for placing treasures so nothing spawns too close to the spawn point
  let res = placeSpreadOutTreasures(filteredPositions, TOTAL_TREASURES);
  treasures = res.treasures;

  // Place spread-out fake chests using the same filtered candidate set and excluding used indices
  let numFakes = GAME_CONFIG.totalFakeChests ?? 0;
  let fakeTreasures = [];
  if (numFakes > 0) {
    let fakeResult = placeSpreadOutTreasures(filteredPositions, numFakes, res.usedIndices, 140);
    fakeTreasures = fakeResult.treasures.map(t => ({
      ...t,
      type: "fake",
      value: 0,
      penalty: 5
    }));
  }
  treasures = treasures.concat(fakeTreasures);

  if (totalTreasures) totalTreasures.textContent = TOTAL_TREASURES;
  updateScoreDisplay();
  updateTimerDisplay();
  if (timeInterval) clearInterval(timeInterval);
  timeInterval = setInterval(updateTimerDisplay, 200);

  collectibleSeaweeds = generateCollectibleSeaweeds();
  collectibleBubbles = generateCollectibleBubbles();
  stopAnimationLoop();
  rafId = requestAnimationFrame(gameLoop);

  // Now mark the game as active and ensure HUD / joystick show
  gameActive = true;
  window.gameActive = true;
  window.__gameInitCompleted = true;

  // IMPORTANT: ensure HUD is visible when the game starts (fix for "HUD always hidden on start")
  try {
    setHUDVisible(true);
  } catch (e) {
    console.warn('[initGame] setHUDVisible failed', e);
  }

  // Also ensure joystick is visible on mobile when the game starts
  if (isMobile) {
    try { showJoystick(true); } catch (e) { console.warn('[initGame] showJoystick failed', e); }
  }
}
   
  // DEV helper: expose initGame and a safe force-start helper for debugging
try {
  window.initGame = initGame;
  window.__forceLocalInitGame = function(){ 
    try { initGame(true); console.log('initGame(true) called'); } 
    catch (e) { console.error('initGame error', e); } 
  };
} catch (e) { /* ignore if scope prevents exposure */ }
    
    function updateScoreDisplay() {
      if (scoreValue) scoreValue.textContent = score;
      if (treasuresCollected) treasuresCollected.textContent = collectedTreasures;
      if (totalTreasures) totalTreasures.textContent = TOTAL_TREASURES;
    }

    function updateTimerDisplay() {
      if (!gameActive || celebrationActive || isGameOver || explosionActive) return;
      

  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  const remaining = Math.max(0, gameTimer - elapsed);
  if (timerValue) timerValue.textContent = remaining;
  if (timeRemaining) timeRemaining.textContent = remaining + "s";
  if (remaining <= 0) {
    endGame(true);
  }
}

function endGame(timeUp = false) {
  if (isGameOver) return;
  isGameOver = true;

  // compute elapsed since local gameStartTime (seconds)
  const elapsedSinceStart = Math.max(0, Math.floor((Date.now() - (gameStartTime || 0)) / 1000));
  endedWithinGrace = (elapsedSinceStart < 5);

  // Log to server — this will include the 'grace' flag via logEndGame()
  try { logEndGame(); } catch (e) { console.warn('[endGame] logEndGame failed', e); }

  confettiActive = false;
  celebrationActive = false;
  explosionActive = false;
  gameActive = false;
  showJoystick(false); // hide joystick when game ends

  clearInterval(timeInterval);
  setHUDVisible(false);
  ensureStartButtonIdle();

  // Show results and special message if within grace period
  showScreen(completionPopup);
  try { updateEndScreenCredits(); } catch (e) { console.warn('[endGame] updateEndScreenCredits failed', e); }

  if (endedWithinGrace) {
    if (completionTitle) completionTitle.textContent = "Game Ended Early";
    if (completionMessage) completionMessage.textContent = "Your credits isn't consumed since you ended the game early.";
    // Ensure Play Again is available but its state respects credits (updateEndScreenCredits will handle that)
  } else {
    const won = collectedTreasures >= TOTAL_TREASURES;
    if (completionTitle) {
      completionTitle.textContent = won ? "Congratulations!" : (timeUp ? "Time's up!" : "Game Over!");
    }
    if (completionMessage) {
      completionMessage.textContent = won
        ? "You found all the treasures!"
        : "Your final score and progress:";
    }
  }

  if (finalScore) finalScore.textContent = score;
  if (timeRemaining && timerValue) timeRemaining.textContent = timerValue.textContent;
}

/* In showGameEndedResult() (used by End Game flow) after showScreen(quitResultPopup) add update call: */
function showGameEndedResult() {
  if (isGameOver) return;
  isGameOver = true;

  // compute elapsed since local gameStartTime (seconds)
  const elapsedSinceStart = Math.max(0, Math.floor((Date.now() - (gameStartTime || 0)) / 1000));
  endedWithinGrace = (elapsedSinceStart < 5);

  // Inform server
  try { logEndGame(true); } catch (e) { console.warn('[showGameEndedResult] logEndGame failed', e); }

  gameActive = false;
  clearInterval(timeInterval);
  stopAnimationLoop();
  setHUDVisible(false);
  showJoystick(false);

  showScreen(quitResultPopup);
  try { updateEndScreenCredits(); } catch (e) { console.warn('[showGameEndedResult] updateEndScreenCredits failed', e); }

  if (endedWithinGrace) {
    if (quitTitle) quitTitle.textContent = "Game Ended Early";
    if (quitMessage) quitMessage.textContent = "Your credits isn't consumed since you ended the game early.";
  } else {
    if (quitTitle) quitTitle.textContent = "Game Ended!";
    if (quitMessage) quitMessage.textContent = "Your progress before ending:";
  }

  if (quitFinalScore) quitFinalScore.textContent = score;
  if (quitTreasuresCollected) quitTreasuresCollected.textContent = collectedTreasures;
}
  

    function gameLoop(timestamp) {

   if (manateeJumping) {
  manateeJumpFrame++;
  let jumpProgress = manateeJumpFrame / MANATEE_JUMP_DURATION;
  manatee.jumpOffsetY = -MANATEE_JUMP_HEIGHT * 4 * jumpProgress * (1 - jumpProgress);
  if (manateeJumpFrame >= MANATEE_JUMP_DURATION) {
    manateeJumpCount++;
    if (manateeJumpCount < MANATEE_JUMPS_TOTAL) {
      manateeJumpFrame = 0; // next jump
    } else {
      manateeJumping = false; // done jumping
      manatee.jumpOffsetY = 0;
      // Do NOT start confetti here -- it's already running!
    }
  }
} else {
  manatee.jumpOffsetY = 0;
}
  if (celebrationActive) {
    updateConfetti();
    celebrationTimer--;
    render();
    if (celebrationTimer <= 0) {
      celebrationActive = false;
      endGame(false); // Not a time-out; we just finished the celebration
    } else {
       rafId = requestAnimationFrame(gameLoop);
    }
    return;
  }
   

   
      

  // Update bubbles
  for (const b of bubbles) {
    b.y -= b.speed;
    if (b.y + b.radius < 0) {
      b.y = GAME_HEIGHT + b.radius;
      b.x = Math.random() * (GAME_WIDTH - 30) + 15;
      b.radius = Math.random() * 12 + 8;
      b.speed = Math.random() * 0.7 + 0.3;
    }
  }

  




  // Seaweed boost timer
  if (activeSeaweedBoost) {
    seaweedBoostTimer--;
    if (seaweedBoostTimer <= 0) {
      activeSeaweedBoost = false;
      seaweedBoostTimer = 0;
    }
  }

  // Calculate speed multiplier for boost
 let speedMultiplier = activeSeaweedBoost ? SEAWEED_BOOST_AMOUNT : 1;
if (fakeTreasureSlowTimer > 0) {
  speedMultiplier *= 0.5; // cut speed in half
  fakeTreasureSlowTimer--;
}
  // MOVEMENT LOGIC (JOYSTICK OR KEYBOARD) -- uses boost!
  let moveX = 0, moveY = 0;
  if (isMobile && joystickActive) {
    moveX += MANATEE_SPEED * joystickX * speedMultiplier;
    moveY += MANATEE_SPEED * joystickY * speedMultiplier;
    if (moveX < 0) manatee.direction = -1;
    if (moveX > 0) manatee.direction = 1;
  } else {
    if (keysPressed['ArrowLeft'] || keysPressed['a']) {
      moveX -= MANATEE_SPEED * speedMultiplier;
      manatee.direction = -1;
    }
    if (keysPressed['ArrowRight'] || keysPressed['d']) {
      moveX += MANATEE_SPEED * speedMultiplier;
      manatee.direction = 1;
    }
    if (keysPressed['ArrowUp'] || keysPressed['w']) {
      moveY -= MANATEE_SPEED * speedMultiplier;
    }
    if (keysPressed['ArrowDown'] || keysPressed['s']) {
      moveY += MANATEE_SPEED * speedMultiplier;
    }
  }

  // Update floating rewards
for (let i = floatingRewards.length - 1; i >= 0; i--) {
  let reward = floatingRewards[i];
  reward.y += reward.vy; // Move up
  reward.alpha -= 0.012; // Fade out (adjust for duration)
  if (reward.alpha <= 0) floatingRewards.splice(i, 1);
}
//console.log("After update, floatingRewards:", floatingRewards);

  // Mermaid AI update
  updateMermaids();

  updateConfetti();
 
  updateMines();
  // Handle movement and collisions unless there's an explosion
  if (!explosionActive) {
    // X movement and collision
    if (moveX !== 0) {
      const tempRectX = { ...manatee, x: manatee.x + moveX };
      let collidedX = false;
      for (const wall of walls) {
        if (isColliding(tempRectX, wall)) {
          collidedX = true;
          break;
        }
      }
      if (!collidedX) manatee.x += moveX;
    }
    // Y movement and collision
    if (moveY !== 0) {
      const tempRectY = { ...manatee, y: manatee.y + moveY };
      let collidedY = false;
      for (const wall of walls) {
        if (isColliding(tempRectY, wall)) {
          collidedY = true;
          break;
        }
      }
      if (!collidedY) manatee.y += moveY;
    }
    manateeLastX = manatee.x;
    manateeLastY = manatee.y;

    // Treasure collection
   for (const t of treasures) {
  if (!t.collected && isColliding(manatee, t)) {
    t.collected = true;
    logChest(t);
    if (t.type === "fake") {
      fakeTreasureSlowTimer = 180; // 3 seconds at 60fps
      floatingRewards.push({
        x: t.x + CHEST_SIZE/2,
        y: t.y,
        value: "Slowed!",
        alpha: 1,
        vy: -1.3
      });
    } else {
      score += t.value;
      collectedTreasures += 1;
      updateScoreDisplay();
      floatingRewards.push({
        x: t.x + CHEST_SIZE/2,
        y: t.y,
        value: t.value,
        alpha: 1,
        vy: -1.3
      });
      if (collectedTreasures >= TOTAL_TREASURES) {
  manateeJumping = true;             // <-- Start jumping!
  manateeJumpFrame = 0;
  manateeJumpCount = 0;
  celebrationActive = true;
  celebrationTimer = 120;
  startConfetti();
}
    }
    break;
  }
}

    // Collectible seaweed pickup
    for (const s of collectibleSeaweeds) {
      if (!s.collected && isColliding(manatee, s)) {
        s.collected = true;
        activeSeaweedBoost = true;
        seaweedBoostTimer = SEAWEED_BOOST_DURATION;
        ASSETS.sounds.collect();
      }
    }
  } else {
    // Explosion/debris animation
    explosionTimer++;
    for (const d of debrisPieces) {
      d.x += d.vx;
      d.y += d.vy;
      d.rot += d.rotSpeed;
    }
    if (explosionTimer > 180) {
      endGame(false);
      return;
    }
  }
  // Collectible bubbles pickup (timer bonus)
for (const b of collectibleBubbles) {
  if (!b.collected && isColliding(manatee, b)) {
    b.collected = true;
    gameTimer += b.value; // Or whatever effect you want
    logBubble(b); // If you want to log the bubble collection
    floatingRewards.push({
      x: b.x + b.width/2,
      y: b.y,
      value: `+${b.value}s`,
      alpha: 1,
      vy: -1.3
    });
    // You can play a sound or animation here
  }
}
  // Update screenshake effect
if (screenshakeTimer > 0) {
  screenshakeTimer--;
  // Random offset within a circle
  let angle = Math.random() * Math.PI * 2;
  let mag = Math.random() * screenshakeMagnitude;
  screenshakeX = Math.cos(angle) * mag;
  screenshakeY = Math.sin(angle) * mag;
  // Reduce magnitude over time for smoothness
  screenshakeMagnitude *= 0.92;
} else {
  screenshakeX = 0;
  screenshakeY = 0;
}

   render();
  rafId = requestAnimationFrame(gameLoop);
}
    


    // Event listeners
    document.addEventListener('keydown', (e) => {
      keysPressed[e.key] = true;
    });
    document.addEventListener('keyup', (e) => {
      keysPressed[e.key] = false;
    });

    

    window.addEventListener('resize', () => {
  isMobile = detectMobile();
  updateViewportSize();
  render();
});
window.addEventListener('orientationchange', () => {
  isMobile = detectMobile();
  updateViewportSize();
  render();
});
window.addEventListener('beforeunload', () => {
  try {
    if (preGameInterval) { clearInterval(preGameInterval); preGameInterval = null; }
    if (timeInterval) { clearInterval(timeInterval); timeInterval = null; }
    if (creditsCountdownInterval) { clearInterval(creditsCountdownInterval); creditsCountdownInterval = null; }
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  } catch (e) {
    // ignore
  }
});

  
 


  // ----------- FIXED render() function -----------
  // Paste this over the render() defined inside DOMContentLoaded.
  function render() {
    if (!ctx) return;
    {
      // center camera on manatee, but keep within world bounds
      // Use VIEWPORT_* (which can be > css viewport thanks to updateViewportSize)
      const manateeCenterX = manatee.x + manatee.width / 2;
      const manateeCenterY = manatee.y + manatee.height / 2;
    
      // Attempt to keep camera centered, but clamp to world edges
      cameraX = Math.round(manateeCenterX - VIEWPORT_WIDTH / 2);
      cameraY = Math.round(manateeCenterY - VIEWPORT_HEIGHT / 2);
    
      // clamp so we never show beyond the map edges
      cameraX = Math.max(0, Math.min(GAME_WIDTH - VIEWPORT_WIDTH, cameraX));
      cameraY = Math.max(0, Math.min(GAME_HEIGHT - VIEWPORT_HEIGHT, cameraY));
    
      // Apply screenshake offsets (if active)
      cameraX += screenshakeX;
      cameraY += screenshakeY;
    }

    if (canvas && ctx) {
      // Clear the full backing buffer in device pixels to avoid "ghosting" when transforms are present.
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0); // identity in backing pixels
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } finally {
        ctx.restore();
      }
    }

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEWPORT_HEIGHT);
    gradient.addColorStop(0, '#1a75ff');
    gradient.addColorStop(1, '#003366');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    // Mermaid
    drawMermaids();

    // Corals
   for (const c of corals) {
      const img = ASSETS.images.coral;
      if (img) {
        ctx.save();
        ctx.globalAlpha = 0.98;
        ctx.drawImage(img, c.x - cameraX, c.y - cameraY, c.width, c.height);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = "#cc4e5b";
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(c.x + c.width/2 - cameraX, c.y + c.height/2 - cameraY, c.width/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Background seaweeds (new) — drawn before walls
    for (const s of seaweeds) {
      const img = ASSETS.images.seaweed;
      ctx.save();
      // Slight transparency so it blends with the background
      ctx.globalAlpha = 0.33;
      if (img) {
        ctx.drawImage(img, s.x - cameraX, s.y - cameraY, s.width, s.height);
      } else {
        ctx.fillStyle = "#0b8f65";
        ctx.fillRect(s.x - cameraX, s.y - cameraY, s.width, s.height);
      }
      ctx.restore();
    }

    // Collectible seaweed with glow
    for (const s of collectibleSeaweeds) {
      if (!s.collected) {
        const img = ASSETS.images.seaweed;
        ctx.save();
        ctx.shadowColor = "#00ff88";
        ctx.shadowBlur = 35;
        if (img) {
          ctx.globalAlpha = 1;
          ctx.drawImage(img, s.x - cameraX, s.y - cameraY, s.width, s.height);
        } else {
          ctx.fillStyle = "#0e5";
          ctx.globalAlpha = 0.85;
          ctx.fillRect(s.x - cameraX, s.y - cameraY, s.width, s.height);
        }
        ctx.restore();
      }
    }

    // Walls
  // Inside your render() function:
for (const w of walls) {
  // Draw the wall background
  ctx.save();
  if (ASSETS.images.wall) {
    ctx.globalAlpha = 0.96;
    ctx.drawImage(ASSETS.images.wall, w.x - cameraX, w.y - cameraY, w.width, w.height);
  } else {
    ctx.fillStyle = '#2b3e2f';
    ctx.fillRect(w.x - cameraX, w.y - cameraY, w.width, w.height);
  }
  // Optionally, draw a gradient overlay here if you like
  ctx.restore();

  // Draw persistent decorations (shells and corals)
  if (w.decorations && Array.isArray(w.decorations)) {
    for (const deco of w.decorations) {
      if (deco.type === "shell" && ASSETS.images.shell) {
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.drawImage(
          ASSETS.images.shell,
          w.x - cameraX + deco.x,
          w.y - cameraY + deco.y,
          deco.size,
          deco.size
        );
        ctx.restore();
      }
      if (deco.type === "coral" && ASSETS.images.coral) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(
          ASSETS.images.coral,
          w.x - cameraX + deco.x,
          w.y - cameraY + deco.y,
          deco.size,
          deco.size
        );
        ctx.restore();
      }
    }
  }
}
  

    // Ambient bubbles
    for (const b of bubbles) {
      const img = ASSETS.images.bubble;
      if (img) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.drawImage(img, b.x - b.radius - cameraX, b.y - b.radius - cameraY, b.radius * 2, b.radius * 2);
        ctx.restore();
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x - cameraX, b.y - cameraY, b.radius, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(200,220,255,0.5)";
        ctx.fill();
        ctx.restore();
      }
    }

    // Treasures
   for (const t of treasures) {
  if (!t.collected) {
    const img = ASSETS.images.treasures[t.type];
    if (img) {
      ctx.save();
      if (t.type === "fake") {
        ctx.globalAlpha = 0.85; // slightly faded/darker
      }
      ctx.drawImage(img, t.x - cameraX, t.y - cameraY, CHEST_SIZE, CHEST_SIZE);
      ctx.globalAlpha = 1;
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = t.type === "fake" ? "#bfa404" : "gold"; // use a darker color
      ctx.fillRect(t.x - cameraX, t.y - cameraY, CHEST_SIZE, CHEST_SIZE);
      ctx.restore();
    }
  }
}

    // Collectible bubbles (timer bonus)
    for (const b of collectibleBubbles) {
      if (!b.collected) {
        const img = ASSETS.images.bubble;
        ctx.save();
        ctx.globalAlpha = 0.9;
        if (img) {
          ctx.drawImage(img, b.x - cameraX, b.y - cameraY, b.width, b.height);
        } else {
          ctx.beginPath();
          ctx.arc(b.x + b.width/2 - cameraX, b.y + b.height/2 - cameraY, b.width/2, 0, Math.PI*2);
          ctx.fillStyle = "#aef";
          ctx.fill();
        }
        ctx.font = "bold 20px Arial";
        ctx.fillStyle = "#234";
        ctx.textAlign = "center";
        ctx.fillText(`+${b.value}s`, b.x + b.width/2 - cameraX, b.y + b.height/2 + 8 - cameraY);
        ctx.restore();
      }
    }

    // Mines
    for (const mine of mines) {
      const img = ASSETS.images.mine;
      ctx.save();
      if (img) {
        ctx.globalAlpha = 1;
        ctx.drawImage(img, mine.x - cameraX, mine.y - cameraY, mine.width, mine.height);
      } else {
        ctx.fillStyle = "darkred";
        ctx.beginPath();
        ctx.arc(mine.x + mine.width/2 - cameraX, mine.y + mine.height/2 - cameraY, mine.width/2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Manatee or explosion
    // Inside render(), where you draw the manatee
if (explosionActive) {
  drawExplosionAndDebris();
} else {
  const manateeImage = ASSETS.images.manatee;
  ctx.save();
  ctx.translate(
    manatee.x + manatee.width / 2 - cameraX,
    manatee.y + manatee.height / 2 - cameraY + (manatee.jumpOffsetY || 0)
  );
  if (manatee.direction === -1) ctx.scale(-1, 1);
   if (activeSeaweedBoost) {
    ctx.shadowColor = "#00ff88";
    ctx.shadowBlur = 25;
  } else {
    ctx.shadowBlur = 0;
  }
  if (manateeImage instanceof Image && manateeImage.complete) {
    ctx.drawImage(manateeImage, -manatee.width / 2, -manatee.height / 2, manatee.width, manatee.height);
  } else {
    ctx.fillStyle = "gray";
    ctx.fillRect(-manatee.width / 2, -manatee.height / 2, manatee.width, manatee.height);
  }
  ctx.restore();
}
    // Floating reward texts
    for (const reward of floatingRewards) {
      ctx.save();
      ctx.globalAlpha = reward.alpha;
      ctx.font = "bold 32px Arial";
      ctx.fillStyle = "#ffd700";
      ctx.strokeStyle = "#8B7500";
      ctx.lineWidth = 2;
      ctx.textAlign = "center";
      ctx.strokeText(`${reward.value}`, reward.x - cameraX, reward.y - cameraY - 20);
      ctx.fillText(`${reward.value}`, reward.x - cameraX, reward.y - cameraY - 20);
      ctx.restore();
    }

    // Minimap
    drawMinimap();

 // Replace the existing pre-game countdown overlay block in render() with this:
if (!gameActive && (preGameCountdown > 0 || preGameState === "start")) {
  // Use the backing store dimensions so overlay always covers the visible canvas,
  // regardless of the current ctx transform or VIEWPORT_* values.
  const backingW = canvas && canvas.width ? canvas.width : (window.innerWidth * (window.devicePixelRatio || 1));
  const backingH = canvas && canvas.height ? canvas.height : (window.innerHeight * (window.devicePixelRatio || 1));
  const dpr = window.devicePixelRatio || 1;

  // Draw in backing-pixel coordinates (1 unit = 1 backing pixel).
  // We set an identity transform so we don't depend on any world transforms,
  // but we draw into the high-res backing buffer.
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Dim entire backing area
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, backingW, backingH);

    // Compute font size in CSS pixels then scale to backing pixels for crisp text
    const screenCssW = canvas && typeof canvas.clientWidth === 'number' ? canvas.clientWidth : window.innerWidth;
    const screenCssH = canvas && typeof canvas.clientHeight === 'number' ? canvas.clientHeight : window.innerHeight;
    const fontSizeCss = Math.max(48, Math.floor(Math.min(screenCssW, screenCssH) * 0.18));
    ctx.font = `bold ${fontSizeCss * dpr}px Arial`; // multiply by dpr to draw in backing pixels
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text = (preGameState === "start") ? "Start!" : String(preGameCountdown);
    // Draw centered using backing-pixel center
    ctx.fillText(text, backingW / 2, backingH / 2);
  } finally {
    ctx.restore();
  }
}

    // IMPORTANT: draw confetti LAST so it's always on top of the scene and overlays
    // Uses captured confettiCameraX/Y for stable screen-space confetti
    drawConfetti();
  }

  // ----------- END FIXED render() function -----------
  });
});
