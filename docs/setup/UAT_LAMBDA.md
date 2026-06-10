# UAT Lambda proxy

Localhost dev (`127.0.0.1`) uses portal environment **`dev`**, which reads UAT for direct PostgREST but uses **`LambdaProxyUrl`** for sign-in and almost all module data.

Until `uat.lambdaProxyUrl` is set in [`supabase/projects.json`](../../supabase/projects.json), dev/uat fall back to the **production** Lambda — so localhost shows production data.

## Deploy (AWS admin)

1. Duplicate the production Lambda (`WebPortal/index_supabase.js` and its `auth/`, `middleware/`, `utils/` dependencies) as a **separate function** (e.g. `macavation-uat-proxy`).
2. Set environment variables on the **UAT** function:

| Name | Value |
|------|--------|
| `SUPABASE_URL` | `https://nmdmddugxclpqrwylyfa.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | UAT service role (Dashboard → Macavation UAT → Settings → API) |
| `ENABLE_DATABASE_AUTH` | `true` |
| Other vars | Copy from production Lambda (JWT secret, CORS, rate limits, etc.) |

3. Enable **Lambda function URL**; note the URL ending in `/proxy/function`.

### CORS (fixes browser sign-in — `Access-Control-Allow-Origin` contains multiple values `*, *`)

The UAT function must **not** send duplicate `Access-Control-Allow-Origin` headers. If both **AWS Function URL CORS** and the Lambda app (`index_supabase.js` / `corsHeaders`) add CORS, the server may return **401** correctly but the browser blocks the response and sign-in fails.

**Symptom in DevTools:**

```
The 'Access-Control-Allow-Origin' header contains multiple values '*, *', but only one is allowed.
POST …/auth/login net::ERR_FAILED 401 (Unauthorized)
```

**Fix in AWS Console (recommended — match production):**

1. Open [AWS Lambda](https://af-south-1.console.aws.amazon.com/lambda/home?region=af-south-1#/functions) (region **af-south-1**).
2. Open the UAT function whose URL is `https://liztgjlkisjorpow3zgjowcvcu0iwnvc.lambda-url.af-south-1.on.aws/`.
3. **Configuration** → **Function URL** → **Edit**.
4. **Uncheck** “Configure cross-origin resource sharing (CORS)” (or clear all CORS fields). The deployed app already sets CORS via `corsHeaders` — same as production.
5. Save.

**Verify from the repo:**

```bash
npm run verify:uat-lambda-cors
```

Should print `OK: Single Access-Control-Allow-Origin`. Or with curl (401 body is fine; count headers):

```powershell
curl.exe -s -i -X POST "https://liztgjlkisjorpow3zgjowcvcu0iwnvc.lambda-url.af-south-1.on.aws/auth/login" -H "Origin: http://127.0.0.1:3002" -H "Content-Type: application/json" -d "@.tmp_login_body.json"
```

Expect **one** `access-control-allow-origin: *` line, not two.

**AWS CLI (optional):** after `aws configure`, find the function name, then clear Function URL CORS:

```bash
aws lambda update-function-url-config --function-name YOUR_UAT_FUNCTION --region af-south-1 \
  --cors '{"AllowCredentials":false,"AllowHeaders":[],"AllowMethods":[],"AllowOrigins":[],"ExposeHeaders":[],"MaxAge":0}'
```

## Configure the repo

1. Set `uat.lambdaProxyUrl` in [`supabase/projects.json`](../../supabase/projects.json) to the UAT function URL.
2. Run:

```bash
npm run supabase:sync-portal
npm run db:check-project
npm run verify:portal-routing
```

`verify:portal-routing` should show **UAT (dedicated Lambda)** for `dev`/`uat` environments.

Production (`prod`/`demo`) continues to use `production.lambdaProxyUrl`.
