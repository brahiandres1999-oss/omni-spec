/**
 * Canonical Omni Studio brand emblem (STUDIO-DESIGN-SYSTEM.md §2).
 * Renders the 4-archetypes architectural plinth (Feature, Bugfix, Tech Debt, RFC)
 * with the central golden gate jewel in calibrated vector geometry.
 */
import type { SVGProps } from 'react';

interface StudioLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export function StudioLogo({ size = 16, className, ...props }: StudioLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id="omni-steel" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#58A6FF" />
          <stop offset="100%" stopColor="#1F6FEB" />
        </linearGradient>
        <linearGradient id="omni-copper" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id="omni-sage" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3FB950" />
          <stop offset="100%" stopColor="#238636" />
        </linearGradient>
        <linearGradient id="omni-titanium" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F0F6FC" />
          <stop offset="100%" stopColor="#8B949E" />
        </linearGradient>
      </defs>

      {/* Subtle isometric base plinth shadow */}
      <polygon points="12,21.5 19,17.5 12,13.5 5,17.5" fill="#000000" opacity="0.35" />

      {/* Isometric foundation slab */}
      <polygon points="12,14 18.5,17.5 12,21 5.5,17.5" fill="#181D26" stroke="#383F47" strokeWidth="0.75" />
      <polygon points="5.5,17.5 12,21 12,22 5.5,18.5" fill="#0D1117" />
      <polygon points="12,21 18.5,17.5 18.5,18.5 12,22" fill="#080A0E" />

      {/* Top Quadrant: FEATURE (Steel/Cobalt) */}
      <g transform="translate(12, 7.5)">
        <polygon points="0,-4.5 4,-2.2 0,0 -4,-2.2" fill="url(#omni-steel)" stroke="#79C0FF" strokeWidth="0.6" />
        <polygon points="-4,-2.2 0,0 0,1.5 -4,-0.7" fill="#1F6FEB" />
        <polygon points="0,0 4,-2.2 4,-0.7 0,1.5" fill="#1158C7" />
      </g>

      {/* Right Quadrant: BUGFIX (Warm Amber) */}
      <g transform="translate(15.8, 10)">
        <polygon points="0,-3.5 3.5,-1.2 0,1 -3.5,-1.2" fill="url(#omni-copper)" stroke="#FCD34D" strokeWidth="0.6" />
        <polygon points="-3.5,-1.2 0,1 0,2.2 -3.5,0" fill="#B45309" />
        <polygon points="0,1 3.5,-1.2 3.5,0 0,2.2" fill="#92400E" />
      </g>

      {/* Bottom Quadrant: TECH DEBT (Sage) */}
      <g transform="translate(12, 12.2)">
        <polygon points="0,-2 3.5,0.2 0,2.2 -3.5,0.2" fill="url(#omni-sage)" stroke="#7EE787" strokeWidth="0.6" />
        <polygon points="-3.5,0.2 0,2.2 0,3.2 -3.5,1.2" fill="#238636" />
        <polygon points="0,2.2 3.5,0.2 3.5,1.2 0,3.2" fill="#196C2E" />
      </g>

      {/* Left Quadrant: RFC / ADR (Titanium) */}
      <g transform="translate(8.2, 10)">
        <polygon points="0,-3.5 3.5,-1.2 0,1 -3.5,-1.2" fill="url(#omni-titanium)" stroke="#FFFFFF" strokeWidth="0.6" />
        <polygon points="-3.5,-1.2 0,1 0,2.2 -3.5,0" fill="#6E7681" />
        <polygon points="0,1 3.5,-1.2 3.5,0 0,2.2" fill="#484F58" />
      </g>

      {/* Central Gate Aperture & Focal Jewel */}
      <polygon points="12,9 14.5,10.2 12,11.5 9.5,10.2" fill="#0D1117" stroke="#E3A048" strokeWidth="0.8" />
      <circle cx="12" cy="10.2" r="1.1" fill="#F59E0B" />
      <circle cx="12" cy="10.2" r="0.5" fill="#FFFFFF" />
    </svg>
  );
}
