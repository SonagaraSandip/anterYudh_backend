import db from '../../config/db.js';

export const initDatabase = async () => {
  try {
    // 1. Master IPO Details Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ipos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ipoName VARCHAR(255) NOT NULL,
        lotCost DECIMAL(10, 2) DEFAULT 0.00,
        profitLoss DECIMAL(10, 2) DEFAULT 0.00,
        notes TEXT,
        status ENUM('upcoming', 'applied', 'allotted', 'closed') DEFAULT 'applied',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // 2. Person / Demat Application Status Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ipo_applications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ipoId INT NOT NULL,
        personName VARCHAR(100) NOT NULL,
        applied BOOLEAN DEFAULT FALSE,
        allotted BOOLEAN DEFAULT FALSE,
        notes TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (ipoId) REFERENCES ipos(id) ON DELETE CASCADE
      );
    `);

    console.log('IPO tables verified/created successfully in MySQL!');
  } catch (err) {
    console.error('Error creating IPO tables:', err);
  }
};

// Run directly if invoked from command line
if (process.argv[1]?.endsWith('init_ipo_db.js')) {
  initDatabase().then(() => process.exit(0));
}
