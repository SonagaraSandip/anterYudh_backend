import express from 'express';
import db from '../../config/db.js';

const router = express.Router();

// GET /api/trades with filtering (?month=, ?quarter=, ?search=, ?year=, ?tradeType=)
router.get('/', async (req, res) => {
  try {
    const { month, quarter, search, year, tradeType } = req.query;
    let query = 'SELECT * FROM trades';
    const params = [];
    const conditions = [];

    // Trade Type Filter
    if (tradeType && (tradeType === 'stock' || tradeType === 'intraday')) {
      conditions.push('tradeType = ?');
      params.push(tradeType);
    }

    // Search by Asset Name or Trade Decision
    if (search && search.trim()) {
      conditions.push('(assetName LIKE ? OR tradeDecision LIKE ? OR notes LIKE ?)');
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    // Year Filter
    if (year) {
      conditions.push('YEAR(buyDate) = ?');
      params.push(parseInt(year, 10));
    }

    // Month Filter (Accepts '1'-'12' or 'YYYY-MM')
    if (month && month !== 'all') {
      if (month.includes('-')) {
        const [yStr, mStr] = month.split('-');
        conditions.push('YEAR(buyDate) = ? AND MONTH(buyDate) = ?');
        params.push(parseInt(yStr, 10), parseInt(mStr, 10));
      } else {
        conditions.push('MONTH(buyDate) = ?');
        params.push(parseInt(month, 10));
      }
    }

    // Quarter Filter (Q1: 1-3, Q2: 4-6, Q3: 7-9, Q4: 10-12)
    if (quarter && quarter !== 'all') {
      let qNum = parseInt(String(quarter).replace(/\D/g, ''), 10);
      if (qNum >= 1 && qNum <= 4) {
        const quarterMonths = {
          1: [1, 2, 3],
          2: [4, 5, 6],
          3: [7, 8, 9],
          4: [10, 11, 12]
        };
        const mList = quarterMonths[qNum];
        conditions.push(`MONTH(buyDate) IN (${mList.join(',')})`);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY buyDate DESC, id DESC';

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching trades:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trades - Create a new trade entry
router.post('/', async (req, res) => {
  try {
    const {
      tradeType,
      assetName,
      buyDate,
      buyPrice,
      quantity,
      charges,
      tradeDecision,
      sellDate,
      sellPrice,
      notes
    } = req.body;

    if (!assetName || !assetName.trim()) {
      return res.status(400).json({ error: 'Asset Name is required' });
    }

    const cleanTradeType = tradeType === 'intraday' ? 'intraday' : 'stock';
    const cleanAssetName = assetName.trim().toUpperCase();
    const cleanBuyDate = buyDate ? buyDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const cleanBuyPrice = parseFloat(buyPrice) || 0;
    const cleanQty = parseInt(quantity, 10) || 1;
    const cleanCharges = parseFloat(charges) || 0;
    const cleanDecision = (tradeDecision || 'Self').trim();
    const cleanSellDate = sellDate ? sellDate.slice(0, 10) : null;
    const cleanSellPrice = sellPrice !== undefined && sellPrice !== null && sellPrice !== ''
      ? parseFloat(sellPrice)
      : null;

    const [result] = await db.query(
      `INSERT INTO trades 
        (tradeType, assetName, buyDate, buyPrice, quantity, charges, tradeDecision, sellDate, sellPrice, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanTradeType,
        cleanAssetName,
        cleanBuyDate,
        cleanBuyPrice,
        cleanQty,
        cleanCharges,
        cleanDecision,
        cleanSellDate,
        cleanSellPrice,
        notes || ''
      ]
    );

    const [created] = await db.query('SELECT * FROM trades WHERE id = ?', [result.insertId]);
    res.status(201).json(created[0]);
  } catch (err) {
    console.error('Error creating trade entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/trades/:id - Update an existing trade (e.g. exiting trade or updating details)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tradeType,
      assetName,
      buyDate,
      buyPrice,
      quantity,
      charges,
      tradeDecision,
      sellDate,
      sellPrice,
      notes
    } = req.body;

    const updates = [];
    const params = [];

    if (tradeType !== undefined) {
      updates.push('tradeType = ?');
      params.push(tradeType === 'intraday' ? 'intraday' : 'stock');
    }
    if (assetName !== undefined) {
      updates.push('assetName = ?');
      params.push(assetName.trim().toUpperCase());
    }
    if (buyDate !== undefined) {
      updates.push('buyDate = ?');
      params.push(buyDate ? buyDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
    }
    if (buyPrice !== undefined) {
      updates.push('buyPrice = ?');
      params.push(parseFloat(buyPrice) || 0);
    }
    if (quantity !== undefined) {
      updates.push('quantity = ?');
      params.push(parseInt(quantity, 10) || 1);
    }
    if (charges !== undefined) {
      updates.push('charges = ?');
      params.push(parseFloat(charges) || 0);
    }
    if (tradeDecision !== undefined) {
      updates.push('tradeDecision = ?');
      params.push(tradeDecision.trim());
    }
    if (sellDate !== undefined) {
      updates.push('sellDate = ?');
      params.push(sellDate ? sellDate.slice(0, 10) : null);
    }
    if (sellPrice !== undefined) {
      updates.push('sellPrice = ?');
      params.push(
        sellPrice !== null && sellPrice !== '' ? parseFloat(sellPrice) : null
      );
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    params.push(id);
    await db.query(`UPDATE trades SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updated] = await db.query('SELECT * FROM trades WHERE id = ?', [id]);
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    res.json(updated[0]);
  } catch (err) {
    console.error('Error updating trade entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/trades/:id - Remove a trade entry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM trades WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json({ success: true, message: 'Trade deleted successfully' });
  } catch (err) {
    console.error('Error deleting trade entry:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
