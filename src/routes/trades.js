import express from 'express';
import db from '../../config/db.js';
import { getLocalDateString } from '../utils/dateHelper.js';

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
    tradeType: (row.tradeType === 'intraday' || row.tradeType === 'mtf') ? row.tradeType : 'stock',
    mtfFundedAmount: parseFloat(row.mtfFundedAmount) || 0,
    transactions: parsedTransactions
  };
};

/**
 * Standard Equity Charges Auto-Calculator (Brokerage, STT, Exchange, SEBI, IPFT, GST, Stamp Duty, DP)
 * Official Groww pricing (Sept 2026):
 * - Delivery (CNC): 0.1% or ₹20 max (min ₹5), 0.1% STT (Buy & Sell), 0.015% Stamp Duty (Buy), ₹20 DP (Sell), 18% GST
 * - Intraday (MIS): 0.1% or ₹20 max (min ₹5), 0.025% STT (Sell only), 0.003% Stamp Duty (Buy), 0 DP, 18% GST
 * - MTF (Margin Trade): 0.1% (NO CAP, min ₹5), 0.1% STT (Buy & Sell), 0.015% Stamp Duty (Buy), ₹20 DP (Sell), 18% GST
 * - Regulatory: Exchange (0.00297%), SEBI (0.0001%), IPFT (0.0001%)
 */
export const calculateTradeCharges = (quantity, price, tradeType = 'stock', isBuy = true) => {
  const qty = parseFloat(quantity) || 0;
  const prc = parseFloat(price) || 0;
  const tradeValue = qty * prc;
  if (tradeValue <= 0) return 0;

  const isIntraday = tradeType === 'intraday';
  const isMtf = tradeType === 'mtf';

  // Brokerage:
  // - Delivery & Intraday: 0.1% of trade value, min ₹5, max ₹20 per order
  // - MTF: 0.1% of trade value, min ₹5, NO CAP
  let brokerage = 0;
  if (isMtf) {
    brokerage = Math.max(5, tradeValue * 0.001);
  } else {
    brokerage = Math.max(5, Math.min(20, tradeValue * 0.001));
  }

  // Exchange Turnover Charge (NSE): 0.00297%
  const exchangeCharge = tradeValue * 0.0000297;

  // SEBI Turnover Fee: 0.0001% (₹10 / crore)
  const sebiCharge = tradeValue * 0.000001;

  // IPFT (NSE): 0.0001% (₹10 / crore)
  const ipftCharge = tradeValue * 0.000001;

  let stampDuty = 0;
  let stt = 0;
  let dpCharge = 0;

  if (isIntraday) {
    // Intraday (MIS)
    stampDuty = isBuy ? (tradeValue * 0.00003) : 0;
    stt = isBuy ? 0 : (tradeValue * 0.00025);
    dpCharge = 0;
  } else {
    // Delivery (CNC) & MTF
    stampDuty = isBuy ? (tradeValue * 0.00015) : 0;
    stt = tradeValue * 0.001;
    dpCharge = !isBuy ? 20.00 : 0;
  }

  // GST: 18% on (Brokerage + Exchange Charge + SEBI Fee + IPFT Fee)
  const gst = 0.18 * (brokerage + exchangeCharge + sebiCharge + ipftCharge);

  const totalCharges = brokerage + exchangeCharge + sebiCharge + ipftCharge + gst + stampDuty + stt + dpCharge;
  return Math.round(totalCharges * 100) / 100;
};

/**
 * MTF Daily & Total Holding Interest Calculator
 * Annual Interest Rate: 14.95% on funded amount
 */
export const calculateMtfInterest = (fundedAmount, holdingDays = 0, annualRate = 14.95) => {
  const funded = parseFloat(fundedAmount) || 0;
  const days = Math.max(0, parseInt(holdingDays, 10) || 0);
  if (funded <= 0 || days <= 0) return 0;
  const dailyRate = (annualRate / 100) / 365;
  return Math.round(funded * dailyRate * days * 100) / 100;
};

// GET /api/trades with filtering (?month=, ?quarter=, ?search=, ?year=, ?tradeType=)
router.get('/', async (req, res) => {
  try {
    const { month, quarter, search, year, tradeType } = req.query;
    let query = 'SELECT * FROM trades';
    const params = [];
    const conditions = [];

    // Trade Type Filter
    if (tradeType && (tradeType === 'stock' || tradeType === 'intraday' || tradeType === 'mtf')) {
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

// POST /api/trades - Create a new trade entry (with automatic statutory charges)
router.post('/', async (req, res) => {
  try {
    const {
      tradeType,
      assetName,
      buyDate,
      buyPrice,
      quantity,
      charges,
      mtfFundedAmount,
      tradeDecision,
      sellDate,
      sellPrice,
      notes,
      transactions
    } = req.body;

    if (!assetName || !assetName.trim()) {
      return res.status(400).json({ error: 'Asset Name is required' });
    }

    const cleanTradeType = (tradeType === 'intraday' || tradeType === 'mtf') ? tradeType : 'stock';
    const cleanAssetName = assetName.trim().toUpperCase();
    const cleanBuyDate = getLocalDateString(buyDate);
    const cleanBuyPrice = parseFloat(buyPrice) || 0;
    const cleanQty = parseInt(quantity, 10) || 1;
    const cleanDecision = (tradeDecision || 'Self').trim();
    const cleanSellDate = sellDate ? getLocalDateString(sellDate) : null;
    const cleanSellPrice = sellPrice !== undefined && sellPrice !== null && sellPrice !== ''
      ? parseFloat(sellPrice)
      : null;
    const cleanMtfFunded = parseFloat(mtfFundedAmount) || (cleanTradeType === 'mtf' ? (cleanBuyPrice * cleanQty * 0.75) : 0);

    // Calculate auto charges if not manually specified (> 0)
    const rawCharges = parseFloat(charges);
    const autoBuyCharges = calculateTradeCharges(cleanQty, cleanBuyPrice, cleanTradeType, true);
    const autoSellCharges = cleanSellPrice
      ? calculateTradeCharges(cleanQty, cleanSellPrice, cleanTradeType, false)
      : 0;

    let cleanCharges = (!isNaN(rawCharges) && rawCharges > 0)
      ? rawCharges
      : (autoBuyCharges + autoSellCharges);

    let cleanTransactionsJson = null;
    if (Array.isArray(transactions) && transactions.length > 0) {
      // Ensure each transaction leg has valid auto charges if empty/0
      const processedTx = transactions.map((tx) => {
        const isBuy = tx.type !== 'SELL';
        const txQty = parseInt(tx.quantity, 10) || cleanQty;
        const txPrice = parseFloat(tx.price) || 0;
        const txCharges = parseFloat(tx.charges);
        const legCharge = (!isNaN(txCharges) && txCharges > 0)
          ? txCharges
          : calculateTradeCharges(txQty, txPrice, cleanTradeType, isBuy);
        return {
          ...tx,
          charges: legCharge
        };
      });
      cleanTransactionsJson = JSON.stringify(processedTx);
      cleanCharges = processedTx.reduce((sum, tx) => sum + (parseFloat(tx.charges) || 0), 0);
    } else {
      // Build default initial BUY + optional SELL transaction legs with auto charges
      const buyLegCharge = autoBuyCharges;
      const sellLegCharge = autoSellCharges;

      cleanTransactionsJson = JSON.stringify([
        {
          id: `leg-buy-${Date.now()}`,
          type: 'BUY',
          date: cleanBuyDate,
          price: cleanBuyPrice,
          quantity: cleanQty,
          charges: buyLegCharge,
          notes: notes || 'Initial Entry'
        },
        ...(cleanSellPrice ? [{
          id: `leg-sell-${Date.now() + 1}`,
          type: 'SELL',
          date: cleanSellDate || cleanBuyDate,
          price: cleanSellPrice,
          quantity: cleanQty,
          charges: sellLegCharge,
          notes: 'Full Exit'
        }] : [])
      ]);
    }

    const [result] = await db.query(
      `INSERT INTO trades 
        (tradeType, assetName, buyDate, buyPrice, quantity, charges, mtfFundedAmount, tradeDecision, sellDate, sellPrice, notes, transactions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanTradeType,
        cleanAssetName,
        cleanBuyDate,
        cleanBuyPrice,
        cleanQty,
        cleanCharges,
        cleanMtfFunded,
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

// Common updater for PUT & PATCH /api/trades/:id
const handleUpdateTrade = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tradeType,
      assetName,
      buyDate,
      buyPrice,
      quantity,
      charges,
      mtfFundedAmount,
      tradeDecision,
      sellDate,
      sellPrice,
      notes,
      transactions
    } = req.body;

    const [existingRows] = await db.query('SELECT * FROM trades WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    const currentTrade = normalizeTrade(existingRows[0]);

    const updates = [];
    const params = [];

    const finalTradeType = tradeType !== undefined ? ((tradeType === 'intraday' || tradeType === 'mtf') ? tradeType : 'stock') : currentTrade.tradeType;
    if (tradeType !== undefined) {
      updates.push('tradeType = ?');
      params.push(finalTradeType);
    }
    if (mtfFundedAmount !== undefined) {
      updates.push('mtfFundedAmount = ?');
      params.push(parseFloat(mtfFundedAmount) || 0);
    }
    if (assetName !== undefined) {
      updates.push('assetName = ?');
      params.push(assetName.trim().toUpperCase());
    }
    if (buyDate !== undefined) {
      updates.push('buyDate = ?');
      params.push(getLocalDateString(buyDate));
    }

    const finalBuyPrice = buyPrice !== undefined ? (parseFloat(buyPrice) || 0) : parseFloat(currentTrade.buyPrice || 0);
    if (buyPrice !== undefined) {
      updates.push('buyPrice = ?');
      params.push(finalBuyPrice);
    }

    const finalQty = quantity !== undefined ? (parseInt(quantity, 10) || 1) : parseInt(currentTrade.quantity || 1, 10);
    if (quantity !== undefined) {
      updates.push('quantity = ?');
      params.push(finalQty);
    }

    const finalSellPrice = sellPrice !== undefined
      ? (sellPrice !== null && sellPrice !== '' ? parseFloat(sellPrice) : null)
      : (currentTrade.sellPrice !== null && currentTrade.sellPrice !== undefined ? parseFloat(currentTrade.sellPrice) : null);
    if (sellPrice !== undefined) {
      updates.push('sellPrice = ?');
      params.push(finalSellPrice);
    }

    if (tradeDecision !== undefined) {
      updates.push('tradeDecision = ?');
      params.push(tradeDecision.trim());
    }
    if (sellDate !== undefined) {
      updates.push('sellDate = ?');
      params.push(sellDate ? getLocalDateString(sellDate) : null);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }

    // Process transactions & auto-calculate charges if not explicitly given
    if (transactions !== undefined) {
      if (Array.isArray(transactions)) {
        const processedTx = transactions.map((tx) => {
          const isBuy = tx.type !== 'SELL';
          const txQty = parseInt(tx.quantity, 10) || finalQty;
          const txPrice = parseFloat(tx.price) || 0;
          const txCharges = parseFloat(tx.charges);
          const legCharge = (!isNaN(txCharges) && txCharges > 0)
            ? txCharges
            : calculateTradeCharges(txQty, txPrice, finalTradeType, isBuy);
          return {
            ...tx,
            charges: legCharge
          };
        });
        updates.push('transactions = ?');
        params.push(JSON.stringify(processedTx));

        // Auto sum total charges from transaction legs
        const computedTotalCharges = processedTx.reduce((sum, tx) => sum + (parseFloat(tx.charges) || 0), 0);
        updates.push('charges = ?');
        params.push(computedTotalCharges);
      } else {
        updates.push('transactions = ?');
        params.push(null);
      }
    } else if (charges !== undefined) {
      const explicitCharges = parseFloat(charges);
      if (!isNaN(explicitCharges) && explicitCharges > 0) {
        updates.push('charges = ?');
        params.push(explicitCharges);
      } else {
        // Auto-recalculate
        const autoBuy = calculateTradeCharges(finalQty, finalBuyPrice, finalTradeType, true);
        const autoSell = finalSellPrice ? calculateTradeCharges(finalQty, finalSellPrice, finalTradeType, false) : 0;
        updates.push('charges = ?');
        params.push(autoBuy + autoSell);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    params.push(id);
    await db.query(`UPDATE trades SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updated] = await db.query('SELECT * FROM trades WHERE id = ?', [id]);
    res.json(normalizeTrade(updated[0]));
  } catch (err) {
    console.error('Error updating trade entry:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT & PATCH /api/trades/:id
router.put('/:id', handleUpdateTrade);
router.patch('/:id', handleUpdateTrade);

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
    const parsedCharges = parseFloat(charges);
    const sellCharges = (!isNaN(parsedCharges) && parsedCharges > 0)
      ? parsedCharges
      : calculateTradeCharges(sellQty, sellPrice, trade.tradeType, false);
    const sellDate = getLocalDateString(date);

    // Create current transactions list if empty
    let txList = Array.isArray(trade.transactions) && trade.transactions.length > 0
      ? [...trade.transactions]
      : [{
          id: `leg-buy-${Date.now() - 1000}`,
          type: 'BUY',
          date: trade.buyDate,
          price: parseFloat(trade.buyPrice) || 0,
          quantity: parseInt(trade.quantity, 10) || 1,
          charges: calculateTradeCharges(trade.quantity, trade.buyPrice, trade.tradeType, true),
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
    const parsedCharges = parseFloat(charges);
    const buyCharges = (!isNaN(parsedCharges) && parsedCharges > 0)
      ? parsedCharges
      : calculateTradeCharges(buyQty, buyPrice, trade.tradeType, true);
    const buyDate = getLocalDateString(date);

    let txList = Array.isArray(trade.transactions) && trade.transactions.length > 0
      ? [...trade.transactions]
      : [{
          id: `leg-buy-${Date.now() - 1000}`,
          type: 'BUY',
          date: trade.buyDate,
          price: parseFloat(trade.buyPrice) || 0,
          quantity: parseInt(trade.quantity, 10) || 1,
          charges: calculateTradeCharges(trade.quantity, trade.buyPrice, trade.tradeType, true),
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
