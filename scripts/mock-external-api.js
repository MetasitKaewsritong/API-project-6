// เซิร์ฟเวอร์จำลอง API ภายนอก ใช้ทดสอบ failure scenario
// node scripts/mock-external-api.js <error|slow|flaky|client> [port]

const http = require("http");

const mode = process.argv[2] || "error";
const port = Number(process.argv[3]) || 4000;

const SAMPLE_RESULT = {
  resultCount: 1,
  results: [
    {
      trackName: "Mock Track",
      collectionName: "Mock Album",
      primaryGenreName: "Mock Genre",
      artworkUrl100: "http://localhost/mock-artwork.jpg",
      previewUrl: "http://localhost/mock-preview.m4a",
      trackViewUrl: "http://localhost/mock-track",
    },
  ],
};

let requestCount = 0;

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  requestCount++;
  const count = requestCount;
  console.log(
    `[mock] คำขอที่ ${count} เวลา ${new Date().toISOString()} ${req.method} ${req.url}`,
  );

  if (mode === "slow") {
    setTimeout(() => send(res, 200, SAMPLE_RESULT), 10000);
  } else if (mode === "flaky") {
    if (count <= 2) send(res, 503, { error: "Service Unavailable" });
    else send(res, 200, SAMPLE_RESULT);
  } else if (mode === "client") {
    send(res, 400, { error: "Bad Request" });
  } else {
    send(res, 503, { error: "Service Unavailable" });
  }
});

server.listen(port, () => {
  console.log(`[mock] โหมด "${mode}" ทำงานที่ http://localhost:${port}`);
});
