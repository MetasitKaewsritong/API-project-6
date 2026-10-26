// ==============================================================================
// test-db.js — ตัวช่วยเตรียมฐานข้อมูลสำหรับทดสอบ (แยกจากฐานข้อมูลเดโม)
// ------------------------------------------------------------------------------
// หน้าที่ : สร้างฐานข้อมูล music_library_test และรีเซ็ตข้อมูลกลับเป็นข้อมูลตั้งต้นทุกครั้งที่เรียก
// ทำไม   : test ที่ทดสอบการเพิ่ม/แก้/ลบต้องเขียนข้อมูลจริง ถ้าใช้ฐานข้อมูลเดโมข้อมูลจะเละ
//          ฐานข้อมูลแยกทำให้ทดสอบได้เต็มที่ และรีเซ็ตกลับสู่ข้อมูลตั้งต้นได้ทุกเมื่อ
// Sprint : 6 | Phase 3
// ==============================================================================

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const TEST_DB_NAME = "music_library_test";
const ROOT = path.join(__dirname, "..", "..");

// ตารางทั้งหมด เรียงจากลูกไปแม่ (ใช้ตอนล้างข้อมูล ต้องลบลูกก่อนแม่เสมอ)
const TABLES = ["playlist_songs", "songs", "playlists", "artists"];

// หน้าที่: แทนที่ชื่อฐานข้อมูลเดโมในไฟล์ SQL ด้วยชื่อฐานข้อมูลทดสอบ
// ทำไม: schema.sql และ seed.sql เขียนชื่อ music_library ไว้ จึงต้องแทนที่ก่อนรัน
//       ทำให้คำสั่ง DROP TABLE ใน schema.sql ไม่มีทางไปโดนข้อมูลเดโม
const toTestDb = (sql) => sql.replace(/music_library/g, TEST_DB_NAME);

// ------------------------------------------------------------------------------
// 1. ชี้ฐานข้อมูลของแอปไปที่ฐานข้อมูลทดสอบ
// ------------------------------------------------------------------------------
// ต้องเรียกฟังก์ชันนี้ก่อน require("../src/index") เสมอ
// ทำไม: src/db.js อ่านชื่อฐานข้อมูลจาก process.env.DB_NAME ตอนถูก require
//       dotenv ไม่เขียนทับตัวแปรที่ตั้งไว้แล้ว ค่าที่เราตั้งตรงนี้จึงชนะค่าใน .env
function useTestDatabase() {
  // ทำไม: dotenv รุ่นใหม่พิมพ์ข้อความทุกครั้งที่โหลด ปิดไว้ไม่ให้รบกวนผลทดสอบ
  process.env.DOTENV_CONFIG_QUIET = "true";
  require("dotenv").config();
  process.env.DB_NAME = TEST_DB_NAME;
}

// ------------------------------------------------------------------------------
// 2. รีเซ็ตฐานข้อมูลทดสอบกลับเป็นข้อมูลตั้งต้น
// ------------------------------------------------------------------------------
// หน้าที่: ครั้งแรก (ต่อหนึ่งรอบการรัน test) สร้างตารางด้วย schema.sql
//          ครั้งต่อ ๆ ไปล้างข้อมูลทุกตาราง รีเซ็ตตัวนับ id แล้ว seed ใหม่
// ทำไม: วัดจริงแล้วเลือกวิธีที่เร็วที่สุด (ราว 107 ms ต่อครั้ง)
//       - DROP/CREATE หรือ TRUNCATE ทุกครั้งช้า (ราว 560 ms) เพราะเป็นคำสั่งแก้โครงสร้างตาราง
//       - DELETE เป็นคำสั่งแก้ข้อมูลธรรมดา เร็วกว่ามาก และการรวมเป็นธุรกรรมเดียวทำให้เขียนดิสก์ครั้งเดียว
//       - ALTER TABLE ... AUTO_INCREMENT = 1 รีเซ็ตตัวนับ id ให้ข้อมูลใหม่ได้ id เดิมทุกครั้ง
//         (เช่น ศิลปินที่เพิ่มใหม่ได้ id 5 เสมอ) test จึงตรวจค่า id ตรง ๆ ได้
// ถามอาจารย์: ทำไมต้อง multipleStatements -> ไฟล์ SQL มีหลายคำสั่งในไฟล์เดียว
//             ปกติ mysql2 ยอมรับทีละคำสั่งเพื่อกัน SQL Injection จึงเปิดเฉพาะการเชื่อมต่อนี้
let schemaCreated = false;

async function resetTestDatabase() {
  const seedSql = toTestDb(fs.readFileSync(path.join(ROOT, "seed.sql"), "utf8"));

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });
  try {
    if (!schemaCreated) {
      const schemaSql = toTestDb(fs.readFileSync(path.join(ROOT, "schema.sql"), "utf8"));
      await connection.query(schemaSql);
      schemaCreated = true;
    } else {
      await connection.query(`USE ${TEST_DB_NAME}`);

      await connection.query("START TRANSACTION");
      for (const table of TABLES) {
        await connection.query(`DELETE FROM ${table}`);
      }
      await connection.query("COMMIT");

      for (const table of TABLES) {
        await connection.query(`ALTER TABLE ${table} AUTO_INCREMENT = 1`);
      }
    }

    await connection.query("START TRANSACTION");
    await connection.query(seedSql);
    await connection.query("COMMIT");
  } finally {
    await connection.end();
  }
}

module.exports = { TEST_DB_NAME, useTestDatabase, resetTestDatabase };
