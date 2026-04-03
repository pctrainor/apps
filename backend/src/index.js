import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4000;

// --- Middleware ---
app.use(helmet());
app.use(cors({ origin: true })); // tighten in production
app.use(express.json({ limit: "64kb" }));

// Rate limit per shop — 60 req / min
const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => req.headers["x-shop-domain"] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// --- Auth middleware ---
// In production you'd verify a signed JWT.
// For now we trust the x-shop-domain header the Shopify app sends.
function requireShop(req, res, next) {
  const shop = req.headers["x-shop-domain"];
  if (!shop || typeof shop !== "string" || !shop.includes(".myshopify.com")) {
    return res.status(401).json({ error: "Missing or invalid x-shop-domain header" });
  }
  req.shop = shop;
  next();
}

// --- Routes ---

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Register / upsert merchant (called on app install or first API hit)
app.post("/api/merchants/register", requireShop, async (req, res) => {
  try {
    const merchant = await prisma.merchant.upsert({
      where: { shopDomain: req.shop },
      update: { shopName: req.body.shopName || null },
      create: { shopDomain: req.shop, shopName: req.body.shopName || null },
    });
    res.json({ merchant });
  } catch (err) {
    console.error("register error", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// List all merchants (directory)
app.get("/api/merchants", requireShop, async (req, res) => {
  try {
    // Ensure caller is registered
    await prisma.merchant.upsert({
      where: { shopDomain: req.shop },
      update: {},
      create: { shopDomain: req.shop },
    });
    const merchants = await prisma.merchant.findMany({
      orderBy: { shopDomain: "asc" },
      select: { id: true, shopDomain: true, shopName: true },
    });
    res.json({ merchants });
  } catch (err) {
    console.error("merchants list error", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Send a message
app.post("/api/messages", requireShop, async (req, res) => {
  try {
    const { toShop, subject, body } = req.body;
    if (!toShop || !body) {
      return res.status(400).json({ error: "toShop and body are required" });
    }
    if (toShop === req.shop) {
      return res.status(400).json({ error: "Cannot message yourself" });
    }

    // Ensure both merchants exist
    await prisma.merchant.upsert({
      where: { shopDomain: req.shop },
      update: {},
      create: { shopDomain: req.shop },
    });

    const recipient = await prisma.merchant.findUnique({
      where: { shopDomain: toShop },
    });
    if (!recipient) {
      return res
        .status(404)
        .json({ error: "Recipient shop not found — they must install the app first" });
    }

    const message = await prisma.message.create({
      data: {
        fromShop: req.shop,
        toShop,
        subject: subject || "",
        body,
      },
    });
    res.status(201).json({ message });
  } catch (err) {
    console.error("send message error", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Inbox — messages sent TO this shop
app.get("/api/messages/inbox", requireShop, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { toShop: req.shop },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ messages });
  } catch (err) {
    console.error("inbox error", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Sent — messages sent BY this shop
app.get("/api/messages/sent", requireShop, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { fromShop: req.shop },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ messages });
  } catch (err) {
    console.error("sent error", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Mark message as read
app.post("/api/messages/:id/read", requireShop, async (req, res) => {
  try {
    const msg = await prisma.message.findUnique({
      where: { id: req.params.id },
    });
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.toShop !== req.shop) {
      return res.status(403).json({ error: "Not your message" });
    }

    const updated = await prisma.message.update({
      where: { id: req.params.id },
      data: { readAt: new Date() },
    });
    res.json({ message: updated });
  } catch (err) {
    console.error("mark read error", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
});
