// ==============================================================================
// external-api.js — เรียก iTunes Search API พร้อม Timeout, Retry และ Fallback
// ------------------------------------------------------------------------------
// หน้าที่ : ดึงข้อมูลเสริมของเพลง (อัลบั้ม, แนวเพลง, รูปปก, ตัวอย่างเสียง) จาก iTunes
// ทำไม   : API ภายนอกเราคุมความเสถียรไม่ได้ ต้องออกแบบให้ระบบเรารอดแม้เขาล่ม
// Sprint : 4 | Phase 2
// ==============================================================================

const axios = require("axios");

// ------------------------------------------------------------------------------
// 1. ค่าตั้งต้น (อ่านจาก .env ถ้าไม่ตั้งใช้ค่า default)
// ------------------------------------------------------------------------------
// หน้าที่: อ่านเลขจาก .env ถ้าไม่ได้ตั้งหรือไม่ใช่ตัวเลขให้ใช้ค่า default
// ทำไม: การเขียน Number(x) || default ตั้งค่าเป็น 0 ไม่ได้ เพราะ 0 ถูกมองเป็นเท็จแล้วกลับไปใช้ default
//       ฟังก์ชันนี้ทำให้ตั้ง EXTERNAL_API_MAX_RETRIES=0 (ไม่ retry) ได้จริง
function numberFromEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

// ทำไม: เปลี่ยน URL ได้โดยไม่แก้โค้ด เพื่อชี้ไป mock server ตอนทดสอบความล้มเหลว
const BASE_URL = process.env.EXTERNAL_API_BASE_URL || "https://itunes.apple.com";

// ทำไม: axios ถือว่า timeout = 0 คือ "รอตลอดไป" ซึ่งอันตราย จึงบังคับให้เป็นค่าบวกเสมอ
const TIMEOUT_MS = numberFromEnv("EXTERNAL_API_TIMEOUT_MS", 3000) || 3000;

// จำนวนครั้งที่ลองใหม่ (ไม่นับครั้งแรก) 2 ครั้ง = ยิงรวมสูงสุด 3 ครั้ง
const MAX_RETRIES = numberFromEnv("EXTERNAL_API_MAX_RETRIES", 2);

// เวลาหน่วงก่อนลองใหม่ครั้งแรก (ครั้งต่อไปคูณสอง)
const RETRY_DELAY_MS = numberFromEnv("EXTERNAL_API_RETRY_DELAY_MS", 500);

// หน้าที่: ข้อมูลสำรองที่ส่งกลับเมื่อ iTunes ล่ม
const FALLBACK_INFO = {
  album: null,
  genre: "ไม่ทราบ",
  artwork_url: null,
  preview_url: null,
  track_url: null,
};

const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------------------
// 2. ควรลองใหม่ (Retry) หรือไม่
// ------------------------------------------------------------------------------
// หน้าที่: ตัดสินว่า error นี้ "มีโอกาสหายเอง" หรือไม่
// ทำไม: ลองใหม่เฉพาะเน็ตหลุด/timeout (ไม่มี response) และ 5xx (ฝั่งเขามีปัญหา)
//       ไม่ลองใหม่เมื่อเป็น 4xx เพราะคำขอเราผิดเอง ยิงอีกกี่ครั้งก็ผิดเหมือนเดิม
function isRetryable(err) {
  if (!err.response) return true;
  return err.response.status >= 500;
}

// หน้าที่: แปลง error เป็นข้อความสั้น ๆ ไว้ใช้ใน log และใน response
function describeError(err) {
  if (err.response) return `HTTP ${err.response.status}`;
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
    return `timeout เกิน ${TIMEOUT_MS} ms`;
  }
  return err.code || err.message;
}

// ------------------------------------------------------------------------------
// 3. ยิง request พร้อม Retry และ Exponential Backoff
// ------------------------------------------------------------------------------
// หน้าที่: ยิง GET ถ้าล้มเหลวและเข้าเงื่อนไข ให้รอแล้วลองใหม่ โดยรอนานขึ้นเป็นสองเท่าทุกรอบ
// ทำไม: รอนานขึ้นเรื่อย ๆ เพื่อให้เซิร์ฟเวอร์ปลายทางมีเวลาฟื้นตัว ไม่ถูกเรายิงถล่มซ้ำ
// ถามอาจารย์: รอสูงสุดนานแค่ไหน
//             -> timeout 3 วิ x 3 ครั้ง + รอ 0.5 + 1 วิ = ประมาณ 10.5 วินาทีในกรณีแย่ที่สุด
async function getWithRetry(path, params) {
  const maxAttempts = MAX_RETRIES + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await client.get(path, { params });
      console.log(`[external-api] ครั้งที่ ${attempt}/${maxAttempts} สำเร็จ`);
      return { data: response.data, attempts: attempt };
    } catch (err) {
      console.warn(
        `[external-api] ครั้งที่ ${attempt}/${maxAttempts} ล้มเหลว: ${describeError(err)}`,
      );

      // ยอมแพ้ถ้า error ไม่ควรลองใหม่ หรือลองครบโควตาแล้ว
      if (!isRetryable(err) || attempt === maxAttempts) {
        err.attempts = attempt;
        throw err;
      }

      // รอ 500 ms หลังครั้งที่ 1, 1000 ms หลังครั้งที่ 2 (RETRY_DELAY_MS x 2^(attempt-1))
      const delay = RETRY_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`[external-api] รอ ${delay} ms ก่อนลองใหม่`);
      await sleep(delay);
    }
  }
}

// ------------------------------------------------------------------------------
// 4. ฟังก์ชันหลัก: ดึงข้อมูลเพลง (ไม่โยน error เด็ดขาด)
// ------------------------------------------------------------------------------
// หน้าที่: ค้นหาเพลงใน iTunes แล้วคืนข้อมูลที่ต้องการ
// ทำไม: ฟังก์ชันนี้ "ไม่ throw" เพื่อให้ route ตอบ 200 ได้เสมอ (Graceful Fallback)
//       ข้อมูลหลักของเพลงอยู่ใน DB ของเราอยู่แล้ว ข้อมูลเสริมขาดไปไม่ควรทำให้ทั้ง request ล้ม
// ถามอาจารย์: ทำไมล้มเหลวแล้วตอบ 200 ไม่ใช่ 502/503
//             -> เพราะทรัพยากรหลัก (เพลง) ยังใช้ได้ครบ client แยกแยะได้จากฟิลด์ source: "fallback"
async function fetchTrackInfo(artistName, title) {
  try {
    const { data, attempts } = await getWithRetry("/search", {
      term: `${artistName} ${title}`,
      entity: "song",
      limit: 1,
    });

    const track = data && Array.isArray(data.results) ? data.results[0] : null;

    return {
      source: "itunes",
      attempts,
      info: track
        ? {
            album: track.collectionName || null,
            genre: track.primaryGenreName || null,
            artwork_url: track.artworkUrl100 || null,
            preview_url: track.previewUrl || null,
            track_url: track.trackViewUrl || null,
          }
        : null, // iTunes ตอบปกติแต่ไม่พบเพลงนี้
    };
  } catch (err) {
    return {
      source: "fallback",
      attempts: err.attempts,
      info: { ...FALLBACK_INFO },
      reason: describeError(err),
    };
  }
}

module.exports = { fetchTrackInfo, getWithRetry };
