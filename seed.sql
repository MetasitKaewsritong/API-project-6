-- ===================================================================
-- Music Library API - seed.sql
-- ข้อมูลตัวอย่างสำหรับทดสอบ (อย่างน้อยตารางละ 3 ระเบียน)
-- ===================================================================

SET NAMES utf8mb4;

USE music_library;

-- 1. artists (4 ระเบียน)
INSERT INTO artists (name, country) VALUES
  ('Bodyslam', 'ไทย'),
  ('Three Man Down', 'ไทย'),
  ('Coldplay', 'สหราชอาณาจักร'),
  ('Daft Punk', 'ฝรั่งเศส');

-- 2. playlists (3 ระเบียน)
INSERT INTO playlists (name, owner_name) VALUES
  ('เพลงไทยฟังชิล', 'สมชาย ใจดี'),
  ('Workout Mix', 'สมหญิง รักเรียน'),
  ('เพลงสากลยุค 2000', 'สมชาย ใจดี');

-- 3. songs (8 ระเบียน) - artist_id อ้างอิงลำดับที่ INSERT ไว้ด้านบน
INSERT INTO songs (artist_id, title, duration_seconds, release_year) VALUES
  (1, 'ความเชื่อ', 342, 2004),
  (1, 'ปล่อย', 258, 2010),
  (2, 'ทุกอย่าง', 245, 2019),
  (2, 'ยิ่งกว่าเสียใจ', 268, 2021),
  (3, 'Yellow', 269, 2000),
  (3, 'Viva La Vida', 242, 2008),
  (4, 'Get Lucky', 369, 2013),
  (4, 'Instant Crush', 337, 2013);

-- 4. playlist_songs (9 ระเบียน) - เพลงเดียวกันอยู่ได้หลายเพลย์ลิสต์ (Many-to-Many)
INSERT INTO playlist_songs (playlist_id, song_id) VALUES
  (1, 1),
  (1, 2),
  (1, 3),
  (1, 4),
  (2, 2),
  (2, 7),
  (3, 5),
  (3, 6),
  (3, 8);
