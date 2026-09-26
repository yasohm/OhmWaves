import { useState } from 'react';
import PatternArt from './PatternArt';

/** Cover art over a generative pattern, which shows while loading and when art is missing. */
export default function Artwork({ src, title = '', size, rounded = false, className = '', variant, palette }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = src && failedSrc !== src;
  return <span className={`artwork ${rounded ? 'artwork--round' : ''} ${className}`} style={size ? { width: size, height: size } : undefined}>
    <PatternArt seed={title} variant={variant} palette={palette} />
    {showImage && <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />}
  </span>;
}
