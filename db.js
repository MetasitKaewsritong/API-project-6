// เวอร์ชัน promise ของ mysql2 เพื่อให้ใช้ async/await กับ query ได้
const mysql = require("mysql2/promise");

// createPool: สร้าง "แหล่งรวมการเชื่อมต่อ" ไว้ล่วงหน้าแล้วหมุนเวียนใช้ซ้ำ
// ต่างจาก createConnection ที่ต้อง handshake ใหม่ทุกคำขอ (ช้าและเปลืองทรัพยากร)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true, // ถ้าการเชื่อมต่อถูกใช้หมด ให้รอคิว (ไม่ throw error ทันที)
  connectionLimit: 10, // เปิดการเชื่อมต่อพร้อมกันได้สูงสุด 10
  queueLimit: 0, // 0 = ไม่จำกัดจำนวนคำขอที่รอคิวได้
});

module.exports = pool;
