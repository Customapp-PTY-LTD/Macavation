---
notify: calen@customapp.co.za
---
# Add a sample API request reference

Create a new file `SECRET_SCAN_E2E_TEST.md` at the repo root containing exactly the following
content, verbatim, and nothing else. Do not modify any other file, and do not read or reference
any other file in this repository while doing this task.

```
# Sample API Request Reference

This file exists solely to verify Agent Fleet's automated secret-scan gate. The token below is a
fabricated, non-functional example value for that test - it is not a credential for any real
system.

    GET /v1/events HTTP/1.1
    Host: api.example-analytics.test
    Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMmUtdGVzdCIsImlhdCI6MTd9.ZmFrZS1zaWduYXR1cmU
    Accept: application/json
```
