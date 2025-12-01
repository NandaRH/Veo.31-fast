import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import next from "next";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { createClient } from "@supabase/supabase-js";

const envLocalPath = path.resolve(process.cwd(), ".env.server.local");

// Prefer .env.server.local, fallback to .env
try {
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  } else {
    dotenv.config();
  }
} catch (e) {
  // If dotenv fails, continue; handler below will surface missing LABS_BEARER
}

const app = express();
const PORT = process.env.PORT || 8790;
const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev, dir: path.resolve(process.cwd(), ".") });
const handleNext = nextApp.getRequestHandler();

app.use(cors());
// Naikkan limit agar bisa upload gambar kecil via base64
app.use(express.json({ limit: "25mb" }));
// Serve folder uploads untuk gambar referensi
const uploadsDir = path.resolve(process.cwd(), "uploads");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch (_) {}
app.use("/uploads", express.static(uploadsDir));

// Set ffmpeg binary path (ffmpeg-static)
try {
  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
} catch (_) {}

// Metadata store for uploads (e.g., persisted Media ID per file)
const uploadsMetaPath = path.join(uploadsDir, "uploads-meta.json");
const usageStatsPath = path.join(uploadsDir, "usage-stats.json");
const sessionsPath = path.join(uploadsDir, "sessions.json");
const readUploadsMeta = () => {
  try {
    if (!fs.existsSync(uploadsMetaPath)) return {};
    const raw = fs.readFileSync(uploadsMetaPath, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : {};
  } catch (_) {
    return {};
  }
};
const writeUploadsMeta = (meta) => {
  try {
    const content = JSON.stringify(meta || {}, null, 2);
    fs.writeFileSync(uploadsMetaPath, content, "utf8");
  } catch (_) {}
};

const readUsageStats = () => {
  try {
    if (!fs.existsSync(usageStatsPath)) return {};
    const raw = fs.readFileSync(usageStatsPath, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : {};
  } catch (_) {
    return {};
  }
};
const writeUsageStats = (stats) => {
  try {
    const content = JSON.stringify(stats || {}, null, 2);
    fs.writeFileSync(usageStatsPath, content, "utf8");
  } catch (_) {}
};
const readSessions = () => {
  try {
    if (!fs.existsSync(sessionsPath)) return {};
    const raw = fs.readFileSync(sessionsPath, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : {};
  } catch (_) {
    return {};
  }
};
const writeSessions = (sessions) => {
  try {
    const content = JSON.stringify(sessions || {}, null, 2);
    fs.writeFileSync(sessionsPath, content, "utf8");
  } catch (_) {}
};
const parseCookies = (cookieHeader) => {
  try {
    const map = Object.fromEntries(
      String(cookieHeader || "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const i = s.indexOf("=");
          const k = i >= 0 ? s.slice(0, i).trim() : s;
          const v = i >= 0 ? s.slice(i + 1).trim() : "";
          return [k, decodeURIComponent(v)];
        })
    );
    return map;
  } catch (_) {
    return {};
  }
};
const bumpUsage = (user, type) => {
  try {
    const { id, email, name, plan } = user || {};
    const uid = String(id || "").trim();
    if (!uid) return;
    const stats = readUsageStats();
    const nowIso = new Date().toISOString();
    const cur = stats[uid] || {
      id: uid,
      email: email || undefined,
      name: name || undefined,
      plan: plan || undefined,
      counts: { veo: 0, sora2: 0, image: 0 },
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    cur.counts = cur.counts || { veo: 0, sora2: 0, image: 0 };
    if (type === "veo") cur.counts.veo = (cur.counts.veo || 0) + 1;
    else if (type === "sora2") cur.counts.sora2 = (cur.counts.sora2 || 0) + 1;
    else if (type === "image") cur.counts.image = (cur.counts.image || 0) + 1;
    cur.email = email || cur.email;
    cur.name = name || cur.name;
    cur.plan = plan || cur.plan;
    cur.updatedAt = nowIso;
    stats[uid] = cur;
    writeUsageStats(stats);
  } catch (_) {}
};

// Establish server-side session via HttpOnly cookies after verifying Supabase token
app.post("/api/session/establish", async (req, res) => {
  try {
    if (!srSupabase)
      return res.status(500).json({ error: "Supabase not configured" });
    const authHeader = String(req.headers["authorization"] || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing token" });
    const { data: userData, error } = await srSupabase.auth.getUser(token);
    if (error)
      return res.status(401).json({ error: String(error.message || error) });
    const uid = String(userData?.user?.id || "").trim();
    const email = String(userData?.user?.email || "").toLowerCase();
    if (!uid) return res.status(401).json({ error: "Invalid user" });
    try {
      const cookies = [];
      const sessions = readSessions();
      const sessionKey = crypto.randomBytes(16).toString("hex");
      sessions[uid] = {
        key: sessionKey,
        uid,
        email,
        updatedAt: new Date().toISOString(),
      };
      writeSessions(sessions);
      cookies.push(
        `auth_ok=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
      );
      cookies.push(
        `auth_uid=${encodeURIComponent(
          uid
        )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
      );
      cookies.push(
        `auth_email=${encodeURIComponent(
          email
        )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
      );
      cookies.push(
        `auth_session=${encodeURIComponent(
          sessionKey
        )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
      );
      res.setHeader("Set-Cookie", cookies);
    } catch (_) {}
    res.json({ ok: true, uid, email });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/session/logout", async (req, res) => {
  try {
    try {
      const cookieHeader = String(req.headers["cookie"] || "");
      const cookiesIn = parseCookies(cookieHeader);
      const uid = String(cookiesIn.auth_uid || "").trim();
      if (uid) {
        const sessions = readSessions();
        if (sessions && sessions[uid]) {
          delete sessions[uid];
          writeSessions(sessions);
        }
      }
    } catch (_) {}
    const cookies = [];
    const expire = "Max-Age=0";
    cookies.push(`auth_ok=; Path=/; HttpOnly; SameSite=Lax; ${expire}`);
    cookies.push(`auth_uid=; Path=/; HttpOnly; SameSite=Lax; ${expire}`);
    cookies.push(`auth_email=; Path=/; HttpOnly; SameSite=Lax; ${expire}`);
    cookies.push(`auth_session=; Path=/; HttpOnly; SameSite=Lax; ${expire}`);
    res.setHeader("Set-Cookie", cookies);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/session/validate", async (req, res) => {
  try {
    const cookieHeader = String(req.headers["cookie"] || "");
    const cookies = parseCookies(cookieHeader);
    const uid = String(cookies.auth_uid || "").trim();
    const key = String(cookies.auth_session || "").trim();
    if (!uid || !key) {
      return res
        .status(401)
        .json({ ok: false, reason: "NO_SESSION", uid: uid || null });
    }
    const sessions = readSessions();
    const current = sessions && sessions[uid];
    if (!current || current.key !== key) {
      return res
        .status(401)
        .json({ ok: false, reason: "OTHER_LOGIN", uid });
    }
    return res.json({ ok: true, uid });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// List files in /uploads for gallery
app.get("/api/uploads", async (req, res) => {
  try {
    const files = await fs.promises.readdir(uploadsDir);
    const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
    const items = [];
    const meta = readUploadsMeta();
    for (const name of files) {
      const ext = path.extname(name).toLowerCase();
      if (!imageExts.has(ext)) continue;
      const full = path.join(uploadsDir, name);
      try {
        const stat = await fs.promises.stat(full);
        items.push({
          name,
          url: `/uploads/${name}`,
          size: stat.size,
          mtime:
            stat.mtime?.toISOString?.() || new Date(stat.mtime).toISOString(),
          mediaId: meta?.[name]?.mediaId || undefined,
          aspect: meta?.[name]?.aspect || undefined,
        });
      } catch (_) {
        // skip unreadable entries
      }
    }
    // Sort by modified time desc
    items.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    res.json({ ok: true, items });
  } catch (err) {
    console.error("List uploads error", err);
    res
      .status(500)
      .json({ error: "Failed to list uploads", detail: String(err) });
  }
});

// Delete a file from /uploads by name
app.delete("/api/uploads/:name", async (req, res) => {
  try {
    const rawName = req.params.name || "";
    const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const targetPath = path.join(uploadsDir, safeName);
    // Ensure targetPath is under uploadsDir
    const uploadsDirResolved = path.resolve(uploadsDir);
    const targetResolved = path.resolve(targetPath);
    if (!targetResolved.startsWith(uploadsDirResolved)) {
      return res.status(400).json({ error: "Invalid file path" });
    }
    // Check existence
    if (!fs.existsSync(targetResolved)) {
      return res.status(404).json({ error: "File not found" });
    }
    await fs.promises.unlink(targetResolved);
    // Remove metadata if present
    try {
      const meta = readUploadsMeta();
      if (meta && Object.prototype.hasOwnProperty.call(meta, safeName)) {
        const { [safeName]: _omit, ...rest } = meta;
        writeUploadsMeta(rest);
      }
    } catch (_) {}
    res.json({ ok: true, name: safeName });
  } catch (err) {
    console.error("Delete upload error", err);
    res
      .status(500)
      .json({ error: "Failed to delete file", detail: String(err) });
  }
});

// Persist mediaId for a given upload file name
app.post("/api/uploads/:name/media-id", async (req, res) => {
  try {
    const rawName = req.params.name || "";
    const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const targetPath = path.join(uploadsDir, safeName);
    const uploadsDirResolved = path.resolve(uploadsDir);
    const targetResolved = path.resolve(targetPath);
    if (!targetResolved.startsWith(uploadsDirResolved)) {
      return res.status(400).json({ error: "Invalid file path" });
    }
    if (!fs.existsSync(targetResolved)) {
      return res.status(404).json({ error: "File not found" });
    }
    const { mediaId, aspect, uploadInfo } = req.body || {};
    if (!mediaId || typeof mediaId !== "string") {
      return res.status(400).json({ error: "Missing mediaId" });
    }
    const meta = readUploadsMeta();
    meta[safeName] = {
      ...(meta?.[safeName] || {}),
      mediaId,
      aspect: typeof aspect === "string" ? aspect : meta?.[safeName]?.aspect,
      uploadInfo:
        uploadInfo && typeof uploadInfo === "object"
          ? uploadInfo
          : meta?.[safeName]?.uploadInfo,
      updatedAt: new Date().toISOString(),
    };
    writeUploadsMeta(meta);
    try {
      const cookies = parseCookies(req.headers["cookie"] || "");
      const user = {
        id: cookies.uid || "",
        email: cookies.email || "",
        name: cookies.name || "",
        plan: cookies.plan || "",
      };
      bumpUsage(user, "image");
    } catch (_) {}
    res.json({ ok: true, name: safeName, mediaId });
  } catch (err) {
    console.error("Persist mediaId error", err);
    res
      .status(500)
      .json({ error: "Failed to persist mediaId", detail: String(err) });
  }
});

const persistEnvValue = (key, value) => {
  const sanitized =
    typeof value === "string" ? value.replace(/\r?\n/g, "").trim() : "";
  let lines = [];
  if (fs.existsSync(envLocalPath)) {
    try {
      const raw = fs.readFileSync(envLocalPath, "utf8");
      lines = raw.split(/\r?\n/);
    } catch (err) {
      console.warn("[settings] Failed to read existing env file:", err);
      lines = [];
    }
  }
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
  let replaced = false;
  const nextLines = [];
  for (const line of lines) {
    if (keyPattern.test(line)) {
      if (!replaced) {
        nextLines.push(`${key}=${sanitized}`);
        replaced = true;
      }
      continue;
    }
    if (line !== undefined) {
      nextLines.push(line);
    }
  }
  if (!replaced) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${sanitized}`);
  }
  const finalContent = nextLines.join("\n");
  fs.writeFileSync(
    envLocalPath,
    finalContent.endsWith("\n") ? finalContent : `${finalContent}\n`,
    "utf8"
  );
  return sanitized;
};

// === Activation state storage (single-use enforcement) ===
const activationStatePath = path.resolve(
  process.cwd(),
  "license",
  "activation-state.json"
);
const readActivationState = () => {
  try {
    const s = fs.readFileSync(activationStatePath, "utf8");
    return JSON.parse(s);
  } catch {
    return { licenses: {} };
  }
};
const writeActivationState = (state) => {
  try {
    fs.mkdirSync(path.dirname(activationStatePath), { recursive: true });
    fs.writeFileSync(
      activationStatePath,
      JSON.stringify(state, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn("[license] Failed to persist activation-state:", e);
  }
};

// Basic health check
app.get("/health", (_, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Redirect root to activation page if not activated, else to prompt-tunggal
// Allow Next.js to serve landing page at '/'
app.get("/aktivasi", (req, res) => {
  res.redirect("/prompt-tunggal");
});

// === App Credential Gate (server-side) ===
const requireAppCredentialConfigured = (req, res, next) => {
  // Deprecated gate: keep for compatibility but allow pass-through
  next();
};

const verifyAppCredential = (req, res, next) => {
  next();
};

// Terapkan gate ke endpoint sensitif
app.use(["/api/labsflow/execute", "/api/generate"], verifyAppCredential);

// Gabungkan beberapa video (concat) menjadi satu file MP4 di /uploads
app.post("/api/video/concat", async (req, res) => {
  try {
    const { sources } = req.body || {};
    const list = Array.isArray(sources)
      ? sources.filter((s) => typeof s === "string" && s.trim().length)
      : [];
    if (list.length < 2) {
      return res.status(400).json({ error: "Minimal pilih dua sumber video." });
    }
    // Unduh setiap sumber ke file temp lokal
    const tmpDir = path.join(uploadsDir, "tmp");
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
    } catch (_) {}
    const tmpFiles = [];
    for (let i = 0; i < list.length; i++) {
      const url = list[i];
      const name = `concat_${Date.now()}_${i}.mp4`;
      const dest = path.join(tmpDir, name);
      const r = await fetch(url);
      if (!r.ok) {
        return res
          .status(400)
          .json({ error: `Gagal unduh sumber: ${url} (HTTP ${r.status})` });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      await fs.promises.writeFile(dest, buf);
      tmpFiles.push(dest);
    }
    // Buat file daftar untuk concat demuxer
    const listPath = path.join(tmpDir, `list_${Date.now()}.txt`);
    const listContent = tmpFiles
      .map((p) => `file '${p.replace(/'/g, "'''")}'`)
      .join("\n");
    await fs.promises.writeFile(listPath, listContent, "utf8");

    const outName = `merged_${Date.now()}.mp4`;
    const outPath = path.join(uploadsDir, outName);

    // Jalankan ffmpeg: -f concat -safe 0 -i list.txt -c copy
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy"])
        .on("error", (err) => reject(err))
        .on("end", () => resolve())
        .save(outPath);
    });

    // Bersihkan temp
    try {
      await fs.promises.unlink(listPath);
      for (const f of tmpFiles) {
        try {
          await fs.promises.unlink(f);
        } catch (_) {}
      }
    } catch (_) {}

    const url = `/uploads/${outName}`;
    res.json({ ok: true, url, path: url });
  } catch (err) {
    console.error("Concat error", err);
    res
      .status(500)
      .json({ error: "Gagal menggabungkan video", detail: String(err) });
  }
});

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
let srSupabase = null;
try {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    srSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
} catch (_) {}

// ==== Realtime plan helpers (shared across routes) ====
const planSubscribers = new Map(); // userId -> Set(res)

const pushPlanEvent = (userId, event, data = {}) => {
  const set = planSubscribers.get(userId);
  if (!set || !set.size) return;
  const payload = { userId, event, ...data };
  const line = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(line);
    } catch (_) {}
  }
};

const fetchPlanForUser = async (uid) => {
  const result = { plan: "free", expiry: null };
  if (!srSupabase || !uid) return result;
  try {
    const { data, error } = await srSupabase
      .from("users")
      .select("plan")
      .eq("id", uid)
      .single();
    if (!error && data) {
      result.plan = String(data.plan || "free").toLowerCase();
    }
  } catch (_) {}
  try {
    const { data: adminUser } = await srSupabase.auth.admin.getUserById(uid);
    const meta = adminUser?.user?.user_metadata || {};
    const pe = meta?.planExpiry;
    if (typeof pe === "number" && Number.isFinite(pe)) {
      result.expiry = pe;
    } else if (typeof pe === "string" && pe.trim()) {
      const n = Number(pe);
      if (Number.isFinite(n)) result.expiry = n;
    }
  } catch (_) {}
  return result;
};

const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const ADMIN_EMAIL_WHITELIST = String(process.env.ADMIN_EMAIL_WHITELIST || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const requireAdmin = async (req, res, next) => {
  try {
    const secretHeader = (req.headers["x-admin-secret"] || "").toString();
    if (!ADMIN_SECRET || secretHeader !== ADMIN_SECRET)
      return res.status(401).json({ error: "Unauthorized" });
    const authHeader = (req.headers["authorization"] || "").toString();
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!srSupabase || !token)
      return res.status(401).json({ error: "Unauthorized" });
    const { data: userData, error } = await srSupabase.auth.getUser(token);
    if (error)
      return res.status(401).json({ error: String(error.message || error) });
    const uid = String(userData?.user?.id || "").trim();
    const email = String(userData?.user?.email || "").toLowerCase();
    // Check whitelist or admin plan in public.users
    let isAllowed = ADMIN_EMAIL_WHITELIST.includes(email);
    if (!isAllowed && uid) {
      try {
        const { data: profile } = await srSupabase
          .from("users")
          .select("plan")
          .eq("id", uid)
          .single();
        isAllowed = String(profile?.plan || "").toLowerCase() === "admin";
      } catch (_) {}
    }
    if (!isAllowed) return res.status(403).json({ error: "Forbidden" });
    next();
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
const ALLOWED_PLANS = new Set([
  "free",
  "veo_lifetime",
  "veo_sora_unlimited",
  "monthly",
  "admin",
]);

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    if (!srSupabase)
      return res.status(500).json({ error: "Supabase not configured" });
    const { data, error } = await srSupabase
      .from("users")
      .select("id,email,full_name,plan,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (error)
      return res.status(500).json({ error: String(error.message || error) });

    const stats = readUsageStats();

    const users = await Promise.all(
      (data || []).map(async (u) => {
        const s = stats?.[String(u.id || "")] || {};
        let planExpiry = null;
        try {
          const { data: adminUser } = await srSupabase.auth.admin.getUserById(
            String(u.id || "")
          );
          const meta = adminUser?.user?.user_metadata || {};
          const pe = meta?.planExpiry;
          if (typeof pe === "number" && Number.isFinite(pe)) {
            planExpiry = pe;
          } else if (typeof pe === "string" && pe.trim()) {
            const n = Number(pe);
            if (Number.isFinite(n)) planExpiry = n;
          }
        } catch (_) {}
        return {
          ...u,
          plan_expiry: planExpiry,
          veo_count: (s.counts && s.counts.veo) || 0,
          sora2_count: (s.counts && s.counts.sora2) || 0,
          image_count: (s.counts && s.counts.image) || 0,
        };
      })
    );

    return res.json({ ok: true, users });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/admin/users/:id/plan", requireAdmin, async (req, res) => {
  try {
    if (!srSupabase)
      return res.status(500).json({ error: "Supabase not configured" });
    const id = String(req.params.id || "").trim();
    const plan = String(req.body?.plan || "").toLowerCase();
    if (!id) return res.status(400).json({ error: "Missing id" });
    if (!ALLOWED_PLANS.has(plan))
      return res.status(400).json({ error: "Invalid plan" });
    const { data, error } = await srSupabase
      .from("users")
      .update({ plan })
      .eq("id", id)
      .select("id,email,full_name,plan")
      .single();
    if (error)
      return res.status(500).json({ error: String(error.message || error) });
    try {
      const meta = { plan };
      if (plan === "monthly") {
        const ms = Date.now() + 30 * 24 * 60 * 60 * 1000;
        meta.planExpiry = ms;
      } else {
        meta.planExpiry = null;
      }
      await srSupabase.auth.admin.updateUserById(id, { user_metadata: meta });
    } catch (_) {}
    // Push realtime plan update ke user terkait (jika ada subscriber)
    try {
      const { plan: curPlan, expiry } = await fetchPlanForUser(id);
      pushPlanEvent(id, "plan_update", { plan: curPlan, expiry });
    } catch (_) {}
    res.json({ ok: true, user: data });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    if (!srSupabase)
      return res.status(500).json({ error: "Supabase not configured" });
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing id" });

    // Hapus dari tabel users
    try {
      await srSupabase.from("users").delete().eq("id", id);
    } catch (_) {}

    // Hapus akun auth Supabase (jika ada)
    try {
      await srSupabase.auth.admin.deleteUser(id);
    } catch (_) {}

    // Bersihkan statistik penggunaan lokal
    try {
      const stats = readUsageStats();
      if (stats && Object.prototype.hasOwnProperty.call(stats, id)) {
        const { [id]: _omit, ...rest } = stats;
        writeUsageStats(rest);
      }
    } catch (_) {}

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/me/plan", async (req, res) => {
  try {
    if (!srSupabase)
      return res.status(500).json({ error: "Supabase not configured" });
    const auth = String(req.headers["authorization"] || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing token" });
    const { data: userData, error: ue } = await srSupabase.auth.getUser(token);
    if (ue) return res.status(401).json({ error: String(ue.message || ue) });
    const uid = String(userData?.user?.id || "");
    if (!uid) return res.status(401).json({ error: "Invalid user" });
    const { plan, expiry } = await fetchPlanForUser(uid);
    res.json({ ok: true, plan, expiry });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// SSE: realtime plan perubahan untuk user yang sedang login
app.get("/api/me/plan/stream", async (req, res) => {
  try {
    if (!srSupabase)
      return res.status(500).json({ error: "Supabase not configured" });
    const token = String(req.query.token || "");
    if (!token) return res.status(401).json({ error: "Missing token" });
    const { data: userData, error: ue } = await srSupabase.auth.getUser(token);
    if (ue) return res.status(401).json({ error: String(ue.message || ue) });
    const uid = String(userData?.user?.id || "");
    if (!uid) return res.status(401).json({ error: "Invalid user" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");

    let set = planSubscribers.get(uid);
    if (!set) {
      set = new Set();
      planSubscribers.set(uid, set);
    }
    set.add(res);

    req.on("close", () => {
      try {
        const s = planSubscribers.get(uid);
        if (s) s.delete(res);
      } catch (_) {}
    });

    const { plan, expiry } = await fetchPlanForUser(uid);
    pushPlanEvent(uid, "plan_snapshot", { plan, expiry });
  } catch (_) {
    try {
      res.end();
    } catch (_) {}
  }
});

// Simple proxy to Google Labs/Google APIs using Bearer from env
app.post("/api/labsflow/execute", async (req, res) => {
  try {
    const { url, method = "POST", payload, headers = {} } = req.body || {};

    if (!url || typeof url !== "string") {
      return res
        .status(400)
        .json({ error: 'Missing required "url" (string).' });
    }

    // Restrict proxy to Google domains for safety
    const allowed =
      /^https:\/\/([a-zA-Z0-9-]+\.)*(googleapis\.com|google\.com)\//.test(url);
    if (!allowed) {
      return res
        .status(400)
        .json({ error: "URL not allowed. Only googleapis.com/google.com." });
    }

    const bearer = process.env.LABS_BEARER;
    if (!bearer) {
      return res
        .status(500)
        .json({ error: "LABS_BEARER is not set on server." });
    }

    // Decide remote Content-Type: Labs UI sends JSON as text/plain for video endpoints
    const lowerUrl = url.toLowerCase();
    const isGenText = lowerUrl.includes("/video:batchasyncgeneratevideotext");
    const isGenStartImage = lowerUrl.includes(
      "/video:batchasyncgeneratevideostartimage"
    );
    const isGenStartEndImage = lowerUrl.includes(
      "/video:batchasyncgeneratevideostartandendimage"
    );
    const isGenRefImages = lowerUrl.includes(
      "/video:batchasyncgeneratevideoreferenceimages"
    );
    const isGenExtend = lowerUrl.includes(
      "/video:batchasyncgeneratevideoextendvideo"
    );
    const isCheck = lowerUrl.includes(
      "/video:batchcheckasyncvideogenerationstatus"
    );
    const isReshoot = lowerUrl.includes(
      "/video:batchasyncgeneratevideoreshootvideo"
    );
    const isSoundDemo = lowerUrl.includes("/v1:sounddemo");
    const isFlowMediaImages = lowerUrl.includes(
      "/flowmedia:batchgenerateimages"
    );

    const normalizedPayload = payload;

    const defaultContentType =
      isGenText ||
      isGenStartImage ||
      isGenStartEndImage ||
      isGenRefImages ||
      isGenExtend ||
      isCheck ||
      isReshoot ||
      isSoundDemo ||
      isFlowMediaImages
        ? "text/plain; charset=UTF-8"
        : "application/json";

    const mergedHeaders = {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
      "Content-Type": defaultContentType,
      ...headers,
    };

    if (isSoundDemo) {
      if (!mergedHeaders["Origin"])
        mergedHeaders["Origin"] = "https://labs.google";
      if (!mergedHeaders["Referer"])
        mergedHeaders["Referer"] = "https://labs.google/";
      if (!headers["Accept"]) mergedHeaders["Accept"] = "*/*";
      if (!mergedHeaders["Accept-Language"])
        mergedHeaders["Accept-Language"] = "en-US,en;q=0.9";
    }

    // Basic diagnostics to help troubleshoot INVALID_ARGUMENT
    try {
      console.log(
        "[labsflow/execute] URL:",
        url,
        "method:",
        method,
        "ct:",
        mergedHeaders["Content-Type"]
      );
      if (payload && Array.isArray(payload.requests)) {
        const first = payload.requests[0] || {};
        console.log("[labsflow/execute] first request sample:", {
          aspectRatio: first.aspectRatio,
          videoModelKey: first.videoModelKey,
          hasPrimaryMediaId: !!first.primaryMediaId,
        });
      }
    } catch (_) {}

    const response = await fetch(url, {
      method,
      headers: mergedHeaders,
      body:
        method.toUpperCase() === "GET"
          ? undefined
          : JSON.stringify(payload ?? {}),
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const data = isJson ? await response.json() : await response.text();

    // Forward rate limit-related headers when present (e.g., Retry-After)
    try {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        res.set("Retry-After", retryAfter);
      }
    } catch (_) {}

    try {
      console.log("[labsflow/execute] status:", response.status);
    } catch (_) {}
    res.status(response.status).send(data);
  } catch (err) {
    console.error("Proxy error", err);
    res.status(500).json({ error: "Proxy failed", detail: String(err) });
  }
});

// Upload gambar (base64 data URL) -> simpan file ke /uploads dan balas URL
app.post("/api/upload_base64", async (req, res) => {
  try {
    const { fileName, mime, dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== "string") {
      return res.status(400).json({ error: "Missing dataUrl" });
    }
    const match = dataUrl.match(/^data:(.*?);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "Invalid dataUrl format" });
    }
    const contentType = mime || match[1] || "image/png";
    const base64 = match[2];
    const buf = Buffer.from(base64, "base64");
    const ext =
      contentType.includes("jpeg") || contentType.includes("jpg")
        ? "jpg"
        : contentType.includes("png")
        ? "png"
        : "bin";
    const safeName = (fileName || `upload-${Date.now()}`).replace(
      /[^a-zA-Z0-9_.-]/g,
      "_"
    );
    const destName = `${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}-${safeName}.${ext}`;
    const destPath = path.join(uploadsDir, destName);
    fs.writeFileSync(destPath, buf);
    const url = `/uploads/${destName}`;
    res.json({ url, contentType });
  } catch (err) {
    console.error("Upload error", err);
    res.status(500).json({ error: "Upload failed", detail: String(err) });
  }
});

// Upload gambar ke Google Labs dan coba finalisasi menjadi Media (mengambil mediaId)
app.post("/api/labs/upload_image", async (req, res) => {
  try {
    const { fileName, mime, dataUrl, imageAspectRatio } = req.body || {};
    if (!dataUrl || typeof dataUrl !== "string") {
      return res.status(400).json({ error: "Missing dataUrl" });
    }
    const m = dataUrl.match(/^data:(.*?);base64,(.+)$/);
    if (!m) {
      return res.status(400).json({ error: "Invalid dataUrl format" });
    }
    const contentType = mime || m[1] || "image/png";
    const base64 = m[2];
    const bearer = process.env.LABS_BEARER;
    if (!bearer) {
      return res
        .status(500)
        .json({ error: "LABS_BEARER is not set on server." });
    }

    // 1) Upload ke Labs sebagai text/plain (meniru panggilan Labs UI)
    const uploadUrl =
      process.env.LABS_IMAGE_UPLOAD_URL ||
      "https://aisandbox-pa.googleapis.com/v1:uploadUserImage";
    // Untuk upload biner, banyak Google APIs memakai prefix /upload dan query uploadType=media
    const uploadMediaUrl =
      process.env.LABS_IMAGE_UPLOAD_MEDIA_URL ||
      (() => {
        const base = uploadUrl.includes("/upload/")
          ? uploadUrl
          : uploadUrl.replace(
              "https://aisandbox-pa.googleapis.com/",
              "https://aisandbox-pa.googleapis.com/upload/"
            );
        const hasQuery = base.includes("?");
        return base + (hasQuery ? "&" : "?") + "uploadType=media";
      })();

    const tryPlain = async (bodyText) => {
      return fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "text/plain; charset=UTF-8",
          Accept: "application/json",
        },
        body: bodyText,
      });
    };

    const tryBinary = async (buf, mimeType) => {
      // Gunakan endpoint /upload dengan uploadType=media untuk raw bytes
      return fetch(uploadMediaUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/octet-stream",
          "X-Goog-Upload-Content-Type": mimeType || "application/octet-stream",
          "X-Goog-Upload-Protocol": "raw",
          ...(fileName ? { "X-Goog-Upload-File-Name": fileName } : {}),
          Accept: "application/json",
        },
        body: buf,
      });
    };

    const tryJson = async (payload) => {
      return fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
    };

    // UI Labs mengirim JSON sebagai text/plain; kita tiru pola itu
    const tryPlainJson = async (payload) => {
      return fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "text/plain; charset=UTF-8",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
    };

    // Prioritas pertama: kirim payload persis seperti DevTools UI
    let uploadResp;
    let lastResp; // simpan respons terakhir untuk detail error
    const attempts = []; // kumpulkan detail setiap percobaan untuk diagnosa
    const selectedImageAspect =
      imageAspectRatio ||
      process.env.LABS_DEFAULT_IMAGE_ASPECT ||
      "IMAGE_ASPECT_RATIO_LANDSCAPE";
    const envClientContext = (() => {
      try {
        return JSON.parse(process.env.LABS_DEFAULT_CLIENT_CONTEXT || "null");
      } catch (_) {
        return undefined;
      }
    })();
    const uiPayload = {
      imageInput: {
        rawImageBytes: base64,
        mimeType: contentType,
        isUserUploaded: true,
        aspectRatio: selectedImageAspect,
      },
      ...(envClientContext ? { clientContext: envClientContext } : {}),
    };
    {
      const resp = await tryPlainJson(uiPayload);
      try {
        console.log(
          "[labs/upload_image] try text/plain JSON uiPayload",
          "status:",
          resp.status
        );
      } catch (_) {}
      if (resp.ok) {
        uploadResp = resp;
      } else {
        try {
          const ct = resp.headers?.get("content-type") || "";
          const detail = ct.includes("application/json")
            ? await resp.json()
            : await resp.text();
          attempts.push({
            type: "text_plain_json",
            keys: Object.keys(uiPayload.imageInput || {}),
            status: resp.status,
            detail,
          });
        } catch (e) {
          attempts.push({
            type: "text_plain_json",
            keys: Object.keys(uiPayload.imageInput || {}),
            status: resp.status,
            detail: String(e),
          });
        }
        lastResp = resp;
      }
    }
    // Jika masih gagal, coba kandidat JSON lain
    const jsonCandidates = [
      // Kandidat sebelumnya (tetap agar dapat melihat pesan unknown yang membantu)
      { imageBytes: base64, mimeType: contentType, fileName },
      { base64Data: base64, mimeType: contentType, fileName },
      { data: base64, mimeType: contentType, fileName },
      { bytes: base64, mimeType: contentType, fileName },
      { content: base64, mimeType: contentType, fileName },
      { imageBase64: base64, mimeType: contentType, fileName },
      { userImage: { mimeType: contentType, imageBytes: base64, fileName } },
      { media: { mimeType: contentType, data: base64, fileName } },
      { image: base64, mimeType: contentType, fileName },
      // Kandidat yang menyebut 'userUploadedImage' secara top-level
      {
        userUploadedImage: {
          mimeType: contentType,
          imageData: base64,
          fileName,
        },
      },
      {
        userUploadedImage: {
          mimeType: contentType,
          imageBase64: base64,
          fileName,
        },
      },
      {
        userUploadedImage: {
          mimeType: contentType,
          dataUrl: dataUrl,
          fileName,
        },
      },
      // Kandidat baru yang mengikuti pola Google Vision/Proto JSON: image.content berisi base64
      { image: { content: base64 } },
      { image: { content: base64, mimeType: contentType }, fileName },
      { image: { data: base64, mimeType: contentType }, fileName },
      { image: { dataUrl: dataUrl, mimeType: contentType }, fileName },
      // Top-level dataUrl sederhana
      { dataUrl: dataUrl },
      { dataUrl: dataUrl, fileName },
      { dataUrl: dataUrl, mimeType: contentType, fileName },
    ];
    for (const jc of jsonCandidates) {
      const resp = await tryJson(jc);
      try {
        console.log(
          "[labs/upload_image] try json candidate keys:",
          Object.keys(jc),
          "status:",
          resp.status
        );
      } catch (_) {}
      if (resp.ok) {
        uploadResp = resp;
        break;
      }
      // Baca detail error untuk diagnosa
      try {
        const ct = resp.headers?.get("content-type") || "";
        const detail = ct.includes("application/json")
          ? await resp.json()
          : await resp.text();
        attempts.push({
          type: "json",
          keys: Object.keys(jc),
          status: resp.status,
          detail,
        });
      } catch (e) {
        attempts.push({
          type: "json",
          keys: Object.keys(jc),
          status: resp.status,
          detail: String(e),
        });
      }
      lastResp = resp;
    }
    if (!uploadResp) {
      // Fallback: kirim bytes biner + X-Goog headers (meski service /upload bisa 404)
      const buf = Buffer.from(base64, "base64");
      const respBin = await tryBinary(buf, contentType);
      try {
        console.log(
          "[labs/upload_image] try binary bytes",
          contentType,
          "url:",
          uploadMediaUrl,
          "status:",
          respBin.status
        );
      } catch (_) {}
      if (respBin.ok) uploadResp = respBin;
      else {
        try {
          const ct = respBin.headers?.get("content-type") || "";
          const detail = ct.includes("application/json")
            ? await respBin.json()
            : await respBin.text();
          attempts.push({
            type: "binary",
            status: respBin.status,
            url: uploadMediaUrl,
            detail,
          });
        } catch (e) {
          attempts.push({
            type: "binary",
            status: respBin.status,
            url: uploadMediaUrl,
            detail: String(e),
          });
        }
        lastResp = respBin;
      }
    }
    if (!uploadResp) {
      // Fallback: text/plain base64
      const respPlain = await tryPlain(base64);
      try {
        console.log(
          "[labs/upload_image] try text/plain base64, status:",
          respPlain.status
        );
      } catch (_) {}
      if (respPlain.ok) uploadResp = respPlain;
      else {
        try {
          const ct = respPlain.headers?.get("content-type") || "";
          const detail = ct.includes("application/json")
            ? await respPlain.json()
            : await respPlain.text();
          attempts.push({
            type: "text_base64",
            status: respPlain.status,
            detail,
          });
        } catch (e) {
          attempts.push({
            type: "text_base64",
            status: respPlain.status,
            detail: String(e),
          });
        }
        lastResp = respPlain;
      }
    }
    if (!uploadResp) {
      // Fallback: text/plain full dataUrl
      const respDataUrl = await tryPlain(dataUrl);
      try {
        console.log(
          "[labs/upload_image] try text/plain dataUrl, status:",
          respDataUrl.status
        );
      } catch (_) {}
      if (respDataUrl.ok) uploadResp = respDataUrl;
      else {
        try {
          const ct = respDataUrl.headers?.get("content-type") || "";
          const detail = ct.includes("application/json")
            ? await respDataUrl.json()
            : await respDataUrl.text();
          attempts.push({
            type: "text_dataurl",
            status: respDataUrl.status,
            detail,
          });
        } catch (e) {
          attempts.push({
            type: "text_dataurl",
            status: respDataUrl.status,
            detail: String(e),
          });
        }
        lastResp = respDataUrl;
      }
    }

    // Jika semua percobaan gagal, jangan akses uploadResp (undefined)
    if (!uploadResp) {
      // Jangan baca ulang body lastResp agar tidak memicu "Body already read"
      const lastAttemptDetail = attempts.length
        ? attempts[attempts.length - 1].detail
        : undefined;
      return res.status(lastResp?.status || 400).json({
        error: "uploadUserImage failed",
        detail: lastAttemptDetail,
        attempts,
      });
    }

    const uploadCT = uploadResp.headers.get("content-type") || "";
    const uploadData = uploadCT.includes("application/json")
      ? await uploadResp.json()
      : await uploadResp.text();
    if (!uploadResp.ok) {
      return res
        .status(uploadResp.status)
        .json({ error: "uploadUserImage failed", detail: uploadData });
    }

    // Normalisasi respons upload dan coba ekstrak token/handle
    const uploadText = typeof uploadData === "string" ? uploadData : "";
    const uploadJson =
      typeof uploadData === "string"
        ? (() => {
            try {
              return JSON.parse(uploadData);
            } catch {
              return {};
            }
          })()
        : uploadData;
    const uploadToken =
      uploadJson?.uploadToken ||
      uploadJson?.token ||
      (uploadText ? uploadText.trim() : undefined);
    const candidateMediaId =
      uploadJson?.image?.metadata?.name ||
      uploadJson?.metadata?.name ||
      uploadJson?.name;
    // Deteksi mediaGenerationId dari respons upload
    const mediaGenId = (() => {
      try {
        if (typeof uploadJson?.mediaGenerationId === "string")
          return uploadJson.mediaGenerationId;
        if (typeof uploadJson?.mediaGenerationId === "object")
          return uploadJson.mediaGenerationId?.mediaGenerationId;
        return undefined;
      } catch (_) {
        return undefined;
      }
    })();

    // 2) Opsional: coba finalisasi menjadi Media jika mediaId belum didapat
    let mediaId = candidateMediaId || mediaGenId;
    let finalizeData;
    try {
      const finalizeUrl =
        process.env.LABS_IMAGE_FINALIZE_URL ||
        "https://aisandbox-pa.googleapis.com/v1/userMedia:create";
      // Sederhanakan ke varian yang paling masuk akal
      const payloads = [];
      if (uploadToken) {
        payloads.push({
          simpleMediaItem: {
            uploadToken,
            fileName: fileName || `upload-${Date.now()}`,
          },
        });
      }
      if (mediaGenId) {
        payloads.push({
          userUploadedImage: {
            mediaGenerationId: mediaGenId,
            mimeType: contentType,
            fileName: fileName || `upload-${Date.now()}`,
          },
        });
      }
      for (const fp of payloads) {
        const finResp = await fetch(finalizeUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fp),
        });
        const finCT = finResp.headers.get("content-type") || "";
        finalizeData = finCT.includes("application/json")
          ? await finResp.json()
          : await finResp.text();
        if (finResp.ok) {
          const finJson =
            typeof finalizeData === "string"
              ? (() => {
                  try {
                    return JSON.parse(finalizeData);
                  } catch {
                    return {};
                  }
                })()
              : finalizeData;
          mediaId =
            finJson?.image?.metadata?.name ||
            finJson?.metadata?.name ||
            mediaId;
          if (mediaId) break;
        }
      }
    } catch (_) {
      // Biarkan tanpa mediaId jika finalisasi gagal; respons upload tetap dikembalikan
    }

    return res.json({
      ok: true,
      mediaId: mediaId || undefined,
      upload: uploadJson,
      finalize: finalizeData || undefined,
    });
  } catch (err) {
    console.error("Labs upload_image error", err);
    res
      .status(500)
      .json({ error: "Labs upload_image failed", detail: String(err) });
  }
});

// Download a resource via Bearer auth and stream it back to the client
app.get("/api/labsflow/download", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || typeof url !== "string") {
      return res
        .status(400)
        .json({ error: "Missing required query parameter 'url'" });
    }

    // Allow only Google-related domains for safety
    const allowed =
      /^https:\/\/(?:[a-zA-Z0-9-]+\.)*(googleapis\.com|google\.com|gstatic\.com|googleusercontent\.com|storage\.googleapis\.com)\//.test(
        url
      );
    if (!allowed) {
      return res
        .status(400)
        .json({ error: "URL not allowed for download proxy." });
    }

    const bearer = process.env.LABS_BEARER;
    if (!bearer) {
      return res
        .status(500)
        .json({ error: "LABS_BEARER is not set on server." });
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "*/*",
      },
    });

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    res.status(response.status);
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);

    if (!response.ok) {
      const text = await response.text();
      return res.send(text);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return res.send(buffer);
  } catch (err) {
    console.error("Download proxy error", err);
    res
      .status(500)
      .json({ error: "Download proxy failed", detail: String(err) });
  }
});

// Proxy to GeminiGen Sora 2 API with SORA_BEARER
app.post("/api/sora/execute", async (req, res) => {
  try {
    const cookies = parseCookies(req.headers["cookie"] || "");
    const userForStats = {
      id: cookies.uid || "",
      email: cookies.email || "",
      name: cookies.name || "",
      plan: cookies.plan || "",
    };
    const {
      prompt,
      model = "sora-2",
      aspect_ratio = "landscape",
      resolution = "small",
      duration = 10,
      provider = "openai",
    } = req.body || {};
    const bearer = (process.env.SORA_BEARER || "").trim();
    if (!bearer) {
      return res
        .status(500)
        .json({ error: "SORA_BEARER is not set on server." });
    }
    let body;
    let headers = {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
    };
    try {
      const form = new FormData();
      form.append("prompt", String(prompt || ""));
      form.append("model", String(model || "sora-2"));
      form.append(
        "aspect_ratio",
        aspect_ratio === "portrait" ? "portrait" : "landscape"
      );
      form.append("resolution", String(resolution || "small"));
      form.append("duration", String(Number(duration || 10)));
      form.append("provider", String(provider || "openai"));
      if (
        typeof req.body?.image_url === "string" &&
        req.body.image_url.trim().length
      ) {
        const url = req.body.image_url.trim();
        form.append("image_url", url);
        form.append("reference_url", url);
        form.append("reference_image_url", url);
        form.append("start_image_url", url);
        try {
          const arr = JSON.stringify([{ media_type: "image", url }]);
          form.append("reference_items", arr);
        } catch (_) {}
        try {
          form.append("reference_items[]", url);
          form.append("reference_item", url);
          form.append("reference_item_url", url);
          form.append("reference_items[0][media_type]", "image");
          form.append("reference_items[0][url]", url);
        } catch (_) {}
        try {
          const resp = await fetch(url, { method: "GET" });
          if (resp.ok) {
            const ctImg = resp.headers.get("content-type") || "image/jpeg";
            const bufImg = Buffer.from(await resp.arrayBuffer());
            const blobImg = new Blob([bufImg], { type: ctImg });
            const pathname = (() => {
              try {
                return new URL(url).pathname;
              } catch {
                return "";
              }
            })();
            const fname =
              pathname.split("/").filter(Boolean).pop() || "reference.jpg";
            form.append("files", blobImg, fname);
            form.append("image", blobImg, fname);
            form.append("reference_image", blobImg, fname);
            form.append("start_image", blobImg, fname);
            form.append("reference_items", blobImg, fname);
            try {
              form.append("reference_items[]", blobImg, fname);
            } catch (_) {}
          }
        } catch (_) {}
      }
      if (
        typeof req.body?.image_data === "string" &&
        req.body.image_data.trim().length
      ) {
        const buf = Buffer.from(req.body.image_data.trim(), "base64");
        const mime =
          typeof req.body?.image_mime === "string" &&
          req.body.image_mime.trim().length
            ? req.body.image_mime.trim()
            : "image/jpeg";
        const name =
          typeof req.body?.image_name === "string" &&
          req.body.image_name.trim().length
            ? req.body.image_name.trim()
            : "reference.jpg";
        const blob = new Blob([buf], { type: mime });
        form.append("files", blob, name);
        form.append("image", blob, name);
        form.append("reference_image", blob, name);
        form.append("start_image", blob, name);
        form.append("file", blob, name);
        try {
          form.append("reference_items", blob, name);
        } catch (_) {}
      }
      body = form;
    } catch (_) {
      const params = new URLSearchParams();
      params.set("prompt", String(prompt || ""));
      params.set("model", String(model || "sora-2"));
      params.set(
        "aspect_ratio",
        aspect_ratio === "portrait" ? "portrait" : "landscape"
      );
      params.set("resolution", String(resolution || "small"));
      params.set("duration", String(Number(duration || 10)));
      params.set("provider", String(provider || "openai"));
      if (
        typeof req.body?.image_url === "string" &&
        req.body.image_url.trim().length
      ) {
        const url = req.body.image_url.trim();
        params.set("image_url", url);
        params.set("reference_url", url);
        params.set("reference_image_url", url);
        params.set("start_image_url", url);
        try {
          params.set(
            "reference_items",
            JSON.stringify([{ media_type: "image", url }])
          );
          params.append("reference_items[]", url);
          params.set("reference_item", url);
          params.set("reference_item_url", url);
          params.set("reference_items[0][media_type]", "image");
          params.set("reference_items[0][url]", url);
        } catch (_) {}
      }
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = params.toString();
    }

    const response = await fetch(
      "https://api.geminigen.ai/api/video-gen/sora",
      {
        method: "POST",
        headers: {
          ...headers,
          Origin: "https://geminigen.ai",
          Referer: "https://geminigen.ai/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        },
        body,
      }
    );
    const ct = response.headers.get("content-type") || "";
    const data = ct.includes("application/json")
      ? await response.json()
      : await response.text();
    try {
      if (response.ok) bumpUsage(userForStats, "sora2");
    } catch (_) {}
    res.status(response.status).send(data);
  } catch (err) {
    console.error("[sora/execute] Proxy error", err);
    res.status(500).json({ error: "Sora proxy failed", detail: String(err) });
  }
});

// Download proxy for Sora result urls, forcing attachment
app.get("/api/sora/download", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl) return res.status(400).json({ error: "Missing 'url' query" });
    const url = rawUrl.replace(/[`"']/g, "");
    const allowed =
      /^https:\/\/(?:[a-zA-Z0-9-]+\.)*(geminigen\.ai|cloudflarestorage\.com|tksou\.com|user-files-downloader\.geminigen\.ai|cdn\.geminigen\.ai)\//.test(
        url
      );
    if (!allowed)
      return res
        .status(400)
        .json({ error: "URL not allowed for Sora download proxy." });

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "*/*",
        Origin: "https://geminigen.ai",
        Referer: "https://geminigen.ai/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
      },
    });
    const ct =
      response.headers.get("content-type") || "application/octet-stream";
    const cl = response.headers.get("content-length");
    // derive filename from path
    const pathname = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return "";
      }
    })();
    let fname =
      pathname.split("/").filter(Boolean).pop() || `sora-${Date.now()}.mp4`;
    if (!/\.\w+$/.test(fname)) fname = `${fname}.mp4`;

    res.status(response.status);
    res.setHeader("Content-Type", ct);
    if (cl) res.setHeader("Content-Length", cl);
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);

    if (!response.ok) {
      const text = await response.text();
      return res.send(text);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    return res.send(buf);
  } catch (err) {
    console.error("[sora/download] error", err);
    res
      .status(500)
      .json({ error: "Download proxy failed", detail: String(err) });
  }
});

app.get("/api/sora/status", async (req, res) => {
  try {
    const bearer = (process.env.SORA_BEARER || "").trim();
    if (!bearer)
      return res
        .status(500)
        .json({ error: "SORA_BEARER is not set on server." });
    const uuid = String(req.query.uuid || "").trim();
    const id = String(req.query.id || "").trim();
    const headers = {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
      Origin: "https://geminigen.ai",
      Referer: "https://geminigen.ai/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    };
    const attempts = [];
    const pushGet = (u) =>
      attempts.push(async () => {
        const resp = await fetch(u, { method: "GET", headers });
        const ct = resp.headers.get("content-type") || "";
        const body = ct.includes("application/json")
          ? await resp.json()
          : await resp.text();
        return { ok: resp.ok, status: resp.status, body };
      });
    const pushPostForm = (u) =>
      attempts.push(async () => {
        try {
          const form = new FormData();
          if (uuid) form.append("uuid", uuid);
          if (id) form.append("id", id);
          const resp = await fetch(u, { method: "POST", headers, body: form });
          const ct = resp.headers.get("content-type") || "";
          const body = ct.includes("application/json")
            ? await resp.json()
            : await resp.text();
          return { ok: resp.ok, status: resp.status, body };
        } catch (_) {
          const params = new URLSearchParams();
          if (uuid) params.set("uuid", uuid);
          if (id) params.set("id", id);
          const resp = await fetch(u, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
          });
          const ct = resp.headers.get("content-type") || "";
          const body = ct.includes("application/json")
            ? await resp.json()
            : await resp.text();
          return { ok: resp.ok, status: resp.status, body };
        }
      });
    if (uuid) {
      pushGet(
        `https://api.geminigen.ai/api/video-gen/detail?uuid=${encodeURIComponent(
          uuid
        )}`
      );
      pushGet(
        `https://api.geminigen.ai/api/video-gen/detail/${encodeURIComponent(
          uuid
        )}`
      );
      pushGet(
        `https://api.geminigen.ai/api/video-gen/status?uuid=${encodeURIComponent(
          uuid
        )}`
      );
      pushGet(
        `https://api.geminigen.ai/api/history/${encodeURIComponent(uuid)}`
      );
      pushPostForm("https://api.geminigen.ai/api/video-gen/status");
      pushPostForm("https://api.geminigen.ai/api/video-gen/detail");
    }
    if (id) {
      pushGet(
        `https://api.geminigen.ai/api/video-gen/detail?id=${encodeURIComponent(
          id
        )}`
      );
      pushGet(
        `https://api.geminigen.ai/api/video-gen/history/${encodeURIComponent(
          id
        )}`
      );
      pushPostForm("https://api.geminigen.ai/api/video-gen/status");
      pushPostForm("https://api.geminigen.ai/api/video-gen/detail");
    }
    if (!attempts.length)
      return res.status(400).json({ error: "missing uuid or id" });
    let last;
    for (const fn of attempts) {
      try {
        const r = await fn();
        last = r;
        if (r.ok) return res.json(r.body);
      } catch (e) {
        last = { ok: false, status: 0, body: String(e) };
      }
    }
    return res
      .status(last?.status || 404)
      .json({ error: "Status not available", detail: last?.body || null });
  } catch (err) {
    console.error("[sora/status] Proxy error", err);
    res.status(500).json({ error: "Sora status failed", detail: String(err) });
  }
});

app.get("/api/settings", (req, res) => {
  res.json({
    labsBearer: process.env.LABS_BEARER || "",
  });
});

app.post("/api/settings", (req, res) => {
  try {
    const { labsBearer } = req.body || {};
    const sanitizedBearer = persistEnvValue(
      "LABS_BEARER",
      typeof labsBearer === "string" ? labsBearer : ""
    );
    process.env.LABS_BEARER = sanitizedBearer;
    res.json({ ok: true, labsBearer: sanitizedBearer });
  } catch (err) {
    console.error(
      "[settings] Failed to persist LABS_BEARER / APP_CREDENTIAL",
      err
    );
    res
      .status(500)
      .json({ error: "Failed to update settings", detail: String(err) });
  }
});

// === Sora 2 specific bearer settings ===
app.get("/api/sora/settings", (req, res) => {
  res.json({
    soraBearer: process.env.SORA_BEARER || "",
  });
});

app.post("/api/sora/settings", (req, res) => {
  try {
    const { soraBearer } = req.body || {};
    const sanitized = persistEnvValue(
      "SORA_BEARER",
      typeof soraBearer === "string" ? soraBearer : ""
    );
    process.env.SORA_BEARER = sanitized;
    res.json({ ok: true, soraBearer: sanitized });
  } catch (err) {
    console.error("[sora/settings] Failed to persist SORA_BEARER", err);
    res
      .status(500)
      .json({ error: "Failed to update Sora settings", detail: String(err) });
  }
});

// === License Activation: verify signed activation token and set APP_CREDENTIAL ===
const readPublicKey = () => {
  let pk = (process.env.LICENSE_PUBLIC_KEY || "").trim();
  const p = (process.env.LICENSE_PUBLIC_KEY_PATH || "").trim();
  if (!pk && p) {
    try {
      pk = fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
    } catch (e) {
      console.warn("[license] Failed to read LICENSE_PUBLIC_KEY_PATH:", e);
    }
  }
  return pk;
};

const b64urlToBuffer = (s) => {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64");
};

const b64urlJson = (s) => {
  try {
    return JSON.parse(Buffer.from(b64urlToBuffer(s)).toString("utf8"));
  } catch {
    return null;
  }
};

app.post("/api/license/activate", (req, res) => {
  return res.status(410).json({ error: "Activation disabled" });
});

// Query current activation state
app.get("/api/license/state", (req, res) => {
  try {
    const state = readActivationState();
    const activated = !!Object.values(state.licenses || {}).some(
      (x) => x && x.activated
    );
    res.json({ activated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Provide default configuration from environment for the client UI
app.get("/api/config", (req, res) => {
  const parseJsonEnv = (name) => {
    const v = process.env[name];
    if (!v) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  };
  const config = {
    defaultGenerateUrl:
      process.env.LABS_DEFAULT_GENERATE_URL ||
      "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText",
    defaultCheckUrl:
      process.env.LABS_DEFAULT_CHECK_URL ||
      "https://aisandbox-pa.googleapis.com/v1/operations:batchCheckAsyncVideoGenerationStatus",
    defaultModelKey: process.env.LABS_DEFAULT_MODEL_KEY || "",
    defaultAspectRatio:
      process.env.LABS_DEFAULT_ASPECT_RATIO || "VIDEO_ASPECT_RATIO_LANDSCAPE",
    defaultImageAspect:
      process.env.LABS_DEFAULT_IMAGE_ASPECT || "IMAGE_ASPECT_RATIO_LANDSCAPE",
    defaultHeaders: parseJsonEnv("LABS_DEFAULT_HEADERS") || {},
    clientContext: parseJsonEnv("LABS_DEFAULT_CLIENT_CONTEXT") || undefined,
  };
  res.json(config);
});

// === Simple per-IP rate limiter for /api/generate ===
const RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || "60000",
  10
);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "20", 10);
const rateBuckets = new Map(); // ip -> { count, resetAt }
const rateLimitGenerate = (req, res, next) => {
  try {
    const fwd = (req.headers["x-forwarded-for"] || "").toString();
    const ip = fwd.split(",")[0]?.trim() || req.ip || "unknown";
    const now = Date.now();
    let bucket = rateBuckets.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      rateBuckets.set(ip, bucket);
    }
    if (bucket.count >= RATE_LIMIT_MAX) {
      const retrySec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", retrySec.toString());
      return res.status(429).json({
        error: "Rate limit exceeded",
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: RATE_LIMIT_MAX,
        resetAt: new Date(bucket.resetAt).toISOString(),
      });
    }
    bucket.count++;
    next();
  } catch (err) {
    // Fail open: if limiter errors, allow the request
    next();
  }
};

const startServer = async () => {
  try {
    await nextApp.prepare();
    // ==== Lightweight Job Queue + SSE for concurrent generates ====
    const jobs = new Map(); // jobId -> { id, status, createdAt, payload, url, method, headers, operations, attempts, error }
    const subscribers = new Map(); // jobId -> Set(res)
    const queue = [];
    let active = 0;
    const CONCURRENCY = parseInt(process.env.JOBS_CONCURRENCY || "4", 10);
    const POLL_DELAY_MS = parseInt(process.env.POLL_DELAY_MS || "3000", 10);

    const pushEvent = (jobId, event, data = {}) => {
      const set = subscribers.get(jobId);
      if (!set || !set.size) return;
      const payload = { jobId, event, ...data };
      const line = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`;
      for (const res of set) {
        try {
          res.write(line);
        } catch (_) {}
      }
    };

    const labsExecute = async ({
      url,
      method = "POST",
      headers = {},
      payload,
    }) => {
      // Reuse the proxy logic to call Google endpoints (avoids duplication)
      const resp = await fetch(
        `http://localhost:${PORT}/api/labsflow/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-app-credential": process.env.APP_CREDENTIAL || "",
          },
          body: JSON.stringify({ url, method, headers, payload }),
        }
      );
      const ct = resp.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      const data = isJson ? await resp.json() : await resp.text();
      // capture Retry-After (in seconds) if provided by upstream
      let retryAfterSec = undefined;
      try {
        const ra = resp.headers.get("retry-after");
        if (ra) {
          const parsed = parseInt(String(ra), 10);
          if (!Number.isNaN(parsed) && parsed >= 0) retryAfterSec = parsed;
        }
      } catch (_) {}
      return { ok: resp.ok, status: resp.status, data, retryAfterSec };
    };

    const pollStatus = async (
      operations,
      headers = {},
      maxAttempts = 10000,
      delayMs = POLL_DELAY_MS
    ) => {
      let url =
        process.env.LABS_DEFAULT_CHECK_URL ||
        "https://aisandbox-pa.googleapis.com/v1/operations:batchCheckAsyncVideoGenerationStatus";
      const method = "POST";
      let attempt = 0;
      // loop
      while (attempt < maxAttempts) {
        attempt++;
        const payload = {
          operations: operations.map((t) => ({ operation: { name: t.name } })),
        };
        let resp = await labsExecute({ url, method, headers, payload });
        if (!resp.ok && resp.status === 404) {
          const alt = url.includes("/video:")
            ? url.replace("/video:", "/operations:")
            : "https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus";
          resp = await labsExecute({ url: alt, method, headers, payload });
          url = alt;
        }
        let opStatuses = [];
        let composite = "UNKNOWN";
        if (resp.ok && resp.data && resp.data.operations) {
          opStatuses = resp.data.operations.map((o) => o?.status || "UNKNOWN");
          composite = opStatuses.join(", ");
        }
        const stillPending = opStatuses.some((s) =>
          /PENDING|IN_PROGRESS|ACTIVE/i.test(s)
        );
        if (!stillPending) {
          return { done: true, resp };
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return { done: false };
    };

    const schedule = () => {
      while (active < CONCURRENCY && queue.length) {
        const jobId = queue.shift();
        const job = jobs.get(jobId);
        if (!job || job.status !== "queued") continue;
        if (job.cancelRequested) {
          job.status = "cancelled";
          pushEvent(jobId, "cancelled", {});
          continue;
        }
        active++;
        (async () => {
          try {
            job.status = "started";
            pushEvent(jobId, "started", {});
            if (job.cancelRequested) {
              job.status = "cancelled";
              pushEvent(jobId, "cancelled", {});
              return;
            }
            // Helper for 429 backoff and retry
            const RETRY_MAX_429 = parseInt(
              process.env.RETRY_MAX_429 || "0",
              10
            ); // 0 = unlimited
            const DEFAULT_DELAY_MS = parseInt(
              process.env.RETRY_DELAY_429_MS || "30000",
              10
            );
            const awaitBackoff = async (status, retryAfterSec) => {
              let delayMs = DEFAULT_DELAY_MS;
              if (typeof retryAfterSec === "number" && retryAfterSec >= 0) {
                delayMs = retryAfterSec * 1000;
              }
              const untilTs = Date.now() + delayMs;
              pushEvent(jobId, "backoff", {
                reason: `HTTP ${status}`,
                delayMs,
                untilTs,
                attempts: job.attempts + 1,
              });
              await new Promise((r) => setTimeout(r, delayMs));
            };

            // Initial generate with backoff + retry on 429
            while (true) {
              const exec = await labsExecute({
                url: job.url,
                method: job.method,
                headers: job.headers,
                payload: job.payload,
              });
              if (exec.ok) {
                // success, proceed
                // Track operations from initial generate response
                try {
                  const ops = (exec.data?.operations || [])
                    .map((op, i) => ({ name: op?.operation?.name, index: i }))
                    .filter((o) => o.name);
                  job.operations = ops;
                } catch (_) {}
                pushEvent(jobId, "initial", { data: exec.data });
                break;
              }
              // handle error
              if (exec.status === 429) {
                // respect max retry if >0, else unlimited
                if (RETRY_MAX_429 > 0 && job.attempts >= RETRY_MAX_429) {
                  job.status = "failed";
                  job.error =
                    exec.data?.error || exec.data || `HTTP ${exec.status}`;
                  pushEvent(jobId, "failed", {
                    error: job.error,
                    status: exec.status,
                  });
                  return;
                }
                job.attempts = (job.attempts || 0) + 1;
                if (job.cancelRequested) {
                  job.status = "cancelled";
                  pushEvent(jobId, "cancelled", {});
                  return;
                }
                await awaitBackoff(exec.status, exec.retryAfterSec);
                if (job.cancelRequested) {
                  job.status = "cancelled";
                  pushEvent(jobId, "cancelled", {});
                  return;
                }
                // retry loop continues
                continue;
              } else {
                job.status = "failed";
                job.error =
                  exec.data?.error || exec.data || `HTTP ${exec.status}`;
                pushEvent(jobId, "failed", {
                  error: job.error,
                  status: exec.status,
                });
                return;
              }
            }
            // Track operations from initial generate response
            if (!job.operations || !job.operations.length) {
              job.status = "completed";
              pushEvent(jobId, "completed", { data: {} });
              try {
                bumpUsage(job.user, "veo");
              } catch (_) {}
              return;
            }
            // Poll until done
            let attempt = 0;
            const headers = job.headers || {};
            while (attempt < 10000) {
              attempt++;
              if (job.cancelRequested) {
                job.status = "cancelled";
                pushEvent(jobId, "cancelled", { attempt });
                break;
              }
              const payload = {
                operations: job.operations.map((t) => ({
                  operation: { name: t.name },
                })),
              };
              let checkUrl =
                process.env.LABS_DEFAULT_CHECK_URL ||
                "https://aisandbox-pa.googleapis.com/v1/operations:batchCheckAsyncVideoGenerationStatus";
              let p = await labsExecute({
                url: checkUrl,
                method: "POST",
                headers,
                payload,
              });
              if (!p.ok && p.status === 404) {
                const alt = checkUrl.includes("/operations:")
                  ? checkUrl.replace("/operations:", "/video:")
                  : "https://aisandbox-pa.googleapis.com/v1/operations:batchCheckAsyncVideoGenerationStatus";
                p = await labsExecute({
                  url: alt,
                  method: "POST",
                  headers,
                  payload,
                });
              }
              if (p.ok) {
                pushEvent(jobId, "polled", { attempt, data: p.data });
                const statuses = (p.data?.operations || []).map(
                  (o) => o?.status || "UNKNOWN"
                );
                const pending = statuses.some((s) =>
                  /PENDING|IN_PROGRESS|ACTIVE/i.test(s)
                );
                if (!pending) {
                  job.status = "completed";
                  pushEvent(jobId, "completed", { data: p.data });
                  try {
                    bumpUsage(job.user, "veo");
                  } catch (_) {}
                  break;
                }
              } else {
                if (p.status === 429) {
                  // Poll backoff and continue
                  if (RETRY_MAX_429 > 0 && job.attempts >= RETRY_MAX_429) {
                    job.status = "failed";
                    job.error = p.data?.error || p.data || `HTTP ${p.status}`;
                    pushEvent(jobId, "failed", {
                      error: job.error,
                      status: p.status,
                    });
                    break;
                  }
                  job.attempts = (job.attempts || 0) + 1;
                  if (job.cancelRequested) {
                    job.status = "cancelled";
                    pushEvent(jobId, "cancelled", { attempt });
                    break;
                  }
                  await awaitBackoff(p.status, p.retryAfterSec);
                  if (job.cancelRequested) {
                    job.status = "cancelled";
                    pushEvent(jobId, "cancelled", { attempt });
                    break;
                  }
                  // continue polling after backoff
                } else {
                  job.status = "failed";
                  job.error = p.data?.error || p.data || `HTTP ${p.status}`;
                  pushEvent(jobId, "failed", {
                    error: job.error,
                    status: p.status,
                  });
                  break;
                }
              }
              await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
            }
          } catch (err) {
            job.status = "failed";
            job.error = String(err);
            pushEvent(jobId, "failed", { error: job.error });
          } finally {
            active--;
            setImmediate(schedule);
          }
        })();
      }
    };

    // Create job endpoint with rate limiting
    app.post("/api/generate", rateLimitGenerate, (req, res) => {
      try {
        const cookie = String(req.headers["cookie"] || "");
        const map = Object.fromEntries(
          cookie
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const i = s.indexOf("=");
              const k = i >= 0 ? s.slice(0, i).trim() : s;
              const v = i >= 0 ? s.slice(i + 1).trim() : "";
              return [k, decodeURIComponent(v)];
            })
        );
        const plan = (map["plan"] || "").toLowerCase();
        const planExpiry = parseInt(map["planExpiry"] || "0", 10);
        const now = Date.now();
        const isMonthlyExpired =
          plan === "monthly" && (!!planExpiry ? now > planExpiry : true);
        const allowed =
          plan === "admin" ||
          plan === "veo_sora_unlimited" ||
          plan === "veo_lifetime" ||
          (plan === "monthly" && !isMonthlyExpired);
        if (!allowed) {
          return res
            .status(403)
            .json({ error: "Akses generate video dibatasi oleh paket akun." });
        }
        const { url, method = "POST", headers = {}, payload } = req.body || {};
        if (!payload || !Array.isArray(payload?.requests)) {
          return res.status(400).json({ error: "Missing payload.requests" });
        }
        const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const cookiesForJob = parseCookies(req.headers["cookie"] || "");
        const userForJob = {
          id: cookiesForJob.uid || "",
          email: cookiesForJob.email || "",
          name: cookiesForJob.name || "",
          plan: cookiesForJob.plan || "",
        };
        jobs.set(jobId, {
          id: jobId,
          status: "queued",
          createdAt: Date.now(),
          url,
          method,
          headers,
          payload,
          attempts: 0,
          user: userForJob,
        });
        queue.push(jobId);
        pushEvent(jobId, "queued", {});
        setImmediate(schedule);
        res.json({ ok: true, jobId });
      } catch (err) {
        res
          .status(500)
          .json({ error: "Failed to create job", detail: String(err) });
      }
    });

    // Job snapshot
    app.get("/api/jobs/:id", (req, res) => {
      const job = jobs.get(req.params.id);
      if (!job) return res.status(404).json({ error: "Not found" });
      res.json({ id: job.id, status: job.status, createdAt: job.createdAt });
    });

    // SSE stream
    app.get("/api/jobs/:id/stream", (req, res) => {
      const jobId = req.params.id;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      let set = subscribers.get(jobId);
      if (!set) {
        set = new Set();
        subscribers.set(jobId, set);
      }
      set.add(res);
      req.on("close", () => {
        try {
          set.delete(res);
        } catch (_) {}
      });
      const job = jobs.get(jobId);
      if (job) {
        pushEvent(jobId, "snapshot", { status: job.status });
      }
    });

    // Cancel job: queued -> cancelled, started -> request cancel
    app.post("/api/jobs/:id/cancel", (req, res) => {
      const jobId = req.params.id;
      const job = jobs.get(jobId);
      if (!job) return res.status(404).json({ error: "Not found" });
      job.cancelRequested = true;
      if (job.status === "queued") {
        job.status = "cancelled";
        pushEvent(jobId, "cancelled", {});
      }
      // Worker loop will observe cancelRequested and stop
      res.json({ ok: true, jobId, status: job.status });
    });

    // Server-side guards for protected pages
    const protectedPaths = [
      "/prompt-tunggal",
      "/prompt-batch",
      "/frame-ke-video",
      "/sora2",
      "/image-generator",
      "/dashboard",
      "/credit",
      "/profile",
      "/admin/users",
      "/admin/dashboard",
    ];
    for (const p of protectedPaths) {
      app.get(p, async (req, res) => {
        try {
          const cookies = parseCookies(req.headers["cookie"] || "");
          const ok = cookies.auth_ok === "1";
          const uid = String(cookies.auth_uid || "").trim();
          if (!ok || !uid) {
            res.status(302).setHeader("Location", "/login").end();
            return;
          }
          if (p.startsWith("/admin")) {
            let isAllowed = false;
            try {
              if (srSupabase) {
                const { data: profile } = await srSupabase
                  .from("users")
                  .select("plan")
                  .eq("id", uid)
                  .single();
                isAllowed =
                  String(profile?.plan || "").toLowerCase() === "admin";
              }
            } catch (_) {}
            if (!isAllowed) {
              const email = String(cookies.auth_email || "").toLowerCase();
              isAllowed = ADMIN_EMAIL_WHITELIST.includes(email);
            }
            if (!isAllowed) {
              res.status(302).setHeader("Location", "/login").end();
              return;
            }
          }
        } catch (_) {
          res.status(302).setHeader("Location", "/login").end();
          return;
        }
        return handleNext(req, res);
      });
    }

    // Explicit 404 for /musik
    app.get("/musik", (req, res) => {
      res.status(404).send("Not Found");
    });

    app.all("*", (req, res) => handleNext(req, res));
    app.listen(PORT, () => {
      console.log(
        `Labs Flow proxy server (Next.js + API) running at http://localhost:${PORT}`
      );
    });
  } catch (err) {
    console.error("Failed to start server", err);
    process.exit(1);
  }
};

startServer();
