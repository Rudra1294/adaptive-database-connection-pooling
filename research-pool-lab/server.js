import express from 'express';
import mongoose from 'mongoose';

const app = express();
const port = 3000;

// CONNECTION STRING
const MONGO_URI = 'mongodb://db:27017/research_db';

// IMPROVED CONNECTION LOGIC (The Fix)
const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 5000 
    });
    console.log('MongoDB Connected Successfully');
  } catch (err) {
    console.error('MongoDB not ready yet. Retrying in 5 seconds...');
    // Do NOT exit. Instead, try again after 5 seconds.
    setTimeout(connectDB, 5000);
  }
};

// Start the connection process
connectDB();

// Define a simple Schema for testing
const LogSchema = new mongoose.Schema({
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);

// Test Endpoint
app.get('/test', async (req, res) => {
  // Check if we are actually connected before trying to query
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database is still warming up, please refresh in 5 seconds' });
  }

  try {
    await Log.create({ message: 'Ping' });
    const latest = await Log.findOne().sort({ createdAt: -1 });
    res.json(latest);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database Error');
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});