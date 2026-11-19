import { memo, useState } from "react";
import { imageURL } from "../imageURL";
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
  const [failed, setFailed] = useState("");
  const src = imageURL(url, org);
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
      {src && failed !== src ? (
        <img
          loading="lazy"
          decoding="async"
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
});
