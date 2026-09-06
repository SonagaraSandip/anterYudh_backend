import express from 'express';
import db from '../../config/db.js';

const router = express.Router();

const normalizeNote = (row) => {
  if (!row) return null;
  return {
    ...row,
    isSecret: Boolean(row.isSecret),
    isPinned: Boolean(row.isPinned)
  };
};

// GET all notes (pinned first, then latest updated)
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM personal_notes 
      ORDER BY isPinned DESC, updatedAt DESC, id DESC
    `);
    res.json(rows.map(normalizeNote));
  } catch (err) {
    console.error('Error fetching notes:', err);
    res.status(500).json({ error: 'Failed to fetch personal notes' });
  }
});

// POST create a new note
router.post('/', async (req, res) => {
  try {
    const { title, content, category, isSecret, isPinned, color } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const [result] = await db.query(
      `INSERT INTO personal_notes (title, content, category, isSecret, isPinned, color) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        content || '',
        category || 'General',
        isSecret ? 1 : 0,
        isPinned ? 1 : 0,
        color || 'indigo'
      ]
    );

    const [newNote] = await db.query('SELECT * FROM personal_notes WHERE id = ?', [result.insertId]);
    res.status(201).json(normalizeNote(newNote[0]));
  } catch (err) {
    console.error('Error creating note:', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// PUT update existing note
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category, isSecret, isPinned, color } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    await db.query(
      `UPDATE personal_notes 
       SET title = ?, content = ?, category = ?, isSecret = ?, isPinned = ?, color = ? 
       WHERE id = ?`,
      [
        title.trim(),
        content || '',
        category || 'General',
        isSecret ? 1 : 0,
        isPinned ? 1 : 0,
        color || 'indigo',
        id
      ]
    );

    const [updated] = await db.query('SELECT * FROM personal_notes WHERE id = ?', [id]);
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(normalizeNote(updated[0]));
  } catch (err) {
    console.error('Error updating note:', err);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// PATCH toggle pin
router.patch('/:id/pin', async (req, res) => {
  try {
    const { id } = req.params;
    const [current] = await db.query('SELECT isPinned FROM personal_notes WHERE id = ?', [id]);
    if (current.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const newPinned = current[0].isPinned ? 0 : 1;
    await db.query('UPDATE personal_notes SET isPinned = ? WHERE id = ?', [newPinned, id]);

    const [updated] = await db.query('SELECT * FROM personal_notes WHERE id = ?', [id]);
    res.json(normalizeNote(updated[0]));
  } catch (err) {
    console.error('Error toggling pin:', err);
    res.status(500).json({ error: 'Failed to toggle pin state' });
  }
});

// DELETE note
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM personal_notes WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json({ message: 'Note deleted successfully', id: parseInt(id, 10) });
  } catch (err) {
    console.error('Error deleting note:', err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

export default router;
