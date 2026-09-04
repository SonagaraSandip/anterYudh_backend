import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import promisePool, { activeDbName } from '../../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');

/**
 * Ensures the local backup directory exists
 */
export function ensureBackupDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  return BACKUPS_DIR;
}

/**
 * Escapes SQL string values safely
 */
function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) {
    return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  if (typeof val === 'object') {
    // Handle JSON fields or Buffer
    return `'${JSON.stringify(val).replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, (char) => {
      switch (char) {
        case '\0': return '\\0';
        case '\x08': return '\\b';
        case '\x09': return '\\t';
        case '\x1a': return '\\z';
        case '\n': return '\\n';
        case '\r': return '\\r';
        case '"':
        case "'":
        case '\\':
        case '%': return '\\' + char;
        default: return char;
      }
    })}'`;
  }

  // String escaping
  const escaped = String(val).replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, (char) => {
    switch (char) {
      case '\0': return '\\0';
      case '\x08': return '\\b';
      case '\x09': return '\\t';
      case '\x1a': return '\\z';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '"':
      case "'":
      case '\\':
      case '%': return '\\' + char;
      default: return char;
    }
  });
  return `'${escaped}'`;
}

/**
 * Dumps the full MySQL database schema and data into a .sql file and compresses to .sql.gz
 * @returns {Promise<{ sqlPath: string, gzPath: string, filename: string, totalTables: number, totalRows: number, sizeBytes: number }>}
 */
export async function dumpDatabase() {
  ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `backup_${activeDbName}_${timestamp}`;
  const sqlPath = path.join(BACKUPS_DIR, `${baseName}.sql`);
  const gzPath = path.join(BACKUPS_DIR, `${baseName}.sql.gz`);

  console.log(`📦 [DB Dumper] Starting backup for database: [${activeDbName}]...`);

  // Get list of tables
  const [tablesResult] = await promisePool.query('SHOW TABLES');
  const tables = tablesResult.map(row => Object.values(row)[0]);

  if (tables.length === 0) {
    throw new Error(`No tables found in database [${activeDbName}].`);
  }

  const writeStream = fs.createWriteStream(sqlPath, { encoding: 'utf8' });

  // SQL Header
  writeStream.write(`-- ========================================================\n`);
  writeStream.write(`-- antarYudh MySQL Database Dump\n`);
  writeStream.write(`-- Database: ${activeDbName}\n`);
  writeStream.write(`-- Generated: ${new Date().toISOString()}\n`);
  writeStream.write(`-- ========================================================\n\n`);
  writeStream.write(`SET FOREIGN_KEY_CHECKS = 0;\n`);
  writeStream.write(`SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO,ANSI_QUOTES';\n`);
  writeStream.write(`SET AUTOCOMMIT = 0;\n`);
  writeStream.write(`START TRANSACTION;\n\n`);

  let totalRows = 0;

  for (const table of tables) {
    console.log(`  -> Exporting table: ${table}...`);
    writeStream.write(`-- --------------------------------------------------------\n`);
    writeStream.write(`-- Table structure for table \`${table}\`\n`);
    writeStream.write(`-- --------------------------------------------------------\n`);
    writeStream.write(`DROP TABLE IF EXISTS \`${table}\`;\n`);

    const [createTableResult] = await promisePool.query(`SHOW CREATE TABLE \`${table}\``);
    const createTableSql = createTableResult[0]['Create Table'];
    writeStream.write(`${createTableSql};\n\n`);

    // Fetch data in chunks to prevent memory pressure
    const [rows] = await promisePool.query(`SELECT * FROM \`${table}\``);
    if (rows && rows.length > 0) {
      totalRows += rows.length;
      writeStream.write(`-- Dumping data for table \`${table}\` (${rows.length} rows)\n`);

      const columns = Object.keys(rows[0]).map(col => `\`${col}\``).join(', ');
      
      // Batch insert in chunks of 100 rows
      const chunkSize = 100;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const valuesList = chunk.map(row => {
          const vals = Object.values(row).map(escapeSqlValue).join(', ');
          return `(${vals})`;
        }).join(',\n  ');

        writeStream.write(`INSERT INTO \`${table}\` (${columns}) VALUES\n  ${valuesList};\n`);
      }
      writeStream.write(`\n`);
    }
  }

  // SQL Footer
  writeStream.write(`COMMIT;\n`);
  writeStream.write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
  writeStream.write(`-- Dump completed at: ${new Date().toISOString()}\n`);

  await new Promise((resolve, reject) => {
    writeStream.end(resolve);
    writeStream.on('error', reject);
  });

  // Gzip compression
  console.log(`  -> Compressing ${baseName}.sql to .sql.gz...`);
  const fileContent = fs.readFileSync(sqlPath);
  const compressedContent = zlib.gzipSync(fileContent);
  fs.writeFileSync(gzPath, compressedContent);

  const stats = fs.statSync(gzPath);
  console.log(`✅ [DB Dumper] Backup created: ${gzPath} (${(stats.size / 1024).toFixed(2)} KB, ${tables.length} tables, ${totalRows} rows)`);

  return {
    sqlPath,
    gzPath,
    filename: `${baseName}.sql.gz`,
    totalTables: tables.length,
    totalRows,
    sizeBytes: stats.size
  };
}
