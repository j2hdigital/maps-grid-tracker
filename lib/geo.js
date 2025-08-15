export function metersToLatDelta(m) {
  return m / 111320;
}
export function metersToLngDelta(m, atLatDeg) {
  return m / (111320 * Math.cos(atLatDeg * Math.PI/180));
}
export function buildGrid({ centerLat, centerLng, gridSize, spacingM }) {
  const half = Math.floor(gridSize/2);
  const latStep = metersToLatDelta(spacingM);
  const lngStep = metersToLngDelta(spacingM, centerLat);
  const cells = [];
  for (let r=-half; r<=half; r++) {
    for (let c=-half; c<=half; c++) {
      cells.push({
        row: r+half, col: c+half,
        lat: +(centerLat + r*latStep).toFixed(6),
        lng: +(centerLng + c*lngStep).toFixed(6)
      });
    }
  }
  return cells;
}
