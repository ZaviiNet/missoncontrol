// Sprite sheet loader and animator utility
// Shared by mascot.js and office.js

export class SpriteSheet {
  constructor(image, frameWidth, frameHeight) {
    this.image = image;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.cols = Math.floor(image.width / frameWidth);
    this.rows = Math.floor(image.height / frameHeight);
  }

  drawFrame(ctx, frameIndex, x, y, scale = 1) {
    const col = frameIndex % this.cols;
    const row = Math.floor(frameIndex / this.cols);
    const w = this.frameWidth * scale;
    const h = this.frameHeight * scale;

    ctx.drawImage(
      this.image,
      col * this.frameWidth, row * this.frameHeight,
      this.frameWidth, this.frameHeight,
      x, y, w, h
    );
  }
}

export class Animator {
  constructor(spriteSheet, frames, fps = 8) {
    this.spriteSheet = spriteSheet;
    this.frames = frames; // array of frame indices
    this.fps = fps;
    this.currentFrame = 0;
    this.elapsed = 0;
  }

  update(dt) {
    this.elapsed += dt;
    const frameDuration = 1000 / this.fps;
    while (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration;
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }
  }

  draw(ctx, x, y, scale = 1) {
    this.spriteSheet.drawFrame(ctx, this.frames[this.currentFrame], x, y, scale);
  }

  reset() {
    this.currentFrame = 0;
    this.elapsed = 0;
  }
}

export async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

export async function loadSpriteSheet(src, frameWidth, frameHeight) {
  const img = await loadImage(src);
  return new SpriteSheet(img, frameWidth, frameHeight);
}
