# ผลทดสอบ Failure Scenario

67160005 / ทดสอบ 5 ต.ค. 2026

ทดสอบที่ GET /api/v1/songs/5/external-info (เรียก iTunes)
ตั้งไว้ timeout 3 วิ, retry 2 ครั้ง (รวม 3 ครั้ง) หน่วง 0.5 กับ 1 วิ, ถ้าไม่ได้ก็ตอบ 200 พร้อมค่า default (source = fallback)

จำลองโดยเปลี่ยน EXTERNAL_API_BASE_URL ไปเป็น URL มั่ว หรือชี้ไป mock server ที่เขียนไว้ทดสอบ (พอร์ต 4000 สั่งให้ตอบ 503 / ตอบช้า / ตอบ 400 ได้)

1. ปกติ - เรียก 1 ครั้ง ได้ข้อมูลจาก iTunes (0.26 วิ)

2. URL ไม่มีจริง (https://itunes.invalid-67160005.test) - เรียก 3 ครั้งแล้ว fallback (1.64 วิ)

```
[external-api] ครั้งที่ 1/3 ล้มเหลว: ENOTFOUND
[external-api] รอ 500 ms ก่อนลองใหม่
[external-api] ครั้งที่ 2/3 ล้มเหลว: ENOTFOUND
[external-api] รอ 1000 ms ก่อนลองใหม่
[external-api] ครั้งที่ 3/3 ล้มเหลว: ENOTFOUND
```

ได้ response

```
{"message":"ไม่สามารถดึงข้อมูลเสริมจากบริการภายนอกได้ จึงแสดงค่าเริ่มต้นแทน","data":{"song":{"id":5,"title":"Yellow","duration_seconds":269,"release_year":2000,"artist_id":3,"artist_name":"Coldplay"},"external_info":{"album":null,"genre":"ไม่ทราบ","artwork_url":null,"preview_url":null,"track_url":null},"source":"fallback","attempts":3,"reason":"ENOTFOUND"}}
```

3. mock ตอบ 503 ตลอด - เรียก 3 ครั้งแล้ว fallback (1.62 วิ) ฝั่ง mock ก็เห็น 3 request

```
[mock] คำขอที่ 1 เวลา 2026-10-05T10:16:59.308Z
[mock] คำขอที่ 2 เวลา 2026-10-05T10:16:59.827Z
[mock] คำขอที่ 3 เวลา 2026-10-05T10:17:00.839Z
```

4. mock ตอบช้า 10 วิ - timeout ทั้ง 3 ครั้งแล้ว fallback (10.64 วิ) request ห่างกัน 3.5 กับ 4 วิ คือตัดที่ 3 วิจริง ไม่ได้รอครบ 10

```
[external-api] ครั้งที่ 1/3 ล้มเหลว: timeout เกิน 3000 ms
[external-api] ครั้งที่ 2/3 ล้มเหลว: timeout เกิน 3000 ms
[external-api] ครั้งที่ 3/3 ล้มเหลว: timeout เกิน 3000 ms
```

5. mock ล้ม 2 ครั้งแล้วตอบปกติ - ครั้งที่ 3 สำเร็จ ได้ข้อมูล ไม่ต้อง fallback (1.64 วิ)

6. mock ตอบ 400 - เรียกครั้งเดียว ไม่ retry แล้ว fallback เลย (0.43 วิ)

สรุป: ทุกข้อเป็นไปตามที่ออกแบบ ได้ 200 ทุกครั้ง เซิร์ฟเวอร์ไม่ crash (/health ยังตอบหลังทดสอบทุกข้อ)
ข้อเสียคือถ้าปลายทางช้า ผู้ใช้รอประมาณ 10 วิ
