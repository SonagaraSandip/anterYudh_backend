import express from 'express';
import db from '../../config/db.js';
import { getLocalMySQLDateTime, getLocalDateString } from '../utils/dateHelper.js';

const router = express.Router();

/**
 * Standard Equity Delivery Charges Auto-Calculator for IPOs
 * - Allotment (Buy): 0 statutory/brokerage charges (ASBA application)
 * - Exit (Sell): 0.1% or ₹20 max Brokerage, 0.1% STT, ₹20 DP charge (Groww ₹16.50 + CDSL ₹3.50), 18% GST
 */
export const calculateIpoTradeCharges = (quantity, price, isBuy = false) => {
  const qty = parseFloat(quantity) || 0;
  const prc = parseFloat(price) || 0;
  const tradeValue = qty * prc;
  if (tradeValue <= 0) return 0;

  // IPO allotment has zero charges
  if (isBuy) return 0;

  // Brokerage: Delivery standard 0.1% of trade value, min ₹5, max ₹20 per order
  const brokerage = Math.max(5, Math.min(20, tradeValue * 0.001));

  // Exchange Turnover Charge (NSE): 0.00297%
  const exchangeCharge = tradeValue * 0.0000297;

  // SEBI Turnover Fee: 0.0001% (₹10 / crore)
  const sebiCharge = tradeValue * 0.000001;

  // IPFT (NSE): 0.0001% (₹10 / crore)
  const ipftCharge = tradeValue * 0.000001;

  // Stamp Duty: 0 on sell
  const stampDuty = 0;

  // STT: 0.1% on delivery sell
  const stt = tradeValue * 0.001;

  // DP Charges: ₹20 flat (Groww ₹16.50 + CDSL ₹3.50)
  const dpCharge = 20.00;

  // GST: 18% on (Brokerage + Exchange Charge + SEBI Fee + IPFT Fee)
  const gst = 0.18 * (brokerage + exchangeCharge + sebiCharge + ipftCharge);

  const totalCharges = brokerage + exchangeCharge + sebiCharge + ipftCharge + gst + stampDuty + stt + dpCharge;
  return Math.round(totalCharges * 100) / 100;
};

/**
 * Helper to normalize application row with clean types and parsed JSON transactions
 */
export const normalizeApplication = (app) => {
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

// GET all IPOs with their person applications
router.get('/', async (req, res) => {
  try {
    const [ipos] = await db.query('SELECT * FROM ipos ORDER BY id DESC');
    const [apps] = await db.query('SELECT * FROM ipo_applications ORDER BY id ASC');

    const result = ipos.map(ipo => ({
      ...ipo,
      applications: apps
        .filter(app => app.ipoId === ipo.id)
        .map(normalizeApplication)
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create a new IPO
router.post('/', async (req, res) => {
  try {
    const { ipoName, lotCost, notes, profitLoss, status, createdAt, lotSize, issuePrice, persons, applications } = req.body;
    
    const finalCreatedAt = getLocalMySQLDateTime(createdAt);

    const [result] = await db.query(
      'INSERT INTO ipos (ipoName, lotCost, notes, profitLoss, status, createdAt, lotSize, issuePrice) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        ipoName ? String(ipoName).trim() : 'New IPO',
        lotCost !== undefined ? parseFloat(lotCost) || 0 : 0,
        notes !== undefined && notes !== null ? String(notes) : '',
        profitLoss !== undefined ? parseFloat(profitLoss) || 0 : 0,
        status || 'applied',
        finalCreatedAt,
        lotSize !== undefined ? parseInt(lotSize, 10) || 0 : 0,
        issuePrice !== undefined ? parseFloat(issuePrice) || 0 : 0
      ]
    );

    const newIpoId = result.insertId;

    // Create applications for each person if provided
    const personList = Array.isArray(applications) && applications.length > 0
      ? applications
      : (Array.isArray(persons) && persons.length > 0 ? persons : []);

    if (personList.length > 0) {
      for (const person of personList) {
        const pName = typeof person === 'string' ? person : person.personName;
        if (pName && pName.trim()) {
          const isApp = Boolean(person.applied) ? 1 : 0;
          const isAllot = Boolean(person.allotted) ? 1 : 0;
          const pNotes = person.notes || '';
          const pCat = person.category || 'Retail';
          const pShares = person.allottedShares !== undefined ? parseInt(person.allottedShares, 10) || 0 : 0;
          const pPrice = person.allottedPrice !== undefined ? parseFloat(person.allottedPrice) || 0 : 0;
          const pSellPrice = person.sellPrice !== undefined && person.sellPrice !== null && person.sellPrice !== '' ? parseFloat(person.sellPrice) : null;
          const pSellDate = person.sellDate ? getLocalDateString(person.sellDate) : null;
          const pCharges = person.charges !== undefined ? parseFloat(person.charges) || 0 : 0;
          const pTx = Array.isArray(person.transactions) ? JSON.stringify(person.transactions) : (person.transactions || null);

          await db.query(
            `INSERT INTO ipo_applications 
              (ipoId, personName, applied, allotted, notes, category, allottedShares, allottedPrice, sellPrice, sellDate, charges, transactions) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newIpoId,
              pName.trim(),
              isApp,
              isAllot,
              pNotes,
              pCat,
              pShares,
              pPrice,
              pSellPrice,
              pSellDate,
              pCharges,
              pTx
            ]
          );
        }
      }
    }

    // Fetch and return the newly created IPO with normalized applications
    const [ipos] = await db.query('SELECT * FROM ipos WHERE id = ?', [newIpoId]);
    const [apps] = await db.query('SELECT * FROM ipo_applications WHERE ipoId = ? ORDER BY id ASC', [newIpoId]);
    res.status(201).json({
      ...ipos[0],
      applications: apps.map(normalizeApplication)
    });
  } catch (err) {
    console.error('Error creating IPO entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT / PATCH update an IPO
const handleUpdateIpo = async (req, res) => {
  try {
    const { id } = req.params;
    const { ipoName, lotCost, notes, profitLoss, status, createdAt, lotSize, issuePrice, persons, applications } = req.body;
    
    const [existing] = await db.query('SELECT * FROM ipos WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'IPO not found' });
    }

    const updates = [];
    const params = [];

    if (ipoName !== undefined) {
      updates.push('ipoName = ?');
      params.push(ipoName ? String(ipoName).trim() : 'New IPO');
    }
    if (lotCost !== undefined) {
      updates.push('lotCost = ?');
      params.push(parseFloat(lotCost) || 0);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes !== null ? String(notes) : '');
    }
    if (profitLoss !== undefined) {
      updates.push('profitLoss = ?');
      params.push(parseFloat(profitLoss) || 0);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status || 'applied');
    }
    if (createdAt !== undefined) {
      updates.push('createdAt = ?');
      params.push(getLocalMySQLDateTime(createdAt));
    }
    if (lotSize !== undefined) {
      updates.push('lotSize = ?');
      params.push(parseInt(lotSize, 10) || 0);
    }
    if (issuePrice !== undefined) {
      updates.push('issuePrice = ?');
      params.push(parseFloat(issuePrice) || 0);
    }

    if (updates.length > 0) {
      params.push(id);
      await db.query(`UPDATE ipos SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Optional batch update for applications if sent
    const personList = Array.isArray(applications) ? applications : (Array.isArray(persons) ? persons : null);
    if (personList) {
      for (const p of personList) {
        const pName = typeof p === 'string' ? p : p.personName;
        if (pName && pName.trim()) {
          const isApp = Boolean(p.applied) ? 1 : 0;
          const isAllot = Boolean(p.allotted) ? 1 : 0;
          const pNotes = p.notes !== undefined ? p.notes : '';
          const pCat = p.category || 'Retail';
          const pShares = p.allottedShares !== undefined ? parseInt(p.allottedShares, 10) || 0 : 0;
          const pPrice = p.allottedPrice !== undefined ? parseFloat(p.allottedPrice) || 0 : 0;
          const pSellPrice = p.sellPrice !== undefined && p.sellPrice !== null && p.sellPrice !== '' ? parseFloat(p.sellPrice) : null;
          const pSellDate = p.sellDate ? getLocalDateString(p.sellDate) : null;
          const pCharges = p.charges !== undefined ? parseFloat(p.charges) || 0 : 0;
          const pTx = Array.isArray(p.transactions) ? JSON.stringify(p.transactions) : (p.transactions || null);
          
          const [exists] = await db.query(
            'SELECT id FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
            [id, pName.trim()]
          );
          if (exists.length > 0) {
            await db.query(
              `UPDATE ipo_applications 
               SET applied = ?, allotted = ?, notes = ?, category = ?, allottedShares = ?, allottedPrice = ?, sellPrice = ?, sellDate = ?, charges = ?, transactions = ? 
               WHERE id = ?`,
              [isApp, isAllot, pNotes, pCat, pShares, pPrice, pSellPrice, pSellDate, pCharges, pTx, exists[0].id]
            );
          } else {
            await db.query(
              `INSERT INTO ipo_applications 
                (ipoId, personName, applied, allotted, notes, category, allottedShares, allottedPrice, sellPrice, sellDate, charges, transactions) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, pName.trim(), isApp, isAllot, pNotes, pCat, pShares, pPrice, pSellPrice, pSellDate, pCharges, pTx]
            );
          }
        }
      }
    }

    const [ipos] = await db.query('SELECT * FROM ipos WHERE id = ?', [id]);
    const [apps] = await db.query('SELECT * FROM ipo_applications WHERE ipoId = ? ORDER BY id ASC', [id]);
    res.json({
      ...ipos[0],
      applications: apps.map(normalizeApplication)
    });
  } catch (err) {
    console.error('Error updating IPO:', err);
    res.status(500).json({ error: err.message });
  }
};

router.put('/:id', handleUpdateIpo);
router.patch('/:id', handleUpdateIpo);

// Upsert person application (toggle applied/allotted or update notes & allotment details)
router.post('/:ipoId/application', async (req, res) => {
  try {
    const { ipoId } = req.params;
    const {
      personName,
      applied,
      allotted,
      notes,
      category,
      allottedShares,
      allottedPrice,
      sellPrice,
      sellDate,
      charges,
      transactions
    } = req.body;

    if (!personName) {
      return res.status(400).json({ error: 'personName is required' });
    }

    const cleanPerson = personName.trim();
    const isApplied = Boolean(applied) ? 1 : 0;
    const isAllotted = Boolean(allotted) ? 1 : 0;
    const noteText = notes !== undefined ? notes : '';
    const catText = category || 'Retail';
    const sharesNum = allottedShares !== undefined ? parseInt(allottedShares, 10) || 0 : 0;
    const priceNum = allottedPrice !== undefined ? parseFloat(allottedPrice) || 0 : 0;
    const cleanSellPrice = sellPrice !== undefined && sellPrice !== null && sellPrice !== '' ? parseFloat(sellPrice) : null;
    const cleanSellDate = sellDate ? getLocalDateString(sellDate) : null;
    const chargesNum = charges !== undefined ? parseFloat(charges) || 0 : 0;
    const txJson = Array.isArray(transactions) ? JSON.stringify(transactions) : (transactions || null);

    const [existing] = await db.query(
      'SELECT * FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
      [ipoId, cleanPerson]
    );

    if (existing.length > 0) {
      await db.query(
        `UPDATE ipo_applications 
         SET applied = ?, allotted = ?, notes = ?, category = ?, allottedShares = ?, allottedPrice = ?, sellPrice = ?, sellDate = ?, charges = ?, transactions = ? 
         WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))`,
        [isApplied, isAllotted, noteText, catText, sharesNum, priceNum, cleanSellPrice, cleanSellDate, chargesNum, txJson, ipoId, cleanPerson]
      );
    } else {
      await db.query(
        `INSERT INTO ipo_applications 
          (ipoId, personName, applied, allotted, notes, category, allottedShares, allottedPrice, sellPrice, sellDate, charges, transactions) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ipoId, cleanPerson, isApplied, isAllotted, noteText, catText, sharesNum, priceNum, cleanSellPrice, cleanSellDate, chargesNum, txJson]
      );
    }

    const [apps] = await db.query(
      'SELECT * FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
      [ipoId, cleanPerson]
    );

    res.json(normalizeApplication(apps[0]));
  } catch (err) {
    console.error('Error saving application:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ipos/:ipoId/application/:personName/partial-sell - Record a partial sell execution leg
router.post('/:ipoId/application/:personName/partial-sell', async (req, res) => {
  try {
    const { ipoId, personName } = req.params;
    const { date, quantity, price, charges, notes } = req.body;

    const cleanPerson = decodeURIComponent(personName).trim();
    const [rows] = await db.query(
      'SELECT * FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
      [ipoId, cleanPerson]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Application not found for person' });
    }

    const [ipoRows] = await db.query('SELECT * FROM ipos WHERE id = ?', [ipoId]);
    const ipo = ipoRows[0] || {};
    const app = normalizeApplication(rows[0]);

    const sellQty = parseInt(quantity, 10) || 1;
    const sellPrice = parseFloat(price) || 0;
    const parsedCharges = parseFloat(charges);
    const sellCharges = (!isNaN(parsedCharges) && parsedCharges > 0)
      ? parsedCharges
      : calculateIpoTradeCharges(sellQty, sellPrice, false);
    const sellDate = getLocalDateString(date);

    const baseShares = app.allottedShares > 0 ? app.allottedShares : (ipo.lotCost && app.allottedPrice ? Math.round(ipo.lotCost / app.allottedPrice) : 1);
    const basePrice = app.allottedPrice > 0 ? app.allottedPrice : (ipo.lotCost && baseShares > 0 ? ipo.lotCost / baseShares : 0);

    // Build or update transactions list
    let txList = Array.isArray(app.transactions) && app.transactions.length > 0
      ? [...app.transactions]
      : [{
          id: `leg-buy-${Date.now() - 1000}`,
          type: 'BUY',
          date: ipo.createdAt ? String(ipo.createdAt).slice(0, 10) : getLocalDateString(),
          price: basePrice,
          quantity: baseShares,
          charges: 0,
          notes: 'IPO Allotment'
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

    const sellLegs = txList.filter(l => l.type === 'SELL');
    const totalSellQty = sellLegs.reduce((acc, l) => acc + (parseInt(l.quantity, 10) || 0), 0);
    const totalSellRevenue = sellLegs.reduce((acc, l) => acc + (parseFloat(l.price) || 0) * (parseInt(l.quantity, 10) || 0), 0);
    const avgSellPrice = totalSellQty > 0 ? (totalSellRevenue / totalSellQty) : null;
    const latestSellDate = sellLegs.length > 0 ? sellLegs[sellLegs.length - 1].date : null;
    const totalCharges = txList.reduce((acc, l) => acc + (parseFloat(l.charges) || 0), 0);

    await db.query(
      `UPDATE ipo_applications SET 
        allotted = 1,
        sellPrice = ?,
        sellDate = ?,
        charges = ?,
        transactions = ?
       WHERE id = ?`,
      [
        avgSellPrice,
        latestSellDate,
        totalCharges,
        JSON.stringify(txList),
        app.id
      ]
    );

    const [updatedRows] = await db.query('SELECT * FROM ipo_applications WHERE id = ?', [app.id]);
    res.json(normalizeApplication(updatedRows[0]));
  } catch (err) {
    console.error('Error processing IPO partial sell:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/ipos/:ipoId/application/:personName - Full Allotment & Transactions Update
router.put('/:ipoId/application/:personName', async (req, res) => {
  try {
    const { ipoId, personName } = req.params;
    const {
      allotted,
      applied,
      allottedShares,
      allottedPrice,
      sellPrice,
      sellDate,
      charges,
      transactions,
      notes,
      category
    } = req.body;

    const cleanPerson = decodeURIComponent(personName).trim();
    const [rows] = await db.query(
      'SELECT id FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
      [ipoId, cleanPerson]
    );

    const isAllot = allotted !== undefined ? (Boolean(allotted) ? 1 : 0) : 1;
    const isApp = applied !== undefined ? (Boolean(applied) ? 1 : 0) : 1;
    const sharesNum = allottedShares !== undefined ? parseInt(allottedShares, 10) || 0 : 0;
    const priceNum = allottedPrice !== undefined ? parseFloat(allottedPrice) || 0 : 0;
    const cleanSellPrice = sellPrice !== undefined && sellPrice !== null && sellPrice !== '' ? parseFloat(sellPrice) : null;
    const cleanSellDate = sellDate ? getLocalDateString(sellDate) : null;
    const chargesNum = charges !== undefined ? parseFloat(charges) || 0 : 0;
    const txJson = Array.isArray(transactions) ? JSON.stringify(transactions) : (transactions || null);
    const noteText = notes !== undefined ? notes : '';
    const catText = category || 'Retail';

    if (rows.length > 0) {
      await db.query(
        `UPDATE ipo_applications SET 
          applied = ?,
          allotted = ?,
          allottedShares = ?,
          allottedPrice = ?,
          sellPrice = ?,
          sellDate = ?,
          charges = ?,
          transactions = ?,
          notes = ?,
          category = ?
         WHERE id = ?`,
        [isApp, isAllot, sharesNum, priceNum, cleanSellPrice, cleanSellDate, chargesNum, txJson, noteText, catText, rows[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO ipo_applications 
          (ipoId, personName, applied, allotted, allottedShares, allottedPrice, sellPrice, sellDate, charges, transactions, notes, category) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ipoId, cleanPerson, isApp, isAllot, sharesNum, priceNum, cleanSellPrice, cleanSellDate, chargesNum, txJson, noteText, catText]
      );
    }

    const [updatedRows] = await db.query(
      'SELECT * FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
      [ipoId, cleanPerson]
    );
    res.json(normalizeApplication(updatedRows[0]));
  } catch (err) {
    console.error('Error updating person allotment:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE an IPO
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM ipos WHERE id = ?', [id]);
    res.json({ message: 'IPO deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a Person / Demat Account column across all IPO applications
router.delete('/person/:personName', async (req, res) => {
  try {
    const { personName } = req.params;
    if (!personName) {
      return res.status(400).json({ error: 'personName is required' });
    }
    const cleanPerson = decodeURIComponent(personName).trim();
    const [result] = await db.query(
      'DELETE FROM ipo_applications WHERE LOWER(TRIM(personName)) = LOWER(TRIM(?))',
      [cleanPerson]
    );
    res.json({
      success: true,
      message: `Person '${cleanPerson}' applications removed successfully`,
      deletedCount: result.affectedRows
    });
  } catch (err) {
    console.error('Error deleting person applications:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
