// Auto-pause (build brief §8 / §12): halt the whole machine if the complaint
// rate exceeds the threshold (default 0.3%) or bounces spike. Pure.
//
// A min-volume guard prevents tripping on tiny samples (1 complaint in the
// first 5 sends is not a 20% complaint rate worth pausing for).

export interface SendStats {
  sent: number;
  complaints: number;
  bounces: number;
}

export interface AutoPauseOpts {
  complaintRate?: number; // default 0.003 (0.3%)
  bounceRate?: number; // default 0.05 (5%)
  minVolume?: number; // default 20
}

export interface AutoPauseResult {
  pause: boolean;
  reason?: string;
}

export function shouldAutoPause(stats: SendStats, opts: AutoPauseOpts = {}): AutoPauseResult {
  const complaintRate = opts.complaintRate ?? 0.003;
  const bounceRate = opts.bounceRate ?? 0.05;
  const minVolume = opts.minVolume ?? 20;

  if (stats.sent < minVolume) return { pause: false };

  const cRate = stats.complaints / stats.sent;
  if (cRate > complaintRate) {
    return { pause: true, reason: `complaint rate ${(cRate * 100).toFixed(2)}% > ${(complaintRate * 100).toFixed(2)}%` };
  }

  const bRate = stats.bounces / stats.sent;
  if (bRate > bounceRate) {
    return { pause: true, reason: `bounce rate ${(bRate * 100).toFixed(2)}% > ${(bounceRate * 100).toFixed(2)}%` };
  }

  return { pause: false };
}
