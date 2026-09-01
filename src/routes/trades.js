import express from 'express';
import db from '../../config/db.js';

const router = express.Router();

// Helper to normalize and parse trade record
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
    res.json(rows.map(normalizeTrade));
  } catch (err) {
    console.error('Error fetching trades:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trades - Create a new trade entry (with optional transactions)
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
      notes,
      transactions
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

    let cleanTransactionsJson = null;
    if (Array.isArray(transactions) && transactions.length > 0) {
      cleanTransactionsJson = JSON.stringify(transactions);
    } else {
      // Build default initial BUY transaction leg
      cleanTransactionsJson = JSON.stringify([
        {
          id: `leg-buy-${Date.now()}`,
          type: 'BUY',
          date: cleanBuyDate,
          price: cleanBuyPrice,
          quantity: cleanQty,
          charges: cleanCharges,
          notes: notes || 'Initial Entry'
        },
        ...(cleanSellPrice ? [{
          id: `leg-sell-${Date.now() + 1}`,
          type: 'SELL',
          date: cleanSellDate || cleanBuyDate,
          price: cleanSellPrice,
          quantity: cleanQty,
          charges: 0,
          notes: 'Full Exit'
        }] : [])
      ]);
    }

    const [result] = await db.query(
      `INSERT INTO trades 
        (tradeType, assetName, buyDate, buyPrice, quantity, charges, tradeDecision, sellDate, sellPrice, notes, transactions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        notes || '',
        cleanTransactionsJson
      ]
    );

    const [created] = await db.query('SELECT * FROM trades WHERE id = ?', [result.insertId]);
    res.status(201).json(normalizeTrade(created[0]));
  } catch (err) {
    console.error('Error creating trade entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/trades/:id - Update an existing trade
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
      notes,
      transactions
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
    if (transactions !== undefined) {
      updates.push('transactions = ?');
      params.push(Array.isArray(transactions) ? JSON.stringify(transactions) : null);
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

    res.json(normalizeTrade(updated[0]));
  } catch (err) {
    console.error('Error updating trade entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trades/:id/partial-sell - Record a partial exit leg
router.post('/:id/partial-sell', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, quantity, price, charges, notes } = req.body;

    const [rows] = await db.query('SELECT * FROM trades WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    const trade = normalizeTrade(rows[0]);
    const sellQty = parseInt(quantity, 10) || 1;
    const sellPrice = parseFloat(price) || 0;
    const sellCharges = parseFloat(charges) || 0;
    const sellDate = date ? date.slice(0, 10) : new Date().toISOString().slice(0, 10);

    // Create current transactions list if empty
    let txList = Array.isArray(trade.transactions) && trade.transactions.length > 0
      ? [...trade.transactions]
      : [{
          id: `leg-buy-${Date.now() - 1000}`,
          type: 'BUY',
          date: trade.buyDate,
          price: parseFloat(trade.buyPrice) || 0,
          quantity: parseInt(trade.quantity, 10) || 1,
          charges: parseFloat(trade.charges) || 0,
          notes: trade.notes || 'Initial Entry'
        }];

    // Append new SELL leg
    txList.push({
      id: `leg-sell-${Date.now()}`,
      type: 'SELL',
      date: sellDate,
      price: sellPrice,
      quantity: sellQty,
      charges: sellCharges,
      notes: notes || 'Partial Exit'
    });

    // Compute updated aggregates
    const buyLegs = txList.filter((t) => t.type === 'BUY');
    const sellLegs = txList.filter((t) => t.type === 'SELL');

    const totalBuyQty = buyLegs.reduce((acc, l) => acc + (parseInt(l.quantity, 10) || 0), 0);
    const totalBuyCost = buyLegs.reduce((acc, l) => acc + (parseFloat(l.price) || 0) * (parseInt(l.quantity, 10) || 0), 0);
    const avgBuyPrice = totalBuyQty > 0 ? (totalBuyCost / totalBuyQty) : trade.buyPrice;

    const totalSellQty = sellLegs.reduce((acc, l) => acc + (parseInt(l.quantity, 10) || 0), 0);
    const totalSellRevenue = sellLegs.reduce((acc, l) => acc + (parseFloat(l.price) || 0) * (parseInt(l.quantity, 10) || 0), 0);
    const avgSellPrice = totalSellQty > 0 ? (totalSellRevenue / totalSellQty) : null;
    const latestSellDate = sellLegs.length > 0 ? sellLegs[sellLegs.length - 1].date : null;

    const totalCharges = txList.reduce((acc, l) => acc + (parseFloat(l.charges) || 0), 0);

    await db.query(
      `UPDATE trades SET 
        quantity = ?,
        buyPrice = ?,
        sellDate = ?,
        sellPrice = ?,
        charges = ?,
        transactions = ?
       WHERE id = ?`,
      [
        totalBuyQty || trade.quantity,
        avgBuyPrice,
        latestSellDate,
        avgSellPrice,
        totalCharges,
        JSON.stringify(txList),
        id
      ]
    );

    const [updated] = await db.query('SELECT * FROM trades WHERE id = ?', [id]);
    res.json(normalizeTrade(updated[0]));
  } catch (err) {
    console.error('Error adding partial sell:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trades/:id/partial-buy - Record a partial buy / accumulation leg
router.post('/:id/partial-buy', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, quantity, price, charges, notes } = req.body;

    const [rows] = await db.query('SELECT * FROM trades WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    const trade = normalizeTrade(rows[0]);
    const buyQty = parseInt(quantity, 10) || 1;
    const buyPrice = parseFloat(price) || 0;
    const buyCharges = parseFloat(charges) || 0;
    const buyDate = date ? date.slice(0, 10) : new Date().toISOString().slice(0, 10);

    let txList = Array.isArray(trade.transactions) && trade.transactions.length > 0
      ? [...trade.transactions]
      : [{
          id: `leg-buy-${Date.now() - 1000}`,
          type: 'BUY',
          date: trade.buyDate,
          price: parseFloat(trade.buyPrice) || 0,
          quantity: parseInt(trade.quantity, 10) || 1,
          charges: parseFloat(trade.charges) || 0,
          notes: trade.notes || 'Initial Entry'
        }];

    txList.push({
      id: `leg-buy-${Date.now()}`,
      type: 'BUY',
      date: buyDate,
      price: buyPrice,
      quantity: buyQty,
      charges: buyCharges,
      notes: notes || 'Additional Buy (Averaging)'
    });

    const buyLegs = txList.filter((t) => t.type === 'BUY');
    const sellLegs = txList.filter((t) => t.type === 'SELL');

    const totalBuyQty = buyLegs.reduce((acc, l) => acc + (parseInt(l.quantity, 10) || 0), 0);
    const totalBuyCost = buyLegs.reduce((acc, l) => acc + (parseFloat(l.price) || 0) * (parseInt(l.quantity, 10) || 0), 0);
    const avgBuyPrice = totalBuyQty > 0 ? (totalBuyCost / totalBuyQty) : trade.buyPrice;
    const earliestBuyDate = buyLegs[0]?.date || trade.buyDate;

    const totalSellQty = sellLegs.reduce((acc, l) => acc + (parseInt(l.quantity, 10) || 0), 0);
    const totalSellRevenue = sellLegs.reduce((acc, l) => acc + (parseFloat(l.price) || 0) * (parseInt(l.quantity, 10) || 0), 0);
    const avgSellPrice = totalSellQty > 0 ? (totalSellRevenue / totalSellQty) : null;
    const latestSellDate = sellLegs.length > 0 ? sellLegs[sellLegs.length - 1].date : null;

    const totalCharges = txList.reduce((acc, l) => acc + (parseFloat(l.charges) || 0), 0);

    await db.query(
      `UPDATE trades SET 
        buyDate = ?,
        quantity = ?,
        buyPrice = ?,
        sellDate = ?,
        sellPrice = ?,
        charges = ?,
        transactions = ?
       WHERE id = ?`,
      [
        earliestBuyDate,
        totalBuyQty,
        avgBuyPrice,
        latestSellDate,
        avgSellPrice,
        totalCharges,
        JSON.stringify(txList),
        id
      ]
    );

    const [updated] = await db.query('SELECT * FROM trades WHERE id = ?', [id]);
    res.json(normalizeTrade(updated[0]));
  } catch (err) {
    console.error('Error adding partial buy:', err);
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
