import { memo, useState } from "react";
import { initials } from "./Avatar";
import { imageURL } from "../imageURL";
import { DEMO_ORIGIN } from "../demo/account";

export const OrgIcon = memo(function OrgIcon({
  name,
  url,
  org,
}: {
  name: string;
  url?: string;
  org: string;
}) {
  const src = org === DEMO_ORIGIN ? "/logo.svg" : imageURL(url, org);
  const [failed, setFailed] = useState("");
  return src && failed !== src ? (
    <img
      className="org-icon"
      src={src}
      alt=""
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  ) : (
    initials(name)
  );
});
