import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the service account JSON key file path
 */
function getServiceAccountKeyPath() {
  const customPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (customPath) {
    const resolved = path.resolve(process.cwd(), customPath);
    if (fs.existsSync(resolved)) return resolved;
  }

  // Common fallbacks in backend/config
  const candidate1 = path.resolve(__dirname, '../../config/google-service-account.json');
  if (fs.existsSync(candidate1)) return candidate1;

  const candidate2 = path.resolve(__dirname, '../../config/google_credentials.json');
  if (fs.existsSync(candidate2)) return candidate2;

  throw new Error(
    'Google Service Account key file not found! Please place your JSON key at backend/config/google-service-account.json or set GOOGLE_SERVICE_ACCOUNT_KEY_PATH in .env'
  );
}

/**
 * Initializes and returns an authenticated Google Drive client
 * Supports both OAuth2 Refresh Token (recommended for personal Gmail 15GB storage)
 * and Google Cloud Service Account.
 */
export function getDriveClient() {
  // Option 1: OAuth2 Refresh Token (Best for personal @gmail.com accounts)
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:5000/oauth2callback'
    );
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    return google.drive({ version: 'v3', auth: oauth2Client });
  }

  // Option 2: Service Account Key JSON
  const keyFilePath = getServiceAccountKeyPath();
  const auth = new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  return google.drive({ version: 'v3', auth });
}


/**
 * Uploads a local backup file to Google Drive folder
 * @param {string} filePath - Absolute path to local file (.sql.gz or .sql)
 * @param {string} fileName - Destination name
 * @returns {Promise<{ id: string, name: string, size: string, webViewLink: string }>}
 */
export async function uploadBackupToDrive(filePath, fileName) {
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_BACKUP_FOLDER_ID is missing in .env');
  }

  const drive = getDriveClient();
  const fileMetadata = {
    name: fileName || path.basename(filePath),
    parents: [folderId]
  };

  const media = {
    mimeType: fileName.endsWith('.gz') ? 'application/gzip' : 'application/sql',
    body: fs.createReadStream(filePath)
  };

  console.log(`☁️  [Google Drive] Uploading ${fileMetadata.name} to Drive folder [${folderId}]...`);

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, size, createdTime, webViewLink',
    supportsAllDrives: true
  });

  console.log(`✅ [Google Drive] Upload successful! File ID: ${response.data.id}`);
  return response.data;
}

/**
 * Lists all database backup files in the Google Drive backup folder
 */
export async function listDriveBackups() {
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_BACKUP_FOLDER_ID is missing in .env');
  }

  const drive = getDriveClient();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, size, createdTime, modifiedTime, webViewLink)',
    orderBy: 'createdTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  return response.data.files || [];
}

/**
 * Downloads a backup file from Google Drive to a local file path
 * @param {string} fileId - Google Drive file ID
 * @param {string} destPath - Destination file path on local disk
 */
export async function downloadDriveBackup(fileId, destPath) {
  const drive = getDriveClient();
  console.log(`📥 [Google Drive] Downloading file ID: ${fileId} to ${destPath}...`);

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const destStream = fs.createWriteStream(destPath);
  const res = await drive.files.get(
    { fileId: fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    res.data
      .on('end', () => {
        console.log(`✅ [Google Drive] Download complete: ${destPath}`);
        resolve(destPath);
      })
      .on('error', err => {
        console.error('❌ [Google Drive] Download error:', err);
        reject(err);
      })
      .pipe(destStream);
  });
}

/**
 * Cleans up Google Drive backups older than the retention threshold
 * @param {number} retentionDays - Number of days to keep (default from env or 30)
 */
export async function cleanOldDriveBackups(retentionDays) {
  const days = parseInt(retentionDays || process.env.BACKUP_RETENTION_DAYS, 10) || 30;
  const drive = getDriveClient();
  const files = await listDriveBackups();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  console.log(`🧹 [Google Drive] Checking retention (${days} days cutoff: ${cutoffDate.toISOString()})...`);

  let deletedCount = 0;
  for (const file of files) {
    const fileCreated = new Date(file.createdTime);
    if (fileCreated < cutoffDate) {
      console.log(`  🗑️ Deleting expired backup from Google Drive: ${file.name} (Created: ${file.createdTime})`);
      try {
        await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
        deletedCount++;
      } catch (err) {
        console.warn(`  ⚠️ Failed to delete ${file.id}: ${err.message}`);
      }
    }
  }

  console.log(`✅ [Google Drive] Retention check complete. ${deletedCount} expired backup(s) removed.`);
  return { deletedCount };
}

