import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';

const app = express();
const port = 3000;
const MONGO_URI = 'mongodb://db:27017/research_db';

const LOG_FILE = 'results.csv';

// Initialize CSV
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, 'Timestamp,ActiveRequests,EventLoopLag_ms,PoolSize\n');
}

// ---------------------------------------------------------
// 1. THE OBSERVER
// ---------------------------------------------------------
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

let activeRequests = 0;

app.use((req, res, next) => {
  activeRequests++;
  res.on('finish', () => { activeRequests--; });
  next();
});

// ---------------------------------------------------------
// 2. RECORDER
// ---------------------------------------------------------
setInterval(() => {
  const lag = (histogram.mean / 1000000).toFixed(2);
  
  // FIX 1: Dig deeper to find the REAL pool size
  // If this fails (depends on mongoose version), we default to 0
  let poolSize = 0;
  if (mongoose.connection.client && mongoose.connection.client.topology) {
     // This is where Mongoose 6+ hides the real connection count
     // Note: This path sometimes varies by version, but is more accurate
     poolSize = mongoose.connection.client.topology.s?.pool?.size || 0; 
  }

  const time = new Date().toISOString();
  // Only log if there is activity to keep file clean
  if (activeRequests > 0 || parseFloat(lag) > 30) {
    fs.appendFile(LOG_FILE, `${time},${activeRequests},${lag},${poolSize}\n`, () => {});
  }
  
  histogram.reset(); 
}, 50);

// ---------------------------------------------------------
// 3. DATABASE
// ---------------------------------------------------------
const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 5000 });
    console.log('✅ MongoDB Connected');
  } catch (err) { setTimeout(connectDB, 5000); }
};
connectDB();

const LogSchema = new mongoose.Schema({ type: String });
const Log = mongoose.model('Log', LogSchema);

// ---------------------------------------------------------
// 4. WORKLOADS (THE FIX IS HERE)
// ---------------------------------------------------------

app.get('/fast', async (req, res) => {
  try { await Log.create({ type: 'fast' }); res.json({ msg: 'Mosquito' }); } 
  catch (err) { res.status(500).send(err.message); }
});

app.get('/heavy-cpu', (req, res) => {
  // FIX 2: Use 'Sync' to block the Main Thread intentionally
  // 50,000 iterations might be too fast for modern CPUs. Let's bump it to 100,000.
  try {
    crypto.pbkdf2Sync('secret', 'salt', 100000, 64, 'sha512');
    res.json({ msg: 'Elephant' }); 
  } catch (err) { res.status(500).send(err.message); }
});

app.get('/heavy-db', async (req, res) => {
  try { await new Promise(r => setTimeout(r, 2000)); await Log.create({ type: 'heavy-db' }); res.json({ msg: 'Blocker' }); } 
  catch (err) { res.status(500).send(err.message); }
});

app.get('/stats', (req, res) => {
  res.json({ msg: "Logging..." });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});