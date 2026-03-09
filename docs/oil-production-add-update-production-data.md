# Oil Production — Add/Edit production data

## Oil batch number format (same from start of flow)

All oil-related batch numbers use the same format **OIL-YYYY-MM-NNN** (e.g. OIL-2026-03-001) and a **single shared sequence**. Whether a batch is created via **Start oil bin** (Oil bin batches) or via **Supplier Intake** / **upsert_oil_batch** (create), the next number is taken from one sequence so there is no duplicate and the format is consistent from the start of the flow. The backend function `get_next_oil_batch_number(date)` considers both `oil.batch_id` and `oil_bin_batch.batch_number` when computing the next NNN for that month.

---

## How to use (user navigation)

### 1. From **Raw ingredients in production**

- Open **Oil Production** (main menu).
- In the **Raw ingredients in production** card you see batches released from Supplier Intake (status = production).
- Each row has an **Actions** column with a **"Production data"** button.
- Click **Production data** for the batch you want.
- The **Add/Edit production data** modal opens for that oil batch (batch number shown at the top).
- Fill or change: **Basic** (batch number of product produced, name of product, shift supervisor, shift), **Raw materials** (add rows: batch number, weight in, oil out, cake out), **Oil bin details** (add rows: IBC/bin, literage, start/end time), **Waste** (general, floor, product waste in kg).
- Use **Add row** under Raw materials and Oil bin details for multiple lines. Use the **×** next to a row to remove it.
- Click **Save** to store. The modal closes and the list refreshes.

### 2. From **Oil bin batches (production)**

- In the **Oil bin batches (production)** card, batches that have been **sent to stock** show **"Sent"** and a **"Production data"** button in the **Actions** column.
- Click **Production data** for that batch.
- The same **Add/Edit production data** modal opens for the oil batch that was created when you sent the bin to stock (batch number e.g. OIL-2026-03-001).
- Edit the same fields as above and click **Save**.

### Summary

| Where | Action | Result |
|-------|--------|--------|
| Raw ingredients table | Click **Production data** on a row | Open production data for that oil batch (in production). |
| Oil bin batches table (row already **Sent**) | Click **Production data** | Open production data for the oil batch that was created when that bin was sent to stock. |

Data is stored in the oil batch’s **production_data** (basic info, raw_materials, oil_bin_details, waste). Saving merges your changes with any existing production_data so other fields (e.g. GMP) are not lost.
