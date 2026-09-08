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

    // 3. Cashflow Transactions (Expenses & Incomes) Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cashflow_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type ENUM('expense', 'income') NOT NULL,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        paymentMode VARCHAR(100) DEFAULT 'UPI / GPay',
        notes TEXT,
        transactionDate DATETIME NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // 4. Trading Journal (Stocks & Intraday Trades) Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tradeType ENUM('stock', 'intraday') NOT NULL DEFAULT 'stock',
        assetName VARCHAR(255) NOT NULL,
        buyDate DATE NOT NULL,
        buyPrice DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        quantity INT NOT NULL DEFAULT 1,
        charges DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        tradeDecision VARCHAR(100) NOT NULL DEFAULT 'Self',
        sellDate DATE NULL,
        sellPrice DECIMAL(12, 2) NULL,
        notes TEXT,
        transactions JSON DEFAULT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // 5. Personal Notes & Secret Vault Table (Passwords, Important Numbers, Notes)
    await db.query(`
      CREATE TABLE IF NOT EXISTS personal_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'General',
        isSecret BOOLEAN DEFAULT FALSE,
        isPinned BOOLEAN DEFAULT FALSE,
        color VARCHAR(50) DEFAULT 'indigo',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // 6. Planned Buy & Asset Purchases Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS personal_buy_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'Tech & Gear',
        estimatedCost DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        savedAmount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        priority ENUM('High', 'Medium', 'Low') DEFAULT 'High',
        status VARCHAR(50) DEFAULT 'planning',
        notes TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // 7. Persistent Backup Logs & Timestamps Table (Ensures cloud & GitHub deploys preserve last backup status)
    await db.query(`
      CREATE TABLE IF NOT EXISTS backup_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        sizeBytes BIGINT DEFAULT 0,
        driveFileId VARCHAR(255) DEFAULT NULL,
        status VARCHAR(50) DEFAULT 'success',
        source VARCHAR(50) DEFAULT 'manual',
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 8. Learning Skills Tracker Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS learning_skills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'Technical',
        status ENUM('Planned', 'Learning', 'Completed') DEFAULT 'Planned',
        priority ENUM('High', 'Medium', 'Low') DEFAULT 'Medium',
        progress INT DEFAULT 0,
        targetDate DATE NULL,
        resources TEXT NULL,
        notes TEXT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // 9. Reading Books Tracker Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS reading_books (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) DEFAULT '',
        category VARCHAR(100) DEFAULT 'Finance & Investing',
        status ENUM('Want to Read', 'Reading', 'Completed') DEFAULT 'Want to Read',
        priority ENUM('High', 'Medium', 'Low') DEFAULT 'Medium',
        rating INT DEFAULT 0,
        progressPages INT DEFAULT 0,
        totalPages INT DEFAULT 0,
        keyTakeaways TEXT NULL,
        notes TEXT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // Safe Column Migrations for Existing Tables
    const safeAddColumn = async (tableName, columnName, columnDef) => {
      try {
        const [cols] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
        if (cols.length === 0) {
          await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`);
          console.log(`✅ [Schema Migration] Added missing column '${columnName}' to table '${tableName}'`);
        }
      } catch (colErr) {
        console.warn(`⚠️ [Schema Migration] Column check failed for ${tableName}.${columnName}:`, colErr.message);
      }
    };

    // Run column migrations
    await safeAddColumn('trades', 'transactions', 'transactions JSON DEFAULT NULL');
    await safeAddColumn('trades', 'tradeDecision', "tradeDecision VARCHAR(100) NOT NULL DEFAULT 'Self'");
    await safeAddColumn('trades', 'charges', 'charges DECIMAL(10, 2) NOT NULL DEFAULT 0.00');
    await safeAddColumn('trades', 'tradeType', "tradeType ENUM('stock', 'intraday') NOT NULL DEFAULT 'stock'");
    await safeAddColumn('ipo_applications', 'category', "category VARCHAR(50) DEFAULT 'Retail'");
    await safeAddColumn('ipo_applications', 'allottedShares', "allottedShares INT DEFAULT 0");
    await safeAddColumn('ipo_applications', 'allottedPrice', "allottedPrice DECIMAL(12, 2) DEFAULT 0.00");
    await safeAddColumn('ipo_applications', 'sellPrice', "sellPrice DECIMAL(12, 2) DEFAULT NULL");
    await safeAddColumn('ipo_applications', 'sellDate', "sellDate DATE DEFAULT NULL");
    await safeAddColumn('ipo_applications', 'charges', "charges DECIMAL(10, 2) DEFAULT 0.00");
    await safeAddColumn('ipo_applications', 'transactions', "transactions JSON DEFAULT NULL");
    await safeAddColumn('ipos', 'lotSize', "lotSize INT DEFAULT 0");
    await safeAddColumn('ipos', 'issuePrice', "issuePrice DECIMAL(12, 2) DEFAULT 0.00");
    await safeAddColumn('personal_notes', 'isPinned', 'isPinned BOOLEAN DEFAULT FALSE');
    await safeAddColumn('personal_notes', 'color', "color VARCHAR(50) DEFAULT 'indigo'");
    await safeAddColumn('personal_buy_items', 'savedAmount', 'savedAmount DECIMAL(12, 2) NOT NULL DEFAULT 0.00');

    // Performance Optimization: Safe Index Additions for Ultra-Fast Queries
    const safeAddIndex = async (tableName, indexName, indexCols) => {
      try {
        const [existing] = await db.query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [indexName]);
        if (existing.length === 0) {
          await db.query(`CREATE INDEX ${indexName} ON ${tableName} (${indexCols})`);
        }
      } catch (idxErr) {
        // Silently skip if index creation is not permitted or already exists
      }
    };

    await safeAddIndex('ipos', 'idx_ipos_status_created', 'status, createdAt');
    await safeAddIndex('ipo_applications', 'idx_ipo_apps_ipoid', 'ipoId');
    await safeAddIndex('cashflow_transactions', 'idx_cashflow_txdate_type', 'transactionDate, type');
    await safeAddIndex('trades', 'idx_trades_buydate_type', 'buyDate, tradeType');
    await safeAddIndex('personal_notes', 'idx_notes_pinned_updated', 'isPinned, updatedAt');
    await safeAddIndex('personal_buy_items', 'idx_buy_priority', 'priority, updatedAt');
    await safeAddIndex('learning_skills', 'idx_skills_status_priority', 'status, priority, updatedAt');
    await safeAddIndex('reading_books', 'idx_books_status_priority', 'status, priority, updatedAt');

    console.log('Database tables, schema columns & performance indexes verified successfully in MySQL!');
  } catch (err) {
    console.error('Error creating database tables:', err);
  }
};



// Run directly if invoked from command line
if (process.argv[1]?.endsWith('init_ipo_db.js')) {
  initDatabase().then(() => process.exit(0));
}
