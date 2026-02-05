import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto'; 

const app = express();
const port = 3000;

const MONGO_URI = 'mongodb://db:27017/research_db';

// ---------------------------------------------------------
// DATABASE CONNECTION (Still Static for now)
// ---------------------------------------------------------
const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      maxPoolSize: 20,       
      serverSelectionTimeoutMS: 5000 
    });
    console.log('MongoDB Connected Successfully');
  } catch (err) {
    console.error('MongoDB not ready. Retrying...');
    setTimeout(connectDB, 5000);
  }
};
connectDB();

const LogSchema = new mongoose.Schema({
  type: String,
  createdAt: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);

// ---------------------------------------------------------
// MIXED WORKLOAD ENDPOINTS 
// ---------------------------------------------------------

// 1. The "Mosquito" (Fast Read) - 80% of traffic
app.get('/fast', async (req, res) => {
  try {
    const start = Date.now();
    await Log.create({ type: 'fast' });
    const duration = Date.now() - start;
    res.json({ msg: 'Mosquito done', duration: `${duration}ms` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. The "Elephant" (Heavy CPU) - 10% of traffic
app.get('/heavy-cpu', (req, res) => {
  const start = Date.now();
  // CPU BLOCKER: 50k iterations of hashing
  crypto.pbkdf2('secret', 'salt', 50000, 64, 'sha512', () => {
    const duration = Date.now() - start;
    res.json({ msg: 'Elephant done (CPU Heavy)', duration: `${duration}ms` });
  });
});

// 3. The "Blocker" (Slow DB Query) - 10% of traffic
app.get('/heavy-db', async (req, res) => {
  try {
    const start = Date.now();
    // Simulate complex join/aggregation
    await new Promise(resolve => setTimeout(resolve, 2000)); 
    await Log.create({ type: 'heavy-db' });
    const duration = Date.now() - start;
    res.json({ msg: 'Blocker done (DB Heavy)', duration: `${duration}ms` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});