# S3 Uploads – Exhaustive Technical Guide

This document describes **every detail** of how file uploads to S3 work: code locations, parameters, API contracts, HTML structure, validation, and edge cases. It covers **Capture-Data** (inspection photos, Dropzone) and **Macavation WebPortal** (lab test PDF upload, simple file input). Routing and modal loading for Macavation are documented where relevant.

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [File and code locations](#2-file-and-code-locations)
3. [Primary upload path: FormData API (common.js)](#3-primary-upload-path-formdata-api-commonjs)
4. [Dropzone setup and behaviour](#4-dropzone-setup-and-behaviour)
5. [Image compression](#5-image-compression)
6. [Alternative path: OASIS / base64 (data-functions.js)](#6-alternative-path-oasis--base64-data-functionsjs)
7. [Pre-populating uploads: setUploadFieldValue](#7-pre-populating-uploads-setuploadfieldvalue)
8. [Module implementation: vehicle, home, motorcycle](#8-module-implementation-vehicle-home-motorcycle)
9. [API contracts and backend](#9-api-contracts-and-backend)
10. [Configuration, URLs, and environment](#10-configuration-urls-and-environment)
11. [Error handling and return values](#11-error-handling-and-return-values)
12. [Adding a new upload type](#12-adding-a-new-upload-type)
13. [Edge cases and notes](#13-edge-cases-and-notes)
14. [Macavation WebPortal: upload and routing](#14-macavation-webportal-upload-and-routing)

---

## 1. Architecture overview

- **Capture-Data**: Inspection modules (vehicle, motorcycle, home) let users upload photos; files are sent to an API that stores them in S3 and returns a URL. Dropzone.js is used for file selection and preview; the actual HTTP upload is custom code calling `_common.uploadFile()` (FormData POST to the fileupload API).
- **Macavation WebPortal**: A single shared `_common.uploadFile()` in `WebPortal/js/common.js` uploads files (e.g. lab test PDFs) via the same FormData API. No Dropzone; a plain `<input type="file">` triggers upload on change. Default `resourceFolder` is configurable (see §14).
- **Two independent upload mechanisms** (Capture-Data):
  1. **FormData upload** (primary): `common.js` → `uploadFileAndGetUrlFromDropzone` → `uploadFile` → `fetch(…/fileupload)` with `multipart/form-data`. Used by inspection modules and by Macavation’s end-sample modal.
  2. **Base64 / OASIS upload**: `data-functions.js` → `uploadFile` or `uploadToChannelBucket` → OASIS `S3WebServiceURL` or custom URL with JSON body. Used for other flows; not used by the inspection photo flow or Macavation lab test PDF.
- **Resource path**: Capture-Data inspection uploads use `EFS Assist/PreInspections/`. Macavation can use the same or a custom folder (e.g. `Macavation`); the client sends `resourceFolder` and `fileId` (filename).

---

## 2. File and code locations

**Capture-Data**

| What | File | Approximate lines |
|------|------|-------------------|
| `uploadFileAndGetUrlFromDropzone` | `Capture-Data/js/common.js` | 393–510 |
| `setupDropzone` | `Capture-Data/js/common.js` | 511–685 |
| `compressImage` | `Capture-Data/js/common.js` | 681–736 |
| `uploadFile` (FormData) | `Capture-Data/js/common.js` | 738–849 |
| `setUploadFieldValue` | `Capture-Data/js/common.js` | 857–941 |
| OASIS URL comments / setOasisURLs | `Capture-Data/js/common.js` | 318–348 |
| `uploadFile` (base64/OASIS) | `Capture-Data/js/data-functions.js` | 135–196 |
| `uploadToChannelBucket` | `Capture-Data/js/data-functions.js` | 198–258 |
| Vehicle initPhotoDropzones / handleDropzonePhotoUpload | `Capture-Data/modules/vehicle_pre_inspection/js/vehicle_pre_inspection.js` | 179–227, 450–527 |
| Home initPhotoDropzones / handleDropzonePhotoUpload | `Capture-Data/modules/home_pre_inspection/js/home_pre_inspection.js` | 131–179, 299–375 |
| Motorcycle initPhotoDropzones / handleDropzonePhotoUpload | `Capture-Data/modules/motorcycle_pre_inspection/js/motorcycle_pre_inspection.js` | 102–150, 262–338 |
| App router OASIS / S3 URL notes | `Capture-Data/js/appRouter.js` | 108–121 |

**Macavation WebPortal**

| What | File | Approximate lines |
|------|------|-------------------|
| `uploadFile` (FormData) | `WebPortal/js/common.js` | ~348–381 |
| End-sample modal init / show / save | `WebPortal/modules/modals/modal-end-sample/js/modal_end_sample.js` | full file |
| Lab test PDF handler `handleLabTestPdfSelect` | `WebPortal/modules/modals/modal-end-sample/js/modal_end_sample.js` | ~42–95 |
| End-sample modal HTML (lab test PDF block) | `WebPortal/modules/modals/modal-end-sample/html/modal_end_sample.html` | lab test block ~49–54 |
| End-sample modal route config | `WebPortal/js/appRouteConfig.json` | `"end-sample-modal"` entry |
| Modal placeholder (end-sample) | `WebPortal/modules/kernel-production/html/kernel_production_grid.html` | `#endSampleModal` with `route-name="end-sample-modal"` |

---

## 3. Primary upload path: FormData API (common.js)

### 3.1 `uploadFileAndGetUrlFromDropzone(dropzoneEl)` (lines 393–510)

**Signature**: `async (dropzoneEl) => string | ""`

**Parameters**:
- `dropzoneEl`: A Dropzone instance (DOM element wrapper). Must not be null/undefined or the function throws.

**Behaviour (step by step)**:

1. **Guard**: If `!dropzoneEl`, throws `new Error("dropzoneEl is required")`.
2. **Get file**: `const file = dropzoneEl.files[0]`. So the Dropzone must have exactly one file when this is called (the module adds the file then immediately calls this).
3. **If no file**: Returns `""` (empty string).
4. **Base64 source**: Uses `file.dataURL` if present. If not, uses `FileReader.readAsDataURL(file)` and waits for the result (Promise). So the file is always converted to a data URL string at this point.
5. **Parse data URL**:  
   - `splitBase64 = fileBase64.split(",")`  
   - `contentType = splitBase64[0].split(":")[1]`  
   So the format is assumed to be `data:<contentType>;base64,<payload>`. Note: if the first segment contains a charset (e.g. `image/jpeg;charset=utf-8`), `contentType` will be the full string including `;charset=...`.
6. **Decode base64**:  
   - `byteCharacters = atob(splitBase64[1])`  
   - Build `byteNumbers` array (one element per character, `charCodeAt`), then `byteArray = new Uint8Array(byteNumbers)`.
7. **Blob and File**:  
   - `fileBlob = new Blob([byteArray], { type: contentType })`  
   - `fileObject = new File([fileBlob], file.name, { type: contentType })`  
   So the blob is recreated from the decoded bytes; the original `file.size` is not used for this new `File` (the blob’s size is implied by the byte array).
8. **Call uploadFile**:  
   - `fileId = file.name`  
   - `uploadFile_result = await scope.uploadFile({ file: fileObject, resourceFolder: "EFS Assist/PreInspections/", fileId: fileId, fileSize: file.size, chunkCount: 1, chunkIndex: 0 })`  
   So `fileSize` is the **original** file’s size, not the re-encoded blob’s size.
9. **Success/failure**:  
   - If `!uploadFile_result.Success`: throws `new Error("fileUpload Error", uploadFile_result)` and then `return ""` (the return is unreachable but present).  
   - On success: `return uploadFile_result.Data.fileLink`. So the backend response must expose the URL as `Data.fileLink`.

**Important**: The resource folder is **hardcoded** as `"EFS Assist/PreInspections/"`. There is no parameter to change it from this function.

---

### 3.2 `uploadFile({ file, resourceFolder, fileId, fileSize, chunkCount, chunkIndex })` (lines 738–849)

**Signature**: `async (params) => Promise<{ Success, LastErrorDescription, Data }>`

**Parameters** (all required by the current call site):
- `file`: `File` object to upload.
- `resourceFolder`: String, e.g. `"EFS Assist/PreInspections/"`.
- `fileId`: String, typically the original filename (e.g. `file.name`).
- `fileSize`: Number, size in bytes (original file size).
- `chunkCount`: Number; in current usage always `1`.
- `chunkIndex`: Number; in current usage always `0`.

**Behaviour**:

1. **FormData**: `const formdata = new FormData()`.
2. **Optional compression**:
   - `fileToUpload = file` initially.
   - `imageFileExts = ['jpeg', 'jpg', 'png', 'gif', 'heic', 'pdf']`.
   - `fileType = file.type.replace(';base64', '').split('/').pop()` → e.g. `jpeg`, `png`, `pdf`.
   - If `file.size / 1000000 >= 2` (2 MB or more) **and** `fileType` is in `imageFileExts`, then `fileToUpload = await scope.compressImage(file)`. So images (and PDF listed but not actually compressed as image) ≥ 2 MB are compressed; the rest are sent as-is.
3. **Append to FormData** (exact names matter for backend):
   - `formdata.append("files", fileToUpload)` — single file.
   - `formdata.append("resourceFolder", resourceFolder)`
   - `formdata.append("fileId", fileId)`
   - `formdata.append("fileSize", fileSize)`
   - `formdata.append("chunkCount", chunkCount)`
   - `formdata.append("chunkIndex", chunkIndex)`
4. **Request**:  
   - `method: "POST"`, `body: formdata`, `redirect: "follow"`. No explicit `Content-Type` (browser sets `multipart/form-data` with boundary).
   - URL: **hardcoded** `https://yzz5sh6s74.execute-api.af-south-1.amazonaws.com/v1/fileupload`.
5. **Response handling**:
   - `response.text()` is used (not `response.json()`), then `result = JSON.parse(result)`.
   - If `result.error` is truthy: resolve with `{ Success: false, LastErrorDescription: result.error, Data: [] }`.
   - If parse throws: resolve with `{ Success: false, LastErrorDescription: err, Data: [] }`.
   - Otherwise: resolve with `{ Success: true, LastErrorDescription: "", Data: result }`.
   - On fetch failure: resolve with `{ Success: false, LastErrorDescription: error, Data: [] }`.

So the backend can return either a normal JSON body (with optional `fileLink` inside) or an error object with an `error` property. The caller expects `Data.fileLink` for the photo URL.

---

## 4. Dropzone setup and behaviour

### 4.1 `setupDropzone(dropzoneId, acceptedFiles)` (lines 511–685)

**Signature**: `(dropzoneId, acceptedFiles) => Dropzone`

**Parameters**:
- `dropzoneId`: CSS selector string for the Dropzone container (e.g. `"#dropzone_front"`).
- `acceptedFiles`: Optional. Default if falsy: `".jpg,.heic,.png"`. Can be e.g. `".jpg,.heic,.png,.jpeg"`.

**Configuration (exact options)**:

```javascript
Dropzone.autoDiscover = false;  // Before creating instance

new Dropzone(dropzoneId, {
    url: '/upload',                    // Dummy; upload never sent here
    maxFilesize: 10,                   // MB
    maxFiles: 1,
    acceptedFiles: acceptedFiles || ".jpg,.heic,.png",
    autoProcessQueue: false,           // Critical: no auto POST
    addRemoveLinks: false,
    dictRemoveFile: "Remove",
    uploadMultiple: false,
    dictDefaultMessage: `<img class="icon-container" src="assets/img/icons/file_upload_icon.jpg"></img>
                         <div class="mt-1 upload-text">Browse Files</div>
                         <div class="mt-1 upload-sub-text">Choose a file</div>`,
    init: function () { ... }
});
```

**Init overrides and events**:

1. **Disable default upload**:  
   `this.uploadFiles = function (files) { }` — no-op, so calling `uploadFiles` does nothing. This prevents Dropzone from POSTing to `url`.

2. **maxfilesreached**:  
   Logs a message; if `files.length > 1`, calls `_controller.showToastMessage({ message: "You can only upload " + this.options.maxFiles + " file.", position: 'top-start', icon: 'warning' })` and `_this.removeFile(files[files.length - 1])`.  
   Note: `_controller` is global; if undefined, this will throw when a user selects a second file.

3. **hiddenFileInput change**:  
   If the hidden file input changes, `handleFileSelect` runs (checks `files.length` vs `maxFiles` and removes excess). Then `this.processFile(event.target.files[0])` is called — so the file is added to the Dropzone’s queue. The **module** is responsible for calling `uploadFileAndGetUrlFromDropzone` when it wants to upload (via its own `#photo_<type>` input change handler).

4. **addedfile**:  
   A custom “Remove” button is created and appended to `file.previewElement`; on click it removes the file and the button.

5. **removedfile**:  
   Sets `file.status = Dropzone.ADDED` and `file.accepted = true` so the file state is consistent.

**Return**: The Dropzone instance is stored with `jQuery(dropzoneId).data('dz', dz)` and returned. Modules store it in their own `dropZones` map (e.g. `scope.dropZones[dropzoneId] = _common.setupDropzone(...)`).

---

## 5. Image compression

### 5.1 `compressImage(file, maxWidth, maxHeight, quality)` (lines 681–736)

**Signature**: `(file, maxWidth = 1920, maxHeight = 1920, quality = 0.5) => Promise<Blob>`

**Parameters**:
- `file`: Image file (e.g. from input or Dropzone).
- `maxWidth`: Default 1920.
- `maxHeight`: Default 1920.
- `quality`: Default 0.5; used for `canvas.toBlob(..., 'image/jpeg', quality)`.

**Behaviour**:
1. `FileReader.readAsDataURL(file)` → load as data URL.
2. Create an `Image`, set `img.src = e.target.result`, wait for load.
3. Create a canvas. Compute dimensions: if `width > height`, scale by `maxWidth` if needed; else scale by `maxHeight`. Dimensions are kept within 1920×1920 (or custom).
4. Draw image on canvas and call `canvas.toBlob(cb, 'image/jpeg', quality)`. So output is **always JPEG**.
5. Resolve with the blob or reject with `new Error("Compression failed")` / reader error.

**When it’s used**: Only from `uploadFile()` when the file is ≥ 2 MB and its type (after `split('/').pop()`) is in `['jpeg', 'jpg', 'png', 'gif', 'heic', 'pdf']`. Note: HEIC and PDF are in the list but `compressImage` uses canvas/image; HEIC/PDF may not work in all browsers and could fail or behave unexpectedly.

---

## 6. Alternative path: OASIS / base64 (data-functions.js)

### 6.1 `DataFunctions.uploadFile(params, callback)` (lines 135–196)

**Purpose**: Upload to S3 via a JSON body (base64) either to a custom URL or to the OASIS S3 API Gateway.

**Parameters**:
- `params.fileName`: Full S3 object path (e.g. `EFS Assist/PreInspections/{guid}/{originalFileName}`).
- `params.fileBase64`: Base64 string (with or without `data:...;base64,` depending on caller).
- `params.contentType`: MIME type.
- `params.Action`: Optional; default `'uploadFile'`.
- `params.customUrl`: Optional. If set, the request goes to this URL instead of OASIS.
- `callback`: `(result) => void` with `result = { Success, Data, LastErrorDescription }`.

**When `params.customUrl` is set**:
- `fetch(params.customUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'UserAttr2': _Session.UserAttr2 || '' }, body: JSON.stringify({ Action: params.Action || 'uploadFile', fileName, fileBase64, contentType }) })`.
- Response: must be JSON. On success, callback receives `{ Success: true, Data: data.data || data.Data || data, LastErrorDescription: null }`. On failure (e.g. `!response.ok` or throw), `{ Success: false, Data: null, LastErrorDescription: error.message || 'Upload failed' }`.

**When `params.customUrl` is not set**:
- Requires `_OASIS.S3WebServiceURL`. If missing, logs error (callback not called with a structured result in the snippet; actual behaviour depends on `_OASIS.callWebServiceMethod`).
- `_OASIS.callWebServiceMethod({ url: _OASIS.S3WebServiceURL, WebMethod: 'S3Bucket', Headers: { UserAttr2: ... }, Params: params, async: true, callback })`. So the OASIS library sends the request; Params include `fileName`, `fileBase64`, `contentType`, and optionally `Action`.

**Comment in code**: S3WebServiceURL should come from the OASIS library (e.g. `https://0ddoc9len1.execute-api.af-south-1.amazonaws.com/v1/Dev`). Do not override it in app code.

---

### 6.2 `DataFunctions.uploadToChannelBucket(params, callback)` (lines 198–258)

**Parameters**:
- `params.file`: `File` object.
- `params.guid`: Unique identifier; used in S3 path.
- `params.fileName`: Optional; falls back to `params.file.name`.
- `params.customUrl`: Optional; passed through to `uploadFile`.

**Behaviour**:
1. `FileReader.readAsDataURL(params.file)`.
2. On load: `fileBase64 = e.target.result.split(',')[1]` (strip data URL prefix).
3. S3 path: `EFS Assist/PreInspections/${uploadParams.UniqueGUID}/${uploadParams.originalFileName}` where `UniqueGUID = params.guid`, `originalFileName = params.fileName || params.file.name`.
4. Calls `obj.uploadFile(s3Params, callback)` with `Action: 'uploadFile'`, `fileName`, `fileBase64`, `contentType: params.file.type`, and optional `customUrl`.
5. On success: callback with `{ success: true, path: s3Params.fileName, url: s3Result.Data.Location || s3Result.Data.Key || uploadParams.originalFileName, data: s3Result.Data }`.
6. On failure: callback with `{ success: false, message: '...', error: ..., s3Result }`.
7. On reader error: callback with `{ success: false, message: 'File read error', error: 'Failed to read the selected file' }`.

---

## 7. Pre-populating uploads: setUploadFieldValue

### 7.1 `setUploadFieldValue(formEl, value)` (lines 857–941)

**Purpose**: Set a Dropzone’s “value” by either loading from a URL or from a base64 string. Used to pre-fill an upload field (e.g. when editing).

**Parameters**:
- `formEl`: jQuery element (e.g. the Dropzone container). `formEl.attr("id")` is used to get the element for `Dropzone.forElement("#" + formEl.attr("id"))`.
- `value`: Either a full URL (http/https/ftp) or a base64 data URL string (e.g. `data:image/jpeg;base64,...`).

**URL branch**:
- Regex: `var urlPattern = /^(http|https|ftp):\/\/[^\s/$.?#].[^\s]*$/i`.
- If `urlPattern.test(value)`:
  - `fetch(value)` → `response.blob()`.
  - `fileName = scope.GetLinkFileNameFromURL(value)`. Note: `GetLinkFileNameFromURL` is called on `_common` but its definition is not in the captured `common.js`; it may live in another script or portal library. It should return a filename string for the given URL.
  - Create `new File([blob], fileName, { type: blob.type })` and `myDropzone.addFile(file)`.
  - On fetch error: `console.error("Error fetching the file:", error)`.

**Base64 branch**:
- `base64String = value.split(",")[1]` (assumes one comma, data URL format).
- Decode with `atob(base64String)` → byte array → `Uint8Array` → `Blob([byteArray], { type: "application/octet-stream" })` → `new File([blob], "filename.jpg", { type: "image/jpeg" })` and `myDropzone.addFile(file)`. So the filename is fixed as `"filename.jpg"` and type as `image/jpeg` when pre-filling from base64.

---

## 8. Module implementation: vehicle, home, motorcycle

### 8.1 When dropzones are initialized

- **Vehicle**: When step 5 (photos) is shown; `showStep(5)` leads to `initPhotoDropzones()`.
- **Home**: When step 3 is shown; `initPhotoDropzones()`.
- **Motorcycle**: When step 3 is shown; `initPhotoDropzones()`.

Each module only initializes dropzones once: `if (Object.keys(scope.dropZones).length === 0)`.

---

### 8.2 Photo types and HTML IDs (exact)

**Vehicle** (`vehicle_pre_inspection`):
- Photo types: `['front', 'back', 'left_side', 'right_side', 'front_left_corner', 'front_right_corner', 'back_left_corner', 'back_right_corner', 'odometer', 'vin', 'damage']`.
- File inputs: `#photo_<type>` (e.g. `#photo_front`).
- Hidden dropzones: `#dropzone_<type>` (e.g. `#dropzone_front`), created as `<div id="dropzone_<type>" class="dropzone" name="photo_<type>" style="display: none;">` and inserted after the file input.
- Preview containers: `#preview_<type>` (e.g. `#preview_front`).
- Required for submit (when inspection type is “photos”): `front`, `back`, `left_side`, `right_side`, `front_left_corner`, `front_right_corner`, `back_left_corner`, `back_right_corner`, `odometer`, `vin`. Damage is optional.

**Home** (`home_pre_inspection`):
- Photo types: `['front', 'back', 'left', 'right']`.
- Same pattern: `#photo_<type>`, `#dropzone_<type>`, `#preview_<type>`.
- Required: all four.

**Motorcycle** (`motorcycle_pre_inspection`):
- Photo types: `['left_side', 'right_side', 'odometer', 'vin', 'damage']`.
- Same pattern.
- Required: `left_side`, `right_side`, `odometer`, `damage`. `vin` is optional.

---

### 8.3 initPhotoDropzones pattern (same idea in all three)

For each `type` in the list:
1. `fileInputId = "#photo_<type>"`, `fileInput = $(fileInputId)`.
2. If the file input exists and `!scope.dropZones[fileInputId]`:
   - Create hidden div `#dropzone_<type>`, insert after the file input.
   - `scope.dropZones["#dropzone_<type>"] = _common.setupDropzone("#dropzone_<type>", ".jpg,.heic,.png,.jpeg")`.
   - Bind `fileInput.on('change', ...)`: get `file = e.target.files[0]`, then `dz.removeAllFiles()`, `dz.addFile(file)`, and `scope.handleDropzonePhotoUpload(file, type)`.

So the visible control is the file input; the hidden Dropzone holds the file and is passed to `uploadFileAndGetUrlFromDropzone`.

---

### 8.4 handleDropzonePhotoUpload pattern (same in all three)

1. If `!file`, return.
2. **Size**: If `file.size > 10 * 1024 * 1024` (10 MB): show error toast, `dz.removeFile(file)`, return.
3. **GUID**: `guid = _Session.dataHeaderGuid || dataHeaderGuid`. If `!guid`: show error toast, remove file, call `scope.showStep(1)`, return.
4. **UI**: `$('#preview_<photoType>').html('<div class="text-muted">Uploading...</div>')`.
5. **Upload**: `dz = scope.dropZones["#dropzone_<photoType>"]`. If no dz, throw. Then `fileURL = await _common.uploadFileAndGetUrlFromDropzone(dz)`.
6. **Success**: If `fileURL`: set `formData.photos[photoType] = { type, name: file.name, url: fileURL, size: file.size }`, render preview `<img src="${fileURL}" ...>`, show success toast. Else throw “No URL returned from upload”.
7. **Error**: catch → log, show error toast, `previewContainer.empty()`, `dz.removeFile(file)`.

---

### 8.5 HTML structure (one example per module)

**Vehicle (one block):**
```html
<div class="mb-3" id="divUploadPhoto_front">
    <label for="photo_front">Front View <span class="text-danger">*</span></label>
    <input class="form-control" id="photo_front" type="file" accept="image/*" />
    <small class="form-text text-muted">Upload a photo of the front of the vehicle (Max 10MB)</small>
    <div class="photo-preview-container mt-2" id="preview_front"></div>
</div>
```
Same pattern for all 11 vehicle photo types; `accept="image/*"` on each input.

**Home**: Same pattern; IDs like `photo_front`, `preview_front`, and for left/right the type is `left` / `right` (not `left_side` / `right_side`).

**Motorcycle**: Same pattern; types left_side, right_side, odometer, vin (optional in UI), damage.

---

### 8.6 formData.photos and submit

- **Structure**: `formData.photos` is an object keyed by photo type. Each value is either `null` or `{ type, name, url, size }`. Example: `formData.photos.front = { type: 'front', name: 'IMG_001.jpg', url: 'https://...', size: 1234567 }`.
- **Submit**: Each module checks that all required photo types have a non-null entry in `formData.photos`, then builds an array (e.g. for API) from the required keys. Optional types (e.g. damage, vin in motorcycle) may be included if present.

---

## 9. API contracts and backend

### 9.1 FormData upload (primary)

- **URL**: `POST https://yzz5sh6s74.execute-api.af-south-1.amazonaws.com/v1/fileupload`
- **Content-Type**: `multipart/form-data` (browser-set with boundary).
- **Body (form fields)**:
  - `files`: one file (the `File` or compressed Blob).
  - `resourceFolder`: string, e.g. `EFS Assist/PreInspections/`.
  - `fileId`: string, e.g. original filename.
  - `fileSize`: number (string in form).
  - `chunkCount`: number (string), typically `1`.
  - `chunkIndex`: number (string), typically `0`.

**Success response**: JSON body that, after parse, is stored in `Data`. The client uses `Data.fileLink` as the photo URL. Other keys (e.g. key, location, bucket) may be present; the app only relies on `fileLink`.

**Error response**: JSON with an `error` property (string or object). The client sets `LastErrorDescription = result.error` and `Success = false`. Non-JSON or parse errors are also treated as failure.

---

### 9.2 OASIS S3 (base64)

- **URL**: From OASIS library: `_OASIS.S3WebServiceURL` (e.g. `https://0ddoc9len1.execute-api.af-south-1.amazonaws.com/v1/Dev`), or `params.customUrl` when provided.
- **Method**: POST.
- **Headers**: `Content-Type: application/json`, `UserAttr2` (from `_Session.UserAttr2` when using custom URL).
- **Body**: `{ Action: 'uploadFile', fileName, fileBase64, contentType }`.
- **Success**: Callback receives `Success: true`, `Data` (with e.g. `Location` or `Key`). `uploadToChannelBucket` uses `s3Result.Data.Location || s3Result.Data.Key || originalFileName` as the URL.

---

## 10. Configuration, URLs, and environment

### 10.1 Hardcoded URLs

- **FormData file upload**: `https://yzz5sh6s74.execute-api.af-south-1.amazonaws.com/v1/fileupload` in `common.js` line 808. Not read from config; same for all environments.
- **OASIS S3**: Must **not** be overridden in app code. Set by OASIS library (e.g. `https://0ddoc9len1.execute-api.af-south-1.amazonaws.com/v1/Dev`). Referenced in `common.js` (setOasisURLs comment), `data-functions.js`, and `appRouter.js`.

### 10.2 common.js setOasisURLs (lines 318–348)

- Sets `_OASIS.webserviceURL` and `_OASIS.cognitoAPI` per environment (Dev, Demo, UAT, Prod).
- Sets `_OASIS.customAppServicesURL = 'https://4iwaxnjooy27aeouz5rv3puk2y0nwbuo.lambda-url.af-south-1.amazonaws.com'` (no trailing slash).
- Explicitly does **not** set `S3WebServiceURL`; that comes from the OASIS library.

### 10.3 appRouter.js

- Loads environment config and sets `window._OASIS.webserviceURL`, `window._OASIS.customAppServicesURL` from config. Again notes not to set `S3WebServiceURL` and logs `S3WebServiceURL: window._OASIS.S3WebServiceURL`.

---

## 11. Error handling and return values

### 11.1 uploadFile (FormData) return shape

- **Success**: `{ Success: true, LastErrorDescription: "", Data: <parsed JSON> }`. The module uses `Data.fileLink`.
- **Failure**: `{ Success: false, LastErrorDescription: <string or error>, Data: [] }`. No throw; always resolve.

### 11.2 uploadFileAndGetUrlFromDropzone

- **Success**: Returns `uploadFile_result.Data.fileLink` (string).
- **Failure**: Throws `new Error("fileUpload Error", uploadFile_result)` (and has an unreachable `return ""`). If no file: returns `""` without throwing.

### 11.3 Module catch block

- Catches any throw from `uploadFileAndGetUrlFromDropzone` or from the “No URL returned” branch.
- Shows `_common.showErrorToast('Error uploading photo: ' + (error.message || 'Upload failed'))`, clears preview, removes file from Dropzone.

### 11.4 Backend error shape

- Backend should return JSON. If it has an `error` property, the client sets `LastErrorDescription = result.error`. So backend can use e.g. `{ error: "File too large" }` or `{ error: "Invalid type" }`.

---

## 12. Adding a new upload type

To add a new photo (or file) type in an existing module:

1. **HTML**: Add a block with `#photo_<newType>`, label, and `#preview_<newType>` (and optional `#divUploadPhoto_<newType>` wrapper). Use `accept="image/*"` or the same as other photo inputs.
2. **Photo types array**: In `initPhotoDropzones`, add `'<newType>'` to the `photoTypes` array so a hidden `#dropzone_<newType>` is created and the file input’s change handler calls `handleDropzonePhotoUpload(file, '<newType>')`.
3. **formData.photos**: Ensure when building the submit payload you include the new type (e.g. add to the list of keys you read from `formData.photos`).
4. **Validation**: If the new type is required, add it to the `requiredPhotos` (or equivalent) array in the submit handler so the user cannot submit without it.

No changes are required in `common.js` or the FormData API for a new type; the resource folder and endpoint stay the same.

---

## 13. Edge cases and notes

- **contentType with charset**: In `uploadFileAndGetUrlFromDropzone`, `contentType = splitBase64[0].split(":")[1]` can include charset (e.g. `image/jpeg;charset=utf-8`). Backend and Blob/File use this as-is.
- **compressImage and HEIC/PDF**: The list of types that trigger compression includes `heic` and `pdf`. Compression is canvas-based and outputs JPEG; HEIC/PDF may not decode in all browsers and could throw or produce wrong results.
- **file.size after base64 round-trip**: In `uploadFileAndGetUrlFromDropzone`, `fileSize` passed to `uploadFile` is the **original** file size. The re-created `File` from base64 might have a slightly different size (e.g. encoding); the backend receives the re-created file body and the original size number.
- **_controller**: Used in `setupDropzone` for the “max files” toast. If the app does not define a global `_controller` with `showToastMessage`, that path will throw when the user selects more than one file.
- **GetLinkFileNameFromURL**: Called in `setUploadFieldValue` on `_common`; implementation is not in the provided `common.js` and may come from another script. If missing, pre-fill from URL will throw.
- **Chunking**: Current usage always sends `chunkCount: 1`, `chunkIndex: 0`. The API and backend may support multi-chunk uploads in the future; the client does not implement chunking logic.
- **Duplicate upload**: If the user selects the same file again without removing, the module’s change handler does `dz.removeAllFiles()` then `dz.addFile(file)`, so only one file is in the dropzone when `uploadFileAndGetUrlFromDropzone(dz)` runs.
- **GUID**: Upload requires a valid `dataHeaderGuid` (from creating the inspection header). It is read from `_Session.dataHeaderGuid` or a module-level `dataHeaderGuid`. If missing, the module shows an error and sends the user back to step 1.

---

## 14. Macavation WebPortal: upload and routing

### 14.1 FormData upload in WebPortal (`_common.uploadFile`)

**Location**: `WebPortal/js/common.js` (approx. lines 348–381).

**Signature**: `async (params) => Promise<{ Success, LastErrorDescription, Data }>`

**Parameters**:
- `params.file`: `File` object to upload (required).
- `params.resourceFolder`: Optional. Default is **`'Macavation'`** (routing/config change: was `'EFS Assist/PreInspections/'`; now configurable per app).
- `params.fileId`: Optional. Defaults to `file.name` or `'upload'`.

**Behaviour**:
1. Builds `FormData` with: `files`, `resourceFolder`, `fileId`, `fileSize`, `chunkCount: 1`, `chunkIndex: 0`.
2. `POST` to `https://yzz5sh6s74.execute-api.af-south-1.amazonaws.com/v1/fileupload` (same API as Capture-Data).
3. Parses JSON response; if `result.error` then returns `{ Success: false, LastErrorDescription: result.error, Data: [] }`, else `{ Success: true, LastErrorDescription: '', Data: result }`. Callers use `Data.fileLink` for the uploaded file URL.

No image compression or Dropzone; suitable for PDFs and other files.

---

### 14.2 End-sample modal: lab test PDF upload

**Purpose**: In the PACKING (End Sample) modal, users can attach a lab test report as a PDF. The file is uploaded to S3 and the returned URL is saved with the packing sample.

**HTML** (`WebPortal/modules/modals/modal-end-sample/html/modal_end_sample.html`):
- Block ID: `#divUploadLabTestPdf`.
- File input: `#endSampleLabTestPdf` with `accept=".pdf,application/pdf"`.
- Helper text: “Upload a PDF of the lab test report (max 10MB)”.
- Preview container: `#endSampleLabTestPdfPreview` (shows link + remove button after upload).

**JS** (`WebPortal/modules/modals/modal-end-sample/js/modal_end_sample.js`):
- Module-level `labTestPdfUrl` holds the uploaded URL.
- `init()`: Binds `change` on `#endSampleLabTestPdf` to `handleLabTestPdfSelect`.
- `show(batchId)`: Clears `labTestPdfUrl`, file input, and preview.
- `handleLabTestPdfSelect(e)`: Validates single PDF, max 10 MB; shows “Uploading…”; calls `_common.uploadFile({ file, resourceFolder: 'EFS Assist/PreInspections/', fileId: file.name })` (modal can override resourceFolder if needed). On success sets `labTestPdfUrl`, renders link + remove button; on error toasts and clears input.
- `saveEndSample()`: Includes `lab_test_pdf_url: labTestPdfUrl || null` in the payload to `dataFunctions.createKernelPackingSample(data)`. Backend must accept and store `lab_test_pdf_url` if persistence is required.

---

### 14.3 Routing and modal loading

**Route config** (`WebPortal/js/appRouteConfig.json`):
- **Route name**: `"end-sample-modal"`.
- **Description**: “End Sample Modal”.
- **Path**: `"modals/modal-end-sample"`.
- **Assets**: `html/modal_end_sample.html`, `js/modal_end_sample.js`, `css/modal_end_sample.css`.

**Modal placement**: The app router loads modal content into placeholders by route name. The End Sample modal placeholder is in the kernel production grid:
- **File**: `WebPortal/modules/kernel-production/html/kernel_production_grid.html`.
- **Placeholder**: `<div class="modal fade" … id="endSampleModal" … route-name="end-sample-modal" …></div>`.
- The router injects the modal HTML/JS/CSS for `end-sample-modal` into this div and initializes the modal (e.g. `_modal_end_sample.init()`).

**Opening the modal**: From the kernel production grid, e.g. “End sample” action with `data-batch-id` triggers `_modal_end_sample.show(batchId)`. The modal is shown via Bootstrap `Modal.getOrCreateInstance(modalEl).show()`.

**Related route**: `"end-sample-view-modal"` (path `modals/modal-end-sample-view`) is used for the read-only PACKING view modal; it does not perform uploads.

---

This document reflects the code as of the reviewed files and is intended as the single exhaustive reference for S3 upload behaviour in Capture-Data and Macavation WebPortal.
