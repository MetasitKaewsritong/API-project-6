// ==============================================================================
// external-api.test.js — ทดสอบ Timeout, Retry, Backoff และ Fallback ของ external-api.js
// ------------------------------------------------------------------------------
// หน้าที่ : พิสูจน์ว่า service เรียก iTunes ซ้ำ/ยอมแพ้/ตอบ fallback ตรงตามที่ออกแบบทุกกรณี
// ทำไม   : ใช้ mock แทน axios จึงจำลองความล้มเหลวได้แม่นยำ รวดเร็ว และไม่ต้องพึ่งอินเทอร์เน็ต
// Sprint : 6 | Phase 3
// ==============================================================================

// หน้าที่: mock ของ axios.get ที่เราคุมผลลัพธ์ได้ทีละครั้ง
// ทำไม: ชื่อตัวแปรต้องขึ้นต้นด้วย "mock" Jest จึงยอมให้ factory ด้านล่างอ้างถึงได้
const mockGet = jest.fn();
jest.mock("axios", () => ({
  create: jest.fn(() => ({ get: mockGet })),
}));

// ------------------------------------------------------------------------------
// 1. ตัวช่วย
// ------------------------------------------------------------------------------
const ENV_KEYS = [
  "EXTERNAL_API_BASE_URL",
  "EXTERNAL_API_TIMEOUT_MS",
  "EXTERNAL_API_MAX_RETRIES",
  "EXTERNAL_API_RETRY_DELAY_MS",
];

// หน้าที่: โหลด external-api.js ใหม่พร้อมค่า env ที่กำหนด
// ทำไม: ค่าตั้งต้นถูกอ่านตอนไฟล์ถูก require ครั้งเดียว ต้องล้าง cache แล้วโหลดใหม่ในแต่ละ test
//       ตั้งเวลารอ retry เหลือ 5 ms เพื่อให้ test เร็ว (ค่าจริงคือ 500 ms)
function loadService(env = {}) {
  jest.resetModules();
  ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, { EXTERNAL_API_RETRY_DELAY_MS: "5" }, env);
  const service = require("../src/services/external-api");
  // ทำไม: หลัง resetModules axios ที่ service ใช้เป็นคนละตัวกับที่ import ไว้ด้านบน
  //       จึงคืนตัวที่ถูกต้องไปให้ test ตรวจว่า axios.create ถูกเรียกด้วยค่าอะไร
  return { ...service, axios: require("axios") };
}

// error ที่ axios โยนเมื่อเซิร์ฟเวอร์ปลายทางตอบกลับมาด้วย status ผิดปกติ
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
// error ที่ axios โยนเมื่อไม่มี response เลย (เน็ตหลุด, หา host ไม่เจอ, timeout)
const networkError = (code) => Object.assign(new Error(code), { code });

const TRACK = {
  collectionName: "Parachutes",
  primaryGenreName: "Alternative",
  artworkUrl100: "https://img/100.jpg",
  previewUrl: "https://audio/preview.m4a",
  trackViewUrl: "https://music/track",
};
const okResponse = (results = [TRACK]) => ({ data: { resultCount: results.length, results } });

beforeEach(() => {
  mockGet.mockReset();
  // เงียบ log ของ service เพื่อให้ผล test อ่านง่าย
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

// ------------------------------------------------------------------------------
// 2. กรณีสำเร็จ
// ------------------------------------------------------------------------------
describe("fetchTrackInfo — กรณี iTunes ตอบปกติ", () => {
  test("สำเร็จตั้งแต่ครั้งแรก: source=itunes, attempts=1 และแปลงฟิลด์ถูกต้อง", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockResolvedValueOnce(okResponse());

    const result = await fetchTrackInfo("Coldplay", "Yellow");

    expect(result).toEqual({
      source: "itunes",
      attempts: 1,
      info: {
        album: "Parachutes",
        genre: "Alternative",
        artwork_url: "https://img/100.jpg",
        preview_url: "https://audio/preview.m4a",
        track_url: "https://music/track",
      },
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/search", {
      params: { term: "Coldplay Yellow", entity: "song", limit: 1 },
    });
  });

  test("iTunes ตอบปกติแต่ไม่พบเพลง: source=itunes และ info=null (ไม่ใช่ fallback)", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockResolvedValueOnce(okResponse([]));

    const result = await fetchTrackInfo("Nobody", "Nothing");

    expect(result).toEqual({ source: "itunes", attempts: 1, info: null });
  });

  test("response ที่ไม่มี results เลย ถือว่าไม่พบเพลง (info=null)", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockResolvedValueOnce({ data: {} });

    const result = await fetchTrackInfo("A", "B");

    expect(result.info).toBeNull();
    expect(result.source).toBe("itunes");
  });

  test("ฟิลด์ที่ iTunes ไม่ส่งมาให้กลายเป็น null", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockResolvedValueOnce(okResponse([{ collectionName: "Only Album" }]));

    const result = await fetchTrackInfo("A", "B");

    expect(result.info).toEqual({
      album: "Only Album",
      genre: null,
      artwork_url: null,
      preview_url: null,
      track_url: null,
    });
  });
});

// ------------------------------------------------------------------------------
// 3. Retry
// ------------------------------------------------------------------------------
describe("Retry — ลองใหม่เมื่อมีโอกาสหายเอง", () => {
  test("ล้ม 503 หนึ่งครั้งแล้วสำเร็จ: ยิง 2 ครั้ง, attempts=2, ไม่ fallback", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce(okResponse());

    const result = await fetchTrackInfo("Coldplay", "Yellow");

    expect(result.source).toBe("itunes");
    expect(result.attempts).toBe(2);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test("ล้ม 2 ครั้งแล้วสำเร็จครั้งที่ 3 (ใช้โควตา retry ครบพอดี)", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValueOnce(okResponse());

    const result = await fetchTrackInfo("Coldplay", "Yellow");

    expect(result.source).toBe("itunes");
    expect(result.attempts).toBe(3);
  });

  test("503 ตลอด: ยิงครบ 3 ครั้งแล้ว fallback พร้อมเหตุผล", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockRejectedValue(httpError(503));

    const result = await fetchTrackInfo("Coldplay", "Yellow");

    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      source: "fallback",
      attempts: 3,
      info: { album: null, genre: "ไม่ทราบ", artwork_url: null, preview_url: null, track_url: null },
      reason: "HTTP 503",
    });
  });

  test("หา host ไม่เจอ (ENOTFOUND, ไม่มี response): ลองใหม่ครบ 3 ครั้งแล้ว fallback", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockRejectedValue(networkError("ENOTFOUND"));

    const result = await fetchTrackInfo("A", "B");

    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(result.source).toBe("fallback");
    expect(result.reason).toBe("ENOTFOUND");
  });

  test("timeout (ECONNABORTED): ลองใหม่และรายงานเหตุผลเป็นข้อความ timeout", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockRejectedValue(networkError("ECONNABORTED"));

    const result = await fetchTrackInfo("A", "B");

    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(result.reason).toBe("timeout เกิน 3000 ms");
  });

  test("timeout แบบ ETIMEDOUT รายงานเหตุผลเหมือนกัน", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockRejectedValue(networkError("ETIMEDOUT"));

    const result = await fetchTrackInfo("A", "B");

    expect(result.reason).toBe("timeout เกิน 3000 ms");
  });

  test("error ที่ไม่มี code ใช้ข้อความ error เป็นเหตุผล", async () => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockRejectedValue(new Error("weird failure"));

    const result = await fetchTrackInfo("A", "B");

    expect(result.reason).toBe("weird failure");
  });

  test("Exponential Backoff: รอ 40 ms แล้ว 80 ms ระหว่างครั้ง (รวมอย่างน้อย 120 ms)", async () => {
    const { fetchTrackInfo } = loadService({ EXTERNAL_API_RETRY_DELAY_MS: "40" });
    mockGet.mockRejectedValue(httpError(503));

    const start = Date.now();
    await fetchTrackInfo("A", "B");
    const elapsed = Date.now() - start;

    // เผื่อความคลาดเคลื่อนของตัวจับเวลาเล็กน้อย (timer อาจเสร็จก่อนเวลาประมาณ 1 ms)
    expect(elapsed).toBeGreaterThanOrEqual(115);
  });
});

// ------------------------------------------------------------------------------
// 4. กรณีที่ไม่ควร Retry
// ------------------------------------------------------------------------------
describe("ไม่ Retry เมื่อคำขอของเราผิดเอง (4xx)", () => {
  test.each([400, 404, 429])("HTTP %i: ยิงครั้งเดียวแล้ว fallback ทันที", async (status) => {
    const { fetchTrackInfo } = loadService();
    mockGet.mockRejectedValue(httpError(status));

    const result = await fetchTrackInfo("A", "B");

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("fallback");
    expect(result.attempts).toBe(1);
    expect(result.reason).toBe(`HTTP ${status}`);
  });
});

// ------------------------------------------------------------------------------
// 5. ค่าตั้งต้นจาก .env
// ------------------------------------------------------------------------------
describe("ค่าตั้งต้น (numberFromEnv และการสร้าง axios client)", () => {
  test("MAX_RETRIES=0 หมายถึงไม่ retry (ยิงครั้งเดียว)", async () => {
    const { fetchTrackInfo } = loadService({ EXTERNAL_API_MAX_RETRIES: "0" });
    mockGet.mockRejectedValue(httpError(503));

    const result = await fetchTrackInfo("A", "B");

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
  });

  test("MAX_RETRIES=1 ยิงรวม 2 ครั้ง", async () => {
    const { fetchTrackInfo } = loadService({ EXTERNAL_API_MAX_RETRIES: "1" });
    mockGet.mockRejectedValue(httpError(503));

    await fetchTrackInfo("A", "B");

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test.each(["abc", "-3", ""])("MAX_RETRIES='%s' (ค่าที่ใช้ไม่ได้) ใช้ค่า default 2 รวมยิง 3 ครั้ง", async (value) => {
    const { fetchTrackInfo } = loadService({ EXTERNAL_API_MAX_RETRIES: value });
    mockGet.mockRejectedValue(httpError(503));

    await fetchTrackInfo("A", "B");

    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  test("สร้าง axios client ด้วย baseURL และ timeout ที่ถูกต้อง", () => {
    const { axios } = loadService({
      EXTERNAL_API_BASE_URL: "http://localhost:4000",
      EXTERNAL_API_TIMEOUT_MS: "1500",
    });

    expect(axios.create).toHaveBeenLastCalledWith({ baseURL: "http://localhost:4000", timeout: 1500 });
  });

  test("ไม่ตั้งค่าอะไรเลย: ใช้ iTunes จริง และ timeout 3000 ms", () => {
    const { axios } = loadService();

    expect(axios.create).toHaveBeenLastCalledWith({ baseURL: "https://itunes.apple.com", timeout: 3000 });
  });

  test("TIMEOUT=0 ถูกบังคับให้เป็น 3000 เพราะ axios ตีความ 0 ว่ารอตลอดไป", () => {
    const { axios } = loadService({ EXTERNAL_API_TIMEOUT_MS: "0" });

    expect(axios.create).toHaveBeenLastCalledWith({ baseURL: "https://itunes.apple.com", timeout: 3000 });
  });
});

// ------------------------------------------------------------------------------
// 6. getWithRetry
// ------------------------------------------------------------------------------
describe("getWithRetry — ฟังก์ชันชั้นล่าง", () => {
  test("สำเร็จ: คืน data และจำนวนครั้งที่ยิง", async () => {
    const { getWithRetry } = loadService();
    mockGet.mockResolvedValueOnce({ data: { hello: "world" } });

    await expect(getWithRetry("/x", { a: 1 })).resolves.toEqual({
      data: { hello: "world" },
      attempts: 1,
    });
  });

  test("ล้มเหลวทุกครั้ง: โยน error ที่แนบจำนวนครั้งที่ลองไว้ใน attempts", async () => {
    const { getWithRetry } = loadService();
    mockGet.mockRejectedValue(httpError(500));

    await expect(getWithRetry("/x")).rejects.toMatchObject({ attempts: 3 });
  });
});

// ------------------------------------------------------------------------------
// 7. ข้อมูลจาก iTunes ไม่ครบ
// ------------------------------------------------------------------------------
describe("แปลงข้อมูลเมื่อ iTunes ส่งฟิลด์มาไม่ครบ", () => {
  test("ไม่มี collectionName -> album เป็น null แต่ฟิลด์อื่นแปลงตามปกติ", async () => {
    const { fetchTrackInfo } = loadService();
    const { collectionName, ...withoutAlbum } = TRACK;
    mockGet.mockResolvedValueOnce(okResponse([withoutAlbum]));

    const result = await fetchTrackInfo("A", "B");

    expect(result.info.album).toBeNull();
    expect(result.info.genre).toBe("Alternative");
  });
});
