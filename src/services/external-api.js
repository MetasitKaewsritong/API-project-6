const axios = require("axios");

const BASE_URL = process.env.EXTERNAL_API_BASE_URL || "https://itunes.apple.com";
const TIMEOUT_MS = Number(process.env.EXTERNAL_API_TIMEOUT_MS) || 3000;
const MAX_RETRIES = Number(process.env.EXTERNAL_API_MAX_RETRIES) || 2;
const RETRY_DELAY_MS = Number(process.env.EXTERNAL_API_RETRY_DELAY_MS) || 500;

const FALLBACK_INFO = {
  album: null,
  genre: "ไม่ทราบ",
  artwork_url: null,
  preview_url: null,
  track_url: null,
};

const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 4xx แปลว่าคำขอเราผิดเอง ยิงซ้ำก็ได้ผลเดิม จึง retry เฉพาะ network error กับ 5xx
function isRetryable(err) {
  if (!err.response) return true;
  return err.response.status >= 500;
}

function describeError(err) {
  if (err.response) return `HTTP ${err.response.status}`;
  if (err.code === "ECONNABORTED") return `timeout เกิน ${TIMEOUT_MS} ms`;
  return err.code || err.message;
}

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

      if (!isRetryable(err) || attempt === maxAttempts) {
        err.attempts = attempt;
        throw err;
      }

      const delay = RETRY_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`[external-api] รอ ${delay} ms ก่อนลองใหม่`);
      await sleep(delay);
    }
  }
}

// ไม่ throw: ถ้าเรียกไม่สำเร็จจะคืน source "fallback" พร้อมค่า default แทน
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
        : null,
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
