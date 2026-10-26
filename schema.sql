-- ==============================================================================
-- schema.sql — สร้างฐานข้อมูลและตารางทั้ง 4 ตารางพร้อม constraint
-- ------------------------------------------------------------------------------
-- หน้าที่ : กำหนดโครงสร้างข้อมูล artists, playlists, songs, playlist_songs
-- ทำไม   : ให้ MySQL บังคับกฎของระบบเอง (ไม่ซ้ำ, ไม่กำพร้า, ไม่ติดลบ)
--          แม้โค้ด Express จะพลาดก็ตาม
-- Sprint : 0 | Phase 1
-- ==============================================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS music_library
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE music_library;

-- ------------------------------------------------------------------------------
-- 1. ล้างตารางเดิม
-- ------------------------------------------------------------------------------
-- ทำไม: ต้องลบตารางลูกก่อนตารางแม่ ไม่เช่นนั้นติด FOREIGN KEY
-- ถามอาจารย์: ลำดับ DROP คือย้อนจากลูกไปแม่ (playlist_songs -> songs -> playlists -> artists)
DROP TABLE IF EXISTS playlist_songs;
DROP TABLE IF EXISTS songs;
DROP TABLE IF EXISTS playlists;
DROP TABLE IF EXISTS artists;

-- ------------------------------------------------------------------------------
-- 2. artists (ตารางแม่ของ songs)
-- ------------------------------------------------------------------------------
-- หน้าที่: เก็บข้อมูลศิลปิน
-- UC: UC-04 เพิ่มศิลปิน (UNIQUE กันชื่อซ้ำ)
CREATE TABLE artists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  country VARCHAR(80) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 3. playlists (ตารางแม่ของ playlist_songs)
-- ------------------------------------------------------------------------------
-- หน้าที่: เก็บเพลย์ลิสต์ของผู้ฟัง
-- UC: UC-05 สร้างเพลย์ลิสต์
-- ทำไม: UNIQUE แบบคู่ (owner_name, name) = คนละคนตั้งชื่อซ้ำได้ แต่คนเดียวกันซ้ำไม่ได้
CREATE TABLE playlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_playlist_per_owner (owner_name, name)
);

-- ------------------------------------------------------------------------------
-- 4. songs (ความสัมพันธ์ artists 1 : N songs)
-- ------------------------------------------------------------------------------
-- หน้าที่: เก็บเพลงในคลัง
-- UC: UC-03 เพิ่มเพลง
-- ทำไม: ON DELETE CASCADE = ลบศิลปินแล้วเพลงของเขาถูกลบตาม ไม่เหลือเพลงกำพร้า
--       release_year เป็น NULL ได้เพราะบางเพลงไม่ทราบปี
-- ถามอาจารย์: ทำไม CHECK อยู่ใน DB ด้วย -> เป็นด่านสุดท้าย (Defense in Depth)
--             ต่อให้มีคนยิง SQL ตรงโดยไม่ผ่าน Express ก็ยังถูกปฏิเสธ
CREATE TABLE songs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  artist_id INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  duration_seconds INT NOT NULL,
  release_year SMALLINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
  UNIQUE KEY unique_song_per_artist (artist_id, title),
  CONSTRAINT chk_duration_positive CHECK (duration_seconds > 0)
);

-- ------------------------------------------------------------------------------
-- 5. playlist_songs (ตารางเชื่อม playlists M : N songs)
-- ------------------------------------------------------------------------------
-- หน้าที่: บอกว่าเพลงไหนอยู่ในเพลย์ลิสต์ไหน
-- UC: UC-06 เพิ่มเพลงเข้าเพลย์ลิสต์ / UC-07 ลบเพลงออก
-- ทำไม: ตารางสองตารางเชื่อม M:N ตรง ๆ ไม่ได้ ต้องมีตารางกลางคั่น
-- ถามอาจารย์: ลบเพลงจากคลัง -> หลุดจากทุกเพลย์ลิสต์เอง (CASCADE ที่ song_id)
--             แต่ตัวเพลย์ลิสต์ยังอยู่
CREATE TABLE playlist_songs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  playlist_id INT NOT NULL,
  song_id INT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
  UNIQUE KEY unique_song_in_playlist (playlist_id, song_id)
);
