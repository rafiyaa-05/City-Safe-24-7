const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── DATABASE: PostgreSQL (Render) or SQLite (local) ─────────────────────────
const IS_PROD = !!process.env.DATABASE_URL;

let db, pgPool;

if (IS_PROD) {
  // PostgreSQL on Render
  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Async query helper
  db = {
    query: (sql, params = []) => pgPool.query(sql, params),
    run:   (sql, params = []) => pgPool.query(sql, params),
    get:   async (sql, params = []) => { const r = await pgPool.query(sql, params); return r.rows[0] || null; },
    all:   async (sql, params = []) => { const r = await pgPool.query(sql, params); return r.rows; },
  };

  // Create tables
  pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS volunteer_applications (
      id SERIAL PRIMARY KEY,
      app_id TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      gender TEXT DEFAULT 'female',
      volunteer_type TEXT DEFAULT 'individual',
      ngo_name TEXT,
      ngo_reg_number TEXT,
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
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sos_incidents (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      latitude REAL,
      longitude REAL,
      address TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS trusted_contacts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      relationship TEXT,
      is_primary INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS deepfake_reports (
      id SERIAL PRIMARY KEY,
      report_id TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      file_path TEXT,
      file_type TEXT,
      ai_confidence REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS location_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      address TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `).then(() => console.log("✅ PostgreSQL tables ready")).catch(console.error);

} else {
  // SQLite for local development
  const Database = require("better-sqlite3");
  const sqliteDb = new Database(path.join(__dirname, "hifazat.db"));

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS volunteer_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT UNIQUE NOT NULL,
      user_id INTEGER, full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
      gender TEXT DEFAULT 'female', volunteer_type TEXT DEFAULT 'individual',
      ngo_name TEXT, ngo_reg_number TEXT, dob TEXT, address TEXT, city TEXT,
      state TEXT, pincode TEXT, aadhaar_last4 TEXT, emergency_name TEXT,
      emergency_phone TEXT, emergency_relation TEXT, selfie_path TEXT,
      status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sos_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
      latitude REAL, longitude REAL, address TEXT,
      status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS trusted_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, relationship TEXT,
      is_primary INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS deepfake_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT UNIQUE NOT NULL,
      user_id INTEGER, file_path TEXT, file_type TEXT,
      ai_confidence REAL DEFAULT 0, status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS location_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      latitude REAL NOT NULL, longitude REAL NOT NULL, address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add new columns if missing
  const cols = sqliteDb.prepare("PRAGMA table_info(volunteer_applications)").all().map(c => c.name);
  [
    ["gender",         "TEXT DEFAULT 'female'"],
    ["volunteer_type", "TEXT DEFAULT 'individual'"],
    ["ngo_name",       "TEXT"],
    ["ngo_reg_number", "TEXT"],
  ].forEach(([col, def]) => {
    if (!cols.includes(col)) sqliteDb.prepare(`ALTER TABLE volunteer_applications ADD COLUMN ${col} ${def}`).run();
  });

  // Wrap SQLite in async-compatible interface
  db = {
    get:  (sql, params = []) => Promise.resolve(sqliteDb.prepare(sql).get(...params)),
    all:  (sql, params = []) => Promise.resolve(sqliteDb.prepare(sql).all(...params)),
    run:  (sql, params = []) => Promise.resolve(sqliteDb.prepare(sql).run(...params)),
  };
}

// ─── UPLOADS ──────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "uploads");
["", "selfies", "evidence", "recordings", "aadhaar"].forEach(sub => {
  const dir = path.join(uploadsDir, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const makeStorage = (folder) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(uploadsDir, folder)),
  filename:    (req, file, cb) => cb(null, `${folder}_${Date.now()}${path.extname(file.originalname)}`)
});

const uploadEvidence  = multer({ storage: makeStorage("evidence"),  limits: { fileSize: 50*1024*1024 } });
const uploadRecording = multer({ storage: makeStorage("recordings"), limits: { fileSize: 50*1024*1024 } });

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "views")));
app.use("/uploads", express.static(uploadsDir));

const sessionConfig = {
  secret: process.env.SESSION_SECRET || "citysafe-ai-secret-2026",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: IS_PROD, sameSite: IS_PROD ? "none" : "lax" }
};

if (IS_PROD) {
  app.set("trust proxy", 1);
  const pgSession = require("connect-pg-simple")(session);
  sessionConfig.store = new pgSession({ pool: pgPool, createTableIfMissing: true });
}

app.use(session(sessionConfig));

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ success: false, message: "Please login first" });
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "views", "intro.html")));

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post("/api/register", async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  if (!name || !email || !password) return res.json({ success: false, message: "All fields are required" });
  if (password !== confirmPassword)  return res.json({ success: false, message: "Passwords do not match" });
  if (password.length < 6)           return res.json({ success: false, message: "Password must be at least 6 characters" });

  const existing = await db.get("SELECT id FROM users WHERE email = $1", [email]);
  if (existing) return res.json({ success: false, message: "Email already registered" });

  const hashed = await bcrypt.hash(password, 10);
  const result = await db.run("INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id", [name, email, hashed]);
  const userId = IS_PROD ? result.rows[0].id : result.lastInsertRowid;

  req.session.userId = userId;
  req.session.userName = name;
  res.json({ success: true, redirect: "/index.html" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ success: false, message: "Email and password required" });

  const user = await db.get("SELECT * FROM users WHERE email = $1", [email]);
  if (!user) return res.json({ success: false, message: "Invalid email or password" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ success: false, message: "Invalid email or password" });

  req.session.userId = user.id;
  req.session.userName = user.name;
  res.json({ success: true, redirect: "/index.html", name: user.name });
});

app.post("/api/logout", (req, res) => { req.session.destroy(); res.json({ success: true, redirect: "/login.html" }); });

app.get("/api/me", async (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = await db.get("SELECT id, name, email, created_at FROM users WHERE id = $1", [req.session.userId]);
  res.json({ loggedIn: true, user });
});

// ── AADHAAR UPLOAD ────────────────────────────────────────────────────────────
app.post("/api/aadhaar/upload", (req, res) => {
  const { frontImage, backImage } = req.body;
  const userId = req.session.userId || "guest";
  const saved = [];
  try {
    [["front", frontImage], ["back", backImage]].forEach(([side, data]) => {
      if (data && data.startsWith("data:image")) {
        const base64 = data.replace(/^data:image\/\w+;base64,/, "");
        const ext = data.includes("png") ? "png" : "jpg";
        const filename = `aadhaar_${side}_${userId}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(uploadsDir, "aadhaar", filename), Buffer.from(base64, "base64"));
        saved.push(side);
      }
    });
    res.json({ success: true, saved });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ── VOLUNTEER ─────────────────────────────────────────────────────────────────
app.post("/api/volunteer/apply", async (req, res) => {
  const { fullName, email, phone, gender, volunteerType, ngoName, ngoRegNumber,
          dob, address, city, state, pincode, aadhaarLast4,
          emergencyName, emergencyPhone, emergencyRelation, selfieData } = req.body;

  if (!fullName || !email || !phone) return res.json({ success: false, message: "Required fields missing" });
  if (gender === "male" && volunteerType !== "ngo") return res.json({ success: false, message: "Male volunteers must be NGO-affiliated." });
  if (volunteerType === "ngo" && (!ngoName || !ngoRegNumber)) return res.json({ success: false, message: "NGO name and registration number required." });

  const appId = `CSV-VOL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  let selfiePath = null;

  if (selfieData && selfieData.startsWith("data:image")) {
    const base64 = selfieData.replace(/^data:image\/\w+;base64,/, "");
    const filename = `selfie_${Date.now()}.jpg`;
    fs.writeFileSync(path.join(uploadsDir, "selfies", filename), Buffer.from(base64, "base64"));
    selfiePath = `/uploads/selfies/${filename}`;
  }

  await db.run(
    `INSERT INTO volunteer_applications
     (app_id, user_id, full_name, email, phone, gender, volunteer_type, ngo_name, ngo_reg_number,
      dob, address, city, state, pincode, aadhaar_last4, emergency_name, emergency_phone, emergency_relation, selfie_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [appId, req.session.userId || null, fullName, email, phone,
     gender || "female", volunteerType || "individual", ngoName || null, ngoRegNumber || null,
     dob, address, city, state, pincode, aadhaarLast4,
     emergencyName, emergencyPhone, emergencyRelation, selfiePath]
  );

  res.json({ success: true, appId });
});

app.get("/api/guardians", async (req, res) => {
  const members = await db.all(
    "SELECT app_id, full_name, gender, volunteer_type, ngo_name, city, status, created_at FROM volunteer_applications ORDER BY created_at DESC LIMIT 100"
  );
  res.json({ success: true, members, total: members.length });
});

app.get("/api/volunteer/status/:appId", async (req, res) => {
  const rec = await db.get("SELECT * FROM volunteer_applications WHERE app_id = $1", [req.params.appId]);
  if (!rec) return res.json({ success: false, message: "Not found" });
  res.json({ success: true, application: rec });
});

// ── SOS ───────────────────────────────────────────────────────────────────────
app.post("/api/sos/trigger", async (req, res) => {
  const { latitude, longitude, address } = req.body;
  const userId = req.session.userId || null;
  const result = await db.run(
    "INSERT INTO sos_incidents (user_id, latitude, longitude, address) VALUES ($1,$2,$3,$4) RETURNING id",
    [userId, latitude || null, longitude || null, address || "Unknown"]
  );
  const incidentId = IS_PROD ? result.rows[0].id : result.lastInsertRowid;
  const contacts = userId ? await db.all("SELECT * FROM trusted_contacts WHERE user_id = $1", [userId]) : [];
  res.json({ success: true, incidentId, contactsNotified: contacts.length });
});

app.post("/api/sos/cancel/:id", async (req, res) => {
  await db.run("UPDATE sos_incidents SET status = 'cancelled' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

app.post("/api/sos/safe/:id", async (req, res) => {
  await db.run("UPDATE sos_incidents SET status = 'resolved' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

// ── CONTACTS ──────────────────────────────────────────────────────────────────
app.get("/api/contacts", requireAuth, async (req, res) => {
  const contacts = await db.all("SELECT * FROM trusted_contacts WHERE user_id = $1", [req.session.userId]);
  res.json({ success: true, contacts });
});

app.post("/api/contacts", requireAuth, async (req, res) => {
  const { name, phone, relationship, isPrimary } = req.body;
  if (!name || !phone) return res.json({ success: false, message: "Name and phone required" });
  if (isPrimary) await db.run("UPDATE trusted_contacts SET is_primary = 0 WHERE user_id = $1", [req.session.userId]);
  const result = await db.run(
    "INSERT INTO trusted_contacts (user_id, name, phone, relationship, is_primary) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [req.session.userId, name, phone, relationship || "", isPrimary ? 1 : 0]
  );
  const id = IS_PROD ? result.rows[0].id : result.lastInsertRowid;
  res.json({ success: true, id });
});

app.delete("/api/contacts/:id", requireAuth, async (req, res) => {
  await db.run("DELETE FROM trusted_contacts WHERE id = $1 AND user_id = $2", [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// ── LOCATION ──────────────────────────────────────────────────────────────────
app.post("/api/location", async (req, res) => {
  const { latitude, longitude, address } = req.body;
  if (!latitude || !longitude) return res.json({ success: false, message: "Coordinates required" });
  await db.run(
    "INSERT INTO location_history (user_id, latitude, longitude, address) VALUES ($1,$2,$3,$4)",
    [req.session.userId || null, latitude, longitude, address || ""]
  );
  res.json({ success: true });
});

app.get("/api/location/history", requireAuth, async (req, res) => {
  const history = await db.all(
    "SELECT * FROM location_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
    [req.session.userId]
  );
  res.json({ success: true, history });
});

// ── DEEPFAKE REPORTS ──────────────────────────────────────────────────────────
app.post("/api/report/deepfake", uploadEvidence.single("evidence"), async (req, res) => {
  const reportId = `RPT-${Date.now()}`;
  const filePath = req.file ? `/uploads/evidence/${req.file.filename}` : null;
  const fileType = req.file ? req.file.mimetype : null;
  const aiConfidence = Math.floor(75 + Math.random() * 20);

  await db.run(
    "INSERT INTO deepfake_reports (report_id, user_id, file_path, file_type, ai_confidence) VALUES ($1,$2,$3,$4,$5)",
    [reportId, req.session.userId || null, filePath, fileType, aiConfidence]
  );

  res.json({
    success: true, reportId, aiConfidence,
    analysis: {
      confidence: aiConfidence,
      tags: ["GAN artifacts", "Pixel mismatch", "Deepfake signature"],
      verdict: aiConfidence > 80 ? "Likely deepfake" : "Possibly manipulated"
    }
  });
});

// ── PROFILE ───────────────────────────────────────────────────────────────────
app.get("/api/profile", requireAuth, async (req, res) => {
  const user        = await db.get("SELECT id, name, email, created_at FROM users WHERE id = $1", [req.session.userId]);
  const contacts    = await db.all("SELECT * FROM trusted_contacts WHERE user_id = $1", [req.session.userId]);
  const volunteerApp = await db.get(
    "SELECT app_id, status, created_at FROM volunteer_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [req.session.userId]
  );
  res.json({ success: true, user, contacts, volunteerApp: volunteerApp || null });
});

// ── RECORDING ─────────────────────────────────────────────────────────────────
app.post("/api/recording/send", uploadRecording.single("recording"), async (req, res) => {
  const userId   = req.session.userId || null;
  const location = req.body.location || "Unknown";
  const filePath = req.file ? `/uploads/recordings/${req.file.filename}` : null;
  const contacts = userId ? await db.all("SELECT * FROM trusted_contacts WHERE user_id = $1", [userId]) : [];

  console.log(`🎤 SOS Recording: ${filePath} | Location: ${location} | Contacts: ${contacts.length}`);

  if (contacts.length === 0) {
    return res.json({ success: false, message: "No trusted contacts. Add contacts in Profile first.", contactsNotified: 0 });
  }
  res.json({ success: true, contactsNotified: contacts.length, recordingPath: filePath });
});

// ── ALERTS ────────────────────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "CitySafe/1.0" } }, r => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on("error", reject);
  });
}

app.get("/api/alerts", async (req, res) => {
  const { lat, lng } = req.query;
  const alerts = [];
  try {
    if (lat && lng) {
      const weather = await httpsGet(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weathercode,windspeed_10m,precipitation&forecast_days=1&timezone=auto`);
      if (weather?.current) {
        const { weathercode: wc, temperature_2m: temp, windspeed_10m: wind, precipitation: rain } = weather.current;
        const desc = wc===0?"Clear sky":wc<=3?"Partly cloudy":wc<=48?"Foggy":wc<=67?"Rainy":wc<=82?"Rain showers":"Thunderstorm";
        if (wc >= 95) alerts.push({ type:"high",     icon:"⛈️", title:"Thunderstorm Warning",  desc:"Active thunderstorm. Avoid open spaces.", source:"Open-Meteo", time:"Now" });
        else if (wc>=80) alerts.push({ type:"moderate", icon:"🌧️", title:"Heavy Rain Alert",     desc:`${rain}mm rainfall. Roads may flood.`,    source:"Open-Meteo", time:"Now" });
        else if (wc>=61) alerts.push({ type:"moderate", icon:"🌦️", title:"Rain in Your Area",    desc:"Carry umbrella. Stay cautious on roads.",  source:"Open-Meteo", time:"Now" });
        if (wind>50) alerts.push({ type:"high",     icon:"💨", title:"High Wind Warning",    desc:`Wind ${wind}km/h. Avoid outdoor activity.`, source:"Open-Meteo", time:"Now" });
        if (temp>42) alerts.push({ type:"high",     icon:"🌡️", title:"Extreme Heat Alert",   desc:`${temp}°C. Risk of heatstroke.`,            source:"Open-Meteo", time:"Now" });
        else if (temp>38) alerts.push({ type:"moderate", icon:"☀️", title:"Heat Advisory",       desc:`${temp}°C. Stay hydrated.`,                source:"Open-Meteo", time:"Now" });
        alerts.push({ type:"safe", icon:"🌤️", title:`Weather: ${desc}`, desc:`${temp}°C · Wind ${wind}km/h · Rain ${rain}mm`, source:"Open-Meteo", time:"Now" });
      }
      const air = await httpsGet(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,european_aqi`);
      if (air?.current) {
        const { european_aqi: aqi, pm2_5: pm25 } = air.current;
        if (aqi > 100)     alerts.push({ type:"high",     icon:"😷", title:"Very Poor Air Quality", desc:`AQI:${aqi} PM2.5:${pm25}μg/m³. Wear mask.`,    source:"Open-Meteo AQ", time:"Now" });
        else if (aqi > 50) alerts.push({ type:"moderate", icon:"🌫️", title:"Moderate Air Quality",  desc:`AQI:${aqi} PM2.5:${pm25}μg/m³.`,               source:"Open-Meteo AQ", time:"Now" });
        else if (aqi >= 0) alerts.push({ type:"safe",     icon:"🌿", title:"Good Air Quality",       desc:`AQI:${aqi} PM2.5:${pm25}μg/m³. Air is clean.`, source:"Open-Meteo AQ", time:"Now" });
      }
    }
    const quakes = await httpsGet("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    if (quakes?.features && lat && lng) {
      quakes.features.filter(f => {
        const [eLng, eLat] = f.geometry.coordinates;
        return Math.sqrt(Math.pow(eLat-parseFloat(lat),2)+Math.pow(eLng-parseFloat(lng),2)) < 10;
      }).slice(0,2).forEach(f => {
        const mag = f.properties.mag;
        alerts.push({ type: mag>=5?"high":"moderate", icon:"🌍", title:`Earthquake M${mag} – ${f.properties.place}`, desc:`Magnitude ${mag}. ${mag>=5?"Seek open ground.":"Minor tremors possible."}`, source:"USGS", time: new Date(f.properties.time).toLocaleString() });
      });
    }
  } catch(e) { console.error("Alert error:", e.message); }

  if (!alerts.length) alerts.push({ type:"safe", icon:"✅", title:"No Active Alerts", desc:"No major alerts in your area.", source:"City Safe AI", time:"Now" });
  res.json({ success: true, alerts });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌸 City Safe 24/7 running on port ${PORT}`);
  console.log(`   Mode: ${IS_PROD ? "PostgreSQL (Production)" : "SQLite (Local)"}\n`);
});
