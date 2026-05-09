import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 7000);
const host = process.env.HOST || "0.0.0.0";
const catalogPath = path.join(__dirname, "data/catalog.json");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

await loadEnv();

const adminPassword = process.env.ADMIN_PASSWORD || "960718";
const sessionToken = crypto.createHmac("sha256", adminPassword).update("nazumi-admin").digest("hex");

app.use(express.json({ limit: "1mb" }));

app.get("/transparent-video-demo.html/admin", (_request, response) => {
  response.sendFile(path.join(__dirname, "admin.html"));
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

app.get("/api/catalog", async (_request, response) => {
  response.json(await readCatalog());
});

app.patch("/api/catalog/season/:season/episode/:episode", requireAdmin, async (request, response) => {
  const catalog = await readCatalog();
  const match = findEpisode(catalog, request.params);

  if (!match) {
    response.status(404).json({ error: "没有找到这一集" });
    return;
  }

  const title = String(request.body?.title || "").trim();

  if (!title) {
    response.status(400).json({ error: "标题不能为空" });
    return;
  }

  match.episode.title = title;
  await writeCatalog(catalog);
  response.json({ ok: true, episode: match.episode });
});

app.post(
  "/api/catalog/season/:season/episode/:episode/image",
  requireAdmin,
  upload.single("image"),
  async (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: "请选择图片" });
      return;
    }

    if (!supportedImageTypes.has(request.file.mimetype)) {
      response.status(400).json({ error: "只支持 png、jpg、webp、gif 图片" });
      return;
    }

    const catalog = await readCatalog();
    const match = findEpisode(catalog, request.params);

    if (!match) {
      response.status(404).json({ error: "没有找到这一集" });
      return;
    }

    const seasonName = `season-${pad(match.season.season)}`;
    const episodeBaseName = `episode-${pad(match.episode.episode)}`;
    const episodeName = `${episodeBaseName}.webp`;
    const imageDir = path.join(__dirname, "assets/images/monsters", seasonName);
    const thumbDir = path.join(__dirname, "assets/images/monsters/thumbs", seasonName);

    await fs.mkdir(imageDir, { recursive: true });
    await fs.mkdir(thumbDir, { recursive: true });
    await removeEpisodeImages(imageDir, episodeBaseName);
    await removeEpisodeImages(thumbDir, episodeBaseName);

    const imagePath = path.join(imageDir, episodeName);
    const thumbPath = path.join(thumbDir, episodeName);
    const imageBuffer = await sharp(request.file.buffer, { animated: false })
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
    const thumbBuffer = await sharp(request.file.buffer, { animated: false })
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

    await fs.writeFile(imagePath, imageBuffer);
    await fs.writeFile(thumbPath, thumbBuffer);

    const version = Date.now();
    match.episode.image = `assets/images/monsters/${seasonName}/${episodeName}?v=${version}`;
    match.episode.thumbnail = `assets/images/monsters/thumbs/${seasonName}/${episodeName}?v=${version}`;

    await writeCatalog(catalog);
    response.json({
      ok: true,
      episode: match.episode,
      sizes: {
        original: request.file.size,
        image: imageBuffer.length,
        thumbnail: thumbBuffer.length
      }
    });
  }
);

app.use(express.static(__dirname));

app.listen(port, host, () => {
  console.log(`Natsumebook admin server: http://${host}:${port}/transparent-video-demo.html/admin`);
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

async function readCatalog() {
  const catalogText = await fs.readFile(catalogPath, "utf8");
  return JSON.parse(catalogText);
}

async function writeCatalog(catalog) {
  const tmpPath = `${catalogPath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await fs.rename(tmpPath, catalogPath);
}

function findEpisode(catalog, params) {
  const seasonNumber = Number(params.season);
  const episodeNumber = Number(params.episode);
  const season = catalog.find((item) => Number(item.season) === seasonNumber);
  const episode = season?.episodes?.find((item) => Number(item.episode) === episodeNumber);

  return season && episode ? { season, episode } : null;
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
