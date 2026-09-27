// Vector version of img/ohmwaves-icon.png: an omega whose feet trail off as sine waves.
// The wave tails are separate paths so they can ripple independently of the omega body.
const BODY = 'M427 707V667A211 211 0 1 1 597 667V707';
const TAILS = [
  {
    rest: 'M180 693C206 638 224 614 242 614C266 614 284 648 302 695C322 745 344 776 372 776C394 776 412 746 427 707',
    swell: 'M180 700C206 662 224 648 242 648C266 648 284 668 302 695C322 725 344 744 372 744C394 744 412 730 427 707',
  },
  {
    rest: 'M844 693C818 638 800 614 782 614C758 614 740 648 722 695C702 745 680 776 652 776C630 776 612 746 597 707',
    swell: 'M844 700C818 662 800 648 782 648C758 648 740 668 722 695C702 725 680 744 652 744C630 744 612 730 597 707',
  },
];
const EASE = '0.45 0 0.55 1';

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** OhmWave brand mark. Inherits color from `currentColor`; `animated` draws it in and ripples the wave tails. */
export default function OhmMark({ animated = false, className = '' }) {
  const ripple = animated && !prefersReducedMotion();
  return <svg className={`ohm-mark ${animated ? 'ohm-mark--animated' : ''} ${className}`} viewBox="150 157 724 724"
    fill="none" stroke="currentColor" strokeWidth="60" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={BODY} pathLength="1" />
    {TAILS.map(({ rest, swell }, i) => <path key={i} d={rest} pathLength="1">
      {ripple && <animate attributeName="d" values={`${rest};${swell};${rest}`} dur="2.8s" begin="1.3s" repeatCount="indefinite"
        calcMode="spline" keyTimes="0;0.5;1" keySplines={`${EASE};${EASE}`} />}
    </path>)}
  </svg>;
}
