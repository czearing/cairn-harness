"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import styles from "./FormField.module.css";
import choiceStyles from "./FormChoice.module.css";

interface ControlContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const ControlContext = createContext<ControlContextValue | undefined>(undefined);

interface FormFieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FormFieldProps {
  children: ReactNode | ((props: FormFieldControlProps) => ReactNode);
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  layout?: "stacked" | "inline";
}

export function FormField({
  children,
  label,
  description,
  error,
  optional,
  required,
  id,
  className,
  layout = "stacked",
}: FormFieldProps) {
  const generatedId = useId();
  const controlId = id || `field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const controlProps: FormFieldControlProps = {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  };

  return <div className={className ? `${styles.field} ${className}` : styles.field} data-field-layout={layout} data-field-invalid={error ? "true" : undefined}>
    <div className={styles.labelRow}>
      <label className={styles.label} htmlFor={controlId}>{label}</label>
      {(optional || required) && <span className={styles.requirement}>{optional ? "Optional" : "Required"}</span>}
    </div>
    <ControlContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
      <div className={styles.controlSlot}>{typeof children === "function" ? children(controlProps) : children}</div>
    </ControlContext.Provider>
    {description && <FieldMessage id={descriptionId} className={styles.fieldMessage} tone="help">{description}</FieldMessage>}
    {error && <FieldMessage id={errorId} className={styles.fieldMessage} tone="error">{error}</FieldMessage>}
  </div>;
}

type InputVariant = "default" | "color" | "file" | "bare";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: InputVariant;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({
  className,
  variant = "default",
  ...props
}, ref) {
  const control = useControlProps(props);
  return <input ref={ref} {...props} {...control} className={className ? `${styles.control} ${className}` : styles.control} data-control="input" data-control-variant={variant} />;
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "bare";
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  className,
  variant = "default",
  ...props
}, ref) {
  const control = useControlProps(props);
  return <textarea ref={ref} {...props} {...control} className={className ? `${styles.control} ${className}` : styles.control} data-control="textarea" data-control-variant={variant} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({
  className,
  children,
  ...props
}, ref) {
  const control = useControlProps(props);
  return <select ref={ref} {...props} {...control} className={className ? `${styles.control} ${className}` : styles.control} data-control="select">{children}</select>;
});

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  children: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, ChoiceProps>(function Checkbox({
  children,
  className,
  description,
  ...props
}, ref) {
  return <label className={className ? `${choiceStyles.choice} ${className}` : choiceStyles.choice}>
    <input ref={ref} type="checkbox" data-control="checkbox" {...props} />
    <span className={choiceStyles.choiceCopy}><strong>{children}</strong>{description && <small>{description}</small>}</span>
  </label>;
});

export function RadioGroup({
  legend,
  description,
  children,
  className,
}: {
  legend: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <fieldset className={className ? `${choiceStyles.radioGroup} ${className}` : choiceStyles.radioGroup}>
    <legend>{legend}</legend>
    {description && <p>{description}</p>}
    <div>{children}</div>
  </fieldset>;
}

export const Radio = forwardRef<HTMLInputElement, ChoiceProps>(function Radio({
  children,
  className,
  description,
  ...props
}, ref) {
  return <label className={className ? `${choiceStyles.choice} ${className}` : choiceStyles.choice}>
    <input ref={ref} type="radio" data-control="radio" {...props} />
    <span className={choiceStyles.choiceCopy}><strong>{children}</strong>{description && <small>{description}</small>}</span>
  </label>;
});

interface FieldMessageProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: "help" | "status" | "success" | "warning" | "error";
  action?: ReactNode;
}

export function FieldMessage({
  children,
  tone = "help",
  action,
  className,
  role,
  ...props
}: FieldMessageProps) {
  const messageRole = role || (tone === "error" || tone === "warning" ? "alert" : tone === "status" || tone === "success" ? "status" : undefined);
  return <div {...props} className={className ? `${choiceStyles.message} ${className}` : choiceStyles.message} data-message-tone={tone} role={messageRole}>
    <span>{children}</span>
    {action && <div className={choiceStyles.messageAction}>{action}</div>}
  </div>;
}

function useControlProps<T extends {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
}>(props: T) {
  const field = useContext(ControlContext);
  return {
    id: props.id || field?.id,
    "aria-describedby": [props["aria-describedby"], field?.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid ? true : undefined),
  };
}
