import type { ErrorObject } from 'ajv';

interface CompiledValidator {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

export const validateOverworld: CompiledValidator;
export const validateWorld: CompiledValidator;
