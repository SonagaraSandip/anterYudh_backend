import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { restoreDatabaseFromFile } from '../utils/dbRestorer.js';
import { listDriveBackups, downloadDriveBackup } from '../utils/googleDrive.js';
import { activeDbName } from '../../config/db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');

async function runRestore() {
  const args = process.argv.slice(2);
  let targetFilePath = args[0];

  console.log(`=======================================================`);
  console.log(`🚀 Database Restore Tool: [${activeDbName}]`);
  console.log(`=======================================================`);

  try {
    // Case 1: Direct file specified
    if (targetFilePath && fs.existsSync(targetFilePath)) {
      console.log(`Restoring from specified local file: ${targetFilePath}`);
      await restoreDatabaseFromFile(targetFilePath);
      console.log(`🎉 Restore completed successfully!`);
      process.exit(0);
    }

    // Case 2: Check local backups folder first
    if (!targetFilePath && fs.existsSync(BACKUPS_DIR)) {
      const localFiles = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz'))
        .sort()
        .reverse();

      if (localFiles.length > 0) {
        const latestLocal = path.join(BACKUPS_DIR, localFiles[0]);
        console.log(`Found latest local backup: ${latestLocal}`);
        await restoreDatabaseFromFile(latestLocal);
        console.log(`🎉 Restore completed successfully!`);
        process.exit(0);
      }
    }

    // Case 3: Fetch latest from Google Drive
    console.log(`No local backup found or explicit file specified. Checking Google Drive...`);
    const driveBackups = await listDriveBackups();
    if (!driveBackups || driveBackups.length === 0) {
      throw new Error('No backups found in Google Drive folder or local backups directory.');
    }

    const latestDriveFile = driveBackups[0];
    console.log(`Latest backup on Google Drive: ${latestDriveFile.name} (ID: ${latestDriveFile.id})`);

    const downloadDest = path.join(BACKUPS_DIR, latestDriveFile.name);
    await downloadDriveBackup(latestDriveFile.id, downloadDest);

    await restoreDatabaseFromFile(downloadDest);
    console.log(`🎉 Restore from Google Drive backup completed successfully!`);
    process.exit(0);
  } catch (err) {
    console.error(`💥 Restore failed:`, err.message);
    process.exit(1);
  }
}

runRestore();
