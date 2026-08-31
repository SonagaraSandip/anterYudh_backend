import express from 'express';
import db from '../../config/db.js';

const router = express.Router();

// GET all transactions (filtered optionally by month/year or type)
router.get('/', async (req, res) => {
  try {
    const { month, year, type } = req.query;
    let query = 'SELECT * FROM cashflow_transactions';
    const params = [];
    const conditions = [];

    if (type && (type === 'expense' || type === 'income')) {
      conditions.push('type = ?');
      params.push(type);
    }

    if (year) {
      conditions.push('YEAR(transactionDate) = ?');
      params.push(parseInt(year, 10));
    }

    if (month) {
      conditions.push('MONTH(transactionDate) = ?');
      params.push(parseInt(month, 10));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY transactionDate DESC, id DESC';

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
    const { type, title, category, amount, paymentMode, notes, transactionDate } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title / Description is required' });
    }

    const cleanAmount = parseFloat(amount) || 0;
    const cleanType = type === 'income' ? 'income' : 'expense';
    const cleanCategory = (category || (cleanType === 'income' ? 'Salary' : 'General')).trim();
    const cleanPaymentMode = (paymentMode || 'UPI / GPay').trim();

    // Format transactionDate properly for MySQL DATETIME
    let finalDate = new Date();
    if (transactionDate) {
      const parsed = new Date(transactionDate);
      if (!isNaN(parsed.getTime())) {
        finalDate = parsed;
      }
    }
    const formattedDate = finalDate.toISOString().slice(0, 19).replace('T', ' ');

    const [result] = await db.query(
      `INSERT INTO cashflow_transactions 
        (type, title, category, amount, paymentMode, notes, transactionDate) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cleanType, title.trim(), cleanCategory, cleanAmount, cleanPaymentMode, notes || '', formattedDate]
    );

    const [created] = await db.query(
      'SELECT * FROM cashflow_transactions WHERE id = ?',
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
    const { type, title, category, amount, paymentMode, notes, transactionDate } = req.body;

    const updates = [];
    const params = [];

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
      const parsed = new Date(transactionDate);
      const formattedDate = !isNaN(parsed.getTime())
        ? parsed.toISOString().slice(0, 19).replace('T', ' ')
        : new Date().toISOString().slice(0, 19).replace('T', ' ');
      updates.push('transactionDate = ?');
      params.push(formattedDate);
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
      'SELECT * FROM cashflow_transactions WHERE id = ?',
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
