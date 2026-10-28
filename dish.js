/*
 * dish.js — a tiny simulated "neurons in a dish" culture that plays Pong.
 *
 * Inspired by Cortical Labs' DishBrain experiment (Kagan et al., Neuron 2022):
 *   - sensory electrodes tell the culture where the ball / paddle are
 *   - activity in two motor regions moves the paddle up or down
 *   - HIT  -> a predictable, calm, rhythmic stimulus (the "calm beat")
 *   - MISS -> a burst of unpredictable random stimulation (the "noise")
 *
 * The culture's plasticity is gated by that feedback: predictable input
 * consolidates the synapses that were recently active together (LTP), while
 * unpredictable noise destabilises them (LTD). Over time the culture drifts
 * towards behaviour that keeps its world predictable, i.e. hitting the ball.
 *
 * No DOM code here, so this file also runs in Node for headless testing.
 */
(function (root) {
  'use strict';

  const GW = 480, GH = 360;                 // game field
  const PAD_X = 18, PAD_W = 8, PAD_H = 64;  // paddle (left side)
  const BALL_R = 6, BALL_SPEED = 4.2;
  const NB = 8;                             // place-code bins per variable

  const CALM_TICKS = 24;    // length of predictable stimulus after a hit
  const NOISE_TICKS = 90;   // length of random stimulation after a miss
  const PAUSE_TICKS = 45;   // silent pause after a miss when feedback is off

  function randn() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  class Dish {
    constructor() {
      this.NB = NB;
      this.NS = NB * 3;   // sensory: 8 ball-height + 8 paddle-height + 8 ball-relative-to-paddle
      this.NH = 40;       // hidden "culture" neurons (fixed random wiring)
      this.NM = 16;       // motor: 0..7 = UP region, 8..15 = DOWN region
      this.NU = 8;
      this.feedback = true;
      this.lr = 0.03;
      this.wMax = 2;
      this.traceDecay = 0.985;
      this.jitter = 0.05;
      this.burstTau = 40;
      this.burstSigma = 0.04;
      this.burstFloor = 0.3; // exploration shrinks as the culture gets calmer
      this.motorGain = 24;
      this.motorThreshold = 0.35;
      this.motorSlope = 6;
      this.reset();
    }

    reset() {
      const { NS, NH, NM } = this;
      // Plastic synapses onto motor neurons
      this.Ws = new Float32Array(NS * NM).map(() => 0.04 + Math.random() * 0.08);
      this.Wh = new Float32Array(NH * NM).map(() => Math.random() * 0.05);
      // Fixed random culture wiring
      this.Win = new Float32Array(NS * NH).map(() =>
        Math.random() < 0.25 ? 0.4 + Math.random() * 0.6 : 0);
      this.Wrec = new Float32Array(NH * NH).map((_, k) => {
        const i = (k / NH) | 0, j = k % NH;
        return i !== j && Math.random() < 0.08 ? (Math.random() - 0.35) * 0.5 : 0;
      });
      // Eligibility traces (recent pre->post coincidences)
      this.Es = new Float32Array(NS * NM);
      this.Eh = new Float32Array(NH * NM);
      // Synaptic-scaling targets (total input per motor neuron stays constant)
      this.colS = this._colSums(this.Ws, NS);
      this.colH = this._colSums(this.Wh, NH);

      this.s = new Uint8Array(NS);
      this.h = new Uint8Array(NH);
      this.m = new Uint8Array(NM);
      this.vh = new Float32Array(NH);
      this.vm = new Float32Array(NM);
      this.thh = new Float32Array(NH).fill(1);
      this.thm = new Float32Array(NM).fill(this.motorThreshold);
      this.sRate = new Float32Array(NS);
      this.burst = [0, 0];
      this.pUp = 0; this.pDn = 0;

      this.t = 0;
      this.paddleY = GH / 2;
      this.padV = 0;
      this.phase = 'play';   // 'play' | 'noise' | 'pause'
      this.phaseT = 0;
      this.calmT = 0;
      this.lastEvent = null;
      this.expect = 0.2;     // running expectation of hitting
      this.stats = { hits: 0, misses: 0, rally: 0, bestRally: 0, events: [], curve: [] };
      this.serve();
    }

    _colSums(W, rows) {
      const out = new Float32Array(this.NM);
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < this.NM; j++) out[j] += W[i * this.NM + j];
      return out;
    }

    serve() {
      const a = (Math.random() - 0.5) * 1.2;
      this.ballX = GW * 0.62;
      this.ballY = GH * (0.15 + 0.7 * Math.random());
      this.vx = -BALL_SPEED * Math.cos(a);
      this.vy = BALL_SPEED * Math.sin(a);
    }

    step() {
      const { NS, NH, NM, NU } = this;
      this.t++;
      this.lastEvent = null;

      const noisy = this.phase === 'noise';
      const calm = this.calmT > 0;
      const calmPulse = calm && this.calmT % 6 === 0;
      if (calm) this.calmT--;

      const sPrev = this.s.slice(), hPrev = this.h.slice();

      // ---- 1. Sensory electrodes -------------------------------------------
      const bw = GH / NB;
      const closeness = clamp(1 - this.ballX / GW, 0, 1); // rate code for distance
      for (let i = 0; i < NB; i++) {
        const c = (i + 0.5) * bw;
        let pb, pp;
        if (noisy) { pb = pp = 0.45; }                  // unpredictable stim
        else if (calm) { pb = pp = calmPulse ? 1 : 0; } // synchronous, regular stim
        else {
          const gb = Math.exp(-0.5 * ((this.ballY - c) / (bw * 0.8)) ** 2);
          const gp = Math.exp(-0.5 * ((this.paddleY - c) / (bw * 0.8)) ** 2);
          pb = 0.02 + 0.6 * gb * (0.5 + 0.5 * closeness);
          pp = 0.02 + 0.6 * gp;
        }
        // egocentric cells: ball height relative to the paddle (-GH/2..+GH/2)
        let pr;
        if (noisy) pr = 0.45;
        else if (calm) pr = calmPulse ? 1 : 0;
        else {
          const rc = (i + 0.5) * bw - GH / 2;
          const gr = Math.exp(-0.5 * ((this.ballY - this.paddleY - rc) / (bw * 0.8)) ** 2);
          pr = 0.02 + 0.6 * gr * (0.5 + 0.5 * closeness);
        }
        this.s[i] = Math.random() < pb ? 1 : 0;
        this.s[NB + i] = Math.random() < pp ? 1 : 0;
        this.s[2 * NB + i] = Math.random() < pr ? 1 : 0;
        this.sRate[i] = noisy ? this.s[i] : pb;
        this.sRate[NB + i] = noisy ? this.s[NB + i] : pp;
        this.sRate[2 * NB + i] = noisy ? this.s[2 * NB + i] : pr;
      }

      // ---- 2. Hidden culture (leaky integrate-and-fire, homeostatic) --------
      for (let j = 0; j < NH; j++) {
        let I = 0;
        for (let i = 0; i < NS; i++) if (sPrev[i]) I += this.Win[i * NH + j];
        for (let k = 0; k < NH; k++) if (hPrev[k]) I += this.Wrec[k * NH + j];
        if (noisy) I += Math.random() * 1.5;
        let v = 0.5 * this.vh[j] + I + 0.3 * randn();
        const spk = v > this.thh[j] ? 1 : 0;
        if (spk) v = -0.3;
        this.vh[j] = v;
        this.h[j] = spk;
        this.thh[j] = clamp(this.thh[j] + 0.003 * (spk - 0.08), 0.2, 6);
      }

      // ---- 3. Motor regions (UP vs DOWN, mutual inhibition) -----------------
      // Spontaneous, slowly drifting network bursts shared within each motor
      // region (like real cultures). This is the culture's "exploration".
      // A surprised culture (missing a lot) is restless; a calm one settles.
      const restless = this.burstSigma * (this.burstFloor + (1 - this.burstFloor) * (1 - this.expect));
      for (let r = 0; r < 2; r++) {
        this.burst[r] += -this.burst[r] / this.burstTau + restless * randn();
      }
      // Motor neurons integrate the sensory firing *rates* (what an electrode
      // array would decode over a short window) plus hidden-culture spikes.
      const rates = this.sRate;
      let pUp = 0, pDn = 0;
      for (let j = 0; j < NM; j++) {
        let I = 0;
        for (let i = 0; i < NS; i++) I += this.Ws[i * NM + j] * rates[i];
        for (let k = 0; k < NH; k++) if (hPrev[k]) I += this.Wh[k * NM + j];
        I += this.burst[j < NU ? 0 : 1];
        if (noisy) I += Math.random() * 1.5;
        this.vm[j] = 0.7 * this.vm[j] + 0.3 * I;            // smoothed drive
        const p = 1 / (1 + Math.exp(-this.motorSlope * (this.vm[j] - this.thm[j])));
        this.m[j] = Math.random() < p ? 1 : 0;              // spikes (for display)
        if (j < NU) pUp += p; else pDn += p;
      }
      this.pUp = pUp / NU; this.pDn = pDn / NU;

      // ---- 4. Eligibility traces (only while actually playing) -------------
      if (this.phase === 'play' && !calm) {
        const Es = this.Es, Eh = this.Eh;
        const decay = this.traceDecay;
        for (let k = 0; k < Es.length; k++) Es[k] *= decay;
        for (let k = 0; k < Eh.length; k++) Eh[k] *= decay;
        // Population-level coincidence: which motor region "won" just now.
        // Every neuron in a region shares its region's net activity, so the
        // trace records "this input was active while the culture pushed UP".
        // Trace = input activity x the culture's spontaneous push (UP minus
        // DOWN burst). Feedback later decides whether that push was "good".
        const net = this.burst[0] - this.burst[1];
        for (let j = 0; j < NM; j++) {
          const dp = j < NU ? net : -net;
          for (let i = 0; i < NS; i++) Es[i * NM + j] += dp * rates[i];
          for (let k = 0; k < NH; k++) if (hPrev[k]) Eh[k * NM + j] += dp;
        }
      }

      // ---- 5. Paddle ---------------------------------------------------------
      let up = 0, dn = 0;
      for (let j = 0; j < NU; j++) { up += this.m[j]; dn += this.m[NU + j]; }
      this.upCount = up; this.downCount = dn;
      this.padV = clamp(0.75 * this.padV + 0.25 * (this.pDn - this.pUp) * this.motorGain, -7, 7);
      if (this.phase === 'play') {
        this.paddleY = clamp(this.paddleY + this.padV, PAD_H / 2, GH - PAD_H / 2);
      }

      // ---- 6. Game world -----------------------------------------------------
      if (this.phase === 'play') {
        this._moveBall();
      } else if (--this.phaseT <= 0) {
        this.phase = 'play';
        this.serve();
      }
    }

    _moveBall() {
      this.ballX += this.vx;
      this.ballY += this.vy;
      if (this.ballY < BALL_R) { this.ballY = BALL_R; this.vy = Math.abs(this.vy); }
      if (this.ballY > GH - BALL_R) { this.ballY = GH - BALL_R; this.vy = -Math.abs(this.vy); }
      if (this.ballX > GW - BALL_R) { this.ballX = GW - BALL_R; this.vx = -Math.abs(this.vx); }

      if (this.vx < 0 && this.ballX - BALL_R <= PAD_X + PAD_W) {
        const off = this.ballY - this.paddleY;
        if (Math.abs(off) <= PAD_H / 2 + BALL_R) this._hit(off);
        else this._miss();
      }
    }

    _hit(off) {
      this.ballX = PAD_X + PAD_W + BALL_R;
      this.vx = Math.abs(this.vx);
      this.vy += (off / (PAD_H / 2)) * 1.5;
      const sp = Math.hypot(this.vx, this.vy);
      this.vx = (this.vx / sp) * BALL_SPEED;
      this.vy = (this.vy / sp) * BALL_SPEED;
      if (Math.abs(this.vy) > BALL_SPEED * 0.75) {   // keep it from going vertical
        this.vy = Math.sign(this.vy) * BALL_SPEED * 0.75;
        this.vx = Math.sqrt(BALL_SPEED ** 2 - this.vy ** 2);
      }
      const st = this.stats;
      st.hits++; st.rally++; st.bestRally = Math.max(st.bestRally, st.rally);
      this._record(1);
      if (this.feedback) {
        this.calmT = CALM_TICKS;  // predictable stimulus
        this._learn(+1);          // consolidate what just happened
      } else {
        this.Es.fill(0); this.Eh.fill(0);
      }
      this.lastEvent = 'hit';
    }

    _miss() {
      const st = this.stats;
      st.misses++; st.rally = 0;
      this._record(0);
      if (this.feedback) {
        this.phase = 'noise';     // unpredictable stimulus
        this.phaseT = NOISE_TICKS;
        this._learn(-1);          // destabilise what just happened
      } else {
        this.phase = 'pause';
        this.phaseT = PAUSE_TICKS;
        this.Es.fill(0); this.Eh.fill(0);
      }
      this.calmT = 0;
      this.lastEvent = 'miss';
    }

    _learn(sign) {
      const { NS, NH, NM, lr, wMax } = this;
      // Surprise relative to expectation: a hit is "calming" in proportion to
      // how unexpected it was, a miss is "disturbing" likewise.
      const outcome = sign > 0 ? 1 : 0;
      const mod = outcome - this.expect;
      this.expect += 0.02 * (outcome - this.expect);
      const apply = (W, E, rows, target, rate) => {
        for (let k = 0; k < W.length; k++) {
          // misses also jitter the recently-active synapses a little
          const jitter = sign < 0 ? this.jitter * randn() * Math.abs(E[k]) : 0;
          W[k] = clamp(W[k] + rate * (mod * E[k] + jitter), 0, wMax);
        }
        // synaptic scaling: keep each motor neuron's total input constant
        for (let j = 0; j < NM; j++) {
          let sum = 0;
          for (let i = 0; i < rows; i++) sum += W[i * NM + j];
          if (sum > 1e-6) {
            const f = target[j] / sum;
            for (let i = 0; i < rows; i++) W[i * NM + j] = Math.min(W[i * NM + j] * f, wMax);
          }
        }
        E.fill(0);
      };
      apply(this.Ws, this.Es, NS, this.colS, lr);
      apply(this.Wh, this.Eh, NH, this.colH, lr * 0.5);
    }

    _record(v) {
      const st = this.stats;
      st.events.push(v);
      if (st.events.length % 20 === 0) {
        const last = st.events.slice(-20);
        st.curve.push({ rate: last.reduce((a, b) => a + b, 0) / 20, feedback: this.feedback });
      }
    }

    hitRate(n = 50) {
      const e = this.stats.events.slice(-n);
      return e.length ? e.reduce((a, b) => a + b, 0) / e.length : 0;
    }

    /** Learned up-minus-down drive for each sensory cell (for visualisation). */
    sensoryMap() {
      const { NS, NM, NU } = this;
      const out = new Float32Array(NS);
      for (let i = 0; i < NS; i++) {
        let u = 0, d = 0;
        for (let j = 0; j < NU; j++) { u += this.Ws[i * NM + j]; d += this.Ws[i * NM + NU + j]; }
        out[i] = (u - d) / NU;
      }
      return out;
    }
  }

  Dish.CONST = { GW, GH, PAD_X, PAD_W, PAD_H, BALL_R, BALL_SPEED, NOISE_TICKS, CALM_TICKS };
  root.Dish = Dish;
  if (typeof module !== 'undefined') module.exports = Dish;
})(typeof window !== 'undefined' ? window : globalThis);
