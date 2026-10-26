// ==============================================================================
// mock-external-api.js — เซิร์ฟเวอร์จำลอง iTunes ที่ "แกล้งป่วย" ได้หลายแบบ
// ------------------------------------------------------------------------------
// หน้าที่ : ตอบ error, ตอบช้า หรือล้มบางครั้ง ตามโหมดที่เลือก เพื่อทดสอบ Retry/Timeout/Fallback
// ทำไม   : เราสั่งให้ iTunes จริงล่มหรือตอบช้า 10 วินาทีตามต้องการไม่ได้
// Sprint : 4 | Phase 2
// วิธีรัน : node scripts/mock-external-api.js <โหมด> [พอร์ต]   (พอร์ตเริ่มต้น 4000)
// โหมด    : ok     ตอบปกติทุกครั้ง
//           error  ตอบ 503 ทุกครั้ง           (ทดสอบ retry จนครบแล้ว fallback)
//           slow   ตอบช้า 10 วินาที            (ทดสอบ timeout)
//           flaky  ล้ม 2 ครั้งแล้วตอบปกติ       (ทดสอบ retry แล้วสำเร็จ)
//           bad    ตอบ 400 ทุกครั้ง            (ทดสอบว่า 4xx ไม่ retry)
// ==============================================================================

const http = require("http");

const MODES = ["ok", "error", "slow", "flaky", "bad"];
const mode = process.argv[2] || "error";
const port = Number(process.argv[3]) || 4000;

if (!MODES.includes(mode)) {
  console.error(`โหมดไม่ถูกต้อง: ${mode}  (เลือกได้: ${MODES.join(", ")})`);
  process.exit(1);
}

// หน้าที่: ข้อมูลตัวอย่างหน้าตาเหมือนที่ iTunes ตอบจริง
const SAMPLE_RESULT = {
  resultCount: 1,
  results: [
    {
      collectionName: "Mock Album",
      primaryGenreName: "Mock Genre",
      artworkUrl100: "https://example.com/artwork.jpg",
      previewUrl: "https://example.com/preview.m4a",
      trackViewUrl: "https://example.com/track",
    },
  ],
};

function sendJson(res, status, body) {
  // ทำไม: ถ้า client ตัดสายไปแล้ว (เช่น timeout) จะเขียนต่อไม่ได้ ต้องเช็คก่อน
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

let requestCount = 0; // นับคำขอทั้งหมด (ไว้ดูจำนวนครั้งที่ฝั่งเรา retry)
let flakyFailures = 0; // นับจำนวนครั้งที่ล้มต่อเนื่องในโหมด flaky

const server = http.createServer((req, res) => {
  requestCount++;
  console.log(`[mock] คำขอที่ ${requestCount} เวลา ${new Date().toISOString()} โหมด ${mode}`);

  if (mode === "ok") return sendJson(res, 200, SAMPLE_RESULT);
  if (mode === "error") return sendJson(res, 503, { error: "Service Unavailable" });
  if (mode === "bad") return sendJson(res, 400, { error: "Bad Request" });
  if (mode === "slow") {
    return setTimeout(() => sendJson(res, 200, SAMPLE_RESULT), 10000);
  }

  // โหมด flaky: ล้ม 2 ครั้งแรก ครั้งที่ 3 สำเร็จ แล้วเริ่มนับใหม่ (ทดสอบซ้ำได้โดยไม่ต้องรีสตาร์ต)
  if (flakyFailures < 2) {
    flakyFailures++;
    return sendJson(res, 503, { error: "Service Unavailable" });
  }
  flakyFailures = 0;
  return sendJson(res, 200, SAMPLE_RESULT);
});

server.listen(port, () => {
  console.log(`[mock] จำลอง iTunes โหมด "${mode}" ที่ http://localhost:${port}`);
});
