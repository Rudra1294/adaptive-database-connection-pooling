import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';

const app = express();
const port = 3000;
const MONGO_URI = 'mongodb://db:27017/research_db';
// Changed log file name for your baseline tests
const LOG_FILE = 'results_fifo_baseline.csv'; 

// ---------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------
let VIRTUAL_POOL_LIMIT = 10; 
const MIN_LIMIT = 5; 
const MAX_LIMIT = 50; 
const MAX_QUEUE_SIZE = 500; 

const CHECK_INTERVAL = 50; 
const IDEAL_LATENCY = 30; 
const MAX_REQUEST_AGE = 5000;

// (Priority and Aging variables have been removed)

let queueOverflowCount = 0; 
let processedCount = 0; 
let zombiePrunedCount = 0; 
let lastQueueActivityTime = Date.now(); 

const requestQueue = []; 
let activeRequests = 0;

// ---------------------------------------------------------
// 2. BUFFERED LOGGING
// ---------------------------------------------------------
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
if (!fs.existsSync(LOG_FILE) || fs.statSync(LOG_FILE).size === 0) {
    logStream.write('Timestamp,Active,QueueSize,Real_Lag,Limit,Mode,Throughput,Zombies\n');
}

let logBuffer = [];
setInterval(() => {
    if (logBuffer.length > 0) {
        logStream.write(logBuffer.join(''));
        logBuffer = []; 
    }
}, 1000);

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();
let lastCheckTime = Date.now();


// ---------------------------------------------------------
// 3. DISPATCHER (Strict FIFO Bouncer)
// ---------------------------------------------------------
function tryDispatch() {
    const now = Date.now();

    while (requestQueue.length > 0 && activeRequests < VIRTUAL_POOL_LIMIT) {
        const candidate = requestQueue[0]; // Always look at the absolute oldest request

        // CHECK A: Is it too old?
        if (now - candidate.timestamp > MAX_REQUEST_AGE) {
            requestQueue.shift(); 
            
            // Defensive Networking
            if (!candidate.res.headersSent && !candidate.req.destroyed && !candidate.isAborted) {
                candidate.res.status(503).json({ error: 'Request Timeout' });
            }
            continue; 
        }

        // CHECK B: Did the user disconnect? (Zombie)
        if (candidate.req.destroyed || candidate.isAborted) {
            requestQueue.shift(); 
            zombiePrunedCount++;  
            continue; 
        }

        // It passed the checks! Let it in. (Strict FIFO: First in, First out)
        const nextRequest = requestQueue.shift();
        activeRequests++;
        nextRequest.handler(nextRequest.req, nextRequest.res);
    }
}

// ---------------------------------------------------------
// 4. THE BRAIN
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

    // (The Smart Sort function was removed from here)

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
    logBuffer.push(`${time},${activeRequests},${queueSize},${realLag.toFixed(2)},${VIRTUAL_POOL_LIMIT},${mode},${throughput},${zombiePrunedCount}\n`);
    
    zombiePrunedCount = 0; 
    histogram.reset();
  }, CHECK_INTERVAL);

  app.listen(port, () => { console.log(`🚀 FIFO Baseline Server running on port ${port}`); });
}

// ---------------------------------------------------------
// 5. MIDDLEWARE
// ---------------------------------------------------------
app.use((req, res, next) => {
  if (requestQueue.length >= MAX_QUEUE_SIZE) {
      queueOverflowCount++;
      if (!res.headersSent) {
          return res.status(503).json({ error: 'System Overload' });
      }
      return;
  }

  lastQueueActivityTime = Date.now();

  // (Priority tagging was removed from here)

  const queueItem = {
      req,
      res,
      timestamp: Date.now(), // Only timestamp matters now for FIFO
      isAborted: false, 
      handler: (qReq, qRes) => {
          qRes.on('finish', () => { 
              activeRequests--; 
              processedCount++;
              tryDispatch(); 
          });
          next(); 
      }
  };

  req.on('close', () => { queueItem.isAborted = true; });

  // Simply push to the back of the line
  requestQueue.push(queueItem);
  
  // Try to dispatch immediately without sorting
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
  try { 
      await Log.create({ type: 'fast' }); 
      if (!res.headersSent) res.json({ msg: 'Mosquito' }); 
  } catch (err) { 
      if (!res.headersSent) res.status(500).send(err.message); 
  }
});

app.get('/heavy-cpu', (req, res) => {
  crypto.pbkdf2('secret', 'salt', 100000, 64, 'sha512', () => {
      if (!res.headersSent) res.json({ msg: 'Elephant (Async)' });
  });
});

app.get('/heavy-db', async (req, res) => {
  try { 
      await new Promise(r => setTimeout(r, 2000)); 
      await Log.create({ type: 'heavy-db' }); 
      if (!res.headersSent) res.json({ msg: 'Blocker' }); 
  } catch (err) { 
      if (!res.headersSent) res.status(500).send(err.message); 
  }
});