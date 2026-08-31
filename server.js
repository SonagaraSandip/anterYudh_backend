import express from 'express';
import cors from "cors"
import dotenv from 'dotenv';
import ipoRoutes from './src/routes/ipo.js';
import expenseRoutes from './src/routes/expenses.js';
import tradeRoutes from './src/routes/trades.js';
import { initDatabase } from './src/db/init_ipo_db.js';
import promisePool, { activeDbName } from './config/db.js';

dotenv.config();
const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use('/api/ipos', ipoRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/trades', tradeRoutes);



// System Status Endpoint (verifies active DB connectivity in real-time)
app.get('/api/system/status', async (req, res) => {
  const dbEnv = (process.env.DB_ENV || process.env.NODE_ENV || 'dev').toLowerCase();
  const isProd = dbEnv === 'prod' || dbEnv === 'production';
  const startTime = Date.now();

  try {
    // Actively test live MySQL connection query
    await promisePool.query('SELECT 1');
    const latencyMs = Date.now() - startTime;

    res.json({
      status: 'online',
      connected: true,
      database: activeDbName,
      environment: isProd ? 'production' : 'development',
      isProd,
      latencyMs,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      connected: false,
      database: activeDbName,
      environment: isProd ? 'production' : 'development',
      isProd,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDatabase();
});


