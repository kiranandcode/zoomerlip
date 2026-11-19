import { memo, useState } from "react";
export const initials = (name: string) =>
  name
    .split(/[\s.-]/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
export const Avatar = memo(function Avatar({
  name,
  url,
  org,
  small = false,
}: {
  name: string;
  url?: string | null;
  org: string;
  small?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  let src = "";
  try {
    const parsed = new URL(url || "", org);
    if (url && ["http:", "https:"].includes(parsed.protocol)) src = parsed.href;
  } catch {
    /* initials fallback */
  }
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={
        {
          "--avatar-hue": String(
            [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360,
          ),
        } as React.CSSProperties
      }
    >
      {src && !failed ? (
        <img
          loading="lazy"
          decoding="async"
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
});
