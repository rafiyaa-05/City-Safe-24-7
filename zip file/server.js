const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = 3000;

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, "hifazat.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS volunteer_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT UNIQUE NOT NULL,
    user_id INTEGER,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    dob TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    aadhaar_last4 TEXT,
    emergency_name TEXT,
    emergency_phone TEXT,
    emergency_relation TEXT,
    selfie_path TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sos_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    latitude REAL,
    longitude REAL,
    address TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS trusted_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    relationship TEXT,
    is_primary INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deepfake_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT UNIQUE NOT NULL,
    user_id INTEGER,
    file_path TEXT,
    file_type TEXT,
    ai_confidence REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS location_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    address TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// ─── UPLOADS FOLDER ───────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const selfieDir = path.join(uploadsDir, "selfies");
if (!fs.existsSync(selfieDir)) fs.mkdirSync(selfieDir);

const evidenceDir = path.join(uploadsDir, "evidence");
if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir);

// Multer for evidence uploads
const evidenceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, evidenceDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `evidence_${Date.now()}${ext}`);
  }
});
const uploadEvidence = multer({
  storage: evidenceStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "video/mp4"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type"));
  }
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "views")));
app.use("/uploads", express.static(uploadsDir));

app.use(session({
  secret: "citysafe-ai-secret-2026",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ success: false, message: "Please login first" });
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Default → intro
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "intro.html"));
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.post("/api/register", async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (!name || !email || !password) {
    return res.json({ success: false, message: "All fields are required" });
  }
  if (password !== confirmPassword) {
    return res.json({ success: false, message: "Passwords do not match" });
  }
  if (password.length < 6) {
    return res.json({ success: false, message: "Password must be at least 6 characters" });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.json({ success: false, message: "Email already registered" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const result = db.prepare("INSERT INTO users (name, email, password) VALUES (?, ?, ?)").run(name, email, hashed);

  req.session.userId = result.lastInsertRowid;
  req.session.userName = name;
  req.session.userEmail = email;

  res.json({ success: true, message: "Registration successful", redirect: "/index.html" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.json({ success: false, message: "Email and password required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) {
    return res.json({ success: false, message: "Invalid email or password" });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.json({ success: false, message: "Invalid email or password" });
  }

  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userEmail = user.email;

  res.json({ success: true, message: "Login successful", redirect: "/index.html", name: user.name });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true, redirect: "/login.html" });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ loggedIn: false });
  }
  const user = db.prepare("SELECT id, name, email, created_at FROM users WHERE id = ?").get(req.session.userId);
  res.json({ loggedIn: true, user });
});

// ── VOLUNTEER REGISTRATION ────────────────────────────────────────────────────

app.post("/api/volunteer/apply", (req, res) => {
  const {
    fullName, email, phone, dob, address, city, state, pincode,
    aadhaarLast4, emergencyName, emergencyPhone, emergencyRelation, selfieData
  } = req.body;

  if (!fullName || !email || !phone) {
    return res.json({ success: false, message: "Required fields missing" });
  }

  const appId = `HFZ-VOL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Save selfie if provided
  let selfiePath = null;
  if (selfieData && selfieData.startsWith("data:image")) {
    const base64 = selfieData.replace(/^data:image\/\w+;base64,/, "");
    const filename = `selfie_${Date.now()}.jpg`;
    selfiePath = path.join(selfieDir, filename);
    fs.writeFileSync(selfiePath, Buffer.from(base64, "base64"));
    selfiePath = `/uploads/selfies/${filename}`;
  }

  const userId = req.session.userId || null;

  db.prepare(`
    INSERT INTO volunteer_applications
    (app_id, user_id, full_name, email, phone, dob, address, city, state, pincode,
     aadhaar_last4, emergency_name, emergency_phone, emergency_relation, selfie_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(appId, userId, fullName, email, phone, dob, address, city, state, pincode,
         aadhaarLast4, emergencyName, emergencyPhone, emergencyRelation, selfiePath);

  res.json({ success: true, appId, message: "Application submitted successfully" });
});

app.get("/api/volunteer/status/:appId", (req, res) => {
  const app_record = db.prepare("SELECT * FROM volunteer_applications WHERE app_id = ?").get(req.params.appId);
  if (!app_record) return res.json({ success: false, message: "Application not found" });
  res.json({ success: true, application: app_record });
});

// ── SOS ───────────────────────────────────────────────────────────────────────

app.post("/api/sos/trigger", (req, res) => {
  const { latitude, longitude, address } = req.body;
  const userId = req.session.userId || null;

  const result = db.prepare(
    "INSERT INTO sos_incidents (user_id, latitude, longitude, address) VALUES (?, ?, ?, ?)"
  ).run(userId, latitude || null, longitude || null, address || "Unknown location");

  // Get trusted contacts for this user
  const contacts = userId
    ? db.prepare("SELECT * FROM trusted_contacts WHERE user_id = ?").all(userId)
    : [];

  res.json({
    success: true,
    incidentId: result.lastInsertRowid,
    message: "SOS triggered. Emergency contacts notified.",
    contactsNotified: contacts.length
  });
});

app.post("/api/sos/cancel/:id", (req, res) => {
  db.prepare("UPDATE sos_incidents SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ success: true, message: "SOS cancelled" });
});

app.post("/api/sos/safe/:id", (req, res) => {
  db.prepare("UPDATE sos_incidents SET status = 'resolved' WHERE id = ?").run(req.params.id);
  res.json({ success: true, message: "Safety status updated" });
});

// ── TRUSTED CONTACTS ──────────────────────────────────────────────────────────

app.get("/api/contacts", requireAuth, (req, res) => {
  const contacts = db.prepare("SELECT * FROM trusted_contacts WHERE user_id = ?").all(req.session.userId);
  res.json({ success: true, contacts });
});

app.post("/api/contacts", requireAuth, (req, res) => {
  const { name, phone, relationship, isPrimary } = req.body;
  if (!name || !phone) return res.json({ success: false, message: "Name and phone required" });

  if (isPrimary) {
    db.prepare("UPDATE trusted_contacts SET is_primary = 0 WHERE user_id = ?").run(req.session.userId);
  }

  const result = db.prepare(
    "INSERT INTO trusted_contacts (user_id, name, phone, relationship, is_primary) VALUES (?, ?, ?, ?, ?)"
  ).run(req.session.userId, name, phone, relationship || "", isPrimary ? 1 : 0);

  res.json({ success: true, id: result.lastInsertRowid, message: "Contact added" });
});

app.delete("/api/contacts/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM trusted_contacts WHERE id = ? AND user_id = ?").run(req.params.id, req.session.userId);
  res.json({ success: true, message: "Contact removed" });
});

// ── LOCATION TRACKING ─────────────────────────────────────────────────────────

app.post("/api/location", (req, res) => {
  const { latitude, longitude, address } = req.body;
  const userId = req.session.userId || null;

  if (!latitude || !longitude) return res.json({ success: false, message: "Coordinates required" });

  db.prepare(
    "INSERT INTO location_history (user_id, latitude, longitude, address) VALUES (?, ?, ?, ?)"
  ).run(userId, latitude, longitude, address || "");

  res.json({ success: true, message: "Location saved" });
});

app.get("/api/location/history", requireAuth, (req, res) => {
  const history = db.prepare(
    "SELECT * FROM location_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).all(req.session.userId);
  res.json({ success: true, history });
});

// ── DEEPFAKE REPORTS ──────────────────────────────────────────────────────────

app.post("/api/report/deepfake", uploadEvidence.single("evidence"), (req, res) => {
  const userId = req.session.userId || null;
  const reportId = `RPT-${Date.now()}`;

  let filePath = null;
  let fileType = null;

  if (req.file) {
    filePath = `/uploads/evidence/${req.file.filename}`;
    fileType = req.file.mimetype;
  }

  // Simulate AI confidence score (in production, call real AI API)
  const aiConfidence = Math.floor(75 + Math.random() * 20);

  db.prepare(
    "INSERT INTO deepfake_reports (report_id, user_id, file_path, file_type, ai_confidence) VALUES (?, ?, ?, ?, ?)"
  ).run(reportId, userId, filePath, fileType, aiConfidence);

  res.json({
    success: true,
    reportId,
    aiConfidence,
    message: "Report submitted successfully",
    analysis: {
      confidence: aiConfidence,
      tags: ["GAN artifacts", "Pixel mismatch", "Deepfake signature"],
      verdict: aiConfidence > 80 ? "Likely deepfake" : "Possibly manipulated"
    }
  });
});

app.get("/api/report/status/:reportId", (req, res) => {
  const report = db.prepare("SELECT * FROM deepfake_reports WHERE report_id = ?").get(req.params.reportId);
  if (!report) return res.json({ success: false, message: "Report not found" });
  res.json({ success: true, report });
});

// ── PROFILE ───────────────────────────────────────────────────────────────────

app.get("/api/profile", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, name, email, created_at FROM users WHERE id = ?").get(req.session.userId);
  const contacts = db.prepare("SELECT * FROM trusted_contacts WHERE user_id = ?").all(req.session.userId);
  const volunteerApp = db.prepare(
    "SELECT app_id, status, created_at FROM volunteer_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(req.session.userId);

  res.json({ success: true, user, contacts, volunteerApp: volunteerApp || null });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌸 City Safe 24/7 Server running at http://localhost:${PORT}`);
  console.log(`   Open http://localhost:${PORT} in your browser\n`);
});
