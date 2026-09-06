import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { activeDbName } from '../../config/db.js';
import { getLatestBackupInfo } from '../utils/backupTracker.js';
import { isDriveConfigured } from '../utils/googleDrive.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');

// Helper to normalize trade transactions JSON
const normalizeTrade = (row) => {
  if (!row) return null;
  let parsedTransactions = [];
  try {
    if (typeof row.transactions === 'string') {
      parsedTransactions = JSON.parse(row.transactions || '[]');
    } else if (Array.isArray(row.transactions)) {
      parsedTransactions = row.transactions;
    }
  } catch {
    parsedTransactions = [];
  }
  return {
    ...row,
    transactions: parsedTransactions
  };
};

/**
 * GET /api/dashboard/summary
 * Returns combined data for MainDashboard in 1 single compressed fast round-trip
 */
router.get('/summary', async (req, res) => {
  try {
    // 1. Fetch all datasets from MySQL in parallel
    const [
      [iposRows],
      [appsRows],
      [tradesRows],
      [expensesRows],
      [notesRows],
      [buyRows],
      skillsResult,
      booksResult
    ] = await Promise.all([
      db.query('SELECT * FROM ipos ORDER BY id DESC'),
      db.query('SELECT * FROM ipo_applications ORDER BY id ASC'),
      db.query('SELECT * FROM trades ORDER BY buyDate DESC, id DESC'),
      db.query('SELECT * FROM cashflow_transactions ORDER BY transactionDate DESC, id DESC'),
      db.query('SELECT * FROM personal_notes ORDER BY isPinned DESC, updatedAt DESC, id DESC'),
      db.query("SELECT * FROM personal_buy_items ORDER BY FIELD(priority, 'High', 'Medium', 'Low'), updatedAt DESC, id DESC"),
      db.query("SELECT * FROM learning_skills ORDER BY FIELD(status, 'Learning', 'Planned', 'Completed'), FIELD(priority, 'High', 'Medium', 'Low'), updatedAt DESC").catch(() => [[]]),
      db.query("SELECT * FROM reading_books ORDER BY FIELD(status, 'Reading', 'Want to Read', 'Completed'), FIELD(priority, 'High', 'Medium', 'Low'), updatedAt DESC").catch(() => [[]])
    ]);

    const skillsRows = skillsResult ? skillsResult[0] || [] : [];
    const booksRows = booksResult ? booksResult[0] || [] : [];

    // 2. Map IPO applications
    const ipos = iposRows.map((ipo) => ({
      ...ipo,
      applications: appsRows
        .filter((app) => app.ipoId === ipo.id)
        .map((app) => ({
          ...app,
          applied: Boolean(app.applied),
          allotted: Boolean(app.allotted),
          category: app.category || 'Retail'
        }))
    }));

    // 3. Normalize trades
    const trades = tradesRows.map(normalizeTrade);

    // 4. Compute Backup Quick Status across DB logs, Google Drive, and local filesystem
    const { lastBackupTime, lastBackupName, lastBackupSource } = await getLatestBackupInfo();
    const isConfigured = isDriveConfigured();
    const hasFolderId = !!process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
    const hasOAuth = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
    const hasInlineKey = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const hasKeyPath = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
      fs.existsSync(path.resolve(__dirname, '../../config/google-service-account.json')) ||
      fs.existsSync(path.resolve(__dirname, '../../config/google_credentials.json'));
    const isAutoBackupEnabled = process.env.ENABLE_AUTO_BACKUP === 'true';

    const backupStatus = {
      success: true,
      database: activeDbName,
      isConfigured,
      hasFolderId,
      hasOAuth,
      hasInlineKey,
      hasKeyPath,
      isAutoBackupEnabled,
      schedule: isAutoBackupEnabled ? 'Every day at 00:00 (Midnight)' : 'Disabled',
      lastBackupTime,
      lastBackupName,
      lastBackupSource
    };

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ipos,
      trades,
      expenses: expensesRows,
      notes: notesRows,
      buyItems: buyRows,
      skills: skillsRows,
      books: booksRows,
      backupStatus
    });
  } catch (err) {
    console.error('Error fetching dashboard summary:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
