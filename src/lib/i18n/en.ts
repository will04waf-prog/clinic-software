/**
 * English message catalog — the toggle locale. Typed as `Messages`, so
 * every key from es.ts must be present or this file fails to compile.
 */
import type { Messages } from './es'

export const en: Messages = {
  common: {
    langName: 'English',
    switchToEn: 'Español',
    continue: 'Continue',
    back: 'Back',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    loading: 'Loading…',
    soon: 'Coming soon',
    required: 'Required',
  },

  signup: {
    pickIndustryTitle: 'What kind of business do you run?',
    pickIndustrySubtitle: 'Pick your industry so we can set Tarhunna up for you.',
    industryLandscaping: 'Landscaping & lawn care',
    industryLandscapingDesc: 'Mowing, cleanups, maintenance, garden design.',
    industryConstruction: 'Construction & trades',
    industryRestaurants: 'Restaurants & food',
    soonBadge: 'Coming soon',

    createAccountTitle: 'Create your account',
    createAccountSubtitle: 'Start free. No credit card.',
    businessNameLabel: 'Your business name',
    businessNamePlaceholder: 'García Landscaping',
    ownerNameLabel: 'Your name',
    ownerNamePlaceholder: 'José García',
    emailLabel: 'Email',
    emailPlaceholder: 'jose@example.com',
    phoneLabel: 'Your cell (WhatsApp)',
    phoneHint: 'Approvals and alerts reach you here. Required.',
    phonePlaceholder: '(305) 555-0123',
    passwordLabel: 'Password',
    passwordHint: 'At least 8 characters.',
    submitCta: 'Start free trial',
    trialNote: (days: number) => `${days}-day free trial. Cancel anytime.`,
    haveAccount: 'Already have an account?',
    logIn: 'Log in',

    errBusinessName: 'Enter your business name.',
    errOwnerName: 'Enter your name.',
    errEmail: 'Enter a valid email.',
    errPhone: 'Enter your cell number.',
    errPhoneFormat: 'Enter a valid US phone number.',
    errPassword: 'Password must be at least 8 characters.',
    errEmailTaken: 'An account with that email already exists. Log in.',
    errGeneric: "We couldn't create your account. Please try again.",
  },

  onboarding: {
    welcomeTitle: (name: string) => `Welcome, ${name}!`,
    welcomeSubtitle: "Here's how Tarhunna works. Four steps, and you get paid.",
    step1: 'Add a client',
    step1Desc: 'Name and cell. That’s it.',
    step2: 'Build an estimate',
    step2Desc: 'Your services and prices, in under 2 minutes.',
    step3: 'Send it by WhatsApp',
    step3Desc: 'Your client opens it and approves with one tap.',
    step4: 'Get paid',
    step4Desc: 'By card, or mark it paid by cash or Zelle.',
    startCta: 'Add my first client',
    skipCta: 'Explore first',
  },

  dashboard: {
    emptyTitle: "Let's get started",
    emptySubtitle: 'Your first estimate is a few taps away.',
    addClient: 'Add client',
    newEstimate: 'New estimate',
    clients: 'Clients',
    estimates: 'Estimates',
    jobs: 'Jobs',
    invoices: 'Invoices',
    getPaid: 'Get paid',
  },
}
