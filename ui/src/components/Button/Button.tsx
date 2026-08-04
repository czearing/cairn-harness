import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "menu"
  | "surface"
  | "tab"
  | "link"
  | "inherit";

export type ButtonSize = "compact" | "default" | "large" | "icon" | "icon-compact";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button({
  children,
  className = "",
  variant = "inherit",
  size = "default",
  loading = false,
  fullWidth = false,
  disabled,
  ...props
}, ref) {
  return <button
    ref={ref}
    {...props}
    className={`${styles.button} ${className}`}
    data-button-variant={variant}
    data-button-size={size}
    data-button-width={fullWidth ? "full" : undefined}
    aria-busy={loading || props["aria-busy"]}
    disabled={disabled || loading}
  >
    {loading && <span className={styles.spinner} aria-hidden="true" />}
    {children}
  </button>;
});
