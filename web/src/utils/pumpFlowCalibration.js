// Pure pump-flow calibration math. No I/O, no state — safe to call from
// anywhere (including tests). Same algorithm as the community `analyze.js`
// that originally shipped outside the web UI.

// Filters a parsed shot for samples in a "Measure X bar" phase (target temp
// 25 °C, target pressure = X bar) and computes the calibration factor from
// real flow (delta volume / delta time) vs. estimated flow (integral of
// reported pump flow). Caller multiplies the existing coefficient for that
// pressure point by this factor to get the new coefficient.
export function analyze(samples, targetPressure) {
  const measure = samples.filter(s => s.tt === 25 && s.tp === targetPressure);
  if (measure.length < 2) {
    throw new Error(
      `Not enough samples for tp=${targetPressure} bar (Measure phase). Was the valve closed enough to reach ${targetPressure} bar?`,
    );
  }
  const first = measure[0];
  const last = measure[measure.length - 1];
  const volume = last.v - first.v;
  const time = (last.t - first.t) / 1000;
  let pumped = 0;
  let lastT = 0;
  for (const s of measure) {
    if (lastT !== 0) pumped += (s.fl / 1000) * (s.t - lastT);
    lastT = s.t;
  }
  const actualFlow = volume / time;
  const estimatedFlow = pumped / time;
  if (!Number.isFinite(actualFlow) || !(estimatedFlow > 0)) {
    throw new Error(
      `Invalid flow data for tp=${targetPressure} bar (estimatedFlow=${estimatedFlow}, actualFlow=${actualFlow}). The shot may not have produced any measurable output.`,
    );
  }
  return { volume, time, actualFlow, estimatedFlow, factor: actualFlow / estimatedFlow };
}

export function parseCoeffs(raw) {
  const [c1, c9] = (raw || '').split(',').map(Number.parseFloat);
  if (!Number.isFinite(c1) || !Number.isFinite(c9)) {
    throw new TypeError(`Current coefficients are not numeric: "${raw}"`);
  }
  return [c1, c9];
}
