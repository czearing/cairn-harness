import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button, type ButtonVariant } from "../Button/Button";

export type IconButtonSize = "compact" | "default";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  label: string;
  size?: IconButtonSize;
  variant?: Extract<ButtonVariant, "ghost" | "danger" | "secondary">;
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({
  children,
  label,
  size = "default",
  variant = "ghost",
  title,
  ...props
}, ref) {
  return <Button
    ref={ref}
    type="button"
    variant={variant}
    size={size === "compact" ? "icon-compact" : "icon"}
    aria-label={label}
    title={title ?? label}
    {...props}
  >
    {children}
  </Button>;
});
