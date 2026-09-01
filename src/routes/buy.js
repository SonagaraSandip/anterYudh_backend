import express from 'express';
import db from '../../config/db.js';

const router = express.Router();

// GET all buy wishlist items
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM personal_buy_items 
      ORDER BY FIELD(priority, 'High', 'Medium', 'Low'), updatedAt DESC, id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching buy items:', err);
    res.status(500).json({ error: 'Failed to fetch buy items' });
  }
});

// POST create a new buy item
router.post('/', async (req, res) => {
  try {
    const { title, category, estimatedCost, savedAmount, priority, status, notes } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const [result] = await db.query(
      `INSERT INTO personal_buy_items (title, category, estimatedCost, savedAmount, priority, status, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        category || 'Tech & Gear',
        parseFloat(estimatedCost) || 0,
        parseFloat(savedAmount) || 0,
        priority || 'High',
        status || 'planning',
        notes || ''
      ]
    );

    const [newItem] = await db.query('SELECT * FROM personal_buy_items WHERE id = ?', [result.insertId]);
    res.status(201).json(newItem[0]);
  } catch (err) {
    console.error('Error creating buy item:', err);
    res.status(500).json({ error: 'Failed to create buy item' });
  }
});

// PUT update buy item
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, estimatedCost, savedAmount, priority, status, notes } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    await db.query(
      `UPDATE personal_buy_items 
       SET title = ?, category = ?, estimatedCost = ?, savedAmount = ?, priority = ?, status = ?, notes = ? 
       WHERE id = ?`,
      [
        title.trim(),
        category || 'Tech & Gear',
        parseFloat(estimatedCost) || 0,
        parseFloat(savedAmount) || 0,
        priority || 'High',
        status || 'planning',
        notes || '',
        id
      ]
    );

    const [updated] = await db.query('SELECT * FROM personal_buy_items WHERE id = ?', [id]);
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Buy item not found' });
    }
    res.json(updated[0]);
  } catch (err) {
    console.error('Error updating buy item:', err);
    res.status(500).json({ error: 'Failed to update buy item' });
  }
});

// DELETE buy item
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM personal_buy_items WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Buy item not found' });
    }
    res.json({ message: 'Buy item deleted successfully', id: parseInt(id, 10) });
  } catch (err) {
    console.error('Error deleting buy item:', err);
    res.status(500).json({ error: 'Failed to delete buy item' });
  }
});

export default router;
