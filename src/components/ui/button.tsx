import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium touch-manipulation select-none transition-[background-color,border-color,color,transform] duration-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100',
  {
    variants: {
      variant: {
        default:     'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800',
        destructive: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
        outline:     'border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 active:bg-gray-100',
        secondary:   'bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300',
        ghost:       'text-gray-600 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200',
        link:        'text-indigo-600 underline-offset-4 hover:underline active:text-indigo-800',
        success:     'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm:      'h-8 px-3 text-xs',
        lg:      'h-11 px-6',
        icon:    'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
