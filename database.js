const path = require("path");

const usePostgres = Boolean(process.env.DATABASE_URL);

function convertSqlPlaceholders(sql) {
  let index = 0;
  let translated = sql.replace(/\?/g, () => `$${++index}`);
  if (!usePostgres) {
    translated = translated.replace(/::int\b/gi, "");
  }
  return translated;
}

function createSqliteAdapter(sqliteDatabase) {
  return {
    run(sql, params = [], callback) {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }

      sqliteDatabase.run(sql, params, function (err) {
        if (callback) {
          callback.call({ changes: this?.changes || 0, lastID: this?.lastID }, err);
        }
      });
    },
    get(sql, params = [], callback) {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }

      sqliteDatabase.get(sql, params, function (err, row) {
        if (callback) {
          callback(err, row);
        }
      });
    },
    all(sql, params = [], callback) {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }

      sqliteDatabase.all(sql, params, function (err, rows) {
        if (callback) {
          callback(err, rows);
        }
      });
    }
  };
}

function createPgAdapter(pool) {
  async function query(sql, params = []) {
    const translatedSql = convertSqlPlaceholders(sql);
    return pool.query(translatedSql, params);
  }

  return {
    run(sql, params = [], callback) {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }

      query(sql, params)
        .then((result) => {
          if (callback) {
            callback.call({ changes: result.rowCount || 0, lastID: result.rows?.[0]?.id }, null);
          }
        })
        .catch((err) => {
          if (callback) {
            callback.call({ changes: 0, lastID: undefined }, err);
          }
        });
    },
    get(sql, params = [], callback) {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }

      query(sql, params)
        .then((result) => {
          if (callback) {
            callback(null, result.rows[0] || undefined);
          }
        })
        .catch((err) => {
          if (callback) {
            callback(err);
          }
        });
    },
    all(sql, params = [], callback) {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }

      query(sql, params)
        .then((result) => {
          if (callback) {
            callback(null, result.rows || []);
          }
        })
        .catch((err) => {
          if (callback) {
            callback(err);
          }
        });
    },
    async close() {
      await pool.end();
    }
  };
}

async function runQuery(query, sql, params = []) {
  return query(sql, params);
}

async function seedIfEmpty(query, countSql, insertSql, rows) {
  const countResult = await runQuery(query, countSql);
  const count = Number(countResult.rows[0].count || 0);

  if (count !== 0) {
    return;
  }

  for (const row of rows) {
    await runQuery(query, insertSql, row);
  }
}

async function initializeSchema(query) {
  await runQuery(
    query,
    `CREATE TABLE IF NOT EXISTS patients (
      id BIGSERIAL PRIMARY KEY,
      patient_id TEXT UNIQUE,
      full_name TEXT,
      age INTEGER,
      gender TEXT,
      mobile_number TEXT,
      email TEXT,
      blood_group TEXT,
      scan_type TEXT,
      appointment_date TEXT,
      registration_date TEXT,
      registration_time TEXT,
      status TEXT DEFAULT 'Registered'
    )`
  );

  await runQuery(
    query,
    `CREATE TABLE IF NOT EXISTS reports (
      id BIGSERIAL PRIMARY KEY,
      report_id TEXT UNIQUE,
      patient_id TEXT,
      patient_name TEXT,
      scan_type TEXT,
      generated_date TEXT,
      status TEXT DEFAULT 'Generated'
    )`
  );

  await runQuery(
    query,
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGSERIAL PRIMARY KEY,
      date_time TEXT,
      activity TEXT,
      patient_id TEXT,
      patient_name TEXT,
      status TEXT
    )`
  );

  await runQuery(
    query,
    `CREATE TABLE IF NOT EXISTS doctors (
      id BIGSERIAL PRIMARY KEY,
      doctor_id TEXT UNIQUE,
      full_name TEXT,
      specialization TEXT
    )`
  );

  await runQuery(
    query,
    `CREATE TABLE IF NOT EXISTS scheduled_scans (
      id BIGSERIAL PRIMARY KEY,
      schedule_id TEXT UNIQUE,
      patient_id TEXT,
      patient_name TEXT,
      scan_type TEXT,
      doctor_id TEXT,
      doctor_name TEXT,
      appointment_date TEXT,
      appointment_time TEXT,
      status TEXT DEFAULT 'Scheduled'
    )`
  );
}

async function seedDatabase(query) {
  await seedIfEmpty(
    query,
    "SELECT COUNT(*)::int AS count FROM patients",
    `INSERT INTO patients (
      patient_id, full_name, age, gender, mobile_number, email, blood_group, scan_type, appointment_date, registration_date, registration_time, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ["TORUS-7401", "Patient A", 28, "Male", "8342281062", "patienta@gmail.com", "B+", "Abdominal Ultrasound", "06-06-2026", "06-06-2026", "10:30:00", "Registered"],
      ["TORUS-7402", "Patient B", 32, "Female", "8342281063", "patientb@gmail.com", "O+", "Cardiac Ultrasound", "06-06-2026", "06-06-2026", "11:00:00", "Registered"],
      ["TORUS-7403", "Patient C", 45, "Other", "8342281064", "patientc@gmail.com", "A-", "Pelvic Ultrasound", "06-06-2026", "06-06-2026", "11:30:00", "Registered"],
      ["TORUS-1001", "John Doe", 29, "Male", "8342281065", "john.doe@gmail.com", "O-", "Abdominal Ultrasound", "07-06-2026", "06-06-2026", "12:00:00", "Registered"],
      ["TORUS-1002", "Jane Smith", 34, "Female", "8342281066", "jane.smith@gmail.com", "AB+", "Cardiac Ultrasound", "07-06-2026", "06-06-2026", "12:30:00", "Registered"],
      ["TORUS-1003", "Robert Brown", 50, "Male", "8342281067", "robert.b@gmail.com", "B-", "Pelvic Ultrasound", "07-06-2026", "06-06-2026", "13:00:00", "Registered"]
    ]
  );

  await seedIfEmpty(
    query,
    "SELECT COUNT(*)::int AS count FROM doctors",
    "INSERT INTO doctors (doctor_id, full_name, specialization) VALUES (?, ?, ?)",
    [
      ["DOC-001", "Dr. Sarah Jenkins", "Radiologist"],
      ["DOC-002", "Dr. Michael Chen", "Cardiologist"],
      ["DOC-003", "Dr. Emily Wong", "Neurologist"]
    ]
  );

  await seedIfEmpty(
    query,
    "SELECT COUNT(*)::int AS count FROM scheduled_scans",
    `INSERT INTO scheduled_scans (
      schedule_id, patient_id, patient_name, scan_type, doctor_id, doctor_name, appointment_date, appointment_time, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ["SCH-0001", "TORUS-7401", "Patient A", "Abdominal Ultrasound", "DOC-001", "Dr. Sarah Jenkins", "06-06-2026", "10:30 AM", "In Progress"],
      ["SCH-0002", "TORUS-7402", "Patient B", "Cardiac Ultrasound", "DOC-002", "Dr. Michael Chen", "06-06-2026", "12:00 PM", "Waiting"],
      ["SCH-0003", "TORUS-7403", "Patient C", "Pelvic Ultrasound", "DOC-003", "Dr. Emily Wong", "06-06-2026", "02:15 PM", "Waiting"],
      ["SCH-0004", "TORUS-1001", "John Doe", "Abdominal Ultrasound", "DOC-001", "Dr. Sarah Jenkins", "07-06-2026", "10:30 AM", "Scheduled"],
      ["SCH-0005", "TORUS-1002", "Jane Smith", "Cardiac Ultrasound", "DOC-002", "Dr. Michael Chen", "07-06-2026", "12:00 PM", "Scheduled"],
      ["SCH-0006", "TORUS-1003", "Robert Brown", "Pelvic Ultrasound", "DOC-003", "Dr. Emily Wong", "07-06-2026", "02:15 PM", "Scheduled"],
      ...Array.from({ length: 12 }, (_value, index) => {
        const i = index + 1;
        return [
      `SCH-COMP-${i}`,
      `TORUS-90${i}`,
      `Completed Patient ${i}`,
      "Abdominal Ultrasound",
      "DOC-001",
      "Dr. Sarah Jenkins",
      "06-06-2026",
      "09:00 AM",
      "Completed"
        ];
      })
    ]
  );
}

async function createPostgresDatabase() {
  const { Pool } = require("pg");
  const shouldUseSsl = !/localhost|127\.0\.0\.1|::1/i.test(process.env.DATABASE_URL || "");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
  });

  const query = (sql, params = []) => pool.query(convertSqlPlaceholders(sql), params);

  await initializeSchema(query);
  await seedDatabase(query);

  return createPgAdapter(pool);
}

async function createSqliteDatabase() {
  const sqlite3 = require("sqlite3").verbose();
  const dbPath = path.join(__dirname, "torus_database.sqlite");

  const sqliteDatabase = await new Promise((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(database);
    });
  });

  const query = (sql, params = []) => {
    const translatedSql = convertSqlPlaceholders(sql);
    const normalizedParams = Array.isArray(params) ? params : [params];

    return new Promise((resolve, reject) => {
      const loweredSql = translatedSql.trim().toLowerCase();

      if (loweredSql.startsWith("select")) {
        if (loweredSql.includes("count(*)")) {
          sqliteDatabase.get(translatedSql, normalizedParams, (err, row) => {
            if (err) {
              reject(err);
              return;
            }

            resolve({ rows: [row] });
          });
          return;
        }

        sqliteDatabase.all(translatedSql, normalizedParams, (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          resolve({ rows });
        });
        return;
      }

      sqliteDatabase.run(translatedSql, normalizedParams, function (err) {
        if (err) {
          reject(err);
          return;
        }

        resolve({ rowCount: this?.changes || 0, rows: [{ id: this?.lastID }] });
      });
    });
  };

  await initializeSchema(query);
  await seedDatabase(query);

  return createSqliteAdapter(sqliteDatabase);
}

async function createDatabase() {
  if (usePostgres) {
    return createPostgresDatabase();
  }

  return createSqliteDatabase();
}

module.exports = {
  createDatabase
};