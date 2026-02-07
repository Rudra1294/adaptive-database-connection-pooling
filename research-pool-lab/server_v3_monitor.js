import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';

const app = express();
const port = 3000;
const MONGO_URI = 'mongodb://db:27017/research_db';
const LOG_FILE = 'results_static.csv';

// CONFIGURATION
const POOL_LIMIT = 50; 
const CHECK_INTERVAL = 50;

if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, 'Timestamp,ActiveRequests,Lag_ms,VirtualLimit,Status\n');
}

let activeRequests = 0;

// 1. HIGH PRECISION MONITOR
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

// 2. WALL CLOCK BACKUP
let lastCheckTime = Date.now();

// ---------------------------------------------------------
// SERVER & MONITORING
// ---------------------------------------------------------
function startServer() {
  setInterval(() => {
    // A. Wall Clock Calculation (The Backup)
    const now = Date.now();
    const wallClockLag = now - lastCheckTime - CHECK_INTERVAL;
    lastCheckTime = now;

    // B. Event Loop Calculation (The Primary)
    // Convert nanoseconds to milliseconds
    let lag = histogram.mean / 1000000; 

    // C. THE HYBRID LOGIC
    // If the precise monitor fails (NaN) OR misses a massive spike, use Wall Clock
    if (isNaN(lag) || (wallClockLag > 500 && lag < 50)) {
        lag = wallClockLag > 0 ? wallClockLag : 0;
    }
    
    // Formatting
    const formattedLag = lag.toFixed(2);
    const time = new Date().toISOString();
    const status = activeRequests >= POOL_LIMIT ? 'SATURATED' : 'OK';

    // Log the HYBRID lag (Precision + Safety)
    fs.appendFile(LOG_FILE, `${time},${activeRequests},${formattedLag},${POOL_LIMIT},${status}\n`, () => {});
    
    histogram.reset();
  }, CHECK_INTERVAL);

  app.listen(port, () => { console.log(`🚀 Static Hybrid Server running on port ${port}`); });
}

// ---------------------------------------------------------
// MIDDLEWARE & DB
// ---------------------------------------------------------
app.use((req, res, next) => {
  activeRequests++;
  res.on('finish', () => { activeRequests--; });
  next();
});

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, { maxPoolSize: POOL_LIMIT }); 
    startServer(); // Start server after DB connects
  } catch (err) { setTimeout(connectDB, 5000); }
};
connectDB();

// ---------------------------------------------------------
// WORKLOADS
// ---------------------------------------------------------
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