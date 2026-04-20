'use client'
import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

interface GreetingHeaderProps {
  firstName: string
  subtitle?: string
}

export function GreetingHeader({ firstName, subtitle }: GreetingHeaderProps) {
  // Computed on the client so it uses the user's local time, not the Vercel
  // server's UTC clock. Defer to useEffect to avoid a hydration mismatch.
  const [greeting, setGreeting] = useState<string | null>(null)

  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()))
  }, [])

  const title = greeting ? `${greeting}, ${firstName}` : `Hello, ${firstName}`
  return <Header title={title} subtitle={subtitle} />
}
