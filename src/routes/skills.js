import express from 'express';
import db from '../../config/db.js';

const router = express.Router();

// GET all skills
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM learning_skills 
      ORDER BY FIELD(status, 'Learning', 'Planned', 'Completed'),
               FIELD(priority, 'High', 'Medium', 'Low'),
               updatedAt DESC, id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching learning skills:', err);
    res.status(500).json({ error: 'Failed to fetch learning skills' });
  }
});

// POST create a new skill
router.post('/', async (req, res) => {
  try {
    const { name, category, status, priority, progress, targetDate, resources, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Skill name is required' });
    }

    const [result] = await db.query(
      `INSERT INTO learning_skills (name, category, status, priority, progress, targetDate, resources, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        category || 'Technical',
        status || 'Planned',
        priority || 'Medium',
        parseInt(progress, 10) || 0,
        targetDate || null,
        resources || '',
        notes || ''
      ]
    );

    const [newSkill] = await db.query('SELECT * FROM learning_skills WHERE id = ?', [result.insertId]);
    res.status(201).json(newSkill[0]);
  } catch (err) {
    console.error('Error creating skill:', err);
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

// PUT update existing skill
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, status, priority, progress, targetDate, resources, notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Skill name is required' });
    }

    await db.query(
      `UPDATE learning_skills 
       SET name = ?, category = ?, status = ?, priority = ?, progress = ?, targetDate = ?, resources = ?, notes = ?
       WHERE id = ?`,
      [
        name.trim(),
        category || 'Technical',
        status || 'Planned',
        priority || 'Medium',
        parseInt(progress, 10) || 0,
        targetDate || null,
        resources || '',
        notes || '',
        id
      ]
    );

    const [updated] = await db.query('SELECT * FROM learning_skills WHERE id = ?', [id]);
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json(updated[0]);
  } catch (err) {
    console.error('Error updating skill:', err);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

// PATCH quick update progress or status
router.patch('/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const { progress, status } = req.body;

    const updates = [];
    const values = [];

    if (progress !== undefined) {
      const pVal = Math.min(100, Math.max(0, parseInt(progress, 10) || 0));
      updates.push('progress = ?');
      values.push(pVal);
      if (pVal === 100 && !status) {
        updates.push('status = ?');
        values.push('Completed');
      } else if (pVal > 0 && pVal < 100 && !status) {
        updates.push('status = ?');
        values.push('Learning');
      }
    }

    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
      if (status === 'Completed' && progress === undefined) {
        updates.push('progress = ?');
        values.push(100);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    await db.query(`UPDATE learning_skills SET ${updates.join(', ')} WHERE id = ?`, values);

    const [updated] = await db.query('SELECT * FROM learning_skills WHERE id = ?', [id]);
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json(updated[0]);
  } catch (err) {
    console.error('Error patching skill progress:', err);
    res.status(500).json({ error: 'Failed to update skill progress' });
  }
});

// DELETE skill
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM learning_skills WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json({ message: 'Skill deleted successfully', id: parseInt(id, 10) });
  } catch (err) {
    console.error('Error deleting skill:', err);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

export default router;
