/**
 * Stealth and Hardware Spoofing Script for Browser Page Context
 * Injected before any website script runs.
 */

function generateStealthScript(config) {
    return `
    (() => {
        const config = ${JSON.stringify(config)};

        // 1. Remove automation / webdriver flag
        try {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
                configurable: true,
                enumerable: true
            });
        } catch (e) {}

        // 2. Hardware Specs Spoofing (CPU Cores & RAM)
        try {
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => config.hardware.concurrency || 8,
                configurable: true,
                enumerable: true
            });
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => config.hardware.deviceMemory || 8,
                configurable: true,
                enumerable: true
            });
        } catch (e) {}

        // 3. Platform & OS Spoofing
        try {
            Object.defineProperty(navigator, 'platform', {
                get: () => config.platform || 'Win32',
                configurable: true,
                enumerable: true
            });
            Object.defineProperty(navigator, 'oscpu', {
                get: () => config.oscpu || 'Windows NT 10.0; Win64; x64',
                configurable: true,
                enumerable: true
            });
        } catch (e) {}

        // 4. WebGL GPU Hardware Spoofing
        try {
            const fakeVendor = config.gpu.vendor || 'Google Inc. (NVIDIA)';
            const fakeRenderer = config.gpu.renderer || 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';

            const overrideWebGL = (proto) => {
                const origGetParameter = proto.getParameter;
                proto.getParameter = function (param) {
                    // UNMASKED_VENDOR_WEBGL = 0x9245 (37445)
                    if (param === 37445) {
                        return fakeVendor;
                    }
                    // UNMASKED_RENDERER_WEBGL = 0x9246 (37446)
                    if (param === 37446) {
                        return fakeRenderer;
                    }
                    // VENDOR = 0x1F00 (7936)
                    if (param === 7936) {
                        return 'Mozilla';
                    }
                    // RENDERER = 0x1F01 (7937)
                    if (param === 7937) {
                        return 'Mozilla';
                    }
                    return origGetParameter.apply(this, arguments);
                };
            };

            if (typeof WebGLRenderingContext !== 'undefined') {
                overrideWebGL(WebGLRenderingContext.prototype);
            }
            if (typeof WebGL2RenderingContext !== 'undefined') {
                overrideWebGL(WebGL2RenderingContext.prototype);
            }
        } catch (e) {}

        // 5. Canvas Fingerprint Noise Protection
        try {
            const shift = 0.00001; // subtle noise
            const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
            CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
                const imageData = originalGetImageData.apply(this, arguments);
                for (let i = 0; i < imageData.data.length; i += 4) {
                    if (i % 32 === 0) {
                        imageData.data[i] = (imageData.data[i] + 1) % 256;
                    }
                }
                return imageData;
            };

            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function () {
                const ctx = this.getContext('2d');
                if (ctx) {
                    try {
                        const img = ctx.getImageData(0, 0, Math.min(this.width, 10), Math.min(this.height, 10));
                        ctx.putImageData(img, 0, 0);
                    } catch (err) {}
                }
                return originalToDataURL.apply(this, arguments);
            };
        } catch (e) {}

        // 6. Audio Context Fingerprint Spoofing
        try {
            if (typeof AudioBuffer !== 'undefined') {
                const origGetChannelData = AudioBuffer.prototype.getChannelData;
                AudioBuffer.prototype.getChannelData = function () {
                    const data = origGetChannelData.apply(this, arguments);
                    for (let i = 0; i < data.length; i += 100) {
                        data[i] += 0.0000001;
                    }
                    return data;
                };
            }
            if (typeof AnalyserNode !== 'undefined') {
                const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
                AnalyserNode.prototype.getFloatFrequencyData = function (array) {
                    origGetFloatFrequencyData.apply(this, arguments);
                    for (let i = 0; i < array.length; i += 20) {
                        array[i] += 0.001;
                    }
                };
            }
        } catch (e) {}

        // 7. Screen & Window Specs Spoofing
        try {
            const screenProps = {
                width: config.screen.width || 1920,
                height: config.screen.height || 1080,
                availWidth: config.screen.availWidth || 1920,
                availHeight: config.screen.availHeight || 1040,
                colorDepth: config.screen.colorDepth || 24,
                pixelDepth: config.screen.pixelDepth || 24,
            };

            for (const [prop, val] of Object.entries(screenProps)) {
                Object.defineProperty(window.screen, prop, {
                    get: () => val,
                    configurable: true,
                    enumerable: true
                });
            }

            Object.defineProperty(window, 'devicePixelRatio', {
                get: () => config.screen.devicePixelRatio || 1,
                configurable: true,
                enumerable: true
            });
        } catch (e) {}

        // 8. Battery API Spoofing (Prevent hardware battery tracking)
        try {
            if (navigator.getBattery) {
                navigator.getBattery = () => Promise.resolve({
                    charging: true,
                    chargingTime: 0,
                    dischargingTime: Infinity,
                    level: 1.0,
                    addEventListener: () => {},
                    removeEventListener: () => {}
                });
            }
        } catch (e) {}

        console.log('[🛡️] Hardware & Identity Spoofing Protection Activated');
    })();
    `;
}

module.exports = { generateStealthScript };
