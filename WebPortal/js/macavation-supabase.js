/**
 * Canonical Macavation Supabase settings for the Web Portal.
 * All CRUD / PostgREST fallbacks must use this project — never FruitLive or other refs.
 */
(function (global) {
    'use strict';

    var PROJECT_REF = 'sofanhfpxifgdtooefzq';
    var SUPABASE_URL = 'https://sofanhfpxifgdtooefzq.supabase.co';
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZmFuaGZweGlmZ2R0b29lZnpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMDM2MDgsImV4cCI6MjA4MTg3OTYwOH0.oFOqODGzzrk5dqUBHDVrPS9VBDzR4xThfwlC33Qri3U';
    var LAMBDA_PROXY_URL = 'https://rzrx6ntfejvb6lxpmt4ywruvt40mjjuo.lambda-url.af-south-1.on.aws/proxy/function';

    var BLOCKED_REFS = ['iwxmuemrfopajwvqdiae'];

    function assertMacavationSupabaseUrl(url) {
        var u = String(url || '');
        if (!u) {
            return;
        }
        if (u.indexOf(PROJECT_REF) < 0) {
            throw new Error('Supabase URL must target Macavation (' + PROJECT_REF + '), not: ' + u);
        }
        var i;
        for (i = 0; i < BLOCKED_REFS.length; i++) {
            if (u.indexOf(BLOCKED_REFS[i]) >= 0) {
                throw new Error('Supabase URL points at a blocked project (' + BLOCKED_REFS[i] + '). Use Macavation only.');
            }
        }
    }

    global.MACAVATION_SUPABASE = {
        projectRef: PROJECT_REF,
        url: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        lambdaProxyUrl: LAMBDA_PROXY_URL,
        assertMacavationSupabaseUrl: assertMacavationSupabaseUrl
    };
}(typeof window !== 'undefined' ? window : globalThis));
