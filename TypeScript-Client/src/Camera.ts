import config from "./Config";

export interface CameraBoundaries {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CameraInterface {
  width: number;
  height: number;
  x: number;
  y: number;
  boundaries: CameraBoundaries;
  initialize: () => void;
  setBoundaries: (_: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }) => void;
  lookAt: (_: number, __: number) => void;
  update: () => void;
  doReset: () => void;
  setTopLeft: (x: number, y: number) => void,
}

const Camera: CameraInterface = {
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  boundaries: {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  initialize: () => {},
  setBoundaries: () => {},
  lookAt: () => {},
  update: () => {},
  doReset: () => {},
  setTopLeft: () => {},
};

Camera.initialize = function () {
  this.width = config.width;
  this.height = config.height;
  this.x = 0;
  this.y = 0;
  targetX = 0;
  targetY = 0;
};

const easeSpeed = 0.1;
let targetX = 0;
let targetY = 0;

// only useful when the game resolution is not 800x600
const bottomSafeGap = 0; // 800x600
Camera.setBoundaries = function ({
  left,
  right,
  top,
  bottom,
}: {
  left: number;
  right: number;
  top: number;
  bottom: number;
}) {
  this.boundaries = { left, right, top, bottom: bottom - bottomSafeGap };
};

Camera.setTopLeft = function (x: number, y: number): void {
  targetX = x;
  targetY = y;
};

Camera.lookAt = function (x, y) {
  const width = this.width;
  const height = this.height;
  const boundaries = this.boundaries;

  if (boundaries.right - boundaries.left < width) {
    const leftGap = (width - (boundaries.right - boundaries.left)) / 2;
    targetX = Math.round(boundaries.left - leftGap);
  } else if (x - width / 2 < boundaries.left) {
    targetX = boundaries.left;
  } else if (x + width / 2 > boundaries.right) {
    targetX = boundaries.right - width;
  } else {
    targetX = Math.round(x - width / 2);
  }

  if (boundaries.bottom - boundaries.top < height) {
    const topGap = (height - (boundaries.bottom - boundaries.top)) / 2;
    targetY = Math.round(boundaries.top - topGap);
  } else if (y - height / 2 < boundaries.top) {
    targetY = boundaries.top;
  } else if (y + height / 2 > boundaries.bottom) {
    targetY = boundaries.bottom - height;
  } else {
    targetY = Math.round(y - height / 2);
  }
};

// NOTE: rounding after easing means the last few pixels are never travelled —
// within 5px of the target the 10% step is under half a pixel and Math.round
// hands back the previous value, so the camera rests slightly short. That is
// load-bearing: the login screen's layout offsets were measured against where
// it actually comes to rest, so "fixing" the convergence shifts every
// world-drawn element against the screen-fixed ones and pulls the login sign
// apart. Anything that needs a reproducible camera must reproduce the whole
// approach (see LoginState.initialize), not just the target.
Camera.update = function () {
  if (this.x === targetX && this.y === targetY) {
    return;
  }

  this.x += (targetX - this.x) * easeSpeed;
  this.y += (targetY - this.y) * easeSpeed;

  if (Math.abs(this.x - targetX) < 0.5) this.x = targetX;
  if (Math.abs(this.y - targetY) < 0.5) this.y = targetY;

  // Round to integers to prevent sub-pixel rendering artifacts (flickering lines/seams)
  this.x = Math.round(this.x);
  this.y = Math.round(this.y);
};

Camera.doReset = function () {
  this.x = 0;
  this.y = 0;
  targetX = 0;
  targetY = 0;
};

export default Camera;
