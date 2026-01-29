import { mulberry32 } from "./rng.js";
import { normal, poisson, exponential, triangular } from "./distributions.js";

export function simulateDay(config) {
  const rng = mulberry32(config.day.seed);

  const startMin = 0;
  const endMin = 720;

  const N = poisson(rng, config.day.lambdaPerDay);

  // mix diario (triangular)
  let probs = {};
  let sum = 0;
  for (let k in config.mix.base) {
    const base = config.mix.base[k];
    const v = triangular(rng,
      base * (1 - config.mix.triangularVolatility),
      base,
      base * (1 + config.mix.triangularVolatility)
    );
    probs[k] = Math.max(0, v);
    sum += probs[k];
  }
  for (let k in probs) probs[k] /= sum;

  function pickType() {
    let r = rng();
    let acc = 0;
    for (let k in probs) {
      acc += probs[k];
      if (r <= acc) return k;
    }
  }

  const rate = N / (endMin - startMin);
  let t = 0;

  let mesaFree = 0;
  let cambiadorFree = 0;
  let resonadorFree = 0;

  const rows = [];

  for (let i = 1; i <= N; i++) {
    t += exponential(rng, rate);
    const llegada = t;

    const tipo = pickType();
    const mu = config.serviceTotal.meansMin[tipo];
    const sigma = mu * config.serviceTotal.cvTotal;
    const total = Math.max(1, normal(rng, mu, sigma));

    const s = config.shares;

    const mesaIn = total * s.mesaIn;
    const cambiadorPre = total * s.cambiadorPre;
    const scan = total * s.scan;
    const cambiadorPost = total * s.cambiadorPost;
    const mesaOut = total * s.mesaOut;

    // Mesa entrada
    const startMesaIn = Math.max(llegada, mesaFree);
    const endMesaIn = startMesaIn + mesaIn;
    mesaFree = endMesaIn;

    // Cambiador pre
    const startCamb = Math.max(endMesaIn,

