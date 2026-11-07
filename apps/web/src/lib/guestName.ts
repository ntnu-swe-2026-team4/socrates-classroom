export const isDefaultGuestName = (name: string | undefined) => !!name && /^(訪客|Guest|Invitado) \d{4}$/.test(name);
