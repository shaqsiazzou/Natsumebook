import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await loadEnv();

const app = express();
const port = Number(process.env.PORT || 7000);
const host = process.env.HOST || "0.0.0.0";
const catalogPath = path.join(__dirname, "data/catalog.json");
const placeholderMonster = "assets/images/monsters/placeholder.png";
const placeholderMonsterThumb = "assets/images/monsters/thumbs/placeholder.webp";
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET || "monster-images";
const catalogCacheTtlMs = parseCatalogCacheTtl(process.env.CATALOG_CACHE_TTL_MS);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const catalogCache = {
  data: null,
  expiresAt: 0,
  pending: null
};

const adminPassword = process.env.ADMIN_PASSWORD || "960718";
const sessionToken = crypto.createHmac("sha256", adminPassword).update("nazumi-admin").digest("hex");

app.use(express.json({ limit: "1mb" }));

app.get(["/admin", "/transparent-video-demo.html/admin"], (_request, response) => {
  response.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/transparent-video-demo.html", (_request, response) => {
  response.redirect(301, "/");
});

app.post("/api/admin/login", (request, response) => {
  if (String(request.body?.password || "") !== adminPassword) {
    response.status(401).json({ error: "密码不正确" });
    return;
  }

  response.setHeader("Set-Cookie", buildCookie(sessionToken));
  response.json({ ok: true });
});

app.post("/api/admin/logout", (_request, response) => {
  response.setHeader("Set-Cookie", "nazumi_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  response.json({ ok: true });
});

app.get("/api/admin/session", requireAdmin, (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/catalog", asyncHandler(async (_request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.json(await readCatalog());
}));

app.patch("/api/catalog/season/:season/episode/:episode", requireAdmin, asyncHandler(async (request, response) => {
  const title = String(request.body?.title || "").trim();
  const name = String(request.body?.name || "").trim();

  if (!title) {
    response.status(400).json({ error: "标题不能为空" });
    return;
  }

  const episode = await updateEpisodeText(request.params, { title, name });

  if (!episode) {
    response.status(404).json({ error: "没有找到这一集" });
    return;
  }

  clearCatalogCache();
  response.json({ ok: true, episode });
}));

app.post(
  "/api/catalog/season/:season/episode/:episode/image",
  requireAdmin,
  upload.single("image"),
  asyncHandler(async (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: "请选择图片" });
      return;
    }

    if (!supportedImageTypes.has(request.file.mimetype)) {
      response.status(400).json({ error: "只支持 png、jpg、webp、gif 图片" });
      return;
    }

    const match = await readEpisode(request.params);

    if (!match) {
      response.status(404).json({ error: "没有找到这一集" });
      return;
    }

    const seasonName = `season-${pad(match.season.season)}`;
    const episodeBaseName = `episode-${pad(match.episode.episode)}`;
    const episodeName = `${episodeBaseName}.webp`;
    const { imageBuffer, thumbBuffer } = await buildImageBuffers(request.file.buffer);
    const version = Date.now();
    const episode = await updateEpisodeImage({
      params: request.params,
      seasonName,
      episodeBaseName,
      episodeName,
      imageBuffer,
      thumbBuffer,
      version
    });

    if (episode) {
      clearCatalogCache();
    }

    response.json({
      ok: true,
      episode,
      sizes: {
        original: request.file.size,
        image: imageBuffer.length,
        thumbnail: thumbBuffer.length
      }
    });
  })
);

app.use((error, _request, response, next) => {
  console.error(error);

  if (response.headersSent) {
    next(error);
    return;
  }

  response.status(500).json({ error: "服务器出错，请稍后再试" });
});

app.use(express.static(__dirname));

app.listen(port, host, () => {
  console.log(`Natsumebook server: http://${host}:${port}/`);
  console.log(`Natsumebook admin: http://${host}:${port}/admin`);
  console.log(`Data source: ${hasSupabaseConfig() ? "Supabase" : "local JSON"}`);
});

async function loadEnv() {
  try {
    const envText = await fs.readFile(path.join(__dirname, ".env"), "utf8");

    envText.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const separatorIndex = trimmed.indexOf("=");

      if (separatorIndex === -1) {
        return;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch (error) {
    // Missing .env is fine when ADMIN_PASSWORD is provided by the shell.
  }
}

function buildCookie(value) {
  return `nazumi_admin=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

function requireAdmin(request, response, next) {
  if (readCookie(request.headers.cookie || "", "nazumi_admin") !== sessionToken) {
    response.status(401).json({ error: "需要登录" });
    return;
  }

  next();
}

function readCookie(cookieHeader, name) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function parseCatalogCacheTtl(value) {
  const ttl = Number(value);

  if (Number.isFinite(ttl) && ttl >= 0) {
    return ttl;
  }

  return 60 * 60 * 1000;
}

async function readCatalog() {
  const now = Date.now();

  if (catalogCache.data && catalogCache.expiresAt > now) {
    return catalogCache.data;
  }

  if (catalogCache.pending) {
    return catalogCache.pending;
  }

  catalogCache.pending = readFreshCatalog()
    .then((catalog) => {
      catalogCache.data = catalog;
      catalogCache.expiresAt = Date.now() + catalogCacheTtlMs;
      return catalog;
    })
    .finally(() => {
      catalogCache.pending = null;
    });

  return catalogCache.pending;
}

async function readFreshCatalog() {
  if (hasSupabaseConfig()) {
    return readSupabaseCatalog();
  }

  const catalogText = await fs.readFile(catalogPath, "utf8");
  return JSON.parse(catalogText);
}

function clearCatalogCache() {
  catalogCache.data = null;
  catalogCache.expiresAt = 0;
  catalogCache.pending = null;
}

async function readEpisode(params) {
  if (hasSupabaseConfig()) {
    return readSupabaseEpisode(params);
  }

  const catalog = await readLocalCatalog();
  return findEpisode(catalog, params);
}

async function updateEpisodeText(params, values) {
  if (hasSupabaseConfig()) {
    return updateSupabaseEpisode(params, values);
  }

  const catalog = await readLocalCatalog();
  const match = findEpisode(catalog, params);

  if (!match) {
    return null;
  }

  match.episode.title = values.title;
  match.episode.name = values.name;
  await writeCatalog(catalog);
  return match.episode;
}

async function updateEpisodeImage({
  params,
  seasonName,
  episodeBaseName,
  episodeName,
  imageBuffer,
  thumbBuffer,
  version
}) {
  if (hasSupabaseConfig()) {
    const imagePath = `${seasonName}/${episodeName}`;
    const thumbPath = `thumbs/${seasonName}/${episodeName}`;

    await uploadSupabaseObject(imagePath, imageBuffer);
    await uploadSupabaseObject(thumbPath, thumbBuffer);

    return updateSupabaseEpisode(params, {
      image_url: buildSupabasePublicUrl(imagePath, version),
      thumbnail_url: buildSupabasePublicUrl(thumbPath, version),
      image_path: imagePath,
      thumbnail_path: thumbPath
    });
  }

  const catalog = await readLocalCatalog();
  const localMatch = findEpisode(catalog, params);

  if (!localMatch) {
    return null;
  }

  const imageDir = path.join(__dirname, "assets/images/monsters", seasonName);
  const thumbDir = path.join(__dirname, "assets/images/monsters/thumbs", seasonName);

  await fs.mkdir(imageDir, { recursive: true });
  await fs.mkdir(thumbDir, { recursive: true });
  await removeEpisodeImages(imageDir, episodeBaseName);
  await removeEpisodeImages(thumbDir, episodeBaseName);

  await fs.writeFile(path.join(imageDir, episodeName), imageBuffer);
  await fs.writeFile(path.join(thumbDir, episodeName), thumbBuffer);

  localMatch.episode.image = `assets/images/monsters/${seasonName}/${episodeName}?v=${version}`;
  localMatch.episode.thumbnail = `assets/images/monsters/thumbs/${seasonName}/${episodeName}?v=${version}`;

  await writeCatalog(catalog);
  return localMatch.episode;
}

async function readLocalCatalog() {
  const catalogText = await fs.readFile(catalogPath, "utf8");
  return JSON.parse(catalogText);
}

async function writeCatalog(catalog) {
  const tmpPath = `${catalogPath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await fs.rename(tmpPath, catalogPath);
  clearCatalogCache();
}

function findEpisode(catalog, params) {
  const seasonNumber = Number(params.season);
  const episodeNumber = Number(params.episode);
  const season = catalog.find((item) => Number(item.season) === seasonNumber);
  const episode = season?.episodes?.find((item) => Number(item.episode) === episodeNumber);

  return season && episode ? { season, episode } : null;
}

async function buildImageBuffers(sourceBuffer) {
  const imageBuffer = await sharp(sourceBuffer, { animated: false })
    .rotate()
    .resize({
      width: 1440,
      height: 1440,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({
      quality: 82,
      effort: 4
    })
    .toBuffer();
  const thumbBuffer = await sharp(sourceBuffer, { animated: false })
    .rotate()
    .resize({
      width: 480,
      height: 270,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({
      quality: 74,
      effort: 4
    })
    .toBuffer();

  return { imageBuffer, thumbBuffer };
}

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

async function readSupabaseCatalog() {
  const rows = await supabaseRequest(
    "读取图鉴数据失败",
    `/rest/v1/episodes?select=season_number,episode_number,title,name,image_url,thumbnail_url&order=season_number.asc,episode_number.asc`
  );
  const catalog = [];

  rows.forEach((row) => {
    let season = catalog.find((item) => item.season === row.season_number);

    if (!season) {
      season = { season: row.season_number, episodes: [] };
      catalog.push(season);
    }

    season.episodes.push(normalizeSupabaseEpisode(row));
  });

  return catalog;
}

async function readSupabaseEpisode(params) {
  const { seasonNumber, episodeNumber } = parseEpisodeParams(params);
  const rows = await supabaseRequest(
    "读取单集数据失败",
    `/rest/v1/episodes?select=season_number,episode_number,title,name,image_url,thumbnail_url&season_number=eq.${seasonNumber}&episode_number=eq.${episodeNumber}&limit=1`
  );
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    season: { season: row.season_number },
    episode: normalizeSupabaseEpisode(row)
  };
}

async function updateSupabaseEpisode(params, values) {
  const { seasonNumber, episodeNumber } = parseEpisodeParams(params);
  const rows = await supabaseRequest(
    "保存单集数据失败",
    `/rest/v1/episodes?season_number=eq.${seasonNumber}&episode_number=eq.${episodeNumber}&select=season_number,episode_number,title,name,image_url,thumbnail_url`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(values)
    }
  );

  return rows[0] ? normalizeSupabaseEpisode(rows[0]) : null;
}

async function uploadSupabaseObject(objectPath, buffer) {
  await supabaseRequest(
    "上传图片到 Supabase 失败",
    `/storage/v1/object/${encodeURIComponent(supabaseStorageBucket)}/${encodeObjectPath(objectPath)}`,
    {
      method: "POST",
      headers: {
        "Cache-Control": "31536000",
        "Content-Type": "image/webp",
        "x-upsert": "true"
      },
      body: buffer
    }
  );
}

async function supabaseRequest(label, endpoint, options = {}) {
  const response = await fetch(`${supabaseUrl}${endpoint}`, {
    ...options,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      ...options.headers
    }
  });
  const text = await response.text();
  const body = parseResponseBody(text);

  if (!response.ok) {
    const message = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${label}: HTTP ${response.status} ${message}`);
  }

  return body;
}

function parseResponseBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function normalizeSupabaseEpisode(row) {
  return {
    episode: row.episode_number,
    title: row.title,
    name: row.name || "",
    thumbnail: row.thumbnail_url || placeholderMonsterThumb,
    image: row.image_url || placeholderMonster
  };
}

function parseEpisodeParams(params) {
  return {
    seasonNumber: Number(params.season),
    episodeNumber: Number(params.episode)
  };
}

function buildSupabasePublicUrl(objectPath, version) {
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(supabaseStorageBucket)}/${encodeObjectPath(objectPath)}?v=${version}`;
}

function encodeObjectPath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

async function removeEpisodeImages(directory, baseName) {
  await Promise.all(
    [".jpg", ".jpeg", ".png", ".webp", ".gif"].map(async (extension) => {
      try {
        await fs.unlink(path.join(directory, `${baseName}${extension}`));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    })
  );
}
