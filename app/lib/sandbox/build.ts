import { sandboxBuildOn } from "./switch";

export const SANDBOX_BUILD: boolean = sandboxBuildOn(import.meta.env);
