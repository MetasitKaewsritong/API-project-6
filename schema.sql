-- ===================================================================
-- Music Library API - schema.sql
-- โครงงานระยะที่ 1 | รหัสนิสิต 67160005 | Pno 6 (ระบบข้อมูลเพลง)
-- ===================================================================

-- บอก MySQL ว่าข้อความในไฟล์นี้เป็น UTF-8 (ถ้าไม่ใส่ ภาษาไทยจะเพี้ยนตอน import)
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS music_library
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE music_library;

-- ต้องลบจากตารางลูกไปหาตารางแม่ ไม่งั้น FOREIGN KEY จะขวางไม่ให้ลบ
DROP TABLE IF EXISTS playlist_songs;
DROP TABLE IF EXISTS songs;
DROP TABLE IF EXISTS playlists;
DROP TABLE IF EXISTS artists;

-- -------------------------------------------------------------------
-- 1. artists - ศิลปินหรือวงดนตรี (ตารางแม่ของ songs)
-- -------------------------------------------------------------------
CREATE TABLE artists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- UNIQUE กันศิลปินชื่อซ้ำ (UC-04) บังคับที่ฐานข้อมูล ไม่ใช่แค่ในโค้ด
  name VARCHAR(120) NOT NULL UNIQUE,
  country VARCHAR(80) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------------
-- 2. playlists - เพลย์ลิสต์ที่ผู้ฟังสร้างขึ้น
-- -------------------------------------------------------------------
CREATE TABLE playlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- คนละคนตั้งชื่อเพลย์ลิสต์ซ้ำกันได้ แต่คนเดียวกันตั้งซ้ำไม่ได้
  UNIQUE KEY unique_playlist_per_owner (owner_name, name)
);

-- -------------------------------------------------------------------
-- 3. songs - เพลงในคลัง (Resource หลักตาม Pno 6)
--    ความสัมพันธ์: artists 1 --- N songs
-- -------------------------------------------------------------------
CREATE TABLE songs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  artist_id INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  duration_seconds INT NOT NULL,
  release_year SMALLINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- ลบศิลปิน เพลงของศิลปินคนนั้นต้องหายตามไปด้วย ไม่ปล่อยให้เป็นข้อมูลกำพร้า
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
  -- ศิลปินคนเดียวกันมีเพลงชื่อซ้ำไม่ได้ แต่คนละศิลปินใช้ชื่อเพลงเดียวกันได้
  UNIQUE KEY unique_song_per_artist (artist_id, title),
  -- CHECK ทำงานจริงตั้งแต่ MySQL 8.0.16 ขึ้นไป
  CONSTRAINT chk_duration_positive CHECK (duration_seconds > 0)
);

-- -------------------------------------------------------------------
-- 4. playlist_songs - ตารางเชื่อม (Junction Table)
--    ความสัมพันธ์: playlists N --- M songs
--    ฐานข้อมูลเชิงสัมพันธ์ไม่รองรับ Many-to-Many โดยตรง
--    จึงต้องแตกเป็นตารางกลาง เหมือน enrollments ใน wk05-lab.md
-- -------------------------------------------------------------------
CREATE TABLE playlist_songs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  playlist_id INT NOT NULL,
  song_id INT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  -- ลบเพลงออกจากคลัง เพลงนั้นหลุดจากทุกเพลย์ลิสต์อัตโนมัติ แต่เพลย์ลิสต์ยังอยู่
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
  -- กันเพิ่มเพลงเดิมซ้ำในเพลย์ลิสต์เดียวกัน (UC-06)
  UNIQUE KEY unique_song_in_playlist (playlist_id, song_id)
);
