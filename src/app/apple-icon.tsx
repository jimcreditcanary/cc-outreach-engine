// 180×180 apple-touch-icon — same 🎯 emoji, just bigger so iOS
// home-screen and Safari tab pinning look crisp.

import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 144,
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
