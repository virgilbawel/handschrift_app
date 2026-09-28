import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Lokaal: lees .env als die bestaat. Op Render/Vercel komen variabelen uit het dashboard.
try {
  process.loadEnvFile();
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const FREE_LIMIT = Number(process.env.FREE_LIMIT) || 3;
const IP_DAILY_LIMIT = Number(process.env.IP_DAILY_LIMIT) || 15;
const MODEL = process.env.MODEL || "claude-opus-5";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const DATA_FILE = path.join(DATA_DIR, "emails.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB upload-limiet
const MAX_API_IMAGE_BYTES = 5 * 1024 * 1024; // limiet per afbeelding van de Anthropic API
// Demomodus: geen aanroep naar Claude, maar een vaste voorbeeldtekst. Alleen voor lokaal testen!
const DEMO_MODE = process.env.DEMO_MODE === "1";

if (DEMO_MODE) {
  console.warn("🧪 DEMOMODUS: er wordt geen API aangeroepen, elke foto geeft dezelfde voorbeeldtekst.");
} else if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY ontbreekt — transcriberen werkt pas als je die instelt (zie README).");
}

const client = new Anthropic(); // leest ANTHROPIC_API_KEY uit de omgeving

// ---------- Opslag van e-mailadressen (simpel JSON-bestand) ----------

let store = {};
let writeQueue = Promise.resolve();

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    store = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    store = {};
  }
}

// Schrijf atomair (eerst naar tijdelijk bestand) en na elkaar, zodat het bestand nooit half is.
function saveStore() {
  writeQueue = writeQueue.then(async () => {
    const tmp = DATA_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(store, null, 2));
    await fs.rename(tmp, DATA_FILE);
  });
  return writeQueue;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function remainingFor(email) {
  return Math.max(0, FREE_LIMIT - (store[email]?.uses || 0));
}

// ---------- Eenvoudige limiet per IP-adres (in geheugen) ----------

const ipHits = new Map(); // ip -> [timestamps]
const DAY_MS = 24 * 60 * 60 * 1000;

function ipAllowed(ip) {
  const now = Date.now();
  const recent = (ipHits.get(ip) || []).filter((t) => now - t < DAY_MS);
  ipHits.set(ip, recent);
  return recent.length < IP_DAILY_LIMIT;
}

function recordIpHit(ip) {
  ipHits.set(ip, [...(ipHits.get(ip) || []), Date.now()]);
}

// ---------- Afbeelding controleren op echte inhoud (niet alleen de bestandsnaam) ----------

function detectImageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

// ---------- Transcriptie via Claude ----------

const SYSTEM_PROMPT = `Je transcribeert handgeschreven teksten van NT2-leerlingen (mensen die Nederlands als tweede taal leren) voor hun docent.

Regels:
- Neem de tekst letterlijk over, precies zoals de leerling hem schreef. Verbeter GEEN spelfouten, grammaticafouten, woordvolgorde of interpunctie: de docent wil juist die fouten beoordelen.
- Behoud alinea's en regelovergangen waar die duidelijk bedoeld zijn.
- Is een woord moeilijk leesbaar, reconstrueer het dan op basis van de context en zet het tussen vierkante haken met een vraagteken, bijvoorbeeld: [boodschappen?]. Kies de lezing die het best past bij wat er op papier staat, ook als dat een fout gespeld woord is.
- Is een woord echt onleesbaar, schrijf dan [onleesbaar].
- Doorgestreepte woorden laat je weg.
- Geef alleen de transcriptie terug, zonder inleiding, uitleg of commentaar.
- Staat er geen handgeschreven tekst op de afbeelding, antwoord dan precies: GEEN_TEKST`;

const DEMO_TEXT = `[DEMO — dit is een voorbeeldtekst, de foto is niet echt gelezen]

Mijn naam is Amina. Ik woon in Utrecht sinds twee jaar. Ik heb drie kinderen, twee [dochters?] en een zoon.

In het weekend ik ga naar de markt met mijn man. Wij kopen groente en fruit. Het is goedkoper dan de [supermarkt?].`;

async function transcribe(buffer, mediaType) {
  if (DEMO_MODE) {
    await new Promise((resolve) => setTimeout(resolve, 2500)); // doe alsof het even duurt
    return DEMO_TEXT;
  }

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Als het model een verzoek onterecht weigert, probeert de API het automatisch met een ander model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
          { type: "text", text: "Transcribeer de handgeschreven tekst op deze foto." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw Object.assign(new Error("refusal"), { userMessage: "Deze afbeelding kon niet verwerkt worden. Probeer een andere foto." });
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text || text === "GEEN_TEKST") {
    throw Object.assign(new Error("no text"), {
      userMessage: "Er is geen handgeschreven tekst gevonden op deze foto. Probeer een scherpere foto van dichterbij.",
      noCharge: true,
    });
  }
  return text;
}

// ---------- Express-app ----------

const app = express();
app.set("trust proxy", 1); // nodig achter de proxy van Render/Vercel voor het juiste IP-adres
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Stap 1: e-mailadres registreren en toegang geven
app.post("/api/register", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "Vul een geldig e-mailadres in." });

  const name = String(req.body?.name || "").trim().slice(0, 100);
  if (!store[email]) {
    store[email] = { email, name, createdAt: new Date().toISOString(), uses: 0, lastUsedAt: null };
    await saveStore();
  } else if (name && !store[email].name) {
    store[email].name = name;
    await saveStore();
  }
  res.json({ ok: true, remaining: remainingFor(email), limit: FREE_LIMIT });
});

const upload = multer({
  storage: multer.memoryStorage(), // foto's worden nooit op schijf opgeslagen
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

const inFlight = new Set(); // voorkomt dat één adres meerdere verzoeken tegelijk doet

app.post("/api/transcribe", (req, res) => {
  upload.single("image")(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === "LIMIT_FILE_SIZE" ? "De foto is te groot (maximaal 10 MB)." : "Het uploaden is mislukt.";
      return res.status(400).json({ error: msg });
    }

    const email = normalizeEmail(req.body?.email);
    if (!email || !store[email]) return res.status(401).json({ error: "Vul eerst je e-mailadres in." });
    if (remainingFor(email) <= 0) {
      return res.status(403).json({ error: "Je hebt je gratis transcripties gebruikt. Bedankt voor het uitproberen!", remaining: 0 });
    }
    if (!ipAllowed(req.ip)) {
      return res.status(429).json({ error: "Er zijn vanaf dit netwerk te veel transcripties gedaan. Probeer het morgen opnieuw." });
    }
    if (!req.file) return res.status(400).json({ error: "Kies eerst een foto (JPG, PNG, WEBP of GIF)." });

    const mediaType = detectImageType(req.file.buffer);
    if (!mediaType) return res.status(400).json({ error: "Dit bestand is geen ondersteunde afbeelding. Gebruik JPG, PNG, WEBP of GIF." });
    if (req.file.buffer.length > MAX_API_IMAGE_BYTES) {
      return res.status(400).json({ error: "De foto is te groot om te verwerken. Probeer een kleinere foto." });
    }
    if (!DEMO_MODE && !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "De tool is nog niet ingesteld. Probeer het later opnieuw." });

    if (inFlight.has(email)) return res.status(429).json({ error: "Er loopt al een transcriptie. Even geduld." });
    inFlight.add(email);
    recordIpHit(req.ip);

    try {
      const text = await transcribe(req.file.buffer, mediaType);
      store[email].uses += 1;
      store[email].lastUsedAt = new Date().toISOString();
      await saveStore();
      res.json({ text, remaining: remainingFor(email) });
    } catch (err) {
      if (err.userMessage) return res.status(422).json({ error: err.userMessage, remaining: remainingFor(email) });
      console.error("Transcriptie mislukt:", err);
      const busy = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError;
      res.status(502).json({
        error: busy
          ? "De dienst is even erg druk. Probeer het over een minuut opnieuw."
          : "Er ging iets mis bij het transcriberen. Probeer het opnieuw.",
      });
    } finally {
      inFlight.delete(email);
    }
  });
});

// Beheer: download de verzamelde e-mailadressen als CSV (alleen met ADMIN_TOKEN)
app.get("/api/admin/emails.csv", (req, res) => {
  const token = req.get("x-admin-token") || req.query.token;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return res.status(401).send("Niet toegestaan");

  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = Object.values(store).map((r) => [r.email, r.name, r.createdAt, r.uses, r.lastUsedAt].map(esc).join(","));
  res.type("text/csv").attachment("emails.csv").send(["email,naam,aangemeld_op,gebruikt,laatst_gebruikt", ...rows].join("\n"));
});

await loadStore();
app.listen(PORT, () => console.log(`Handschriftlezer draait op http://localhost:${PORT}`));
