import express from 'express';
import db from '../../config/db.js';
import { getLocalMySQLDateTime } from '../utils/dateHelper.js';

const router = express.Router();

// GET all IPOs with their person applications
router.get('/', async (req, res) => {
  try {
    const [ipos] = await db.query('SELECT * FROM ipos ORDER BY id DESC');
    const [apps] = await db.query('SELECT * FROM ipo_applications ORDER BY id ASC');

    const result = ipos.map(ipo => ({
      ...ipo,
      applications: apps
        .filter(app => app.ipoId === ipo.id)
        .map(app => ({
          ...app,
          applied: Boolean(app.applied),
          allotted: Boolean(app.allotted)
        }))
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create a new IPO
router.post('/', async (req, res) => {
  try {
    const { ipoName, lotCost, notes, profitLoss, status, createdAt, persons, applications } = req.body;
    
    const finalCreatedAt = getLocalMySQLDateTime(createdAt);

    const [result] = await db.query(
      'INSERT INTO ipos (ipoName, lotCost, notes, profitLoss, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [
        ipoName ? String(ipoName).trim() : 'New IPO',
        lotCost !== undefined ? parseFloat(lotCost) || 0 : 0,
        notes !== undefined && notes !== null ? String(notes) : '',
        profitLoss !== undefined ? parseFloat(profitLoss) || 0 : 0,
        status || 'applied',
        finalCreatedAt
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
          await db.query(
            'INSERT INTO ipo_applications (ipoId, personName, applied, allotted, notes, category) VALUES (?, ?, ?, ?, ?, ?)',
            [
              newIpoId,
              pName.trim(),
              Boolean(person.applied) ? 1 : 0,
              Boolean(person.allotted) ? 1 : 0,
              person.notes || '',
              person.category || 'Retail'
            ]
          );
        }
      }
    }

    // Fetch and return the newly created IPO with applications
    const [ipos] = await db.query('SELECT * FROM ipos WHERE id = ?', [newIpoId]);
    const [apps] = await db.query('SELECT * FROM ipo_applications WHERE ipoId = ? ORDER BY id ASC', [newIpoId]);
    res.status(201).json({
      ...ipos[0],
      applications: apps.map(a => ({
        ...a,
        applied: Boolean(a.applied),
        allotted: Boolean(a.allotted),
        category: a.category || 'Retail'
      }))
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
    const { ipoName, lotCost, notes, profitLoss, status, createdAt, persons, applications } = req.body;
    
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
          
          const [exists] = await db.query(
            'SELECT id FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
            [id, pName.trim()]
          );
          if (exists.length > 0) {
            await db.query(
              'UPDATE ipo_applications SET applied = ?, allotted = ?, notes = ?, category = ? WHERE id = ?',
              [isApp, isAllot, pNotes, pCat, exists[0].id]
            );
          } else {
            await db.query(
              'INSERT INTO ipo_applications (ipoId, personName, applied, allotted, notes, category) VALUES (?, ?, ?, ?, ?, ?)',
              [id, pName.trim(), isApp, isAllot, pNotes, pCat]
            );
          }
        }
      }
    }

    const [ipos] = await db.query('SELECT * FROM ipos WHERE id = ?', [id]);
    const [apps] = await db.query('SELECT * FROM ipo_applications WHERE ipoId = ? ORDER BY id ASC', [id]);
    res.json({
      ...ipos[0],
      applications: apps.map(a => ({
        ...a,
        applied: Boolean(a.applied),
        allotted: Boolean(a.allotted),
        category: a.category || 'Retail'
      }))
    });
  } catch (err) {
    console.error('Error updating IPO:', err);
    res.status(500).json({ error: err.message });
  }
};

router.put('/:id', handleUpdateIpo);
router.patch('/:id', handleUpdateIpo);

// Upsert person application (toggle applied/allotted or update notes)
router.post('/:ipoId/application', async (req, res) => {
  try {
    const { ipoId } = req.params;
    const { personName, applied, allotted, notes } = req.body;

    if (!personName) {
      return res.status(400).json({ error: 'personName is required' });
    }

    const cleanPerson = personName.trim();
    const isApplied = Boolean(applied) ? 1 : 0;
    const isAllotted = Boolean(allotted) ? 1 : 0;
    const noteText = notes !== undefined ? notes : '';

    const [existing] = await db.query(
      'SELECT * FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
      [ipoId, cleanPerson]
    );

    if (existing.length > 0) {
      await db.query(
        'UPDATE ipo_applications SET applied = ?, allotted = ?, notes = ? WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
        [isApplied, isAllotted, noteText, ipoId, cleanPerson]
      );
    } else {
      await db.query(
        'INSERT INTO ipo_applications (ipoId, personName, applied, allotted, notes) VALUES (?, ?, ?, ?, ?)',
        [ipoId, cleanPerson, isApplied, isAllotted, noteText]
      );
    }

    const [apps] = await db.query(
      'SELECT * FROM ipo_applications WHERE ipoId = ? AND LOWER(TRIM(personName)) = LOWER(TRIM(?))',
      [ipoId, cleanPerson]
    );

    const savedApp = apps[0] || {};
    res.json({
      ...savedApp,
      applied: Boolean(savedApp.applied),
      allotted: Boolean(savedApp.allotted)
    });
  } catch (err) {
    console.error('Error saving application:', err);
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

