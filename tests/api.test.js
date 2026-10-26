// ==============================================================================
// api.test.js — Integration Test ของ Music Library API (ยิง HTTP เข้า MySQL จริง)
// ------------------------------------------------------------------------------
// หน้าที่ : ทดสอบทุก endpoint ทั้งกรณีสำเร็จ (200/201/204) และกรณีผิดพลาด (400/404/409/500)
// ทำไม   : ยืนยันว่า use case ครบ 8 ข้อทำงานตามโจทย์ และ constraint ของ DB ถูกแปลงเป็น HTTP status ถูกต้อง
//          ใช้ฐานข้อมูล music_library_test ที่สร้างใหม่ก่อนทุก test จึงไม่กระทบข้อมูลเดโม
// Sprint : 6 | Phase 3
// ข้อมูลตั้งต้น (จาก seed.sql):
//   ศิลปิน 1 Bodyslam, 2 Three Man Down, 3 Coldplay, 4 Daft Punk
//   เพลง 1 ความเชื่อ(342) 2 ปล่อย(258) 3 ทุกอย่าง(245) 4 ยิ่งกว่าเสียใจ(268)
//        5 Yellow(269) 6 Viva La Vida(242) 7 Get Lucky(369) 8 Instant Crush(337)
//   เพลย์ลิสต์ 1 = เพลง 1,2,3,4 | 2 = เพลง 2,7 | 3 = เพลง 5,6,8
// ==============================================================================

const { useTestDatabase, resetTestDatabase } = require("./helpers/test-db");

// ต้องเรียกก่อน require("../src/index") เพื่อให้ app ต่อเข้าฐานข้อมูลทดสอบ
useTestDatabase();

// ทำไม: ไม่ยิง iTunes จริงใน test ควบคุมผลลัพธ์ได้ (การทดสอบ retry/fallback จริงอยู่ที่ external-api.test.js)
jest.mock("../src/services/external-api");

const request = require("supertest");
const app = require("../src/index");
const pool = require("../src/db");
const { fetchTrackInfo } = require("../src/services/external-api");

const JSON_TYPE = "application/json";

// ------------------------------------------------------------------------------
// 1. ตัวช่วย
// ------------------------------------------------------------------------------
// หน้าที่: ตรวจว่าเป็น error รูปแบบมาตรฐาน { error: { code, message } } พร้อม status และ code ที่ถูก
function expectError(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({ error: { code, message: expect.any(String) } });
}

const post = (url, body) => request(app).post(url).set("Content-Type", JSON_TYPE).send(body);
const put = (url, body) => request(app).put(url).set("Content-Type", JSON_TYPE).send(body);

// body เพลงที่ถูกต้อง ใช้เป็นฐานแล้วแก้ทีละฟิลด์เพื่อทดสอบ validation
const validSong = (overrides = {}) => ({
  artist_id: 1,
  title: "New Song",
  duration_seconds: 200,
  release_year: 2024,
  ...overrides,
});

afterAll(async () => {
  await pool.end(); // ปิด Connection Pool เพื่อให้ Jest จบการทำงานได้เอง ไม่ต้องใช้ --forceExit
});

// ==============================================================================
// 2. Health และการจัดการ error ส่วนกลาง
// ==============================================================================
describe("Health และ Error Handling ส่วนกลาง", () => {
  beforeAll(resetTestDatabase);

  test("GET /health -> 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });

  test("CORS: ตอบ header อนุญาตให้หน้าเว็บต่างต้นทางเรียกได้ (จำเป็นต่อ frontend)", async () => {
    const res = await request(app).get("/api/v1/artists").set("Origin", "http://localhost:5500");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  test("เส้นทางที่ไม่มีอยู่ -> 404 ROUTE_NOT_FOUND", async () => {
    expectError(await request(app).get("/api/v1/unknown"), 404, "ROUTE_NOT_FOUND");
    expectError(await request(app).delete("/health"), 404, "ROUTE_NOT_FOUND");
  });

  test("ส่ง JSON ที่พัง -> 400 INVALID_JSON (ไม่ใช่ 500)", async () => {
    const res = await request(app)
      .post("/api/v1/artists")
      .set("Content-Type", JSON_TYPE)
      .send('{"name":');
    expectError(res, 400, "INVALID_JSON");
  });

  test("DB ล่ม -> 500 INTERNAL_SERVER_ERROR และไม่เปิดเผยข้อความ error ภายในให้ client", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = jest.spyOn(pool, "query").mockRejectedValueOnce(new Error("secret-db-detail"));

    const res = await request(app).get("/api/v1/artists");

    expectError(res, 500, "INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("secret-db-detail");
    expect(errorLog).toHaveBeenCalled(); // แต่ log ไว้ที่ฝั่งเซิร์ฟเวอร์ให้นักพัฒนาตามแก้ได้

    querySpy.mockRestore();
    errorLog.mockRestore();
  });
});

// ==============================================================================
// 3. Artists
// ==============================================================================
describe("Artists — อ่าน (UC-02)", () => {
  beforeAll(resetTestDatabase);

  test("GET /artists -> 200 เรียงตามชื่อ", async () => {
    const res = await request(app).get("/api/v1/artists");
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.name)).toEqual([
      "Bodyslam",
      "Coldplay",
      "Daft Punk",
      "Three Man Down",
    ]);
  });

  test("GET /artists/1/songs -> 200 พร้อมเพลงเรียงตามปี", async () => {
    const res = await request(app).get("/api/v1/artists/1/songs");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 1, name: "Bodyslam", song_count: 2 });
    expect(res.body.data.songs.map((s) => s.title)).toEqual(["ความเชื่อ", "ปล่อย"]);
  });

  test("ศิลปินที่ไม่มีเพลง -> 200 และ song_count=0 (ต่างจากศิลปินที่ไม่มีอยู่จริง)", async () => {
    await resetTestDatabase();
    const created = await post("/api/v1/artists", { name: "No Songs Yet", country: "ไทย" });
    const res = await request(app).get(`/api/v1/artists/${created.body.data.id}/songs`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ song_count: 0, songs: [] });
  });

  test("ศิลปินที่ไม่มีอยู่จริง -> 404", async () => {
    expectError(await request(app).get("/api/v1/artists/999/songs"), 404, "NOT_FOUND");
  });

  test.each(["abc", "0", "-1", "1.5"])("id ไม่ถูกต้อง '%s' -> 400 INVALID_ID", async (id) => {
    expectError(await request(app).get(`/api/v1/artists/${id}/songs`), 400, "INVALID_ID");
  });
});

describe("Artists — เพิ่ม (UC-04)", () => {
  beforeEach(resetTestDatabase);

  test("POST /artists -> 201 พร้อมข้อมูลที่สร้าง และตัดช่องว่างหัวท้ายชื่อ", async () => {
    const res = await post("/api/v1/artists", { name: "  New Band  ", country: " UK " });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 5, name: "New Band", country: "UK" });
  });

  test("ชื่อซ้ำ -> 409 DUPLICATE_ARTIST (UNIQUE ใน DB)", async () => {
    expectError(await post("/api/v1/artists", { name: "Coldplay", country: "UK" }), 409, "DUPLICATE_ARTIST");
  });

  test("ชื่อที่ต่างกันแค่ตัวพิมพ์เล็กใหญ่ก็ถือว่าซ้ำ (collation แบบ case-insensitive)", async () => {
    expectError(await post("/api/v1/artists", { name: "coldplay", country: "UK" }), 409, "DUPLICATE_ARTIST");
  });

  test.each([
    ["ไม่มี name", { country: "UK" }],
    ["ไม่มี country", { name: "X" }],
    ["name ว่าง", { name: "", country: "UK" }],
    ["name เป็นช่องว่างล้วน", { name: "   ", country: "UK" }],
    ["name ไม่ใช่ข้อความ", { name: 123, country: "UK" }],
    ["name ยาว 121 ตัวอักษร", { name: "x".repeat(121), country: "UK" }],
    ["country ยาว 81 ตัวอักษร", { name: "X", country: "x".repeat(81) }],
    ["body ว่าง", {}],
  ])("%s -> 400 VALIDATION_ERROR", async (_label, body) => {
    expectError(await post("/api/v1/artists", body), 400, "VALIDATION_ERROR");
  });

  test("ไม่ส่ง body เลย -> 400 (ไม่ใช่ 500)", async () => {
    expectError(await request(app).post("/api/v1/artists"), 400, "VALIDATION_ERROR");
  });

  test("name ยาว 120 ตัวอักษรพอดี -> 201 (ขอบบนที่ยังรับได้)", async () => {
    const res = await post("/api/v1/artists", { name: "x".repeat(120), country: "UK" });
    expect(res.status).toBe(201);
  });
});

// ==============================================================================
// 4. Songs
// ==============================================================================
describe("Songs — อ่านและค้นหา (UC-01)", () => {
  beforeAll(resetTestDatabase);

  test("GET /songs -> 200 ทั้ง 8 เพลง เรียงตามชื่อศิลปิน", async () => {
    const res = await request(app).get("/api/v1/songs");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(8);
    const artistOrder = [...new Set(res.body.data.map((s) => s.artist_name))];
    expect(artistOrder).toEqual(["Bodyslam", "Coldplay", "Daft Punk", "Three Man Down"]);
  });

  test("ค้นหาด้วยชื่อศิลปิน ?q=cold -> เพลงของ Coldplay 2 เพลง", async () => {
    const res = await request(app).get("/api/v1/songs").query({ q: "cold" });
    expect(res.body.data.map((s) => s.title)).toEqual(["Viva La Vida", "Yellow"]);
  });

  test("ค้นหาด้วยชื่อเพลง ไม่สนตัวพิมพ์เล็กใหญ่ ?q=YELLOW -> 1 เพลง", async () => {
    const res = await request(app).get("/api/v1/songs").query({ q: "YELLOW" });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("Yellow");
  });

  test("ค้นหาภาษาไทย ?q=ความ -> เพลง 'ความเชื่อ'", async () => {
    const res = await request(app).get("/api/v1/songs").query({ q: "ความ" });
    expect(res.body.data.map((s) => s.title)).toEqual(["ความเชื่อ"]);
  });

  test("ค้นหาไม่เจอ -> 200 และ data เป็น array ว่าง", async () => {
    const res = await request(app).get("/api/v1/songs").query({ q: "ไม่มีเพลงนี้แน่นอน" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test("q ว่าง/ช่องว่างล้วน/ส่งซ้ำหลายค่า -> ถือว่าไม่ค้นหา คืนทั้งหมด", async () => {
    expect((await request(app).get("/api/v1/songs?q=")).body.data).toHaveLength(8);
    expect((await request(app).get("/api/v1/songs?q=%20%20")).body.data).toHaveLength(8);
    expect((await request(app).get("/api/v1/songs?q=a&q=b")).body.data).toHaveLength(8);
  });

  test("ความพยายาม SQL Injection ถูกมองเป็นข้อความธรรมดา ไม่ทำให้ตารางเสียหาย", async () => {
    const res = await request(app).get("/api/v1/songs").query({ q: "'; DROP TABLE songs; --" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect((await request(app).get("/api/v1/songs")).body.data).toHaveLength(8);
  });

  test("GET /songs/5 -> 200 พร้อมชื่อศิลปิน", async () => {
    const res = await request(app).get("/api/v1/songs/5");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: 5,
      title: "Yellow",
      duration_seconds: 269,
      release_year: 2000,
      artist_id: 3,
      artist_name: "Coldplay",
    });
  });

  test("GET /songs/999999 -> 404", async () => {
    expectError(await request(app).get("/api/v1/songs/999999"), 404, "NOT_FOUND");
  });

  test.each(["abc", "0", "-1", "1.5"])("GET /songs/%s -> 400 INVALID_ID", async (id) => {
    expectError(await request(app).get(`/api/v1/songs/${id}`), 400, "INVALID_ID");
  });
});

describe("Songs — ข้อมูลเสริมจาก iTunes (external-info)", () => {
  beforeAll(resetTestDatabase);
  beforeEach(() => fetchTrackInfo.mockReset());

  test("iTunes ตอบปกติ -> 200 source=itunes", async () => {
    const info = { album: "Parachutes", genre: "Alternative", artwork_url: "a", preview_url: "p", track_url: "t" };
    fetchTrackInfo.mockResolvedValue({ source: "itunes", attempts: 1, info });

    const res = await request(app).get("/api/v1/songs/5/external-info");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("สำเร็จ");
    expect(res.body.data).toMatchObject({ source: "itunes", attempts: 1, external_info: info });
    expect(res.body.data.song.title).toBe("Yellow");
    expect(fetchTrackInfo).toHaveBeenCalledWith("Coldplay", "Yellow");
  });

  test("iTunes ไม่พบเพลง -> 200 external_info=null พร้อมข้อความแจ้ง", async () => {
    fetchTrackInfo.mockResolvedValue({ source: "itunes", attempts: 1, info: null });

    const res = await request(app).get("/api/v1/songs/5/external-info");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("ไม่พบข้อมูลเพลงนี้ในบริการภายนอก");
    expect(res.body.data.external_info).toBeNull();
    expect(res.body.data.source).toBe("itunes");
  });

  test("iTunes ล่ม -> ยังตอบ 200 source=fallback พร้อมเหตุผลและจำนวนครั้งที่ลอง (Graceful Fallback)", async () => {
    const fallbackInfo = { album: null, genre: "ไม่ทราบ", artwork_url: null, preview_url: null, track_url: null };
    fetchTrackInfo.mockResolvedValue({ source: "fallback", attempts: 3, info: fallbackInfo, reason: "HTTP 503" });

    const res = await request(app).get("/api/v1/songs/5/external-info");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      source: "fallback",
      attempts: 3,
      reason: "HTTP 503",
      external_info: fallbackInfo,
    });
    expect(res.body.data.song.id).toBe(5); // ข้อมูลหลักของเพลงยังครบ
  });

  test("เพลงไม่มีอยู่ -> 404 และไม่เรียก iTunes เลย", async () => {
    expectError(await request(app).get("/api/v1/songs/999999/external-info"), 404, "NOT_FOUND");
    expect(fetchTrackInfo).not.toHaveBeenCalled();
  });

  test("id ไม่ถูกต้อง -> 400", async () => {
    expectError(await request(app).get("/api/v1/songs/abc/external-info"), 400, "INVALID_ID");
  });
});

describe("Songs — เพิ่ม (UC-03)", () => {
  beforeEach(resetTestDatabase);

  test("POST /songs -> 201 พร้อมชื่อศิลปิน และตัดช่องว่างหัวท้ายชื่อเพลง", async () => {
    const res = await post("/api/v1/songs", validSong({ title: "  New Song  " }));
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: 9,
      title: "New Song",
      duration_seconds: 200,
      release_year: 2024,
      artist_id: 1,
      artist_name: "Bodyslam",
    });
  });

  test("ไม่ส่ง release_year หรือส่ง null -> 201 และเก็บเป็น null", async () => {
    const withoutYear = validSong({ title: "No Year" });
    delete withoutYear.release_year;
    expect((await post("/api/v1/songs", withoutYear)).body.data.release_year).toBeNull();

    const nullYear = await post("/api/v1/songs", validSong({ title: "Null Year", release_year: null }));
    expect(nullYear.status).toBe(201);
    expect(nullYear.body.data.release_year).toBeNull();
  });

  test("ชื่อเพลงเดียวกันแต่คนละศิลปิน -> 201 (UNIQUE เป็นคู่ artist_id+title)", async () => {
    const res = await post("/api/v1/songs", validSong({ artist_id: 2, title: "ความเชื่อ" }));
    expect(res.status).toBe(201);
  });

  test("ศิลปินเดียวกัน ชื่อเพลงซ้ำ -> 409 DUPLICATE_SONG", async () => {
    expectError(await post("/api/v1/songs", validSong({ title: "ความเชื่อ" })), 409, "DUPLICATE_SONG");
  });

  test("artist_id ที่ไม่มีอยู่จริง -> 404 ARTIST_NOT_FOUND (FOREIGN KEY ใน DB)", async () => {
    expectError(await post("/api/v1/songs", validSong({ artist_id: 999 })), 404, "ARTIST_NOT_FOUND");
  });

  test.each([
    ["ไม่มี artist_id", { artist_id: undefined }],
    ["artist_id เป็นข้อความ", { artist_id: "1" }],
    ["artist_id เป็น 0", { artist_id: 0 }],
    ["artist_id เกินขนาด INT", { artist_id: 2147483648 }],
    ["ไม่มี title", { title: undefined }],
    ["title ว่าง", { title: "" }],
    ["title เป็นช่องว่างล้วน", { title: "   " }],
    ["title ยาว 181 ตัวอักษร", { title: "x".repeat(181) }],
    ["ไม่มี duration_seconds", { duration_seconds: undefined }],
    ["duration_seconds เป็นข้อความ", { duration_seconds: "200" }],
    ["duration_seconds เป็น 0", { duration_seconds: 0 }],
    ["duration_seconds ติดลบ", { duration_seconds: -5 }],
    ["duration_seconds ทศนิยม", { duration_seconds: 1.5 }],
    ["release_year 2 หลัก", { release_year: 99 }],
    ["release_year 5 หลัก", { release_year: 10000 }],
    ["release_year เป็นข้อความ", { release_year: "2024" }],
  ])("%s -> 400 VALIDATION_ERROR", async (_label, overrides) => {
    expectError(await post("/api/v1/songs", validSong(overrides)), 400, "VALIDATION_ERROR");
  });

  test("ไม่ส่ง body เลย -> 400", async () => {
    expectError(await request(app).post("/api/v1/songs"), 400, "VALIDATION_ERROR");
  });

  test("ขอบเขตที่ยังรับได้: title 180 ตัว, ปี 1000, ปี 9999 -> 201", async () => {
    expect((await post("/api/v1/songs", validSong({ title: "x".repeat(180) }))).status).toBe(201);
    expect((await post("/api/v1/songs", validSong({ title: "Y1000", release_year: 1000 }))).status).toBe(201);
    expect((await post("/api/v1/songs", validSong({ title: "Y9999", release_year: 9999 }))).status).toBe(201);
  });
});

describe("Songs — แก้ไข (PUT)", () => {
  beforeEach(resetTestDatabase);

  test("PUT /songs/5 -> 200 และข้อมูลเปลี่ยนจริง", async () => {
    const res = await put("/api/v1/songs/5", validSong({ artist_id: 3, title: "Yellow (Remastered)", duration_seconds: 270 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 5, title: "Yellow (Remastered)", duration_seconds: 270 });

    const check = await request(app).get("/api/v1/songs/5");
    expect(check.body.data.title).toBe("Yellow (Remastered)");
  });

  test("ย้ายเพลงไปศิลปินอื่นได้", async () => {
    const res = await put("/api/v1/songs/5", validSong({ artist_id: 4, title: "Yellow" }));
    expect(res.status).toBe(200);
    expect(res.body.data.artist_name).toBe("Daft Punk");
  });

  test("ส่งข้อมูลเหมือนเดิมทุกอย่าง -> ยัง 200 (ไม่ถูกมองเป็น 'ไม่พบเพลง')", async () => {
    const res = await put("/api/v1/songs/5", {
      artist_id: 3,
      title: "Yellow",
      duration_seconds: 269,
      release_year: 2000,
    });
    expect(res.status).toBe(200);
  });

  test("เพลงไม่มีอยู่ -> 404 NOT_FOUND", async () => {
    expectError(await put("/api/v1/songs/999999", validSong()), 404, "NOT_FOUND");
  });

  test("เปลี่ยนชื่อไปซ้ำกับเพลงอื่นของศิลปินเดียวกัน -> 409 DUPLICATE_SONG", async () => {
    expectError(await put("/api/v1/songs/2", validSong({ title: "ความเชื่อ" })), 409, "DUPLICATE_SONG");
  });

  test("artist_id ที่ไม่มีอยู่จริง -> 404 ARTIST_NOT_FOUND", async () => {
    expectError(await put("/api/v1/songs/5", validSong({ artist_id: 999, title: "Yellow" })), 404, "ARTIST_NOT_FOUND");
  });

  test("body ไม่ถูกต้อง -> 400 และไม่แตะข้อมูลเดิม", async () => {
    expectError(await put("/api/v1/songs/5", validSong({ duration_seconds: -1 })), 400, "VALIDATION_ERROR");
    expect((await request(app).get("/api/v1/songs/5")).body.data.title).toBe("Yellow");
  });

  test("id ไม่ถูกต้อง -> 400 INVALID_ID", async () => {
    expectError(await put("/api/v1/songs/abc", validSong()), 400, "INVALID_ID");
  });
});

describe("Songs — ลบ (DELETE)", () => {
  beforeEach(resetTestDatabase);

  test("DELETE /songs/5 -> 204 ไม่มี body แล้วดึงอีกครั้งได้ 404", async () => {
    const res = await request(app).delete("/api/v1/songs/5");
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expectError(await request(app).get("/api/v1/songs/5"), 404, "NOT_FOUND");
  });

  test("ลบซ้ำ / เพลงไม่มีอยู่ -> 404", async () => {
    await request(app).delete("/api/v1/songs/5");
    expectError(await request(app).delete("/api/v1/songs/5"), 404, "NOT_FOUND");
  });

  test("id ไม่ถูกต้อง -> 400", async () => {
    expectError(await request(app).delete("/api/v1/songs/abc"), 400, "INVALID_ID");
  });

  test("ON DELETE CASCADE: ลบเพลง 2 แล้วหลุดจากทุกเพลย์ลิสต์เอง แต่เพลย์ลิสต์ยังอยู่", async () => {
    // เพลง 2 อยู่ในเพลย์ลิสต์ 1 (4 เพลง) และ 2 (2 เพลง)
    await request(app).delete("/api/v1/songs/2");

    const p1 = await request(app).get("/api/v1/playlists/1");
    const p2 = await request(app).get("/api/v1/playlists/2");
    expect(p1.body.data.song_count).toBe(3);
    expect(p2.body.data.song_count).toBe(1);
    expect(p1.body.data.songs.map((s) => s.id)).not.toContain(2);
  });

  test("ON DELETE CASCADE: ลบศิลปินด้วย SQL ตรง ๆ เพลงของศิลปินหายตามและไม่มีเพลงกำพร้า", async () => {
    await pool.query("DELETE FROM artists WHERE id = 1");
    const songs = (await request(app).get("/api/v1/songs")).body.data;
    expect(songs.map((s) => s.id)).not.toContain(1);
    expect(songs.map((s) => s.id)).not.toContain(2);
    expect(songs).toHaveLength(6);
  });
});

// ==============================================================================
// 5. Playlists
// ==============================================================================
describe("Playlists — อ่าน (UC-08)", () => {
  beforeAll(resetTestDatabase);

  test("GET /playlists -> 200 พร้อม song_count ของแต่ละอัน", async () => {
    const res = await request(app).get("/api/v1/playlists");
    expect(res.status).toBe(200);
    const counts = Object.fromEntries(res.body.data.map((p) => [p.id, p.song_count]));
    expect(counts).toEqual({ 1: 4, 2: 2, 3: 3 });
  });

  test("GET /playlists/1 -> รายการเพลงเรียงตามลำดับที่ใส่ + จำนวน + ความยาวรวม", async () => {
    const res = await request(app).get("/api/v1/playlists/1");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 1,
      name: "เพลงไทยฟังชิล",
      owner_name: "สมชาย ใจดี",
      song_count: 4,
      total_duration_seconds: 342 + 258 + 245 + 268,
    });
    expect(res.body.data.songs.map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(res.body.data.songs[0]).toEqual({
      id: 1,
      title: "ความเชื่อ",
      duration_seconds: 342,
      artist_name: "Bodyslam",
    });
  });

  test("เพลย์ลิสต์ที่ไม่มีอยู่ -> 404", async () => {
    expectError(await request(app).get("/api/v1/playlists/999"), 404, "NOT_FOUND");
  });

  test("id ไม่ถูกต้อง -> 400", async () => {
    expectError(await request(app).get("/api/v1/playlists/abc"), 400, "INVALID_ID");
  });
});

describe("Playlists — สร้าง (UC-05)", () => {
  beforeEach(resetTestDatabase);

  test("POST /playlists -> 201", async () => {
    const res = await post("/api/v1/playlists", { name: "  My Mix  ", owner_name: " Alice " });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 4, name: "My Mix", owner_name: "Alice" });
  });

  test("เพลย์ลิสต์ใหม่ที่ยังว่างต้องโผล่ในรายการด้วย song_count=0 (LEFT JOIN)", async () => {
    await post("/api/v1/playlists", { name: "Empty", owner_name: "Alice" });
    const list = (await request(app).get("/api/v1/playlists")).body.data;
    const empty = list.find((p) => p.name === "Empty");
    expect(empty.song_count).toBe(0);
  });

  test("เพลย์ลิสต์ว่าง -> รายละเอียดคืน song_count=0, total=0, songs=[]", async () => {
    const created = await post("/api/v1/playlists", { name: "Empty", owner_name: "Alice" });
    const res = await request(app).get(`/api/v1/playlists/${created.body.data.id}`);
    expect(res.body.data).toMatchObject({ song_count: 0, total_duration_seconds: 0, songs: [] });
  });

  test("เจ้าของเดียวกัน ชื่อซ้ำ -> 409 DUPLICATE_PLAYLIST", async () => {
    expectError(
      await post("/api/v1/playlists", { name: "Workout Mix", owner_name: "สมหญิง รักเรียน" }),
      409,
      "DUPLICATE_PLAYLIST",
    );
  });

  test("คนละเจ้าของใช้ชื่อเดียวกันได้ -> 201", async () => {
    const res = await post("/api/v1/playlists", { name: "Workout Mix", owner_name: "คนอื่น" });
    expect(res.status).toBe(201);
  });

  test.each([
    ["ไม่มี name", { owner_name: "A" }],
    ["ไม่มี owner_name", { name: "X" }],
    ["name ว่าง", { name: "", owner_name: "A" }],
    ["owner_name เป็นช่องว่างล้วน", { name: "X", owner_name: "   " }],
    ["name ยาว 121 ตัวอักษร", { name: "x".repeat(121), owner_name: "A" }],
    ["owner_name ยาว 101 ตัวอักษร", { name: "X", owner_name: "x".repeat(101) }],
  ])("%s -> 400 VALIDATION_ERROR", async (_label, body) => {
    expectError(await post("/api/v1/playlists", body), 400, "VALIDATION_ERROR");
  });

  test("ไม่ส่ง body เลย -> 400", async () => {
    expectError(await request(app).post("/api/v1/playlists"), 400, "VALIDATION_ERROR");
  });
});

describe("Playlists — เพิ่มเพลง (UC-06)", () => {
  beforeEach(resetTestDatabase);

  test("POST /playlists/2/songs -> 201 และเพลงโผล่ในรายละเอียด", async () => {
    const res = await post("/api/v1/playlists/2/songs", { song_id: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ playlist_id: 2, song_id: 5 });

    const detail = await request(app).get("/api/v1/playlists/2");
    expect(detail.body.data.song_count).toBe(3);
    expect(detail.body.data.total_duration_seconds).toBe(258 + 369 + 269);
  });

  test("เพลงเดียวกันอยู่ได้หลายเพลย์ลิสต์ (M:N) -> เพลง 5 ใส่เพลย์ลิสต์ 1 ได้แม้อยู่ใน 3 แล้ว", async () => {
    expect((await post("/api/v1/playlists/1/songs", { song_id: 5 })).status).toBe(201);
  });

  test("เพลงที่อยู่ในเพลย์ลิสต์นี้แล้ว -> 409 DUPLICATE_PLAYLIST_SONG", async () => {
    expectError(await post("/api/v1/playlists/1/songs", { song_id: 1 }), 409, "DUPLICATE_PLAYLIST_SONG");
  });

  test("เพลงที่ไม่มีอยู่ -> 404 SONG_NOT_FOUND", async () => {
    expectError(await post("/api/v1/playlists/1/songs", { song_id: 999999 }), 404, "SONG_NOT_FOUND");
  });

  test("เพลย์ลิสต์ที่ไม่มีอยู่ -> 404 NOT_FOUND (แยกจาก SONG_NOT_FOUND ได้)", async () => {
    expectError(await post("/api/v1/playlists/999/songs", { song_id: 1 }), 404, "NOT_FOUND");
  });

  test.each([
    ["ไม่มี song_id", {}],
    ["song_id เป็นข้อความ", { song_id: "abc" }],
    ["song_id เป็นข้อความตัวเลข", { song_id: "1" }],
    ["song_id เป็น 0", { song_id: 0 }],
    ["song_id ติดลบ", { song_id: -1 }],
    ["song_id ทศนิยม", { song_id: 1.5 }],
  ])("%s -> 400 VALIDATION_ERROR", async (_label, body) => {
    expectError(await post("/api/v1/playlists/1/songs", body), 400, "VALIDATION_ERROR");
  });

  test("ไม่ส่ง body เลย -> 400", async () => {
    expectError(await request(app).post("/api/v1/playlists/1/songs"), 400, "VALIDATION_ERROR");
  });

  test("id เพลย์ลิสต์ไม่ถูกต้อง -> 400 INVALID_ID", async () => {
    expectError(await post("/api/v1/playlists/abc/songs", { song_id: 1 }), 400, "INVALID_ID");
  });
});

describe("Playlists — นำเพลงออก (UC-07)", () => {
  beforeEach(resetTestDatabase);

  test("DELETE /playlists/1/songs/1 -> 204 เพลงหลุดจากเพลย์ลิสต์แต่ยังอยู่ในคลัง", async () => {
    const res = await request(app).delete("/api/v1/playlists/1/songs/1");
    expect(res.status).toBe(204);

    const detail = await request(app).get("/api/v1/playlists/1");
    expect(detail.body.data.song_count).toBe(3);
    expect(detail.body.data.songs.map((s) => s.id)).not.toContain(1);

    // ต้นฉบับยังอยู่ และยังอยู่ในเพลย์ลิสต์อื่นด้วย (ไม่กระทบเพลย์ลิสต์อื่น)
    expect((await request(app).get("/api/v1/songs/1")).status).toBe(200);
    expect((await request(app).get("/api/v1/playlists/2")).body.data.song_count).toBe(2);
  });

  test("เพลงที่ไม่ได้อยู่ในเพลย์ลิสต์นั้น -> 404", async () => {
    expectError(await request(app).delete("/api/v1/playlists/1/songs/8"), 404, "NOT_FOUND");
  });

  test("นำออกซ้ำ -> ครั้งที่สองได้ 404", async () => {
    await request(app).delete("/api/v1/playlists/1/songs/1");
    expectError(await request(app).delete("/api/v1/playlists/1/songs/1"), 404, "NOT_FOUND");
  });

  test("ON DELETE CASCADE: ลบเพลย์ลิสต์ด้วย SQL ตรง ๆ แถวใน playlist_songs หายตาม แต่เพลงยังอยู่", async () => {
    await pool.query("DELETE FROM playlists WHERE id = 1");
    const [rows] = await pool.query("SELECT COUNT(*) AS n FROM playlist_songs WHERE playlist_id = 1");
    expect(rows[0].n).toBe(0);
    expect((await request(app).get("/api/v1/songs")).body.data).toHaveLength(8);
  });

  test.each(["/api/v1/playlists/abc/songs/1", "/api/v1/playlists/1/songs/abc"])(
    "id ไม่ถูกต้อง %s -> 400",
    async (url) => {
      expectError(await request(app).delete(url), 400, "INVALID_ID");
    },
  );
});

// ==============================================================================
// 6. Microservices
// ==============================================================================
describe("Recommendations — แนะนำเพลง", () => {
  beforeEach(resetTestDatabase);

  test("GET /recommendations/songs/2 -> 200 เพลงที่อยู่เพลย์ลิสต์เดียวกันทั้งหมด (co_playlist)", async () => {
    const res = await request(app).get("/api/v1/recommendations/songs/2");
    expect(res.status).toBe(200);
    expect(res.body.data.target_song).toMatchObject({ id: 2, title: "ปล่อย", artist_id: 1 });
    expect(res.body.data.total_recommended).toBe(4);
    expect(res.body.data.recommendations.map((r) => r.id).sort()).toEqual([1, 3, 4, 7]);
    expect(res.body.data.recommendations.every((r) => r.reason === "co_playlist")).toBe(true);
    expect(res.body.data.recommendations.every((r) => r.shared_playlists === 1)).toBe(true);
  });

  test("เรียงตามความถี่: เพลงที่อยู่ด้วยกันหลายเพลย์ลิสต์กว่าต้องมาก่อน", async () => {
    // เพลง 1 กับ 2 อยู่ด้วยกันในเพลย์ลิสต์ 1 อยู่แล้ว เพิ่มเพลง 1 เข้าเพลย์ลิสต์ 2 ด้วย -> อยู่ด้วยกัน 2 เพลย์ลิสต์
    await post("/api/v1/playlists/2/songs", { song_id: 1 });

    const res = await request(app).get("/api/v1/recommendations/songs/2");
    const first = res.body.data.recommendations[0];

    expect(first).toMatchObject({ id: 1, shared_playlists: 2, reason: "co_playlist" });
    expect(res.body.data.recommendations.slice(1).every((r) => r.shared_playlists === 1)).toBe(true);
  });

  test("ความถี่เท่ากันเรียงตามชื่อเพลง ทำให้ผลลัพธ์เหมือนเดิมทุกครั้ง", async () => {
    const first = await request(app).get("/api/v1/recommendations/songs/2");
    const second = await request(app).get("/api/v1/recommendations/songs/2");
    expect(second.body.data.recommendations).toEqual(first.body.data.recommendations);
    expect(first.body.data.recommendations[0].title).toBe("Get Lucky");
  });

  test("co_playlist ไม่พอ -> เติมเพลงศิลปินเดียวกัน (same_artist) ต่อท้าย", async () => {
    // เพลง 7 (Get Lucky) อยู่แค่เพลย์ลิสต์ 2 ร่วมกับเพลง 2 เท่านั้น
    const res = await request(app).get("/api/v1/recommendations/songs/7");
    expect(res.body.data.recommendations).toEqual([
      expect.objectContaining({ id: 2, reason: "co_playlist", shared_playlists: 1 }),
      expect.objectContaining({ id: 8, reason: "same_artist", shared_playlists: 0, artist_name: "Daft Punk" }),
    ]);
  });

  test("เพลงที่ไม่อยู่เพลย์ลิสต์ไหนเลย -> ได้เพลงศิลปินเดียวกันล้วน เรียงตามปี", async () => {
    const created = await post("/api/v1/songs", validSong({ title: "Solo Song" }));
    const res = await request(app).get(`/api/v1/recommendations/songs/${created.body.data.id}`);
    expect(res.body.data.recommendations.map((r) => [r.id, r.reason])).toEqual([
      [1, "same_artist"],
      [2, "same_artist"],
    ]);
  });

  test("เพลงเดียวของศิลปินที่ไม่อยู่เพลย์ลิสต์ไหน -> 200 และไม่มีเพลงแนะนำ", async () => {
    const artist = await post("/api/v1/artists", { name: "Lonely", country: "ไทย" });
    const song = await post("/api/v1/songs", validSong({ artist_id: artist.body.data.id, title: "Only One" }));
    const res = await request(app).get(`/api/v1/recommendations/songs/${song.body.data.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total_recommended: 0, recommendations: [] });
  });

  test("?limit=2 -> ได้ไม่เกิน 2 เพลง", async () => {
    const res = await request(app).get("/api/v1/recommendations/songs/2?limit=2");
    expect(res.body.data.recommendations).toHaveLength(2);
    expect(res.body.data.total_recommended).toBe(2);
  });

  test("ไม่ส่ง limit -> ใช้ค่า default 5", async () => {
    // เพลง 2 มีเพลงแนะนำจาก co_playlist 4 เพลง เพิ่มเพลงเข้าเพลย์ลิสต์ 1 ให้เกิน 5 เพลง
    await post("/api/v1/playlists/1/songs", { song_id: 5 });
    await post("/api/v1/playlists/1/songs", { song_id: 6 });
    const res = await request(app).get("/api/v1/recommendations/songs/2");
    expect(res.body.data.recommendations).toHaveLength(5);
  });

  test("limit=1 และ limit=20 (ขอบเขตที่ยังรับได้) -> 200", async () => {
    expect((await request(app).get("/api/v1/recommendations/songs/2?limit=1")).status).toBe(200);
    expect((await request(app).get("/api/v1/recommendations/songs/2?limit=20")).status).toBe(200);
  });

  test.each(["abc", "0", "-1", "21", "1.5", "", "1&limit=2"])(
    "limit='%s' -> 400 VALIDATION_ERROR (ไม่ปล่อยให้ SQL พังเป็น 500)",
    async (limit) => {
      const res = await request(app).get(`/api/v1/recommendations/songs/2?limit=${limit}`);
      expectError(res, 400, "VALIDATION_ERROR");
    },
  );

  test("เพลงไม่มีอยู่ -> 404", async () => {
    expectError(await request(app).get("/api/v1/recommendations/songs/999999"), 404, "NOT_FOUND");
  });

  test("id ไม่ถูกต้อง -> 400 INVALID_ID", async () => {
    expectError(await request(app).get("/api/v1/recommendations/songs/abc"), 400, "INVALID_ID");
  });
});

describe("Analytics — สถิติภาพรวม", () => {
  beforeEach(resetTestDatabase);

  test("ข้อมูลตั้งต้น: 8 เพลง 4 ศิลปิน 3 เพลย์ลิสต์ รวม 2330 วินาที (39 นาที) เฉลี่ย 291.3", async () => {
    const res = await request(app).get("/api/v1/analytics/overview");
    expect(res.status).toBe(200);
    expect(res.body.data.overview).toEqual({
      total_songs: 8,
      total_artists: 4,
      total_playlists: 3,
      total_duration_minutes: 39,
      avg_song_duration_seconds: 291.3,
    });
  });

  test("ศิลปินที่เท่ากันทุกคน (คนละ 2 เพลง) เลือกตามชื่อเรียงก่อน -> Bodyslam (ผลคงที่)", async () => {
    const res = await request(app).get("/api/v1/analytics/overview");
    expect(res.body.data.top_artist).toEqual({ id: 1, name: "Bodyslam", song_count: 2 });
  });

  test("ศิลปินที่มีเพลงมากกว่าได้เป็น top_artist", async () => {
    await post("/api/v1/songs", validSong({ artist_id: 3, title: "Clocks", duration_seconds: 307 }));
    const res = await request(app).get("/api/v1/analytics/overview");
    expect(res.body.data.top_artist).toEqual({ id: 3, name: "Coldplay", song_count: 3 });
    expect(res.body.data.overview.total_songs).toBe(9);
  });

  test("ตัวเลขเปลี่ยนตามข้อมูลจริงทันที (เพิ่มศิลปิน + ลบเพลง)", async () => {
    await post("/api/v1/artists", { name: "Brand New", country: "ไทย" });
    await request(app).delete("/api/v1/songs/7");
    const { overview } = (await request(app).get("/api/v1/analytics/overview")).body.data;
    expect(overview.total_artists).toBe(5);
    expect(overview.total_songs).toBe(7);
  });

  test("คลังว่างเปล่า -> ได้ 0 ทั้งหมด และ top_artist=null (ไม่ error)", async () => {
    await pool.query("DELETE FROM songs");
    const res = await request(app).get("/api/v1/analytics/overview");
    expect(res.status).toBe(200);
    expect(res.body.data.overview).toMatchObject({
      total_songs: 0,
      total_duration_minutes: 0,
      avg_song_duration_seconds: 0,
    });
    expect(res.body.data.top_artist).toBeNull();
  });
});

// ==============================================================================
// 7. เส้นทางข้อผิดพลาดที่ไม่คาดคิด และกรณีขอบเขตที่เหลือ
// ==============================================================================
describe("DB ล่มระหว่างเขียนข้อมูล -> 500 ทุก endpoint ที่เขียน", () => {
  // ทำไม: ทุก endpoint ที่เขียนมี try/catch ที่แปลง error ของ MySQL ที่รู้จัก (ซ้ำ, FK) เป็น 409/404
  //       error ที่ไม่รู้จักต้องถูกส่งต่อ (next) ให้ handler กลางตอบ 500 โดยไม่เปิดเผยรายละเอียดภายใน
  beforeEach(resetTestDatabase);

  test.each([
    ["POST /artists", () => post("/api/v1/artists", { name: "X", country: "Y" })],
    ["POST /songs", () => post("/api/v1/songs", validSong({ title: "Boom" }))],
    ["PUT /songs/:id", () => put("/api/v1/songs/5", validSong({ artist_id: 3, title: "Yellow" }))],
    ["POST /playlists", () => post("/api/v1/playlists", { name: "X", owner_name: "Y" })],
    ["POST /playlists/:id/songs", () => post("/api/v1/playlists/1/songs", { song_id: 5 })],
  ])("%s -> 500 และไม่เปิดเผยข้อความ error ภายใน", async (_label, send) => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(pool, "query").mockRejectedValueOnce(new Error("secret-db-detail"));

    const res = await send();

    expectError(res, 500, "INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("secret-db-detail");
    jest.restoreAllMocks();
  });
});

describe("กรณีขอบเขตที่เหลือ", () => {
  const { getRecommendedSongs } = require("../src/services/recommendation-service");
  beforeEach(resetTestDatabase);

  test("PUT ที่ไม่ส่ง release_year -> 200 และเก็บเป็น null", async () => {
    const body = validSong({ artist_id: 3, title: "Yellow" });
    delete body.release_year;
    const res = await put("/api/v1/songs/5", body);
    expect(res.status).toBe(200);
    expect(res.body.data.release_year).toBeNull();
  });

  test("เรียก getRecommendedSongs โดยไม่ส่ง limit -> ใช้ค่า default 5", async () => {
    await pool.query("INSERT INTO playlist_songs (playlist_id, song_id) VALUES (1, 5), (1, 6)");
    const result = await getRecommendedSongs(2);
    expect(result.recommendations).toHaveLength(5);
  });

  test("เรียก getRecommendedSongs กับเพลงที่ไม่มีอยู่ -> คืน null", async () => {
    await expect(getRecommendedSongs(999999)).resolves.toBeNull();
  });
});
