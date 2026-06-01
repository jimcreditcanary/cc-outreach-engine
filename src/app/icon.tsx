// Favicon: the 🎯 emoji rendered to a 32×32 PNG at request time.
// Next.js App Router picks this up automatically — no <link rel="icon">
// wiring needed. ImageResponse uses the system emoji font.

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 28,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        🎯
      </div>
    ),
    { ...size },
  );
}
