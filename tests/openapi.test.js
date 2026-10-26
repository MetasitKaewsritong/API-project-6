// ==============================================================================
// openapi.test.js — ตรวจว่าเอกสาร openapi.yaml ตรงกับโค้ดจริง (Swagger/Code Match)
// ------------------------------------------------------------------------------
// หน้าที่ : เทียบเอกสารกับ route ที่ Express ลงทะเบียนไว้จริง และรหัส error ที่โค้ดส่งออกจริง
// ทำไม   : เอกสารที่เขียนด้วยมือเพี้ยนจากโค้ดได้เงียบ ๆ เมื่อมีคนเพิ่ม/แก้ route แล้วลืมแก้เอกสาร
//          test นี้ทำให้ npm test ล้มทันทีเมื่อสองฝั่งไม่ตรงกัน
// Sprint : 8 | Phase 3
// ==============================================================================

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { useTestDatabase } = require("./helpers/test-db");
useTestDatabase();

const request = require("supertest");
const app = require("../src/index");
const pool = require("../src/db");

const ROOT = path.join(__dirname, "..");
const spec = yaml.load(fs.readFileSync(path.join(ROOT, "openapi.yaml"), "utf8"));
const indexSource = fs.readFileSync(path.join(ROOT, "src", "index.js"), "utf8");

const HTTP_METHODS = ["get", "post", "put", "delete"];

afterAll(async () => {
  await pool.end();
});

// ------------------------------------------------------------------------------
// 1. ตัวช่วยดึงรายการ route
// ------------------------------------------------------------------------------
// หน้าที่: รายการ "METHOD /path" ที่เขียนไว้ในเอกสาร (แปลง {id} เป็น :id ให้เทียบกับ Express ได้)
function documentedRoutes() {
  const routes = [];
  for (const [urlPath, operations] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      if (operations[method]) {
        routes.push(`${method.toUpperCase()} ${urlPath.replace(/\{(\w+)\}/g, ":$1")}`);
      }
    }
  }
  return routes.sort();
}

// หน้าที่: รายการ "METHOD /path" ที่ Express ลงทะเบียนไว้จริง
// ทำไม: อ่านจาก router ของ Express โดยตรง จึงเป็นความจริงของโค้ด ไม่ใช่ของที่เรา "เชื่อ" ว่ามี
function actualRoutes() {
  const routes = [];
  for (const layer of app.router.stack) {
    if (!layer.route) continue; // ข้าม middleware ที่ไม่ใช่ route (เช่น cors, express.json, /api-docs)
    for (const method of Object.keys(layer.route.methods)) {
      if (HTTP_METHODS.includes(method)) {
        routes.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    }
  }
  return routes.sort();
}

// ------------------------------------------------------------------------------
// 2. เอกสารตรงกับ route จริง
// ------------------------------------------------------------------------------
describe("openapi.yaml ตรงกับ route จริง", () => {
  test("ทุก route ในโค้ดมีในเอกสาร และทุก operation ในเอกสารมี route จริง (ตรงกันเป๊ะ)", () => {
    expect(documentedRoutes()).toEqual(actualRoutes());
  });

  test("มี 17 operation", () => {
    expect(documentedRoutes()).toHaveLength(17);
  });

  test("ทุก operation มี tags, summary และ response สำเร็จ (2xx) อย่างน้อย 1 แบบ", () => {
    for (const [urlPath, operations] of Object.entries(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = operations[method];
        if (!operation) continue;
        const label = `${method.toUpperCase()} ${urlPath}`;
        expect({ label, hasTags: Boolean(operation.tags?.length) }).toEqual({ label, hasTags: true });
        expect({ label, hasSummary: Boolean(operation.summary) }).toEqual({ label, hasSummary: true });
        const successCodes = Object.keys(operation.responses).filter((code) => code.startsWith("2"));
        expect({ label, hasSuccess: successCodes.length > 0 }).toEqual({ label, hasSuccess: true });
      }
    }
  });

  test("path ที่มี {id} ทุกเส้นประกาศ parameter ครบทุกตัว", () => {
    for (const [urlPath, operations] of Object.entries(spec.paths)) {
      const names = [...urlPath.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const method of HTTP_METHODS) {
        if (!operations[method]) continue;
        const declared = (operations[method].parameters || []).map((p) =>
          p.$ref ? spec.components.parameters[p.$ref.split("/").pop()].name : p.name,
        );
        for (const name of names) {
          expect({ route: `${method} ${urlPath}`, name, declared: declared.includes(name) }).toEqual({
            route: `${method} ${urlPath}`,
            name,
            declared: true,
          });
        }
      }
    }
  });
});

// ------------------------------------------------------------------------------
// 3. รหัส error ในเอกสารตรงกับที่โค้ดส่งออกจริง
// ------------------------------------------------------------------------------
describe("รหัส error ในเอกสารตรงกับโค้ด", () => {
  // หน้าที่: ดึงรหัส error ทุกตัวที่โค้ดส่งผ่าน sendError(res, status, "CODE", ...) ออกมา
  const codesInCode = [...indexSource.matchAll(/sendError\(\s*res,\s*\d{3},\s*"([A-Z_]+)"/g)].map((m) => m[1]);
  const codesInSpec = spec.components.schemas.Error.properties.error.properties.code.enum;

  test("รหัส error ทุกตัวที่โค้ดส่งออก มีอยู่ใน enum ของเอกสาร และในทางกลับกัน", () => {
    expect([...new Set(codesInCode)].sort()).toEqual([...codesInSpec].sort());
  });
});

// ------------------------------------------------------------------------------
// 4. ความสมบูรณ์ภายในของเอกสาร
// ------------------------------------------------------------------------------
describe("ความสมบูรณ์ภายในของ openapi.yaml", () => {
  test("ทุก $ref ชี้ไปยังส่วนที่มีอยู่จริง (ไม่มีลิงก์เสีย)", () => {
    const broken = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        if (typeof node.$ref === "string") {
          const target = node.$ref.replace(/^#\//, "").split("/").reduce((acc, key) => acc?.[key], spec);
          if (target === undefined) broken.push(node.$ref);
        }
        Object.values(node).forEach(walk);
      }
    };
    walk(spec);
    expect(broken).toEqual([]);
  });
});

// ------------------------------------------------------------------------------
// 5. Swagger UI ใช้งานได้จริง
// ------------------------------------------------------------------------------
describe("Swagger UI ที่ /api-docs", () => {
  test("เปิดหน้าเอกสารได้ (200 และเป็น HTML)", async () => {
    const res = await request(app).get("/api-docs/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("swagger-ui");
  });
});
