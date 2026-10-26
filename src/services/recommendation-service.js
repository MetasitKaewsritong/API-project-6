// ==============================================================================
// recommendation-service.js — บริการแนะนำเพลงและสถิติภาพรวมของคลังเพลง
// ------------------------------------------------------------------------------
// หน้าที่ : (1) แนะนำเพลงที่เกี่ยวข้องกับเพลงที่ระบุ (2) สรุปสถิติภาพรวมของระบบ
// ทำไม   : แยกตรรกะธุรกิจขั้นสูงออกจาก index.js ให้เป็นโมดูลอิสระ (แนวคิด Microservice)
//          route แค่รับ-ส่ง HTTP ส่วนการคำนวณอยู่ที่ไฟล์นี้ ทดสอบแยกได้และย้ายออกเป็นบริการจริงได้ภายหลัง
// Sprint : 5 | Phase 3
// ==============================================================================

const pool = require("../db");

// ------------------------------------------------------------------------------
// 1. แนะนำเพลง (Recommendations)
// ------------------------------------------------------------------------------
// หน้าที่: คืนรายการเพลงแนะนำสำหรับเพลงต้นทาง เรียงจากเกี่ยวข้องมากไปน้อย
// ทำไม: ใช้ 2 ลำดับผสมกัน
//       (1) Co-occurrence: เพลงที่อยู่ในเพลย์ลิสต์เดียวกับเพลงต้นทาง ยิ่งอยู่ด้วยกันหลายเพลย์ลิสต์ยิ่งมาก่อน
//           ตรรกะ "คนที่ใส่เพลงนี้ ก็มักใส่เพลงนั้นด้วย" (Collaborative Filtering อย่างง่าย)
//       (2) Fallback: ถ้ายังไม่ครบตาม limit เติมด้วยเพลงอื่นของศิลปินเดียวกัน
//           เพื่อให้เพลงที่ยังไม่มีใครใส่เพลย์ลิสต์ก็ยังมีคำแนะนำ
// ถามอาจารย์: "เรียงตามความถี่" ทำอย่างไร
//             -> GROUP BY เพลง แล้ว COUNT(*) จำนวนเพลย์ลิสต์ที่เพลงนั้นอยู่ร่วมกับเพลงต้นทาง
//                จากนั้น ORDER BY จำนวนนั้นมากไปน้อย (ถ้าเท่ากันเรียงตามชื่อเพลงเพื่อให้ผลลัพธ์คงที่)
// คืนค่า: null ถ้าไม่พบเพลงต้นทาง
async function getRecommendedSongs(songId, limit = 5) {
  const [targetRows] = await pool.query(
    "SELECT id, artist_id, title FROM songs WHERE id = ?",
    [songId],
  );
  if (targetRows.length === 0) return null;
  const targetSong = targetRows[0];

  // ลำดับที่ 1: เพลงที่อยู่เพลย์ลิสต์เดียวกัน (self-join playlist_songs กับตัวเอง)
  // ทำไม: ps1 = แถวของเพลงต้นทาง, ps2 = แถวของเพลงอื่นในเพลย์ลิสต์เดียวกัน
  const [coPlaylistRows] = await pool.query(
    `SELECT s.id, s.title, s.duration_seconds, a.name AS artist_name,
            COUNT(*) AS shared_playlists, 'co_playlist' AS reason
     FROM playlist_songs ps1
     JOIN playlist_songs ps2
       ON ps1.playlist_id = ps2.playlist_id AND ps1.song_id <> ps2.song_id
     JOIN songs s ON s.id = ps2.song_id
     JOIN artists a ON a.id = s.artist_id
     WHERE ps1.song_id = ?
     GROUP BY s.id, s.title, s.duration_seconds, a.name
     ORDER BY shared_playlists DESC, s.title
     LIMIT ?`,
    [songId, limit],
  );
  const recommendations = [...coPlaylistRows];

  // ลำดับที่ 2: เติมด้วยเพลงของศิลปินเดียวกัน (ตัดเพลงต้นทางและเพลงที่ได้แล้วออก)
  if (recommendations.length < limit) {
    const excludedIds = [songId, ...recommendations.map((r) => r.id)];
    const [sameArtistRows] = await pool.query(
      `SELECT s.id, s.title, s.duration_seconds, a.name AS artist_name,
              0 AS shared_playlists, 'same_artist' AS reason
       FROM songs s
       JOIN artists a ON a.id = s.artist_id
       WHERE s.artist_id = ? AND s.id NOT IN (?)
       ORDER BY s.release_year, s.title
       LIMIT ?`,
      [targetSong.artist_id, excludedIds, limit - recommendations.length],
    );
    recommendations.push(...sameArtistRows);
  }

  return {
    target_song: targetSong,
    total_recommended: recommendations.length,
    recommendations,
  };
}

// ------------------------------------------------------------------------------
// 2. สถิติภาพรวม (Analytics)
// ------------------------------------------------------------------------------
// หน้าที่: สรุปจำนวนเพลง ศิลปิน เพลย์ลิสต์ เวลารวม เวลาเฉลี่ย และศิลปินที่มีเพลงมากที่สุด
// ทำไม: ใช้ subquery รวมเป็นคำสั่งเดียวแทนการยิงหลายรอบ ลดจำนวนรอบที่ไปถาม DB
async function getLibraryAnalytics() {
  const [[totals]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM songs) AS total_songs,
       (SELECT COUNT(*) FROM artists) AS total_artists,
       (SELECT COUNT(*) FROM playlists) AS total_playlists,
       (SELECT COALESCE(SUM(duration_seconds), 0) FROM songs) AS total_duration_seconds,
       (SELECT COALESCE(ROUND(AVG(duration_seconds), 1), 0) FROM songs) AS avg_duration_seconds`,
  );

  // ทำไม: JOIN (ไม่ใช่ LEFT JOIN) เพราะศิลปินที่ไม่มีเพลงเลยไม่ควรถูกนับเป็น "มีเพลงมากสุด"
  //       ORDER BY ชื่อเป็นตัวตัดสินเมื่อเท่ากัน เพื่อให้ผลลัพธ์เดิมทุกครั้ง
  const [topRows] = await pool.query(
    `SELECT a.id, a.name, COUNT(s.id) AS song_count
     FROM artists a
     JOIN songs s ON s.artist_id = a.id
     GROUP BY a.id, a.name
     ORDER BY song_count DESC, a.name
     LIMIT 1`,
  );

  // ทำไม: SUM/AVG ของ MySQL ส่งกลับมาเป็นข้อความ ต้องแปลงเป็นตัวเลขก่อนตอบ
  return {
    overview: {
      total_songs: Number(totals.total_songs),
      total_artists: Number(totals.total_artists),
      total_playlists: Number(totals.total_playlists),
      total_duration_minutes: Math.round(Number(totals.total_duration_seconds) / 60),
      avg_song_duration_seconds: Number(totals.avg_duration_seconds),
    },
    top_artist: topRows[0]
      ? { ...topRows[0], song_count: Number(topRows[0].song_count) }
      : null,
  };
}

module.exports = { getRecommendedSongs, getLibraryAnalytics };
