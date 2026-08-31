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
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    console.log('Database tables (IPOs, Cashflow Transactions, and Trading Journal) verified/created successfully in MySQL!');
  } catch (err) {
    console.error('Error creating database tables:', err);
  }
};



// Run directly if invoked from command line
if (process.argv[1]?.endsWith('init_ipo_db.js')) {
  initDatabase().then(() => process.exit(0));
}
