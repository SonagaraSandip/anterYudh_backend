import express from 'express';
import db from '../../config/db.js';
import { getLocalMySQLDateTime, getLocalDateString } from '../utils/dateHelper.js';

const router = express.Router();

// ==========================================
// 1. TRIP MANAGEMENT ENDPOINTS
// ==========================================

/**
 * GET /api/expenses/trips
 * Returns all trips with computed statistics (total spent, item count, category breakdown)
 */
router.get('/trips', async (req, res) => {
  try {
    const [trips] = await db.query(`
      SELECT 
        et.*,
        COALESCE(SUM(CASE WHEN ct.type = 'expense' THEN ct.amount ELSE 0 END), 0) AS totalSpent,
        COUNT(ct.id) AS expenseCount,
        MAX(ct.transactionDate) AS lastExpenseDate,
        MIN(ct.transactionDate) AS firstExpenseDate
      FROM expense_trips et
      LEFT JOIN cashflow_transactions ct ON et.id = ct.tripId
      GROUP BY et.id
      ORDER BY 
        CASE WHEN et.status = 'active' THEN 1 WHEN et.status = 'planning' THEN 2 ELSE 3 END,
        COALESCE(et.startDate, et.createdAt) DESC,
        et.id DESC
    `);

    // Fetch category breakdown for each trip
    const [categoryRows] = await db.query(`
      SELECT 
        tripId,
        category,
        SUM(amount) as categoryTotal,
        COUNT(id) as itemCount
      FROM cashflow_transactions
      WHERE tripId IS NOT NULL AND type = 'expense'
      GROUP BY tripId, category
      ORDER BY categoryTotal DESC
    `);

    const categoryMap = {};
    for (const row of categoryRows) {
      if (!categoryMap[row.tripId]) {
        categoryMap[row.tripId] = [];
      }
      categoryMap[row.tripId].push({
        category: row.category,
        total: parseFloat(row.categoryTotal) || 0,
        count: parseInt(row.itemCount, 10) || 0
      });
    }

    const enhancedTrips = trips.map((t) => ({
      ...t,
      totalSpent: parseFloat(t.totalSpent) || 0,
      budget: parseFloat(t.budget) || 0,
      expenseCount: parseInt(t.expenseCount, 10) || 0,
      startDate: t.startDate ? getLocalDateString(t.startDate) : null,
      endDate: t.endDate ? getLocalDateString(t.endDate) : null,
      categories: categoryMap[t.id] || []
    }));

    res.json(enhancedTrips);
  } catch (err) {
    console.error('Error fetching trips:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/expenses/trips/:id
 * Returns single trip details and all its itemized transactions
 */
router.get('/trips/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [trips] = await db.query('SELECT * FROM expense_trips WHERE id = ?', [id]);
    if (trips.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const trip = trips[0];
    const [transactions] = await db.query(
      `SELECT * FROM cashflow_transactions WHERE tripId = ? ORDER BY transactionDate DESC, id DESC`,
      [id]
    );

    let totalSpent = 0;
    const categoryMap = {};
    for (const tx of transactions) {
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'expense') {
        totalSpent += amt;
        categoryMap[tx.category] = (categoryMap[tx.category] || 0) + amt;
      }
    }

    const categories = Object.entries(categoryMap)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    res.json({
      ...trip,
      totalSpent,
      budget: parseFloat(trip.budget) || 0,
      expenseCount: transactions.length,
      startDate: trip.startDate ? getLocalDateString(trip.startDate) : null,
      endDate: trip.endDate ? getLocalDateString(trip.endDate) : null,
      categories,
      transactions
    });
  } catch (err) {
    console.error('Error fetching trip details:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/expenses/trips
 * Creates a new trip
 */
router.post('/trips', async (req, res) => {
  try {
    const { name, destination, startDate, endDate, budget, status, coverColor, notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Trip name is required' });
    }

    const cleanBudget = parseFloat(budget) || 0;
    const cleanStatus = ['active', 'completed', 'planning'].includes(status) ? status : 'active';
    const cleanColor = (coverColor || 'emerald').trim();
    const cleanStartDate = startDate ? getLocalDateString(startDate) : null;
    const cleanEndDate = endDate ? getLocalDateString(endDate) : null;

    const [result] = await db.query(
      `INSERT INTO expense_trips (name, destination, startDate, endDate, budget, status, coverColor, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), (destination || '').trim(), cleanStartDate, cleanEndDate, cleanBudget, cleanStatus, cleanColor, notes || '']
    );

    const [created] = await db.query('SELECT * FROM expense_trips WHERE id = ?', [result.insertId]);
    res.status(201).json({
      ...created[0],
      totalSpent: 0,
      budget: cleanBudget,
      expenseCount: 0,
      categories: []
    });
  } catch (err) {
    console.error('Error creating trip:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/expenses/trips/:id
 * Updates trip metadata
 */
router.put('/trips/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, destination, startDate, endDate, budget, status, coverColor, notes } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (destination !== undefined) {
      updates.push('destination = ?');
      params.push(destination.trim());
    }
    if (startDate !== undefined) {
      updates.push('startDate = ?');
      params.push(startDate ? getLocalDateString(startDate) : null);
    }
    if (endDate !== undefined) {
      updates.push('endDate = ?');
      params.push(endDate ? getLocalDateString(endDate) : null);
    }
    if (budget !== undefined) {
      updates.push('budget = ?');
      params.push(parseFloat(budget) || 0);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(['active', 'completed', 'planning'].includes(status) ? status : 'active');
    }
    if (coverColor !== undefined) {
      updates.push('coverColor = ?');
      params.push(coverColor.trim());
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    params.push(id);
    await db.query(`UPDATE expense_trips SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updated] = await db.query('SELECT * FROM expense_trips WHERE id = ?', [id]);
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.json(updated[0]);
  } catch (err) {
    console.error('Error updating trip:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/expenses/trips/:id
 * Deletes a trip (unlinks expenses by default, or deletes associated expenses if deleteExpenses=true)
 */
router.delete('/trips/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteExpenses = req.query.deleteExpenses === 'true';

    if (deleteExpenses) {
      await db.query('DELETE FROM cashflow_transactions WHERE tripId = ?', [id]);
    } else {
      await db.query('UPDATE cashflow_transactions SET tripId = NULL WHERE tripId = ?', [id]);
    }

    const [result] = await db.query('DELETE FROM expense_trips WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.json({ success: true, message: 'Trip deleted successfully' });
  } catch (err) {
    console.error('Error deleting trip:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. CASHFLOW TRANSACTIONS ENDPOINTS
// ==========================================

// GET all transactions (filtered optionally by month/year, type, or tripId)
router.get('/', async (req, res) => {
  try {
    const { month, year, type, tripId } = req.query;
    let query = `
      SELECT 
        ct.*,
        et.name AS tripName,
        et.destination AS tripDestination,
        et.coverColor AS tripCoverColor
      FROM cashflow_transactions ct
      LEFT JOIN expense_trips et ON ct.tripId = et.id
    `;
    const params = [];
    const conditions = [];

    if (type && (type === 'expense' || type === 'income')) {
      conditions.push('ct.type = ?');
      params.push(type);
    }

    if (tripId) {
      conditions.push('ct.tripId = ?');
      params.push(parseInt(tripId, 10));
    }

    if (year) {
      conditions.push('YEAR(ct.transactionDate) = ?');
      params.push(parseInt(year, 10));
    }

    if (month) {
      conditions.push('MONTH(ct.transactionDate) = ?');
      params.push(parseInt(month, 10));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY ct.transactionDate DESC, ct.id DESC';

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST create a new transaction (expense or income)
router.post('/', async (req, res) => {
  try {
    const { tripId, type, title, category, amount, paymentMode, notes, transactionDate } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title / Description is required' });
    }

    const cleanAmount = parseFloat(amount) || 0;
    const cleanType = type === 'income' ? 'income' : 'expense';
    const cleanCategory = (category || (cleanType === 'income' ? 'Salary' : 'General')).trim();
    const cleanPaymentMode = (paymentMode || 'UPI / GPay').trim();
    const cleanTripId = tripId ? parseInt(tripId, 10) : null;

    // Format transactionDate properly for MySQL DATETIME in local timezone
    const formattedDate = getLocalMySQLDateTime(transactionDate);

    const [result] = await db.query(
      `INSERT INTO cashflow_transactions 
        (tripId, type, title, category, amount, paymentMode, notes, transactionDate) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cleanTripId, cleanType, title.trim(), cleanCategory, cleanAmount, cleanPaymentMode, notes || '', formattedDate]
    );

    const [created] = await db.query(
      `SELECT 
        ct.*,
        et.name AS tripName,
        et.destination AS tripDestination,
        et.coverColor AS tripCoverColor
       FROM cashflow_transactions ct
       LEFT JOIN expense_trips et ON ct.tripId = et.id
       WHERE ct.id = ?`,
      [result.insertId]
    );

    res.status(201).json(created[0]);
  } catch (err) {
    console.error('Error adding transaction:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update transaction
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tripId, type, title, category, amount, paymentMode, notes, transactionDate } = req.body;

    const updates = [];
    const params = [];

    if (tripId !== undefined) {
      updates.push('tripId = ?');
      params.push(tripId ? parseInt(tripId, 10) : null);
    }
    if (type !== undefined) {
      updates.push('type = ?');
      params.push(type === 'income' ? 'income' : 'expense');
    }
    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title.trim());
    }
    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category.trim());
    }
    if (amount !== undefined) {
      updates.push('amount = ?');
      params.push(parseFloat(amount) || 0);
    }
    if (paymentMode !== undefined) {
      updates.push('paymentMode = ?');
      params.push(paymentMode.trim());
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    if (transactionDate !== undefined) {
      updates.push('transactionDate = ?');
      params.push(getLocalMySQLDateTime(transactionDate));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    params.push(id);
    await db.query(
      `UPDATE cashflow_transactions SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [updated] = await db.query(
      `SELECT 
        ct.*,
        et.name AS tripName,
        et.destination AS tripDestination,
        et.coverColor AS tripCoverColor
       FROM cashflow_transactions ct
       LEFT JOIN expense_trips et ON ct.tripId = et.id
       WHERE ct.id = ?`,
      [id]
    );

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(updated[0]);
  } catch (err) {
    console.error('Error updating transaction:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE transaction
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM cashflow_transactions WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ success: true, message: 'Transaction deleted successfully' });
  } catch (err) {
    console.error('Error deleting transaction:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

