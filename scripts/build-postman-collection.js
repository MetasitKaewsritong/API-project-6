// ยิง request จริงทุก endpoint แล้วเขียน postman_collection.json
// ต้องรันกับฐานข้อมูลที่เพิ่ง seed ใหม่ เพราะตัวอย่างอ้าง id ตาม seed.sql
//
// FALLBACK_BASE_URL: API อีกตัวที่ชี้ไป API ภายนอกที่ล่ม ใช้เก็บตัวอย่าง fallback
// ERROR_BASE_URL:    API อีกตัวที่ต่อฐานข้อมูลไม่ได้ ใช้เก็บตัวอย่าง 500

const fs = require("fs");
const path = require("path");

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3100";
const FALLBACK_BASE_URL = process.env.FALLBACK_BASE_URL || "";
const ERROR_BASE_URL = process.env.ERROR_BASE_URL || "";

const STATUS_TEXT = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  404: "Not Found",
  409: "Conflict",
  500: "Internal Server Error",
};

function toPostmanRequest({ method, url, body, rawBody }) {
  const [pathname, queryString] = url.split("?");
  const request = {
    method,
    header: [],
    url: {
      raw: `{{baseUrl}}${url}`,
      host: ["{{baseUrl}}"],
      path: pathname.split("/").filter(Boolean),
    },
  };

  if (queryString) {
    request.url.query = queryString.split("&").map((pair) => {
      const [key, value] = pair.split("=");
      return { key, value: decodeURIComponent(value) };
    });
  }

  if (body !== undefined || rawBody !== undefined) {
    request.header.push({ key: "Content-Type", value: "application/json" });
    request.body = {
      mode: "raw",
      raw: rawBody !== undefined ? rawBody : JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  return request;
}

async function capture(name, spec, baseUrl = API_BASE_URL) {
  const options = { method: spec.method, headers: {} };
  if (spec.body !== undefined || spec.rawBody !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body =
      spec.rawBody !== undefined ? spec.rawBody : JSON.stringify(spec.body);
  }

  const response = await fetch(baseUrl + spec.url, options);
  const text = await response.text();

  let prettyBody = text;
  try {
    prettyBody = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // 204 ไม่มี body
  }

  console.log(`${response.status} ${spec.method} ${spec.url}  (${name})`);

  const contentType = response.headers.get("content-type");
  return {
    name,
    originalRequest: toPostmanRequest(spec),
    status: STATUS_TEXT[response.status] || String(response.status),
    code: response.status,
    _postman_previewlanguage: contentType ? "json" : "text",
    header: contentType ? [{ key: "Content-Type", value: contentType }] : [],
    cookie: [],
    body: prettyBody,
  };
}

// examples[0] ถูกใช้เป็น request หลักของรายการนั้นใน Postman
async function buildItem(name, description, examples) {
  const responses = [];
  for (const example of examples) {
    responses.push(
      await capture(example.name, example, example.baseUrl || API_BASE_URL),
    );
  }
  return {
    name,
    request: { ...toPostmanRequest(examples[0]), description },
    response: responses,
  };
}

async function main() {
  const health = [
    await buildItem("ตรวจสถานะเซิร์ฟเวอร์", "ตรวจว่าเซิร์ฟเวอร์ทำงานอยู่", [
      { name: "200 พร้อมใช้งาน", method: "GET", url: "/health" },
    ]),
  ];

  const artists = [
    await buildItem("รายชื่อศิลปินทั้งหมด", "คืนศิลปินทุกคนเรียงตามชื่อ", [
      { name: "200 สำเร็จ", method: "GET", url: "/api/v1/artists" },
    ]),
    await buildItem(
      "เพิ่มศิลปินใหม่",
      "UC-04 ชื่อศิลปินต้องไม่ซ้ำกับที่มีอยู่",
      [
        {
          name: "201 เพิ่มสำเร็จ",
          method: "POST",
          url: "/api/v1/artists",
          body: { name: "Radiohead", country: "สหราชอาณาจักร" },
        },
        {
          name: "400 ข้อมูลไม่ครบ",
          method: "POST",
          url: "/api/v1/artists",
          body: { name: "Oasis" },
        },
        {
          name: "400 JSON ผิดรูปแบบ",
          method: "POST",
          url: "/api/v1/artists",
          rawBody: '{ "name": "Oasis", ',
        },
        {
          name: "409 ชื่อซ้ำ",
          method: "POST",
          url: "/api/v1/artists",
          body: { name: "Bodyslam", country: "ไทย" },
        },
      ],
    ),
    await buildItem(
      "เพลงทั้งหมดของศิลปิน",
      "UC-02 คืนข้อมูลศิลปินพร้อมรายการเพลง",
      [
        { name: "200 สำเร็จ", method: "GET", url: "/api/v1/artists/3/songs" },
        {
          name: "400 id ไม่ถูกต้อง",
          method: "GET",
          url: "/api/v1/artists/abc/songs",
        },
        {
          name: "404 ไม่พบศิลปิน",
          method: "GET",
          url: "/api/v1/artists/999/songs",
        },
      ],
    ),
  ];

  const songs = [
    await buildItem("รายการเพลงทั้งหมด", "คืนเพลงทั้งหมดพร้อมชื่อศิลปิน", [
      { name: "200 สำเร็จ", method: "GET", url: "/api/v1/songs" },
      ...(ERROR_BASE_URL
        ? [
            {
              name: "500 เชื่อมต่อฐานข้อมูลไม่ได้",
              method: "GET",
              url: "/api/v1/songs",
              baseUrl: ERROR_BASE_URL,
            },
          ]
        : []),
    ]),
    await buildItem(
      "ค้นหาเพลง",
      "UC-01 ค้นจากชื่อเพลงหรือชื่อศิลปินด้วย query string q",
      [
        { name: "200 พบเพลง", method: "GET", url: "/api/v1/songs?q=Coldplay" },
        {
          name: "200 ไม่พบเพลงที่ตรง",
          method: "GET",
          url: "/api/v1/songs?q=zzzzz",
        },
      ],
    ),
    await buildItem("รายละเอียดเพลง", "คืนข้อมูลเพลงหนึ่งเพลง", [
      { name: "200 สำเร็จ", method: "GET", url: "/api/v1/songs/5" },
      { name: "400 id ไม่ถูกต้อง", method: "GET", url: "/api/v1/songs/abc" },
      { name: "404 ไม่พบเพลง", method: "GET", url: "/api/v1/songs/999" },
    ]),
    await buildItem(
      "เพิ่มเพลงใหม่",
      "UC-03 ศิลปินต้องมีอยู่จริง และศิลปินคนเดียวกันมีเพลงชื่อซ้ำไม่ได้",
      [
        {
          name: "201 เพิ่มสำเร็จ",
          method: "POST",
          url: "/api/v1/songs",
          body: {
            artist_id: 3,
            title: "Fix You",
            duration_seconds: 295,
            release_year: 2005,
          },
        },
        {
          name: "400 ชื่อเพลงยาวเกิน 180 ตัวอักษร",
          method: "POST",
          url: "/api/v1/songs",
          body: { artist_id: 3, title: "ก".repeat(181), duration_seconds: 200 },
        },
        {
          name: "400 ความยาวเพลงติดลบ",
          method: "POST",
          url: "/api/v1/songs",
          body: { artist_id: 3, title: "The Scientist", duration_seconds: -5 },
        },
        {
          name: "404 ไม่พบศิลปิน",
          method: "POST",
          url: "/api/v1/songs",
          body: { artist_id: 999, title: "Unknown", duration_seconds: 200 },
        },
        {
          name: "409 เพลงชื่อซ้ำ",
          method: "POST",
          url: "/api/v1/songs",
          body: {
            artist_id: 3,
            title: "Yellow",
            duration_seconds: 269,
            release_year: 2000,
          },
        },
      ],
    ),
    await buildItem(
      "แก้ไขเพลง",
      "แก้ไขข้อมูลเพลงทั้งระเบียน (เพลง id 9 คือเพลงที่เพิ่งเพิ่มในรายการก่อนหน้า)",
      [
        {
          name: "200 แก้ไขสำเร็จ",
          method: "PUT",
          url: "/api/v1/songs/9",
          body: {
            artist_id: 3,
            title: "Fix You (Live)",
            duration_seconds: 312,
            release_year: 2006,
          },
        },
        {
          name: "400 ไม่มี title",
          method: "PUT",
          url: "/api/v1/songs/9",
          body: { artist_id: 3, duration_seconds: 312 },
        },
        {
          name: "404 ไม่พบเพลง",
          method: "PUT",
          url: "/api/v1/songs/999",
          body: { artist_id: 3, title: "Fix You", duration_seconds: 295 },
        },
        {
          name: "404 ไม่พบศิลปิน",
          method: "PUT",
          url: "/api/v1/songs/9",
          body: { artist_id: 999, title: "Fix You", duration_seconds: 295 },
        },
        {
          name: "409 เพลงชื่อซ้ำ",
          method: "PUT",
          url: "/api/v1/songs/9",
          body: { artist_id: 3, title: "Yellow", duration_seconds: 269 },
        },
      ],
    ),
    await buildItem(
      "ลบเพลง",
      "ลบเพลงออกจากคลัง เพลงจะหลุดจากทุกเพลย์ลิสต์อัตโนมัติ",
      [
        { name: "204 ลบสำเร็จ", method: "DELETE", url: "/api/v1/songs/9" },
        {
          name: "400 id ไม่ถูกต้อง",
          method: "DELETE",
          url: "/api/v1/songs/abc",
        },
        { name: "404 ไม่พบเพลง", method: "DELETE", url: "/api/v1/songs/9" },
      ],
    ),
  ];

  const externalExamples = [
    {
      name: "200 ได้ข้อมูลจาก iTunes",
      method: "GET",
      url: "/api/v1/songs/5/external-info",
    },
    {
      name: "400 id ไม่ถูกต้อง",
      method: "GET",
      url: "/api/v1/songs/abc/external-info",
    },
    {
      name: "404 ไม่พบเพลง",
      method: "GET",
      url: "/api/v1/songs/999/external-info",
    },
  ];
  if (FALLBACK_BASE_URL) {
    externalExamples.splice(1, 0, {
      name: "200 iTunes ล้มเหลว ใช้ค่าเริ่มต้น (fallback)",
      method: "GET",
      url: "/api/v1/songs/5/external-info",
      baseUrl: FALLBACK_BASE_URL,
    });
  }
  const external = [
    await buildItem(
      "ข้อมูลเสริมของเพลงจาก iTunes",
      "เรียก iTunes Search API พร้อม timeout, retry และ fallback ดูที่มาของข้อมูลจาก data.source",
      externalExamples,
    ),
  ];

  const playlists = [
    await buildItem("เพลย์ลิสต์ทั้งหมด", "คืนเพลย์ลิสต์ทุกรายการพร้อมจำนวนเพลง", [
      { name: "200 สำเร็จ", method: "GET", url: "/api/v1/playlists" },
    ]),
    await buildItem(
      "สร้างเพลย์ลิสต์",
      "UC-05 เจ้าของคนเดียวกันตั้งชื่อเพลย์ลิสต์ซ้ำไม่ได้",
      [
        {
          name: "201 สร้างสำเร็จ",
          method: "POST",
          url: "/api/v1/playlists",
          body: { name: "เพลงอ่านหนังสือ", owner_name: "สมหญิง รักเรียน" },
        },
        {
          name: "400 ข้อมูลไม่ครบ",
          method: "POST",
          url: "/api/v1/playlists",
          body: { name: "เพลงอ่านหนังสือ" },
        },
        {
          name: "409 ชื่อซ้ำ",
          method: "POST",
          url: "/api/v1/playlists",
          body: { name: "Workout Mix", owner_name: "สมหญิง รักเรียน" },
        },
      ],
    ),
    await buildItem(
      "รายละเอียดเพลย์ลิสต์",
      "UC-08 คืนรายชื่อเพลง จำนวนเพลง และความยาวรวม",
      [
        { name: "200 สำเร็จ", method: "GET", url: "/api/v1/playlists/1" },
        {
          name: "400 id ไม่ถูกต้อง",
          method: "GET",
          url: "/api/v1/playlists/abc",
        },
        {
          name: "404 ไม่พบเพลย์ลิสต์",
          method: "GET",
          url: "/api/v1/playlists/999",
        },
      ],
    ),
    await buildItem(
      "เพิ่มเพลงเข้าเพลย์ลิสต์",
      "UC-06 เพลงเดิมเพิ่มซ้ำในเพลย์ลิสต์เดียวกันไม่ได้",
      [
        {
          name: "201 เพิ่มสำเร็จ",
          method: "POST",
          url: "/api/v1/playlists/2/songs",
          body: { song_id: 5 },
        },
        {
          name: "400 ไม่มี song_id",
          method: "POST",
          url: "/api/v1/playlists/2/songs",
          body: {},
        },
        {
          name: "404 ไม่พบเพลย์ลิสต์",
          method: "POST",
          url: "/api/v1/playlists/999/songs",
          body: { song_id: 5 },
        },
        {
          name: "404 ไม่พบเพลง",
          method: "POST",
          url: "/api/v1/playlists/2/songs",
          body: { song_id: 999 },
        },
        {
          name: "409 เพลงอยู่ในเพลย์ลิสต์แล้ว",
          method: "POST",
          url: "/api/v1/playlists/2/songs",
          body: { song_id: 5 },
        },
      ],
    ),
    await buildItem(
      "ลบเพลงออกจากเพลย์ลิสต์",
      "UC-07 ลบเฉพาะความเชื่อมโยง ข้อมูลเพลงในคลังยังอยู่",
      [
        {
          name: "204 ลบสำเร็จ",
          method: "DELETE",
          url: "/api/v1/playlists/2/songs/5",
        },
        {
          name: "400 id ไม่ถูกต้อง",
          method: "DELETE",
          url: "/api/v1/playlists/2/songs/abc",
        },
        {
          name: "404 ไม่พบเพลงนี้ในเพลย์ลิสต์",
          method: "DELETE",
          url: "/api/v1/playlists/2/songs/5",
        },
      ],
    ),
  ];

  const collection = {
    info: {
      name: "Music Library API - 67160005",
      description:
        "โครงงานระยะที่ 2 | ระบบข้อมูลเพลง (Pno 6)\n\n" +
        "ตัวอย่าง response ทุกรายการบันทึกจากการยิง request จริงไปยังระบบ " +
        "โดยเริ่มจากฐานข้อมูลหลังรัน schema.sql และ seed.sql " +
        "ควรรันเรียงจากบนลงล่าง เพราะรายการแก้ไข/ลบใช้ข้อมูลที่รายการก่อนหน้าสร้างไว้",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [{ key: "baseUrl", value: API_BASE_URL }],
    item: [
      { name: "Health", item: health },
      { name: "Artists", item: artists },
      { name: "Songs", item: songs },
      { name: "External", item: external },
      { name: "Playlists", item: playlists },
    ],
  };

  const outputPath = path.join(__dirname, "..", "postman_collection.json");
  fs.writeFileSync(outputPath, JSON.stringify(collection, null, 2) + "\n");
  console.log(`\nบันทึกแล้ว: ${outputPath}`);
}

main().catch((err) => {
  console.error("สร้าง collection ไม่สำเร็จ:", err.message);
  process.exit(1);
});
