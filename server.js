import express from 'express';
import cors from "cors"
import dotenv from 'dotenv';
import ipoRoutes from './src/routes/ipo.js'
import { initDatabase } from './src/db/init_ipo_db.js';
import { activeDbName } from './config/db.js';

dotenv.config();
const app = express();
app.use(cors());

app.use(express.json());

app.use('/api/ipos', ipoRoutes);

// System Status Endpoint (returns active DB and environment)
app.get('/api/system/status', (req, res) => {
  const dbEnv = (process.env.DB_ENV || process.env.NODE_ENV || 'dev').toLowerCase();
  const isProd = dbEnv === 'prod' || dbEnv === 'production';
  res.json({
    status: 'online',
    database: activeDbName,
    environment: isProd ? 'production' : 'development',
    isProd
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDatabase();
});

