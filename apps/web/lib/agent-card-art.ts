/** Immutable, shared artwork. No agent data or external resources enter this layer. */
export function cardMaterialMarkup(identifier = "card") {
  const id = identifier.replace(/[^a-zA-Z0-9_-]/g, "");
  return `<defs>
    <linearGradient id="${id}-smoke" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#26332f" stop-opacity=".94"/><stop offset=".48" stop-color="#192321" stop-opacity=".92"/><stop offset="1" stop-color="#101716" stop-opacity=".94"/></linearGradient>
    <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#edf2ec" stop-opacity=".75"/><stop offset=".38" stop-color="#edf2ec" stop-opacity=".3"/><stop offset=".7" stop-color="#526359" stop-opacity=".24"/><stop offset="1" stop-color="#edf2ec" stop-opacity=".42"/></linearGradient>
    <linearGradient id="${id}-light" x1="460" y1="0" x2="1160" y2="580" gradientUnits="userSpaceOnUse"><stop stop-color="#edf2ec" stop-opacity="0"/><stop offset=".36" stop-color="#edf2ec" stop-opacity=".025"/><stop offset=".55" stop-color="#edf2ec" stop-opacity=".1"/><stop offset=".76" stop-color="#edf2ec" stop-opacity=".02"/><stop offset="1" stop-color="#edf2ec" stop-opacity="0"/></linearGradient>
    <clipPath id="${id}-face"><rect x="1" y="1" width="1198" height="758" rx="32"/></clipPath>
  </defs>
  <rect x="1" y="1" width="1198" height="758" rx="32" fill="url(#${id}-smoke)"/>
  <g clip-path="url(#${id}-face)">
    <g transform="translate(728 138) scale(10)" fill="#b5d7ae" opacity=".045"><path d="M8 5h9v12H8V5Zm15 18h9v12h-9V23ZM8 23h9v12H8V23ZM23 5h9v12h-9V5Z"/><path d="M5 20h30" stroke="#b5d7ae" stroke-width="3"/><path d="M20 8v24" stroke="#b5d7ae" stroke-width="2" stroke-dasharray="3 5"/></g>
    <path d="M432-100H710L1320 620V900Z" fill="url(#${id}-light)"/>
    <path d="M701 0 1200 591" stroke="#edf2ec" stroke-opacity=".09" stroke-width="1"/>
  </g>
  <rect x="1" y="1" width="1198" height="758" rx="32" fill="none" stroke="url(#${id}-rim)" stroke-width="2"/>
  <rect x="15" y="15" width="1170" height="730" rx="22" fill="none" stroke="#edf2ec" stroke-opacity=".13"/>
  <path d="M34 16H1158" stroke="#edf2ec" stroke-opacity=".2" stroke-width="1"/>`;
}

export function cardChipMarkup(identifier = "chip") {
  const id = identifier.replace(/[^a-zA-Z0-9_-]/g, "");
  return `<defs><linearGradient id="${id}-silver" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#edf2ec"/><stop offset=".38" stop-color="#c7d0c9"/><stop offset=".7" stop-color="#98a89c"/><stop offset="1" stop-color="#c7d0c9"/></linearGradient></defs>
  <rect x="1" y="1" width="62" height="46" rx="8" fill="url(#${id}-silver)" stroke="#c7d0c9" stroke-width="1"/>
  <rect x="21" y="10" width="22" height="28" rx="4" fill="#98a89c" stroke="#526359"/>
  <path d="M1 16h20m-20 16h20m22-16h20M43 32h20M28 1v9m9-9v9M28 38v9m9-9v9M1 24h20m22 0h20" fill="none" stroke="#526359" stroke-width="1.2"/>
  <path d="M9 3h45" stroke="#edf2ec" stroke-opacity=".8"/>`;
}
