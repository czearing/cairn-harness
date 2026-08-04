import styles from "./IdentityMark.module.css";

export type IdentityMarkSize = "sm" | "md";

interface Props {
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
  size?: IdentityMarkSize;
  className?: string;
}

function initial(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

export function IdentityMark({ name, avatarUrl, color, size = "md", className }: Props) {
  return <span
    className={className ? `${styles.mark} ${className}` : styles.mark}
    data-identity-mark
    data-identity-size={size}
    aria-hidden="true"
    style={{
      ...(color ? { ["--identity-color" as string]: color } : null),
      ...(avatarUrl ? { backgroundImage: `url(${JSON.stringify(avatarUrl)})` } : null),
    }}
  >
    {avatarUrl ? null : initial(name)}
  </span>;
}
