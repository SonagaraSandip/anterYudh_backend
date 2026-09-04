import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dumpDatabase } from '../utils/dbDumper.js';
import { uploadBackupToDrive, listDriveBackups, cleanOldDriveBackups } from '../utils/googleDrive.js';
import { restoreDatabaseFromFile } from '../utils/dbRestorer.js';
import { activeDbName } from '../../config/db.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');

/**
 * GET /api/backup/status
 * Returns Google Drive backup config and service health
 */
router.get('/status', async (req, res) => {
  try {
    const hasFolderId = !!process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
    const hasOAuth = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
    const hasKeyPath = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
      fs.existsSync(path.resolve(__dirname, '../../config/google-service-account.json')) ||
      fs.existsSync(path.resolve(__dirname, '../../config/google_credentials.json'));
    
    const isConfigured = hasFolderId && (hasOAuth || hasKeyPath);
    const isAutoBackupEnabled = process.env.ENABLE_AUTO_BACKUP === 'true';
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 30;

    // Find latest backup timestamp from local directory
    let lastBackupTime = null;
    let lastBackupName = null;
    if (fs.existsSync(BACKUPS_DIR)) {
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz'))
        .map(f => ({ name: f, time: fs.statSync(path.join(BACKUPS_DIR, f)).mtime }))
        .sort((a, b) => b.time - a.time);

      if (files.length > 0) {
        lastBackupTime = files[0].time;
        lastBackupName = files[0].name;
      }
    }

    res.json({
      success: true,
      database: activeDbName,
      isConfigured,
      hasFolderId,
      hasOAuth,
      hasKeyPath,
      isAutoBackupEnabled,
      retentionDays,
      schedule: isAutoBackupEnabled ? 'Every day at 00:00 (Midnight)' : 'Disabled',
      lastBackupTime,
      lastBackupName
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/backup/list
 * Lists backups from both local disk and Google Drive
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

    let driveBackups = [];
    let driveError = null;
    try {
      driveBackups = await listDriveBackups();
    } catch (dErr) {
      driveError = dErr.message;
    }

    res.json({
      success: true,
      database: activeDbName,
      localBackups: localBackups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      driveBackups,
      driveError
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/backup/trigger
 * Manually creates a new backup and uploads to Google Drive
 */
router.post('/trigger', async (req, res) => {
  try {
    console.log(`[API] Manual backup requested for ${activeDbName}...`);
    const dumpResult = await dumpDatabase();
    
    let driveResult = null;
    let driveError = null;

    try {
      driveResult = await uploadBackupToDrive(dumpResult.gzPath, dumpResult.filename);
      await cleanOldDriveBackups();
    } catch (dErr) {
      driveError = dErr.message;
      console.warn(`[API] Google Drive upload failed: ${dErr.message}`);
    }

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
