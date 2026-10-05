# Music Library API - โครงงานระยะที่ 2

รหัสนิสิต 67160005 | Pno 6 (ระบบข้อมูลเพลง)

## วิธีรัน

ต้องมี Node.js และ Docker

1. ติดตั้ง dependency

   ```bash
   npm install
   ```

2. สร้างไฟล์ `.env` จากตัวอย่าง (ค่าในไฟล์ตรงกับ `docker-compose.yml` แล้ว)

   ```bash
   cp .env.example .env
   ```

3. เปิด MySQL (รัน `schema.sql` และ `seed.sql` ให้อัตโนมัติในครั้งแรก)

   ```bash
   docker compose up -d
   ```

4. เปิดเซิร์ฟเวอร์

   ```bash
   npm start
   ```

เซิร์ฟเวอร์ทำงานที่ `http://localhost:3100` และเอกสาร Swagger UI อยู่ที่ `http://localhost:3100/api-docs`

## ไฟล์ที่ส่ง

| ไฟล์                           | เนื้อหา                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `openapi.yaml`                 | OpenAPI 3.0 ของทั้ง 15 endpoint                                |
| `postman_collection.json`      | Postman Collection พร้อมตัวอย่าง request/response ที่บันทึกจริง |
| `src/index.js`                 | route ทั้งหมด และ Swagger UI ที่ `/api-docs`                   |
| `src/services/external-api.js` | เรียก iTunes Search API พร้อม retry, timeout และ fallback      |
| `failure-scenario-results.md`  | บันทึกผลการทดสอบ Failure Scenario                              |
| `scripts/`                     | เซิร์ฟเวอร์จำลอง API ภายนอก และสคริปต์สร้าง Postman Collection |

## Endpoint

| Method | Path                                   | คำอธิบาย                          |
| ------ | -------------------------------------- | --------------------------------- |
| GET    | `/health`                              | ตรวจสถานะเซิร์ฟเวอร์              |
| GET    | `/api/v1/artists`                      | รายชื่อศิลปินทั้งหมด              |
| POST   | `/api/v1/artists`                      | เพิ่มศิลปินใหม่ (UC-04)           |
| GET    | `/api/v1/artists/:id/songs`            | เพลงทั้งหมดของศิลปิน (UC-02)      |
| GET    | `/api/v1/songs`                        | รายการเพลง ค้นหาด้วย `?q=` (UC-01) |
| GET    | `/api/v1/songs/:id`                    | รายละเอียดเพลง                    |
| POST   | `/api/v1/songs`                        | เพิ่มเพลงใหม่ (UC-03)             |
| PUT    | `/api/v1/songs/:id`                    | แก้ไขเพลง                         |
| DELETE | `/api/v1/songs/:id`                    | ลบเพลง                            |
| GET    | `/api/v1/songs/:id/external-info`      | ข้อมูลเสริมจาก iTunes             |
| GET    | `/api/v1/playlists`                    | เพลย์ลิสต์ทั้งหมด                 |
| POST   | `/api/v1/playlists`                    | สร้างเพลย์ลิสต์ (UC-05)           |
| GET    | `/api/v1/playlists/:id`                | รายละเอียดเพลย์ลิสต์ (UC-08)      |
| POST   | `/api/v1/playlists/:id/songs`          | เพิ่มเพลงเข้าเพลย์ลิสต์ (UC-06)   |
| DELETE | `/api/v1/playlists/:id/songs/:songId`  | ลบเพลงออกจากเพลย์ลิสต์ (UC-07)    |

## ทดสอบ Failure Scenario ซ้ำ

ดูขั้นตอนและผลใน `failure-scenario-results.md` ตัวอย่างการจำลอง API ภายนอกตอบ 503

```bash
node scripts/mock-external-api.js error 4000
```

```bash
PORT=3101 EXTERNAL_API_BASE_URL=http://localhost:4000 node src/index.js
```
