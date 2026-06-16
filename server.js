const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { WebSocketServer } = require("ws");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, 'torus_database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database " + err.message);
  } else {
    console.log("Connected to the SQLite database.");
    db.run(`CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    )`, (err) => {
      if (!err) {
        db.get("SELECT COUNT(*) AS count FROM patients", (err, row) => {
          if (!err && row.count === 0) {
            const stmt = db.prepare(`INSERT INTO patients (
              patient_id, full_name, age, gender, mobile_number, email, blood_group, scan_type, appointment_date, registration_date, registration_time, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run("TORUS-7401", "Patient A", 28, "Male", "8342281062", "patienta@gmail.com", "B+", "Abdominal Ultrasound", "06-06-2026", "06-06-2026", "10:30:00", "Registered");
            stmt.run("TORUS-7402", "Patient B", 32, "Female", "8342281063", "patientb@gmail.com", "O+", "Cardiac Ultrasound", "06-06-2026", "06-06-2026", "11:00:00", "Registered");
            stmt.run("TORUS-7403", "Patient C", 45, "Other", "8342281064", "patientc@gmail.com", "A-", "Pelvic Ultrasound", "06-06-2026", "06-06-2026", "11:30:00", "Registered");
            stmt.run("TORUS-1001", "John Doe", 29, "Male", "8342281065", "john.doe@gmail.com", "O-", "Abdominal Ultrasound", "07-06-2026", "06-06-2026", "12:00:00", "Registered");
            stmt.run("TORUS-1002", "Jane Smith", 34, "Female", "8342281066", "jane.smith@gmail.com", "AB+", "Cardiac Ultrasound", "07-06-2026", "06-06-2026", "12:30:00", "Registered");
            stmt.run("TORUS-1003", "Robert Brown", 50, "Male", "8342281067", "robert.b@gmail.com", "B-", "Pelvic Ultrasound", "07-06-2026", "06-06-2026", "13:00:00", "Registered");
            stmt.finalize();
          }
        });
      }
    });
    db.run(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT UNIQUE,
      patient_id TEXT,
      patient_name TEXT,
      scan_type TEXT,
      generated_date TEXT,
      status TEXT DEFAULT 'Generated'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_time TEXT,
      activity TEXT,
      patient_id TEXT,
      patient_name TEXT,
      status TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id TEXT UNIQUE,
      full_name TEXT,
      specialization TEXT
    )`, (err) => {
      if (!err) {
        // Seed dummy doctors
        db.get("SELECT COUNT(*) AS count FROM doctors", (err, row) => {
          if (!err && row.count === 0) {
            const stmt = db.prepare("INSERT INTO doctors (doctor_id, full_name, specialization) VALUES (?, ?, ?)");
            stmt.run("DOC-001", "Dr. Sarah Jenkins", "Radiologist");
            stmt.run("DOC-002", "Dr. Michael Chen", "Cardiologist");
            stmt.run("DOC-003", "Dr. Emily Wong", "Neurologist");
            stmt.finalize();
          }
        });
      }
    });
    db.run(`CREATE TABLE IF NOT EXISTS scheduled_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id TEXT UNIQUE,
      patient_id TEXT,
      patient_name TEXT,
      scan_type TEXT,
      doctor_id TEXT,
      doctor_name TEXT,
      appointment_date TEXT,
      appointment_time TEXT,
      status TEXT DEFAULT 'Scheduled'
    )`, (err) => {
      if (!err) {
        db.get("SELECT COUNT(*) AS count FROM scheduled_scans", (err, row) => {
          if (!err && row.count === 0) {
            const stmt = db.prepare(`INSERT INTO scheduled_scans (
              schedule_id, patient_id, patient_name, scan_type, doctor_id, doctor_name, appointment_date, appointment_time, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            // Seed Active Sessions
            stmt.run("SCH-0001", "TORUS-7401", "Patient A", "Abdominal Ultrasound", "DOC-001", "Dr. Sarah Jenkins", "06-06-2026", "10:30 AM", "In Progress");
            stmt.run("SCH-0002", "TORUS-7402", "Patient B", "Cardiac Ultrasound", "DOC-002", "Dr. Michael Chen", "06-06-2026", "12:00 PM", "Waiting");
            stmt.run("SCH-0003", "TORUS-7403", "Patient C", "Pelvic Ultrasound", "DOC-003", "Dr. Emily Wong", "06-06-2026", "02:15 PM", "Waiting");
            
            // Seed Upcoming Sessions
            stmt.run("SCH-0004", "TORUS-1001", "John Doe", "Abdominal Ultrasound", "DOC-001", "Dr. Sarah Jenkins", "07-06-2026", "10:30 AM", "Scheduled");
            stmt.run("SCH-0005", "TORUS-1002", "Jane Smith", "Cardiac Ultrasound", "DOC-002", "Dr. Michael Chen", "07-06-2026", "12:00 PM", "Scheduled");
            stmt.run("SCH-0006", "TORUS-1003", "Robert Brown", "Pelvic Ultrasound", "DOC-003", "Dr. Emily Wong", "07-06-2026", "02:15 PM", "Scheduled");
            
            // Seed 12 Completed Today Sessions
            const todayStr = "06-06-2026";
            for (let i = 1; i <= 12; i++) {
              stmt.run(`SCH-COMP-${i}`, `TORUS-90${i}`, `Completed Patient ${i}`, "Abdominal Ultrasound", "DOC-001", "Dr. Sarah Jenkins", todayStr, "09:00 AM", "Completed");
            }
            stmt.finalize();
          }
        });
      }
    });
  }
});

const app = express();
const server = http.createServer(app);
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5002);

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});

app.use(express.static(__dirname));

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const websocketRooms = new Map();
const websocketRoomStates = new Map();
const rtcRoomStates = new Map();
const webSocketServer = new WebSocketServer({ noServer: true });

function getWebSocketRoomState(roomId) {
  let state = websocketRoomStates.get(roomId);
  if (!state) {
    state = { doctorJoinedAnnounced: false };
    websocketRoomStates.set(roomId, state);
  }
  return state;
}

function clearWebSocketRoomState(roomId) {
  websocketRoomStates.delete(roomId);
}

function getRtcRoomState(roomId) {
  let state = rtcRoomStates.get(roomId);
  if (!state) {
    state = { doctorJoinedAnnounced: false };
    rtcRoomStates.set(roomId, state);
  }
  return state;
}

function clearRtcRoomState(roomId) {
  rtcRoomStates.delete(roomId);
}

function getWebSocketRoom(roomId) {
  let room = websocketRooms.get(roomId);
  if (!room) {
    room = new Set();
    websocketRooms.set(roomId, room);
  }
  return room;
}

function sendWebSocketMessage(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcastWebSocket(roomId, payload, excludeSocket = null) {
  const room = websocketRooms.get(roomId);
  if (!room) {
    return;
  }

  const serialized = JSON.stringify(payload);
  for (const client of room) {
    if (client === excludeSocket || client.readyState !== 1) {
      continue;
    }
    client.send(serialized);
  }
}

function removeWebSocketFromRoom(socket) {
  const roomId = socket.data?.roomId;
  if (!roomId) {
    return;
  }

  const room = websocketRooms.get(roomId);
  if (!room) {
    return;
  }

  room.delete(socket);
  if (room.size === 0) {
    websocketRooms.delete(roomId);
    clearWebSocketRoomState(roomId);
  }

  const participants = room.size;
  broadcastWebSocket(roomId, {
    type: "user-left",
    socketId: socket.id
  }, socket);
  broadcastWebSocket(roomId, {
    type: "waiting-state",
    roomId,
    participants
  });
}

function joinWebSocketRoom(socket, payload = {}) {
  const roomId = typeof payload === "string"
    ? payload
    : String(payload?.room || payload?.roomId || "").trim();
  const role = String(payload?.role || socket.data?.role || "").trim().toLowerCase();

  if (!roomId) {
    return;
  }

  if (socket.data?.roomId && socket.data.roomId !== roomId) {
    removeWebSocketFromRoom(socket);
  }

  const room = getWebSocketRoom(roomId);
  room.add(socket);

  socket.data = {
    roomId,
    role
  };

  const participants = room.size;
  const roomState = getWebSocketRoomState(roomId);

  sendWebSocketMessage(socket, {
    type: "joined-room",
    roomId,
    socketId: socket.id,
    participants
  });

  if (role === "doctor" && !roomState.doctorJoinedAnnounced) {
    roomState.doctorJoinedAnnounced = true;
    broadcastWebSocket(roomId, {
      type: "doctor-joined",
      roomId,
      socketId: socket.id,
      participants
    }, socket);
  }

  if (participants > 1) {
    broadcastWebSocket(roomId, {
      type: "both-users-connected",
      roomId,
      participants
    });
    broadcastWebSocket(roomId, {
      type: "connect-success",
      roomId,
      participants
    });
  } else {
    broadcastWebSocket(roomId, {
      type: "waiting-state",
      roomId,
      participants
    });
  }

  broadcastWebSocket(roomId, {
    type: "user-joined",
    socketId: socket.id
  }, socket);
}

webSocketServer.on("connection", (socket) => {
  socket.id = Math.random().toString(36).slice(2, 10);
  socket.data = {};

  socket.on("message", (message) => {
    try {
      const data = JSON.parse(String(message));
      const type = String(data.type || "").trim();

      if (type === "join" || type === "join-room") {
        joinWebSocketRoom(socket, data);
        return;
      }

      const roomId = String(data.room || data.roomId || socket.data.roomId || "").trim();
      if (!roomId) {
        return;
      }

      if (type === "patient-proceed") {
        broadcastWebSocket(roomId, {
          type: "patient-proceed",
          socketId: socket.id
        }, socket);
        return;
      }

      if (type === "doctor-begin") {
        broadcastWebSocket(roomId, {
          type: "doctor-begin",
          socketId: socket.id
        }, socket);
        return;
      }

      if (type === "patient-report-redirect") {
        broadcastWebSocket(roomId, {
          type: "patient-report-redirect",
          socketId: socket.id
        }, socket);
        return;
      }

      if (type === "ready") {
        broadcastWebSocket(roomId, {
          type: "ready",
          socketId: socket.id
        }, socket);
        return;
      }

      if (type === "offer") {
        if (!data.offer) {
          return;
        }
        broadcastWebSocket(roomId, {
          type: "offer",
          offer: data.offer
        }, socket);
        return;
      }

      if (type === "answer") {
        if (!data.answer) {
          return;
        }
        broadcastWebSocket(roomId, {
          type: "answer",
          answer: data.answer
        }, socket);
        return;
      }

      if (type === "candidate" || type === "ice-candidate") {
        if (!data.candidate) {
          return;
        }
        broadcastWebSocket(roomId, {
          type: "candidate",
          candidate: data.candidate
        }, socket);
      }
    } catch (error) {
      sendWebSocketMessage(socket, {
        type: "error-message",
        message: error.message || "Invalid signaling payload"
      });
    }
  });

  socket.on("close", () => {
    removeWebSocketFromRoom(socket);
  });
});

server.on("upgrade", (request, socket, head) => {
  try {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");

    if (requestUrl.pathname.startsWith("/socket.io")) {
      return;
    }

    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  } catch (error) {
    socket.destroy();
  }
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (payload) => {
    const roomId = typeof payload === "string"
      ? payload
      : String(payload?.roomId || payload?.room || "").trim();
    const role = String(payload?.role || socket.data?.role || "").trim().toLowerCase();

    if (!roomId) {
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;
    const participants = io.sockets.adapter.rooms.get(roomId)?.size || 1;
    const roomState = getRtcRoomState(roomId);

    console.log("User joined room:", roomId);

    if (role === "doctor" && !roomState.doctorJoinedAnnounced) {
      roomState.doctorJoinedAnnounced = true;
      socket.to(roomId).emit("doctor-joined", {
        roomId,
        participants,
        socketId: socket.id
      });
    }

    if (participants > 1) {
      io.to(roomId).emit("both-users-connected", {
        roomId,
        participants
      });
      io.to(roomId).emit("connect-success", {
        roomId,
        participants
      });
    } else {
      io.to(roomId).emit("waiting-state", {
        roomId,
        participants
      });
    }

    socket.to(roomId).emit("user-joined", { socketId: socket.id });
    socket.emit("joined-room", {
      roomId,
      socketId: socket.id,
      participants
    });
  });

  socket.on("patient-proceed", (data = {}) => {
    const room = String(data.room || data.roomId || socket.data.roomId || "").trim();
    if (room) {
      socket.to(room).emit("patient-proceed", { socketId: socket.id });
    }
  });

  socket.on("doctor-begin", (data = {}) => {
    const room = String(data.room || data.roomId || socket.data.roomId || "").trim();
    if (room) {
      socket.to(room).emit("doctor-begin", { socketId: socket.id });
    }
  });

  socket.on("patient-report-redirect", (data = {}) => {
    const room = String(data.room || data.roomId || socket.data.roomId || "").trim();
    if (room) {
      socket.to(room).emit("patient-report-redirect", { roomId: room });
    }
  });

  socket.on("offer", (data = {}) => {
    const room = String(data.room || data.roomId || socket.data.roomId || "").trim();
    if (!room || !data.offer) {
      return;
    }

    console.log("Offer received");
    socket.to(room).emit("offer", data.offer);
    console.log("Offer sent");
  });

  socket.on("answer", (data = {}) => {
    const room = String(data.room || data.roomId || socket.data.roomId || "").trim();
    if (!room || !data.answer) {
      return;
    }

    console.log("Answer received");
    socket.to(room).emit("answer", data.answer);
    console.log("Answer sent");
  });

  socket.on("ice-candidate", (data = {}) => {
    const room = String(data.room || data.roomId || socket.data.roomId || "").trim();
    const candidate = data.candidate || data;
    if (!room || !candidate) {
      return;
    }

    console.log("ICE candidate received");
    socket.to(room).emit("ice-candidate", { candidate });
    console.log("ICE candidate sent");
  });

  socket.on("ready", (payload) => {
    const roomId = typeof payload === "string"
      ? payload
      : String(payload?.roomId || payload?.room || socket.data.roomId || "").trim();

    if (!roomId) {
      return;
    }

    socket.to(roomId).emit("ready", { socketId: socket.id });
  });

  socket.on("disconnect", () => {
    const room = socket.data.roomId;
    if (room) {
      const participants = Math.max((io.sockets.adapter.rooms.get(room)?.size || 1) - 1, 0);
      socket.to(room).emit("user-left", { socketId: socket.id });
      io.to(room).emit("waiting-state", {
        roomId: room,
        participants
      });

      if (participants === 0) {
        clearRtcRoomState(room);
      }
    }
    console.log("User disconnected:", socket.id);
  });
});

app.get("/", (_req, res) => {
  res.sendFile(require("path").join(__dirname, "connected-device.html"));
});

app.get("/verify-fingerprint", async (_req, res) => {
  console.log("Fingerprint scan requested");

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const isMatch = Math.random() >= 0.5;
  if (isMatch) {
    return res.status(200).json({ status: "success" });
  }

  return res.status(200).json({ status: "fail" });
});

// --- Patient Records API Routes ---
app.post('/api/patients', (req, res) => {
  const {
    fullName, age, gender, mobile, email, bloodGroup, scanType, apptDate
  } = req.body;

  // Generate random patient ID on successful submit
  const randomId = Math.floor(Math.random() * 9000) + 1000;
  const patientId = `TORUS-${randomId}`;

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const regDate = `${dd}-${mm}-${yyyy}`;

  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const regTime = `${hh}:${min}:${ss}`;

  const sql = `INSERT INTO patients (patient_id, full_name, age, gender, mobile_number, email, blood_group, scan_type, appointment_date, registration_date, registration_time, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
  const params = [patientId, fullName, age, gender, mobile, email, bloodGroup, scanType, apptDate, regDate, regTime, 'Registered'];

  db.run(sql, params, function (err) {
    if (err) {
      console.error("DB Insert Error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({
      message: "Patient registered successfully",
      patientId: patientId,
      registrationDate: regDate,
      registrationTime: regTime
    });
  });
});

app.get('/api/patients', (req, res) => {
  let sql = "SELECT * FROM patients";
  let params = [];
  
  if (req.query.search) {
    sql += " WHERE patient_id LIKE ? OR full_name LIKE ? OR mobile_number LIKE ?";
    const searchParam = `%${req.query.search}%`;
    params = [searchParam, searchParam, searchParam];
  }
  
  sql += " ORDER BY id DESC";
  
  if (req.query.limit) {
    sql += " LIMIT ?";
    params.push(parseInt(req.query.limit, 10));
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ data: rows });
  });
});

app.get('/api/patients/:id', (req, res) => {
  const sql = "SELECT * FROM patients WHERE patient_id = ?";
  db.get(sql, [req.params.id], (err, row) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ data: row });
  });
});

// --- Activity Logs API ---
app.post('/api/activities', (req, res) => {
  const { activity, patientId, patientName, status } = req.body;
  const now = new Date();
  
  // Format as DD-MM-YYYY HH:mm A
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; 
  const timeStr = `${hours}:${minutes} ${ampm}`;
  const dateStr = `${dd}-${mm}-${yyyy} ${timeStr}`;

  const sql = `INSERT INTO activity_logs (date_time, activity, patient_id, patient_name, status) VALUES (?,?,?,?,?)`;
  db.run(sql, [dateStr, activity, patientId, patientName, status], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Activity logged successfully" });
  });
});

app.get('/api/activities', (req, res) => {
  const sql = "SELECT * FROM activity_logs ORDER BY id DESC";
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ data: rows });
  });
});

// --- Reports API ---
app.get('/api/reports', (req, res) => {
  const sql = "SELECT * FROM reports ORDER BY id DESC";
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ data: rows });
  });
});
// ----------------------------------

app.get("/api/doctors", (req, res) => {
  db.all("SELECT * FROM doctors ORDER BY full_name ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ data: rows });
  });
});

app.post("/api/schedule", (req, res) => {
  const {
    patient_id,
    patient_name,
    scan_type,
    doctor_id,
    doctor_name,
    appointment_date,
    appointment_time
  } = req.body;

  if (!patient_id || !scan_type || !doctor_id || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Generate Schedule ID (SCH-XXXX)
  db.get("SELECT COUNT(*) AS count FROM scheduled_scans", (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Database error while generating Schedule ID." });
    }
    
    const count = row.count + 1;
    const schedule_id = `SCH-${count.toString().padStart(4, '0')}`;
    
    const insertSql = `INSERT INTO scheduled_scans (
      schedule_id, patient_id, patient_name, scan_type, doctor_id, doctor_name, appointment_date, appointment_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(insertSql, [schedule_id, patient_id, patient_name, scan_type, doctor_id, doctor_name, appointment_date, appointment_time], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Also add to activity logs
      const now = new Date();
      const dateString = now.toLocaleDateString('en-GB');
      const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const dateTime = `${dateString} ${timeString}`;
      
      db.run(`INSERT INTO activity_logs (date_time, activity, patient_id, patient_name, status) VALUES (?, ?, ?, ?, ?)`,
        [dateTime, 'Scan Scheduled', patient_id, patient_name, 'Scheduled'],
        (err) => {
          if (err) console.error("Error logging schedule activity:", err.message);
        }
      );

      res.status(201).json({
        message: "Scan scheduled successfully.",
        data: {
          schedule_id,
          patient_id,
          patient_name,
          scan_type,
          scan_type,
          doctor_name,
          appointment_date,
          appointment_time
        }
      });
    });
  });
});

app.get("/api/schedules", (req, res) => {
  const sql = "SELECT * FROM scheduled_scans ORDER BY id DESC";
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});

app.put("/api/schedule/:schedule_id/status", (req, res) => {
  const { schedule_id } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Status is required." });

  db.run("UPDATE scheduled_scans SET status = ? WHERE schedule_id = ?", [status, schedule_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Schedule not found." });
    res.json({ message: `Schedule ${schedule_id} updated to ${status}.` });
  });
});

app.put("/api/schedule/:schedule_id/reschedule", (req, res) => {
  const { schedule_id } = req.params;
  const { appointment_date, appointment_time } = req.body;
  
  if (!appointment_date || !appointment_time) {
    return res.status(400).json({ error: "Date and time are required." });
  }

  db.run(
    "UPDATE scheduled_scans SET appointment_date = ?, appointment_time = ?, status = 'Upcoming' WHERE schedule_id = ?",
    [appointment_date, appointment_time, schedule_id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Schedule not found." });
      res.json({ message: `Schedule ${schedule_id} rescheduled.` });
    }
  );
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
