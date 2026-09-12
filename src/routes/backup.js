import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dumpDatabase } from '../utils/dbDumper.js';
import { uploadBackupToDrive, listDriveBackups, cleanOldDriveBackups, isDriveConfigured } from '../utils/googleDrive.js';
import { restoreDatabaseFromFile } from '../utils/dbRestorer.js';
import { getLatestBackupInfo, recordBackupLog } from '../utils/backupTracker.js';
import { checkAndRunDailyAutoBackup, isAutoBackupInProgress } from '../utils/autoBackupService.js';
import promisePool, { activeDbName } from '../../config/db.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');

/**
 * GET /api/backup/status
 * Returns Google Drive backup config, service health, and latest backup timestamp
 */
router.get('/status', async (req, res) => {
  try {
    const isConfigured = isDriveConfigured();
    const hasFolderId = !!process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
    const hasOAuth = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
    const hasInlineKey = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const hasKeyPath = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
      fs.existsSync(path.resolve(__dirname, '../../config/google-service-account.json')) ||
      fs.existsSync(path.resolve(__dirname, '../../config/google_credentials.json'));
    
    const isAutoBackupEnabled = process.env.ENABLE_AUTO_BACKUP !== 'false';
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 30;

    // Retrieve latest backup info from DB logs, Google Drive, and local filesystem
    const { lastBackupTime, lastBackupName, lastBackupSource } = await getLatestBackupInfo();
    const isRunning = isAutoBackupInProgress();

    // Check if daily backup is needed in background
    checkAndRunDailyAutoBackup('backup_status_check').catch(() => {});

    res.json({
      success: true,
      database: activeDbName,
      isConfigured,
      hasFolderId,
      hasOAuth,
      hasInlineKey,
      hasKeyPath,
      isAutoBackupEnabled,
      isAutoBackupRunning: isRunning,
      retentionDays,
      schedule: isAutoBackupEnabled ? 'Smart Daily (First online/morning launch & Midnight 00:00)' : 'Disabled',
      lastBackupTime,
      lastBackupName,
      lastBackupSource
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/backup/auto-check
 * Triggered automatically by frontend when user opens app / comes online
 */
router.post('/auto-check', async (req, res) => {
  try {
    const result = await checkAndRunDailyAutoBackup('client_online_ping');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/backup/list
 * Lists backups from both local disk, MySQL backup logs, and Google Drive
 */
router.get('/list', async (req, res) => {
  try {
    const localBackups = [];
    if (fs.existsSync(BACKUPS_DIR)) {
      const files = fs.readdirSync(BACKUPS_DIR);
      for (const f of files) {
        if (f.endsWith('.sql') || f.endsWith('.sql.gz')) {
          const stats = fs.statSync(path.join(BACKUPS_DIR, f));
          localBackups.push({
            name: f,
            sizeBytes: stats.size,
            sizeKB: (stats.size / 1024).toFixed(2),
            createdAt: stats.birthtime || stats.mtime
          });
        }
      }
    }

    let dbBackups = [];
    try {
      const [rows] = await promisePool.query(
        'SELECT * FROM backup_logs ORDER BY createdAt DESC LIMIT 20'
      );
      dbBackups = rows.map(r => ({
        id: r.id,
        name: r.filename,
        sizeBytes: r.sizeBytes,
        sizeKB: (r.sizeBytes / 1024).toFixed(2),
        driveFileId: r.driveFileId,
        status: r.status,
        source: r.source,
        createdAt: r.createdAt
      }));
    } catch {
      // Table might be initializing
    }

    let driveBackups = [];
    let driveError = null;
    if (isDriveConfigured()) {
      try {
        driveBackups = await listDriveBackups();
      } catch (dErr) {
        driveError = dErr.message;
      }
    }

    res.json({
      success: true,
      database: activeDbName,
      localBackups: localBackups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      dbBackups,
      driveBackups,
      driveError
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/backup/trigger
 * Manually creates a new backup and uploads to Google Drive, then logs to persistent DB
 */
router.post('/trigger', async (req, res) => {
  try {
    console.log(`[API] Manual backup requested for ${activeDbName}...`);
    const dumpResult = await dumpDatabase();
    
    let driveResult = null;
    let driveError = null;

    if (isDriveConfigured()) {
      try {
        driveResult = await uploadBackupToDrive(dumpResult.gzPath, dumpResult.filename);
        await cleanOldDriveBackups();
      } catch (dErr) {
        driveError = dErr.message;
        console.warn(`[API] Google Drive upload failed: ${dErr.message}`);
      }
    }

    // Persist to MySQL backup_logs table so it works across deployments & server restarts
    await recordBackupLog({
      filename: dumpResult.filename,
      sizeBytes: dumpResult.sizeBytes,
      driveFileId: driveResult?.id || null,
      status: driveResult ? 'success' : (driveError ? 'partial' : 'local'),
      source: 'manual'
    });

    res.json({
      success: true,
      message: 'Backup completed successfully!',
      localBackup: dumpResult,
      driveBackup: driveResult,
      driveError
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
