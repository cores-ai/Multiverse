import os
import sys
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

def get_stealth_script():
    return """
    (() => {
        // 1. Remove automation / webdriver flag
        try {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
                configurable: true,
                enumerable: true
            });
        } catch (e) {}

        // 2. Hardware Specs Spoofing
        try {
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8,
                configurable: true,
                enumerable: true
            });
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8,
                configurable: true,
                enumerable: true
            });
        } catch (e) {}

        // 3. Platform & OS Spoofing
        try {
            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32',
                configurable: true,
                enumerable: true
            });
            Object.defineProperty(navigator, 'oscpu', {
                get: () => 'Windows NT 10.0; Win64; x64',
                configurable: true,
                enumerable: true
            });
        } catch (e) {}

        // 4. WebGL GPU Hardware Spoofing
        try {
            const fakeVendor = 'Google Inc. (NVIDIA)';
            const fakeRenderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';

            const overrideWebGL = (proto) => {
                const origGetParameter = proto.getParameter;
                proto.getParameter = function (param) {
                    if (param === 37445) return fakeVendor;
                    if (param === 37446) return fakeRenderer;
                    if (param === 7936) return 'Mozilla';
                    if (param === 7937) return 'Mozilla';
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

        // 5. Canvas Noise
        try {
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
        } catch (e) {}

        // 6. Battery API Spoofing
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

        console.log('[🛡️] Python Hardware & Identity Spoofing Protection Activated');
    })();
    """

def run_firefox_session(target_url="https://railway.com/deploy"):
    base_dir = Path(__file__).resolve().parent
    session_dir = base_dir / "sessions" / "firefox_profile"

    # Wipe old session data for 100% fresh run
    if session_dir.exists():
        import shutil
        try:
            shutil.rmtree(session_dir, ignore_errors=True)
            print("[🧹] Cleared all old cache, cookies & history.")
        except Exception:
            pass
    session_dir.mkdir(parents=True, exist_ok=True)

    print(f"[+] Fresh Session Folder: {session_dir}")
    print(f"[*] Target URL: {target_url}")
    print(f"[*] WebGL / Hardware Spoofing: ENABLED (RTX 3060 / 8 Cores / 8GB RAM)")
    print(f"[*] WebRTC IP Leak Protection: ENABLED")

    firefox_user_prefs = {
        'network.trr.mode': 2,
        'network.trr.uri': 'https://dns.google/dns-query',
        'network.trr.custom_uri': 'https://dns.google/dns-query',
        'network.trr.bootstrapAddress': '8.8.8.8',
        'network.trr.send_user_agent': False,
        'network.trr.send_edns_client_subnet': False,
        'browser.sessionstore.resume_from_crash': False,
        'browser.sessionstore.enabled': False,
        'browser.startup.page': 0,
        'privacy.clearOnShutdown.cache': True,
        'privacy.clearOnShutdown.cookies': True,
        'privacy.clearOnShutdown.history': True,
        'media.peerconnection.enabled': True,
        'media.peerconnection.ice.no_host': True,
        'media.peerconnection.ice.default_address_only': True,
        'media.peerconnection.ice.proxy_only': True,
        'toolkit.telemetry.enabled': False,
        'marionette.enabled': False,
        'dom.webdriver.enabled': False,
    }

    with sync_playwright() as p:
        context = p.firefox.launch_persistent_context(
            user_data_dir=str(session_dir),
            headless=False,
            viewport=None,
            locale="en-US",
            timezone_id="America/New_York",
            geolocation={"latitude": 40.7128, "longitude": -74.0060},
            permissions=["geolocation"],
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
            firefox_user_prefs=firefox_user_prefs,
            args=["-width", "900", "-height", "600"]
        )

        context.add_init_script(get_stealth_script())

        page = context.pages[0] if context.pages else context.new_page()
        page.goto(target_url)

        # Smooth 2-Step Auto-Click: Sign in -> Log in using email
        try:
            sign_in_sel = 'button:has-text("Sign in"), button.h-10.w-20.px-3, a:has-text("Sign in")'
            btn = page.wait_for_selector(sign_in_sel, timeout=10000)
            if btn:
                page.wait_for_timeout(500)
                btn.click()
                print("[✅] Auto-clicked 'Sign in' button successfully!")

            email_sel = 'button:has-text("Log in using email"), button:has-text("using email")'
            email_btn = page.wait_for_selector(email_sel, timeout=10000)
            if email_btn:
                page.wait_for_timeout(500)
                email_btn.click()
                print("[✅] Auto-clicked 'Log in using email' button successfully!")
        except Exception:
            pass

        print("\n======================================================")
        print("  🛡️ Firefox session is RUNNING (with Hardware Spoofing).")
        print(f"  Profile folder: {session_dir}")
        print("  Close the browser window to exit.")
        print("======================================================\n")

        try:
            page.wait_for_timeout(3600 * 1000)
        except Exception:
            pass

        context.close()
        print("[*] Browser closed. Session saved.")

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://railway.com/deploy"
    run_firefox_session(url)
