/**
 * Spoof Configuration for Playwright Firefox
 * Customize hardware, screen, timezone, location, and GPU specs here.
 */
module.exports = {
    // Session & Privacy Behavior
    clearSessionOnEveryStart: true, // Automatically clears all cookies, cache & history on each launch

    // Inbuilt Google DNS (DNS over HTTPS to prevent DNS leaks and ISP tracking)
    dns: {
        enabled: true,
        dohUri: 'https://dns.google/dns-query',
        bootstrapAddress: '8.8.8.8',
        mode: 2, // 2 = High-speed Google DoH with fallback, 3 = Strict Google DNS only
    },

    // Hardware Specs Spoofing
    hardware: {
        concurrency: 8, // CPU Cores (navigator.hardwareConcurrency)
        deviceMemory: 8, // RAM in GB (navigator.deviceMemory)
    },

    // GPU & WebGL Spoofing (Hides real graphics card)
    gpu: {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    },

    // Window Open Size (Small / Compact Window)
    windowSize: {
        width: 900,
        height: 600,
    },

    // Screen & Display Specs (Spoofed hardware screen for websites)
    screen: {
        width: 1920,
        height: 1080,
        availWidth: 1920,
        availHeight: 1040,
        colorDepth: 24,
        pixelDepth: 24,
        devicePixelRatio: 1,
    },

    // Locale, Timezone, and Geolocation
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: {
        latitude: 40.7128,
        longitude: -74.0060,
        accuracy: 20,
    },

    // User Agent and Platform
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
    platform: 'Win32',
    oscpu: 'Windows NT 10.0; Win64; x64',

    // Optional Proxy Setup (Uncomment and edit if you want to use a proxy)
    // proxy: {
    //     server: 'http://username:password@ip:port'
    // }
};
