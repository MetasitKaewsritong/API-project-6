// ===================================================================
// Music Library API - index.js
// โครงงานระยะที่ 1 | รหัสนิสิต 67160005 | Pno 6 (ระบบข้อมูลเพลง)
//
// เฟสนี้เน้นยืนยันว่าโครงสร้างฐานข้อมูลที่ออกแบบไว้ใช้งานได้จริง
// จึงมีเฉพาะ route แบบอ่านข้อมูล ส่วน POST/PUT/DELETE จะทำในระยะที่ 2
// ===================================================================

require("dotenv").config();

const express = require("express");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ตรวจว่าเซิร์ฟเวอร์ทำงานอยู่
app.get("/health", (req, res) => {
  res.status(200).json({ message: "Music Library API is ready to use!" });
});

// -------------------------------------------------------------------
// 1. GET /api/v1/songs
//    ยืนยันความสัมพันธ์ One-to-Many: artists 1 --- N songs
//    JOIN ดึงชื่อศิลปินมาพร้อมเพลงในคำสั่งเดียว ไม่ต้องยิงหลายรอบ
// -------------------------------------------------------------------
app.get("/api/v1/songs", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT songs.id, songs.title, songs.duration_seconds,
              songs.release_year, artists.name AS artist_name
       FROM songs
       JOIN artists ON songs.artist_id = artists.id
       ORDER BY artists.name, songs.title`,
    );
    res.status(200).json({ message: "สำเร็จ", data: rows });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// 2. GET /api/v1/playlists/:id
//    ยืนยันความสัมพันธ์ Many-to-Many ผ่านตารางเชื่อม playlist_songs
//    JOIN สามตารางเพื่อดึงรายชื่อเพลงในเพลย์ลิสต์พร้อมชื่อศิลปิน
// -------------------------------------------------------------------
app.get("/api/v1/playlists/:id", async (req, res, next) => {
  try {
    const playlistId = req.params.id;

    const [playlistRows] = await pool.query(
      // เครื่องหมาย ? คือ Parameterized Query - ค่าจะถูกส่งแยกจากคำสั่ง SQL
      // ทำให้ผู้ใช้ไม่สามารถแทรกคำสั่ง SQL เข้ามาได้ (ป้องกัน SQL Injection)
      "SELECT * FROM playlists WHERE id = ?",
      [playlistId],
    );

    if (playlistRows.length === 0) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "ไม่พบเพลย์ลิสต์ที่ระบุ" },
      });
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

// 404: ไม่พบ route ที่ร้องขอ (ต้องอยู่หลัง route ทั้งหมด)
app.use((req, res) => {
  res.status(404).json({
    error: { code: "ROUTE_NOT_FOUND", message: "ไม่พบเส้นทางที่ร้องขอ" },
  });
});

// Error-handling middleware (ต้องมีพารามิเตอร์ 4 ตัวเสมอ)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "เกิดข้อผิดพลาดที่ไม่คาดคิดภายในระบบ",
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});
