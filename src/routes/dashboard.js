import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { activeDbName } from '../../config/db.js';
import { getLatestBackupInfo } from '../utils/backupTracker.js';
import { isDriveConfigured } from '../utils/googleDrive.js';
import { checkAndRunDailyAutoBackup } from '../utils/autoBackupService.js';

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

// Helper to normalize application row with clean types and parsed JSON transactions
const normalizeApplication = (app) => {
  if (!app) return null;
  let parsedTransactions = [];
  try {
    if (typeof app.transactions === 'string') {
      parsedTransactions = JSON.parse(app.transactions || '[]');
    } else if (Array.isArray(app.transactions)) {
      parsedTransactions = app.transactions;
    }
  } catch {
    parsedTransactions = [];
  }

  return {
    ...app,
    applied: Boolean(app.applied),
    allotted: Boolean(app.allotted),
    category: app.category || 'Retail',
    allottedShares: app.allottedShares !== undefined && app.allottedShares !== null ? parseInt(app.allottedShares, 10) || 0 : 0,
    allottedPrice: app.allottedPrice !== undefined && app.allottedPrice !== null ? parseFloat(app.allottedPrice) || 0 : 0,
    sellPrice: app.sellPrice !== undefined && app.sellPrice !== null && app.sellPrice !== '' ? parseFloat(app.sellPrice) : null,
    sellDate: app.sellDate ? String(app.sellDate).slice(0, 10) : null,
    charges: app.charges !== undefined && app.charges !== null ? parseFloat(app.charges) || 0 : 0,
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
      [tripsRows],
      [notesRows],
      [buyRows],
      skillsResult,
      booksResult
    ] = await Promise.all([
      db.query('SELECT * FROM ipos ORDER BY id DESC'),
      db.query('SELECT * FROM ipo_applications ORDER BY id ASC'),
      db.query('SELECT * FROM trades ORDER BY buyDate DESC, id DESC'),
      db.query(`
        SELECT 
          ct.*,
          et.name AS tripName,
          et.destination AS tripDestination,
          et.coverColor AS tripCoverColor
        FROM cashflow_transactions ct
        LEFT JOIN expense_trips et ON ct.tripId = et.id
        ORDER BY ct.transactionDate DESC, ct.id DESC
      `),
      db.query(`
        SELECT 
          et.*,
          COALESCE(SUM(CASE WHEN ct.type = 'expense' THEN ct.amount ELSE 0 END), 0) AS totalSpent,
          COUNT(ct.id) AS expenseCount
        FROM expense_trips et
        LEFT JOIN cashflow_transactions ct ON et.id = ct.tripId
        GROUP BY et.id
        ORDER BY et.startDate DESC, et.id DESC
      `),
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
        .map(normalizeApplication)
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

    // Asynchronously verify/trigger today's catch-up auto backup in background
    checkAndRunDailyAutoBackup('dashboard_open').catch(() => {});

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ipos,
      trades,
      expenses: expensesRows,
      trips: tripsRows,
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
