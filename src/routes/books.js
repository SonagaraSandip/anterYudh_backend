import express from 'express';
import db from '../../config/db.js';

const router = express.Router();

// GET all books
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM reading_books 
      ORDER BY FIELD(status, 'Reading', 'Want to Read', 'Completed'),
               FIELD(priority, 'High', 'Medium', 'Low'),
               updatedAt DESC, id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching reading books:', err);
    res.status(500).json({ error: 'Failed to fetch reading books' });
  }
});

// POST create a new book
router.post('/', async (req, res) => {
  try {
    const { title, author, category, status, priority, rating, progressPages, totalPages, keyTakeaways, notes } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Book title is required' });
    }

    const [result] = await db.query(
      `INSERT INTO reading_books (title, author, category, status, priority, rating, progressPages, totalPages, keyTakeaways, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        author ? author.trim() : '',
        category || 'Finance & Investing',
        status || 'Want to Read',
        priority || 'Medium',
        parseInt(rating, 10) || 0,
        parseInt(progressPages, 10) || 0,
        parseInt(totalPages, 10) || 0,
        keyTakeaways || '',
        notes || ''
      ]
    );

    const [newBook] = await db.query('SELECT * FROM reading_books WHERE id = ?', [result.insertId]);
    res.status(201).json(newBook[0]);
  } catch (err) {
    console.error('Error creating book:', err);
    res.status(500).json({ error: 'Failed to create book' });
  }
});

// PUT update existing book
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, author, category, status, priority, rating, progressPages, totalPages, keyTakeaways, notes } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Book title is required' });
    }

    await db.query(
      `UPDATE reading_books 
       SET title = ?, author = ?, category = ?, status = ?, priority = ?, rating = ?, progressPages = ?, totalPages = ?, keyTakeaways = ?, notes = ?
       WHERE id = ?`,
      [
        title.trim(),
        author ? author.trim() : '',
        category || 'Finance & Investing',
        status || 'Want to Read',
        priority || 'Medium',
        parseInt(rating, 10) || 0,
        parseInt(progressPages, 10) || 0,
        parseInt(totalPages, 10) || 0,
        keyTakeaways || '',
        notes || '',
        id
      ]
    );

    const [updated] = await db.query('SELECT * FROM reading_books WHERE id = ?', [id]);
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(updated[0]);
  } catch (err) {
    console.error('Error updating book:', err);
    res.status(500).json({ error: 'Failed to update book' });
  }
});

// PATCH quick update book progress, status, or rating
router.patch('/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const { progressPages, totalPages, status, rating } = req.body;

    const updates = [];
    const values = [];

    if (progressPages !== undefined) {
      updates.push('progressPages = ?');
      values.push(parseInt(progressPages, 10) || 0);
    }
    if (totalPages !== undefined) {
      updates.push('totalPages = ?');
      values.push(parseInt(totalPages, 10) || 0);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }
    if (rating !== undefined) {
      updates.push('rating = ?');
      values.push(Math.min(5, Math.max(0, parseInt(rating, 10) || 0)));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    await db.query(`UPDATE reading_books SET ${updates.join(', ')} WHERE id = ?`, values);

    const [updated] = await db.query('SELECT * FROM reading_books WHERE id = ?', [id]);
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(updated[0]);
  } catch (err) {
    console.error('Error patching book progress:', err);
    res.status(500).json({ error: 'Failed to update book progress' });
  }
});

// DELETE book
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM reading_books WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json({ message: 'Book deleted successfully', id: parseInt(id, 10) });
  } catch (err) {
    console.error('Error deleting book:', err);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

export default router;
