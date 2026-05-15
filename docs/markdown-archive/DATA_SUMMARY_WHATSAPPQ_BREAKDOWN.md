# Data Summary → WhatsappQ: Breakdown

This doc describes how **hatchability, feed, weight, and bird adjustment** push to the WhatsappQ and then send by GUID.  
**Data summary does NOT use InsertLayProductionWhatsappQ.** You are creating a **new SP** for this; the front-end will call that new SP only.



---

## How Lay Production does it (reference only – we do not use this for data summary)

1. **success.js** builds queue params from `_Session.FormData` and calls **InsertLayProductionWhatsappQ** (SP: `sp_insertLayProductionWhatsappQ`).
2. **Queue params** include: `prmFarmGUID`, `prmFlockGUID`, `prmSiteName`, `prmLayerName`, `prmSummaryMessage`, `prmWeekNumber`, `prmFarmName`, `prmSubmittedBy`.
3. **SP returns** `Data` with at least one row containing `UniqueGUID` and `SendMessage` (whether to send).
4. If `SendMessage === 1/true` and `UniqueGUID` exists, **success.js** calls **whatsapp_messager.sendLayProductionWithGUID(uniqueGUID, callback)**.
5. **sendLayProductionWithGUID** loops over `_Session.GroupMembers` and for each calls **EggsightSendLayProductionMessage({ prmUniqueGUID, prmMobileNumber }, callback)**.  
   So: **one queue row per “event”**, then **one send API call per recipient** using the same GUID.

---

## Target flow for Data Summary (feed, weight, bird, hatchability)

1. **Build payload**: one **JSON per layer/flock** with the fields needed for the message template (see WHATSAPP_MESSAGE_FORMAT.md: Date, Farm, Site, Layer, Week, Female Birds, Male Birds + message type).
2. **Push to Q**: call **your new SP** (name TBD) with that JSON – once per layer/flock, or pass an array of JSONs if the SP accepts batch. We do **not** use InsertLayProductionWhatsappQ.
3. **SP returns** UniqueGUID (and optionally SendMessage) per row queued.
4. **Send by GUID**: for each returned UniqueGUID, call the send-by-GUID API once per group member; backend builds the message from the stored row and sends it.

Flow: **Push one JSON per layer/flock → your new SP → returns GUID(s) → send by GUID per recipient**.

---

## 1. Backend: sp_InsertWhatsAppQ and send API

### 1.1 SP in use: sp_InsertWhatsAppQ

- **SP:** `[dbo].[sp_InsertWhatsAppQ]` – general-purpose insert into WhatsAppQ. Front-end does **not** use InsertLayProductionWhatsappQ for data summary.
- **Payload:** We push **one JSON per layer/flock** in `prmMessageData`. The JSON contains the fields needed to build the sent message (Date, Farm, Site, Layer, Week, Female Birds, Male Birds, MessageType – see WHATSAPP_MESSAGE_FORMAT.md).

**Input params (exact):**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prmFarmGUID` | NVARCHAR(50) | Yes | Farm GUID |
| `prmMessageType` | NVARCHAR(50) | Yes | e.g. `'Feed'`, `'Weight'`, `'BirdAdjustment'`, `'Hatchability'` (or `'BroilerProduction'`, `'Alert'`, `'Notification'` per SP comment) |
| `prmMessageData` | NVARCHAR(MAX) | Yes | Valid JSON string (one object per layer/flock with date, farmName, siteName, layerName, week, femaleBirds, maleBirds, etc.) |
| `prmSubmittedBy` | NVARCHAR(100) | Yes | User identifier (e.g. email or UserGUID) |

**Returned result set (on success):**

- `Status` = `'SUCCESS'`
- `UniqueGUID` – queue row GUID (use for send-by-GUID API)
- `MessageType`
- `MessageSent` = 1 (ready for JS to deliver)

On error the SP returns `Status` = `'ERROR'`, `ErrorMessage`, and no `UniqueGUID`.

**Target message outcome:** See **WHATSAPP_MESSAGE_FORMAT.md**. When sending by GUID, the send API builds the message from the stored MessageData JSON ({{1}}–{{7}} + footer).

### 1.2 Send message by GUID

- **API (e.g. custom app service):** **EggsightSendDataSummaryMessage** (or similar name).
- **Role:** Given a **UniqueGUID** (from the queue) and a **mobile number**, load the queue row by GUID, build the template from stored fields, and send the WhatsApp message to that number.  
  So: same contract as **EggsightSendLayProductionMessage** but for data-summary rows.

**Suggested input params:**

| Param | Type | Description |
|-------|------|-------------|
| `prmUniqueGUID` | uniqueidentifier | From `sp_InsertWhatsAppQ` |
| `prmMobileNumber` | varchar | Recipient number |

Message body is built from the queue row ({{1}}–{{7}} + footer from MessageType).

---

## 2. Front-end: data-functions.js

**Added:** `InsertWhatsAppQ(params, callback)` – calls `sp_InsertWhatsAppQ`.

- **Params:** `{ prmFarmGUID, prmMessageType, prmMessageData, prmSubmittedBy }`. `prmMessageData` must be a **JSON string** (one object per layer/flock with date, farmName, siteName, layerName, week, femaleBirds, maleBirds, messageType).
- **Callback:** receives the service result. On success, `result.Data` (or first row) has `Status` = `'SUCCESS'`, `UniqueGUID`, `MessageType`, `MessageSent`. Use `UniqueGUID` for the send-by-GUID API.

When the send-by-GUID API exists, add **EggsightSendDataSummaryMessage(params, callback)**  
   - Calls the new send-by-GUID API (e.g. `EggSight_SendDataSummaryMessage` service key) with `prmUniqueGUID` and `prmMobileNumber`.  
   - Same async/callback pattern as **EggsightSendLayProductionMessage**.

Use the same environment logic (Prod/Dev/Demo and service key suffix) as **EggSightSendDataSummary** / **EggsightSendLayProductionMessage** so the correct backend is used.

---

## 3. Front-end: whatsapp_messager.js

### 3.1 Replace direct send with “queue then send by GUID”

Today, each of the four message types builds a payload and calls **sendToGroupMembers(messageData, callback)**, which loops recipients and calls **EggSightSendDataSummary(recipientData)** (direct send).

Change to:

1. For each **layer/flock**, build one **JSON** with the fields needed for the message template (see WHATSAPP_MESSAGE_FORMAT.md): Date {{1}}, Farm {{2}}, Site {{3}}, Layer {{4}}, Week {{5}}, Female Birds {{6}}, Male Birds {{7}}, plus MessageType for the footer. Hatchability: omit or null {{6}}/{{7}}.
2. Call **DataFunctions.InsertWhatsAppQ** with `prmFarmGUID`, `prmMessageType`, `prmMessageData` (JSON string for that layer/flock), `prmSubmittedBy` – **one call per layer/flock**.
3. On success, from the result take `result.Data[0].Status === 'SUCCESS'` and `result.Data[0].UniqueGUID`.
4. If send is required, call a new **sendDataSummaryWithGUID(uniqueGUID, callback)** that:
   - Gets `_Session.GroupMembers` (or current user only if no group).
   - For each member, calls **EggsightSendDataSummaryMessage({ prmUniqueGUID: uniqueGUID, prmMobileNumber: member.CellphoneNumber }, callback)**.
   - Tracks completion and calls the outer callback when all recipients are done (and optionally logs success/failure like **sendLayProductionWithGUID**).

So: **one queue insert per message type** (feeding, weight, bird, hatchability) → **one UniqueGUID per type** → **N send API calls per type** (N = number of group members).

### 3.2 Keep the same “trigger” entry points

- **triggerFeedingMessages(weekNumber, callback)**  
  Build feed payload → **InsertDataSummaryWhatsappQ** (Feed) → **sendDataSummaryWithGUID(uniqueGUID, callback)**.  
  Same for **triggerWeightMessages**, **triggerBirdAdjustmentMessages**, and for hatchability when coming from success (e.g. **sendHatchabilityUpdate**).

- **processWhatsAppMessages** (when used for hatchability from success):  
  Build hatchability payload → **InsertDataSummaryWhatsappQ** (Hatchability) → **sendDataSummaryWithGUID(uniqueGUID, callback)**.

So the **breakdown of how you’ll do it** is:

- **Queue:** One new SP `sp_insertDataSummaryWhatsappQ` + one new data-function **InsertDataSummaryWhatsappQ**.
- **Send:** One new send-by-GUID API + one new data-function **EggsightSendDataSummaryMessage**.
- **Messager:** For each of the four types, replace “build payload → sendToGroupMembers(EggSightSendDataSummary)” with “build payload → InsertDataSummaryWhatsappQ → sendDataSummaryWithGUID(uniqueGUID)”.  
  Lay production already does “queue → sendLayProductionWithGUID”; data summary will do “queue → sendDataSummaryWithGUID” in the same way.

---

## 4. success.js

- **handleSaveComplete** can stay as is: it still calls **triggerFeedingMessages**, **triggerWeightMessages**, **triggerBirdAdjustmentMessages**, and **queueWhatsAppMessage** (lay production).  
- The only change is **inside** those trigger functions and **sendHatchabilityUpdate**: they no longer call **sendToGroupMembers** with **EggSightSendDataSummary**; they call **InsertDataSummaryWhatsappQ** then **sendDataSummaryWithGUID**.  
- **totalMessages** and **checkAllMessagesComplete** logic remain (still 4 operations: feed, weight, bird, lay production; hatchability is separate path when module type is hatchability).

If hatchability is triggered from a different flow (e.g. success after hatchability save), that path should also use: build payload → **InsertDataSummaryWhatsappQ** (Hatchability) → **sendDataSummaryWithGUID**.

---

## 5. Summary table

| Step | Lay production (current) | Data summary (new) |
|------|---------------------------|--------------------|
| 1. Build payload | success.js: summary string + queue params | whatsapp_messager: **one JSON per layer/flock** (Date, Farm, Site, Layer, Week, FemaleBirds, MaleBirds, MessageType – see WHATSAPP_MESSAGE_FORMAT.md) |
| 2. Queue | **InsertLayProductionWhatsappQ** → SP returns UniqueGUID, SendMessage | **Your new SP** (not InsertLayProductionWhatsappQ) – pass JSON per layer/flock → returns UniqueGUID, SendMessage |
| 3. Send | **sendLayProductionWithGUID(uniqueGUID)** → per member **EggsightSendLayProductionMessage** | **sendDataSummaryWithGUID(uniqueGUID)** → per member **EggsightSendDataSummaryMessage** |

Once your new SP and send-by-GUID API exist, the front-end will: add a data-function that calls **your new SP** with **one JSON per layer/flock** (not InsertLayProductionWhatsappQ), add **EggsightSendDataSummaryMessage**, and in whatsapp_messager switch each of the four data-summary flows to queue (push JSON per layer/flock) then **sendDataSummaryWithGUID**.
