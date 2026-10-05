require("dotenv").config();

const path = require("path");
const express = require("express");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const pool = require("./db");
const { fetchTrackInfo } = require("./services/external-api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const openapiDocument = YAML.load(path.join(__dirname, "..", "openapi.yaml"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

// ค่าสูงสุดของ INT ใน MySQL ถ้าปล่อยผ่านไปจะกลายเป็น 500 จากฐานข้อมูล
const MAX_INT = 2147483647;

const isPositiveInt = (value) =>
  Number.isInteger(value) && value > 0 && value <= MAX_INT;

const isValidText = (value, maxLength) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  value.trim().length <= maxLength;

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function validateIdParam(req, res, next, value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return sendError(res, 400, "INVALID_ID", "id ต้องเป็นจำนวนเต็มบวก");
  }
  next();
}
app.param("id", validateIdParam);
app.param("songId", validateIdParam);

function validateSongBody(body) {
  const { artist_id, title, duration_seconds, release_year } = body || {};

  if (!isPositiveInt(artist_id)) return "artist_id ต้องเป็นจำนวนเต็มบวก";
  if (!isValidText(title, 180)) {
    return "title ต้องเป็นข้อความที่ไม่ว่าง ยาวไม่เกิน 180 ตัวอักษร";
  }
  if (!isPositiveInt(duration_seconds)) {
    return "duration_seconds ต้องเป็นจำนวนเต็มบวก";
  }
  if (
    release_year !== undefined &&
    release_year !== null &&
    !(Number.isInteger(release_year) && release_year >= 1000 && release_year <= 9999)
  ) {
    return "release_year ต้องเป็นปี ค.ศ. 4 หลัก หรือ null";
  }
  return null;
}

const SONG_SELECT = `SELECT songs.id, songs.title, songs.duration_seconds,
              songs.release_year, songs.artist_id, artists.name AS artist_name
       FROM songs
       JOIN artists ON songs.artist_id = artists.id`;

async function findSongById(id) {
  const [rows] = await pool.query(`${SONG_SELECT} WHERE songs.id = ?`, [id]);
  return rows[0] || null;
}

app.get("/health", (req, res) => {
  res.status(200).json({ message: "Music Library API is ready to use!" });
});

// ---------- Artists ----------

app.get("/api/v1/artists", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, country, created_at FROM artists ORDER BY name",
    );
    res.status(200).json({ message: "สำเร็จ", data: rows });
  } catch (err) {
    next(err);
  }
});

app.post("/api/v1/artists", async (req, res, next) => {
  try {
    const { name, country } = req.body || {};

    if (!isValidText(name, 120) || !isValidText(country, 80)) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "name (ไม่เกิน 120 ตัวอักษร) และ country (ไม่เกิน 80 ตัวอักษร) ต้องเป็นข้อความที่ไม่ว่าง",
      );
    }

    const [result] = await pool.query(
      "INSERT INTO artists (name, country) VALUES (?, ?)",
      [name.trim(), country.trim()],
    );
    const [rows] = await pool.query(
      "SELECT id, name, country, created_at FROM artists WHERE id = ?",
      [result.insertId],
    );

    res.status(201).json({ message: "เพิ่มศิลปินสำเร็จ", data: rows[0] });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return sendError(res, 409, "DUPLICATE_ARTIST", "มีศิลปินชื่อนี้อยู่แล้ว");
    }
    next(err);
  }
});

app.get("/api/v1/artists/:id/songs", async (req, res, next) => {
  try {
    const artistId = req.params.id;

    const [artistRows] = await pool.query(
      "SELECT id, name, country FROM artists WHERE id = ?",
      [artistId],
    );
    if (artistRows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "ไม่พบศิลปินที่ระบุ");
    }

    const [songRows] = await pool.query(
      `SELECT id, title, duration_seconds, release_year
       FROM songs
       WHERE artist_id = ?
       ORDER BY release_year, title`,
      [artistId],
    );

    res.status(200).json({
      message: "สำเร็จ",
      data: { ...artistRows[0], song_count: songRows.length, songs: songRows },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Songs ----------

app.get("/api/v1/songs", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    let sql = SONG_SELECT;
    const params = [];
    if (q !== "") {
      sql += " WHERE songs.title LIKE ? OR artists.name LIKE ?";
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += " ORDER BY artists.name, songs.title";

    const [rows] = await pool.query(sql, params);
    res.status(200).json({ message: "สำเร็จ", data: rows });
  } catch (err) {
    next(err);
  }
});

app.get("/api/v1/songs/:id", async (req, res, next) => {
  try {
    const song = await findSongById(req.params.id);
    if (!song) {
      return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงที่ระบุ");
    }
    res.status(200).json({ message: "สำเร็จ", data: song });
  } catch (err) {
    next(err);
  }
});

app.get("/api/v1/songs/:id/external-info", async (req, res, next) => {
  try {
    const song = await findSongById(req.params.id);
    if (!song) {
      return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงที่ระบุ");
    }

    const result = await fetchTrackInfo(song.artist_name, song.title);

    // iTunes ล่มก็ยังตอบ 200 เพราะข้อมูลเพลงของเรายังใช้ได้ ขาดแค่ข้อมูลเสริม
    if (result.source === "fallback") {
      return res.status(200).json({
        message: "ไม่สามารถดึงข้อมูลเสริมจากบริการภายนอกได้ จึงแสดงค่าเริ่มต้นแทน",
        data: {
          song,
          external_info: result.info,
          source: "fallback",
          attempts: result.attempts,
          reason: result.reason,
        },
      });
    }

    res.status(200).json({
      message: result.info ? "สำเร็จ" : "ไม่พบข้อมูลเพลงนี้ในบริการภายนอก",
      data: {
        song,
        external_info: result.info,
        source: "itunes",
        attempts: result.attempts,
      },
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/v1/songs", async (req, res, next) => {
  try {
    const validationMessage = validateSongBody(req.body);
    if (validationMessage) {
      return sendError(res, 400, "VALIDATION_ERROR", validationMessage);
    }
    const { artist_id, title, duration_seconds, release_year } = req.body;

    const [result] = await pool.query(
      `INSERT INTO songs (artist_id, title, duration_seconds, release_year)
       VALUES (?, ?, ?, ?)`,
      [artist_id, title.trim(), duration_seconds, release_year ?? null],
    );

    const song = await findSongById(result.insertId);
    res.status(201).json({ message: "เพิ่มเพลงสำเร็จ", data: song });
  } catch (err) {
    if (err.code === "ER_NO_REFERENCED_ROW_2") {
      return sendError(res, 404, "ARTIST_NOT_FOUND", "ไม่พบศิลปินที่ระบุ");
    }
    if (err.code === "ER_DUP_ENTRY") {
      return sendError(
        res,
        409,
        "DUPLICATE_SONG",
        "ศิลปินคนนี้มีเพลงชื่อนี้อยู่แล้ว",
      );
    }
    next(err);
  }
});

app.put("/api/v1/songs/:id", async (req, res, next) => {
  try {
    const validationMessage = validateSongBody(req.body);
    if (validationMessage) {
      return sendError(res, 400, "VALIDATION_ERROR", validationMessage);
    }
    const { artist_id, title, duration_seconds, release_year } = req.body;
    const songId = req.params.id;

    // เช็กเองก่อน เพราะ affectedRows เป็น 0 ได้ทั้งตอนไม่พบและตอนค่าไม่เปลี่ยน
    if (!(await findSongById(songId))) {
      return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงที่ระบุ");
    }

    await pool.query(
      `UPDATE songs
       SET artist_id = ?, title = ?, duration_seconds = ?, release_year = ?
       WHERE id = ?`,
      [artist_id, title.trim(), duration_seconds, release_year ?? null, songId],
    );

    const song = await findSongById(songId);
    res.status(200).json({ message: "แก้ไขเพลงสำเร็จ", data: song });
  } catch (err) {
    if (err.code === "ER_NO_REFERENCED_ROW_2") {
      return sendError(res, 404, "ARTIST_NOT_FOUND", "ไม่พบศิลปินที่ระบุ");
    }
    if (err.code === "ER_DUP_ENTRY") {
      return sendError(
        res,
        409,
        "DUPLICATE_SONG",
        "ศิลปินคนนี้มีเพลงชื่อนี้อยู่แล้ว",
      );
    }
    next(err);
  }
});

app.delete("/api/v1/songs/:id", async (req, res, next) => {
  try {
    const [result] = await pool.query("DELETE FROM songs WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงที่ระบุ");
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------- Playlists ----------

app.get("/api/v1/playlists", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT playlists.id, playlists.name, playlists.owner_name,
              playlists.created_at, COUNT(playlist_songs.id) AS song_count
       FROM playlists
       LEFT JOIN playlist_songs ON playlist_songs.playlist_id = playlists.id
       GROUP BY playlists.id
       ORDER BY playlists.owner_name, playlists.name`,
    );
    res.status(200).json({ message: "สำเร็จ", data: rows });
  } catch (err) {
    next(err);
  }
});

app.post("/api/v1/playlists", async (req, res, next) => {
  try {
    const { name, owner_name } = req.body || {};

    if (!isValidText(name, 120) || !isValidText(owner_name, 100)) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "name (ไม่เกิน 120 ตัวอักษร) และ owner_name (ไม่เกิน 100 ตัวอักษร) ต้องเป็นข้อความที่ไม่ว่าง",
      );
    }

    const [result] = await pool.query(
      "INSERT INTO playlists (name, owner_name) VALUES (?, ?)",
      [name.trim(), owner_name.trim()],
    );
    const [rows] = await pool.query("SELECT * FROM playlists WHERE id = ?", [
      result.insertId,
    ]);

    res.status(201).json({ message: "สร้างเพลย์ลิสต์สำเร็จ", data: rows[0] });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return sendError(
        res,
        409,
        "DUPLICATE_PLAYLIST",
        "เจ้าของคนนี้มีเพลย์ลิสต์ชื่อนี้อยู่แล้ว",
      );
    }
    next(err);
  }
});

app.get("/api/v1/playlists/:id", async (req, res, next) => {
  try {
    const playlistId = req.params.id;

    const [playlistRows] = await pool.query(
      "SELECT * FROM playlists WHERE id = ?",
      [playlistId],
    );

    if (playlistRows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลย์ลิสต์ที่ระบุ");
    }

    const [songRows] = await pool.query(
      `SELECT songs.id, songs.title, songs.duration_seconds,
              artists.name AS artist_name
       FROM playlist_songs
       JOIN songs ON playlist_songs.song_id = songs.id
       JOIN artists ON songs.artist_id = artists.id
       WHERE playlist_songs.playlist_id = ?
       ORDER BY playlist_songs.added_at`,
      [playlistId],
    );

    const totalSeconds = songRows.reduce(
      (sum, song) => sum + song.duration_seconds,
      0,
    );

    res.status(200).json({
      message: "สำเร็จ",
      data: {
        ...playlistRows[0],
        song_count: songRows.length,
        total_duration_seconds: totalSeconds,
        songs: songRows,
      },
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/v1/playlists/:id/songs", async (req, res, next) => {
  try {
    const playlistId = Number(req.params.id);
    const { song_id } = req.body || {};

    if (!isPositiveInt(song_id)) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "song_id ต้องเป็นจำนวนเต็มบวก",
      );
    }

    const [playlistRows] = await pool.query(
      "SELECT id FROM playlists WHERE id = ?",
      [playlistId],
    );
    if (playlistRows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลย์ลิสต์ที่ระบุ");
    }

    const [result] = await pool.query(
      "INSERT INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)",
      [playlistId, song_id],
    );
    const [rows] = await pool.query(
      "SELECT id, playlist_id, song_id, added_at FROM playlist_songs WHERE id = ?",
      [result.insertId],
    );

    res
      .status(201)
      .json({ message: "เพิ่มเพลงเข้าเพลย์ลิสต์สำเร็จ", data: rows[0] });
  } catch (err) {
    // เพลย์ลิสต์เช็กไปแล้วข้างบน FK ที่พังตรงนี้จึงเป็น song_id แน่นอน
    if (err.code === "ER_NO_REFERENCED_ROW_2") {
      return sendError(res, 404, "SONG_NOT_FOUND", "ไม่พบเพลงที่ระบุ");
    }
    if (err.code === "ER_DUP_ENTRY") {
      return sendError(
        res,
        409,
        "DUPLICATE_PLAYLIST_SONG",
        "เพลงนี้อยู่ในเพลย์ลิสต์อยู่แล้ว",
      );
    }
    next(err);
  }
});

app.delete("/api/v1/playlists/:id/songs/:songId", async (req, res, next) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?",
      [req.params.id, req.params.songId],
    );
    if (result.affectedRows === 0) {
      return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงนี้ในเพลย์ลิสต์ที่ระบุ");
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  sendError(res, 404, "ROUTE_NOT_FOUND", "ไม่พบเส้นทางที่ร้องขอ");
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return sendError(res, 400, "INVALID_JSON", "รูปแบบ JSON ไม่ถูกต้อง");
  }

  console.error(err.stack);
  sendError(
    res,
    500,
    "INTERNAL_SERVER_ERROR",
    "เกิดข้อผิดพลาดที่ไม่คาดคิดภายในระบบ",
  );
});

app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
  console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
});
