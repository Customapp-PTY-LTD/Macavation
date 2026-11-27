/**
 * "View as role" — a read-only preview of the portal as another role (Mike's MacView, round 3).
 *
 * Who: super_user and admin only (their REAL role; checked again on every page load).
 * What: the menu, buttons (action keys) and price visibility of the chosen role. The server session
 * is not changed: every call still goes out as the real user. Nothing can be saved: while a preview
 * is on, every request that is not a GET or a read function (get_*, list_*, report_* ...) is stopped
 * in the browser and never reaches the server.
 *
 * How: the chosen role's feature and action keys are fetched once and kept in sessionStorage
 * (this tab only). Session.get('featureKeys' | 'actionKeys' | 'user') then answers as that role.
 * The real user / keys are kept aside and written back when the preview ends, then the page reloads
 * so every screen and cache starts clean.
 *
 * Must load right after js/session.js, before anything that reads the session or sends requests.
 */
var MacViewAs = (function () {
    'use strict';

    var KEY = '_MacViewAs';
    var ALLOWED = ['super_user', 'admin'];
    /* Read functions are allowed during a preview; anything else is a write and is stopped. */
    var READ_RPC = /^(get|list|search|report|fetch|count|find|check|is|has|resolve|validate|kernel_lab|company_|sa_public|portal_|auth_)/i;   // auth_*: own sign-in / sign-out only

    function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
    function save(v) { try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
    function roleOf(u) {
        var rn = u ? (u.role_name || u.role || '') : '';
        if (rn && typeof rn === 'object') rn = rn.name || rn.role_name || '';
        return String(rn || '');
    }

    var realGet = (typeof Session !== 'undefined' && Session.get) ? Session.get.bind(Session) : null;
    var state = load();

    function realUser() { return realGet ? realGet('user') : null; }
    function realRoleAllowed() {
        var u = state && state.realUser ? state.realUser : realUser();
        return ALLOWED.indexOf(roleOf(u).toLowerCase()) !== -1;
    }

    // A preview never outlives a sign-out, and only a real super_user/admin may hold one.
    if (state && (!realGet || !realGet('token') || !realRoleAllowed())) { state = null; save(null); }

    if (state && realGet) {
        Session.get = function (k) {
            if (k === 'featureKeys') return (state.featureKeys || []).slice();
            if (k === 'actionKeys') return (state.actionKeys || []).slice();
            var v = realGet(k);
            if (k === 'user' && v && typeof v === 'object') {
                var c = {};
                Object.keys(v).forEach(function (x) { c[x] = v[x]; });
                c.role_name = state.roleName; c.role = state.roleName; c.role_id = state.roleId;
                if (c.roles && typeof c.roles === 'object') c.roles = { role_name: state.roleName };
                return c;
            }
            return v;
        };

        var realFetch = window.fetch.bind(window);
        var lastNote = 0;
        window.fetch = function (input, init) {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return realFetch(input, init);
            var m = url.match(/\/rest\/v1\/rpc\/([^?\/#]+)/);
            if (m && READ_RPC.test(decodeURIComponent(m[1]))) return realFetch(input, init);
            if (Date.now() - lastNote > 4000) {
                lastNote = Date.now();
                if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage('Preview only: nothing was saved.', 'warning');
            }
            return Promise.resolve(new Response(JSON.stringify({ success: false, error: 'Preview only: nothing was saved.', message: 'Preview only: nothing was saved.' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }));
        };
    }

    function keysOf(list) {
        return (Array.isArray(list) ? list : []).map(function (r) {
            if (typeof r === 'string') return r;
            return r && (r.key || r.Key || r.action_key || r.feature_key) || '';
        }).filter(Boolean);
    }

    /** Start previewing a role (real super_user / admin only), then reload. */
    async function start(role) {
        if (state || !realRoleAllowed() || !role || !role.id) return;
        var f = await dataFunctions.getFeaturesForRole(role.id);
        var a = typeof dataFunctions.getActionsForRole === 'function' ? await dataFunctions.getActionsForRole(role.id) : [];
        save({
            roleId: role.id, roleName: role.name, featureKeys: keysOf(f), actionKeys: keysOf(a), startedAt: Date.now(),
            realUser: realGet('user'), realFeatureKeys: realGet('featureKeys'), realActionKeys: realGet('actionKeys')
        });
        if (typeof dataFunctions.clearAllCache === 'function') dataFunctions.clearAllCache();
        location.reload();
    }

    /** End the preview: put the real session back exactly as it was, then reload. */
    function stop() {
        var s = load();
        save(null);
        if (s && typeof Session !== 'undefined' && Session.set) {
            if (s.realUser) Session.set('user', s.realUser);
            if (Array.isArray(s.realFeatureKeys)) Session.set('featureKeys', s.realFeatureKeys);
            if (Array.isArray(s.realActionKeys)) Session.set('actionKeys', s.realActionKeys);
        }
        if (typeof dataFunctions !== 'undefined' && typeof dataFunctions.clearAllCache === 'function') dataFunctions.clearAllCache();
        location.reload();
    }

    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    async function pick() {
        var roles = [];
        try { roles = await dataFunctions.getRoles(); } catch (e) { roles = []; }
        roles = (roles || []).map(function (r) { return { id: r.id || r.role_id, name: r.role_name || r.name }; })
            .filter(function (r) { return r.id && r.name && ALLOWED.indexOf(String(r.name).toLowerCase()) === -1; })
            .sort(function (a, b) { return a.name.localeCompare(b.name); });
        if (!roles.length) { if (typeof _common !== 'undefined') _common.showToastMessage('No roles to preview.', 'warning'); return; }
        var opts = {};
        roles.forEach(function (r) { opts[r.id] = r.name; });
        if (typeof Swal === 'undefined') return;
        var res = await Swal.fire({
            title: 'View the portal as a role',
            html: '<p class="small text-muted mb-0">See the menu, buttons and figures exactly as that role does. It is a preview: nothing you do is saved, and your own access does not change.</p>',
            input: 'select', inputOptions: opts, inputPlaceholder: 'Choose a role', showCancelButton: true, confirmButtonText: 'Start preview',
            inputValidator: function (v) { return v ? null : 'Choose a role'; }
        });
        if (res.isConfirmed && res.value) start({ id: res.value, name: opts[res.value] });
    }

    function mount() {
        if (state) {
            var bar = document.createElement('div');
            bar.className = 'mac-viewas-bar';
            bar.setAttribute('role', 'status');
            bar.innerHTML = '<i class="fas fa-eye me-2" aria-hidden="true"></i><span>Previewing as <strong>' + esc(state.roleName) +
                '</strong>. This is what they see. Nothing you do is saved.</span><button type="button" class="btn btn-sm btn-light ms-3" id="macViewAsStop">Back to my own view</button>';
            document.body.insertBefore(bar, document.body.firstChild);
            document.body.classList.add('mac-viewas-on');
            document.getElementById('macViewAsStop').addEventListener('click', stop);
            if (typeof window.signOut === 'function') {
                var so = window.signOut;
                window.signOut = function () { var s = load(); save(null); if (s && s.realUser) Session.set('user', s.realUser); return so.apply(this, arguments); };
            }
        }
        if (!state && realRoleAllowed()) {
            var signOutBtn = document.querySelector('.user-dropdown-signout');
            var li = signOutBtn && signOutBtn.closest('li');
            if (li && !document.getElementById('macViewAsStart')) {
                var item = document.createElement('li');
                item.innerHTML = '<button type="button" class="user-dropdown-item" id="macViewAsStart"><i class="fas fa-eye"></i><span>View as a role</span></button>';
                li.parentNode.insertBefore(item, li);
                item.querySelector('button').addEventListener('click', pick);
            }
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

    return {
        active: function () { return !!state; },
        roleName: function () { return state ? state.roleName : null; },
        start: start, stop: stop, pick: pick
    };
})();
