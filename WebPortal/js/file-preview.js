/**
 * FilePreview - shows attached files as small preview tiles (like a folder in "Large icons" view)
 * instead of bare text links. Mike, 16 Nov 2026: "a brief preview of the attachment".
 *
 *   Photos -> the picture itself, cropped to the tile.
 *   PDFs   -> a picture of page 1 (pdf.js, loaded from cdnjs only when the first PDF tile shows),
 *             falling back to a PDF icon if the file cannot be read.
 *   Other  -> a file-type icon.
 * Clicking a tile opens the file in a new tab, exactly as the old link did.
 *
 * Files are the shape every module already stores: { name, file_link } (file_id is ignored).
 * A plain URL string is accepted too. Only http(s) links are ever made clickable or loaded.
 *
 * API
 *   FilePreview.render($el, files, { onRemove: function (index) {}, removeLabel: 'Remove' })
 *       empties $el and fills it with tiles (jQuery, built with .text()/.attr() - XSS safe).
 *   FilePreview.tile(file, opts)  -> one jQuery tile.
 *   FilePreview.html(files)       -> escaped HTML string, for modules that build HTML strings.
 *   FilePreview.kind(file)        -> 'image' | 'pdf' | 'other'.
 * PDF tiles from either path are drawn automatically once they reach the page.
 */
var FilePreview = (function () {
    'use strict';

    var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var THUMB_PX = 240;           // drawn size of a PDF page-1 picture (tile shows it at ~96px; 2.5x for sharp screens)
    var MAX_PARALLEL = 2;

    var pdfCache = {};            // url -> dataURL | 'fail'
    var pdfLibPromise = null;
    var queue = [];
    var running = 0;

    function linkOf(f) {
        if (f == null) return '';
        if (typeof f === 'string') return f;
        return String(f.file_link || f.url || f.href || '');
    }
    function nameOf(f) {
        if (f && typeof f === 'object' && f.name) return String(f.name);
        var link = linkOf(f);
        if (!link) return 'file';
        var last = link.split('?')[0].split('/').pop() || 'file';
        try { last = decodeURIComponent(last); } catch (e) { /* keep raw */ }
        return last;
    }
    function isHttp(u) { return /^https?:\/\//i.test(String(u || '')); }

    // The stored link's extension is what the file really is; the name (which people can retype) is the fallback.
    function extOf(f) {
        var re = /\.([a-z0-9]{2,5})$/;
        var m = linkOf(f).split('?')[0].split('#')[0].toLowerCase().match(re)
            || nameOf(f).trim().toLowerCase().match(re);
        return m ? m[1] : '';
    }

    function kind(f) {
        var e = extOf(f);
        if (/^(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/.test(e)) return 'image';
        if (e === 'pdf') return 'pdf';
        return 'other';
    }

    function iconClass(f) {
        var e = extOf(f);
        if (e === 'pdf') return 'fa-file-pdf';
        if (/^(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/.test(e)) return 'fa-file-image';
        if (/^(xlsx?|xlsm|csv)$/.test(e)) return 'fa-file-excel';
        if (/^(docx?|rtf)$/.test(e)) return 'fa-file-word';
        if (/^(txt|json)$/.test(e)) return 'fa-file-lines';
        return 'fa-file';
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* ---------- tiles ---------- */

    function thumbInnerHtml(f) {
        var link = linkOf(f);
        var k = kind(f);
        var icon = '<i class="fas ' + iconClass(f) + ' fp-icon" aria-hidden="true"></i>';
        if (!isHttp(link)) return icon;
        if (k === 'image') {
            return icon + '<img class="fp-img" loading="lazy" alt="" src="' + esc(link) + '">';
        }
        if (k === 'pdf') {
            return icon + '<img class="fp-img fp-pdf" alt="" data-fp-pdf="' + esc(link) + '">';
        }
        return icon;
    }

    function tileHtml(f, removable, index, removeLabel) {
        var link = linkOf(f);
        var name = nameOf(f);
        var k = kind(f);
        var thumb = isHttp(link)
            ? '<a class="fp-thumb fp-' + k + '" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" aria-label="Open ' + esc(name) + '">' + thumbInnerHtml(f) + '</a>'
            : '<span class="fp-thumb fp-' + k + '">' + thumbInnerHtml(f) + '</span>';
        var nameHtml = isHttp(link)
            ? '<a class="fp-name" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>'
            : '<span class="fp-name">' + esc(name) + '</span>';
        var rm = removable
            ? '<button type="button" class="fp-remove" data-fp-remove="' + index + '" aria-label="' + esc((removeLabel || 'Remove') + ' ' + name) + '" title="' + esc(removeLabel || 'Remove') + '"><i class="fas fa-xmark" aria-hidden="true"></i></button>'
            : '';
        return '<div class="fp-tile" title="' + esc(name) + '">' + thumb + nameHtml + rm + '</div>';
    }

    function gridClass(opts) {
        var s = opts && opts.size;
        return 'fp-grid' + (s === 'sm' ? ' fp-sm' : s === 'lg' ? ' fp-lg' : '');
    }

    function html(files, opts) {
        var list = (Array.isArray(files) ? files : (files ? [files] : [])).filter(function (f) { return f != null && (linkOf(f) || nameOf(f) !== 'file'); });
        if (!list.length) return '';
        return '<div class="' + gridClass(opts) + '">' + list.map(function (f) { return tileHtml(f, false); }).join('') + '</div>';
    }

    function tile(f, opts) {
        opts = opts || {};
        var $t = $(tileHtml(f, typeof opts.onRemove === 'function', 0, opts.removeLabel));
        if (typeof opts.onRemove === 'function') {
            $t.find('.fp-remove').on('click', function (e) { e.preventDefault(); opts.onRemove(); });
        }
        scheduleScan();
        return $t;
    }

    function render($el, files, opts) {
        opts = opts || {};
        $el = $($el);
        $el.empty();
        var list = Array.isArray(files) ? files : [];
        if (!list.length) return $el;
        var $grid = $('<div></div>').attr('class', gridClass(opts));
        list.forEach(function (f, i) {
            $grid.append(tile(f, {
                removeLabel: opts.removeLabel,
                onRemove: typeof opts.onRemove === 'function' ? function () { opts.onRemove(i); } : null
            }));
        });
        $el.append($grid);
        scheduleScan();
        return $el;
    }

    /* ---------- broken pictures fall back to the icon ---------- */

    document.addEventListener('error', function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains('fp-img')) {
            var thumb = t.closest('.fp-thumb');
            if (thumb) thumb.classList.remove('fp-loaded');
            t.remove();
        }
    }, true);
    document.addEventListener('load', function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains('fp-img') && t.getAttribute('src')) {
            var thumb = t.closest('.fp-thumb');
            if (thumb) thumb.classList.add('fp-loaded');
        }
    }, true);

    /* ---------- PDF page-1 pictures ---------- */

    function loadPdfLib() {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        if (pdfLibPromise) return pdfLibPromise;
        pdfLibPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = PDFJS_URL;
            s.async = true;
            s.onload = function () {
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
                    resolve(window.pdfjsLib);
                } else { reject(new Error('pdf.js missing')); }
            };
            s.onerror = function () { reject(new Error('pdf.js failed to load')); };
            document.head.appendChild(s);
        });
        pdfLibPromise.catch(function () { pdfLibPromise = null; });
        return pdfLibPromise;
    }

    function drawPdf(url) {
        return loadPdfLib().then(function (lib) {
            var task = lib.getDocument({ url: url, disableAutoFetch: true, disableStream: false });
            return task.promise.then(function (doc) {
                return doc.getPage(1).then(function (page) {
                    var base = page.getViewport({ scale: 1 });
                    var scale = THUMB_PX / Math.max(base.width, base.height);
                    var vp = page.getViewport({ scale: scale });
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.ceil(vp.width);
                    canvas.height = Math.ceil(vp.height);
                    var ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                        var data = canvas.toDataURL('image/jpeg', 0.82);
                        try { doc.destroy(); } catch (e) { /* ignore */ }
                        return data;
                    });
                });
            });
        });
    }

    function applyPdf(img, data) {
        if (!img.isConnected) return;
        if (data && data !== 'fail') {
            img.setAttribute('src', data);   // the delegated load listener marks the tile loaded
        } else {
            img.remove();                    // keep the PDF icon
        }
    }

    function pump() {
        while (running < MAX_PARALLEL && queue.length) {
            (function (img) {
                var url = img.getAttribute('data-fp-pdf');
                if (!img.isConnected || !isHttp(url)) return;
                if (pdfCache[url]) { applyPdf(img, pdfCache[url]); return; }
                running++;
                drawPdf(url).then(function (data) {
                    pdfCache[url] = data;
                }, function () {
                    pdfCache[url] = 'fail';
                }).then(function () {
                    running--;
                    applyPdf(img, pdfCache[url]);
                    // other tiles waiting on the same file
                    document.querySelectorAll('img.fp-pdf[data-fp-wait="1"]').forEach(function (o) {
                        if (o.getAttribute('data-fp-pdf') === url) applyPdf(o, pdfCache[url]);
                    });
                    pump();
                });
            })(queue.shift());
        }
    }

    var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            io.unobserve(en.target);
            enqueue(en.target);
        });
    }, { rootMargin: '200px' }) : null;

    function enqueue(img) {
        var url = img.getAttribute('data-fp-pdf');
        if (pdfCache[url]) { applyPdf(img, pdfCache[url]); return; }
        var already = queue.some(function (q) { return q.getAttribute('data-fp-pdf') === url; });
        if (already) { img.setAttribute('data-fp-wait', '1'); return; }
        queue.push(img);
        pump();
    }

    function scan(root) {
        var imgs = (root || document).querySelectorAll('img.fp-pdf[data-fp-pdf]:not([data-fp-seen])');
        imgs.forEach(function (img) {
            img.setAttribute('data-fp-seen', '1');
            if (io) io.observe(img); else enqueue(img);
        });
    }

    var scanTimer = null;
    function scheduleScan() {
        if (scanTimer) return;
        scanTimer = setTimeout(function () { scanTimer = null; scan(document); }, 30);
    }

    // Modules that build HTML strings never call us after inserting it, so watch the page for new PDF tiles.
    if ('MutationObserver' in window) {
        var mo = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                if (muts[i].addedNodes && muts[i].addedNodes.length) { scheduleScan(); return; }
            }
        });
        var start = function () { mo.observe(document.body, { childList: true, subtree: true }); scan(document); };
        if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    }

    return { render: render, tile: tile, html: html, kind: kind, iconClass: iconClass, scan: scan };
})();
