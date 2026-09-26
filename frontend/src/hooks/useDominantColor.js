import { useEffect, useState } from 'react';

const cache = new Map();
export const FALLBACK_COLOR = '14 47 48'; // space-separated for rgb(var(--x) / alpha) // OhmWave brand teal

/** Average artwork colour, lifted towards a vivid mid-tone so gradients read well on dark UI. */
function extract(url) {
  if (cache.has(url)) return cache.get(url);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 24, 24);
        const { data } = ctx.getImageData(0, 0, 24, 24);
        let r = 0; let g = 0; let b = 0; let weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const max = Math.max(data[i], data[i + 1], data[i + 2]);
          const min = Math.min(data[i], data[i + 1], data[i + 2]);
          const w = 1 + (max - min) / 32; // favour saturated pixels over greys
          r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; weight += w;
        }
        const avg = [r, g, b].map((v) => v / weight);
        const peak = Math.max(...avg, 1);
        const scale = Math.min(1.6, 170 / peak);
        resolve(avg.map((v) => Math.round(Math.min(255, v * scale))).join(' '));
      } catch {
        resolve(FALLBACK_COLOR); // tainted canvas (no CORS) or decode failure
      }
    };
    img.onerror = () => resolve(FALLBACK_COLOR);
    img.src = url;
  });
  cache.set(url, promise);
  return promise;
}

export default function useDominantColor(url) {
  const [result, setResult] = useState({ url: null, color: FALLBACK_COLOR });
  useEffect(() => {
    if (!url) return undefined;
    let active = true;
    extract(url).then((color) => { if (active) setResult({ url, color }); });
    return () => { active = false; };
  }, [url]);
  return url && result.url === url ? result.color : FALLBACK_COLOR;
}
