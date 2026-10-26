// ==============================================================================
// build-postman-collection.js — สร้าง postman_collection.json จากการยิง API จริง
// ------------------------------------------------------------------------------
// หน้าที่ : ยิงทุก endpoint ตามลำดับ (ทั้งกรณีสำเร็จและผิดพลาด) แล้วเก็บ response จริงเป็นตัวอย่างใน Postman
// ทำไม   : ตัวอย่างใน collection มาจากระบบจริง 100% ไม่ใช่ข้อมูลที่พิมพ์เอง และสร้างใหม่ได้ด้วยคำสั่งเดียว
// Sprint : 8 | Phase 2
// วิธีรัน : ต้องเปิด MySQL และ API ที่เพิ่ง seed ใหม่ (ลำดับ id ในสคริปต์อ้างตามข้อมูล seed)
//           node scripts/build-postman-collection.js            (ยิงที่ http://localhost:3100)
//           BASE_URL=http://localhost:3199 node scripts/build-postman-collection.js
// ==============================================================================

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.BASE_URL || "http://localhost:3100";
const OUTPUT_FILE = path.join(__dirname, "..", "postman_collection.json");

// ------------------------------------------------------------------------------
// 1. ตัวช่วยสร้างโครงสร้างของ Postman Collection (รูปแบบ v2.1)
// ------------------------------------------------------------------------------
// หน้าที่: แปลง path เช่น "/api/v1/songs?q=cold" เป็นอ็อบเจกต์ url ที่ Postman ต้องการ
function buildUrl(urlPath) {
  const [pathPart, queryPart] = urlPath.split("?");
  const url = {
    raw: `{{baseUrl}}${urlPath}`,
    host: ["{{baseUrl}}"],
    path: pathPart.split("/").filter(Boolean),
  };
  if (queryPart) {
    url.query = queryPart.split("&").map((pair) => {
      const [key, value] = pair.split("=");
      return { key, value: decodeURIComponent(value ?? "") };
    });
  }
  return url;
}

function buildRequest(method, urlPath, body) {
  const request = { method, header: [], url: buildUrl(urlPath) };
  if (body !== undefined) {
    request.header.push({ key: "Content-Type", value: "application/json" });
    request.body = {
      mode: "raw",
      raw: typeof body === "string" ? body : JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  return request;
}

// ------------------------------------------------------------------------------
// 2. ยิง request จริงแล้วเก็บผลเป็นตัวอย่าง (example response)
// ------------------------------------------------------------------------------
const folders = new Map(); // ชื่อโฟลเดอร์ -> รายการ request
let failures = 0;

// หน้าที่: ยิง request หนึ่งครั้ง ตรวจว่าได้ status ตามที่คาด แล้วเก็บเข้าโฟลเดอร์
// คืนค่า: body ที่แปลงเป็น JSON แล้ว (หรือ null) ให้ขั้นต่อไปหยิบ id ที่เพิ่งสร้างไปใช้
async function step(folder, name, method, urlPath, expectedStatus, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(BASE_URL + urlPath, options);
  const text = await response.text();
  const prettyBody = text ? JSON.stringify(JSON.parse(text), null, 2) : "";

  const ok = response.status === expectedStatus;
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${method.padEnd(6)} ${urlPath}  -> ${response.status} (คาด ${expectedStatus})`);

  const request = buildRequest(method, urlPath, body);
  const item = {
    name,
    request,
    response: [
      {
        name: `HTTP ${response.status}`,
        originalRequest: request,
        status: response.statusText || String(response.status),
        code: response.status,
        _postman_previewlanguage: "json",
        header: text ? [{ key: "Content-Type", value: "application/json; charset=utf-8" }] : [],
        body: prettyBody,
      },
    ],
  };
  if (!folders.has(folder)) folders.set(folder, []);
  folders.get(folder).push(item);

  return text ? JSON.parse(text) : null;
}

// ------------------------------------------------------------------------------
// 3. ลำดับการยิง (ครบทั้ง 17 endpoint ทั้งกรณีสำเร็จและผิดพลาด)
// ------------------------------------------------------------------------------
async function run() {
  const API = "/api/v1";
  const tag = Date.now().toString().slice(-6); // ทำให้ชื่อที่สร้างใหม่ไม่ซ้ำกับรอบก่อน ๆ

  // --- Health
  await step("Health", "ตรวจสถานะเซิร์ฟเวอร์", "GET", "/health", 200);

  // --- Artists
  await step("Artists", "รายชื่อศิลปินทั้งหมด", "GET", `${API}/artists`, 200);
  const artist = await step("Artists", "เพิ่มศิลปิน (UC-04)", "POST", `${API}/artists`, 201, {
    name: `Postman Artist ${tag}`,
    country: "ไทย",
  });
  const artistId = artist.data.id;
  await step("Artists", "เพิ่มศิลปินซ้ำ (409)", "POST", `${API}/artists`, 409, {
    name: `Postman Artist ${tag}`,
    country: "ไทย",
  });
  await step("Artists", "เพิ่มศิลปินโดยไม่ส่งชื่อ (400)", "POST", `${API}/artists`, 400, { country: "ไทย" });
  await step("Artists", "ส่ง JSON พัง (400 INVALID_JSON)", "POST", `${API}/artists`, 400, '{"name":');
  await step("Artists", "เพลงทั้งหมดของศิลปิน (UC-02)", "GET", `${API}/artists/1/songs`, 200);
  await step("Artists", "ศิลปินที่ไม่มีอยู่ (404)", "GET", `${API}/artists/999/songs`, 404);
  await step("Artists", "id ไม่ถูกต้อง (400)", "GET", `${API}/artists/abc/songs`, 400);

  // --- Songs
  await step("Songs", "รายการเพลงทั้งหมด", "GET", `${API}/songs`, 200);
  await step("Songs", "ค้นหาเพลง (UC-01)", "GET", `${API}/songs?q=cold`, 200);
  await step("Songs", "รายละเอียดเพลง", "GET", `${API}/songs/5`, 200);
  await step("Songs", "เพลงที่ไม่มีอยู่ (404)", "GET", `${API}/songs/999999`, 404);
  await step("Songs", "id ไม่ถูกต้อง (400)", "GET", `${API}/songs/abc`, 400);
  const song = await step("Songs", "เพิ่มเพลง (UC-03)", "POST", `${API}/songs`, 201, {
    artist_id: artistId,
    title: "Postman Song",
    duration_seconds: 200,
    release_year: 2024,
  });
  const songId = song.data.id;
  await step("Songs", "เพิ่มเพลงซ้ำ (409)", "POST", `${API}/songs`, 409, {
    artist_id: artistId,
    title: "Postman Song",
    duration_seconds: 200,
  });
  await step("Songs", "ข้อมูลไม่ถูกต้อง duration ติดลบ (400)", "POST", `${API}/songs`, 400, {
    artist_id: artistId,
    title: "Bad",
    duration_seconds: -5,
  });
  await step("Songs", "ศิลปินที่ไม่มีอยู่ (404)", "POST", `${API}/songs`, 404, {
    artist_id: 999,
    title: "Ghost",
    duration_seconds: 100,
  });
  await step("Songs", "แก้ไขเพลง", "PUT", `${API}/songs/${songId}`, 200, {
    artist_id: artistId,
    title: "Postman Song (Edited)",
    duration_seconds: 210,
    release_year: 2025,
  });
  await step("Songs", "แก้ไขเพลงที่ไม่มีอยู่ (404)", "PUT", `${API}/songs/999999`, 404, {
    artist_id: artistId,
    title: "X",
    duration_seconds: 100,
  });
  await step("Songs", "ข้อมูลเสริมจาก iTunes", "GET", `${API}/songs/5/external-info`, 200);

  // --- Playlists
  await step("Playlists", "รายการเพลย์ลิสต์ทั้งหมด", "GET", `${API}/playlists`, 200);
  const playlist = await step("Playlists", "สร้างเพลย์ลิสต์ (UC-05)", "POST", `${API}/playlists`, 201, {
    name: `Postman Mix ${tag}`,
    owner_name: "Postman Tester",
  });
  const playlistId = playlist.data.id;
  await step("Playlists", "สร้างเพลย์ลิสต์ชื่อซ้ำ (409)", "POST", `${API}/playlists`, 409, {
    name: `Postman Mix ${tag}`,
    owner_name: "Postman Tester",
  });
  await step("Playlists", "สร้างเพลย์ลิสต์โดยไม่ส่งเจ้าของ (400)", "POST", `${API}/playlists`, 400, { name: "X" });
  await step("Playlists", "รายละเอียดเพลย์ลิสต์ (UC-08)", "GET", `${API}/playlists/1`, 200);
  await step("Playlists", "เพลย์ลิสต์ที่ไม่มีอยู่ (404)", "GET", `${API}/playlists/999`, 404);
  await step("Playlists", "เพิ่มเพลงเข้าเพลย์ลิสต์ (UC-06)", "POST", `${API}/playlists/${playlistId}/songs`, 201, {
    song_id: songId,
  });
  await step("Playlists", "เพิ่มเพลงซ้ำ (409)", "POST", `${API}/playlists/${playlistId}/songs`, 409, { song_id: songId });
  await step("Playlists", "เพิ่มเพลงที่ไม่มีอยู่ (404 SONG_NOT_FOUND)", "POST", `${API}/playlists/${playlistId}/songs`, 404, {
    song_id: 999999,
  });
  await step("Playlists", "song_id ไม่ถูกต้อง (400)", "POST", `${API}/playlists/${playlistId}/songs`, 400, {
    song_id: "abc",
  });
  await step("Playlists", "นำเพลงออกจากเพลย์ลิสต์ (UC-07)", "DELETE", `${API}/playlists/${playlistId}/songs/${songId}`, 204);
  await step("Playlists", "นำออกซ้ำ (404)", "DELETE", `${API}/playlists/${playlistId}/songs/${songId}`, 404);

  // --- Microservices
  await step("Microservices", "แนะนำเพลง", "GET", `${API}/recommendations/songs/2`, 200);
  await step("Microservices", "แนะนำเพลง กำหนด limit", "GET", `${API}/recommendations/songs/2?limit=2`, 200);
  await step("Microservices", "limit ไม่ถูกต้อง (400)", "GET", `${API}/recommendations/songs/2?limit=abc`, 400);
  await step("Microservices", "แนะนำเพลงที่ไม่มีอยู่ (404)", "GET", `${API}/recommendations/songs/999999`, 404);
  await step("Microservices", "สถิติภาพรวม", "GET", `${API}/analytics/overview`, 200);

  // --- ลบเพลงทดสอบท้ายสุด (ทำไว้ท้ายเพราะต้องใช้เพลงนี้ในขั้นตอนเพลย์ลิสต์ก่อน)
  await step("Songs", "ลบเพลง", "DELETE", `${API}/songs/${songId}`, 204);
  await step("Songs", "ลบเพลงซ้ำ (404)", "DELETE", `${API}/songs/${songId}`, 404);
}

// ------------------------------------------------------------------------------
// 4. เขียนไฟล์ collection
// ------------------------------------------------------------------------------
run()
  .then(() => {
    const collection = {
      info: {
        name: "Music Library API",
        description:
          "ตัวอย่าง request/response จริงของทุก endpoint (17 เส้น) สร้างโดย scripts/build-postman-collection.js " +
          "แนะนำให้รันบนฐานข้อมูลที่เพิ่ง seed ใหม่ เรียงตามลำดับในแต่ละโฟลเดอร์",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [{ key: "baseUrl", value: "http://localhost:3100" }],
      item: [...folders.entries()].map(([name, item]) => ({ name, item })),
    };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(collection, null, 2) + "\n", "utf8");

    const total = [...folders.values()].reduce((sum, items) => sum + items.length, 0);
    console.log(`\nเขียน ${path.basename(OUTPUT_FILE)} แล้ว: ${total} request ใน ${folders.size} โฟลเดอร์`);
    if (failures > 0) {
      console.error(`มี ${failures} request ที่ได้ status ไม่ตรงที่คาด (ตรวจว่าฐานข้อมูลเพิ่ง seed ใหม่)`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("ล้มเหลว:", err.message);
    process.exit(1);
  });
