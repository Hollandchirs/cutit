import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  size?: 'sm' | 'md' | 'lg';
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  className = '', 
  variant = 'primary', 
  size = 'md',
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    secondary: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700",
    ghost: "bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50",
    icon: "bg-transparent text-zinc-400 hover:text-white p-1 hover:bg-zinc-800 rounded"
  };

  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-base"
  };

  const variantStyles = variants[variant];
  const sizeStyles = variant === 'icon' ? '' : sizes[size];

  return (
    <button 
      className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className}`} 
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;