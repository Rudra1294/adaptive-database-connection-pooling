import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';

const app = express();
const port = 3000;
const MONGO_URI = 'mongodb://db:27017/research_db';
const LOG_FILE = 'results_optimized.csv';

// ---------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------
let VIRTUAL_POOL_LIMIT = 10; 
const MIN_LIMIT = 5; 
const MAX_LIMIT = 50; 
const MAX_QUEUE_SIZE = 500; 

// TUNING
const CHECK_INTERVAL = 50; 
const IDEAL_LATENCY = 30; 
const IDLE_COOLDOWN_MS = 5000; 
const MAX_REQUEST_AGE = 5000;

// AGING FACTOR: How much priority increases per second of waiting
// e.g., A Priority 1 request waiting 2 seconds becomes Priority 1 + (2 * 0.5) = 2.0
const AGING_RATE_PER_SEC = 0.5; 

let queueOverflowCount = 0; 
let processedCount = 0; 
let zombiePrunedCount = 0; // NEW METRIC
let lastQueueActivityTime = Date.now(); 

const requestQueue = []; 
let activeRequests = 0;

if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, 'Timestamp,Active,QueueSize,Real_Lag,Limit,Mode,Throughput,Zombies\n');
}

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();
let lastCheckTime = Date.now();

// ---------------------------------------------------------
// 2. DISPATCHER (Optimized)
// ---------------------------------------------------------
function tryDispatch() {
    const now = Date.now();

    // 1. CLEANUP LOOP: Remove timeouts and dead connections efficiently
    // We check the front of the queue repeatedly
    while (requestQueue.length > 0 && activeRequests < VIRTUAL_POOL_LIMIT) {
        
        // Peek at the next candidate
        const candidate = requestQueue[0];

        // CHECK A: Is it too old?
        if (now - candidate.timestamp > MAX_REQUEST_AGE) {
            requestQueue.shift(); // Remove
            candidate.res.status(503).json({ error: 'Request Timeout' });
            continue; // Check next
        }

        // CHECK B: Did the user disconnect? (Zombie)
        if (candidate.req.destroyed || candidate.isAborted) {
            requestQueue.shift(); // Remove
            zombiePrunedCount++;  // Track savings
            continue; // Check next
        }

        // If we get here, the request is valid. Process it.
        const nextRequest = requestQueue.shift();
        activeRequests++;
        nextRequest.handler(nextRequest.req, nextRequest.res);
    }
}

// ---------------------------------------------------------
// 3. THE BRAIN
// ---------------------------------------------------------
function startServer() {
  setInterval(() => {
    const now = Date.now();
    const wallClockLag = now - lastCheckTime - CHECK_INTERVAL;
    lastCheckTime = now;

    let realLag = histogram.mean / 1000000; 
    if (isNaN(realLag) || (wallClockLag > 100 && realLag < 20)) {
        realLag = wallClockLag > 0 ? wallClockLag : 0;
    }
    
    const throughput = processedCount;
    processedCount = 0; 

    // --- PRIORITY AGING (Starvation Prevention) ---
    // Every tick, re-sort the queue based on "Effective Priority"
    if (requestQueue.length > 0) {
        requestQueue.sort((a, b) => {
            const ageA = (now - a.timestamp) / 1000;
            const ageB = (now - b.timestamp) / 1000;
            
            // Effective Priority = Base + (Age * Rate)
            const effA = a.priority + (ageA * AGING_RATE_PER_SEC);
            const effB = b.priority + (ageB * AGING_RATE_PER_SEC);
            
            return effB - effA; // Descending order
        });
    }

    let mode = "STABLE";
    const queueSize = requestQueue.length;

    // --- DECISION LOGIC ---
    if (realLag > IDEAL_LATENCY) {
        mode = "LAG_SHRINK";
        VIRTUAL_POOL_LIMIT = Math.max(MIN_LIMIT, VIRTUAL_POOL_LIMIT - 1);
    } 
    else if (queueSize === 0) {
        const timeSinceActive = Date.now() - lastQueueActivityTime;
        const dynamicCooldown = 1000 + (VIRTUAL_POOL_LIMIT * 200);

        if (timeSinceActive > dynamicCooldown) {
            mode = "IDLE_SHRINK";
            if (activeRequests < VIRTUAL_POOL_LIMIT) {
                 VIRTUAL_POOL_LIMIT = Math.max(MIN_LIMIT, VIRTUAL_POOL_LIMIT - 1);
            }
        } else {
            mode = `HOLD_${(dynamicCooldown/1000).toFixed(1)}s`; 
        }
    } 
    else {
        mode = "SMART_GROW";
        let growAmount = Math.ceil(queueSize / 25); 
        VIRTUAL_POOL_LIMIT = Math.min(MAX_LIMIT, VIRTUAL_POOL_LIMIT + growAmount);
    }

    tryDispatch();

    const time = new Date().toISOString();
    // Added 'zombiePrunedCount' to logs so you can see how much work you saved
    fs.appendFile(LOG_FILE, `${time},${activeRequests},${queueSize},${realLag.toFixed(2)},${VIRTUAL_POOL_LIMIT},${mode},${throughput},${zombiePrunedCount}\n`, () => {});
    
    zombiePrunedCount = 0; // Reset counter
    histogram.reset();
  }, CHECK_INTERVAL);

  app.listen(port, () => { console.log(`🚀 Optimized Server running on port ${port}`); });
}

// ---------------------------------------------------------
// 4. MIDDLEWARE
// ---------------------------------------------------------
app.use((req, res, next) => {
  if (requestQueue.length >= MAX_QUEUE_SIZE) {
      queueOverflowCount++;
      return res.status(503).json({ error: 'System Overload' });
  }

  lastQueueActivityTime = Date.now();

  let priority = 1;
  if (req.path === '/fast') priority = 3;       
  else if (req.path === '/heavy-cpu') priority = 2; 

  const queueItem = {
      req,
      res,
      priority,
      timestamp: Date.now(),
      isAborted: false, // Flag to track disconnects
      handler: (qReq, qRes) => {
          qRes.on('finish', () => { 
              activeRequests--; 
              processedCount++;
              tryDispatch(); 
          });
          next(); 
      }
  };

  // *** THE OPTIMIZATION: Client Disconnect Listener ***
  req.on('close', () => {
      // Just mark it as aborted. The Dispatcher will garbage collect it efficiently.
      // This avoids doing an expensive Array.splice() in the middle of a request.
      queueItem.isAborted = true;
  });

  requestQueue.push(queueItem);
  tryDispatch();
});

const connectDB = async () => {
  try { await mongoose.connect(MONGO_URI, { maxPoolSize: 100 }); startServer(); } 
  catch (err) { setTimeout(connectDB, 5000); }
};
connectDB();

const Log = mongoose.model('Log', new mongoose.Schema({ type: String }));

app.get('/fast', async (req, res) => {
  await new Promise(r => setTimeout(r, 20)); 
  try { await Log.create({ type: 'fast' }); res.json({ msg: 'Mosquito' }); } 
  catch (err) { if (!res.headersSent) res.status(500).send(err.message); }
});

app.get('/heavy-cpu', (req, res) => {
  crypto.pbkdf2('secret', 'salt', 100000, 64, 'sha512', () => {
    res.json({ msg: 'Elephant (Async)' });
  });
});

app.get('/heavy-db', async (req, res) => {
  try { await new Promise(r => setTimeout(r, 2000)); await Log.create({ type: 'heavy-db' }); res.json({ msg: 'Blocker' }); } 
  catch (err) { if (!res.headersSent) res.status(500).send(err.message); }
});