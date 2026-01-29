export function normal(rng, mean, std) {
  let u = 0, v = 0;
  while(u === 0) u = rng();
  while(v === 0) v = rng();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function exponential(rng, rate) {
  return -Math.log(1 - rng()) / rate;
}

export function poisson(rng, lambda) {
  let L = Math.exp(-lambda);
  let p = 1.0;
  let k = 0;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export function triangular(rng, min, mode, max) {
  let u = rng();
  let c = (mode - min) / (max - min);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

