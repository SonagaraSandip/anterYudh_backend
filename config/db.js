import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

// Determine active database dynamically (Dev vs Prod)
const dbEnv = (process.env.DB_ENV || process.env.NODE_ENV || 'dev').toLowerCase();
const isProd = dbEnv === 'prod' || dbEnv === 'production';

// Active database name:
// If DB_ENV is 'prod', use DB_NAME_PROD or 'antarYudh_Prod'. Otherwise use DB_NAME or 'defaultdb'.
export const activeDbName = isProd
  ? process.env.DB_NAME_PROD || process.env.DB_NAME || 'antarYudh_Prod'
  : process.env.DB_NAME_DEV || process.env.DB_NAME || 'defaultdb';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: activeDbName,
  port: parseInt(process.env.DB_PORT, 10) || 11585,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test connection on startup
pool.getConnection((err, connection) => {
  if (err) {
    console.error(`❌ [${activeDbName}] Database connection failed:`, err.message);
  } else {
    const badge = isProd ? '🟢 PRODUCTION' : '🟡 DEVELOPMENT';
    console.log(`✅ [${badge}] Successfully connected to Aiven MySQL database: [${activeDbName}]`);
    connection.release();
  }
});

const promisePool = pool.promise();
export default promisePool;
export { pool };