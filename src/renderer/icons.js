// Tree node icons. Each style draws a "branch" icon (node with children) and
// a "leaf" icon, tinted with the depth colour. Gradients live in a shared
// <defs> block that renderTree() refreshes, keyed by colour, so a tree of 500
// nodes shares a handful of definitions. Fills are flat; every shape gets a
// crisp white outline plus a rim line on its upper-left edges, so the sets
// read as one family and pop against dark and light trees alike.

export const ICON_STYLES = ['folders', 'planets', 'leaves', 'circuits', 'network', 'tags', 'aliens', 'potions', 'skulls', 'robots', 'mushrooms', 'clouds', 'wizards', 'shapes', 'dots', 'none'];
export const ICON_LABELS = {
  folders: 'Folders', planets: 'Planets & stars', leaves: 'Trees & leaves', circuits: 'Chips & RAM',
  network: 'Network', tags: 'Tags', aliens: 'Saucers & rockets', potions: 'Potions', skulls: 'Skulls & daggers', robots: 'Robots & gears',
  mushrooms: 'Mushrooms', clouds: 'Clouds & bolts', wizards: 'Wizard hats & orbs', shapes: 'Gems', dots: 'Orbs', none: 'None',
};
export const DEFAULT_ICON_COLORS = ['#0a84ff', '#bf5af2', '#30d158', '#ff9f0a', '#ff375f', '#64d2ff'];

const key = (color) => color.replace(/[^a-z0-9]/gi, '');
const mix = (color, with_, pct) => `color-mix(in srgb, ${color}, ${with_} ${pct}%)`;

// One set of gradients per colour, referenced by url(#…) from the icons.
export function iconDefs(colors) {
  const defs = colors.map((c) => {
    const k = key(c);
    // Flat fills: every "gradient" is a single colour, so icons show exactly
    // the configured colour. Depth comes from the white wireframe and flat
    // facet tints instead of shading.
    const solid = (id, c1) => `<linearGradient id="${id}"><stop offset="0" style="stop-color:${c1}"/><stop offset="1" style="stop-color:${c1}"/></linearGradient>`;
    return solid(`ig-face-${k}`, c)
      + solid(`ig-back-${k}`, mix(c, 'black', 28))
      + `<linearGradient id="ig-sheen-${k}"><stop offset="0" style="stop-color:white;stop-opacity:0"/><stop offset="1" style="stop-color:white;stop-opacity:0"/></linearGradient>`
      + `<radialGradient id="ig-orb-${k}"><stop offset="0" style="stop-color:${c}"/><stop offset="1" style="stop-color:${c}"/></radialGradient>`
      + solid(`ig-gem-${k}`, c);
  });
  const shared = `<clipPath id="ig-ring-front"><rect x="-6" y="10.5" width="32" height="20" transform="rotate(-24 10 10.5)"/></clipPath>`;
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${shared}${defs.join('')}</defs></svg>`;
}

export function nodeIcon(style, color, hasKids) {
  if (style === 'none') return '';
  const k = key(color);
  const face = `url(#ig-face-${k})`;
  const back = `url(#ig-back-${k})`;
  const sheen = `url(#ig-sheen-${k})`;
  const orb = `url(#ig-orb-${k})`;
  const gem = `url(#ig-gem-${k})`;
  const dark = mix(color, 'black', 35);
  const light = mix(color, 'white', 60);
  const ink = mix(color, 'black', 55);
  const svg = (body) => `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">${body}</svg>`;
  // rim light: a bright line along an upper-left edge
  const rim = () => ''; // extra highlight lines dropped: they washed the colour out
  const outline = (d) => `<path d="${d}" fill="none" stroke="white" stroke-opacity="0.7" stroke-width="0.6" stroke-linejoin="round"/>`;
  // inner edges: the same white line along facets, folds and seams
  const edge = (d, op = 0.55) => `<path d="${d}" fill="none" stroke="white" stroke-opacity="${Math.min(op, 0.55)}" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const ring = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="white" stroke-opacity="0.7" stroke-width="0.6"/>`;

  switch (style) {
    case 'dots': // orbs
      return svg(hasKids
        ? `<circle cx="10" cy="10" r="8.6" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="1.2"/>
           <circle cx="10" cy="10" r="6" fill="${orb}"/>
           ${rim('M5.2 7.6a5.6 5.6 0 0 1 3.2-3.1', 0.75)}
           ${ring(10, 10, 6)}`
        : `<circle cx="10" cy="10" r="4.6" fill="${orb}"/>
           ${rim('M6.3 8.3a4.2 4.2 0 0 1 2.3-2.4', 0.75)}
           ${ring(10, 10, 4.6)}`);

    case 'clouds': // cloud / lightning bolt
      return svg(hasKids
        ? `<path d="M5.6 15.4a3.2 3.2 0 0 1-.4-6.4 4.7 4.7 0 0 1 9-1.5 3.5 3.5 0 0 1 .6 7.9z" fill="${face}"/>
           <path d="M5.6 15.4a3.2 3.2 0 0 1-.4-6.4 4.7 4.7 0 0 1 9-1.5c-3.2-.4-6.4 1.6-8.6 7.9z" fill="${sheen}"/>
           <path d="M14.2 7.5a3.5 3.5 0 0 1 .6 7.9H10c2-2.6 3.2-5.2 4.2-7.9z" fill="black" fill-opacity="0.1"/>
           <circle cx="7.2" cy="11.2" r="0.8" fill="white" fill-opacity="0.5"/>
           ${outline('M5.6 15.4a3.2 3.2 0 0 1-.4-6.4 4.7 4.7 0 0 1 9-1.5 3.5 3.5 0 0 1 .6 7.9z')}
           ${edge('M5.2 9a4.6 4.6 0 0 1 2.4-.2M14.2 7.5a3.6 3.6 0 0 1-1.6 2.4', 0.6)}
           ${rim('M3.6 11.2a2.8 2.8 0 0 1 2-2.2', 0.85)}
           ${rim('M8.2 6.4a4.2 4.2 0 0 1 3.2-1.4', 0.7)}`
        : `<path d="M11.6 1.8L5.4 10.6h3.8L7.6 18.2 14.6 8.8h-3.8l1.2-7z" fill="${gem}"/>
           <path d="M9.2 10.6L7.6 18.2 14.6 8.8h-3.8z" fill="black" fill-opacity="0.12"/>
           ${outline('M11.6 1.8L5.4 10.6h3.8L7.6 18.2 14.6 8.8h-3.8l1.2-7z')}
           ${edge('M9.2 10.6l2.2-7.6M10.8 8.8l-2 7.2', 0.55)}
           ${rim('M6.6 9.8l4.4-6.4', 0.85)}`);

    case 'wizards': // wizard hat / crystal orb
      return svg(hasKids
        ? `<ellipse cx="10" cy="14.4" rx="8.2" ry="2.4" fill="${back}"/>
           <path d="M10.6 1.4c-1.6 1.8-2.8 4.4-5.4 11.6h9.6C13.4 7.4 12.8 4.6 10.6 1.4z" fill="${face}"/>
           <path d="M10.6 1.4c-1.6 1.8-2.8 4.4-5.4 11.6h3.2C9 7.8 9.8 4.8 10.6 1.4z" fill="${sheen}"/>
           <path d="M10.6 1.4c2.2 3.2 2.8 6 4.2 11.6h-3.6C10.8 7.8 10.6 4.6 10.6 1.4z" fill="black" fill-opacity="0.12"/>
           <path d="M5.8 11.6h8.2l.4 1.4H5.4z" fill="${ink}" fill-opacity="0.8"/>
           <path d="M8.2 6.4l.5 1.2 1.2.4-1.2.4-.5 1.2-.5-1.2L6.5 8l1.2-.4zM11.8 9.2l.3.8.8.3-.8.3-.3.8-.3-.8-.8-.3.8-.3z" fill="white" fill-opacity="0.85"/>
           <ellipse cx="10" cy="14.4" rx="8.2" ry="2.4" fill="${face}" fill-opacity="0.001"/>
           <path d="M1.8 14.4a8.2 2.4 0 0 0 16.4 0" fill="${face}"/>
           ${outline('M1.8 14.4a8.2 2.4 0 1 0 16.4 0a8.2 2.4 0 1 0-16.4 0z')}
           ${outline('M10.6 1.4c-1.6 1.8-2.8 4.4-5.4 11.6h9.6C13.4 7.4 12.8 4.6 10.6 1.4z')}
           ${edge('M5.8 11.6h8.2M5.4 13h9.2', 0.6)}
           ${rim('M6.4 11.2C8 6.6 9.2 4.2 10.4 2.4', 0.85)}
           ${rim('M2.8 13.6c1.4-.8 3.4-1.2 5.6-1.3', 0.6)}`
        : `<path d="M6.4 17.2c.4-1.8 1.7-2.8 3.6-2.8s3.2 1 3.6 2.8z" fill="${ink}"/>
           <path d="M8.2 15.2c.5-.3 1.1-.5 1.8-.5s1.3.2 1.8.5" fill="none" stroke="white" stroke-opacity="0.2" stroke-width="0.5"/>
           <circle cx="10" cy="9" r="5.2" fill="${orb}"/>
           <path d="M10 5.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="white" fill-opacity="0.8"/>
           ${ring(10, 9, 5.2)}
           ${edge('M6.4 17.2c.4-1.8 1.7-2.8 3.6-2.8s3.2 1 3.6 2.8z', 0.6)}
           ${rim('M5.4 7.4a4.8 4.8 0 0 1 2.8-2.9', 0.85)}`);

    case 'shapes': // gems
      return svg(hasKids
        ? `<path d="M10 1.8l7.2 4.1v8.2L10 18.2l-7.2-4.1V5.9z" fill="${gem}"/>
           <path d="M10 10l7.2-4.1v8.2L10 18.2z" fill="black" fill-opacity="0.18"/>
           <path d="M10 10v8.2L2.8 14.1V5.9z" fill="black" fill-opacity="0.06"/>
           ${outline('M10 1.8l7.2 4.1v8.2L10 18.2l-7.2-4.1V5.9z')}
           ${edge('M10 10v8.2M10 10L2.8 5.9M10 10l7.2-4.1')}
           ${rim('M4.2 6.6l5.8-3.3')}`
        : `<path d="M10 2.6l6.6 7.4-6.6 7.4L3.4 10z" fill="${gem}"/>
           <path d="M10 2.6L3.4 10 10 17.4z" fill="black" fill-opacity="0.08"/>
           ${outline('M10 2.6l6.6 7.4-6.6 7.4L3.4 10z')}
           ${edge('M3.4 10h13.2M10 2.6v14.8', 0.6)}
           ${rim('M6 8.6l3.2-3.6', 0.75)}`);

    default: // folders
      return svg(hasKids
        ? `<path d="M2.2 5.4a1.6 1.6 0 0 1 1.6-1.6h4l1.7 1.8h6.9a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H3.8a1.6 1.6 0 0 1-1.6-1.6z" fill="${back}"/>
           <rect x="4.6" y="6.4" width="10.8" height="9.2" rx="1" fill="#fff" fill-opacity="0.85"/>
           <path d="M6.2 8.6h7.6M6.2 10.6h5.2" stroke="${ink}" stroke-opacity="0.35" stroke-width="0.9" stroke-linecap="round"/>
           <path d="M2.2 8.9a1.6 1.6 0 0 1 1.6-1.6h12.4a1.6 1.6 0 0 1 1.6 1.6l-.6 6.7a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6z" fill="${face}"/>
           <path d="M2.2 8.9a1.6 1.6 0 0 1 1.6-1.6h12.4a1.6 1.6 0 0 1 1.6 1.6v1.2H2.2z" fill="${sheen}"/>
           ${outline('M2.2 8.9a1.6 1.6 0 0 1 1.6-1.6h12.4a1.6 1.6 0 0 1 1.6 1.6l-.6 6.7a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6z')}
           ${edge('M2.2 7.3V5.4a1.6 1.6 0 0 1 1.6-1.6h4l1.7 1.8h6.9a1.6 1.6 0 0 1 1.6 1.6v.1', 0.7)}
           ${rim('M3.4 8h12.6')}`
        : `<path d="M4.6 2.6h7.2l4 4v10.2a1.2 1.2 0 0 1-1.2 1.2H5.8a1.2 1.2 0 0 1-1.2-1.2z" fill="#f4f4f6"/>
           <path d="M4.6 2.6h7.2l4 4v10.2a1.2 1.2 0 0 1-1.2 1.2H5.8a1.2 1.2 0 0 1-1.2-1.2z" fill="${sheen}"/>
           <path d="M11.8 2.6l4 4h-2.8a1.2 1.2 0 0 1-1.2-1.2z" fill="${color}"/>
           <rect x="4.6" y="11.4" width="11.2" height="3.2" fill="${face}"/>
           <path d="M6.6 8.4h5M6.6 16.2h5.6" stroke="${ink}" stroke-opacity="0.35" stroke-width="0.9" stroke-linecap="round"/>
           ${outline('M4.6 2.6h7.2l4 4v10.2a1.2 1.2 0 0 1-1.2 1.2H5.8a1.2 1.2 0 0 1-1.2-1.2z')}
           ${edge('M11.8 2.6v2.8a1.2 1.2 0 0 0 1.2 1.2h2.8M4.6 11.4h11.2M4.6 14.6h11.2', 0.65)}
           ${rim('M5.4 15.6V3.4h6', 0.6)}`);

    case 'planets': // ringed planet / star
      return svg(hasKids
        ? `<ellipse cx="10" cy="10.5" rx="9.2" ry="2.9" transform="rotate(-24 10 10.5)" fill="none" stroke="${mix(color, 'white', 45)}" stroke-width="1.5" stroke-opacity="0.45"/>
           <circle cx="10" cy="10" r="5.3" fill="${orb}"/>
           <path d="M5.4 11.6c2.6 1.6 6.6 1.6 9.2 0" fill="none" stroke="white" stroke-opacity="0.2" stroke-width="0.5" stroke-linecap="round"/>
           <path d="M5.9 8.6c2.2-1.1 6-1.1 8.2 0" fill="none" stroke="black" stroke-opacity="0.18" stroke-width="1" stroke-linecap="round"/>
           ${rim('M5.6 8a5 5 0 0 1 3-2.9', 0.8)}
           ${ring(10, 10, 5.3)}
           <ellipse cx="10" cy="10.5" rx="9.2" ry="2.9" transform="rotate(-24 10 10.5)" fill="none" stroke="${mix(color, 'white', 55)}" stroke-width="1.6" clip-path="url(#ig-ring-front)"/>
           <ellipse cx="10" cy="10.5" rx="9.2" ry="2.9" transform="rotate(-24 10 10.5)" fill="none" stroke="white" stroke-opacity="0.7" stroke-width="0.5" clip-path="url(#ig-ring-front)"/>`
        : `<path d="M10 2.4l1.9 5.7 5.7 1.9-5.7 1.9-1.9 5.7-1.9-5.7L2.4 10l5.7-1.9z" fill="${gem}"/>
           <path d="M10 10l-1.9 5.7L10 17.6z" fill="black" fill-opacity="0.15"/>
           ${outline('M10 2.4l1.9 5.7 5.7 1.9-5.7 1.9-1.9 5.7-1.9-5.7L2.4 10l5.7-1.9z')}
           ${edge('M10 2.4v15.2M2.4 10h15.2', 0.5)}
           ${rim('M8.3 7.9L10 3.2', 0.8)}
           <circle cx="15.5" cy="4.5" r="1" fill="${light}" fill-opacity="0.9"/>
           <circle cx="4.2" cy="15.6" r="0.7" fill="${light}" fill-opacity="0.7"/>`);

    case 'leaves': // sprig / single leaf
      return svg(hasKids
        ? `<path d="M8.9 17.8v-4.6h2.2v4.6z" fill="${ink}"/>
           <path d="M7.2 17.8c.8-.6 1.6-.9 2.8-.9s2 .3 2.8.9" fill="none" stroke="${ink}" stroke-opacity="0.6" stroke-width="0.8" stroke-linecap="round"/>
           <path d="M10 2.2c-2.3 0-3.8 1.6-4 3.4C4.2 6 2.8 7.5 2.8 9.4c0 2.2 1.7 3.8 3.8 3.8h6.8c2.1 0 3.8-1.6 3.8-3.8 0-1.9-1.4-3.4-3.2-3.8C13.8 3.8 12.3 2.2 10 2.2z" fill="${face}"/>
           <path d="M10 2.2c-2.3 0-3.8 1.6-4 3.4C4.2 6 2.8 7.5 2.8 9.4c0 1 .4 1.9 1 2.6C6 7.4 8 4.6 10 2.2z" fill="${sheen}"/>
           <path d="M10 2.2c2.3 0 3.8 1.6 4 3.4 1.8.4 3.2 1.9 3.2 3.8 0 2.2-1.7 3.8-3.8 3.8H10z" fill="black" fill-opacity="0.1"/>
           <circle cx="7" cy="8.2" r="0.9" fill="white" fill-opacity="0.5"/><circle cx="12.6" cy="6.6" r="0.7" fill="white" fill-opacity="0.45"/><circle cx="13.4" cy="10.4" r="0.6" fill="white" fill-opacity="0.4"/>
           ${outline('M10 2.2c-2.3 0-3.8 1.6-4 3.4C4.2 6 2.8 7.5 2.8 9.4c0 2.2 1.7 3.8 3.8 3.8h6.8c2.1 0 3.8-1.6 3.8-3.8 0-1.9-1.4-3.4-3.2-3.8C13.8 3.8 12.3 2.2 10 2.2z')}
           ${edge('M6 5.6c.8.8 1.8 1.3 3 1.5M14 5.6c-.8.8-1.8 1.3-3 1.5M8.9 13.2v4.6h2.2v-4.6', 0.6)}
           ${rim('M3.8 8.6c.5-1.4 1.6-2.3 3-2.6', 0.85)}`
        : `<path d="M4.4 15.8C4 9.6 8.6 4.4 16 4c.4 6.2-4.2 11.4-11.6 11.8z" fill="${face}"/>
           ${rim('M4.4 15.8L16 4', 0.6)}
           <path d="M7.4 12.6l-1-2.8M9.4 10.6l-.6-2.6M11.4 8.6l-.4-2.2M8 12l2.8.4M10 10l2.6.2" fill="none" stroke="white" stroke-opacity="0.65" stroke-width="0.6" stroke-linecap="round"/>
           ${rim('M4.8 14.6C5.2 9.8 9 5.6 15 4.4', 0.75)}
           <path d="M4.4 15.8L2.6 17.6" fill="none" stroke="${ink}" stroke-opacity="0.7" stroke-width="1.3" stroke-linecap="round"/>
           ${outline('M4.4 15.8C4 9.6 8.6 4.4 16 4c.4 6.2-4.2 11.4-11.6 11.8z')}`);

    case 'circuits': // chip / terminal
      return svg(hasKids
        ? `<path d="M2.6 7h2.2M2.6 10h2.2M2.6 13h2.2M15.2 7h2.2M15.2 10h2.2M15.2 13h2.2M7 2.6v2.2M10 2.6v2.2M13 2.6v2.2M7 15.2v2.2M10 15.2v2.2M13 15.2v2.2" fill="none" stroke="${mix(color, 'white', 25)}" stroke-width="1.3" stroke-linecap="round"/>
           <rect x="4.6" y="4.6" width="10.8" height="10.8" rx="2" fill="${face}"/>
           <rect x="4.6" y="4.6" width="10.8" height="5" rx="2" fill="${sheen}"/>
           <rect x="7.2" y="7.2" width="5.6" height="5.6" rx="1" fill="${ink}" fill-opacity="0.75"/>
           <path d="M8.3 8.3h3.4M8.3 10h2.2M8.3 11.7h3.4" fill="none" stroke="${light}" stroke-opacity="0.8" stroke-width="0.6" stroke-linecap="round"/>
           ${outline('M4.6 6.6a2 2 0 0 1 2-2h6.8a2 2 0 0 1 2 2v6.8a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2z')}
           ${edge('M7.2 8.2a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1v3.6a1 1 0 0 1-1 1H8.2a1 1 0 0 1-1-1z', 0.7)}
           ${rim('M5.4 13.6V6.6a1.2 1.2 0 0 1 1.2-1.2h7')}`
        : `<path d="M3.2 13.8v2.6M5.2 13.8v2.6M7.2 13.8v2.6M9.2 13.8v2.6M11.2 13.8v2.6M13.2 13.8v2.6M15.2 13.8v2.6M16.8 13.8v2.6" fill="none" stroke="${mix(color, 'white', 50)}" stroke-width="1.1" stroke-linecap="round"/>
           <rect x="2.2" y="5" width="15.6" height="9" rx="1.2" fill="${face}"/>
           <rect x="2.2" y="5" width="15.6" height="4" rx="1.2" fill="${sheen}"/>
           <rect x="3.8" y="6.8" width="3.2" height="4" rx="0.5" fill="${ink}" fill-opacity="0.8"/>
           <rect x="8.4" y="6.8" width="3.2" height="4" rx="0.5" fill="${ink}" fill-opacity="0.8"/>
           <rect x="13" y="6.8" width="3.2" height="4" rx="0.5" fill="${ink}" fill-opacity="0.8"/>
           <path d="M4.6 8.4h1.6M9.2 8.4h1.6M13.8 8.4h1.6" stroke="${light}" stroke-opacity="0.7" stroke-width="0.6" stroke-linecap="round"/>
           ${outline('M2.2 6.2A1.2 1.2 0 0 1 3.4 5h13.2a1.2 1.2 0 0 1 1.2 1.2v6.6a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2z')}
           ${edge('M3.8 7.3a.5.5 0 0 1 .5-.5h2.2a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H4.3a.5.5 0 0 1-.5-.5zM8.4 7.3a.5.5 0 0 1 .5-.5h2.2a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H8.9a.5.5 0 0 1-.5-.5zM13 7.3a.5.5 0 0 1 .5-.5h2.2a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-2.2a.5.5 0 0 1-.5-.5z', 0.65)}
           ${rim('M3 12.4V6.2a.6.6 0 0 1 .6-.6h12', 0.55)}`);

    case 'network': // hub with satellites / single node
      return svg(hasKids
        ? `<path d="M9 10.5L15.6 5.2M9 10.5l7 4M9 10.5l-5.2 4.6" fill="none" stroke="white" stroke-opacity="0.8" stroke-width="1" stroke-linecap="round"/>
           <circle cx="9" cy="10.5" r="3.8" fill="${orb}"/>
           ${ring(9, 10.5, 3.8)}
           ${rim('M5.9 9a3.4 3.4 0 0 1 2.1-2', 0.75)}
           <circle cx="15.8" cy="4.6" r="2.1" fill="${gem}"/>${ring(15.8, 4.6, 2.1)}
           <circle cx="16.4" cy="14.8" r="2.1" fill="${gem}"/>${ring(16.4, 14.8, 2.1)}
           <circle cx="3.6" cy="15.6" r="2.1" fill="${gem}"/>${ring(3.6, 15.6, 2.1)}
           <circle cx="15.1" cy="3.9" r="0.6" fill="white" fill-opacity="0.7"/><circle cx="15.7" cy="14.1" r="0.6" fill="white" fill-opacity="0.7"/><circle cx="2.9" cy="14.9" r="0.6" fill="white" fill-opacity="0.7"/>`
        : `<path d="M10 10l5.4-4.4" fill="none" stroke="white" stroke-opacity="0.8" stroke-width="1" stroke-linecap="round"/>
           <circle cx="10" cy="10.4" r="3.6" fill="${orb}"/>
           ${ring(10, 10.4, 3.6)}
           ${rim('M7 9a3.2 3.2 0 0 1 2-1.9', 0.75)}
           <circle cx="15.6" cy="5.4" r="1.5" fill="${gem}"/>${ring(15.6, 5.4, 1.5)}
           <circle cx="10" cy="10.4" r="6.4" fill="none" stroke="${color}" stroke-opacity="0.22" stroke-width="0.8" stroke-dasharray="1.6 1.6"/>`);

    case 'tags': // two labels / one label
      return svg(hasKids
        ? `<g transform="translate(2.2 -2.6)"><path d="M3.5 6.5h7.4l5.6 4.9-5.6 4.9H3.5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1z" fill="${back}"/>${edge('M3.5 6.5h7.4l5.6 4.9-2 1.8', 0.6)}</g>
           <path d="M3.5 6.5h7.4l5.6 4.9-5.6 4.9H3.5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1z" fill="${face}"/>
           <path d="M3.5 6.5h7.4l5.6 4.9H2.5V7.5a1 1 0 0 1 1-1z" fill="${sheen}"/>
           <circle cx="6" cy="11.4" r="1.2" fill="${ink}"/>
           <circle cx="6" cy="11.4" r="0.5" fill="white" fill-opacity="0.35"/>
           <path d="M8.8 10h3.4M8.8 12.6h2.2" stroke="white" stroke-opacity="0.45" stroke-width="0.9" stroke-linecap="round"/>
           ${outline('M3.5 6.5h7.4l5.6 4.9-5.6 4.9H3.5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1z')}
           ${edge('M6 10.2a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 0 1 0-2.4z', 0.7)}
           ${rim('M3.3 15V7.4h7.4')}`
        : `<path d="M3.5 5.2h7.4l6.2 5.4-6.2 5.4H3.5a1 1 0 0 1-1-1V6.2a1 1 0 0 1 1-1z" fill="${face}"/>
           <path d="M3.5 5.2h7.4l6.2 5.4H2.5V6.2a1 1 0 0 1 1-1z" fill="${sheen}"/>
           <circle cx="6" cy="10.6" r="1.3" fill="${ink}"/>
           <circle cx="6" cy="10.6" r="0.55" fill="white" fill-opacity="0.35"/>
           <path d="M8.8 9h3.6M8.8 12h2.4" stroke="white" stroke-opacity="0.45" stroke-width="0.9" stroke-linecap="round"/>
           ${outline('M3.5 5.2h7.4l6.2 5.4-6.2 5.4H3.5a1 1 0 0 1-1-1V6.2a1 1 0 0 1 1-1z')}
           ${edge('M6 9.3a1.3 1.3 0 1 1 0 2.6a1.3 1.3 0 0 1 0-2.6z', 0.7)}
           ${rim('M3.3 14.4V6.1h7.4')}`);

    case 'aliens': // flying saucer / alien
      return svg(hasKids
        ? `<path d="M6.4 9.6a3.6 3 0 0 1 7.2 0z" fill="${mix(color, 'white', 70)}" fill-opacity="0.9"/>
           <path d="M6.4 9.6a3.6 3 0 0 1 7.2 0z" fill="${sheen}"/>
           <ellipse cx="10" cy="8.6" rx="1.1" ry="1.3" fill="${ink}" fill-opacity="0.8"/>
           <circle cx="9.6" cy="8.2" r="0.35" fill="white" fill-opacity="0.9"/>
           ${outline('M6.4 9.6a3.6 3 0 0 1 7.2 0')}
           <ellipse cx="10" cy="11" rx="8.6" ry="2.8" fill="${face}"/>
           <ellipse cx="10" cy="10.4" rx="8.6" ry="2.2" fill="${sheen}"/>
           <ellipse cx="10" cy="12.6" rx="5.2" ry="1.3" fill="${dark}" fill-opacity="0.8"/>
           <circle cx="4.4" cy="11.4" r="0.8" fill="${light}"/><circle cx="10" cy="13.2" r="0.8" fill="${light}"/><circle cx="15.6" cy="11.4" r="0.8" fill="${light}"/>
           <path d="M8.2 15.6l-1 2.2M10 15.8v2M11.8 15.6l1 2.2" stroke="${light}" stroke-opacity="0.6" stroke-width="0.8" stroke-linecap="round"/>
           ${outline('M1.4 11a8.6 2.8 0 1 0 17.2 0 8.6 2.8 0 1 0-17.2 0z')}
           ${edge('M4.8 12.6a5.2 1.3 0 1 0 10.4 0a5.2 1.3 0 1 0-10.4 0z', 0.55)}
           ${rim('M2.6 10.2c2-1.2 4.6-1.8 7.4-1.8', 0.9)}`
        : `<path d="M6.6 10.8L3.4 14.4v1.8l3.2-1.4zM13.4 10.8l3.2 3.6v1.8l-3.2-1.4z" fill="${gem}"/>
           <path d="M8.3 14.6h3.4c0 1.9-.9 3.3-1.7 3.9-.8-.6-1.7-2-1.7-3.9z" fill="${mix(color, 'white', 55)}"/>
           <path d="M9.2 14.6h1.6c0 1.2-.4 2.1-.8 2.5-.4-.4-.8-1.3-.8-2.5z" fill="white" fill-opacity="0.8"/>
           <path d="M10 1.8c2.4 2 3.4 5 3.4 8.6v3.4a.8.8 0 0 1-.8.8H7.4a.8.8 0 0 1-.8-.8v-3.4c0-3.6 1-6.6 3.4-8.6z" fill="${face}"/>
           <path d="M10 1.8c2.4 2 3.4 5 3.4 8.6v3.4a.8.8 0 0 1-.8.8H10z" fill="black" fill-opacity="0.12"/>
           <circle cx="10" cy="8.2" r="1.7" fill="${ink}"/>
           <circle cx="9.5" cy="7.7" r="0.5" fill="white" fill-opacity="0.85"/>
           ${outline('M10 1.8c2.4 2 3.4 5 3.4 8.6v3.4a.8.8 0 0 1-.8.8H7.4a.8.8 0 0 1-.8-.8v-3.4c0-3.6 1-6.6 3.4-8.6z')}
           ${edge('M6.6 10.8L3.4 14.4v1.8l3.2-1.4M13.4 10.8l3.2 3.6v1.8l-3.2-1.4M10 6.5a1.7 1.7 0 1 1 0 3.4a1.7 1.7 0 0 1 0-3.4zM6.6 12.2h6.8', 0.7)}
           ${rim('M9.6 2.6c-1.6 1.6-2.4 3.8-2.6 6.6', 0.85)}`);

    case 'potions': // flask / vial
      return svg(hasKids
        ? `<path d="M8.4 6.6L3.6 15.4a1.6 1.6 0 0 0 1.4 2.4h10a1.6 1.6 0 0 0 1.4-2.4L11.6 6.6z" fill="white" fill-opacity="0.14"/>
           <path d="M5.9 11.2L3.6 15.4a1.6 1.6 0 0 0 1.4 2.4h10a1.6 1.6 0 0 0 1.4-2.4l-2.3-4.2z" fill="${face}"/>
           <path d="M5.9 11.2h8.2" stroke="${light}" stroke-opacity="0.8" stroke-width="0.8"/>
           <circle cx="8" cy="14.2" r="0.9" fill="white" fill-opacity="0.55"/><circle cx="11.6" cy="15.4" r="0.6" fill="white" fill-opacity="0.5"/><circle cx="10.4" cy="12.8" r="0.5" fill="white" fill-opacity="0.5"/>
           <rect x="8.4" y="2.6" width="3.2" height="4.2" fill="white" fill-opacity="0.16"/>
           <rect x="7.8" y="1.8" width="4.4" height="1.6" rx="0.5" fill="${ink}"/>
           ${outline('M8.4 3.4v3.2L3.6 15.4a1.6 1.6 0 0 0 1.4 2.4h10a1.6 1.6 0 0 0 1.4-2.4L11.6 6.6V3.4')}
           ${edge('M7.8 2.6a.5.5 0 0 1 .5-.5h3.4a.5.5 0 0 1 .5.5v.6H7.8zM5.9 11.2h8.2', 0.6)}
           ${rim('M4.4 15.6l4.2-7.8', 0.85)}`
        : `<path d="M7.4 2.8h5.2v10.6a2.6 2.6 0 0 1-5.2 0z" fill="white" fill-opacity="0.14"/>
           <path d="M7.4 8.4h5.2v5a2.6 2.6 0 0 1-5.2 0z" fill="${face}"/>
           <path d="M7.4 8.4h5.2" stroke="${light}" stroke-opacity="0.8" stroke-width="0.8"/>
           <circle cx="9" cy="12.2" r="0.7" fill="white" fill-opacity="0.55"/><circle cx="10.8" cy="10.4" r="0.5" fill="white" fill-opacity="0.5"/>
           <rect x="6.8" y="1.8" width="6.4" height="1.6" rx="0.5" fill="${ink}"/>
           ${outline('M7.4 3.4v10a2.6 2.6 0 0 0 5.2 0v-10')}
           ${edge('M6.8 2.3a.5.5 0 0 1 .5-.5h5.4a.5.5 0 0 1 .5.5v1.1H6.8zM7.4 8.4h5.2', 0.6)}
           ${rim('M8.2 13.2V4.2', 0.85)}`);

    case 'skulls': // skull / dagger
      return svg(hasKids
        ? `<path d="M10 2.4c4 0 6.6 2.8 6.6 6.2 0 2.3-1.1 3.9-2.6 4.9v2.2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-2.2C4.5 12.5 3.4 10.9 3.4 8.6c0-3.4 2.6-6.2 6.6-6.2z" fill="${face}"/>
           <path d="M10 2.4c4 0 6.6 2.8 6.6 6.2 0 2.3-1.1 3.9-2.6 4.9v2.2a1 1 0 0 1-1 1H10z" fill="black" fill-opacity="0.1"/>
           <ellipse cx="7.6" cy="8.8" rx="1.8" ry="2" fill="${ink}"/><ellipse cx="12.4" cy="8.8" rx="1.8" ry="2" fill="${ink}"/>
           <circle cx="7.1" cy="8.2" r="0.45" fill="white" fill-opacity="0.7"/><circle cx="11.9" cy="8.2" r="0.45" fill="white" fill-opacity="0.7"/>
           <path d="M10 11l-.9 1.6h1.8z" fill="${ink}" fill-opacity="0.85"/>
           <path d="M8.3 14.4v2.3M10 14.4v2.3M11.7 14.4v2.3" stroke="${ink}" stroke-opacity="0.8" stroke-width="0.7" stroke-linecap="round"/>
           ${outline('M10 2.4c4 0 6.6 2.8 6.6 6.2 0 2.3-1.1 3.9-2.6 4.9v2.2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-2.2C4.5 12.5 3.4 10.9 3.4 8.6c0-3.4 2.6-6.2 6.6-6.2z')}
           ${edge('M6 14.4h8M7.6 6.8a1.8 2 0 1 1 0 4a1.8 2 0 0 1 0-4zM12.4 6.8a1.8 2 0 1 1 0 4a1.8 2 0 0 1 0-4z', 0.6)}
           ${rim('M4.4 8.2c.2-2.6 2.2-4.8 5-5.2', 0.85)}`
        : `<g transform="rotate(-40 10 10)">
             <path d="M10 1.6l2.2 3.4v7.4H7.8V5z" fill="${gem}"/>
             <rect x="6" y="12.4" width="8" height="1.6" rx="0.5" fill="${face}"/>
             <rect x="8.8" y="14" width="2.4" height="3.2" rx="0.4" fill="${ink}"/>
             <circle cx="10" cy="17.6" r="0.9" fill="${face}"/>
             ${outline('M10 1.6l2.2 3.4v7.4H7.8V5z')}
             ${edge('M10 1.6v10.8M6 12.9a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v.6a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5zM8.8 14.4a.4.4 0 0 1 .4-.4h1.6a.4.4 0 0 1 .4.4v2.8a.4.4 0 0 1-.4.4H9.2a.4.4 0 0 1-.4-.4z', 0.65)}
             ${rim('M8.4 11.6V5.4L10 2.8', 0.85)}
           </g>`);

    case 'robots': // robot head / gear
      return svg(hasKids
        ? `<path d="M10 5.2V3.2" stroke="${light}" stroke-width="1" stroke-linecap="round"/>
           <circle cx="10" cy="2.6" r="1.1" fill="${gem}"/>
           <rect x="1.8" y="8.6" width="1.8" height="3.6" rx="0.6" fill="${back}"/><rect x="16.4" y="8.6" width="1.8" height="3.6" rx="0.6" fill="${back}"/>
           <rect x="3.6" y="5.2" width="12.8" height="11" rx="2.4" fill="${face}"/>
           <rect x="3.6" y="5.2" width="12.8" height="4.4" rx="2.4" fill="${sheen}"/>
           <rect x="5.8" y="7.6" width="3.2" height="3" rx="0.9" fill="${ink}"/><rect x="11" y="7.6" width="3.2" height="3" rx="0.9" fill="${ink}"/>
           <circle cx="7.8" cy="8.8" r="0.7" fill="${light}"/><circle cx="13" cy="8.8" r="0.7" fill="${light}"/>
           <path d="M6.8 13.2h6.4" stroke="${ink}" stroke-opacity="0.8" stroke-width="1.1" stroke-linecap="round"/>
           <path d="M8.4 12.6v1.2M10 12.6v1.2M11.6 12.6v1.2" stroke="${light}" stroke-opacity="0.7" stroke-width="0.6"/>
           ${outline('M3.6 7.6a2.4 2.4 0 0 1 2.4-2.4h8a2.4 2.4 0 0 1 2.4 2.4v6.2a2.4 2.4 0 0 1-2.4 2.4H6a2.4 2.4 0 0 1-2.4-2.4z')}
           ${edge('M5.8 8.5a.9.9 0 0 1 .9-.9h1.4a.9.9 0 0 1 .9.9v1.2a.9.9 0 0 1-.9.9H6.7a.9.9 0 0 1-.9-.9zM11 8.5a.9.9 0 0 1 .9-.9h1.4a.9.9 0 0 1 .9.9v1.2a.9.9 0 0 1-.9.9h-1.4a.9.9 0 0 1-.9-.9zM1.8 9.2a.6.6 0 0 1 .6-.6h.6a.6.6 0 0 1 .6.6v2.4a.6.6 0 0 1-.6.6h-.6a.6.6 0 0 1-.6-.6zM16.4 9.2a.6.6 0 0 1 .6-.6h.6a.6.6 0 0 1 .6.6v2.4a.6.6 0 0 1-.6.6H17a.6.6 0 0 1-.6-.6z', 0.6)}
           ${rim('M4.4 14V7.6a1.6 1.6 0 0 1 1.6-1.6h7.6', 0.75)}`
        : `<circle cx="10" cy="10" r="5.6" fill="none" stroke="${face}" stroke-width="3.2" stroke-dasharray="2.1 2.2" stroke-dashoffset="1"/>
           <circle cx="10" cy="10" r="5.3" fill="${face}"/>
           <circle cx="10" cy="10" r="5.3" fill="${sheen}"/>
           <circle cx="10" cy="10" r="2" fill="${ink}"/>
           <circle cx="10" cy="10" r="5.6" fill="none" stroke="white" stroke-opacity="0.75" stroke-width="0.7" stroke-dasharray="2.1 2.2" stroke-dashoffset="1"/>
           ${ring(10, 10, 4.2)}
           ${edge('M10 8a2 2 0 1 1 0 4a2 2 0 0 1 0-4z', 0.7)}
           ${rim('M6.6 8.4a3.8 3.8 0 0 1 2.4-2.3', 0.85)}`);

    case 'mushrooms': // big cap / little cap
      return svg(hasKids
        ? `<path d="M7.2 11.4h5.6l-.5 5.2a1 1 0 0 1-1 .9H8.7a1 1 0 0 1-1-.9z" fill="${mix(color, 'white', 72)}"/>
           <path d="M10 11.4h2.8l-.5 5.2a1 1 0 0 1-1 .9H10z" fill="black" fill-opacity="0.08"/>
           <path d="M2.6 10.6C2.6 5.8 5.9 2.4 10 2.4s7.4 3.4 7.4 8.2a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1z" fill="${face}"/>
           <path d="M2.6 10.6C2.6 5.8 5.9 2.4 10 2.4s7.4 3.4 7.4 8.2H2.6z" fill="${sheen}"/>
           <circle cx="6.6" cy="7.4" r="1.4" fill="white" fill-opacity="0.75"/><circle cx="11.4" cy="5.6" r="1.1" fill="white" fill-opacity="0.75"/><circle cx="13.8" cy="8.8" r="0.9" fill="white" fill-opacity="0.75"/>
           ${outline('M2.6 10.6C2.6 5.8 5.9 2.4 10 2.4s7.4 3.4 7.4 8.2a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1z')}
           ${edge('M7.2 11.6h5.6l-.5 5a1 1 0 0 1-1 .9H8.7a1 1 0 0 1-1-.9z', 0.6)}
           ${rim('M3.8 9.4c.6-3.2 2.8-5.6 5.4-6.2', 0.85)}`
        : `<path d="M8 11.4h4l-.4 4.6a.8.8 0 0 1-.8.7H9.2a.8.8 0 0 1-.8-.7z" fill="${mix(color, 'white', 72)}"/>
           <path d="M4.6 10.8c0-3.6 2.4-6.4 5.4-6.4s5.4 2.8 5.4 6.4a.8.8 0 0 1-.8.8H5.4a.8.8 0 0 1-.8-.8z" fill="${face}"/>
           <path d="M4.6 10.8c0-3.6 2.4-6.4 5.4-6.4s5.4 2.8 5.4 6.4H4.6z" fill="${sheen}"/>
           <circle cx="7.6" cy="8.2" r="1" fill="white" fill-opacity="0.75"/><circle cx="11.6" cy="7" r="0.8" fill="white" fill-opacity="0.75"/>
           ${outline('M4.6 10.8c0-3.6 2.4-6.4 5.4-6.4s5.4 2.8 5.4 6.4a.8.8 0 0 1-.8.8H5.4a.8.8 0 0 1-.8-.8z')}
           ${edge('M8 11.6h4l-.4 4.4a.8.8 0 0 1-.8.7H9.2a.8.8 0 0 1-.8-.7z', 0.6)}
           ${rim('M5.6 9.8c.4-2.4 2-4.2 4-4.6', 0.85)}`);

  }
}
