/**
 * Client-side mirror of server job-card → stock on hand (packing_data / get_kernel_batches keys).
 * Used for live preview on the job card modal; authoritative values come from DB after save.
 */
var _kernelJobCardStock = (function () {
    'use strict';

    var KG_PER_CARTON = 11.34;
    var STOCK_STYLE_KEYS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];

    function parseLocaleNumber(val) {
        if (val == null || val === '') return 0;
        var s = String(val).trim().replace(/\s/g, '');
        if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) {
            s = s.replace(',', '.');
        } else if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
            s = s.replace(/,/g, '');
        }
        var n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    }

    function parseStyleRows(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') {
            try {
                var parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    function rowCartons(row) {
        return parseInt(row && row.cartons, 10) || 0;
    }

    function rowKg(row) {
        var kg = parseLocaleNumber(row && row.weight_kg);
        if (kg > 0) return kg;
        kg = parseLocaleNumber(row && row.kg);
        if (kg > 0) return kg;
        kg = parseLocaleNumber(row && row.weight);
        return kg > 0 ? kg : 0;
    }

    function normalizeLine(row) {
        var cartons = rowCartons(row);
        var kg = rowKg(row);
        if (kg <= 0 && cartons > 0) kg = Math.round(cartons * KG_PER_CARTON * 100) / 100;
        if (cartons <= 0 && kg > 0) cartons = Math.round((kg / KG_PER_CARTON) * 100) / 100;
        return { cartons: cartons, kg: kg };
    }

    function mapSoundStyle(style) {
        var s = String(style || '').toUpperCase().trim();
        if (['SP', '0', '1', '1S', '4L', '5', '6'].indexOf(s) >= 0) return s;
        return null;
    }

    function mapButterStyle(style) {
        var s = String(style || '').toUpperCase();
        if (s.indexOf('7/8') >= 0 || s === '78') return '7/8';
        if (s.indexOf('HIGH') >= 0 || s.indexOf('FLOAT') >= 0) return 'Butter High Oil';
        if (s.indexOf('LOW') >= 0 || s.indexOf('SINK') >= 0) return 'Butter Low Oil';
        return null;
    }

    function emptyStockMaps() {
        var cartons = {};
        var kg = {};
        STOCK_STYLE_KEYS.forEach(function (k) {
            cartons[k] = 0;
            kg[k] = 0;
        });
        return { cartons: cartons, kg: kg };
    }

    function collectStyleRowsFromDom() {
        var sound = [];
        $('#soundKernelTableBody tr').each(function () {
            var style = $(this).find('select[name="style"]').val();
            var cartons = parseInt($(this).find('input[name="cartons"]').val(), 10) || 0;
            var weight = parseLocaleNumber($(this).find('input[name="weight_kg"]').val());
            if (style && (cartons > 0 || weight > 0)) sound.push({ style: style, cartons: cartons, weight_kg: weight });
        });
        var butter = [];
        $('#butterGradeTableBody tr').each(function () {
            var style = $(this).find('select[name="style"]').val();
            var cartons = parseInt($(this).find('input[name="cartons"]').val(), 10) || 0;
            var weight = parseLocaleNumber($(this).find('input[name="weight_kg"]').val());
            if (style && (cartons > 0 || weight > 0)) butter.push({ style: style, cartons: cartons, weight_kg: weight });
        });
        return { sound_kernel_styles: sound, butter_grade_styles: butter };
    }

    function buildStockFromJobCardData(jobCardData) {
        var out = emptyStockMaps();
        if (!jobCardData) return out;
        var sound = parseStyleRows(jobCardData.sound_kernel_styles);
        var butter = parseStyleRows(jobCardData.butter_grade_styles);
        sound.forEach(function (row) {
            var key = mapSoundStyle(row.style);
            if (!key) return;
            var line = normalizeLine(row);
            if (line.cartons <= 0 && line.kg <= 0) return;
            out.cartons[key] = (out.cartons[key] || 0) + line.cartons;
            out.kg[key] = Math.round(((out.kg[key] || 0) + line.kg) * 100) / 100;
        });
        butter.forEach(function (row) {
            var key = mapButterStyle(row.style);
            if (!key) return;
            var line = normalizeLine(row);
            if (line.cartons <= 0 && line.kg <= 0) return;
            out.cartons[key] = (out.cartons[key] || 0) + line.cartons;
            out.kg[key] = Math.round(((out.kg[key] || 0) + line.kg) * 100) / 100;
        });
        return out;
    }

    function hasStockQuantities(jobCardData) {
        if (!jobCardData) return false;
        var stock = buildStockFromJobCardData(jobCardData);
        return STOCK_STYLE_KEYS.some(function (k) {
            return (stock.cartons[k] || 0) > 0 || (stock.kg[k] || 0) > 0;
        });
    }

    function renderPreviewTable($tbody) {
        if (!$tbody || !$tbody.length) return;
        var data = collectStyleRowsFromDom();
        var stock = buildStockFromJobCardData(data);
        var rows = STOCK_STYLE_KEYS.filter(function (k) {
            return (stock.cartons[k] || 0) > 0 || (stock.kg[k] || 0) > 0;
        });
        if (!rows.length) {
            $tbody.html('<tr><td colspan="3" class="text-muted small">Enter cartons or kg on style lines above — preview of stock after Jobcard approved.</td></tr>');
            return;
        }
        var html = rows.map(function (k) {
            var c = stock.cartons[k] || 0;
            var kg = stock.kg[k] || 0;
            return '<tr><td>' + k + '</td><td class="text-end">' + c + '</td><td class="text-end">' + kg.toFixed(2) + '</td></tr>';
        }).join('');
        $tbody.html(html);
    }

    return {
        STOCK_STYLE_KEYS: STOCK_STYLE_KEYS,
        KG_PER_CARTON: KG_PER_CARTON,
        parseStyleRows: parseStyleRows,
        buildStockFromJobCardData: buildStockFromJobCardData,
        collectStyleRowsFromDom: collectStyleRowsFromDom,
        hasStockQuantities: hasStockQuantities,
        renderPreviewTable: renderPreviewTable,
        parseLocaleNumber: parseLocaleNumber
    };
})();
