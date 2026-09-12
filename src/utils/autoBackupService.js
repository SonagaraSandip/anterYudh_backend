import { dumpDatabase } from './dbDumper.js';
import { uploadBackupToDrive, cleanOldDriveBackups, isDriveConfigured } from './googleDrive.js';
import { getLatestBackupInfo, recordBackupLog } from './backupTracker.js';

let isAutoBackupRunning = false;
let lastAutoCheckTime = 0;

/**
 * Intelligent Catch-Up & Daily Auto-Backup Service
 * Runs automatically when:
 * 1. Server starts up
 * 2. User opens the app/website in the morning or anytime online
 * 3. Scheduled midnight cron
 * 
 * Guarantees that even if the computer/server was off or asleep at midnight,
 * the very first time the user comes online today, today's backup is securely taken!
 */
export async function checkAndRunDailyAutoBackup(triggerReason = 'user_online') {
  const isAutoBackupEnabled = process.env.ENABLE_AUTO_BACKUP !== 'false';
  if (!isAutoBackupEnabled) {
    return { triggered: false, reason: 'disabled' };
  }

  if (isAutoBackupRunning) {
    return { triggered: false, reason: 'already_running' };
  }

  // Throttle check queries to once every 2 minutes
  const now = new Date();
  if (Date.now() - lastAutoCheckTime < 2 * 60 * 1000) {
    return { triggered: false, reason: 'throttled' };
  }
  lastAutoCheckTime = Date.now();

  try {
    const { lastBackupTime } = await getLatestBackupInfo();
    let needsBackup = false;

    if (!lastBackupTime) {
      needsBackup = true;
    } else {
      const lastDate = new Date(lastBackupTime);
      const hoursSinceLastBackup = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);

      // Local calendar date comparison (e.g. YYYY-MM-DD in user's timezone)
      const lastDayStr = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`;
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      // If no backup has occurred on today's calendar date AND at least 4 hours elapsed since last backup (or > 20h)
      if (lastDayStr !== todayStr && hoursSinceLastBackup >= 4) {
        needsBackup = true;
      } else if (hoursSinceLastBackup >= 20) {
        needsBackup = true;
      }
    }

    if (!needsBackup) {
      return {
        triggered: false,
        reason: 'already_backed_up_today',
        lastBackupTime
      };
    }

    console.log(`🚀 [Auto-Backup] Catch-up triggered (Reason: ${triggerReason}, Last Backup: ${lastBackupTime || 'Never'}). Executing in background...`);
    isAutoBackupRunning = true;

    // Execute dump, upload, retention cleanup and logging asynchronously
    (async () => {
      try {
        const dumpResult = await dumpDatabase();
        let driveResult = null;
        let driveError = null;

        if (isDriveConfigured()) {
          try {
            driveResult = await uploadBackupToDrive(dumpResult.gzPath, dumpResult.filename);
            await cleanOldDriveBackups();
            console.log(`☁️ [Auto-Backup] Uploaded to Google Drive successfully: ${dumpResult.filename}`);
          } catch (dErr) {
            driveError = dErr.message;
            console.warn(`⚠️ [Auto-Backup] Google Drive upload failed: ${dErr.message}`);
          }
        }

        await recordBackupLog({
          filename: dumpResult.filename,
          sizeBytes: dumpResult.sizeBytes,
          driveFileId: driveResult?.id || null,
          status: driveResult ? 'success' : (driveError ? 'partial' : 'local'),
          source: triggerReason === 'midnight_cron' ? 'cron' : 'auto_on_open'
        });

        console.log(`🎉 [Auto-Backup] Daily backup completed and logged successfully!`);
      } catch (err) {
        console.error(`❌ [Auto-Backup] Error during automated backup execution:`, err.message);
      } finally {
        isAutoBackupRunning = false;
      }
    })();

    return {
      triggered: true,
      reason: 'running_in_background',
      triggerReason
    };
  } catch (err) {
    isAutoBackupRunning = false;
    console.warn(`⚠️ [Auto-Backup] Error evaluating backup schedule:`, err.message);
    return { triggered: false, error: err.message };
  }
}

export function isAutoBackupInProgress() {
  return isAutoBackupRunning;
}
