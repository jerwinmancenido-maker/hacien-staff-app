import type { CSSProperties } from "react";

export const NO_ID_UPLOAD_WARNING = "Do not upload ID cards or copies of government IDs.";

export function NoIdUploadWarning({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
} = {}) {
  const classes = ["small muted", className].filter(Boolean).join(" ");
  return (
    <div className={classes} style={{ marginTop: 4, ...style }}>
      {NO_ID_UPLOAD_WARNING}
    </div>
  );
}

export default NoIdUploadWarning;
