interface Config {
  height: number;
  width: number;
  originalHeight: number;
  originalWidth: number;
  bottomSafeGap: number;
  websocketUrl?: string;
}

// Authentic pre-Big Bang v83 client resolution. The whole HUD (UIMap.ts)
// is natively laid out for 800x600 and the WZ status bar art is 800 wide;
// CSS scales the canvas up to the window, keeping the internal aspect.
// The saved SYSTEM OPTION resolution is applied by MapState.initialize when
// entering the game (Resolution.applyConfiguredResolution) — NOT here. The
// login flow renders at the classic size, and booting config wide displaced
// every login background: parallax shifts read config.width/2 while the
// canvas was still 800 wide.
const originalHeight: number = 600;
const originalWidth: number = 800;

const config: Config = {
  height: originalHeight,
  width: originalWidth,
  originalHeight,
  originalWidth,
  bottomSafeGap: 0,
  websocketUrl: import.meta.env.VITE_WEBSOCKET_URL,
};

/**
 * Alt+Enter fullscreen toggle (wired in GameCanvas.listenKeyboard) — the
 * binding v83's own SYSTEM OPTION art promises on its VIEWING MODE row.
 * Uses the Fullscreen API, which hides all of the browser's UI — unlike
 * macOS's green-button fullscreen, which can keep the toolbar on screen.
 */
export function toggleBrowserFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

console.log("Config: ", config);

export default config;
