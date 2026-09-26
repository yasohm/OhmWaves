import { useState } from 'react';
import { Music2 } from 'lucide-react';
import { hueFor } from '../lib/tracks';

/** Cover art with a deterministic gradient placeholder while loading or when art is missing. */
export default function Artwork({ src, title = '', size, rounded = false, className = '' }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = src && failedSrc !== src;
  return <span
    className={`artwork ${rounded ? 'artwork--round' : ''} ${className}`}
    style={{ '--art-hue': hueFor(title), ...(size ? { width: size, height: size } : null) }}
  >
    <Music2 aria-hidden="true" className="artwork__icon" />
    {showImage && <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />}
  </span>;
}
