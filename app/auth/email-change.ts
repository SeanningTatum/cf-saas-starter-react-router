export const isEmailChange = (storedEmail: string, nextEmail: unknown): boolean =>
  nextEmail !== undefined && nextEmail !== storedEmail;
