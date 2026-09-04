import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import promisePool, { activeDbName } from '../../config/db.js';

/**
 * Splits a full SQL script into distinct executable statements, preserving quotes
 * @param {string} sqlText
 * @returns {string[]}
 */
export function splitSqlStatements(sqlText) {
  const statements = [];
  let currentStmt = '';
  let inString = false;
  let stringChar = '';
  let escapeNext = false;

  const lines = sqlText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip full-line comments
    if (!inString && (trimmed.startsWith('--') || trimmed.startsWith('/*') || trimmed.startsWith('#'))) {
      continue;
    }

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (escapeNext) {
        currentStmt += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        currentStmt += char;
        escapeNext = true;
        continue;
      }

      if ((char === "'" || char === '"' || char === '`') && !inString) {
        inString = true;
        stringChar = char;
        currentStmt += char;
      } else if (char === stringChar && inString) {
        inString = false;
        stringChar = '';
        currentStmt += char;
      } else if (char === ';' && !inString) {
        const stmtToPush = currentStmt.trim();
        if (stmtToPush) {
          statements.push(stmtToPush);
        }
        currentStmt = '';
      } else {
        currentStmt += char;
      }
    }
    currentStmt += '\n';
  }

  const remaining = currentStmt.trim();
  if (remaining) {
    statements.push(remaining);
  }

  return statements;
}

/**
 * Restores database from a local .sql or .sql.gz file
 * @param {string} filePath - Absolute path to .sql or .sql.gz file
 */
export async function restoreDatabaseFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Restore file does not exist at: ${filePath}`);
  }

  console.log(`🔄 [DB Restorer] Starting database restore into [${activeDbName}] from: ${filePath}`);

  let sqlContent;
  if (filePath.endsWith('.gz')) {
    console.log(`  -> Decompressing .sql.gz archive...`);
    const compressedBuffer = fs.readFileSync(filePath);
    sqlContent = zlib.gunzipSync(compressedBuffer).toString('utf8');
  } else {
    sqlContent = fs.readFileSync(filePath, 'utf8');
  }

  const statements = splitSqlStatements(sqlContent);
  console.log(`  -> Found ${statements.length} SQL statements to execute.`);

  const connection = await promisePool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO,ANSI_QUOTES'");

    let executed = 0;
    for (const stmt of statements) {
      if (!stmt || stmt.startsWith('--') || stmt.startsWith('/*')) continue;
      await connection.query(stmt);
      executed++;
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`✅ [DB Restorer] Database [${activeDbName}] successfully restored! (${executed} statements executed)`);

    return {
      success: true,
      database: activeDbName,
      executedStatements: executed,
      restoredFrom: path.basename(filePath)
    };
  } catch (err) {
    console.error(`❌ [DB Restorer] Restore failed:`, err);
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (_) {}
    throw err;
  } finally {
    connection.release();
  }
}
