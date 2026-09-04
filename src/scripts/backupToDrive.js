import dotenv from 'dotenv';
import { dumpDatabase } from '../utils/dbDumper.js';
import { uploadBackupToDrive, cleanOldDriveBackups } from '../utils/googleDrive.js';
import { activeDbName } from '../../config/db.js';

dotenv.config();

async function runBackup() {
  console.log(`=======================================================`);
  console.log(`🚀 Starting Database Backup: ${activeDbName}`);
  console.log(`=======================================================`);

  const startTime = Date.now();
  try {
    // 1. Export & Gzip
    const dumpResult = await dumpDatabase();

    // 2. Upload to Google Drive if credentials exist
    let driveResult = null;
    try {
      driveResult = await uploadBackupToDrive(dumpResult.gzPath, dumpResult.filename);
      // 3. Clean up retention
      await cleanOldDriveBackups();
    } catch (driveErr) {
      console.warn(`⚠️ Google Drive upload skipped/failed: ${driveErr.message}`);
      console.warn(`Local backup is safely stored at: ${dumpResult.gzPath}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`=======================================================`);
    console.log(`✨ Backup process completed in ${duration}s`);
    console.log(`Local archive: ${dumpResult.gzPath}`);
    if (driveResult) {
      console.log(`Google Drive File ID: ${driveResult.id}`);
    }
    console.log(`=======================================================`);
    process.exit(0);
  } catch (err) {
    console.error(`💥 Backup failed:`, err);
    process.exit(1);
  }
}

runBackup();
