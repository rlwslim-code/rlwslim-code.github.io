import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { OAuth2Client } from "google-auth-library";
import { installGrimPayments } from "./grim-payments.js";
import { installGrimControl } from "./grim-control/index.js";
import { grimSupabase } from "./grim-control/supabase.js";
import { installGrimV6 } from "./grim-v6.js";
import { installGrimV7 } from "./grim-v7.js";
import { installGrimV8 } from "./grim-v8.js";
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const app = express();

app.set("trust proxy", 1);

const ALLOWED_ORIGINS = new Set([
  "https://rlwslim-code.github.io",
  "https://rlwslim-code-github-io.vercel.app"
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const preview =
    typeof origin === "string" &&
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);

  if (ALLOWED_ORIGINS.has(origin) || preview) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

const sessionSecret =
  process.env.SESSION_SECRET ||
  process.env.PAYSTACK_SECRET_KEY ||
  "grim-development-session-secret-change-me";

if (!process.env.SESSION_SECRET) {
  console.warn(
    "[GRIM] SESSION_SECRET is not set. Add one in Vercel for stable production sessions."
  );
}

app.use(
  session({
    name: "grim.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || !!process.env.VERCEL,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  })
);

/*
 * GRIM Control is installed before the application routes so it can observe
 * signup, login, order, support and payment responses without rewriting them.
 */
installGrimV6(app, { supabase: grimSupabase });
installGrimV7(app, { supabase: grimSupabase });
installGrimControl(app);

const dataDir =
  process.env.DATA_DIR ||
  (process.env.VERCEL ? "/tmp/grim-store" : path.join(__dirname, "..", ".data"));

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "grim.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    price INTEGER NOT NULL,
    color TEXT NOT NULL,
    image TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    order_ref TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS newsletter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const SEED_PRODUCTS = [
  { id: 1, name: "Rose Reaper", type: "Hoodie", price: 28000, color: "Pink" },
  { id: 2, name: "Veil", type: "Hoodie", price: 28000, color: "White" },
  { id: 3, name: "Abyss", type: "Hoodie", price: 28000, color: "Blue" },
  { id: 4, name: "Eclipse Gold", type: "Hoodie", price: 28000, color: "Yellow" },
  { id: 5, name: "Rose Reaper", type: "Hoodie", price: 28000, color: "Pink" },
  { id: 6, name: "Eclipse Gold", type: "Armless", price: 15000, color: "Yellow" },
  { id: 7, name: "Bloodline", type: "Hoodie", price: 28000, color: "Red" },
  { id: 8, name: "Obsidian", type: "Armless", price: 15000, color: "Black" },
  { id: 10, name: "Obsidian / Veil", type: "Tee", price: 18000, color: "Mixed" },
  { id: 11, name: "Veil / Abyss", type: "Hoodie", price: 28000, color: "Mixed" },
  { id: 12, name: "Veil", type: "Tee", price: 18000, color: "White" },
  { id: 13, name: "Veil / Abyss / Obsidian", type: "Armless", price: 15000, color: "Mixed" },
  { id: 14, name: "Void Violet", type: "Hoodie", price: 28000, color: "Purple" },
  { id: 15, name: "Veil / Obsidian", type: "Hoodie", price: 28000, color: "Mixed" },
  { id: 16, name: "Obsidian / Veil", type: "Hoodie", price: 28000, color: "Mixed" },
  { id: 17, name: "Rose Reaper", type: "Hoodie", price: 28000, color: "Pink" },
  { id: 18, name: "Obsidian", type: "Hoodie", price: 28000, color: "Black" },
  { id: 19, name: "Abyss", type: "Hoodie", price: 28000, color: "Blue" },
  { id: 20, name: "Void Violet", type: "Hoodie", price: 28000, color: "Purple" },
  { id: 21, name: "Rose Reaper", type: "Tee", price: 18000, color: "Pink" },
  { id: 22, name: "Veil", type: "Hoodie", price: 28000, color: "White" },
  { id: 23, name: "Obsidian", type: "Tee", price: 18000, color: "Black" },
  { id: 24, name: "Veil / Obsidian", type: "Complete GRIM Outfit", price: 90000, color: "Mixed" },
  { id: 25, name: "Obsidian", type: "Hoodie", price: 28000, color: "Black" },
  { id: 26, name: "Rose Reaper", type: "Hoodie", price: 28000, color: "Pink" }
];

if (db.prepare("SELECT COUNT(*) AS n FROM products").get().n === 0) {
  const insert = db.prepare(`
    INSERT INTO products
      (id, name, type, price, color, image, active, sort_order)
    VALUES
      (@id, @name, @type, @price, @color, @image, 1, @sort_order)
  `);

  const tx = db.transaction(() => {
    SEED_PRODUCTS.forEach((product, index) => {
      insert.run({
        ...product,
        image: null,
        sort_order: index + 1
      });
    });
  });

  tx();
}

let productCache = SEED_PRODUCTS.map((product, index) => ({
  ...product,
  image: null,
  active: 1,
  sort_order: index + 1
}));
let productCacheAt = 0;

function normalizeProduct(product) {
  return {
    id: Number(product.id),
    name: String(product.name || ""),
    type: String(product.type || ""),
    price: Number(product.price || 0),
    color: String(product.color || ""),
    image: product.image || null,
    active: Number(product.active ?? 1),
    sort_order: Number(product.sort_order || 100)
  };
}

async function refreshProductCache(force = false) {
  if (!force && Date.now() - productCacheAt < 30000) {
    return productCache;
  }

  if (grimSupabase) {
    try {
      const { data, error } = await grimSupabase
        .from("products")
        .select("id,name,type,price,color,image,active,sort_order")
        .eq("active", 1)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (!error && Array.isArray(data) && data.length) {
        productCache = data.map(normalizeProduct);
        productCacheAt = Date.now();
        return productCache;
      }

      if (error) {
        console.error("[GRIM] Supabase product refresh:", error.message);
      }
    } catch (error) {
      console.error("[GRIM] Supabase product refresh:", error.message);
    }
  }

  const local = db
    .prepare(`
      SELECT id,name,type,price,color,image,active,sort_order
      FROM products
      WHERE active = 1
      ORDER BY sort_order ASC, id ASC
    `)
    .all();

  if (local.length) {
    productCache = local.map(normalizeProduct);
  }

  productCacheAt = Date.now();
  return productCache;
}

function productById(id) {
  return productCache.find(product => Number(product.id) === Number(id)) || null;
}

async function buildAuthoritativeCart(items) {
  await refreshProductCache();

  const clean = [];
  let total = 0;

  for (const item of Array.isArray(items) ? items : []) {
    const product = productById(Number(item.id));
    const qty = Math.max(1, Math.min(10, Number(item.qty || 1)));

    if (product && Number(product.active) === 1) {
      clean.push({
        ...product,
        qty,
        size: String(item.size || "M").slice(0, 4)
      });
      total += Number(product.price) * qty;
    }
  }

  return { items: clean, total };
}

/*
 * Keep the synchronous Paystack product lookup fresh.
 */
app.use("/api/payments", async (_req, _res, next) => {
  await refreshProductCache();
  next();
});

app.get("/api/products", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const products = await refreshProductCache(true);
  res.json(products.filter(product => Number(product.active) === 1));
});

app.get("/api/market", (req, res) => {
  const raw =
    req.headers["x-vercel-ip-country"] ||
    req.headers["cf-ipcountry"] ||
    "NG";

  const country = /^[A-Z]{2}$/.test(String(raw).toUpperCase())
    ? String(raw).toUpperCase()
    : "NG";

  res.json({ country });
});

app.get("/api/me", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(req.session?.user || null);
});

app.get("/api/google-config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    clientId: process.env.GOOGLE_CLIENT_ID || ""
  });
});

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

app.post("/api/register", async (req, res) => {
  try {
    const {
      name,
      firstName,
      lastName,
      email,
      phone,
      password
    } = req.body || {};

    const normalizedEmail = cleanEmail(email);
    const displayName =
      String(name || `${firstName || ""} ${lastName || ""}`)
        .trim()
        .slice(0, 160);

    if (!displayName || !normalizedEmail || !phone) {
      return res.status(400).json({
        error: "Complete all required account fields."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        error: "Enter a valid email address."
      });
    }

    if (!validPassword(password)) {
      return res.status(400).json({
        error: "Complete all password requirements."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = db
      .prepare(`
        INSERT INTO users
          (name, first_name, last_name, email, phone, password_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        displayName,
        String(firstName || "").trim().slice(0, 80) || null,
        String(lastName || "").trim().slice(0, 80) || null,
        normalizedEmail,
        String(phone).trim().slice(0, 80),
        passwordHash
      );

    req.session.user = {
      id: Number(result.lastInsertRowid),
      name: displayName,
      firstName: String(firstName || "").trim() || undefined,
      lastName: String(lastName || "").trim() || undefined,
      email: normalizedEmail,
      phone: String(phone).trim()
    };

    return res.json(req.session.user);
  } catch (error) {
    if (
      String(error?.code || "").includes("SQLITE_CONSTRAINT") ||
      String(error?.message || "").toLowerCase().includes("unique")
    ) {
      return res.status(400).json({
        error: "Email already registered."
      });
    }

    console.error("[GRIM] register:", error);
    return res.status(500).json({
      error: "Unable to create the account right now."
    });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = cleanEmail(email);

  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(normalizedEmail);

  if (!user || !(await bcrypt.compare(String(password || ""), user.password_hash))) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    firstName: user.first_name || undefined,
    lastName: user.last_name || undefined,
    email: user.email,
    phone: user.phone || undefined
  };

  return res.json(req.session.user);
});

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || undefined);

app.post("/api/auth/google", async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({
        error: "Google Sign-In is not configured."
      });
    }

    const credential = String(req.body?.credential || "").trim();

    if (!credential) {
      return res.status(400).json({
        error: "Google credential is required."
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const profile = ticket.getPayload();

    if (!profile?.email || profile.email_verified === false) {
      return res.status(401).json({
        error: "Google could not verify this email address."
      });
    }

    const email = cleanEmail(profile.email);
    const name =
      String(
        profile.name ||
        [profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
        email.split("@")[0]
      )
        .trim()
        .slice(0, 160);

    let user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);

    let newUser = false;

    if (!user) {
      const unusablePassword = await bcrypt.hash(
        crypto.randomBytes(32).toString("hex"),
        12
      );

      const result = db
        .prepare(`
          INSERT INTO users
            (name, first_name, last_name, email, phone, password_hash)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          name,
          String(profile.given_name || "").trim().slice(0, 80) || null,
          String(profile.family_name || "").trim().slice(0, 80) || null,
          email,
          null,
          unusablePassword
        );

      user = {
        id: Number(result.lastInsertRowid),
        name,
        first_name: profile.given_name || null,
        last_name: profile.family_name || null,
        email,
        phone: null
      };

      newUser = true;
    }

    req.session.user = {
      id: user.id,
      name: user.name || name,
      firstName: user.first_name || profile.given_name || undefined,
      lastName: user.last_name || profile.family_name || undefined,
      email: user.email,
      phone: user.phone || undefined
    };

    return res.json({
      ok: true,
      ...req.session.user,
      newUser
    });
  } catch (error) {
    console.error("[GRIM] Google Sign-In:", error);
    return res.status(401).json({
      error: "Google Sign-In failed."
    });
  }
});

async function notifyOrder(order) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.STORE_OWNER_EMAIL
  ) {
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.STORE_OWNER_EMAIL,
    replyTo: order.email,
    subject: `GRIM ORDER #${order.id}`,
    text:
      `Name: ${order.name}\n` +
      `Email: ${order.email}\n` +
      `Phone: ${order.phone}\n` +
      `Address: ${order.address}\n` +
      `Total: ₦${Number(order.total).toLocaleString()}\n\n` +
      order.items
        .map(item => `${item.name} / ${item.size} / Qty ${item.qty}`)
        .join("\n")
  });
}

installGrimV8(app, {
  supabase: grimSupabase,
  priceCart: buildAuthoritativeCart,
  notifyOrder
});

app.post("/api/orders", async (req, res) => {
  const {
    name,
    email,
    phone,
    address,
    items,
    country,
    currency
  } = req.body || {};

  if (!name || !email || !phone || !address || !Array.isArray(items) || !items.length) {
    return res.status(400).json({
      error: "Complete checkout details."
    });
  }

  await refreshProductCache();

  const clean = [];
  let total = 0;

  for (const item of items) {
    const product = productById(Number(item.id));
    const qty = Math.max(1, Math.min(10, Number(item.qty || 1)));

    if (product && Number(product.active) === 1) {
      clean.push({
        ...product,
        qty,
        size: String(item.size || "M").slice(0, 4)
      });
      total += Number(product.price) * qty;
    }
  }

  if (!clean.length) {
    return res.status(400).json({
      error: "Your cart has no available products."
    });
  }

  const local = db
    .prepare(`
      INSERT INTO orders
        (user_id, name, email, phone, address, items_json, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      req.session?.user?.id || null,
      String(name).trim(),
      cleanEmail(email),
      String(phone).trim(),
      String(address).trim(),
      JSON.stringify(clean),
      total
    );

  const order = {
    id: Number(local.lastInsertRowid),
    name: String(name).trim(),
    email: cleanEmail(email),
    phone: String(phone).trim(),
    address: String(address).trim(),
    items: clean,
    total
  };

  /*
   * Keep the Owner Studio order list in sync when its Supabase `orders`
   * table is available. Failure here does not block the customer's order.
   */
  if (grimSupabase) {
    try {
      const payload = {
        name: order.name,
        email: order.email,
        phone: order.phone,
        address: order.address,
        total: order.total,
        status: "new",
        items: clean,
        country: country || "NG",
        currency: currency || "NGN"
      };

      const { data, error } = await grimSupabase
        .from("orders")
        .insert(payload)
        .select("id")
        .single();

      if (!error && data?.id != null) {
        order.id = data.id;
      } else if (error) {
        console.error("[GRIM] Supabase order mirror:", error.message);
      }
    } catch (error) {
      console.error("[GRIM] Supabase order mirror:", error.message);
    }
  }

  try {
    await notifyOrder(order);
  } catch (error) {
    console.error("[GRIM] order email:", error);
  }

  return res.json({
    ok: true,
    orderId: order.id,
    total,
    country: country || "NG",
    currency: currency || "NGN"
  });
});

app.post("/api/support", async (req, res) => {
  const {
    topic,
    name,
    email,
    order,
    message
  } = req.body || {};

  if (!topic || !name || !email || !message) {
    return res.status(400).json({
      error: "Complete the required fields."
    });
  }

  const result = db
    .prepare(`
      INSERT INTO support_tickets
        (topic, name, email, order_ref, message)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      String(topic).slice(0, 80),
      String(name).slice(0, 100),
      cleanEmail(email).slice(0, 160),
      String(order || "").slice(0, 50),
      String(message).slice(0, 3000)
    );

  if (grimSupabase) {
    try {
      await grimSupabase.from("support_tickets").insert({
        topic: String(topic).slice(0, 80),
        name: String(name).slice(0, 100),
        email: cleanEmail(email).slice(0, 160),
        order_ref: String(order || "").slice(0, 50),
        message: String(message).slice(0, 3000)
      });
    } catch (_) {}
  }

  if (process.env.SMTP_HOST && process.env.STORE_OWNER_EMAIL) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: process.env.STORE_OWNER_EMAIL,
        replyTo: cleanEmail(email),
        subject: `GRIM CUSTOMER CARE #${result.lastInsertRowid} — ${topic}`,
        text:
          `Name: ${name}\n` +
          `Email: ${email}\n` +
          `Order: ${order || "N/A"}\n` +
          `Topic: ${topic}\n\n` +
          `${message}`
      });
    } catch (error) {
      console.error("[GRIM] support email:", error);
    }
  }

  return res.json({
    ok: true,
    ticketId: Number(result.lastInsertRowid)
  });
});

app.post("/api/newsletter", async (req, res) => {
  const email = cleanEmail(req.body?.email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      error: "Enter a valid email address."
    });
  }

  try {
    db.prepare("INSERT OR IGNORE INTO newsletter(email) VALUES (?)").run(email);

    if (grimSupabase) {
      try {
        await grimSupabase
          .from("newsletter_subscribers")
          .upsert({ email }, { onConflict: "email" });
      } catch (_) {}
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("[GRIM] newsletter:", error);
    return res.status(500).json({
      error: "Unable to join the list right now."
    });
  }
});

/*
 * Existing Paystack implementation. GRIM Control observes the verify response
 * and creates payment activity / notifications without changing payment logic.
 */
installGrimPayments(app, { productById, supabase: grimSupabase });

app.use(
  express.static(publicDir, {
    etag: true,
    maxAge: process.env.NODE_ENV === "production" ? "5m" : 0
  })
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "GRIM API route not found."
    });
  }
  next();
});

app.use((error, req, res, _next) => {
  console.error("[GRIM] Unhandled error:", error);
  if (res.headersSent) return;
  res.status(500).json({
    error: "GRIM encountered a server error."
  });
});

const port = Number(process.env.PORT || 3000);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`[GRIM] Store running on http://localhost:${port}`);
  });
}

export default app;
