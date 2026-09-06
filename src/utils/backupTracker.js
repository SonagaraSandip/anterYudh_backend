import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import promisePool, { activeDbName } from '../../config/db.js';
import { listDriveBackups, isDriveConfigured } from './googleDrive.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');

/**
 * Record a backup entry in the persistent MySQL backup_logs table
 */
export async function recordBackupLog({ filename, sizeBytes = 0, driveFileId = null, status = 'success', source = 'manual' }) {
  try {
    await promisePool.query(
      `INSERT INTO backup_logs (filename, sizeBytes, driveFileId, status, source, createdAt)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [filename, sizeBytes, driveFileId, status, source]
    );
    console.log(`📝 [Backup Tracker] Recorded backup in database: ${filename}`);
  } catch (err) {
    console.warn(`⚠️ [Backup Tracker] Failed to record backup log to database:`, err.message);
  }
}

/**
 * Get the latest backup information across MySQL database logs, Google Drive, and local filesystem.
 * This guarantees that backup date/time is shown accurately even on cloud/GitHub deploys with ephemeral disks.
 */
export async function getLatestBackupInfo() {
  let latestTime = null;
  let latestName = null;
  let latestSource = null;

  // 1. Check MySQL persistent backup_logs table first
  try {
    const [dbRows] = await promisePool.query(
      `SELECT * FROM backup_logs WHERE status = 'success' ORDER BY createdAt DESC LIMIT 1`
    );
    if (dbRows && dbRows.length > 0) {
      latestTime = new Date(dbRows[0].createdAt).toISOString();
      latestName = dbRows[0].filename;
      latestSource = dbRows[0].driveFileId ? 'Google Drive & DB' : 'Database Log';
    }
  } catch (err) {
    // Table may not exist yet if init is in progress
  }

  // 2. Check local disk backups directory
  try {
    if (fs.existsSync(BACKUPS_DIR)) {
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz'))
        .map(f => {
          const stats = fs.statSync(path.join(BACKUPS_DIR, f));
          return { name: f, time: stats.mtime };
        })
        .sort((a, b) => b.time - a.time);

      if (files.length > 0) {
        const localLatest = files[0];
        const localTimeIso = new Date(localLatest.time).toISOString();
        if (!latestTime || new Date(localTimeIso) > new Date(latestTime)) {
          latestTime = localTimeIso;
          latestName = localLatest.name;
          latestSource = 'Local Disk';
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [Backup Tracker] Could not read local backup dir:', err.message);
  }

  // 3. If Google Drive is configured, check Google Drive for latest file
  if (isDriveConfigured()) {
    try {
      const driveFiles = await listDriveBackups();
      if (driveFiles && driveFiles.length > 0) {
        const mostRecentDriveFile = driveFiles[0];
        const driveTime = mostRecentDriveFile.createdTime || mostRecentDriveFile.modifiedTime;
        if (driveTime) {
          const driveTimeIso = new Date(driveTime).toISOString();
          if (!latestTime || new Date(driveTimeIso) > new Date(latestTime)) {
            latestTime = driveTimeIso;
            latestName = mostRecentDriveFile.name;
            latestSource = 'Google Drive';
          }
        }
      }
    } catch (driveErr) {
      // Don't fail the request if Google Drive is temporarily unreachable
      console.warn('⚠️ [Backup Tracker] Google Drive status query skipped/failed:', driveErr.message);
    }
  }

  return {
    lastBackupTime: latestTime,
    lastBackupName: latestName,
    lastBackupSource: latestSource
  };
}
