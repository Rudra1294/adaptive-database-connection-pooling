import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';

const app = express();
const port = 3000;
const MONGO_URI = 'mongodb://db:27017/research_db';
const LOG_FILE = 'results_adaptive_dynamic.csv';

// ---------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------
let VIRTUAL_POOL_LIMIT = 20; 
const MIN_LIMIT = 1;
const MAX_LIMIT = 50; // Kept at 50 for safety

// TUNING
const CHECK_INTERVAL = 50; 
const TARGET_LAG = 25; // We want to stay near 30ms (20ms baseline + 10ms buffer)
const HISTORY_SIZE = 5;
let lagHistory = [];

if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, 'Timestamp,ActiveRequests,Lag_ms,VirtualLimit,Status,Kp_Used\n');
}

let activeRequests = 0;
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();
let lastCheckTime = Date.now();

// ---------------------------------------------------------
// 2. DYNAMIC CONTROLLER
// ---------------------------------------------------------
function startServer() {
  setInterval(() => {
    // --- A. HYBRID MONITORING ---
    const now = Date.now();
    const wallClockLag = now - lastCheckTime - CHECK_INTERVAL;
    lastCheckTime = now;

    let lag = histogram.mean / 1000000; 

    // Backup check for NaN or massive CPU blocks
    if (isNaN(lag) || (wallClockLag > 100 && lag < 20)) {
        lag = wallClockLag > 0 ? wallClockLag : 0;
    }

    // --- B. SMOOTHING ---
    lagHistory.push(lag);
    if (lagHistory.length > HISTORY_SIZE) lagHistory.shift();
    const smoothLag = lagHistory.reduce((a, b) => a + b, 0) / lagHistory.length;
    const formattedLag = smoothLag.toFixed(2);

    // --- C. DYNAMIC GAIN SCHEDULING (The New Logic) ---
    const error = smoothLag - TARGET_LAG;
    
    // Default "Gentle" Gain
    let currentKp = 0.1; 

    // If we are lagging, decide how hard to panic based on the severity
    if (error > 0) {
        if (error > 500) {
            currentKp = 0.8; // CRITICAL: Slam the brakes! (Lag > 530ms)
        } else if (error > 100) {
            currentKp = 0.4; // WARNING: React strongly (Lag > 130ms)
        } else {
            currentKp = 0.1; // MINOR: Gentle nudge (Lag < 130ms)
        }
        
        // Calculate Drop
        const dropAmount = Math.ceil(error * currentKp);
        VIRTUAL_POOL_LIMIT = Math.max(MIN_LIMIT, VIRTUAL_POOL_LIMIT - dropAmount);
    } 
    else {
        // Recovery Logic (Grow)
        // If we are super fast (error is large negative), we can grow faster
        const growKp = 0.05;
        const growAmount = Math.ceil(Math.abs(error) * growKp);
        const safeGrowth = Math.min(2, growAmount); // Cap growth
        VIRTUAL_POOL_LIMIT = Math.min(MAX_LIMIT, VIRTUAL_POOL_LIMIT + safeGrowth);
    }

    // --- D. LOGGING ---
    const time = new Date().toISOString();
    const status = activeRequests >= VIRTUAL_POOL_LIMIT ? 'SATURATED' : 'OK';
    
    // Added "currentKp" to CSV so you can prove it changed in your paper
    fs.appendFile(LOG_FILE, `${time},${activeRequests},${formattedLag},${VIRTUAL_POOL_LIMIT},${status},${currentKp}\n`, () => {});
    
    histogram.reset();
  }, CHECK_INTERVAL);

  app.listen(port, () => { console.log(`🚀 Dynamic Gain Server running on port ${port}`); });
}

// ---------------------------------------------------------
// 3. MIDDLEWARE & DB (Standard)
// ---------------------------------------------------------
app.use((req, res, next) => {
  if (activeRequests >= VIRTUAL_POOL_LIMIT) {
    return res.status(503).json({ error: 'Adaptive Rejection' });
  }
  activeRequests++;
  res.on('finish', () => { activeRequests--; });
  next();
});

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, { maxPoolSize: 100 }); 
    startServer();
  } catch (err) { setTimeout(connectDB, 5000); }
};
connectDB();

const Log = mongoose.model('Log', new mongoose.Schema({ type: String }));

app.get('/fast', async (req, res) => {
  try { await Log.create({ type: 'fast' }); res.json({ msg: 'Mosquito' }); } 
  catch (err) { res.status(500).send(err.message); }
});

app.get('/heavy-cpu', (req, res) => {
  try { 
    crypto.pbkdf2Sync('secret', 'salt', 100000, 64, 'sha512'); 
    res.json({ msg: 'Elephant' }); 
  } 
  catch (err) { res.status(500).send(err.message); }
});

app.get('/heavy-db', async (req, res) => {
  try { await new Promise(r => setTimeout(r, 2000)); await Log.create({ type: 'heavy-db' }); res.json({ msg: 'Blocker' }); } 
  catch (err) { res.status(500).send(err.message); }
});