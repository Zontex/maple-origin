interface Config {
  height: number;
  width: number;
  originalHeight: number;
  originalWidth: number;
  bottomSafeGap: number;
  websocketUrl?: string;
}

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

export function enterBrowserFullscreen(): void {
  const element: HTMLElement = document.documentElement;
  if (element.requestFullscreen) {
    element.requestFullscreen();
  }
}

console.log("Config: ", config);

export default config;
