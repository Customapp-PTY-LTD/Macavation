/**
 * Design panel — MacView's "Design" picker (Mike's prototype, 27 Nov 2026).
 * Lets each person choose their own look: mode, colour theme, background pattern and accent.
 * The choice is saved in this browser by ThemeManager (js/themes.js); nothing goes to the server.
 *
 * Opened by any element with data-mac-act="design"; data-mac-act="toggle-mode" flips light/dark.
 * (#darkModeToggle in the sidebar is wired by js/index.js.)
 */
var macDesignPanel = {
    $modal: null,
    modal: null,

    MODES: [
        { key: 'dark', label: 'Dark', icon: 'fa-moon' },
        { key: 'light', label: 'Light', icon: 'fa-sun' },
        { key: 'auto', label: 'Match device', icon: 'fa-laptop' }
    ],

    init: function () {
        var self = this;
        $(document).on('click', '[data-mac-act="design"]', function (e) {
            e.preventDefault();
            self.open();
        });
        $(document).on('click', '[data-mac-act="toggle-mode"]', function (e) {
            e.preventDefault();
            ThemeManager.toggleDarkMode();
        });
        ThemeManager.onChange(function () {
            if (!self.$modal || !self.$modal.hasClass('show')) return;
            // Don't rebuild the colour picker while it is being dragged.
            if (document.activeElement && document.activeElement.id === 'macDesignAccent') {
                self.$modal.find('#macDesignAccentReset').prop('disabled', !ThemeManager.get().accent);
                return;
            }
            self.render();
        });
    },

    ensureModal: function () {
        if (this.$modal) return;
        var self = this;
        var $modal = $('<div class="modal fade mac-design-modal" id="macDesignModal" tabindex="-1" aria-labelledby="macDesignTitle" aria-hidden="true"></div>');
        var $dialog = $('<div class="modal-dialog modal-xl modal-dialog-scrollable"></div>');
        var $content = $('<div class="modal-content"></div>');
        var $header = $('<div class="modal-header"></div>')
            .append($('<h5 class="modal-title" id="macDesignTitle"></h5>').append('<i class="fas fa-palette me-2"></i>').append(document.createTextNode('Design')))
            .append('<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>');
        var $body = $('<div class="modal-body" id="macDesignBody"></div>');
        var $footer = $('<div class="modal-footer"></div>')
            .append($('<button type="button" class="btn btn-outline-secondary me-auto" id="macDesignReset"></button>').text('Reset to default'))
            .append($('<button type="button" class="btn btn-primary" data-bs-dismiss="modal"></button>').text('Done'));
        $modal.append($dialog.append($content.append($header, $body, $footer)));
        $('body').append($modal);

        $modal.on('click', '[data-tmode]', function () { ThemeManager.set({ mode: $(this).data('tmode') }); });
        $modal.on('click', '[data-ttheme]', function () { ThemeManager.set({ theme: $(this).data('ttheme') }); });
        $modal.on('click', '[data-tbg]', function () { ThemeManager.set({ bg: $(this).data('tbg') }); });
        $modal.on('click', '#macDesignReshuffle', function () { ThemeManager.reshuffle(); });
        $modal.on('click', '#macDesignAccentReset', function () { ThemeManager.set({ accent: '' }); });
        $modal.on('input change', '#macDesignAccent', function () {
            var v = String($(this).val() || '');
            if (/^#[0-9a-f]{6}$/i.test(v)) ThemeManager.set({ accent: v });
        });
        $modal.on('click', '#macDesignReset', function () { ThemeManager.reset(); });

        this.$modal = $modal;
        this.modal = bootstrap.Modal.getOrCreateInstance($modal[0]);
    },

    section: function (title) {
        return $('<div class="mac-dsec"></div>').append($('<h3></h3>').text(title));
    },

    pill: function (attr, key, label, on, icon) {
        var $b = $('<button type="button" class="mac-dpill"></button>').attr(attr, key).toggleClass('on', !!on).attr('aria-pressed', on ? 'true' : 'false');
        if (icon) $b.append($('<i class="fas me-2"></i>').addClass(icon));
        return $b.append(document.createTextNode(label));
    },

    render: function () {
        var self = this;
        var st = ThemeManager.get();
        var themes = ThemeManager.THEMES;
        var bgs = ThemeManager.BGS;
        var $body = this.$modal.find('#macDesignBody').empty();

        // Mode
        var $modes = $('<div class="mac-dpills"></div>');
        this.MODES.forEach(function (m) { $modes.append(self.pill('data-tmode', m.key, m.label, st.mode === m.key, m.icon)); });
        $body.append(this.section('Mode').append($modes));

        // Colour themes
        var $grid = $('<div class="mac-tgrid"></div>');
        Object.keys(themes).forEach(function (k) {
            var t = themes[k];
            var $card = $('<button type="button" class="mac-tcard"></button>').attr('data-ttheme', k).toggleClass('on', st.theme === k).attr('aria-pressed', st.theme === k ? 'true' : 'false');
            var $sw = $('<span class="mac-tsw" aria-hidden="true"></span>');
            [t.bg, t.accent, t.accent2, t.fg].forEach(function (c) { $sw.append($('<i></i>').css('background', c)); });
            $card.append($('<b></b>').text(t.name), $sw, $('<span class="mac-thex"></span>').text(t.bg + ' · ' + t.accent + ' · ' + t.accent2));
            $grid.append($card);
        });
        $body.append(this.section('Colour themes').append($grid));

        // Background
        var $bgs = $('<div class="mac-dpills"></div>');
        Object.keys(bgs).forEach(function (k) { $bgs.append(self.pill('data-tbg', k, bgs[k], st.bg === k)); });
        if (st.bg === 'contours') {
            $bgs.append($('<button type="button" class="mac-dpill" id="macDesignReshuffle"></button>').append('<i class="fas fa-rotate me-2"></i>').append(document.createTextNode('New contour shape')));
        }
        $body.append(this.section('Background').append($bgs));

        // Accent
        var accent = st.accent || themes[st.theme].accent;
        var $row = $('<div class="mac-accentrow"></div>')
            .append($('<input type="color" id="macDesignAccent" aria-label="Accent colour">').val(accent))
            .append($('<span></span>').text('Override the theme’s accent (buttons, card edges, highlights)'))
            .append($('<button type="button" class="btn btn-sm btn-outline-secondary" id="macDesignAccentReset"></button>').text('Use theme accent').prop('disabled', !st.accent));
        $body.append(this.section('Accent colour').append($row));

        $body.append($('<p class="mac-design-note"></p>').text('Saved on this device, so each person can choose their own look.'));
    },

    open: function () {
        this.ensureModal();
        this.render();
        this.modal.show();
    }
};

$(function () {
    if (typeof ThemeManager !== 'undefined' && typeof bootstrap !== 'undefined') macDesignPanel.init();
});
