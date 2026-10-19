import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, useState } from "react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const action = visible ? "Hide" : "Show";

  return (
    <div className={`password-input ${className ?? ""}`.trim()}>
      <input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        aria-label={`${action} password`}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        <span>{action}</span>
      </button>
    </div>
  );
}
