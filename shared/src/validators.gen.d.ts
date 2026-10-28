import type { ErrorObject } from 'ajv';

interface CompiledValidator {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

export const validateProject: CompiledValidator;
export const validateWorld: CompiledValidator;
export const validateLevel: CompiledValidator;
export const validateSettings: CompiledValidator;
export const validateInbox: CompiledValidator;
export const validateAutomation: CompiledValidator;
export const validateAttachment: CompiledValidator;
