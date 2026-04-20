# Generates migrations/20260410120000_seed_oil_stock_soh_ye25_xlsx.sql from the YE'25 SOH workbook.
# Requires Excel on Windows. Source: Downloads path below (override with -XlsxPath).

param(
    [string]$XlsxPath = "$env:USERPROFILE\Downloads\Macadamia Oil SOH and Production Figures YE'25 (12).xlsx",
    [string]$OutSql = "$PSScriptRoot\..\migrations\20260410120000_seed_oil_stock_soh_ye25_xlsx.sql"
)

$ErrorActionPreference = 'Stop'
$seedTag = 'SOH YE25 xlsx seed v1'

function SqlEscape([string]$s) {
    if ($null -eq $s) { return '' }
    return $s.Replace("'", "''")
}

function ParseEuroNumber([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return $null }
    $t = $s.Trim() -replace '\s', '' -replace '%', '' -replace ',', '.'
    if ($t -eq '' -or $t -eq '-') { return $null }
    $n = 0.0
    if ([double]::TryParse($t, [System.Globalization.NumberStyles]::Any, [cultureinfo]::InvariantCulture, [ref]$n)) { return $n }
    return $null
}

function ParseSqlDate([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return $null }
    $t = $s.Trim()
    if ($t -match '^190[01]/') { return $null }
    if ($t -match '^(\d{4})/(\d{1,2})/(\d{1,2})') {
        $y = [int]$Matches[1]; $m = [int]$Matches[2]; $d = [int]$Matches[3]
        if ($y -lt 1950) { return $null }
        return "{0:0000}-{1:00}-{2:00}" -f $y, $m, $d
    }
    return $null
}

function FindHeaderMap($ws, $maxScanRows, $needles) {
    $used = $ws.UsedRange
    if ($null -eq $used) { return $null }
    $maxR = [Math]::Min($used.Rows.Count, $maxScanRows)
    $maxC = [Math]::Min($used.Columns.Count, 20)
    for ($r = 1; $r -le $maxR; $r++) {
        $rowMap = @{}
        for ($c = 1; $c -le $maxC; $c++) {
            $h = ($ws.Cells.Item($r, $c).Text + '').Trim().ToLowerInvariant()
            foreach ($kv in $needles.GetEnumerator()) {
                if ($h -eq $kv.Value) { $rowMap[$kv.Key] = $c }
            }
        }
        $ok = $true
        foreach ($k in $needles.Keys) {
            if (-not $rowMap.ContainsKey($k)) { $ok = $false; break }
        }
        if ($ok) { return @{ Row = $r; Col = $rowMap } }
    }
    return $null
}

function EmitLotInsert($sb, $row) {
    $loc = SqlEscape $row.location_code
    $cat = SqlEscape $row.stock_category
    $stat = SqlEscape $row.status
    $ct = if ($row.counterparty_type) { "'" + (SqlEscape $row.counterparty_type) + "'" } else { 'NULL' }
    $cn = if ($row.counterparty_name) { "'" + (SqlEscape $row.counterparty_name) + "'" } else { 'NULL' }
    $po = if ($row.po_reference) { "'" + (SqlEscape $row.po_reference) + "'" } else { 'NULL' }
    $bn = if ($row.batch_number) { "'" + (SqlEscape $row.batch_number) + "'" } else { 'NULL' }
    $pc = if ($row.product_code) { "'" + (SqlEscape $row.product_code) + "'" } else { 'NULL' }
    $pd = if ($row.product_description) { "'" + (SqlEscape $row.product_description) + "'" } else { 'NULL' }
    $gr = if ($row.grade) { "'" + (SqlEscape $row.grade) + "'" } else { 'NULL' }
    $ffa = if ($null -ne $row.ffa) { $row.ffa.ToString([cultureinfo]::InvariantCulture) } else { 'NULL' }
    $coa = if ($row.coa_status) { "'" + (SqlEscape $row.coa_status) + "'" } else { 'NULL' }
    $vol = if ($null -ne $row.volume) { $row.volume.ToString([cultureinfo]::InvariantCulture) } else { 'NULL' }
    $kg = $row.kilograms.ToString([cultureinfo]::InvariantCulture)
    $dd = if ($row.delivery_date) { "'" + $row.delivery_date + "'" } else { 'NULL' }
    $md = if ($row.manufacture_date) { "'" + $row.manufacture_date + "'" } else { 'NULL' }
    $bbd = if ($row.bb_date) { "'" + $row.bb_date + "'" } else { 'NULL' }
    $notes = "'" + (SqlEscape $row.notes) + "'"

    [void]$sb.AppendLine(@"
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '$loc', '$cat', '$stat', $ct, $cn, NULL,
  $po, $bn, $pc, $pd, $gr, $ffa, $coa, NULL, $vol,
  $kg, $dd, $md, $bbd, $notes, true, now(), now()
);
"@)
}

if (-not (Test-Path -LiteralPath $XlsxPath)) {
    Write-Error "Workbook not found: $XlsxPath"
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($XlsxPath)

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine(@"
-- Seed oil_stock_lots from Macadamia Oil SOH and Production Figures YE'25 (12).xlsx
-- Sheets: RM SOH - 801 (supplier-level raws), FG SOH - 850 (finished on hand), PROTEIN POWDER SOH, Sold (historical dispatch).
-- Skipped: YE'25/YE'26 Production, Forecast, pivot-only blocks (no batch-level rows).
-- Idempotent: delete prior rows tagged in notes, then insert.

DELETE FROM public.oil_stock_lots
WHERE notes = '$seedTag';

"@)

# --- FG SOH - 850 (finished_good, on_hand, location 850) ---
$wsFg = $wb.Worksheets.Item('FG SOH - 850')
$hdrFg = FindHeaderMap $wsFg 120 @{
    consolidated = 'consolidated'
    customer     = 'customer'
    batch        = 'batch #'
    grade        = 'grade'
    ffa          = 'ffa'
    coa          = 'coa status'
    volume       = 'volume'
    kg           = 'kilograms'
    mfg          = 'manufacture date'
    bb           = 'bb date'
}
if ($null -eq $hdrFg) { Write-Error "FG SOH - 850: could not find detail header row" }
$cFg = $hdrFg.Col
$r0 = $hdrFg.Row + 1
$usedFg = $wsFg.UsedRange
for ($r = $r0; $r -le $usedFg.Rows.Count; $r++) {
    $batch = ($wsFg.Cells.Item($r, $cFg.batch).Text + '').Trim()
    if ($batch -eq '' -or $batch -like '*batch*') { continue }
    if ($batch -match '^(Row Labels|Grand Total|Average of|Sum of)') { continue }
    $kgRaw = ($wsFg.Cells.Item($r, $cFg.kg).Text + '').Trim()
    $kg = ParseEuroNumber $kgRaw
    if ($null -eq $kg -or $kg -le 0) { continue }

    $customer = ($wsFg.Cells.Item($r, $cFg.customer).Text + '').Trim()
    if ($customer -match '^Unassigned$|^Decanting sample$' -or $customer -eq '') { $customer = $null }

    $row = [ordered]@{
        location_code       = '850'
        stock_category      = 'finished_good'
        status              = 'on_hand'
        counterparty_type   = $(if ($customer) { 'customer' } else { $null })
        counterparty_name   = $customer
        po_reference        = (($wsFg.Cells.Item($r, $cFg.consolidated).Text + '').Trim())
        batch_number        = $batch
        product_code        = $null
        product_description = $null
        grade               = (($wsFg.Cells.Item($r, $cFg.grade).Text + '').Trim())
        ffa                 = (ParseEuroNumber ($wsFg.Cells.Item($r, $cFg.ffa).Text + ''))
        coa_status          = (($wsFg.Cells.Item($r, $cFg.coa).Text + '').Trim())
        volume              = (ParseEuroNumber ($wsFg.Cells.Item($r, $cFg.volume).Text + ''))
        kilograms           = $kg
        delivery_date       = $null
        manufacture_date    = (ParseSqlDate ($wsFg.Cells.Item($r, $cFg.mfg).Text + ''))
        bb_date             = (ParseSqlDate ($wsFg.Cells.Item($r, $cFg.bb).Text + ''))
        notes               = $seedTag
    }
    EmitLotInsert $sb ([pscustomobject]$row)
}

# --- Sold (sold, location 850) ---
$wsSo = $wb.Worksheets.Item('Sold')
$hdrSo = FindHeaderMap $wsSo 120 @{
    dispatched   = 'date dispatched'
    consolidated = 'consolidated'
    customer     = 'customer'
    batch        = 'batch #'
    grade        = 'grade'
    ffa          = 'ffa'
    coa          = 'coa status'
    volume       = 'volume'
    kg           = 'kilograms'
    mfg          = 'manufacture date'
    bb           = 'bb date'
}
if ($null -eq $hdrSo) { Write-Error "Sold: could not find detail header row" }
$cSo = $hdrSo.Col
$r0s = $hdrSo.Row + 1
$usedSo = $wsSo.UsedRange
for ($r = $r0s; $r -le $usedSo.Rows.Count; $r++) {
    $batch = ($wsSo.Cells.Item($r, $cSo.batch).Text + '').Trim()
    if ($batch -eq '' -or $batch -like '*batch*') { continue }
    if ($batch -match '^(Row Labels|Grand Total)') { continue }
    $kgRaw = ($wsSo.Cells.Item($r, $cSo.kg).Text + '').Trim()
    $kg = ParseEuroNumber $kgRaw
    if ($null -eq $kg -or $kg -le 0) { continue }
    if ($batch -match '(?i)sample') { continue }

    $customer = ($wsSo.Cells.Item($r, $cSo.customer).Text + '').Trim()
    if ($customer -match '^Unassigned$' -or $customer -eq '') { $customer = $null }

    $row = [ordered]@{
        location_code       = '850'
        stock_category      = 'sold'
        status              = 'sold'
        counterparty_type   = $(if ($customer) { 'customer' } else { $null })
        counterparty_name   = $customer
        po_reference        = (($wsSo.Cells.Item($r, $cSo.consolidated).Text + '').Trim())
        batch_number        = $batch
        product_code        = $null
        product_description = $null
        grade               = (($wsSo.Cells.Item($r, $cSo.grade).Text + '').Trim())
        ffa                 = (ParseEuroNumber ($wsSo.Cells.Item($r, $cSo.ffa).Text + ''))
        coa_status          = (($wsSo.Cells.Item($r, $cSo.coa).Text + '').Trim())
        volume              = (ParseEuroNumber ($wsSo.Cells.Item($r, $cSo.volume).Text + ''))
        kilograms           = $kg
        delivery_date       = (ParseSqlDate ($wsSo.Cells.Item($r, $cSo.dispatched).Text + ''))
        manufacture_date    = (ParseSqlDate ($wsSo.Cells.Item($r, $cSo.mfg).Text + ''))
        bb_date             = (ParseSqlDate ($wsSo.Cells.Item($r, $cSo.bb).Text + ''))
        notes               = $seedTag
    }
    EmitLotInsert $sb ([pscustomobject]$row)
}

# --- RM SOH - 801: pivot detail (supplier rows under each ZRN* product) ---
$wsRm = $wb.Worksheets.Item('RM SOH - 801')
$maxR = [Math]::Min($wsRm.UsedRange.Rows.Count, 80)
$currentProduct = $null
$currentCode = $null
for ($r = 1; $r -le $maxR; $r++) {
    $a = ($wsRm.Cells.Item($r, 2).Text + '').Trim()
    if ($a -eq '' -or $a -eq 'Row Labels') { continue }
    if ($a -match '^Grand Total') { break }
    if ($a -match '^ZRN') {
        $currentProduct = $a
        if ($a -match '^(ZRN[A-Z]+)') { $currentCode = $Matches[1] } else { $currentCode = $null }
        continue
    }
    $b = ($wsRm.Cells.Item($r, 3).Text + '').Trim()
    $c = ($wsRm.Cells.Item($r, 4).Text + '').Trim()
    $kg = ParseEuroNumber $c
    if ($null -eq $kg -or $kg -le 0) { continue }
    if ($null -eq $currentProduct) { continue }

    $ffa = ParseEuroNumber ($b -replace '%', '')

    $row = [ordered]@{
        location_code       = '801'
        stock_category      = 'raw_material'
        status              = 'on_hand'
        counterparty_type   = 'supplier'
        counterparty_name   = $a
        po_reference        = $null
        batch_number        = $null
        product_code        = $currentCode
        product_description = $currentProduct
        grade               = $null
        ffa                 = $ffa
        coa_status          = $null
        volume              = $null
        kilograms           = $kg
        delivery_date       = $null
        manufacture_date    = $null
        bb_date             = $null
        notes               = $seedTag
    }
    EmitLotInsert $sb ([pscustomobject]$row)
}

# --- Protein powder (850, finished_good, grade for UI split) ---
$wsPp = $wb.Worksheets.Item('PROTEIN POWDER SOH')
# Headers often start in col C (cols A–B empty): DATE | AMOUNT | GRADE | BATCH
$ppDateCol = 3
$ppAmtCol = 4
$ppGradeCol = 5
$ppNoteCol = 6
for ($hr = 1; $hr -le 8; $hr++) {
    for ($hc = 1; $hc -le 8; $hc++) {
        $ht = ($wsPp.Cells.Item($hr, $hc).Text + '').Trim().ToLowerInvariant()
        if ($ht -eq 'date') { $ppDateCol = $hc; break }
    }
}
for ($hr = 1; $hr -le 8; $hr++) {
    for ($hc = 1; $hc -le 8; $hc++) {
        $ht = ($wsPp.Cells.Item($hr, $hc).Text + '').Trim().ToLowerInvariant()
        if ($ht -eq 'amount') { $ppAmtCol = $hc; break }
    }
}
for ($hr = 1; $hr -le 8; $hr++) {
    for ($hc = 1; $hc -le 8; $hc++) {
        $ht = ($wsPp.Cells.Item($hr, $hc).Text + '').Trim().ToLowerInvariant()
        if ($ht -eq 'grade') { $ppGradeCol = $hc; $ppNoteCol = $hc + 2; break }
    }
}
for ($pr = 3; $pr -le 12; $pr++) {
    $dLabel = ($wsPp.Cells.Item($pr, $ppDateCol).Text + '').Trim()
    $amt = ($wsPp.Cells.Item($pr, $ppAmtCol).Text + '').Trim()
    $gr = ($wsPp.Cells.Item($pr, $ppGradeCol).Text + '').Trim()
    $extra = ($wsPp.Cells.Item($pr, $ppNoteCol).Text + '').Trim()
    if ($dLabel -eq '' -or $dLabel -match '^DATE') { continue }
    $kg = ParseEuroNumber ($amt -replace '(?i)kg', '')
    if ($null -eq $kg -or $kg -le 0) { continue }
    $note = $seedTag
    if ($extra) { $note = $seedTag + ' - ' + $extra }

    $gradeUi = 'Protein powder'
    if ($gr -and $gr.Trim() -ne '') {
        $gradeUi = 'Protein powder (' + $gr.Trim() + ')'
    }

    $row = [ordered]@{
        location_code       = '850'
        stock_category      = 'finished_good'
        status              = 'on_hand'
        counterparty_type   = $null
        counterparty_name   = $null
        po_reference        = $null
        batch_number        = $null
        product_code        = $null
        product_description = 'Protein powder'
        grade               = $gradeUi
        ffa                 = $null
        coa_status          = $null
        volume              = $null
        kilograms           = $kg
        delivery_date       = $null
        manufacture_date    = $null
        bb_date             = $null
        notes               = $note
    }
    EmitLotInsert $sb ([pscustomobject]$row)
}

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null

$dir = Split-Path -Parent $OutSql
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
[System.IO.File]::WriteAllText($OutSql, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $OutSql"
