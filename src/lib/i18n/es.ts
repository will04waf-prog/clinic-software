/**
 * Spanish message catalog — the DEFAULT locale and the source of truth
 * for the CRM-pivot loop surfaces (signup, industry picker, onboarding,
 * loop dashboard). Its shape defines the `Messages` type; en.ts must
 * satisfy it, so a missing translation is a compile error.
 *
 * SCOPE: new loop surfaces only. The legacy med-spa dashboard stays
 * English and is NOT routed through this catalog. Neutral Latin-American
 * Spanish, usted register — the voice of the segment (Latino service-
 * business owners).
 *
 * Messages are plain strings, or functions when they interpolate.
 */
export const es = {
  common: {
    langName: 'Español',
    switchToEn: 'English',
    continue: 'Continuar',
    back: 'Atrás',
    save: 'Guardar',
    saving: 'Guardando…',
    cancel: 'Cancelar',
    loading: 'Cargando…',
    soon: 'Próximamente',
    required: 'Requerido',
  },

  signup: {
    // Step 1 — industry
    pickIndustryTitle: '¿A qué se dedica su negocio?',
    pickIndustrySubtitle: 'Elija su industria para preparar Tarhunna a su medida.',
    industryLandscaping: 'Jardinería y paisajismo',
    industryLandscapingDesc: 'Cortes, limpieza, mantenimiento, diseño de jardines.',
    industryConstruction: 'Construcción y oficios',
    industryRestaurants: 'Restaurantes y comida',
    soonBadge: 'Próximamente',

    // Step 2 — account
    createAccountTitle: 'Cree su cuenta',
    createAccountSubtitle: 'Empiece gratis. Sin tarjeta de crédito.',
    businessNameLabel: 'Nombre de su negocio',
    businessNamePlaceholder: 'Jardinería García',
    ownerNameLabel: 'Su nombre',
    ownerNamePlaceholder: 'José García',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'jose@ejemplo.com',
    phoneLabel: 'Su celular (WhatsApp)',
    phoneHint: 'Aquí le llegan las aprobaciones y los avisos. Requerido.',
    phonePlaceholder: '(305) 555-0123',
    passwordLabel: 'Contraseña',
    passwordHint: 'Mínimo 8 caracteres.',
    submitCta: 'Empezar prueba gratis',
    trialNote: (days: number) => `Prueba gratis de ${days} días. Cancele cuando quiera.`,
    haveAccount: '¿Ya tiene cuenta?',
    logIn: 'Inicie sesión',

    // errors (client-side + surfaced API codes)
    errBusinessName: 'Escriba el nombre de su negocio.',
    errOwnerName: 'Escriba su nombre.',
    errEmail: 'Escriba un correo válido.',
    errPhone: 'Escriba su número de celular.',
    errPhoneFormat: 'Escriba un número de teléfono válido de EE. UU.',
    errPassword: 'La contraseña debe tener al menos 8 caracteres.',
    errEmailTaken: 'Ya existe una cuenta con ese correo. Inicie sesión.',
    errGeneric: 'No pudimos crear su cuenta. Intente de nuevo.',
  },

  onboarding: {
    welcomeTitle: (name: string) => `¡Bienvenido, ${name}!`,
    welcomeSubtitle: 'Así funciona Tarhunna. Cuatro pasos, y le pagan.',
    step1: 'Agregue un cliente',
    step1Desc: 'Nombre y celular. Nada más.',
    step2: 'Cree un presupuesto',
    step2Desc: 'Sus servicios y precios, en menos de 2 minutos.',
    step3: 'Envíelo por WhatsApp',
    step3Desc: 'Su cliente lo abre y aprueba con un toque.',
    step4: 'Cobre',
    step4Desc: 'Con tarjeta, o marque en efectivo o Zelle.',
    startCta: 'Agregar mi primer cliente',
    skipCta: 'Explorar primero',
  },

  dashboard: {
    emptyTitle: 'Empecemos',
    emptySubtitle: 'Su primer presupuesto está a unos toques.',
    addClient: 'Agregar cliente',
    newEstimate: 'Nuevo presupuesto',
    clients: 'Clientes',
    estimates: 'Presupuestos',
    jobs: 'Trabajos',
    invoices: 'Facturas',
    getPaid: 'Cobrar',
  },
}

// No `as const`: Messages widens strings to `string` so en.ts can supply
// its own values while TS still enforces that every key is present.
export type Messages = typeof es
