// ==============================================================================
// index.js — จุดเริ่มต้นของ Music Library API (Express server)
// ------------------------------------------------------------------------------
// หน้าที่ : รับ HTTP request แล้วอ่าน/เขียนข้อมูลใน MySQL ตอบเป็น JSON
// ทำไม   : เป็นตัวกลางระหว่างผู้ใช้ (เว็บ/แอป) กับฐานข้อมูล
// Sprint : 8 | Phase 3 (เพิ่ม Swagger UI ที่ /api-docs จาก openapi.yaml)
// ==============================================================================

// ทำไม: ต้องโหลด .env เป็นบรรทัดแรก ก่อน require("./db") ไม่เช่นนั้น process.env ยังว่าง
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const yaml = require("js-yaml");
const swaggerUi = require("swagger-ui-express");
const pool = require("./db");
const { fetchTrackInfo } = require("./services/external-api");
const {
  getRecommendedSongs,
  getLibraryAnalytics,
} = require("./services/recommendation-service");

// ------------------------------------------------------------------------------
// 1. ตั้งค่า Express
// ------------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3100;

// หน้าที่: อนุญาตให้หน้าเว็บ (frontend) ที่อยู่คนละต้นทางเรียก API นี้ได้
// ทำไม: เบราว์เซอร์บล็อกคำขอข้ามต้นทาง (CORS) ถ้า API ไม่ตอบ header อนุญาตกลับไป
//       หน้า frontend เปิดจากไฟล์หรือพอร์ตอื่น จึงเป็นคนละต้นทางกับ API ที่พอร์ต 3100
// ถามอาจารย์: CORS คืออะไร -> กลไกของเบราว์เซอร์ที่ให้เซิร์ฟเวอร์เป็นผู้บอกว่าต้นทางไหนเรียกตนได้
//             ที่นี่เปิดให้ทุกต้นทางเพราะเป็นโครงงานที่รันในเครื่อง
app.use(cors());

// หน้าที่: แสดงเอกสาร API แบบโต้ตอบได้ (Swagger UI) ที่ /api-docs
// ทำไม: อ่านจากไฟล์ openapi.yaml ตัวเดียวกับที่เป็นเอกสารส่ง ผู้ใช้เปิดดูและกดทดลองยิง API ได้จากหน้านี้
//       มี test (tests/openapi.test.js) เทียบว่าเอกสารกับ route จริงตรงกันทุกเส้น
// ถามอาจารย์: OpenAPI คืออะไร -> มาตรฐานเขียนบรรยาย REST API เป็นไฟล์ (YAML/JSON)
//             เครื่องมืออย่าง Swagger UI อ่านแล้วสร้างหน้าเอกสารและปุ่มทดลองยิงให้อัตโนมัติ
const openapiDocument = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf8"),
);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

// หน้าที่: แปลง body ที่เป็น JSON ให้กลายเป็น object ใน req.body
// ทำไม: ถ้าไม่มีบรรทัดนี้ req.body จะเป็น undefined และ POST/PUT อ่านข้อมูลไม่ได้
app.use(express.json());

// ------------------------------------------------------------------------------
// 2. ฟังก์ชันช่วย (Helpers)
// ------------------------------------------------------------------------------
// หน้าที่: ส่ง error รูปแบบเดียวกันทั้งระบบ { error: { code, message } }
// ทำไม: ให้ฝั่ง client (เช่น frontend) เช็คจาก error.code ได้เสมอ ไม่ต้องเดารูปแบบ
function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// หน้าที่: ตรวจ :id และ :songId ใน URL ว่าเป็นจำนวนเต็มบวกก่อนเข้า route
// ทำไม: ปฏิเสธ /songs/abc ด้วย 400 ทันทีโดยไม่ต้องเสียเวลาถาม DB
// ถามอาจารย์: regex ^[1-9]\d*$ -> ขึ้นต้นด้วย 1-9 แล้วตามด้วยตัวเลขอะไรก็ได้
//             จึงกัน "abc", "0", "-5", "1.5" ได้หมด
function validateIdParam(req, res, next, value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return sendError(res, 400, "INVALID_ID", "id ต้องเป็นจำนวนเต็มบวก");
  }
  next();
}
app.param("id", validateIdParam);
app.param("songId", validateIdParam);

// ------------------------------------------------------------------------------
// 3. ตัวตรวจข้อมูลขาเข้า (Validators)
// ------------------------------------------------------------------------------
// ทำไม: ค่ามากสุดของ INT ใน MySQL คือ 2^31-1 ถ้าปล่อยเลขเกินหลุดไปจะได้ error 500 แทน 400
const MAX_INT = 2147483647;

// หน้าที่: เป็นจำนวนเต็มบวกและไม่เกินขนาด INT หรือไม่
const isPositiveInt = (value) =>
  Number.isInteger(value) && value > 0 && value <= MAX_INT;

// หน้าที่: เป็นข้อความที่ไม่ว่างและยาวไม่เกินที่คอลัมน์รับได้หรือไม่
// ทำไม: ต้อง trim ก่อนนับ ไม่เช่นนั้น "   " (ช่องว่างล้วน) จะผ่านเป็นข้อความ
const isValidText = (value, maxLength) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  value.trim().length <= maxLength;

// หน้าที่: ตรวจ body ของเพลงก่อน INSERT/UPDATE คืนข้อความ error หรือ null ถ้าผ่าน
// ทำไม: ใช้ซ้ำทั้ง POST และ PUT
function validateSongBody(body) {
  const { artist_id, title, duration_seconds, release_year } = body || {};

  if (!isPositiveInt(artist_id)) return "artist_id ต้องเป็นจำนวนเต็มบวก";
  if (!isValidText(title, 180)) {
    return "title ต้องเป็นข้อความที่ไม่ว่าง ยาวไม่เกิน 180 ตัวอักษร";
  }
  if (!isPositiveInt(duration_seconds)) {
    return "duration_seconds ต้องเป็นจำนวนเต็มบวก";
  }
  // release_year ไม่บังคับ: ไม่ส่ง หรือส่ง null ได้ (ตรงกับคอลัมน์ที่เป็น NULL ได้)
  if (
    release_year !== undefined &&
    release_year !== null &&
    !(Number.isInteger(release_year) && release_year >= 1000 && release_year <= 9999)
  ) {
    return "release_year ต้องเป็นปี ค.ศ. 4 หลัก หรือ null";
  }
  return null;
}

// ------------------------------------------------------------------------------
// 4. SQL กลางสำหรับเพลง
// ------------------------------------------------------------------------------
// หน้าที่: SQL ดึงเพลงพร้อมชื่อศิลปิน ใช้ซ้ำหลาย route
// ทำไม: เขียนครั้งเดียว ถ้าจะเพิ่มคอลัมน์แก้ที่เดียว
const SONG_SELECT = `SELECT songs.id, songs.title, songs.duration_seconds,
            songs.release_year, songs.artist_id, artists.name AS artist_name
     FROM songs
     JOIN artists ON songs.artist_id = artists.id`;

async function findSongById(id) {
  const [rows] = await pool.query(`${SONG_SELECT} WHERE songs.id = ?`, [id]);
  return rows[0] || null;
}

// ------------------------------------------------------------------------------
// 5. Health Check
// ------------------------------------------------------------------------------
app.get("/health", (req, res) => {
  res.status(200).json({ message: "Music Library API is ready to use!" });
});

// ------------------------------------------------------------------------------
// 6. Artists
// ------------------------------------------------------------------------------
// หน้าที่: รายชื่อศิลปินทั้งหมดเรียงตามชื่อ
// ทำไม: Express 5 ส่ง error จาก async function ไปที่ error handler ให้เอง
//       จึงไม่ต้องเขียน try/catch ในเส้นที่ไม่ต้องแปลง error เอง
app.get("/api/v1/artists", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, name, country, created_at FROM artists ORDER BY name",
  );
  res.status(200).json({ message: "สำเร็จ", data: rows });
});

// หน้าที่: เพิ่มศิลปินใหม่
// UC: UC-04
// ถามอาจารย์: ทำไมไม่ SELECT เช็คชื่อซ้ำก่อน INSERT
//             -> ถ้ามี 2 request เข้ามาพร้อมกัน ทั้งคู่เช็คแล้วเห็นว่า "ยังไม่ซ้ำ" แล้วต่างก็ INSERT
//                (race condition) มีแต่ UNIQUE ใน DB เท่านั้นที่กันได้จริง เราจึงดัก ER_DUP_ENTRY แทน
app.post("/api/v1/artists", async (req, res, next) => {
  const { name, country } = req.body || {};

  if (!isValidText(name, 120) || !isValidText(country, 80)) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "name (ไม่เกิน 120 ตัวอักษร) และ country (ไม่เกิน 80 ตัวอักษร) ต้องเป็นข้อความที่ไม่ว่าง",
    );
  }

  try {
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
    // ER_DUP_ENTRY = ติด UNIQUE(name) ใน schema.sql
    if (err.code === "ER_DUP_ENTRY") {
      return sendError(res, 409, "DUPLICATE_ARTIST", "มีศิลปินชื่อนี้อยู่แล้ว");
    }
    next(err); // error อื่นที่ไม่รู้จัก ส่งต่อให้ error handler กลาง (500)
  }
});

// หน้าที่: เพลงทั้งหมดของศิลปินที่ระบุ
// UC: UC-02
// ถามอาจารย์: ทำไมถามหาศิลปินก่อน -> ถ้าไม่เช็ค ศิลปินที่ไม่มีอยู่จริงกับศิลปินที่ยังไม่มีเพลง
//             จะตอบเหมือนกัน (รายการว่าง) ทั้งที่ความหมายต่างกัน (404 กับ 200)
app.get("/api/v1/artists/:id/songs", async (req, res) => {
  const [artistRows] = await pool.query(
    "SELECT id, name, country FROM artists WHERE id = ?",
    [req.params.id],
  );
  if (artistRows.length === 0) {
    return sendError(res, 404, "NOT_FOUND", "ไม่พบศิลปินที่ระบุ");
  }

  const [songRows] = await pool.query(
    `SELECT id, title, duration_seconds, release_year
     FROM songs WHERE artist_id = ? ORDER BY release_year, title`,
    [req.params.id],
  );

  res.status(200).json({
    message: "สำเร็จ",
    data: { ...artistRows[0], song_count: songRows.length, songs: songRows },
  });
});

// ------------------------------------------------------------------------------
// 7. Songs
// ------------------------------------------------------------------------------
// หน้าที่: รายการเพลงทั้งหมด หรือค้นหาด้วย ?q= จากชื่อเพลงหรือชื่อศิลปิน
// UC: UC-01
// ถามอาจารย์: กัน SQL Injection อย่างไร -> ใช้ ? (parameterized query) แล้วส่งค่าแยกใน array
//             ค่าจากผู้ใช้ไม่ถูกต่อเข้าไปในข้อความ SQL โดยตรง
app.get("/api/v1/songs", async (req, res) => {
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
});

// หน้าที่: รายละเอียดเพลง 1 เพลง
app.get("/api/v1/songs/:id", async (req, res) => {
  const song = await findSongById(req.params.id);
  if (!song) {
    return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงที่ระบุ");
  }
  res.status(200).json({ message: "สำเร็จ", data: song });
});

// หน้าที่: ดึงข้อมูลเสริมของเพลง (อัลบั้ม, แนวเพลง, รูปปก, ตัวอย่างเสียง) จาก iTunes
// ทำไม: ตอบ 200 เสมอเมื่อเพลงมีอยู่ใน DB แม้ iTunes ล่ม โดยบอกที่มาไว้ในฟิลด์ source
//       ("itunes" หรือ "fallback") และ attempts (จำนวนครั้งที่ยิงจริง) ให้ client แยกแยะได้
// ถามอาจารย์: ถ้า iTunes ล่มระบบเป็นอย่างไร -> ไม่ crash ไม่ค้าง ตอบข้อมูลเพลงของเราพร้อมค่า default
app.get("/api/v1/songs/:id/external-info", async (req, res) => {
  const song = await findSongById(req.params.id);
  if (!song) {
    return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงที่ระบุ");
  }

  const result = await fetchTrackInfo(song.artist_name, song.title);

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
});

// หน้าที่: เพิ่มเพลงใหม่
// UC: UC-03
// ทำไม: ตอบ 201 Created พร้อมข้อมูลเพลงที่เพิ่งสร้าง (รวม id) ให้ client ใช้ต่อได้ทันที
app.post("/api/v1/songs", async (req, res, next) => {
  const validationMessage = validateSongBody(req.body);
  if (validationMessage) {
    return sendError(res, 400, "VALIDATION_ERROR", validationMessage);
  }
  const { artist_id, title, duration_seconds, release_year } = req.body;

  try {
    const [result] = await pool.query(
      `INSERT INTO songs (artist_id, title, duration_seconds, release_year)
       VALUES (?, ?, ?, ?)`,
      [artist_id, title.trim(), duration_seconds, release_year ?? null],
    );
    const song = await findSongById(result.insertId);
    res.status(201).json({ message: "เพิ่มเพลงสำเร็จ", data: song });
  } catch (err) {
    // ER_NO_REFERENCED_ROW_2 = ติด FOREIGN KEY: artist_id ไม่มีอยู่ใน artists
    if (err.code === "ER_NO_REFERENCED_ROW_2") {
      return sendError(res, 404, "ARTIST_NOT_FOUND", "ไม่พบศิลปินที่ระบุ");
    }
    // ER_DUP_ENTRY = ติด UNIQUE(artist_id, title): ศิลปินคนนี้มีเพลงชื่อนี้แล้ว
    if (err.code === "ER_DUP_ENTRY") {
      return sendError(res, 409, "DUPLICATE_SONG", "ศิลปินคนนี้มีเพลงชื่อนี้อยู่แล้ว");
    }
    next(err);
  }
});

// หน้าที่: แก้ไขเพลงทั้งระเบียน (ต้องส่งครบทุกฟิลด์เหมือน POST)
// ทำไม: เช็คว่ามีเพลงก่อน UPDATE เพราะถ้าข้อมูลที่ส่งมาเหมือนเดิม affectedRows จะเป็น 0
//       แยกไม่ออกว่า "ไม่พบเพลง" หรือ "ไม่มีอะไรเปลี่ยน"
app.put("/api/v1/songs/:id", async (req, res, next) => {
  const validationMessage = validateSongBody(req.body);
  if (validationMessage) {
    return sendError(res, 400, "VALIDATION_ERROR", validationMessage);
  }
  const { artist_id, title, duration_seconds, release_year } = req.body;
  const songId = req.params.id;

  try {
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
      return sendError(res, 409, "DUPLICATE_SONG", "ศิลปินคนนี้มีเพลงชื่อนี้อยู่แล้ว");
    }
    next(err);
  }
});

// หน้าที่: ลบเพลงออกจากคลัง
// ทำไม: ตอบ 204 No Content (ไม่มี body) เมื่อสำเร็จ
//       ON DELETE CASCADE ทำให้เพลงหลุดจากทุกเพลย์ลิสต์เอง ไม่ต้องลบ playlist_songs เอง
app.delete("/api/v1/songs/:id", async (req, res) => {
  const [result] = await pool.query("DELETE FROM songs WHERE id = ?", [
    req.params.id,
  ]);
  if (result.affectedRows === 0) {
    return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงที่ระบุ");
  }
  res.status(204).send();
});

// ------------------------------------------------------------------------------
// 8. Playlists
// ------------------------------------------------------------------------------
// หน้าที่: รายการเพลย์ลิสต์ทั้งหมดพร้อมจำนวนเพลงในแต่ละอัน
// ทำไม: ใช้ LEFT JOIN ไม่ใช่ JOIN เพื่อให้เพลย์ลิสต์ที่ยังว่าง (0 เพลง) ไม่หายไปจากผลลัพธ์
app.get("/api/v1/playlists", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT playlists.id, playlists.name, playlists.owner_name,
            playlists.created_at, COUNT(playlist_songs.id) AS song_count
     FROM playlists
     LEFT JOIN playlist_songs ON playlist_songs.playlist_id = playlists.id
     GROUP BY playlists.id
     ORDER BY playlists.owner_name, playlists.name`,
  );
  res.status(200).json({ message: "สำเร็จ", data: rows });
});

// หน้าที่: สร้างเพลย์ลิสต์ใหม่
// UC: UC-05
// ทำไม: UNIQUE(owner_name, name) ใน DB กันชื่อซ้ำของเจ้าของคนเดียวกัน เราดัก ER_DUP_ENTRY เป็น 409
app.post("/api/v1/playlists", async (req, res, next) => {
  const { name, owner_name } = req.body || {};

  if (!isValidText(name, 120) || !isValidText(owner_name, 100)) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "name (ไม่เกิน 120 ตัวอักษร) และ owner_name (ไม่เกิน 100 ตัวอักษร) ต้องเป็นข้อความที่ไม่ว่าง",
    );
  }

  try {
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

// หน้าที่: รายละเอียดเพลย์ลิสต์ พร้อมรายการเพลง จำนวนเพลง และความยาวรวม
// UC: UC-08
// ทำไม: ORDER BY ทั้ง added_at และ id เพราะเพลงที่ใส่พร้อมกันจะมี added_at เท่ากัน
//       ถ้าไม่ใส่ id ด้วย ลำดับระหว่างเพลงเหล่านั้นไม่คงที่
app.get("/api/v1/playlists/:id", async (req, res) => {
  const [playlistRows] = await pool.query(
    "SELECT * FROM playlists WHERE id = ?",
    [req.params.id],
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
     ORDER BY playlist_songs.added_at, playlist_songs.id`,
    [req.params.id],
  );

  // หน้าที่: รวมความยาวทุกเพลงเป็นวินาที (เพลย์ลิสต์ว่างได้ 0)
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
});

// หน้าที่: เพิ่มเพลงเข้าเพลย์ลิสต์
// UC: UC-06
// ถามอาจารย์: ทำไมเช็คเพลย์ลิสต์ก่อน INSERT
//             -> playlist_songs มี FK 2 ตัว MySQL แจ้ง ER_NO_REFERENCED_ROW_2 เหมือนกันทั้งคู่
//                แยกไม่ออกว่าตัวไหนผิด เช็คเพลย์ลิสต์ก่อน FK ที่เหลือจึงเป็นของ song_id แน่นอน
app.post("/api/v1/playlists/:id/songs", async (req, res, next) => {
  const playlistId = Number(req.params.id);
  const { song_id } = req.body || {};

  if (!isPositiveInt(song_id)) {
    return sendError(res, 400, "VALIDATION_ERROR", "song_id ต้องเป็นจำนวนเต็มบวก");
  }

  try {
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
    // ถึงตรงนี้ playlist มีอยู่จริงแล้ว ดังนั้น FK error ต้องเป็นของ song_id
    if (err.code === "ER_NO_REFERENCED_ROW_2") {
      return sendError(res, 404, "SONG_NOT_FOUND", "ไม่พบเพลงที่ระบุ");
    }
    // ติด UNIQUE(playlist_id, song_id): เพลงนี้อยู่ในเพลย์ลิสต์นี้แล้ว
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

// หน้าที่: นำเพลงออกจากเพลย์ลิสต์
// UC: UC-07
// ทำไม: ลบเฉพาะแถวใน playlist_songs ไม่แตะตาราง songs เพลงต้นฉบับจึงยังอยู่ในคลัง
app.delete("/api/v1/playlists/:id/songs/:songId", async (req, res) => {
  const [result] = await pool.query(
    "DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?",
    [req.params.id, req.params.songId],
  );
  if (result.affectedRows === 0) {
    return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงนี้ในเพลย์ลิสต์ที่ระบุ");
  }
  res.status(204).send();
});

// ------------------------------------------------------------------------------
// 9. Microservices (Recommendations และ Analytics)
// ------------------------------------------------------------------------------
// หน้าที่: แนะนำเพลงที่เกี่ยวข้องกับเพลงที่ระบุ
// ทำไม: route นี้แค่ตรวจ input และตอบ HTTP ตรรกะการแนะนำอยู่ใน recommendation-service.js
//       ?limit= คือจำนวนสูงสุดที่ต้องการ (1-20, ไม่ส่งใช้ 5)
// ถามอาจารย์: ทำไมต้องตรวจ limit -> ค่าจาก URL เป็นข้อความ ถ้าส่ง -1 หรือ abc เข้า SQL LIMIT
//             จะได้ error 500 จาก MySQL จึงตรวจให้เป็น 400 ก่อนถึง DB
const MAX_RECOMMENDATION_LIMIT = 20;
const DEFAULT_RECOMMENDATION_LIMIT = 5;

app.get("/api/v1/recommendations/songs/:id", async (req, res) => {
  let limit = DEFAULT_RECOMMENDATION_LIMIT;
  if (req.query.limit !== undefined) {
    limit = /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOMMENDATION_LIMIT) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        `limit ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง ${MAX_RECOMMENDATION_LIMIT}`,
      );
    }
  }

  const result = await getRecommendedSongs(Number(req.params.id), limit);
  if (!result) {
    return sendError(res, 404, "NOT_FOUND", "ไม่พบเพลงที่ระบุเพื่อทำการแนะนำ");
  }
  res.status(200).json({ message: "ดึงรายการเพลงแนะนำสำเร็จ", data: result });
});

// หน้าที่: สรุปสถิติภาพรวมของคลังเพลง
app.get("/api/v1/analytics/overview", async (req, res) => {
  const stats = await getLibraryAnalytics();
  res.status(200).json({ message: "ดึงสถิติภาพรวมสำเร็จ", data: stats });
});

// ------------------------------------------------------------------------------
// 10. Error Handling ส่วนกลาง (ต้องอยู่ท้ายสุด หลังทุก route)
// ------------------------------------------------------------------------------
// หน้าที่: ดักทุก URL ที่ไม่มี route รองรับ
app.use((req, res) => {
  sendError(res, 404, "ROUTE_NOT_FOUND", "ไม่พบเส้นทางที่ร้องขอ");
});

// หน้าที่: ดักทุก error ที่หลุดมาจาก route (เช่น DB ล่ม, JSON พัง)
// ทำไม: log รายละเอียดไว้ที่เซิร์ฟเวอร์ แต่ตอบ client แค่ข้อความกลาง ๆ
// ถามอาจารย์: ทำไมไม่ส่ง err.message ให้ client -> อาจเผยโครงสร้างภายใน (ชื่อตาราง, คำสั่ง SQL)
//             ซึ่งเป็นช่องโหว่ด้านความปลอดภัย
// หมายเหตุ: ต้องมีพารามิเตอร์ครบ 4 ตัว (err, req, res, next) Express ถึงรู้ว่าเป็น error handler
app.use((err, req, res, next) => {
  // ผู้ใช้ส่ง JSON พัง (เช่น ลืมปิดปีกกา) express.json() จะโยน error ชนิดนี้
  // ทำไม: เป็นความผิดของ client ต้องตอบ 400 ไม่ใช่ 500
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

// ------------------------------------------------------------------------------
// 11. เริ่มเซิร์ฟเวอร์ และส่งออก app
// ------------------------------------------------------------------------------
// หน้าที่: เปิดพอร์ตรับ request เฉพาะตอนรันไฟล์นี้ตรง ๆ (node src/index.js หรือ npm start)
// ทำไม: require.main === module เป็นจริงเฉพาะตอนไฟล์นี้ถูกรันโดยตรง
//       ตอน test ไฟล์ถูก require เข้าไป จึงไม่เปิดพอร์ตจริง ไม่ชนกับเซิร์ฟเวอร์ที่รันอยู่
// ถามอาจารย์: ทำไมต้อง module.exports = app
//             -> ให้ Supertest ยิง request เข้า app ในหน่วยความจำได้โดยตรง ไม่ต้องผ่านเครือข่าย
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
  });
}

module.exports = app;
