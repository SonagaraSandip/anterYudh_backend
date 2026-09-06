import express from 'express';
import cors from "cors";
import compression from 'compression';
import dotenv from 'dotenv';
import ipoRoutes from './src/routes/ipo.js';
import expenseRoutes from './src/routes/expenses.js';
import tradeRoutes from './src/routes/trades.js';
import noteRoutes from './src/routes/notes.js';
import buyRoutes from './src/routes/buy.js';
import skillRoutes from './src/routes/skills.js';
import bookRoutes from './src/routes/books.js';
import backupRoutes from './src/routes/backup.js';
import dashboardRoutes from './src/routes/dashboard.js';
import { initDatabase } from './src/db/init_ipo_db.js';
import promisePool, { activeDbName } from './config/db.js';
import cron from 'node-cron';
import { dumpDatabase } from './src/utils/dbDumper.js';
import { uploadBackupToDrive, cleanOldDriveBackups } from './src/utils/googleDrive.js';
import { recordBackupLog } from './src/utils/backupTracker.js';

dotenv.config();
const app = express();

// High-speed gzip / deflate response compression
app.use(compression({
  threshold: 1024, // Compress responses over 1KB
  level: 6
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'If-None-Match']
}));

app.use(express.json({ limit: '10mb' }));
app.set('etag', 'strong'); // Enable ETags for browser 304 caching

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ipos', ipoRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/buy', buyRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/backup', backupRoutes);

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

// Setup Automated Daily Midnight Backup Cron (00:00 AM)
const setupBackupCron = () => {
  const isAutoBackupEnabled = process.env.ENABLE_AUTO_BACKUP === 'true';
  if (!isAutoBackupEnabled) {
    console.log('ℹ️ [Cron] Automated database backup is disabled (ENABLE_AUTO_BACKUP != true)');
    return;
  }

  // Runs every day at 00:00 midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('⏰ [Cron] Triggering scheduled midnight database backup...');
    try {
      const dump = await dumpDatabase();
      let driveRes = null;
      try {
        driveRes = await uploadBackupToDrive(dump.gzPath, dump.filename);
        await cleanOldDriveBackups();
        console.log('✅ [Cron] Daily backup uploaded to Google Drive successfully.');
      } catch (driveErr) {
        console.warn('⚠️ [Cron] Google Drive upload failed:', driveErr.message);
      }

      await recordBackupLog({
        filename: dump.filename,
        sizeBytes: dump.sizeBytes,
        driveFileId: driveRes?.id || null,
        status: driveRes ? 'success' : 'local',
        source: 'cron'
      });
    } catch (dumpErr) {
      console.error('❌ [Cron] Automated backup failed:', dumpErr.message);
    }
  });

  console.log('🕒 [Cron] Automated daily backup scheduled for 00:00 (Midnight) every day');
};

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDatabase();
    setupBackupCron();
});


